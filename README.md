# ChemStock

大学の研究室・溶媒庫向け溶媒在庫管理アプリ。画面設計は [UI案](docs/UI案.md)、画面遷移は [画面遷移図](docs/画面遷移図.md) に記載しています。

## 画面を確認する

```bash
npm ci
npm run dev
```

ブラウザーで `http://localhost:3000/preview` を開くと、画面確認用データでログイン後の全画面を操作できます。上部の権限切替で研究室・溶媒庫管理・全体管理者の表示を確認できます。操作内容はそのブラウザーの `localStorage` にだけ保存され、実際の在庫やDBには反映されません。ログイン画面は `http://localhost:3000/` です。

チーム向けには、主要操作を順番にたどれる [追加機能の操作フロー](docs/チーム共有_実装機能ガイド.html) と [画面遷移マップ](docs/ui-mockup/画面遷移マップ.html) を用意しています。HTMLは単体でも閲覧できます。操作を試す場合は上の手順でプレビューを起動してください。

## 実データを表示する

`.env.local` に `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` を設定します。対応する Supabase Auth ユーザー、`accounts` 行、[DBマイグレーション](supabase/README.md) が必要です。ログイン後、所属研究室の在庫・履歴を読み込みます。全体管理者は研究室を選択できます。

### 開発用テストアカウント

新スキーマを適用した開発用 Supabase に対し、`CHEMSTOCK_TEST_SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` を環境変数で設定して `npm run test-accounts:create` を実行します。管理用キーはサーバー側の作成スクリプトだけで使い、`NEXT_PUBLIC_` 付きの変数には入れません。スクリプトは `テスト研究室` を作成または再利用し、次の3アカウントを作成します。

| 種類 | ログイン用メール | DBロール | 所属 |
|---|---|---|---|
| 一般ユーザー | `test-lab@chemstock.test` | `lab` | テスト研究室 |
| admin | `test-admin@chemstock.test` | `global_admin` | なし |
| 管理者（溶媒） | `test-solvent-admin@chemstock.test` | `solvent_room_admin` | テスト研究室 |

生成されたパスワードは Git 管理外の `test-accounts.credentials.json` に保存されます。再実行時は既存アカウントの権限を照合し、不一致があれば停止します。ファイルを失った場合はスクリプト管理下のテストユーザーのパスワードを再発行します。メール確認は作成時に済ませるため、テストドメインへのメール配信は不要です。

8つの[DBマイグレーション](supabase/README.md)を順に適用すると、入出庫・履歴の訂正と取消・在庫下限値の変更・利用停止、管理対象の追加・再開をCommand RPCで保存できます。管理者は指定数量の合算倍率・通知、欠品予測、溶媒マスタ・設定を画面で確認でき、全体管理者は法令値と限定設定を監査付きで変更できます。[共有アドレス向けメール通知](docs/指定数量メール通知設計案.md)の送信機能は初期状態で無効です。実Supabase環境へのマイグレーション適用とAuth・Data APIでの通し確認は未実施です。画面確認用データによる予測は実データの計算結果ではありません。残りの工程は [実装タスク一覧](docs/実装タスク一覧.html) を参照してください。

`supabase/setup.sql` は旧デモ向けであり、上記の基礎マイグレーションを適用するDBへ投入しません。詳細は [supabase/README.md](supabase/README.md) を参照してください。
