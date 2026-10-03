# ChemStock のDB実装

空のSupabase開発DBへ、ファイル名の順に次のマイグレーションを適用します。

- `migrations/20260929000000_core_schema.sql`：テーブル、数値制約、設定の初期値、研究室別の閲覧RLS、公開DBロールへの直接書き込み禁止。
- `migrations/20260929010000_designated_quantity.sql`：全研究室を合算する非公開ビューと、在庫変更時の指定数量再判定・通知生成。
- `migrations/20260929020000_inventory_commands.sql`：入出庫・履歴訂正／取消・下限値変更・利用停止のCommand RPC。アカウントと所属をDB内で再確認し、再送キー、在庫・履歴・監査の同時更新を扱います。
- `migrations/20260929030000_admin_overview.sql`：管理者向けの全室指定数量倍率・内訳・通知一覧Query RPC。DB内で管理者権限を再確認します。
- `migrations/20260929040000_notification_command.sql`：通知の確認済み・対応済みへの状態変更Command。再送・状態遷移・理由・監査を扱います。
- `migrations/20260929050000_email_delivery.sql`：指定数量超過メールの配送記録、ワーカーRPC、管理者向け配送状態。初期状態では送信を無効にします。
- `migrations/20261003000000_release_queries.sql`：換算・予測設定の限定Queryと、研究室権限に従う欠品予測Query。
- `migrations/20261003010000_release_management.sql`：管理対象の追加・再開、管理者向けマスタ・設定Query、全体管理者の監査付きCommand。

実Supabase環境への適用とAuth・Data APIを通した動作確認は未実施です。現在のアプリは上記8つのマイグレーションを前提とします。

`setup.sql` は旧デモ用のスキーマと仮データです。溶媒庫そのものの行や実験室の在庫を含むため、新しい開発DBや本番DBへ実行しません。既存のDBにマイグレーションを適用する場合は、先にスキーマとデータを調べて移行手順を別途作ります。

## ローカルでの検証

PostgreSQLの`initdb`・`pg_ctl`・`psql`が使える環境で、リポジトリ直下から実行します。

```bash
python3 scripts/verify_core_schema.py
python3 scripts/verify_inventory_commands.py
node --test scripts/verify_email_worker.mjs
node --test scripts/verify_google_mail_script.mjs
```

Pythonのスクリプトは一時DBを作り、`auth.uid()`をテスト用に置き換えます。基礎スキーマ、Command、欠品予測Query、管理対象・設定Command、指定数量通知、メール配送記録と権限を確認します。NodeのテストはGraphとGoogle Apps Scriptへの送信を模擬し、受付・結果不明・差出人と宛先の照合を確認します。実際のSupabase Auth・Data APIと送信サービスへの接続確認は開発環境で行います。

開発環境へ適用する前に、接続先が空の開発用プロジェクトであることを確認してください。確認済みの研究室・アカウント・初期在庫以外のデータは投入しません。

## メール機能の有効化準備（実環境では未実施）

[設計と送信条件](../docs/指定数量メール通知設計案.md)に従い、先に差出人と共有受信アドレスを決めます。既存の共有アドレスから送れるならMicrosoft Graph経路を選べます。送信権限を得られない場合は、専用Gmailアドレスを差出人とするGoogle Apps Script経路を使えます。どちらもローカル実装のみで、実サービスへの接続・実送信は未実施です。

Edge Function `send-notification-emails`はJWT検証を無効にして配置し、代わりに長いランダムな`x-worker-token`を必須とします。配置コマンドは`supabase functions deploy send-notification-emails --no-verify-jwt`です。Function Secretsに次を設定します。いずれもGitやブラウザーへ渡しません。`SUPABASE_URL`と`SUPABASE_SERVICE_ROLE_KEY`はSupabaseのFunction実行環境から取得します。

| Secret | 値 |
|---|---|
| `EMAIL_WORKER_TOKEN` | Cron呼び出し専用の長いランダム文字列 |
| `EMAIL_PROVIDER` | `microsoft_graph` または `gmail_apps_script` |
| `CHEMSTOCK_APP_URL` | 管理者がアクセスするアプリのHTTPS URL |

