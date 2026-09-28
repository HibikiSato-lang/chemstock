# 入出庫履歴「取消」機能 API設計

## 0. 前提（ER図との対応）

`docs/ER図.md` の既存テーブルのみで実現し、新規テーブルは追加しない。

- `inventory_logs`：`status`（有効／取消済）で取消管理。**物理削除しない**（`docs/ER図.md` L114、SKILL.md ルール1）。
- `inventory`：`inventory_logs.inventory_id` が指す room×solvent の現在庫。`amount` は基準単位（`base_unit`）で保持。
- `operation_audits`：`target_type='log'`、`action='取消'` として before/after と理由を必ず記録する（SKILL.md ルール1・ER図テーブル説明）。

取消は「入出庫履歴1件を無効化し、それが在庫数(`inventory.amount`)に与えていた影響を打ち消す」操作であり、単なるフラグ更新ではなく **在庫数の巻き戻し計算を伴う** 点が設計上の要。

---

## 1. API仕様

### エンドポイント

```
POST /api/inventory-logs/{logId}/cancel
```

（Server Actionとして実装する場合は `cancelInventoryLog(logId, input)` という関数シグネチャに読み替え可）

### リクエスト

```json
{
  "operatorName": "山田太郎",   // 取消を実行した実操作者名（手入力・必須。ルール4）
  "reason": "入力ミスのため（数量誤り）"  // 取消理由（必須・空文字不可）
}
```

### レスポンス（成功）

```json
{
  "logId": "uuid",
  "inventoryId": "uuid",
  "previousAmount": 12.5,
  "newAmount": 22.5,
  "logStatus": "取消済"
}
```

### エラー

| ケース | HTTP | 内容 |
|---|---|---|
| 対象ログが存在しない | 404 | 履歴IDが不正 |
| 既に `status='取消済'` | 409 | 二重取消の防止（冪等性） |
| `reason` が空 | 422 | 理由未入力 |
| 取消すると在庫がマイナスになる | 422 | 後続の入出庫と整合しないため取消不可（§4参照） |
| ロール不正（研究室ユーザーなど） | 403 | 取消は溶媒庫管理／全体管理者のみ許可（SKILL.md §3「危険な操作」に該当） |

権限チェックは `accounts.role` に基づき、API層（またはRLSポリシー／RPC内）で `role IN ('溶媒庫管理','全体管理者')` を必須とする。研究室ロールには取消操作自体を見せない。

---

## 2. なぜ「単純なUPDATE」ではなく1トランザクション（RPC）にするか

取消は以下2つの更新を **不可分（atomic）** に行う必要がある。

1. `inventory_logs.status` を `取消済` にする
2. `inventory.amount` からそのログの影響分を打ち消す

Supabase JS クライアントから個別に `update()` を2回呼ぶと、片方だけ成功する部分失敗（例：ネットワーク断）や、同時に2人の管理者が同じログを取消しようとする競合が起こり得る。そのため **PostgreSQLのストアド関数（RPC）内でトランザクション＋行ロック** を行う設計とする。

