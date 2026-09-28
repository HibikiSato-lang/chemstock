# チーム開発 下準備セットアップ 設計書

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ChemStock をチームで安全に並行開発できるよう、CI・フォーマッタ・DBマイグレーション・貢献ルールの4本柱を整備する。

**Architecture:** 既存の Next.js 16 + Supabase + shadcn 構成に手を入れず、その周辺（scripts / GitHub Actions / husky / supabase CLI / ドキュメント）を追加する。DBは「共有Supabaseプロジェクト1つ」を正とし、そのライブスキーマから baseline migration を生成して以後は差分で管理する。

**Tech Stack:** Node.js v24 / npm / Next.js 16 / TypeScript 5 (strict) / ESLint 9 (flat config) / Prettier / husky + lint-staged / GitHub Actions / Supabase CLI

## Global Constraints

- パッケージマネージャは **npm**（`package-lock.json` 準拠）。yarn/pnpm を導入しない。
- Node は **v24**、CI もこれに合わせる。
- `.env` / `.env*.local` は **絶対にコミットしない**（`.gitignore` 済み。参照もしない）。
- ESLint は既存の **flat config**（`eslint.config.mjs`）を維持し、Prettier と役割を分離（ESLint=lint、Prettier=整形）。
- 既存アプリコード（`app/` `components/` `lib/`）のロジックは変更しない。整備タスクの範囲は設定・ドキュメント・DB管理のみ。
- Supabase は **共有プロジェクト1つ**。ライブDBが唯一の正。ローカル(`supabase start`)は再現用。
- DBスキーマの現状は `supabase/setup.sql`（rooms / solvents / inventory / inventory_logs の4テーブル）。

---

## File Structure

作成・変更するファイルと責務:

- `package.json` — scripts に `typecheck` `format` `format:check` `prepare` `db:types` を追加、devDeps に prettier/husky/lint-staged を追加
- `.prettierrc.json` — Prettier 設定（整形ルールの単一の正）
- `.prettierignore` — 整形対象外（ビルド成果物・lock・生成物）
- `.husky/pre-commit` — コミット時に lint-staged を実行
- `.github/workflows/ci.yml` — PR/main push で lint + typecheck + build
- `.github/pull_request_template.md` — PRテンプレ（DoDチェックリスト）
- `.github/ISSUE_TEMPLATE/task.md` — 実装タスク用 Issue テンプレ
- `CONTRIBUTING.md` — ブランチ運用・セットアップ手順・レビュー規約
- `supabase/config.toml` — `supabase init` が生成（CLI設定）
- `supabase/migrations/<timestamp>_baseline.sql` — ライブDBから生成する baseline スキーマ
- `supabase/seed.sql` — シードデータ（rooms/solvents/inventory 初期化）を setup.sql から移設
- `lib/database.types.ts` — Supabase から生成するDB型
- `README.md` — オンボーディング節を追記

**タスク順序の理由:** Task1（scripts）は他タスクの前提。Task2/3（整形・CI）は独立。Task4（DB）はCLIと外部認証が必要なため後半。Task5（ドキュメント）は全体像が固まってから書く。

---

### Task 1: npm scripts の整備（typecheck / format 基盤）

**Files:**
- Modify: `package.json`（scripts セクション）

**Interfaces:**
- Produces: `npm run typecheck`（tscの型チェック、CI が利用）、`npm run format` / `npm run format:check`（Task2で有効化）、`npm run db:types`（Task4で有効化）

- [ ] **Step 1: `package.json` の scripts を置き換える**

`package.json` の `"scripts"` ブロックを以下に変更する:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "db:types": "supabase gen types typescript --local > lib/database.types.ts"
  },
