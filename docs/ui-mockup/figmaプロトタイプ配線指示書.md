# Figma プロトタイプ配線指示書

`prototype.html`（操作プロトタイプ）と同じ画面遷移を **Figma の Prototype モード**で再現するための対応表。
html.to.design で `画面遷移マップ.html` を取り込んだ後、この表のとおりにフレームを繋ぐと、▶ Present で実際にクリック操作できるプロトタイプになる。

> MCPは読み取り専用のため、この配線（インタラクション設定）はFigma上での手作業。以下は「どの要素→どの画面／トリガー／アニメ」の完全な指示。

---

## 0. 事前準備

1. **取り込み**：html.to.design で `画面遷移マップ.html` をインポート（27フレーム生成）。
2. **フレーム名を統一**：各スマホフレームを下表の「画面ID」にリネーム（例：`home` `adjust` …）。配線の指定が楽になる。
3. **ダイアログは別フレーム化 or オーバーレイ化**：取消／下限変更／利用停止の3つはダイアログ。下の §4 参照。
4. **タブバーはコンポーネント化**（推奨）：5タブを Component にして各画面に配置。プロトタイプ接続をメインコンポーネントで1回設定すればインスタンスに継承される（§3）。
5. 右パネル上部を **Prototype** タブに切替 → フレーム上の要素を選び、出てくる「＋」を目的フレームへドラッグして接続。

**アニメーション既定（推奨）**
| 遷移種別 | Interaction | Animation |
|---|---|---|
| 主遷移（進む） | On tap → Navigate to | Move in ／ 方向: 左 |
| 戻る（← / キャンセル後） | On tap → Navigate to（または Back） | Move out ／ 右、または Instant |
| タブ切替 | On tap → Navigate to | Instant または Dissolve |
| ダイアログ表示 | On tap → Open overlay | Move in ／ 下 or Dissolve、背景 Centered |
| ダイアログ閉じ | On tap → Close overlay | Dissolve |

Flow starting point（▶の起点）は **login** に設定。

---

## 1. 入口フロー

| 起点フレーム | トリガー要素 | インタラクション | 遷移先 |
|---|---|---|---|
| login | 「ログイン」ボタン | Navigate to | **home** |
| home | カード「溶媒の登録・使用」 | Navigate to | **adjust** |
| home | カード「溶媒の在庫閲覧」 | Navigate to | **search** |
| home | 残量低下お知らせバナー | Navigate to | **notif** |
| home | 「ログアウト ⇥」 | Navigate to | **login** |

---

## 2. 登録・使用フロー

| 起点フレーム | トリガー要素 | インタラクション | 遷移先 |
|---|---|---|---|
| adjust | 「確認画面」ボタン | Navigate to | **actionInput** |
| adjust | 右上「🕘 履歴」 | Navigate to | **history** |
| actionInput | 「確認へ」ボタン | Navigate to | **actionConfirm** |
| actionInput | 「← 残量調整に戻る」 | Navigate to | **adjust** |
| actionConfirm | 「実行する」ボタン | Navigate to | **complete** |
| actionConfirm | 「← 修正する」 | Navigate to | **actionInput** |
| complete | 「ホームに戻る」 | Navigate to | **home** |
| complete | 「続けて操作する」 | Navigate to | **adjust** |
| history | 行の「取消」ボタン | **Open overlay** | 取消確認ダイアログ |
| history | 行の「編集」ボタン | Navigate to | **edit** |
| history | 「← 残量調整に戻る」 | Navigate to | **adjust** |
| 取消確認ダイアログ | 「取り消す」 | Close overlay → Navigate to | **recalc** |
| 取消確認ダイアログ | 「キャンセル」 | Close overlay | （historyに戻る） |
| edit | 「確認して保存」 | Navigate to | **recalc** |
| edit | 「← 入出庫履歴に戻る」 | Navigate to | **history** |
| recalc | 「入出庫履歴に戻る」 | Navigate to | **history** |

---

## 3. 在庫閲覧フロー