```sql
CREATE OR REPLACE FUNCTION cancel_inventory_log(
  p_log_id uuid,
  p_operator_name text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_log       inventory_logs%ROWTYPE;
  v_inventory inventory%ROWTYPE;
  v_new_amount numeric;
BEGIN
  -- 0. 入力チェック
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION '取消理由は必須です' USING ERRCODE = '22023';
  END IF;
  IF p_operator_name IS NULL OR btrim(p_operator_name) = '' THEN
    RAISE EXCEPTION '取消操作者名は必須です' USING ERRCODE = '22023';
  END IF;

  -- 1. 対象ログを行ロックして取得（同時取消の競合を防ぐ）
  SELECT * INTO v_log
  FROM inventory_logs
  WHERE id = p_log_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の入出庫履歴が見つかりません' USING ERRCODE = 'P0002';
  END IF;

  IF v_log.status = '取消済' THEN
    RAISE EXCEPTION 'この履歴はすでに取消済みです' USING ERRCODE = '22023';
  END IF;

  -- 2. 対応する在庫行を行ロックして取得
  SELECT * INTO v_inventory
  FROM inventory
  WHERE id = v_log.inventory_id
  FOR UPDATE;

  -- 3. 巻き戻し後の在庫数を計算
  --    change_amount は「+入庫 / -出庫」なので、取消は現在庫からこの値を単純に引けばよい
  v_new_amount := v_inventory.amount - v_log.change_amount;

  -- 4. マイナス在庫防止ガード（詳細は§4）
  IF v_new_amount < 0 THEN
    RAISE EXCEPTION
      'この履歴を取消すと在庫数がマイナスになるため取消できません（後続の入出庫と整合しません）'
      USING ERRCODE = '22023';
  END IF;

  -- 5. 在庫数を更新
  UPDATE inventory
  SET amount = v_new_amount
  WHERE id = v_inventory.id;

  -- 6. 履歴は物理削除せず status のみ更新
  UPDATE inventory_logs
  SET status = '取消済'
  WHERE id = v_log.id;

  -- 7. 監査ログを記録（before/after・理由を必ず残す）
  INSERT INTO operation_audits (
    target_type, target_id, action, operator_name, reason,
    before_value, after_value
  ) VALUES (
    'log',
    v_log.id,
    '取消',
    p_operator_name,
    p_reason,
    jsonb_build_object(
      'log_status', v_log.status,           -- '有効'
      'inventory_amount', v_inventory.amount
    ),
    jsonb_build_object(
      'log_status', '取消済',
      'inventory_amount', v_new_amount
    )
  );

  RETURN jsonb_build_object(
    'logId', v_log.id,
    'inventoryId', v_inventory.id,
    'previousAmount', v_inventory.amount,
    'newAmount', v_new_amount
  );
END;
$$;
```

呼び出し側（Next.js / Supabase JS）：

```ts
const { data, error } = await supabase.rpc('cancel_inventory_log', {
  p_log_id: logId,
  p_operator_name: operatorName,
  p_reason: reason,
});
```

`FOR UPDATE` によって `inventory_logs` と `inventory` の対象行をロックするため、同一ログへの同時取消リクエストは後発側が待たされ、ロック解放後に「既に取消済み」エラーとなり二重反映を防げる。

---

## 3. 在庫数の巻き戻し計算の考え方

`inventory.amount` は「初期値＋有効な `inventory_logs.change_amount` の総和」というランニング合計モデルである。したがって特定の1件を無効化する際は、

```
new_amount = 現在のamount - そのログのchange_amount
```

で常に正しく巻き戻せる（順序に依存しない）。ただし物理的な在庫数として妥当かどうかは別途チェックが必要（§4）。

---

## 4. マイナス在庫防止ガード（重要な業務ルール）

例：
1. Log1（入庫 +10L）→ `amount = 10`
2. Log2（出庫 -6L）→ `amount = 4`
3. ここでLog1（入庫10L）を取消 → `new_amount = 4 - 10 = -6`（マイナス）

これは「すでに使用された分がある入庫記録を取消す」という物理的に矛盾した操作であり、許可してはいけない。そのため `v_new_amount < 0` の場合は例外を投げて取消を拒否する（§2ステップ4）。

UI側では、このエラーを「先に後続の出庫履歴を確認・修正してください」といった案内文言でユーザーに提示することを想定する。

---

## 5. 監査ログ（`operation_audits`）に記録する内容

SKILL.md ルール1「取消・編集・利用停止・しきい値変更は**すべて** `operation_audits` に before/after と reason を記録する」に従い、以下を1レコードとして記録する。