```

- [ ] **Step 2: typecheck が動くことを確認**

Run: `npm run typecheck`
Expected: 型エラーがなければ何も出力せず終了コード0。エラーがある場合はファイル:行が列挙される（現状把握のため、ここでのエラーは記録するが本タスクでは修正しない）。

- [ ] **Step 3: コミット**

```bash
git add package.json
git commit -m "chore: add typecheck/format/db-types npm scripts"
```

---

### Task 2: Prettier + husky + lint-staged（コミット時自動整形）

**Files:**
- Create: `.prettierrc.json`, `.prettierignore`, `.husky/pre-commit`
- Modify: `package.json`（devDependencies, `lint-staged` 設定, `prepare` script）

**Interfaces:**
- Consumes: Task1 の `format` / `format:check` script
- Produces: コミット時にステージ済みファイルを自動整形する pre-commit フック

- [ ] **Step 1: 依存を追加**

Run:
```bash
npm install -D prettier husky lint-staged
```
Expected: `package.json` の devDependencies に3つが追加され、成功終了。

- [ ] **Step 2: `.prettierrc.json` を作成**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "es5",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 3: `.prettierignore` を作成**

```
.next/
out/
build/
coverage/
node_modules/
package-lock.json
lib/database.types.ts
supabase/migrations/
*.md
docs/
```

- [ ] **Step 4: `package.json` に lint-staged 設定と prepare script を追加**

`package.json` のトップレベル（`scripts` と同階層）に以下を追加する:

```json
  "lint-staged": {
    "*.{ts,tsx,js,mjs,css}": [
      "prettier --write",
      "eslint --fix"
    ]
  },
```

さらに `scripts` に prepare を追加する（Task1 の scripts ブロックへ1行足す）:

```json
    "prepare": "husky"
```

- [ ] **Step 5: husky を初期化して pre-commit フックを作成**

Run:
```bash
npx husky init
```
Expected: `.husky/` ディレクトリと `.husky/pre-commit`（初期内容は `npm test`）が生成される。

続けて `.husky/pre-commit` の中身を以下に**上書き**する:

```sh
npx lint-staged
```

- [ ] **Step 6: フックが動くことを確認**

Run:
```bash
npx lint-staged --help
```
Expected: lint-staged のヘルプが表示され、実行可能であることを確認できる（実コミットは次ステップで検証）。

- [ ] **Step 7: 動作確認コミット**

```bash
git add .prettierrc.json .prettierignore .husky/pre-commit package.json package-lock.json
git commit -m "chore: set up prettier + husky + lint-staged"
```
Expected: コミット時に pre-commit が走り、lint-staged がステージ済みファイルを整形して成功する。

---

### Task 3: GitHub Actions CI（lint + typecheck + build）

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Task1 の `lint` / `typecheck` / `build` script
- Produces: PR と main への push で走る CI ジョブ（ブランチ保護の必須チェックとして利用）

- [ ] **Step 1: `.github/workflows/ci.yml` を作成**

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npm run typecheck

      - name: Build
        run: npm run build
        env:
          NEXT_PUBLIC_SUPABASE_URL: https://placeholder.supabase.co
          NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder-anon-key
```

> 備考: `build` 時に Supabase の環境変数を参照する場合、上のダミー値でビルドが通ることを確認する。ビルドが実接続を要求して失敗する場合は、その箇所を Task5 の「フォローアップ」に記録し、実キーは GitHub Actions Secrets（`Settings > Secrets and variables > Actions`）に登録して `env` を差し替える。

- [ ] **Step 2: ローカルで CI と同じコマンドが通ることを確認**

Run:
```bash
npm run lint && npm run typecheck && npm run build
```
Expected: 3コマンドとも成功（終了コード0）。失敗した場合は内容を記録し、アプリコード修正は別Issue化する（本タスクはCI定義のみ）。

