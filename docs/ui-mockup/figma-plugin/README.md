# ChemStock Flow Builder（Figmaプラグイン）

画面遷移図を **Figmaの本物のデザインデータ** として自動生成するプラグイン。
実行すると1回で以下ができあがる：

- **画面24枚＋ダイアログ3枚**（390×844、フロー別セクションに整列、枠色＝種別：橙=新規/黄=ダイアログ/紫=DXコア/灰=レガシー）
- **コンポーネント**：`TabBar`（Active=home/adjust/search/graph/manage の**バリアント5種**）、`Button/Primary・Ghost・Danger`、`Icon/Home`（昨年度と統一のlucide Home）→ 各画面には**インスタンス**を配置
- **プロトタイプ配線済み**：ボタン・一覧の行・戻るリンク・タブに遷移先を設定
  - タブの遷移は**メインコンポーネント側**に設定 → 全インスタンスに継承
  - ダイアログは **Open overlay / Close overlay**（取消確認・下限値変更・利用停止）
  - Flow starting point＝ログイン。**▶ Present ですぐ操作できる**
- 内容は改訂済み要件を反映（通知＝指定数量専用・未確認バッジ・ホームバナー＝欠品予測/下限割れ中）

## 使い方（1回だけ・約3分）

1. **Figmaデスクトップアプリ**で**新規デザインファイル**を開く
   （FigJamボードでは不可。プロトタイプはデザインファイルの機能）
2. メニュー → **Plugins → Development → Import plugin from manifest…**
   → このフォルダの `manifest.json` を選択
3. **Plugins → Development → ChemStock Flow Builder** を実行
4. 数秒で全画面が生成される → 右上 **▶ Present** でログイン画面から操作

## トラブルシューティング

- **フォント**：Noto Sans JP を自動ロード（Figmaの Google Fonts）。取得できない環境では Inter に自動フォールバック。
- **manifest の id エラー**が出た場合：`manifest.json` の `"id"` の値を任意の数字列に変えて再インポート。
- **実行し直したい**：生成物（セクションごと）を削除してから再実行（多重生成されるだけで壊れはしない）。
- 遷移の仕様は [figmaプロトタイプ配線指示書.md](../figmaプロトタイプ配線指示書.md)、実挙動の答え合わせは [prototype.html](../prototype.html) と同一。