| カラム | 値 |
|---|---|
| `target_type` | `'log'` |
| `target_id` | 取消対象の `inventory_logs.id` |
| `action` | `'取消'` |
| `operator_name` | 取消を実行した実操作者名（**取消を入力した人**。元の入出庫を行った `inventory_logs.operator_name` とは別概念） |
| `reason` | 取消理由（必須） |
| `before_value` | `{ "log_status": "有効", "inventory_amount": <取消前amount> }` |
| `after_value` | `{ "log_status": "取消済", "inventory_amount": <取消後amount> }` |

`inventory_logs` 自体の `operator_name` や `change_amount` は書き換えない（改ざん防止のため取消前の履歴内容はそのまま残す。ステータスのみ変化）。

---

## 6. 副次処理：通知の再評価（任意・推奨）

`inventory.amount` が変化するため、取消後に以下の再評価をトリガーすることが望ましい（`docs/ER図.md` の `notifications` 仕組みに準拠）。

- 在庫下限：`amount < inventory.low_stock_threshold` を下回った／上回ったかを再チェックし、必要なら `notifications`（`type='在庫下限'`）を発行または解消。
- 指定数量：対象が `rooms.kind='溶媒庫'` の在庫であれば、その溶媒庫のΣ(amount ÷ designated_quantity) を再計算し、`settings.warning_ratio`(0.8) や 1.0 を跨いだ場合に `notifications`（`type='指定数量接近'/'指定数量超過'`）を発行。

これは取消のトランザクション内で同期的に行ってもよいし、`inventory.amount` 更新をトリガーとする別処理（DBトリガー or アプリ側の後続ジョブ）に分離してもよい。ただし「取消そのものの成否」に通知処理の失敗を巻き込まないよう、通知発行は取消の主トランザクションとは別に（ベストエフォートで）行うことを推奨する。

---

## 7. 権限・RLSとの関係

- `cancel_inventory_log` は `SECURITY DEFINER` とし、関数冒頭で `auth.uid()` から `accounts.role` を引いて `role IN ('溶媒庫管理','全体管理者')` でない場合は例外を投げる、または呼び出し前にAPI層（Route Handler / Server Action）で同等のロールチェックを行う。
- 研究室ユーザーには取消ボタン自体をUI上表示しない（SKILL.md §3「可視性の非対称」「危険な操作は確認ダイアログ」）。

---

## 8. UI連携の注意点（実装時に踏まえるべき既存規範）

- 取消ボタン押下時は必ず確認ダイアログを挟み、**理由入力欄を必須**にする（SKILL.md §3）。
- 「取消操作者名」は共有アカウントのため自動入力せず、過去入力のサジェスト表示に留める（SKILL.md ルール4）。元の入出庫の `operator_name` とは別の入力欄として扱う。
- 取消後の一覧表示では `status='取消済'` の行は取り消し線表示などにして残し、削除しない（履歴の可監査性を保つ）。
- 新規タブ追加は不要。既存の「入出庫履歴」詳細画面（`app/inventory/detail/[id]` 想定）に「取消」ボタンと理由入力ダイアログを1つ追加する差分で実現できる（SKILL.md §3「既存画面のフロー・コードは変更しない」原則に整合）。

---

## 9. まとめ（処理フロー）

1. クライアント：確認ダイアログで理由・取消操作者名を入力 → `cancel_inventory_log` RPCを呼ぶ。
2. DB（1トランザクション）：
   a. `inventory_logs` を `FOR UPDATE` で取得し、`status='取消済'` でないか確認。
   b. `inventory` を `FOR UPDATE` で取得。
   c. `new_amount = amount - change_amount` を計算し、負値なら例外で中断（ロールバック）。
   d. `inventory.amount` を更新。
   e. `inventory_logs.status` を `'取消済'` に更新（物理削除しない）。
   f. `operation_audits` に before/after・理由・実操作者名を1件INSERT。
3. コミット後、必要に応じて在庫下限・指定数量の通知を再評価する。