Microsoft Graphを使う場合だけ、次も設定します。大学側で送信元メールボックスの権限を確認してください。

| Secret | 値 |
|---|---|
| `M365_TENANT_ID` | 大学のテナントID |
| `M365_CLIENT_ID` | GraphアプリのクライアントID |
| `M365_CLIENT_SECRET` | Graphアプリのクライアントシークレット |
| `M365_SENDER` | 承認済みの差出人メールボックスのアドレス。DBの`sender_email`と一致させる |

専用Gmailを使う場合だけ、次を設定します。`GMAIL_SCRIPT_TOKEN`は`EMAIL_WORKER_TOKEN`とは別の長いランダム文字列にします。

| Secret | 値 |
|---|---|
| `GMAIL_SCRIPT_URL` | 専用アカウントが配置したApps Script Webアプリの`https://script.google.com/macros/s/.../exec` URL |
| `GMAIL_SCRIPT_TOKEN` | Webアプリとの通信用トークン |
| `GMAIL_SENDER` | 専用Gmailアドレス。DBの`sender_email`と一致させる |

### 専用GmailのApps Script

専用アカウントで[Code.gs](functions/send-notification-emails/google-apps-script/Code.gs)を新規Apps Scriptプロジェクトに配置します。個人の普段使いのアカウントではなく、運用担当がログイン・復旧方法を管理する専用アカウントを使います。プロジェクトのScript Propertiesに次を設定します。

| Script Property | 値 |
|---|---|
| `WEBHOOK_TOKEN` | Function Secretの`GMAIL_SCRIPT_TOKEN`と同じ値 |
| `SENDER_EMAIL` | 専用Gmailアドレス。Webアプリの実行アカウントと一致させる |
| `RECIPIENT_EMAIL` | 溶媒庫管理者用の共有受信アドレス |
| `APP_URL` | `CHEMSTOCK_APP_URL`と同じHTTPS URL |

Webアプリを「自分として実行」「全員がアクセス可能」で配置します。Webアプリの入口は公開されるため、コードはトークン、実行アカウント、固定宛先を確認してから送ります。配置時に専用アカウントで`MailApp`の権限を承認します。Google側の無料Gmail用Apps Scriptには現在、送信先100件/日の割当があるため、稼働前に現行の割当と通知頻度を確認します。試験メールを受信し、表示名「ChemStock 溶媒庫通知」、実際の`From`、`Reply-To`、迷惑メール判定を確認してください。

同じ`EMAIL_WORKER_TOKEN`をSupabase Vaultにも`chemstock_email_worker_token`として保存します。`pg_cron`と`pg_net`を有効にした開発DBで、毎分Functionを呼ぶジョブの例です。`<project-ref>`は接続先の値に置き換えます。

```sql
select cron.schedule(
  'chemstock-email-worker', '* * * * *',
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-notification-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-token', (select decrypted_secret from vault.decrypted_secrets
                         where name = 'chemstock_email_worker_token')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

マイグレーション適用直後は`private.email_notification_config.enabled=false`です。送信元の設定とテスト送受信が済み、差出人と共有宛先を確認してから、SQL Editorで次を実行します。過去の通知を送らないため、有効化時刻は実行時の`now()`にします。`<approved-sender-address>`は選んだ送信経路の`M365_SENDER`または`GMAIL_SENDER`と同じアドレスにします。

```sql
update private.email_notification_config
   set recipient_email = '<approved-shared-address>',
       recipient_confirmed_at = now(),
       sender_email = '<approved-sender-address>',
       sender_confirmed_at = now(), enabled_at = now(),
       enabled = true, updated_at = now()
 where singleton;
```

停止するときは`enabled=false`にします。既に送信中の要求は停止前に送信サービスへ渡る可能性があります。結果不明の案件は自動再送しないため、通知一覧の「要確認」と選んだ送信元アカウントの送信履歴を照合してください。
