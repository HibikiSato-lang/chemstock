// ChemStock Flow Builder
const VERSION = "v12 端末サイズ調整版";
// 画面遷移図（24画面＋ダイアログ3枚）を Figma のデザインデータとして生成する。
// - コンポーネント: TabBar(バリアント5種) / Button(Primary,Ghost,Danger) / Icon/Home
// - 各画面にはインスタンスを配置し、プロトタイプ遷移(Reactions)を配線する
// - Flow starting point は「ログイン」。▶ Present でそのまま操作できる。

// ---------- palette ----------
const MINT = "#d5ebe1", TEAL = "#2e6b58", TEAL_D = "#24523f";
const LINE = "#c6ddd2", LINE_S = "#9dbfb0", TEXT = "#22332c", MUTED = "#5f7a6f";
const LINK = "#2b6cb0", WARN_BG = "#fdf2e3", WARN = "#b45309";
const NEW = "#fb8c00", DIA = "#f59e0b", DX = "#7c3aed", LEG = "#90a4ae";
const DANGER = "#c0392b", WHITE = "#ffffff";
const PHONE_W = 360, PHONE_H = 720;  // HTMLプロトタイプと同寸（従来390×844は縦が長く上寄りに見えた）

const paint = (h, o = 1) => {
  const n = parseInt(h.slice(1), 16);
  return { type: "SOLID", color: { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }, opacity: o };
};

let F_REG = { family: "Noto Sans JP", style: "Regular" };
let F_BOLD = { family: "Noto Sans JP", style: "Bold" };

// ---------- registries ----------
const screens = {};   // id -> FrameNode
const overlays = {};  // id -> FrameNode
const wires = [];     // {n:node, k:"nav"|"back"|"ov"|"close", d:destId}
const tabCells = [];  // {n:cellFrame, d:screenId}
let BtnPrimary, BtnGhost, BtnDanger, IconHome, TabSet;

// ---------- tiny builders ----------
function txt(s, o = {}) {
  const t = figma.createText();
  t.fontName = o.bold ? F_BOLD : F_REG;
  t.characters = s;
  t.fontSize = o.size || 14;
  t.fills = [paint(o.color || TEXT)];
  if (o.underline) t.textDecoration = "UNDERLINE";
  return t;
}
function stack(dir, gap, pad = 0) {
  const f = figma.createFrame();
  f.layoutMode = dir; f.itemSpacing = gap;
  f.paddingLeft = f.paddingRight = f.paddingTop = f.paddingBottom = pad;
  f.fills = []; f.primaryAxisSizingMode = "AUTO"; f.counterAxisSizingMode = "AUTO";
  return f;
}
function add(p, n, fillW = false) {
  p.appendChild(n);
  if (fillW) { try { n.layoutSizingHorizontal = "FILL"; } catch (e) { /* not in AL parent */ } }
  return n;
}
function row(p, gap = 8) { // stretched horizontal row
  const r = stack("HORIZONTAL", gap); r.counterAxisAlignItems = "CENTER";
  return add(p, r, true);
}
function between(p, gap = 8) { const r = row(p, gap); r.primaryAxisAlignItems = "SPACE_BETWEEN"; return r; }
function center(p, node) {
  const r = stack("HORIZONTAL", 0); r.primaryAxisAlignItems = "CENTER"; r.counterAxisAlignItems = "CENTER";
  add(p, r, true); r.appendChild(node); return node;
}
function card(p, gap = 8, pad = 12) {
  const c = stack("VERTICAL", gap, pad);
  c.fills = [paint(WHITE)]; c.strokes = [paint(LINE)]; c.strokeWeight = 1; c.cornerRadius = 6;
  return add(p, c, true);
}
function note(p, s) {
  const t = txt(s, { size: 12, color: MUTED });
  t.textAutoResize = "HEIGHT";
  return add(p, t, true);
}
function field(p, value, filled = false) {
  const f = stack("VERTICAL", 0, 14);
  f.fills = [paint(WHITE)]; f.strokes = [paint(LINE_S)]; f.strokeWeight = 1; f.cornerRadius = 6;
  f.appendChild(txt(value, { size: 14, color: filled ? TEXT : MUTED }));
  return add(p, f, true);
}
function labeled(p, label, req = false) {
  const w = stack("VERTICAL", 4);
  const r = stack("HORIZONTAL", 3);
  r.appendChild(txt(label, { size: 14, bold: true, color: TEAL_D }));
  if (req) r.appendChild(txt("必須", { size: 11, bold: true, color: DANGER }));
  w.appendChild(r);
  return add(p, w, true);
}
function selectBox(p, value) {
  const f = stack("HORIZONTAL", 6, 14); f.counterAxisAlignItems = "CENTER";
  f.fills = [paint(WHITE)]; f.strokes = [paint(LINE_S)]; f.strokeWeight = 1; f.cornerRadius = 6;
  f.appendChild(txt(value, { size: 14 }));
  f.appendChild(txt("▼", { size: 9, color: MUTED }));
  p.appendChild(f); return f;
}
function pill(label, fg, bg, stroke) {
  const f = stack("HORIZONTAL", 0);
  f.paddingLeft = f.paddingRight = 8; f.paddingTop = f.paddingBottom = 2;
  f.cornerRadius = 10; f.fills = [paint(bg)];
  if (stroke) { f.strokes = [paint(stroke)]; f.strokeWeight = 1; }
  f.appendChild(txt(label, { size: 10, bold: true, color: fg }));
  return f;
}
function btn(comp, label, opts = {}) {
  const i = comp.createInstance();
  const t = i.findOne(n => n.type === "TEXT");
  if (t) t.characters = label;
  if (opts.small) {
    i.paddingTop = i.paddingBottom = 9; i.paddingLeft = i.paddingRight = 14;
    if (t) t.fontSize = 13;
  }
  return i;
}
function backLink(p, label, destId) {
  const t = txt("← " + label, { size: 13, color: LINK, underline: true });
  add(p, t);
  wires.push({ n: t, k: "back", d: destId });
  return t;
}
function listItem(p, label, destId, rightNode) {
  const r = stack("HORIZONTAL", 8, 16); r.counterAxisAlignItems = "CENTER";
  r.primaryAxisAlignItems = "SPACE_BETWEEN";
  const left = stack("HORIZONTAL", 6); left.counterAxisAlignItems = "CENTER";
  left.appendChild(txt(label, { size: 15 }));
  r.appendChild(left);
  const right = stack("HORIZONTAL", 8); right.counterAxisAlignItems = "CENTER";
  if (rightNode) right.appendChild(rightNode);
  right.appendChild(txt("＞", { size: 12, color: MUTED }));
  r.appendChild(right);
  add(p, r, true);
  if (destId) wires.push({ n: r, k: "nav", d: destId });
  return r;
}
function divider(p) {
  const d = figma.createRectangle(); d.resize(100, 1); d.fills = [paint(LINE)];
  return add(p, d, true);
}
function bigBtn(p, label, destId) {
  const f = stack("HORIZONTAL", 0, 22);
  f.primaryAxisAlignItems = "CENTER"; f.counterAxisAlignItems = "CENTER";
  f.fills = [paint(TEAL)]; f.cornerRadius = 8;
  f.appendChild(txt(label, { size: 17, bold: true, color: WHITE }));
  add(p, f, true);
  wires.push({ n: f, k: "nav", d: destId });
  return f;
}
// 余白スペーサー：以降の要素を画面下部（サムゾーン）へ押し下げる
function spacer(p) {
  const s = stack("VERTICAL", 0);
  s.name = "spacer";
  add(p, s, true);
  try { s.layoutSizingVertical = "FILL"; } catch (e) {}
  return s;
}
function gap(p, h) { // 固定ギャップ（伸縮させない）
  const g = figma.createFrame(); g.resize(10, h); g.fills = []; g.name = "gap";
  return add(p, g);
}
// 目立つ枠付きの導線ボタン（アイコン＋ラベル＋シェブロン、全幅）
function entryBtn(p, icon, label, destId, opts = {}) {
  const f = stack("HORIZONTAL", 10, 16); f.counterAxisAlignItems = "CENTER";
  f.primaryAxisAlignItems = "SPACE_BETWEEN";
  f.fills = [paint(opts.solid ? TEAL : "#EAF4EF")];
  f.strokes = [paint(TEAL)]; f.strokeWeight = 2; f.cornerRadius = 8;
  const fg = opts.solid ? WHITE : TEAL_D;
  const left = stack("HORIZONTAL", 8); left.counterAxisAlignItems = "CENTER";
  left.appendChild(txt(icon, { size: 18 }));
  left.appendChild(txt(label, { size: 15, bold: true, color: fg }));
  f.appendChild(left);
  f.appendChild(txt("＞", { size: 16, bold: true, color: fg }));
  add(p, f, true);
  wires.push({ n: f, k: "nav", d: destId });
  return f;
}
function seg(p, items, activeIdx) {
  const f = stack("HORIZONTAL", 0); f.strokes = [paint(LINE_S)]; f.strokeWeight = 1;
  f.cornerRadius = 6; f.clipsContent = true;
  add(p, f, true);
  items.forEach((label, i) => {
    const c = stack("HORIZONTAL", 0, 7);
    c.primaryAxisAlignItems = "CENTER"; c.counterAxisAlignItems = "CENTER";
    c.fills = [paint(i === activeIdx ? TEAL : WHITE)];
    c.appendChild(txt(label, { size: 11, bold: i === activeIdx, color: i === activeIdx ? WHITE : MUTED }));
    add(f, c, true);
  });
  return f;
}