| 起点フレーム | トリガー要素 | インタラクション | 遷移先 |
|---|---|---|---|
| search | 「在庫状況を表示」 | Navigate to | **list** |
| search | 「（レガシー: 部屋別在庫）」 | Navigate to | **roomid** |
| list | テーブルの各行 | Navigate to | **detail** |
| list | 「← 在庫検索に戻る」 | Navigate to | **search** |
| detail | 「⚙ 変更」ボタン | **Open overlay** | 下限値変更ダイアログ |
| detail | 「← 在庫一覧に戻る」 | Navigate to | **list** |
| 下限値変更ダイアログ | 「保存」／「キャンセル」 | Close overlay | （detailに戻る） |
| roomid | 「← 在庫検索に戻る」 | Navigate to | **search** |

---

## 4. グラフフロー

| 起点フレーム | トリガー要素 | インタラクション | 遷移先 |
|---|---|---|---|
| graph | 「欠品予測を表示 ▸」 | Navigate to | **forecast** |
| forecast | 「← グラフに戻る」 | Navigate to | **graph** |

---

## 5. 管理フロー

| 起点フレーム | トリガー要素 | インタラクション | 遷移先 |
|---|---|---|---|
| manage | 「🧪 溶媒種類管理」 | Navigate to | **types** |
| manage | 「🛡 管理者画面」 | Navigate to | **admin** |
| types | 「＋ 溶媒を追加」 | Navigate to | **typeAdd** |
| types | 行の「利用停止」 | **Open overlay** | 利用停止確認ダイアログ |
| types | 「← 管理に戻る」 | Navigate to | **manage** |
| 利用停止確認ダイアログ | 「利用停止」／「キャンセル」 | Close overlay | （typesに戻る） |
| typeAdd | 「確認して登録」 | Navigate to | **types** |
| typeAdd | 「← 溶媒種類管理に戻る」 | Navigate to | **types** |
| admin | 「🔔 通知一覧」 | Navigate to | **notif** |
| admin | 「📊 利用履歴分析」 | Navigate to | **analysis** |
| admin | 「🧪 溶媒マスタ管理」 | Navigate to | **master** |
| admin | 「⚙️ 各種設定」 | Navigate to | **settings** |
| admin | 「← 管理に戻る」 | Navigate to | **manage** |
| notif | 「指定数量」の行 | Navigate to | **dq** |
| notif | 「← 管理者画面に戻る」 | Navigate to | **admin** |
| analysis | 「← 管理者画面に戻る」 | Navigate to | **admin** |
| master | 「← 管理者画面に戻る」 | Navigate to | **admin** |
| settings | 「指定数量モニター」の行 | Navigate to | **dq** |
| settings | 「← 管理者画面に戻る」 | Navigate to | **admin** |
| dq | 「← 各種設定に戻る」 | Navigate to | **settings** |

---

## 6. 下部タブバー（全画面共通）

タブバーをコンポーネント化し、各タブに以下を設定（メインコンポーネントで1回設定すれば全インスタンスに継承）。
login フレームにはタブバーを置かない。

| タブ | 遷移先 |
|---|---|
| 🏠 ホーム | **home** |
| ✏️ 登録・使用 | **adjust** |
| 🔍 在庫 | **search** |
| 📈 グラフ | **graph** |
| ⚙️ 管理 | **manage** |

> アクティブ表示（濃緑ハイライト）は静的な見た目の差なので、プロトタイプ挙動には影響しない。厳密に再現したい場合はタブバーをバリアント（active=home/adjust/…）にして各画面に対応インスタンスを置く。

---

## 7. ダイアログ（オーバーレイ）の作り方

取込直後は `.overlay` がフレーム内に重なって入る。次のいずれかで整える。

- **推奨（オーバーレイ）**：ダイアログ部分（半透明背景＋白モーダル）を切り出して独立フレーム化 →
  親画面のトリガーに **Open overlay → そのフレーム**、Close は **Close overlay**。背景タップで閉じるには overlay 設定で「Click outside to close」ON。
- **簡易（別画面）**：ダイアログ込みの画面を1フレームとして用意し、通常の Navigate to で行き来（アニメは Dissolve）。

対象は3つ：取消確認（history）／下限値変更（detail）／利用停止確認（types）。

---

## 8. 確認

- ▶ Present（右上）→ login から順にクリックして、上表どおり遷移するか確認。
- 参照：実際の挙動は `prototype.html` をブラウザで開けば同じ遷移を確認できる（Figma配線の答え合わせに使える）。