- [ ] **Step 3: コミット**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add lint/typecheck/build workflow"
```

- [ ] **Step 4: リモートで CI が起動することを確認**

このタスクを含むブランチを push し、GitHub 上の Actions タブでワークフローが起動・成功することを確認する（PR作成時に緑になること）。

---

### Task 4: Supabase マイグレーション体制への移行 + DB型生成

**Files:**
- Create: `supabase/config.toml`（`supabase init` が生成）, `supabase/migrations/<timestamp>_baseline.sql`, `supabase/seed.sql`, `lib/database.types.ts`
- Delete: `supabase/setup.sql`（baseline へ移行後）

**Interfaces:**
- Consumes: Task1 の `db:types` script
- Produces: `supabase/migrations/` 差分管理体制、`lib/database.types.ts`（フロントが import するDB型）

> **前提（実行者が用意する外部値）:** 共有Supabaseプロジェクトの **project-ref**（Supabaseダッシュボード `Project Settings > General` の Reference ID）と DBパスワード。これらは秘匿情報で、リポジトリにコミットしない。

- [ ] **Step 1: Supabase CLI を初期化**

Run:
```bash
npx supabase init
```
Expected: `supabase/config.toml` が生成される（既存の `supabase/setup.sql` はそのまま残る）。

- [ ] **Step 2: 共有プロジェクトにリンク**

Run（`<project-ref>` は実際の Reference ID に置換）:
```bash
npx supabase login
npx supabase link --project-ref <project-ref>
```
Expected: リンク成功メッセージ。DBパスワードを対話で求められたら入力する。

- [ ] **Step 3: ライブDBから baseline migration を生成**

Run:
```bash
npx supabase db pull
```
Expected: `supabase/migrations/<timestamp>_remote_schema.sql` が生成され、`rooms` / `solvents` / `inventory` / `inventory_logs` の CREATE 文とインデックスが含まれる。生成ファイルを開き、`supabase/setup.sql` のDDL（1〜29行, 68〜78行）と構造が一致することを目視確認する。

- [ ] **Step 4: シードデータを `supabase/seed.sql` に移設**

`supabase/setup.sql` の INSERT 部分（rooms/solvents/inventory の cross join）を `supabase/seed.sql` として切り出す:

```sql
-- Seed Data: Rooms
insert into rooms (name) values
  ('D105学生実験室'),
  ('D106学生実験室'),
  ('D201共同利用化学実験室'),
  ('溶媒庫'),
  ('F108実験室'),
  ('F109実験室'),
  ('F110実験室');

-- Seed Data: Solvents
insert into solvents (name, cas_number, formula, molecular_weight) values
  ('メタノール', '67-56-1', 'CH3OH', '32.04'),
  ('エタノール', '64-17-5', 'C2H5OH', '46.07'),
  ('イソプロパノール', '67-63-0', 'C3H8O', '60.10'),
  ('アセトン', '67-64-1', 'C3H6O', '58.08'),
  ('トルエン', '108-88-3', 'C7H8', '92.14');

-- Seed Data: Inventory (全room × 全solvent を 0 で初期化)
insert into inventory (room_id, solvent_id, amount)
select r.id, s.id, 0.0
from rooms r
cross join solvents s;
```

- [ ] **Step 5: baseline とシードでローカルDBが再現できることを確認**

Run:
```bash
npx supabase start
npx supabase db reset
```
Expected: migration → seed.sql の順で適用され、エラーなく完了。`supabase start` の出力に表示されるローカル Studio URL でテーブルとシード行を確認できる。

- [ ] **Step 6: DB型を生成**

Run:
```bash
npm run db:types
```
Expected: `lib/database.types.ts` が生成され、`Database` 型と各テーブルの Row/Insert/Update 型が含まれる。

- [ ] **Step 7: 旧 setup.sql を削除**

baseline と seed が正となったため、重複を避けるため削除する:

```bash
git rm supabase/setup.sql
```

- [ ] **Step 8: コミット**

```bash
git add supabase/config.toml supabase/migrations supabase/seed.sql lib/database.types.ts
git commit -m "chore(db): adopt supabase migrations + generated types, retire setup.sql"
```

> **注意:** 共有リモートDBには既にスキーマが適用済みのため、この baseline をリモートへ `db push` してはいけない（重複適用エラーになる）。baseline はローカル再現と将来の差分管理の起点。今後のスキーマ変更は `supabase migration new <name>` で新ファイルを作り、PRレビュー後に `supabase db push` で反映する運用にする（→ Task5 に明記）。

---

### Task 5: 貢献ガイド + PR/Issue テンプレ + README + ブランチ保護手順

**Files:**
- Create: `CONTRIBUTING.md`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/task.md`
- Modify: `README.md`（オンボーディング節を追記）

**Interfaces:**
- Consumes: Task1〜4 で確立したコマンド・運用（lint/typecheck/build、pre-commit、migrations）

- [ ] **Step 1: `CONTRIBUTING.md` を作成**