// 大きな選択肢リスト（溶媒選択など・タップ領域拡大）
function optList(p, options, selIdx) {
  const c = card(p, 0, 0);
  options.forEach((label, i) => {
    if (i > 0) divider(c);
    const sel = i === selIdx;
    const r = stack("HORIZONTAL", 12, 14); r.counterAxisAlignItems = "CENTER";
    if (sel) r.fills = [paint("#eef6f2")];
    const dot = figma.createFrame(); dot.resize(20, 20); dot.cornerRadius = 10;
    dot.strokeWeight = 2; dot.strokes = [paint(sel ? TEAL : LINE_S)];
    dot.fills = sel ? [paint(TEAL)] : [paint(WHITE)];
    r.appendChild(dot);
    r.appendChild(txt(label, { size: 15, bold: sel, color: sel ? TEAL_D : TEXT }));
    add(c, r, true);
  });
  return c;
}
// 数量ステッパー（大きな − / ＋ ＋単位）
function stepper(p, value, unit) {
  const c = card(p);
  const r = stack("HORIZONTAL", 12); r.primaryAxisAlignItems = "CENTER"; r.counterAxisAlignItems = "CENTER";
  const mk = (t) => {
    const f = stack("HORIZONTAL", 0); f.resize(56, 50);
    f.primaryAxisSizingMode = "FIXED"; f.counterAxisSizingMode = "FIXED";
    f.primaryAxisAlignItems = "CENTER"; f.counterAxisAlignItems = "CENTER";
    f.cornerRadius = 10; f.fills = [paint(WHITE)]; f.strokes = [paint(TEAL)]; f.strokeWeight = 2;
    f.appendChild(txt(t, { size: 24, bold: true, color: TEAL })); return f;
  };
  r.appendChild(mk("−"));
  r.appendChild(txt(value, { size: 26, bold: true }));
  r.appendChild(mk("＋"));
  selectBox(r, unit);
  add(c, r, true);
  return c;
}
// 履歴カード（大きな 編集／取消 ボタンを縦に配置）
function logCard(p, title, sub) {
  const c = card(p, 10, 12);
  c.appendChild(txt(title, { size: 15, bold: true }));
  c.appendChild(txt(sub, { size: 12, color: MUTED }));
  const acts = row(c, 8);
  const e = btn(BtnGhost, "編集"); acts.appendChild(e);
  try { e.layoutSizingHorizontal = "FILL"; } catch (x) {}
  wires.push({ n: e, k: "nav", d: "edit" });
  const xb = btn(BtnDanger, "取消"); acts.appendChild(xb);
  try { xb.layoutSizingHorizontal = "FILL"; } catch (x) {}
  wires.push({ n: xb, k: "ov", d: "ov-cancel" });
  return c;
}

