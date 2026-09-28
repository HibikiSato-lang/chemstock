# 入出庫履歴「取消」機能 API設計

## 1. 前提

- 対象テーブルは `inventory_logs`（入出庫履歴）と `inventory`（研究室×溶媒ごとの在庫）。
- 現状の `supabase/setup.sql` では `inventory_logs` に取消状態を表すカラムが存在しないため、本設計では `docs/ER図.md` に記載されている拡張スキーマ（`inventory_logs.status`、`operation_audits` テーブル）を前提とする。未適用の場合は先にマイグレーションが必要。
- `inventory_logs` の取消は**物理削除しない**。履歴を残したまま `status` を「取消済」に変え、在庫集計から除外する方針（ER図.mdの設計決定に準拠）。
- 取消操作自体も「誰が・いつ・何を・なぜ取り消したか」を `operation_audits` に記録する（監査要件）。

## 2. API仕様

### エンドポイント

```
POST /api/inventory-logs/:logId/cancel
```

Next.jsのApp Routerで実装する場合は、Route Handler（`app/api/inventory-logs/[logId]/cancel/route.ts`）または Server Action のどちらでもよいが、以下の理由からいずれの実装でも**DB操作はSupabaseのRPC（Postgres関数）にまとめてトランザクション化する**ことを推奨する。

- クライアントから複数テーブルへの更新を個別に呼ぶと、途中で失敗した際に在庫と履歴の整合性が崩れる（部分更新のリスク）。
- Supabase JS SDKは複数テーブルをまたぐトランザクションを直接張れないため、`BEGIN/COMMIT`を保証するには DB側の関数（PL/pgSQL）にロジックを寄せるのが確実。

### リクエスト

```json
{
  "operatorName": "学生A",   // 実操作者名（手入力・必須）
  "reason": "入力ミスのため"  // 取消理由（必須）
}
```

- `logId` はパスパラメータ（`inventory_logs.id`）。
- `operatorName` / `reason` は UI案.md の取消ダイアログ仕様（実操作者名・理由の入力）に対応。

### レスポンス

成功時（200）:

```json
{
  "logId": "uuid",
  "status": "取消済",
  "inventoryId": "uuid",
  "newAmount": 12.5,
  "auditId": "uuid"
}
```

エラー時:

| ステータス | ケース |
|---|---|
| 404 | 対象の `inventory_logs.id` が存在しない |
| 409 | 既に `status='取消済'` （二重取消） |
| 422 | 取消した結果 `inventory.amount` が負になる（入庫取消で出庫超過など） |
| 403 | 取消権限がないロール（研究室ユーザーは不可・溶媒庫管理者/全体管理者のみ許可、などRLS/認可ポリシーに応じる） |

## 3. DB処理の具体的な流れ

Postgres関数（例: `cancel_inventory_log(p_log_id uuid, p_operator_name text, p_reason text)`）として実装し、内部は1トランザクションで完結させる。ORMやSupabase JSから直接叩く場合も同じ順序をアプリ側で1トランザクション相当（できればRPC）にまとめる。

### ステップ0: 行ロック付きで対象履歴を取得

```sql
select id, inventory_id, change_amount, status, operator_name, purpose, created_at
from inventory_logs
where id = :log_id
for update;                -- 同時取消・同時在庫更新を防ぐ行ロック
```

- `for update` により、同じ履歴に対する多重取消リクエストや、同じ在庫行に対する同時入出庫登録との競合を直列化する。

### ステップ1: 状態チェック

```sql
-- アプリ側 or 関数内で判定
if status = '取消済' then
  raise exception 'already_cancelled';
end if;
```

- 見つからなければ404相当、既に取消済なら409相当としてハンドリング。

### ステップ2: 在庫行をロックして取得

```sql
select id, amount
from inventory
where id = :inventory_id
for update;
```

- `inventory_logs` だけでなく、更新対象の `inventory.amount` も行ロックして取得する。これにより「取消処理」と「通常の入出庫登録処理」が同じ在庫行に対して同時実行されても整合性が保たれる。

### ステップ3: 在庫量を再計算（取消 = 変化量を打ち消す）

```sql
update inventory
set amount = amount - :change_amount,   -- 元がプラス(入庫)ならマイナス、マイナス(出庫)ならプラスに働く
    last_updated = now()
where id = :inventory_id
returning amount;
```

- `change_amount` は元の履歴の値（例: `+3.0` の入庫を取り消すなら `amount - 3.0`、`-2.0` の出庫を取り消すなら `amount - (-2.0) = amount + 2.0`）。
- 結果が負になる場合はロールバックしてエラーとする（下記4のガード）。

### ステップ4: 整合性ガード

```sql
if new_amount < 0 then
  raise exception 'negative_stock_after_cancel';
end if;
```

- 出庫の取消（＝在庫を増やす方向）では基本的に負にはならないが、入庫の取消（＝在庫を減らす方向）で、取消対象の入庫後にさらに出庫が行われていた場合は在庫が負になり得る。この場合は422を返して取消を拒否し、運用上は先に後続履歴側の調整を促す（または警告を出しつつ許可するかは業務判断／要確認事項として残す）。

### ステップ5: 履歴のステータス更新

```sql
update inventory_logs
set status = '取消済'
where id = :log_id;
```