```markdown
# コントリビューションガイド（ChemStock）

## 開発の始め方
1. Node.js v24 / npm を用意
2. `npm ci` で依存をインストール
3. `.env.example` を `.env.local` にコピーし、共有Supabaseの URL / anon key を設定（値はチームの安全なチャネルで受け取る。`.env*` はコミット禁止）
4. `npm run dev` で起動

## ブランチ運用
- `main` への直接コミットは禁止。
- 作業は `feature/<内容>` / `fix/<内容>` ブランチを切って行う。
- PR を作成し、CI（lint/typecheck/build）通過 + レビュー1件承認でマージ。
- マージ方式は Squash and merge を推奨。

## コミット / PR
- pre-commit で Prettier + ESLint が自動実行される（`npm run format` で手動整形も可）。
- PR には目的・変更点・確認方法を記載（テンプレに従う）。

## Definition of Done
- [ ] `npm run lint` 通過
- [ ] `npm run typecheck` 通過
- [ ] `npm run build` 通過
- [ ] 画面/機能の動作確認済み
- [ ] レビュー承認済み

## DBスキーマ変更の手順
1. `npx supabase migration new <name>` で新規マイグレーションを作成
2. SQL を記述し、`npx supabase db reset` でローカル検証
3. `npm run db:types` で `lib/database.types.ts` を更新
4. PR でレビュー → 承認後に担当者が `npx supabase db push` で共有DBへ反映
- 既存の baseline を共有DBへ push しないこと（適用済みのため）。
```

- [ ] **Step 2: `.github/pull_request_template.md` を作成**

```markdown
## 目的 / 背景

## 変更内容
-

## 確認方法
-

## チェックリスト
- [ ] `npm run lint` 通過
- [ ] `npm run typecheck` 通過
- [ ] `npm run build` 通過
- [ ] 動作確認済み
- [ ] （DB変更あり）migration追加 + `db:types` 更新済み

## 関連 Issue
Closes #
```

- [ ] **Step 3: `.github/ISSUE_TEMPLATE/task.md` を作成**

```markdown
---
name: 実装タスク
about: 機能・改善・修正の作業単位
title: "[Task] "
labels: task
---

## 概要

## 完了条件
- [ ]

## 参考
- 関連ドキュメント:
```

- [ ] **Step 4: `README.md` にオンボーディング節を追記**

`README.md` の適切な位置（既存の説明の後）に以下の節を追加する:

```markdown
## 開発者向けセットアップ

チーム開発のルール・環境構築手順は [CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

主なコマンド:
- `npm run dev` — 開発サーバ
- `npm run lint` / `npm run typecheck` / `npm run build` — CIと同じ検証
- `npm run format` — Prettier整形
- `npm run db:types` — Supabaseスキーマから型生成
```

- [ ] **Step 5: コミット**

```bash
git add CONTRIBUTING.md .github/pull_request_template.md .github/ISSUE_TEMPLATE/task.md README.md
git commit -m "docs: add contributing guide, PR/Issue templates, onboarding"
```

- [ ] **Step 6: GitHub 側の手動設定（コード外・チームで実施）**

以下は GitHub UI での設定のため、実施チェックのみ:
- [ ] `Settings > Branches > Add branch protection rule` で `main` を保護
  - [ ] Require a pull request before merging（レビュー1件必須）
  - [ ] Require status checks to pass → `verify`（Task3のCIジョブ名）を必須に
- [ ] `docs/実装タスク一覧.html` の項目を GitHub Issues 化し、担当を割り当て
- [ ] 環境変数（Supabase URL / anon key）を安全なチャネルでチームに配布

---

## フォローアップ（本設計書のスコープ外・別途検討）

- **RLS ポリシー設計**: 現状テーブルに Row Level Security 未設定の可能性が高い。共有DB・匿名anon keyでの読み書き範囲をドメイン前提（単一溶媒庫・研究室区画）に沿って別途設計する。
- **テスト基盤**: 現状テストランナー未導入。重要ロジック（在庫増減・棚卸）が固まった段階で Vitest 等の導入を別計画で。
- **CI の build 用 Supabase 値**: Task3 のダミー値でビルドが通らない場合、Secrets 運用へ移行。

---

## Self-Review

- **スコープ網羅**: ユーザー合意4項目（CI+型チェック=Task1,3 / Prettier+husky=Task2 / Supabaseマイグレーション=Task4 / 貢献ガイド・テンプレ=Task5）をすべてタスク化済み。Supabase「共有プロジェクト1つ」前提は Task4 に反映（db pull で baseline化・push禁止注記）。
- **プレースホルダ**: コード・設定は実内容を記載。外部秘匿値（project-ref / 環境変数キー / GitHub UI設定）のみ実行者依存として明示（正当なプレースホルダ）。
- **整合性**: script名（`typecheck` `format` `format:check` `db:types` `prepare`）、CIジョブ名（`verify`）、フック（`.husky/pre-commit` → `npx lint-staged`）がタスク間で一貫。