// ---------- components ----------
const HOME_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00695C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>`;

function buildButtonComponent(name, bg, fg, stroke) {
  const c = figma.createComponent();
  c.name = name;
  c.layoutMode = "HORIZONTAL";
  c.primaryAxisSizingMode = "AUTO"; c.counterAxisSizingMode = "AUTO";
  c.primaryAxisAlignItems = "CENTER"; c.counterAxisAlignItems = "CENTER";
  c.paddingLeft = c.paddingRight = 20; c.paddingTop = c.paddingBottom = 16; // タッチターゲット拡大
  c.cornerRadius = 8;
  c.fills = [paint(bg)];
  if (stroke) { c.strokes = [paint(stroke)]; c.strokeWeight = 1; }
  const t = txt("ボタン", { size: 16, bold: true, color: fg });
  t.name = "label";
  c.appendChild(t);
  return c;
}

const TABS = [
  ["home", "🏠", "ホーム"],
  ["adjust", "✏️", "登録・使用"],
  ["search", "🔍", "在庫"],
  ["graph", "📈", "グラフ"],
  ["manage", "⚙️", "管理"]
];

function buildTabbarVariant(active) {
  const c = figma.createComponent();
  c.name = "Active=" + active;
  c.layoutMode = "HORIZONTAL"; c.itemSpacing = 0;
  c.resize(PHONE_W, 64);
  c.primaryAxisSizingMode = "FIXED"; c.counterAxisSizingMode = "FIXED";
  c.fills = [paint(WHITE)];
  c.strokes = [paint(LINE_S)]; c.strokeWeight = 1;
  for (const [key, ic, label] of TABS) {
    const cell = stack("VERTICAL", 2, 6);
    cell.name = "tab-" + key;
    cell.primaryAxisAlignItems = "CENTER"; cell.counterAxisAlignItems = "CENTER";
    if (key === active) {
      const bar = figma.createRectangle();
      bar.resize(26, 3); bar.cornerRadius = 2; bar.fills = [paint(TEAL)];
      cell.appendChild(bar);
    }
    cell.appendChild(txt(ic, { size: 15 }));
    cell.appendChild(txt(label, { size: 9, bold: key === active, color: key === active ? TEAL : "#8a9a92" }));
    c.appendChild(cell);
    try { cell.layoutSizingHorizontal = "FILL"; cell.layoutSizingVertical = "FILL"; } catch (e) {}
    tabCells.push({ n: cell, d: key });
  }
  return c;
}

function buildComponents() {
  BtnPrimary = buildButtonComponent("Button/Primary", TEAL, WHITE, null);
  BtnGhost = buildButtonComponent("Button/Ghost", WHITE, TEAL, TEAL);
  BtnDanger = buildButtonComponent("Button/Danger", DANGER, WHITE, null);

  const svgNode = figma.createNodeFromSvg(HOME_SVG);
  const ic = figma.createComponent();
  ic.name = "Icon/Home";
  ic.resizeWithoutConstraints(24, 24);
  svgNode.x = 0; svgNode.y = 0;
  ic.appendChild(svgNode);
  IconHome = ic;

  const variants = TABS.map(([k]) => buildTabbarVariant(k));
  TabSet = figma.combineAsVariants(variants, figma.currentPage);
  TabSet.name = "TabBar";
}

// ---------- screen scaffold ----------
function screen(idx, id, title, opts = {}) {
  const f = figma.createFrame();
  f.name = idx + " " + (opts.label || title || id) + " (" + id + ")";
  f.resize(PHONE_W, PHONE_H);
  f.fills = [paint(MINT)];
  f.cornerRadius = 28; f.clipsContent = true;
  const cat = opts.cat;
  f.strokes = [paint(cat === "new" ? NEW : cat === "dx" ? DX : cat === "legacy" ? LEG : "#9bb8ab")];
  f.strokeWeight = 3;
  f.layoutMode = "VERTICAL"; f.itemSpacing = 0;
  f.primaryAxisSizingMode = "FIXED"; f.counterAxisSizingMode = "FIXED";

  const body = stack("VERTICAL", 16, 20);
  body.name = "body";
  f.appendChild(body);
  try { body.layoutSizingHorizontal = "FILL"; body.layoutSizingVertical = "FILL"; } catch (e) {}

  if (opts.tab) {
    const variant = TabSet.children.find(c => c.name === "Active=" + opts.tab);
    const inst = variant.createInstance();
    f.appendChild(inst);
    try { inst.layoutSizingHorizontal = "FILL"; } catch (e) {}
  }
  screens[id] = f;

  if (title) {
    const h = between(body);
    h.appendChild(txt(title, { size: 20, bold: true }));
    if (opts.homeIcon === true) {  // 右上ホームアイコンは廃止（ホームは下部タブへ集約）
      const hi = IconHome.createInstance();
      h.appendChild(hi);
      wires.push({ n: hi, k: "nav", d: "home" });
    }
  }
  return body;
}

function overlayFrame(idx, id, label) {
  const f = figma.createFrame();
  f.name = idx + " " + label + " (" + id + ")";
  f.resize(PHONE_W, PHONE_H);
  f.fills = [paint("#142820", 0.38)];
  f.cornerRadius = 28; f.clipsContent = true;
  f.strokes = [paint(DIA)]; f.strokeWeight = 3;
  f.layoutMode = "VERTICAL";
  f.primaryAxisSizingMode = "FIXED"; f.counterAxisSizingMode = "FIXED";
  f.primaryAxisAlignItems = "CENTER";
  f.paddingLeft = f.paddingRight = 20;
  const m = stack("VERTICAL", 9, 14);
  m.name = "modal";
  m.fills = [paint(WHITE)]; m.cornerRadius = 10;
  f.appendChild(m);
  try { m.layoutSizingHorizontal = "FILL"; } catch (e) {}
  overlays[id] = f;
  return m;
}

// ---------- charts ----------
const CHART = `<svg width="320" height="150" viewBox="0 0 320 150" xmlns="http://www.w3.org/2000/svg"><line x1="34" y1="10" x2="34" y2="128" stroke="#9dbfb0" stroke-width="1"/><line x1="34" y1="128" x2="310" y2="128" stroke="#9dbfb0" stroke-width="1"/><line x1="34" y1="104" x2="310" y2="104" stroke="#b45309" stroke-width="1" stroke-dasharray="4 3"/><polyline points="34,25 100,42 150,44 205,72 250,74 310,90" fill="none" stroke="#2e6b58" stroke-width="2.5"/></svg>`;
const CHART_DX = `<svg width="320" height="150" viewBox="0 0 320 150" xmlns="http://www.w3.org/2000/svg"><line x1="34" y1="10" x2="34" y2="128" stroke="#9dbfb0" stroke-width="1"/><line x1="34" y1="128" x2="310" y2="128" stroke="#9dbfb0" stroke-width="1"/><line x1="34" y1="120" x2="310" y2="120" stroke="#c0392b" stroke-width="1" stroke-dasharray="4 3"/><polyline points="34,25 100,42 150,44 205,72 250,74" fill="none" stroke="#2e6b58" stroke-width="2.5"/><polyline points="250,74 306,120" fill="none" stroke="#7c3aed" stroke-width="2.5" stroke-dasharray="5 3"/><circle cx="250" cy="74" r="3" fill="#7c3aed"/></svg>`;

// ---------- screens ----------
function buildScreens() {
  // 01 login
  {
    const b = screen("01", "login", null, { label: "ログイン", homeIcon: false });
    center(b, txt("ChemStock", { size: 26, bold: true, color: TEAL_D }));
    center(b, txt("研究室単位の共有アカウントでログイン", { size: 11, color: MUTED }));
    labeled(b, "研究室 / 管理者");
    const s = selectBox(b, "溶媒庫管理者"); try { s.layoutSizingHorizontal = "FILL"; } catch (e) {}
    labeled(b, "パスワード");
    field(b, "••••••••", true);
    spacer(b);
    const lg = btn(BtnPrimary, "ログイン");
    add(b, lg, true);
    wires.push({ n: lg, k: "nav", d: "home" });
    note(b, "※個人ログインではない。操作者名は各操作時に手入力。");
  }

  // 02 home
  {
    const b = screen("02", "home", null, { label: "ホーム", tab: "home" });
    const h = between(b);
    h.appendChild(txt("ホーム", { size: 18, bold: true }));
    const lo = txt("ログアウト ⇥", { size: 11, color: LINK, underline: true });
    h.appendChild(lo);
    wires.push({ n: lo, k: "back", d: "login" });

    const bn = card(b, 4, 10);
    bn.fills = [paint(WARN_BG)]; bn.strokes = [paint("#f0c98d")];
    bn.appendChild(txt("⚠ 残量・欠品の見通し（自研究室）", { size: 12, bold: true, color: WARN }));
    const r1 = between(bn); r1.appendChild(txt("アセトン：11/18頃 下限割れ予測", { size: 12 })); r1.appendChild(txt("＞", { size: 12, color: MUTED }));
    wires.push({ n: r1, k: "nav", d: "detail" });
    const r2 = between(bn); r2.appendChild(txt("トルエン：下限割れ中（1.5 L）", { size: 12 })); r2.appendChild(txt("＞", { size: 12, color: MUTED }));
    wires.push({ n: r2, k: "nav", d: "detail" });
    note(bn, "※画面表示のみ。通知・メールは発行しない（要件§2.1）");

    gap(b, 140); // バナーとボタン群の間隔：ボタン群が画面の約4割の高さ（中央やや上）に来る
    bigBtn(b, "溶媒の登録・使用", "adjust");
    gap(b, 8); // ボタン間隔を拡大
    bigBtn(b, "溶媒の在庫閲覧", "search");
    spacer(b);
    note(b, "※既存2カードは変更なし。バナー行タップで詳細情報へ。");
  }

  // 03 adjust
  {
    const b = screen("03", "adjust", "残量調整", { tab: "adjust" });
    entryBtn(b, "🕘", "入出庫履歴を見る", "history");
    const c1 = card(b);
    c1.appendChild(txt("研究室：山田研", { size: 14, bold: true }));
    c1.appendChild(txt("ログインアカウントから自動判定（選択不要）", { size: 12, color: MUTED }));
    labeled(b, "溶媒を選択");
    optList(b, ["メタノール", "エタノール", "アセトン"], 0);
    spacer(b);
    const go = add(b, btn(BtnPrimary, "確認画面"), true);
    wires.push({ n: go, k: "nav", d: "actionInput" });
  }

  // 04 actionInput
  {
    const b = screen("04", "actionInput", "数量入力", { tab: "adjust" });
    backLink(b, "残量調整に戻る", "adjust");
    const c = card(b); c.appendChild(txt("対象：山田研／メタノール", { size: 12, bold: true }));
    labeled(b, "区分");
    seg(b, ["追加する", "使用する"], 0);
    labeled(b, "数量");
    stepper(b, "3.5", "L");
    note(b, "※単位は L／ガロン／斗缶 から選択。記録は基準単位に換算して保存。");
    labeled(b, "使用者名", true);
    field(b, "氏名を入力（過去入力をサジェスト）");
    spacer(b);
    const go = add(b, btn(BtnPrimary, "確認へ"), true);
    wires.push({ n: go, k: "nav", d: "actionConfirm" });
  }

  // 05 actionConfirm
  {
    const b = screen("05", "actionConfirm", "確認", { tab: "adjust" });
    const c = card(b, 8);
    c.appendChild(txt("研究室：山田研", { size: 12 }));
    c.appendChild(txt("溶媒：メタノール", { size: 12 }));
    c.appendChild(txt("区分：追加", { size: 12 }));
    c.appendChild(txt("変量：＋3.5 L", { size: 12, bold: true }));
    c.appendChild(txt("使用者：学生A", { size: 12 }));
    note(b, "この内容で在庫を更新します。よろしいですか？");
    spacer(b);
    const foot = row(b, 10);
    const fix = btn(BtnGhost, "修正する"); foot.appendChild(fix);
    try { fix.layoutSizingHorizontal = "FILL"; } catch (e) {}
    wires.push({ n: fix, k: "back", d: "actionInput" });
    const go = btn(BtnPrimary, "実行する"); foot.appendChild(go);
    try { go.layoutSizingHorizontal = "FILL"; } catch (e) {}
    wires.push({ n: go, k: "nav", d: "complete" });
  }

  // 06 complete
  {
    const b = screen("06", "complete", "完了", { tab: "adjust" });
    center(b, txt("✓", { size: 44, bold: true, color: TEAL }));
    center(b, txt("登録しました", { size: 15, bold: true }));
    const c = card(b);
    c.primaryAxisAlignItems = "CENTER";
    c.appendChild(txt("山田研／メタノール　＋3.5 L（現在 36.0 L）", { size: 12 }));
    spacer(b);
    const b1 = btn(BtnPrimary, "ホームに戻る"); add(b, b1, true);
    wires.push({ n: b1, k: "nav", d: "home" });
    const b2 = btn(BtnGhost, "続けて操作する"); add(b, b2, true);
    wires.push({ n: b2, k: "back", d: "adjust" });
  }

  // 07 history (new)
  {
    const b = screen("07", "history", "入出庫履歴", { tab: "adjust", cat: "new" });
    backLink(b, "残量調整に戻る", "adjust");
    const fr = row(b, 8);
    selectBox(fr, "溶媒：すべて");
    logCard(b, "10/9　メタノール　＋3.0 L", "使用者：学生A");
    logCard(b, "10/7　アセトン　−1.0 L", "使用者：学生B");
    logCard(b, "10/5　エタノール　−2.0 L", "使用者：学生A");
    note(b, "※自研究室の履歴のみ表示（管理者は全研究室）。各行の「編集／取消」から実操作者名・理由を入力。");
  }

  // 08 edit (new)
  {
    const b = screen("08", "edit", "記録の編集", { tab: "adjust", cat: "new" });
    backLink(b, "入出庫履歴に戻る", "history");
    const c = card(b); c.appendChild(txt("対象：10/9　メタノール　＋3.0 L（学生A）", { size: 12, bold: true }));
    labeled(b, "変量");
    stepper(b, "3.0", "L");
    labeled(b, "実操作者名", true); field(b, "氏名を入力");
    labeled(b, "変更理由", true); field(b, "例）数量の入力誤り訂正");
    spacer(b);
    const go = add(b, btn(BtnPrimary, "確認して保存"), true);
    wires.push({ n: go, k: "nav", d: "recalc" });
  }

  // 09 recalc (new)
  {
    const b = screen("09", "recalc", "反映しました", { tab: "adjust", cat: "new" });
    center(b, txt("✓", { size: 44, bold: true, color: TEAL }));
    center(b, txt("取消／編集を反映しました", { size: 14, bold: true }));
    const c = card(b, 6);
    c.appendChild(txt("在庫を再計算：アセトン +1.0 L", { size: 12, bold: true }));
    c.appendChild(txt("inventory_logs.status = 取消", { size: 11, color: MUTED }));
    c.appendChild(txt("operation_audits に before/after＋理由を記録", { size: 11, color: MUTED }));
    note(b, "※共有アカウントのため実操作者名は手入力必須。監査ログは物理削除しない。");
    spacer(b);
    const b1 = btn(BtnGhost, "入出庫履歴に戻る"); add(b, b1, true);
    wires.push({ n: b1, k: "back", d: "history" });
  }

  // 10 search
  {
    const b = screen("10", "search", "在庫検索", { tab: "search" });
    const c0 = card(b);
    c0.appendChild(txt("研究室：山田研", { size: 14, bold: true }));
    c0.appendChild(txt("ログインアカウントから自動。管理者は全研究室を選択可", { size: 12, color: MUTED }));
    labeled(b, "溶媒で絞り込み");
    const s2 = selectBox(b, "すべての溶媒"); try { s2.layoutSizingHorizontal = "FILL"; } catch (e) {}
    const leg = txt("（レガシー）部屋別在庫を開く", { size: 10, color: MUTED, underline: true });
    add(b, leg);
    wires.push({ n: leg, k: "nav", d: "roomid" });
    spacer(b);
    const go = add(b, btn(BtnPrimary, "在庫状況を表示"), true);
    wires.push({ n: go, k: "nav", d: "list" });
  }

  // 11 list
  {
    const b = screen("11", "list", "在庫一覧", { tab: "search" });
    backLink(b, "在庫検索に戻る", "search");
    const c = card(b, 0, 0);
    let firstRow = true;
    const mkRow = (label, amount, warnRow) => {
      if (!firstRow) divider(c);
      firstRow = false;
      const r = stack("HORIZONTAL", 8, 14);
      r.counterAxisAlignItems = "CENTER"; r.primaryAxisAlignItems = "SPACE_BETWEEN";
      if (warnRow) r.fills = [paint("#fff6ec")];
      r.appendChild(txt(label, { size: 15 }));
      const right = stack("HORIZONTAL", 8); right.counterAxisAlignItems = "CENTER";
      if (warnRow) right.appendChild(pill("下限割れ", WARN, "#fff3e0", "#f0c98d"));
      right.appendChild(txt(amount, { size: 15, bold: warnRow, color: warnRow ? WARN : TEXT }));
      right.appendChild(txt("＞", { size: 15, color: MUTED }));
      r.appendChild(right);
      add(c, r, true);
      wires.push({ n: r, k: "nav", d: "detail" });
    };
    mkRow("メタノール", "36.0 L", false);
    mkRow("アセトン", "2.0 L", true);
    mkRow("エタノール", "18.5 L", false);
    mkRow("トルエン", "1.5 L", true);
    note(b, "※自研究室の在庫のみ表示（管理者は全研究室）。行タップで詳細情報へ。⚠ は下限割れ。");
  }

  // 12 detail
  {
    const b = screen("12", "detail", "詳細情報", { tab: "search" });
    backLink(b, "在庫一覧に戻る", "list");
    center(b, txt("山田研　メタノール", { size: 14, bold: true }));
    const c = card(b, 8);
    c.appendChild(txt("CAS番号：67-56-1", { size: 12 }));
    c.appendChild(txt("分子式：CH₃OH", { size: 12 }));
    const lc = card(b, 10, 12);
    const lr = between(lc);
    const lt = stack("HORIZONTAL", 6); lt.counterAxisAlignItems = "CENTER";
    lt.appendChild(txt("下限値", { size: 15, bold: true }));
    lt.appendChild(pill("★新規", NEW, "#fff3e0", NEW));
    lr.appendChild(lt);
    lr.appendChild(txt("5.0 L", { size: 15, bold: true }));
    const g = btn(BtnGhost, "⚙ 下限値を変更"); add(lc, g, true);
    wires.push({ n: g, k: "ov", d: "ov-lowset" });
    const h = card(b, 6);
    h.appendChild(txt("10/9　＋3.0 L　学生A", { size: 11, color: MUTED }));
    h.appendChild(txt("10/7　−3.0 L　学生B", { size: 11, color: MUTED }));
    note(b, "※「⚙ 変更」は下限値ダイアログ（画面遷移なし）。");
  }

  // 13 roomid (legacy)
  {
    const b = screen("13", "roomid", "部屋別在庫", { tab: "search", cat: "legacy" });
    backLink(b, "在庫検索に戻る", "search");
    const c0 = card(b);
    c0.appendChild(txt("※本線からのリンクなし。直接URL用の旧画面（レガシー）。", { size: 10, color: MUTED }));
    const c = card(b, 6);
    c.appendChild(txt("メタノール　36.0 L", { size: 12 }));
    c.appendChild(txt("アセトン　　2.0 L", { size: 12 }));
  }

  // 14 graph (new)
  {
    const b = screen("14", "graph", "残量推移グラフ", { tab: "graph", cat: "new" });
    const fr = row(b, 8);
    selectBox(fr, "メタノール"); selectBox(fr, "1ヶ月");
    const c = card(b);
    c.appendChild(figma.createNodeFromSvg(CHART));
    note(c, "橙破線＝下限 5.0 L");
    const c2 = card(b);
    c2.primaryAxisAlignItems = "CENTER";
    c2.appendChild(txt("現在残量 32.5 L　／　下限 5.0 L", { size: 13, bold: true }));
    spacer(b);
    const go = add(b, btn(BtnGhost, "欠品予測を表示 ▸"), true);
    wires.push({ n: go, k: "nav", d: "forecast" });
  }

  // 15 forecast (dx)
  {
    const b = screen("15", "forecast", "残量推移＋予測", { tab: "graph", cat: "dx" });
    backLink(b, "グラフに戻る", "graph");
    const fr = row(b, 8);
    selectBox(fr, "メタノール");
    fr.appendChild(pill("欠品予測 ON", DX, "#ede7f6", DX));
    const c = card(b);
    c.appendChild(figma.createNodeFromSvg(CHART_DX));
    note(c, "紫破線＝予測、赤破線＝欠品ライン");
    const c2 = card(b);
    c2.primaryAxisAlignItems = "CENTER";
    c2.appendChild(txt("予測欠品日 11/18頃", { size: 14, bold: true, color: DX }));
    c2.appendChild(txt("直近30日の使用ペースから外挿", { size: 10, color: MUTED }));
    note(b, "※DXコア機能。");
  }

  // 16 manage (new)
  {
    const b = screen("16", "manage", "管理", { tab: "manage", cat: "new" });
    const c = card(b, 0, 0);
    listItem(c, "🧪 溶媒種類管理", "types");
    divider(c);
    listItem(c, "🛡 管理者画面（管理者のみ）", "admin", pill("未確認 2", WARN, "#fff3e0", "#f0c98d"));
    note(b, "※研究室ユーザーには「溶媒種類管理」のみ表示。バッジ＝指定数量通知の未確認件数（F1-9）。");
  }

  // 17 types (new)
  {
    const b = screen("17", "types", "溶媒種類管理", { tab: "manage", cat: "new" });
    backLink(b, "管理に戻る", "manage");
    const c = card(b, 0, 0);
    let firstT = true;
    const mk = (name, cas) => {
      if (!firstT) divider(c);
      firstT = false;
      const r = stack("HORIZONTAL", 8, 14); r.counterAxisAlignItems = "CENTER";
      r.primaryAxisAlignItems = "SPACE_BETWEEN";
      const info = stack("VERTICAL", 2);
      info.appendChild(txt(name, { size: 15 }));
      info.appendChild(txt("CAS " + cas, { size: 12, color: MUTED }));
      r.appendChild(info);
      const s = btn(BtnGhost, "利用停止", { small: true });
      r.appendChild(s);
      add(c, r, true);
      wires.push({ n: s, k: "ov", d: "ov-stop" });
    };
    mk("メタノール", "67-56-1");
    mk("エタノール", "64-17-5");
    mk("アセトン", "67-64-1");
    note(b, "※追加は既存フォーム同形式→確認→完了。利用停止は確認ダイアログ。");
    spacer(b);
    const addBtn = add(b, btn(BtnPrimary, "＋ 溶媒を追加"), true);
    wires.push({ n: addBtn, k: "nav", d: "typeAdd" });
  }

  // 18 typeAdd (new)
  {
    const b = screen("18", "typeAdd", "溶媒を追加", { tab: "manage", cat: "new" });
    backLink(b, "溶媒種類管理に戻る", "types");
    labeled(b, "溶媒名", true); field(b, "例）ヘキサン");
    labeled(b, "CAS番号", true); field(b, "例）110-54-3");
    const c = card(b);
    c.appendChild(txt("▽ 任意項目（分子式・分子量・指定数量）を開く", { size: 11, color: MUTED }));
    note(b, "※必須のみ表示・任意は折りたたみ。登録で一覧へ戻る。");
    spacer(b);
    const go = add(b, btn(BtnPrimary, "確認して登録"), true);
    wires.push({ n: go, k: "back", d: "types" });
  }

  // 19 admin (new)
  {
    const b = screen("19", "admin", "管理者画面", { tab: "manage", cat: "new" });
    backLink(b, "管理に戻る", "manage");
    const c = card(b, 0, 0);
    listItem(c, "🔔 通知一覧", "notif", pill("未確認 2", WARN, "#fff3e0", "#f0c98d"));
    divider(c);
    listItem(c, "📊 利用履歴分析", "analysis");
    divider(c);
    listItem(c, "🧪 溶媒マスタ管理", "master");
    divider(c);
    listItem(c, "⚙️ 各種設定", "settings");
    note(b, "※表示スコープ＝溶媒庫管理は自分の溶媒庫のみ／全体管理者は全溶媒庫（F1-8）。");
  }

  // 20 notif (new)
  {
    const b = screen("20", "notif", "通知一覧", { tab: "manage", cat: "new" });
    backLink(b, "管理者画面に戻る", "admin");
    seg(b, ["未確認 2", "確認済", "対応済"], 0);
    const c = card(b, 0, 0);
    const r1 = between(c); r1.paddingTop = r1.paddingBottom = 10; r1.paddingLeft = r1.paddingRight = 10;
    r1.appendChild(txt("⚠ 溶媒庫 指定数量接近（0.85倍）", { size: 12 }));
    r1.appendChild(pill("指定数量", DX, "#ede7f6", DX));
    wires.push({ n: r1, k: "nav", d: "dq" });
    divider(c);
    const r2 = between(c); r2.paddingTop = r2.paddingBottom = 10; r2.paddingLeft = r2.paddingRight = 10;
    r2.appendChild(txt("⚠ 溶媒庫 指定数量超過（1.02倍）", { size: 12 }));
    r2.appendChild(pill("指定数量", DX, "#ede7f6", DX));
    wires.push({ n: r2, k: "nav", d: "dq" });
    note(b, "※指定数量専用（在庫下限の通知は持たない：要件§2.1）。行タップでモニターへ。");
  }

  // 21 analysis (new)
  {
    const b = screen("21", "analysis", "利用履歴分析", { tab: "manage", cat: "new" });
    backLink(b, "管理者画面に戻る", "admin");
    selectBox(b, "期間：3ヶ月");
    const c = card(b, 6);
    c.appendChild(txt("使用量ランキング", { size: 12, bold: true, color: TEAL_D }));
    c.appendChild(txt("1. アセトン　　24.0 L", { size: 12 }));
    c.appendChild(txt("2. メタノール　18.5 L", { size: 12 }));
    c.appendChild(txt("3. エタノール　12.0 L", { size: 12 }));
    note(b, "※溶媒別・研究室別の使用傾向を集計。");
  }

  // 22 master (new)
  {
    const b = screen("22", "master", "溶媒マスタ管理", { tab: "manage", cat: "new" });
    backLink(b, "管理者画面に戻る", "admin");
    const c = card(b, 8);
    c.appendChild(txt("メタノール　指定数量 400 L　✎", { size: 12 }));
    c.appendChild(txt("アセトン　　指定数量 400 L　✎", { size: 12 }));
    c.appendChild(txt("トルエン　　指定数量 200 L　✎", { size: 12 }));
    note(b, "※全体共通マスタ。指定数量は法令値（DBに保持しハードコードしない）。編集は監査記録。");
  }

  // 23 settings (new)
  {
    const b = screen("23", "settings", "各種設定", { tab: "manage", cat: "new" });
    backLink(b, "管理者画面に戻る", "admin");
    const c = card(b, 0, 0);
    listItem(c, "単位設定（L / ガロン / 斗缶）");
    divider(c);
    listItem(c, "通知先メール");
    divider(c);
    listItem(c, "警告比率 warning_ratio（0.8）");
    divider(c);
    listItem(c, "指定数量モニター", "dq", pill("DXコア", DX, "#ede7f6", DX));
    note(b, "※warning_ratio は独自の早期警告閾値（法令基準ではない）。変更は監査記録（operation_audits）。");
  }

  // 24 dq (dx)
  {
    const b = screen("24", "dq", "指定数量モニター", { tab: "manage", cat: "dx" });
    backLink(b, "各種設定に戻る", "settings");
    const c = card(b, 8);
    c.primaryAxisAlignItems = "CENTER";
    c.appendChild(txt("溶媒庫 合算倍率", { size: 12, bold: true, color: TEAL_D }));
    c.appendChild(txt("0.85 倍", { size: 28, bold: true, color: DX }));
    const track = figma.createFrame();
    track.resize(300, 10); track.cornerRadius = 5; track.fills = [paint("#eceff1")]; track.clipsContent = true;
    const barFill = figma.createRectangle();
    barFill.resize(255, 10); barFill.fills = [paint(DX)];
    track.appendChild(barFill);
    c.appendChild(track);
    c.appendChild(txt("warning_ratio 0.8 超過 → 警告", { size: 10, color: MUTED }));
    const c2 = card(b);
    c2.appendChild(txt("Σ(amount ÷ designated_quantity)＝溶媒庫全体（全研究室）を合算", { size: 11, color: MUTED }));
    note(b, "※DXコア。溶媒庫管理・全体管理者のみ。研究室ユーザーには非表示。");
  }

  // D1 ov-cancel
  {
    const m = overlayFrame("D1", "ov-cancel", "取消確認ダイアログ");
    m.appendChild(txt("この記録を取り消しますか？", { size: 14, bold: true, color: DANGER }));
    const tg = card(m);
    tg.appendChild(txt("10/7　アセトン　−1.0 L", { size: 12, bold: true }));
    tg.appendChild(txt("使用者：学生B ／ 山田研", { size: 11, color: MUTED }));
    labeled(m, "実操作者名", true); field(m, "氏名を入力");
    labeled(m, "取消理由", true); field(m, "例）入力ミスのため");
    note(m, "※物理削除しない。status=取消＋在庫再計算＋operation_audits。");
    const ar = row(m, 8);
    const cancel = btn(BtnGhost, "キャンセル"); add(ar, cancel, true);
    wires.push({ n: cancel, k: "close" });
    const ok = btn(BtnDanger, "取り消す"); add(ar, ok, true);
    wires.push({ n: ok, k: "nav", d: "recalc" });
  }

  // D2 ov-lowset
  {
    const m = overlayFrame("D2", "ov-lowset", "下限値変更ダイアログ");
    m.appendChild(txt("在庫下限値を変更", { size: 14, bold: true, color: TEAL_D }));
    const tg = card(m);
    tg.appendChild(txt("メタノール（山田研）", { size: 12, bold: true }));
    tg.appendChild(txt("現在の下限：5.0 L", { size: 11, color: MUTED }));
    labeled(m, "新しい下限値", true); field(m, "8.0 L", true);
    note(m, "※low_stock_threshold を更新し監査記録。");
    const ar = row(m, 8);
    const cancel = btn(BtnGhost, "キャンセル"); add(ar, cancel, true);
    wires.push({ n: cancel, k: "close" });
    const ok = btn(BtnPrimary, "保存"); add(ar, ok, true);
    wires.push({ n: ok, k: "close" });
  }

  // D3 ov-stop
  {
    const m = overlayFrame("D3", "ov-stop", "利用停止確認ダイアログ");
    m.appendChild(txt("この溶媒を利用停止しますか？", { size: 14, bold: true, color: DANGER }));
    const tg = card(m);
    tg.appendChild(txt("アセトン（CAS 67-64-1）", { size: 12, bold: true }));
    labeled(m, "停止理由", true); field(m, "例）取扱い中止のため");
    note(m, "※物理削除しない。is_active=false＋operation_audits。在庫履歴は保持。");
    const ar = row(m, 8);
    const cancel = btn(BtnGhost, "キャンセル"); add(ar, cancel, true);
    wires.push({ n: cancel, k: "close" });
    const ok = btn(BtnDanger, "利用停止"); add(ar, ok, true);
    wires.push({ n: ok, k: "close" });
  }
}

// ---------- sections / layout ----------
function makeSection(name, tint, items, cols) {
  const s = figma.createSection();
  s.name = name;
  s.fills = [paint(tint)];
  const rows = Math.ceil(items.length / cols);
  items.forEach((f, i) => {
    s.appendChild(f);
    f.x = 60 + (i % cols) * 440;
    f.y = 90 + Math.floor(i / cols) * 950;
  });
  s.resizeWithoutConstraints(60 + Math.min(items.length, cols) * 440 + 20, 90 + rows * 950 + 30);
  return s;
}

function layoutSections() {
  const S = screens, O = overlays;
  let y = 0;
  const gap = 120;
  const secs = [];

  // components section (manual layout)
  const cs = figma.createSection();
  cs.name = "🧩 Components（" + VERSION + "）";
  cs.fills = [paint("#eef2f0")];
  cs.appendChild(TabSet); TabSet.x = 60; TabSet.y = 90;
  let cx = 60;
  const compY = 90 + TabSet.height + 50;
  for (const c of [BtnPrimary, BtnGhost, BtnDanger, IconHome]) {
    cs.appendChild(c); c.x = cx; c.y = compY; cx += c.width + 40;
  }
  cs.resizeWithoutConstraints(Math.max(60 + TabSet.width + 60, cx + 60), compY + 80);
  cs.x = 0; cs.y = y; y += cs.height + gap; secs.push(cs);

  const defs = [
    ["① 入口（ログイン→ホーム）", "#eaf4ee", [S.login, S.home], 6],
    ["② 登録・使用（入出庫→履歴→取消/編集）", "#eaf4ee", [S.adjust, S.actionInput, S.actionConfirm, S.complete, S.history, O["ov-cancel"], S.edit, S.recalc], 8],
    ["③ 在庫閲覧（検索→一覧→詳細＋下限設定）", "#eaf4ee", [S.search, S.list, S.detail, O["ov-lowset"], S.roomid], 6],
    ["④ グラフ（残量推移→欠品予測）", "#fdf6ec", [S.graph, S.forecast], 6],
    ["⑤ 管理（メニュー→種類管理/管理者画面）", "#fdf6ec", [S.manage, S.types, S.typeAdd, O["ov-stop"], S.admin, S.notif, S.analysis, S.master, S.settings, S.dq], 5]
  ];
  for (const [name, tint, items, cols] of defs) {
    const s = makeSection(name, tint, items, cols);
    s.x = 0; s.y = y; y += s.height + gap;
    secs.push(s);
  }
  return secs;
}

// ---------- prototype wiring ----------
function actionFor(w) {
  if (w.k === "close") return { type: "CLOSE" };
  if (w.k === "ov") {
    return {
      type: "NODE", destinationId: overlays[w.d].id, navigation: "OVERLAY",
      transition: { type: "DISSOLVE", easing: { type: "EASE_OUT" }, duration: 0.2 },
      preserveScrollPosition: false
    };
  }
  return {
    type: "NODE", destinationId: screens[w.d].id, navigation: "NAVIGATE",
    transition: { type: "MOVE_IN", direction: w.k === "back" ? "RIGHT" : "LEFT", matchLayers: false, easing: { type: "EASE_OUT" }, duration: 0.25 },
    preserveScrollPosition: false
  };
}

async function applyWires() {
  let n = 0;
  for (const w of wires) {
    try {
      await w.n.setReactionsAsync([{ trigger: { type: "ON_CLICK" }, actions: [actionFor(w)] }]);
      n++;
    } catch (e) { console.error("wire failed", w.d, e); }
  }
  // タブはメインコンポーネント側に設定 → 全インスタンスに継承
  for (const c of tabCells) {
    try {
      await c.n.setReactionsAsync([{
        trigger: { type: "ON_CLICK" },
        actions: [{
          type: "NODE", destinationId: screens[c.d].id, navigation: "NAVIGATE",
          transition: { type: "DISSOLVE", easing: { type: "EASE_OUT" }, duration: 0.15 },
          preserveScrollPosition: false
        }]
      }]);
      n++;
    } catch (e) { console.error("tab wire failed", c.d, e); }
  }
  return n;
}

// ---------- main ----------
async function main() {
  try {
    await figma.loadFontAsync(F_REG);
    await figma.loadFontAsync(F_BOLD);
  } catch (e) {
    F_REG = { family: "Inter", style: "Regular" };
    F_BOLD = { family: "Inter", style: "Bold" };
    await figma.loadFontAsync(F_REG);
    await figma.loadFontAsync(F_BOLD);
  }

  buildComponents();
  buildScreens();
  const secs = layoutSections();
  const wired = await applyWires();

  figma.currentPage.flowStartingPoints = [{ nodeId: screens.login.id, name: "ChemStock 画面遷移" }];
  figma.viewport.scrollAndZoomIntoView(secs);
  figma.closePlugin(`【${VERSION}】生成完了：画面24＋ダイアログ3、遷移 ${wired} 本を配線しました。▶ Present で操作できます`);
}

main();