- 物理削除しない。`change_amount` や `operator_name` など元の値はそのまま残し、後から「誰が何を登録し、それが取り消された」という履歴を追跡可能にする。

### ステップ6: 監査ログへの記録

```sql
insert into operation_audits (
  target_type, target_id, action, operator_name, reason,
  before_value, after_value, created_at
) values (
  'log', :log_id, '取消', :operator_name, :reason,
  jsonb_build_object(
    'status', 'active',
    'inventory_amount_before', :amount_before
  ),
  jsonb_build_object(
    'status', '取消済',
    'inventory_amount_after', :amount_after
  ),
  now()
);
```

- `before_value` / `after_value` には「取消前の履歴の状態」と「取消操作によって変わった在庫量」を残す。取消操作を行った実操作者名（ログイン共有アカウントのため手入力）と理由も必須で記録。

### ステップ7（任意・在庫下限/指定数量の再評価）

在庫が変動するため、下限しきい値・指定数量の合算監視に影響する場合は同一トランザクション後（またはトリガー/後続ジョブ）で再評価する。

```sql
-- 例: 在庫下限を下回った/上回ったかの再チェック
select amount, low_stock_threshold from inventory where id = :inventory_id;

-- 該当する場合のみ notifications に insert
insert into notifications (type, room_id, solvent_id, message, status, notified_at)
values ('在庫下限', :room_id, :solvent_id, '...', '未確認', now())
where <condition>;
```

- 指定数量の合算監視（溶媒庫単位）についても、取消によって `Σ(amount ÷ designated_quantity)` が閾値をまたぐ場合は同様に `notifications` を再評価する。ここはDBトリガーで実装するか、アプリ層でRPC呼び出し後に別途チェック処理を呼ぶかは実装方針次第。

### コミット

すべて成功したらトランザクションをコミットし、更新後の `inventory.amount` と `auditId` をレスポンスとして返す。途中で例外が発生した場合はロールバックし、`inventory_logs.status` も `inventory.amount` も変更前の状態に戻る。

## 4. トランザクション全体のイメージ（PL/pgSQL関数例）

```sql
create or replace function cancel_inventory_log(
  p_log_id uuid,
  p_operator_name text,
  p_reason text
) returns table(new_amount numeric) as $$
declare
  v_log inventory_logs%rowtype;
  v_inventory inventory%rowtype;
  v_new_amount numeric;
begin
  -- 0. 履歴を行ロック付きで取得
  select * into v_log from inventory_logs where id = p_log_id for update;
  if not found then
    raise exception 'log_not_found';
  end if;
  if v_log.status = '取消済' then
    raise exception 'already_cancelled';
  end if;

  -- 2. 在庫行をロック
  select * into v_inventory from inventory where id = v_log.inventory_id for update;

  -- 3. 在庫再計算
  v_new_amount := v_inventory.amount - v_log.change_amount;
  if v_new_amount < 0 then
    raise exception 'negative_stock_after_cancel';
  end if;

  update inventory
    set amount = v_new_amount, last_updated = now()
    where id = v_inventory.id;

  -- 5. 履歴ステータス更新
  update inventory_logs set status = '取消済' where id = p_log_id;

  -- 6. 監査ログ
  insert into operation_audits (
    target_type, target_id, action, operator_name, reason, before_value, after_value, created_at
  ) values (
    'log', p_log_id, '取消', p_operator_name, p_reason,
    jsonb_build_object('status', 'active', 'inventory_amount_before', v_inventory.amount),
    jsonb_build_object('status', '取消済', 'inventory_amount_after', v_new_amount),
    now()
  );

  return query select v_new_amount;
end;
$$ language plpgsql security definer;
```

- `security definer` にすることで、RLSにより一般ユーザーが直接 `inventory` や `operation_audits` を書き換えられない設計にしつつ、この関数経由でのみ取消操作を許可する、という構成にできる。
- Next.js側からは `supabase.rpc('cancel_inventory_log', { p_log_id, p_operator_name, p_reason })` で呼び出す。

## 5. 権限・RLSの考え方

- `inventory_logs` / `inventory` / `operation_audits` への直接 `UPDATE`/`INSERT` はRLSで禁止し、取消は必ずこの関数（RPC）経由に限定するのが安全（不整合な直接更新を防ぐため）。
- 取消操作を行えるロールは ER図.md の `accounts.role`（研究室 / 溶媒庫管理 / 全体管理者）のうち、少なくとも溶媒庫管理者以上に限定することを推奨（研究室ユーザーが自分の誤入力を取り消せるようにするかは業務要件次第で要確認）。

## 6. まとめ（処理順序）

1. `inventory_logs` を対象行ロック（`for update`）で取得し、状態を検証（存在確認・二重取消防止）
2. 紐づく `inventory` 行も行ロックで取得
3. `change_amount` の符号を反転させる形で `inventory.amount` を再計算・更新
4. 再計算後の値が負にならないかガード
5. `inventory_logs.status` を「取消済」に更新（物理削除しない）
6. `operation_audits` に取消操作の記録（実操作者名・理由・before/after）を挿入
7. 必要に応じて在庫下限・指定数量の通知を再評価
8. 上記をすべて1トランザクションでコミット（失敗時は全ロールバック）
