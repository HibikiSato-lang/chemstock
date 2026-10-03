"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, BarChart3, Beaker, Bell, Check, ChevronRight, FlaskConical, Home, LogOut, Plus, Search, Settings, Shield, SlidersHorizontal } from "lucide-react";
import { signOutAction } from "@/app/actions";
import { useChemstock } from "@/components/chemstock-provider";
import { StockTrend } from "@/components/stock-trend";
import { DataSet, DemoAudit, Forecast, formatAmount, formatDate, movementAmount, previewForecast, Role, Stock, StockLog, toLitres } from "@/lib/chemstock-ui";
import "@/app/chemstock.css";

type Draft = { roomId: string; solventId: string; amount: string; unit: string; type: "add" | "use"; operator: string; purpose: string; occurredAt: string };
type EditLogChange = { change: number; operator: string; occurredAt: string; changedByName: string; reason: string };
const emptyDraft: Draft = { roomId: "", solventId: "", amount: "", unit: "L", type: "add", operator: "", purpose: "", occurredAt: "" };
const DRAFT_KEY = "chemstock-adjust-draft";
const adminRoles: Role[] = ["solvent_room_admin", "global_admin"];
const forecastLabel = (value: string) => `${new Date(value).toLocaleDateString("ja-JP", { year: "numeric", month: "numeric", day: "numeric" })}頃に下限到達の見込み`;

function demoLogAudit(data: DataSet, beforeLog: StockLog, afterLog: StockLog, beforeAmount: number, afterAmount: number, action: "cancel" | "correct", operatorName: string, reason: string): DemoAudit {
  return {
    id: crypto.randomUUID(),
    account_id: data.account.id,
    target_type: "log",
    target_id: beforeLog.id,
    action,
    operator_name: operatorName,
    reason,
    before_value: { log: beforeLog, inventory_amount: beforeAmount },
    after_value: { log: afterLog, inventory_amount: afterAmount },
    created_at: new Date().toISOString(),
  };
}

function demoInventoryAudit(data: DataSet, beforeStock: Stock, afterStock: Stock, action: "threshold" | "deactivate", operatorName: string, reason: string): DemoAudit {
  return {
    id: crypto.randomUUID(), account_id: data.account.id,
    target_type: "inventory", target_id: beforeStock.id, action,
    operator_name: operatorName, reason,
    before_value: { inventory: beforeStock }, after_value: { inventory: afterStock },
    created_at: new Date().toISOString(),
  };
}

function pathFor(pathname: string) {
  const path = pathname.startsWith("/preview") ? pathname.slice(8) || "/protected" : pathname;
  return path === "/home" ? "/protected" : path;
}

export function ChemstockApp() {
  const pathname = usePathname();
  const router = useRouter();
  const path = pathFor(pathname);
  const ctx = useChemstock();
  const { data, preview, selectedRoomId, href, mutateDemo } = ctx;
  const [draft, setDraft] = useState<Draft>(() => {
    if (typeof window === "undefined") return emptyDraft;
    try { return { ...emptyDraft, ...(JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null") || {}) }; } catch { return emptyDraft; }
  });
  const [message, setMessage] = useState("");
  const [modal, setModal] = useState<"" | "cancel" | "threshold" | "deactivate">("");
  const [targetId, setTargetId] = useState("");
  const [operator, setOperator] = useState("");
  const [reason, setReason] = useState("");
  const [threshold, setThreshold] = useState("");
  const [query, setQuery] = useState(() => typeof window === "undefined" ? "" : sessionStorage.getItem("chemstock-search-query") || "");
  const [searchBy, setSearchBy] = useState(() => typeof window === "undefined" ? "name" : sessionStorage.getItem("chemstock-search-by") || "name");
  const [filterSolvent, setFilterSolvent] = useState("");
  const [period, setPeriod] = useState(() => typeof window === "undefined" ? "30" : sessionStorage.getItem("chemstock-graph-period") || "30");
  const [graphSolventId, setGraphSolventId] = useState(() => typeof window === "undefined" ? "" : sessionStorage.getItem("chemstock-graph-solvent") || "");
  const [newSolvent, setNewSolvent] = useState({ name: "", cas_number: "", formula: "", molecular_weight: "" });
  const [pageSize, setPageSize] = useState(20);
  const [saving, setSaving] = useState(false);
  const sending = useRef(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const previousIdentity = useRef<string | null>(null);

  useEffect(() => { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); }, [draft]);
  useEffect(() => { sessionStorage.setItem("chemstock-search-query", query); }, [query]);
  useEffect(() => { sessionStorage.setItem("chemstock-search-by", searchBy); }, [searchBy]);
  useEffect(() => { sessionStorage.setItem("chemstock-graph-period", period); }, [period]);
  useEffect(() => { sessionStorage.setItem("chemstock-graph-solvent", graphSolventId); }, [graphSolventId]);
  useEffect(() => { if (path === "/inventory/action/use" || path === "/inventory/action/use/confirm") setDraft((current) => ({ ...current, type: "use" })); }, [path]);
  useEffect(() => { setMessage(""); setModal(""); }, [pathname]);
  useEffect(() => {
    if (!data) return;
    const identity = `${data.account.id}:${data.account.role}`;
    if (previousIdentity.current && previousIdentity.current !== identity) setDraft((current) => ({ ...current, operator: "" }));
    previousIdentity.current = identity;
  }, [data]);
  useEffect(() => {
    if (!modal) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = modalRef.current;
    dialog?.querySelector<HTMLElement>("input, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setModal(""); return; }
      if (event.key !== "Tab" || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)"));
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); returnFocus.current?.focus(); };
  }, [modal]);

  const executeLive = async (operation: "movement" | "cancel" | "correct" | "threshold" | "deactivate", targetId: string, payload: Record<string, unknown>, onSuccess: () => void, failureMessage: string) => {
    if (sending.current) return;
    sending.current = true;
    setSaving(true);
    try {
      await ctx.runCommand(operation, targetId, payload);
      onSuccess();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : failureMessage);
    } finally {
      sending.current = false;
      setSaving(false);
    }
  };

  const room = data?.rooms.find((item) => item.id === selectedRoomId);
  const scopedStocks = useMemo(() => data?.stocks.filter((stock) => stock.room_id === selectedRoomId) || [], [data, selectedRoomId]);
  const scopedLogs = useMemo(() => data?.logs.filter((log) => scopedStocks.some((stock) => stock.id === log.inventory_id)) || [], [data, scopedStocks]);
  const inventoryFor = (log: StockLog) => data?.stocks.find((stock) => stock.id === log.inventory_id);
  const solventFor = (stock?: Stock) => data?.solvents.find((solvent) => solvent.id === stock?.solvent_id);
  const stockFor = (id: string) => data?.stocks.find((stock) => stock.id === id && (data.account.role === "global_admin" || stock.room_id === data.account.room_id));
  const go = (path: string) => router.push(href(path));
  const updateDraft = (part: Partial<Draft>) => setDraft((current) => ({ ...current, ...part }));
  const canAdmin = data ? adminRoles.includes(data.account.role) : false;

  const nav = [
    { path: "/protected", title: "ホーム", icon: Home },
    { path: "/inventory/adjust", title: "登録・使用", icon: Plus },
    { path: "/inventory", title: "在庫", icon: Search },
    { path: "/graph", title: "グラフ", icon: BarChart3 },
    { path: "/manage", title: "管理", icon: Settings },
  ];
  const active = path === "/inventory/adjust" || path.startsWith("/inventory/action") || path.startsWith("/inventory/history") || path === "/inventory/complete" ? "/inventory/adjust" : path.startsWith("/inventory") ? "/inventory" : path.startsWith("/graph") ? "/graph" : path.startsWith("/manage") ? "/manage" : "/protected";

  const header = (title: string, back?: string, action?: React.ReactNode) => <>
    <header className="cs-header"><div className="cs-header-row"><h1>{title}</h1><div className="cs-header-actions">{action}{path !== "/protected" && <Link href={href("/protected")} aria-label="ホームへ"><Home size={21} /></Link>}</div></div></header>
    {back && <Link className="cs-back" href={href(back)}><ArrowLeft size={16} />戻る</Link>}
  </>;
  const card = (children: React.ReactNode, className = "") => <div className={`cs-card ${className}`}>{children}</div>;
  const button = (label: string, onClick: () => void, secondary = false, disabled = false) => <button type="button" className={`cs-button ${secondary ? "cs-secondary" : ""}`} onClick={onClick} disabled={disabled}>{label}</button>;
  const linkRow = (title: string, path: string, icon: React.ReactNode, sub?: string, badge?: number) => <Link className="cs-link-row" href={href(path)}><span className="cs-row-icon">{icon}</span><span className="cs-row-body"><strong>{title}</strong>{sub && <small>{sub}</small>}</span>{badge ? <span className="cs-badge" aria-label={`未確認${badge}件`}>{badge}</span> : null}<ChevronRight size={18} /></Link>;
  const roomPicker = () => !data ? null : data.account.role === "global_admin" ? <label className="cs-field">対象研究室<select value={selectedRoomId} onChange={(event) => { ctx.selectRoom(event.target.value); setDraft(emptyDraft); setGraphSolventId(""); }}><option value="">選択してください</option>{data.rooms.map((r) => <option value={r.id} key={r.id}>{r.name}</option>)}</select></label> : card(<span>研究室：<strong>{room?.name || "未設定"}</strong></span>, "cs-room-card");

  if (ctx.loading) return <div className="cs-viewport"><div className="cs-loading">読み込み中…</div></div>;
  if (!data) return <div className="cs-viewport"><div className="cs-content">{header("ChemStock")}{card(<><p>{ctx.error || "データを読み込めませんでした。"}</p>{button("再読み込み", ctx.refresh)}<p><Link className="cs-inline-link" href="/preview">画面確認用データで開く</Link></p></>)}</div></div>;

  const namedStock = (stock: Stock) => solventFor(stock)?.name || "不明な溶媒";
  const currentStock = scopedStocks.find((stock) => stock.solvent_id === draft.solventId);
  const positiveAmount = movementAmount(draft.amount, draft.unit, data.settings);
  const signedAmount = (positiveAmount || 0) * (draft.type === "add" ? 1 : -1);
  const stepByLitres = (delta: number) => updateDraft({ unit: "L", amount: String(Number(Math.max(0, toLitres(Number(draft.amount || 0), draft.unit, data.settings) + delta).toFixed(2))) });
  const unreadCount = canAdmin ? preview ? data.notices.filter((notice) => notice.status === "unread").length : data.adminOverview?.unreadNotificationCount || 0 : 0;
  const forecastFor = (stock: Stock): Forecast | undefined => preview ? previewForecast(stock, data.logs, data.settings) : data.forecasts.find((item) => item.inventoryId === stock.id);
  const selectableSolvents = data.solvents.filter((solvent) => scopedStocks.some((stock) => stock.solvent_id === solvent.id && stock.is_active));
  const detailId = path.startsWith("/inventory/detail/") ? decodeURIComponent(path.split("/")[3]) : "";
  const detail = detailId ? stockFor(detailId) : undefined;
  const editId = path.startsWith("/inventory/history/") ? decodeURIComponent(path.split("/")[3]) : "";
  const editLog = data.logs.find((log) => log.id === editId && log.status === "active" && scopedStocks.some((stock) => stock.id === log.inventory_id));

  const submitAdjustment = async () => {
    if (!draft.roomId || draft.roomId !== selectedRoomId || !draft.solventId || positiveAmount === null || !draft.operator.trim()) { setMessage("研究室・溶媒・正の数量・実操作者名を確認してください。"); return; }
    const occurred = draft.occurredAt ? new Date(draft.occurredAt) : null;
    if (occurred && (!Number.isFinite(occurred.getTime()) || occurred.getTime() > Date.now() || occurred.getTime() < new Date(currentStock?.opened_at || 0).getTime())) { setMessage("入出庫日時は在庫の開始時刻から現在までで入力してください。"); return; }
    if (draft.type === "use" && (!currentStock || currentStock.amount + signedAmount < 0)) { setMessage("在庫が不足しています。"); return; }
    if (!preview) {
      if (!currentStock || !currentStock.is_active) { setMessage("対象の在庫が見つかりません。画面を読み込み直してください。"); return; }
      await executeLive("movement", currentStock.id, { changeAmount: signedAmount, operatorName: draft.operator.trim(), purpose: draft.purpose.trim() || null, occurredAt: occurred?.toISOString() || null }, () => { setDraft((current) => ({ ...current, operator: "", purpose: "", occurredAt: "" })); go("/inventory/complete"); }, "保存に失敗しました。");
      return;
    }
    mutateDemo((current) => {
      const existing = current.stocks.find((stock) => stock.room_id === draft.roomId && stock.solvent_id === draft.solventId);
      const id = existing?.id || crypto.randomUUID();
      return { ...current,
        stocks: existing ? current.stocks.map((stock) => stock.id === id ? { ...stock, amount: Number((stock.amount + signedAmount).toFixed(2)) } : stock) : [...current.stocks, { id, room_id: draft.roomId, solvent_id: draft.solventId, amount: signedAmount, opening_amount: 0, opened_at: new Date().toISOString(), low_stock_threshold: null, is_active: true }],
        logs: [{ id: crypto.randomUUID(), inventory_id: id, change_amount: signedAmount, operator_name: draft.operator.trim(), purpose: draft.purpose || null, status: "active", occurred_at: occurred?.toISOString() || new Date().toISOString() }, ...current.logs],
      };
    });
    setDraft((current) => ({ ...current, operator: "", purpose: "", occurredAt: "" }));
    go("/inventory/complete");
  };

  const commitCancellation = async () => {
    if (!operator.trim() || !reason.trim()) { setMessage("実操作者名と取消理由を入力してください。"); return; }
    const log = scopedLogs.find((item) => item.id === targetId && item.status === "active");
    if (!log) { setMessage("対象の記録が見つかりません。"); return; }
    const stock = stockFor(log.inventory_id);
    if (!stock || stock.amount - log.change_amount < 0) { setMessage("取消後の残量が負になるため、反映できません。"); return; }
    if (!preview) {
      await executeLive("cancel", log.id, { operatorName: operator.trim(), reason: reason.trim() }, () => { setModal(""); go("/inventory/history/recalculated"); }, "取消に失敗しました。");
      return;
    }
    const afterLog: StockLog = { ...log, status: "cancelled" };
    const afterAmount = Number((stock.amount - log.change_amount).toFixed(2));
    mutateDemo((current) => ({
      ...current,
      logs: current.logs.map((item) => item.id === log.id ? afterLog : item),
      stocks: current.stocks.map((item) => item.id === stock.id ? { ...item, amount: afterAmount } : item),
      audits: [demoLogAudit(current, log, afterLog, stock.amount, afterAmount, "cancel", operator.trim(), reason.trim()), ...current.audits],
    }));
    setModal(""); go("/inventory/history/recalculated");
  };

  const commitThreshold = async () => {
    const value = threshold.trim() === "" ? null : Number(threshold);
    if (!detail || (value !== null && (!/^\d+(\.\d{1,2})?$/.test(threshold) || !Number.isFinite(value) || value < 0))) { setMessage("0以上で小数第2位までの下限値を入力するか、空欄にして解除してください。"); return; }
    if (!operator.trim() || !reason.trim()) { setMessage("実操作者名と変更理由を入力してください。"); return; }
    if (!preview) {
      if (!detail.last_updated) { setMessage("在庫の更新日時がありません。画面を読み込み直してください。"); return; }
      await executeLive("threshold", detail.id, { threshold: value, operatorName: operator.trim(), reason: reason.trim(), expectedLastUpdated: detail.last_updated }, () => setModal(""), "下限値の変更に失敗しました。");
      return;
    }
    mutateDemo((current) => {
      const before = current.stocks.find((stock) => stock.id === detail.id);
      if (!before) return current;
      const after = { ...before, low_stock_threshold: value };
      return { ...current, stocks: current.stocks.map((stock) => stock.id === detail.id ? after : stock), audits: [demoInventoryAudit(current, before, after, "threshold", operator.trim(), reason.trim()), ...current.audits] };
    });
    setModal("");
  };

  const commitDeactivation = async () => {
    const stock = stockFor(targetId);
    if (!stock || stock.amount !== 0) { setMessage("残量が0 Lの管理対象のみ利用停止できます。"); return; }
    if (!operator.trim() || !reason.trim()) { setMessage("実操作者名と停止理由を入力してください。"); return; }
    if (!preview) {
      await executeLive("deactivate", stock.id, { operatorName: operator.trim(), reason: reason.trim() }, () => setModal(""), "利用停止に失敗しました。");
      return;
    }
    mutateDemo((current) => {
      const before = current.stocks.find((item) => item.id === stock.id);
      if (!before) return current;
      const after = { ...before, is_active: false };
      return { ...current, stocks: current.stocks.map((item) => item.id === stock.id ? after : item), audits: [demoInventoryAudit(current, before, after, "deactivate", operator.trim(), reason.trim()), ...current.audits] };
    });
    setModal("");
  };

  let content: React.ReactNode;
  if (path === "/protected") {
    const low = scopedStocks.filter((stock) => stock.is_active && stock.low_stock_threshold != null && stock.amount <= stock.low_stock_threshold);
    const upcoming = scopedStocks.filter((stock) => stock.is_active && forecastFor(stock)?.status === "forecast").sort((a, b) => (forecastFor(a)?.forecastAt || "").localeCompare(forecastFor(b)?.forecastAt || ""));
    content = <>{header("ホーム", undefined, preview ? <span className="cs-preview-tag">画面確認用</span> : <form action={signOutAction} onSubmit={() => sessionStorage.removeItem(DRAFT_KEY)}><button aria-label="ログアウト" className="cs-icon-button"><LogOut size={19} /></button></form>)}
      {room && card(<span>研究室：<strong>{room.name}</strong></span>, "cs-room-card")}
      {(low.length > 0 || upcoming.length > 0) && card(<><strong className="cs-alert-title"><AlertTriangle size={18} />在庫のお知らせ</strong>{low.map((stock) => <Link className="cs-alert-row" href={href(`/inventory/detail/${stock.id}`)} key={stock.id}>{namedStock(stock)}：下限以下（残量 {formatAmount(stock.amount)}）<ChevronRight size={15} /></Link>)}{upcoming.slice(0, 3).map((stock) => <Link className="cs-alert-row" href={href(`/inventory/detail/${stock.id}`)} key={stock.id}>{namedStock(stock)}：{forecastLabel(forecastFor(stock)!.forecastAt!)}<ChevronRight size={15} /></Link>)}{upcoming.length > 3 && <details><summary>ほか{upcoming.length - 3}件</summary>{upcoming.slice(3).map((stock) => <Link className="cs-alert-row" href={href(`/inventory/detail/${stock.id}`)} key={stock.id}>{namedStock(stock)}：{forecastLabel(forecastFor(stock)!.forecastAt!)}</Link>)}</details>}</>, "cs-alert")}
      <div className="cs-home-cards"><Link className="cs-big-card" href={href("/inventory/adjust")}><span className="cs-big-icon"><Beaker size={39} /></span><strong>入庫・使用を記録</strong><small>溶媒の入出庫を記録します</small></Link><Link className="cs-big-card cs-blue" href={href("/inventory")}><span className="cs-big-icon"><Search size={39} /></span><strong>溶媒の在庫閲覧</strong><small>現在の在庫を検索します</small></Link></div>
    </>;
  } else if (path === "/inventory/adjust") {
    content = <>{header("残量調整", undefined, <Link className="cs-header-link" href={href("/inventory/history")}>履歴</Link>)}{roomPicker()}
      <div className="cs-field">溶媒を選択</div><div className="cs-option-list">{selectableSolvents.length ? selectableSolvents.map((solvent) => <button type="button" className={`cs-option ${draft.solventId === solvent.id ? "selected" : ""}`} aria-pressed={draft.solventId === solvent.id} key={solvent.id} onClick={() => updateDraft({ solventId: solvent.id, roomId: selectedRoomId })}><span className="cs-radio" />{solvent.name}</button>) : <p className="cs-muted">溶媒が登録されていません。</p>}</div>
      <div className="cs-actions">{button("数量入力へ", () => draft.solventId && selectedRoomId ? go("/inventory/action/add") : setMessage("研究室と溶媒を選択してください。"), false, !selectableSolvents.length)}</div>
    </>;
  } else if (path.startsWith("/inventory/action/")) {
    const confirm = path.endsWith("/confirm");
    const name = data.solvents.find((solvent) => solvent.id === draft.solventId)?.name;
    content = <>{header(confirm ? "確認" : "数量入力", confirm ? "/inventory/action/add" : "/inventory/adjust")}{card(<><small>対象</small><strong>{room?.name || "研究室未選択"} ／ {name || "溶媒未選択"}</strong>{!confirm && currentStock && <small>現在量：{formatAmount(currentStock.amount)}</small>}</>)}
      {!confirm ? <><div className="cs-field">区分<div className="cs-segment"><button type="button" aria-pressed={draft.type === "add"} className={draft.type === "add" ? "active" : ""} onClick={() => updateDraft({ type: "add" })}>追加する</button><button type="button" aria-pressed={draft.type === "use"} className={draft.type === "use" ? "active" : ""} onClick={() => updateDraft({ type: "use" })}>使用する</button></div></div>
        <div className="cs-field">数量<div className="cs-stepper"><button type="button" aria-label="数量を1減らす" onClick={() => updateDraft({ amount: String(Math.max(0, Number(draft.amount || 0) - 1)) })}>−</button><input aria-label="数量" type="number" min="0" step="0.01" value={draft.amount} onChange={(event) => updateDraft({ amount: event.target.value })} /><button type="button" aria-label="数量を1増やす" onClick={() => updateDraft({ amount: String(Number(draft.amount || 0) + 1) })}>＋</button><select aria-label="単位" value={draft.unit} onChange={(event) => updateDraft({ unit: event.target.value })}><option>L</option><option value="gal">gal</option><option>斗缶</option></select></div><div className="cs-quick-steps"><button type="button" onClick={() => stepByLitres(-data.settings.unitGalToL)}>−1 gal</button><button type="button" onClick={() => stepByLitres(data.settings.unitGalToL)}>＋1 gal</button><button type="button" onClick={() => stepByLitres(-data.settings.unitTokanToL)}>−1 斗缶</button><button type="button" onClick={() => stepByLitres(data.settings.unitTokanToL)}>＋1 斗缶</button></div><small>1 gal = {data.settings.unitGalToL} L、1 斗缶 = {data.settings.unitTokanToL} L。保存単位は L。</small></div>
        {positiveAmount !== null && card(<div className="cs-record-inline"><span>L換算の変量</span><strong>{signedAmount > 0 ? "+" : ""}{formatAmount(signedAmount)}</strong></div>)}
        <label className="cs-field">実操作者名 <em>必須</em><input value={draft.operator} onChange={(event) => updateDraft({ operator: event.target.value })} placeholder="氏名を入力" maxLength={100} /></label>
        <label className="cs-field">用途・メモ<input value={draft.purpose} onChange={(event) => updateDraft({ purpose: event.target.value })} placeholder="任意" maxLength={500} /></label>
        <details className="cs-card"><summary>実際の入出庫日時を指定（後日登録）</summary><label className="cs-field">入出庫日時<input type="datetime-local" value={draft.occurredAt} onChange={(event) => updateDraft({ occurredAt: event.target.value })} /></label></details>
        <div className="cs-actions">{button("確認へ", () => { if (!selectedRoomId || !draft.solventId || positiveAmount === null || !draft.operator.trim()) { setMessage("研究室・溶媒・正の数量・実操作者名を入力してください。"); return; } if (draft.type === "use" && (!currentStock || currentStock.amount < positiveAmount)) { setMessage("在庫が不足しています。"); return; } go("/inventory/action/add/confirm"); })}</div>
      </> : <>{card(<div className="cs-summary"><span>研究室</span><strong>{room?.name}</strong><span>溶媒</span><strong>{name}</strong><span>区分</span><strong>{draft.type === "add" ? "追加" : "使用"}</strong><span>現在量</span><strong>{currentStock ? formatAmount(currentStock.amount) : "—"}</strong><span>変量</span><strong>{signedAmount > 0 ? "+" : ""}{formatAmount(signedAmount)}</strong><span>更新後</span><strong>{currentStock ? formatAmount(currentStock.amount + signedAmount) : "—"}</strong><span>実操作者</span><strong>{draft.operator}</strong>{draft.purpose && <><span>用途・メモ</span><strong>{draft.purpose}</strong></>}{draft.occurredAt && <><span>入出庫日時</span><strong>{new Date(draft.occurredAt).toLocaleString("ja-JP")}</strong></>}</div>)}<p className="cs-muted">この内容で在庫を更新します。</p><div className="cs-actions cs-pair">{button("修正する", () => go("/inventory/action/add"), true)}{button("実行する", submitAdjustment, false, saving)}</div></>}
    </>;
  } else if (path === "/inventory/complete" || path === "/inventory/history/recalculated") {
    content = <>{header(path === "/inventory/complete" ? "完了" : "反映しました")}<div className="cs-done"><span><Check size={46} /></span><h2>{path === "/inventory/complete" ? "登録しました" : "取消・編集を反映しました"}</h2>{card(<>{path === "/inventory/complete" ? <>{room?.name} ／ {data.solvents.find((s) => s.id === draft.solventId)?.name}<br /><strong>{signedAmount > 0 ? "+" : ""}{formatAmount(signedAmount)}</strong></> : preview ? "画面確認用データに反映しました" : "変更を保存しました"}</>)}<div className="cs-actions">{button("ホームに戻る", () => go("/protected"))}{button(path === "/inventory/complete" ? "続けて操作する" : "履歴に戻る", () => go(path === "/inventory/complete" ? "/inventory/adjust" : "/inventory/history"), true)}</div></div></>;
  } else if (path === "/inventory/history") {
    const filteredLogs = scopedLogs.filter((log) => !filterSolvent || inventoryFor(log)?.solvent_id === filterSolvent).sort((a,b) => b.occurred_at.localeCompare(a.occurred_at));
    content = <>{header("入出庫履歴", "/inventory/adjust")}{roomPicker()}<label className="cs-field">溶媒<select value={filterSolvent} onChange={(event) => { setFilterSolvent(event.target.value); setPageSize(20); }}><option value="">すべて</option>{selectableSolvents.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      {filteredLogs.length ? filteredLogs.slice(0, pageSize).map((log) => <div className="cs-record" key={log.id}><div><strong>{formatDate(log.occurred_at)}　{solventFor(inventoryFor(log))?.name}</strong><strong className={log.change_amount > 0 ? "cs-positive" : "cs-negative"}>{log.change_amount > 0 ? "+" : ""}{formatAmount(log.change_amount)}</strong></div><small>実操作者：{log.operator_name}{log.status === "cancelled" && "　（取消済み）"}</small>{log.status === "active" && <div className="cs-record-actions"><Link className="cs-small-button" href={href(`/inventory/history/${log.id}/edit`)}>編集</Link><button className="cs-small-button danger" onClick={() => { setTargetId(log.id); setOperator(""); setReason(""); setModal("cancel"); }}>取消</button></div>}</div>) : card(<p className="cs-muted">履歴はありません。</p>)}
      {filteredLogs.length > pageSize && button("さらに表示", () => setPageSize((size) => size + 20), true)}
    </>;
  } else if (path.endsWith("/edit") && path.startsWith("/inventory/history/")) {
    content = <>{header("記録の編集", "/inventory/history")}{editLog ? <EditLogForm log={editLog} stock={stockFor(editLog.inventory_id)} name={solventFor(stockFor(editLog.inventory_id))?.name || ""} saving={saving} onSave={async ({ change, operator, occurredAt, changedByName, reason }) => {
      const stock = stockFor(editLog.inventory_id);
      if (!stock || stock.amount - editLog.change_amount + change < 0) { setMessage("変更後の残量が負になります。"); return; }
      if (!preview) {
        await executeLive("correct", editLog.id, { changeAmount: change, operatorName: operator, occurredAt, changedByName, reason }, () => go("/inventory/history/recalculated"), "訂正に失敗しました。");
        return;
      }
      const afterLog: StockLog = { ...editLog, change_amount: change, operator_name: operator, occurred_at: occurredAt };
      const afterAmount = Number((stock.amount - editLog.change_amount + change).toFixed(2));
      mutateDemo((current) => ({
        ...current,
        logs: current.logs.map((log) => log.id === editLog.id ? afterLog : log),
        stocks: current.stocks.map((item) => item.id === stock.id ? { ...item, amount: afterAmount } : item),
        audits: [demoLogAudit(current, editLog, afterLog, stock.amount, afterAmount, "correct", changedByName, reason), ...current.audits],
      }));
      go("/inventory/history/recalculated");
    }} /> : card("対象の記録が見つかりません。")}</>;
  } else if (path === "/inventory" || path === "/inventory/list" || /^\/inventory\/[^/]+$/.test(path)) {
    const legacyRoomId = path !== "/inventory/list" && path !== "/inventory" ? path.split("/")[2] : "";
    const displayRoom = legacyRoomId ? data.rooms.find((item) => item.id === legacyRoomId) : room;
    const permitted = !legacyRoomId || (displayRoom && (data.account.role === "global_admin" || data.account.room_id === legacyRoomId));
    const listingStocks = legacyRoomId ? data.stocks.filter((stock) => stock.room_id === legacyRoomId) : scopedStocks;
    const listed = listingStocks.filter((stock) => stock.is_active && (!query || (searchBy === "cas" ? solventFor(stock)?.cas_number?.replaceAll("-", "").includes(query.replaceAll("-", "")) : searchBy === "room" ? displayRoom?.name.includes(query) : namedStock(stock).toLowerCase().includes(query.toLowerCase()))));
    content = <>{header(path === "/inventory" ? "在庫検索" : "在庫一覧", path === "/inventory" ? undefined : "/inventory")}{permitted ? legacyRoomId ? card(<>研究室：<strong>{displayRoom?.name}</strong></>, "cs-room-card") : roomPicker() : card("この研究室の在庫は表示できません。")}
      {permitted && path === "/inventory" && <><div className="cs-field">検索方法<div className="cs-segment"><button className={searchBy === "name" ? "active" : ""} onClick={() => setSearchBy("name")}>溶媒名</button><button className={searchBy === "cas" ? "active" : ""} onClick={() => setSearchBy("cas")}>CAS</button>{data.account.role === "global_admin" && <button className={searchBy === "room" ? "active" : ""} onClick={() => setSearchBy("room")}>研究室</button>}</div></div><label className="cs-field">キーワード<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="入力して検索" /></label><div className="cs-actions">{button("検索する", () => go("/inventory/list"))}</div></>}
      {permitted && path !== "/inventory" && <><p className="cs-count">検索結果：{listed.length}件</p>{listed.length ? listed.map((stock) => <Link className="cs-stock-row" key={stock.id} href={href(`/inventory/detail/${stock.id}`)}><span className="cs-row-icon"><Beaker size={20} /></span><span className="cs-row-body"><strong>{namedStock(stock)}</strong><small>CAS: {solventFor(stock)?.cas_number || "—"}　{displayRoom?.name}</small>{stock.low_stock_threshold != null && stock.amount <= stock.low_stock_threshold && <small className="cs-low-label"><AlertTriangle size={13} />下限以下</small>}</span><strong>{formatAmount(stock.amount)}</strong><ChevronRight size={17} /></Link>) : card("該当する在庫はありません。")}</>}
    </>;
  } else if (path.startsWith("/inventory/detail/")) {
    const solvent = solventFor(detail);
    const logs = data.logs.filter((log) => log.inventory_id === detail?.id).sort((a,b) => b.occurred_at.localeCompare(a.occurred_at));
    content = <>{header("詳細情報", "/inventory/list")}{detail && solvent ? <>{card(<div className="cs-detail-hero"><span className="cs-big-icon"><Beaker size={38} /></span><h2>{solvent.name}</h2><span className="cs-muted">{data.rooms.find((item) => item.id === detail.room_id)?.name || "研究室不明"}</span><small>現在量</small><strong className="cs-big-amount">{formatAmount(detail.amount)}</strong><div className="cs-properties"><div><small>CAS番号</small><strong>{solvent.cas_number || "—"}</strong></div><div><small>分子式</small><strong>{solvent.formula || "—"}</strong></div><div><small>分子量</small><strong>{solvent.molecular_weight || "—"}</strong></div></div><div className="cs-threshold"><span>下限値：{detail.low_stock_threshold == null ? "未設定" : formatAmount(detail.low_stock_threshold)}</span><button className="cs-small-button" onClick={() => { setThreshold(String(detail.low_stock_threshold ?? "")); setOperator(""); setReason(""); setModal("threshold"); }}>変更</button></div></div>)}<h3 className="cs-section-title">入出庫履歴</h3>{logs.length ? logs.map((log) => <div className="cs-record" key={log.id}><div><span>{formatDate(log.occurred_at)}</span><strong>{log.change_amount > 0 ? "+" : ""}{formatAmount(log.change_amount)}</strong></div><small>{log.operator_name}{log.status === "cancelled" && "（取消済み）"}</small></div>) : card("履歴はありません。")}</> : card("在庫が見つかりません。")}</>;
  } else {
    content = <ExtraScreens path={path} data={data} selectedRoomId={selectedRoomId} scopedStocks={scopedStocks} scopedLogs={scopedLogs} roomName={room?.name || ""} preview={preview} period={period} setPeriod={setPeriod} graphSolventId={graphSolventId} setGraphSolventId={setGraphSolventId} newSolvent={newSolvent} setNewSolvent={setNewSolvent} targetId={targetId} setTargetId={setTargetId} setModal={setModal} mutateDemo={mutateDemo} go={go} header={header} card={card} button={button} linkRow={linkRow} canAdmin={canAdmin} unreadCount={unreadCount} forecastFor={forecastFor} />;
  }

  const cancellation = modal === "cancel" ? scopedLogs.find((log) => log.id === targetId) : undefined;
  const cancellationStock = cancellation ? stockFor(cancellation.inventory_id) : undefined;
  return <div className="cs-viewport"><div className="cs-screen"><main className="cs-content">{preview && <div className="cs-demo-bar"><span>画面確認用データ</span><select aria-label="確認する権限" value={data.account.role} onChange={(event) => ctx.setPreviewRole(event.target.value as Role)}><option value="lab">研究室</option><option value="solvent_room_admin">溶媒庫管理</option><option value="global_admin">全体管理者</option></select></div>}{ctx.error && <div className="cs-message" role="alert">最新情報を取得できませんでした：{ctx.error} {button("再読み込み", ctx.refresh, true)}</div>}{!preview && ctx.lastSyncedAt && <div className="cs-sync">最終更新 {new Date(ctx.lastSyncedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} <button onClick={ctx.refresh}>更新</button></div>}{content}{message && <div className="cs-message" role="alert">{message}</div>}</main><nav className="cs-tabbar" aria-label="メインメニュー">{nav.map(({ path: target, title, icon: Icon }) => <Link key={target} href={href(target)} className={active === target ? "active" : ""} aria-current={active === target ? "page" : undefined}><Icon size={21} strokeWidth={active === target ? 2.5 : 1.8} /><span>{title}</span>{target === "/manage" && unreadCount > 0 && <span className="cs-badge cs-nav-badge" aria-label={`未確認${unreadCount}件`}>{unreadCount}</span>}</Link>)}</nav></div>
    {modal && <div className="cs-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(""); }}><div className="cs-modal" ref={modalRef} role="dialog" aria-modal="true" aria-label={modal === "cancel" ? "取消確認" : modal === "threshold" ? "下限値変更" : "利用停止確認"}>{modal === "cancel" ? <><h2>この記録を取り消しますか？</h2>{cancellation && cancellationStock && <p className="cs-muted">{data.rooms.find((item) => item.id === cancellationStock.room_id)?.name} ／ {namedStock(cancellationStock)} ／ {new Date(cancellation.occurred_at).toLocaleString("ja-JP")} ／ {formatAmount(cancellation.change_amount)}<br />現在 {formatAmount(cancellationStock.amount)} → 取消後 {formatAmount(cancellationStock.amount - cancellation.change_amount)}</p>}<label className="cs-field">実操作者名 <em>必須</em><input value={operator} onChange={(event) => setOperator(event.target.value)} /></label><label className="cs-field">取消理由 <em>必須</em><input value={reason} onChange={(event) => setReason(event.target.value)} /></label></> : modal === "threshold" ? <><h2>在庫下限値を変更</h2><p className="cs-muted">空欄で保存すると下限値の設定を解除します。</p><label className="cs-field">下限値（L）<input type="number" min="0" step="0.01" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label><label className="cs-field">実操作者名 <em>必須</em><input value={operator} onChange={(event) => setOperator(event.target.value)} /></label><label className="cs-field">変更理由 <em>必須</em><input value={reason} onChange={(event) => setReason(event.target.value)} /></label></> : <><h2>この溶媒を利用停止しますか？</h2><p className="cs-muted">残量が0 Lの場合のみ停止できます。在庫と履歴は残ります。</p><label className="cs-field">実操作者名 <em>必須</em><input value={operator} onChange={(event) => setOperator(event.target.value)} /></label><label className="cs-field">停止理由 <em>必須</em><input value={reason} onChange={(event) => setReason(event.target.value)} /></label></>}
      {message && <div className="cs-message" role="alert">{message}</div>}
      <div className="cs-pair">{button("キャンセル", () => setModal(""), true, saving)}{button(modal === "cancel" ? "取り消す" : modal === "threshold" ? "保存" : "利用停止", modal === "cancel" ? commitCancellation : modal === "threshold" ? commitThreshold : commitDeactivation, false, saving)}</div></div></div>}
  </div>;
}

function EditLogForm({ log, stock, name, saving, onSave }: { log: StockLog; stock?: Stock; name: string; saving: boolean; onSave: (change: EditLogChange) => void }) {
  const [amount, setAmount] = useState(String(Math.abs(log.change_amount)));
  const [operator, setOperator] = useState(log.operator_name);
  const [reason, setReason] = useState("");
  const [actualOperator, setActualOperator] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => new Date(new Date(log.occurred_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [error, setError] = useState("");
  return <><div className="cs-card">対象：<strong>{formatDate(log.occurred_at)}　{name}　{formatAmount(log.change_amount)}</strong></div><label className="cs-field">変量（L）<input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label className="cs-field">入出庫日時<input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label><label className="cs-field">使用者名<input value={operator} onChange={(event) => setOperator(event.target.value)} /></label><label className="cs-field">実操作者名 <em>必須</em><input value={actualOperator} onChange={(event) => setActualOperator(event.target.value)} placeholder="今回編集する人の氏名" /></label><label className="cs-field">変更理由 <em>必須</em><input value={reason} onChange={(event) => setReason(event.target.value)} /></label>{error && <p className="cs-message">{error}</p>}<div className="cs-actions"><button className="cs-button" disabled={saving} onClick={() => { const date = new Date(occurredAt); if (!stock || !/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || !operator.trim() || !actualOperator.trim() || !reason.trim() || !Number.isFinite(date.getTime())) { setError("すべての必須項目を入力してください。"); return; } if (date.getTime() > Date.now() || date.getTime() < new Date(stock.opened_at).getTime()) { setError("入出庫日時は在庫開始時刻から現在までで入力してください。"); return; } if (window.confirm("この内容で記録を変更しますか？")) onSave({ change: Number(amount) * Math.sign(log.change_amount), operator: operator.trim(), occurredAt: date.toISOString(), changedByName: actualOperator.trim(), reason: reason.trim() }); }}>確認して保存</button></div></>;
}

type ExtraProps = { path: string; data: DataSet; selectedRoomId: string; scopedStocks: Stock[]; scopedLogs: StockLog[]; roomName: string; preview: boolean; period: string; setPeriod: (value: string) => void; graphSolventId: string; setGraphSolventId: (value: string) => void; newSolvent: { name: string; cas_number: string; formula: string; molecular_weight: string }; setNewSolvent: (value: { name: string; cas_number: string; formula: string; molecular_weight: string }) => void; targetId: string; setTargetId: (id: string) => void; setModal: (value: "" | "cancel" | "threshold" | "deactivate") => void; mutateDemo: (change: (data: DataSet) => DataSet) => void; go: (path: string) => void; header: (title: string, back?: string, action?: React.ReactNode) => React.ReactNode; card: (children: React.ReactNode, className?: string) => React.ReactNode; button: (label: string, onClick: () => void, secondary?: boolean, disabled?: boolean) => React.ReactNode; linkRow: (title: string, path: string, icon: React.ReactNode, sub?: string, badge?: number) => React.ReactNode; canAdmin: boolean; unreadCount: number; forecastFor: (stock: Stock) => Forecast | undefined };

function ExtraScreens(props: ExtraProps) {
  const { path, data, selectedRoomId, scopedStocks, scopedLogs, roomName, preview, period, setPeriod, graphSolventId, setGraphSolventId, newSolvent, setNewSolvent, targetId, setTargetId, setModal, mutateDemo, go, header, card, button, linkRow, canAdmin, unreadCount, forecastFor } = props;
  const ctx = useChemstock();
  const [noticeFilter, setNoticeFilter] = useState<"unread" | "acknowledged" | "resolved">("unread");
  const [noticeEditId, setNoticeEditId] = useState("");
  const [noticeNextStatus, setNoticeNextStatus] = useState<"acknowledged" | "resolved">("acknowledged");
  const [noticeOperator, setNoticeOperator] = useState("");
  const [noticeReason, setNoticeReason] = useState("");
  const [noticeError, setNoticeError] = useState("");
  const [noticeSaving, setNoticeSaving] = useState(false);
  const [analysisDays, setAnalysisDays] = useState("90");
  const [masterEditId, setMasterEditId] = useState("");
  const [masterValue, setMasterValue] = useState("");
  const [masterOperator, setMasterOperator] = useState("");
  const [masterReason, setMasterReason] = useState("");
  const [masterError, setMasterError] = useState("");
  const [manageOperator, setManageOperator] = useState("");
  const [manageReason, setManageReason] = useState("");
  const [manageError, setManageError] = useState("");
  const [manageSaving, setManageSaving] = useState(false);
  const [newDesignatedQuantity, setNewDesignatedQuantity] = useState("");
  const [settingEdit, setSettingEdit] = useState<"warning_ratio" | "forecast_window_days" | "">("");
  const [settingValue, setSettingValue] = useState("");
  const [settingOperator, setSettingOperator] = useState("");
  const [settingReason, setSettingReason] = useState("");
  const [settingError, setSettingError] = useState("");
  const [settingSaving, setSettingSaving] = useState(false);
  const extraModalRef = useRef<HTMLDivElement>(null);
  const extraReturnFocus = useRef<HTMLElement | null>(null);
  const activeModal = path === "/manage/admin/notifications" && noticeEditId ? "notice"
    : path === "/manage/admin/master" && masterEditId ? "master"
      : path === "/manage/admin/settings" && settingEdit ? "setting" : "";
  useEffect(() => {
    if (!activeModal) return;
    extraReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = extraModalRef.current;
    dialog?.querySelector<HTMLElement>("input, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (activeModal === "notice") setNoticeEditId("");
        if (activeModal === "master") setMasterEditId("");
        if (activeModal === "setting") setSettingEdit("");
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)"));
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); extraReturnFocus.current?.focus(); };
  }, [activeModal]);
  const beginNoticeChange = (id: string, status: "acknowledged" | "resolved") => {
    setNoticeEditId(id);
    setNoticeNextStatus(status);
    setNoticeOperator("");
    setNoticeReason("");
    setNoticeError("");
  };
  const saveNoticeChange = async () => {
    if (!noticeOperator.trim() || (noticeNextStatus === "resolved" && !noticeReason.trim())) {
      setNoticeError("実操作者名と、対応済みの場合は理由を入力してください。");
      return;
    }
    if (noticeSaving) return;
    if (preview) {
      mutateDemo((current) => {
        const before = current.notices.find((notice) => notice.id === noticeEditId);
        if (!before) return current;
        const after = { ...before, status: noticeNextStatus };
        return {
          ...current,
          notices: current.notices.map((notice) => notice.id === before.id ? after : notice),
          audits: [{
            id: crypto.randomUUID(), account_id: current.account.id,
            target_type: "notification", target_id: before.id, action: "status_change",
            operator_name: noticeOperator.trim(), reason: noticeReason.trim(),
            before_value: { notification: before }, after_value: { notification: after },
            created_at: new Date().toISOString(),
          }, ...current.audits],
        };
      });
      setNoticeEditId("");
      return;
    }
    setNoticeSaving(true);
    try {
      await ctx.runNotificationCommand(noticeEditId, {
        status: noticeNextStatus,
        operatorName: noticeOperator.trim(),
        reason: noticeReason.trim() || null,
      });
      setNoticeEditId("");
    } catch (cause) {
      setNoticeError(cause instanceof Error ? cause.message : "通知の変更に失敗しました。");
    } finally {
      setNoticeSaving(false);
    }
  };
  const solventName = (id: string) => data.solvents.find((s) => s.id === id)?.name || "不明";
  const activeStock = scopedStocks.filter((s) => s.is_active);
  if (path === "/graph" || path === "/graph/forecast") {
    const solventId = graphSolventId || activeStock[0]?.solvent_id || "";
    const stock = activeStock.find((item) => item.solvent_id === solventId);
    return <>
      {header("残量推移・欠品予測", path === "/graph/forecast" ? "/graph" : undefined)}
      {roomName && <p className="cs-muted">対象研究室：{roomName}</p>}
      <div className="cs-two-selects">
        <label className="cs-field">溶媒<select value={solventId} onChange={(event) => setGraphSolventId(event.target.value)}>{activeStock.map((item) => <option key={item.id} value={item.solvent_id}>{solventName(item.solvent_id)}</option>)}</select></label>
        <label className="cs-field">実績期間<select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="7">1週間</option><option value="30">1ヶ月</option><option value="90">3ヶ月</option><option value="365">1年</option></select></label>
      </div>
      {stock ? <StockTrend stock={stock} logs={scopedLogs} forecast={forecastFor(stock)} periodDays={Number(period)} name={solventName(stock.solvent_id)} roomName={roomName} /> : card("表示できる在庫がありません。")}
    </>;
  }
  if (path === "/manage") return <>{header("管理")}{linkRow("溶媒種類管理", "/manage/types", <FlaskConical size={21} />)}{canAdmin && linkRow("管理者画面", "/manage/admin", <Shield size={21} />, undefined, unreadCount)}</>;
  if (path === "/manage/types") return <>{header("溶媒種類管理", "/manage")}<p className="cs-muted">{roomName}の管理対象</p><div className="cs-actions">{button("＋ 溶媒を追加", () => go("/manage/types/new"))}</div>{scopedStocks.map((stock) => { const solvent = data.solvents.find((s) => s.id === stock.solvent_id); return <div className="cs-record" key={stock.id}><div><strong>{solvent?.name || "不明な溶媒"}</strong><small>CAS {solvent?.cas_number || "—"}</small></div><small>{stock.is_active ? `利用中 ／ 残量 ${formatAmount(stock.amount)}` : "利用停止中"}</small>{stock.is_active && <div className="cs-record-actions"><button className="cs-small-button danger" disabled={stock.amount !== 0} title={stock.amount !== 0 ? "残量が0 Lになってから停止できます" : "利用停止"} onClick={() => { setTargetId(stock.id); setModal("deactivate"); }}>利用停止</button>{stock.amount !== 0 && <small>残量を0 Lにすると停止できます。</small>}</div>}</div>; })}</>;
  if (path === "/manage/types/new") {
    const available = data.solvents.filter((s) => !scopedStocks.some((stock) => stock.solvent_id === s.id && stock.is_active));
    const canCreateMaster = data.account.role === "global_admin";
    const saveManaged = async (action: "activate" | "create") => {
      if (manageSaving) return;
      if (!manageOperator.trim() || !manageReason.trim()) { setManageError("実操作者名と理由を入力してください。"); return; }
      if (action === "activate" && (!targetId || !selectedRoomId)) { setManageError("追加する溶媒と研究室を選択してください。"); return; }
      if (action === "create" && (!newSolvent.name.trim() || !newSolvent.cas_number.trim())) { setManageError("溶媒名とCAS番号を入力してください。"); return; }
      if (newDesignatedQuantity && (!/^(?:\d+)(?:\.\d{1,2})?$/.test(newDesignatedQuantity) || Number(newDesignatedQuantity) <= 0 || Number(newDesignatedQuantity) >= 100000000)) { setManageError("指定数量は小数第2位までの正の数で入力してください。"); return; }
      if (!window.confirm(action === "activate" ? "この溶媒を管理対象に追加・再開しますか？" : `${newSolvent.name}をマスタに登録しますか？`)) return;
      setManageSaving(true); setManageError("");
      try {
        if (preview) {
          if (action === "activate") mutateDemo((current) => ({ ...current, stocks: current.stocks.some((s) => s.room_id === selectedRoomId && s.solvent_id === targetId) ? current.stocks.map((s) => s.room_id === selectedRoomId && s.solvent_id === targetId ? { ...s, is_active: true } : s) : [...current.stocks, { id: crypto.randomUUID(), room_id: selectedRoomId, solvent_id: targetId, amount: 0, opening_amount: 0, opened_at: new Date().toISOString(), low_stock_threshold: null, is_active: true }] }));
          else mutateDemo((current) => ({ ...current, solvents: [...current.solvents, { id: crypto.randomUUID(), ...newSolvent, designated_quantity: newDesignatedQuantity ? Number(newDesignatedQuantity) : null }] }));
        } else if (action === "activate") await ctx.runActivateRoomSolvent(selectedRoomId, targetId, manageOperator.trim(), manageReason.trim());
        else await ctx.runAdminManagementCommand("create_solvent", null, { name: newSolvent.name.trim(), casNumber: newSolvent.cas_number.trim(), formula: newSolvent.formula.trim() || null, molecularWeight: newSolvent.molecular_weight.trim() || null, designatedQuantity: newDesignatedQuantity || null, operatorName: manageOperator.trim(), reason: manageReason.trim() });
        setManageOperator(""); setManageReason(""); setTargetId("");
        if (action === "create") { setNewSolvent({ name: "", cas_number: "", formula: "", molecular_weight: "" }); setNewDesignatedQuantity(""); }
        go("/manage/types");
      } catch (cause) { setManageError(cause instanceof Error ? cause.message : "保存に失敗しました。"); }
      finally { setManageSaving(false); }
    };
    return <>{header("溶媒を追加", "/manage/types")}<p className="cs-muted">{roomName}の管理対象に溶媒を追加します。</p><label className="cs-field">溶媒マスタから選択<select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">選択してください</option>{available.map((s) => <option key={s.id} value={s.id}>{s.name}（{s.cas_number || "CAS未設定"}）</option>)}</select></label><label className="cs-field">実操作者名 <em>必須</em><input value={manageOperator} onChange={(event) => setManageOperator(event.target.value)} maxLength={100} /></label><label className="cs-field">理由 <em>必須</em><input value={manageReason} onChange={(event) => setManageReason(event.target.value)} maxLength={200} /></label>{manageError && <p className="cs-message" role="alert">{manageError}</p>}<div className="cs-actions">{button("管理対象に追加・再開", () => { void saveManaged("activate"); }, false, !available.length || manageSaving)}</div>{canCreateMaster && <details className="cs-card"><summary>新しい溶媒をマスタに登録</summary>{(["name", "cas_number", "formula", "molecular_weight"] as const).map((key) => <label className="cs-field" key={key}>{key === "name" ? "溶媒名" : key === "cas_number" ? "CAS番号" : key === "formula" ? "分子式" : "分子量"}{(key === "name" || key === "cas_number") && <em>必須</em>}<input value={newSolvent[key]} onChange={(event) => setNewSolvent({ ...newSolvent, [key]: event.target.value })} /></label>)}<label className="cs-field">指定数量（L、任意）<input type="number" min="0.01" step="0.01" value={newDesignatedQuantity} onChange={(event) => setNewDesignatedQuantity(event.target.value)} /></label><p className="cs-muted">登録には上の実操作者名と理由を使用します。</p>{button("確認して登録", () => { void saveManaged("create"); }, false, manageSaving)}</details>}</>;
  }
  if (path.startsWith("/manage/admin") && !canAdmin) return <>{header("管理者画面", "/manage")}{card("この画面を表示する権限がありません。")}</>;
  if (path === "/manage/admin") return <>{header("管理者画面", "/manage")}{linkRow("通知一覧", "/manage/admin/notifications", <Bell size={21} />, undefined, unreadCount)}{linkRow("指定数量モニター", "/manage/admin/designated-quantity", <AlertTriangle size={21} />)}{linkRow("利用履歴分析", "/manage/admin/analysis", <BarChart3 size={21} />)}{linkRow("溶媒マスタ管理", "/manage/admin/master", <FlaskConical size={21} />)}{linkRow("各種設定", "/manage/admin/settings", <SlidersHorizontal size={21} />)}</>;
  if (path === "/manage/admin/notifications") {
    const notices = data.notices.filter((n) => n.status === noticeFilter);
    return <>{header("通知一覧", "/manage/admin")}
      <div className="cs-segment cs-notice-tabs">{(["unread", "acknowledged", "resolved"] as const).map((status) => <button key={status} className={noticeFilter === status ? "active" : ""} onClick={() => setNoticeFilter(status)}>{status === "unread" ? `未確認${unreadCount ? ` ${unreadCount}` : ""}` : status === "acknowledged" ? "確認済" : "対応済"}</button>)}</div>
      {notices.length ? notices.map((notice) => <div className="cs-card" key={notice.id}><strong>{notice.message}</strong><p>通知時点の合算倍率 {Number(notice.ratio).toFixed(2)} 倍</p><small>{formatDate(notice.notified_at)}</small><p><button className="cs-inline-link" onClick={() => go("/manage/admin/designated-quantity")}>現在の倍率を見る</button></p>{notice.status !== "resolved" && <div className="cs-pair">{notice.status === "unread" && button("確認済みにする", () => beginNoticeChange(notice.id, "acknowledged"), true)}{button("対応済みにする", () => beginNoticeChange(notice.id, "resolved"))}</div>}</div>) : card("この状態の通知はありません。")}
      {data.adminEmailStatus ? <details className="cs-card"><summary>共有アドレスへのメール通知</summary><div>
        <strong>共有アドレスへのメール通知</strong>
        <p>{data.adminEmailStatus.enabled ? "有効" : "無効（送信しません）"}</p>
        <small>差出人：{data.adminEmailStatus.senderEmail || "未設定"} ／ 宛先：{data.adminEmailStatus.recipientEmail || "未設定"}</small>
        <p><small>送信待ち {data.adminEmailStatus.pendingCount} 件 ／ 送信サービス受付済み {data.adminEmailStatus.acceptedCount} 件 ／ 要確認 {data.adminEmailStatus.failedCount} 件</small></p>
        {data.adminEmailStatus.recentFailures.map((failure) => <p key={failure.notificationId} className="cs-muted">要確認：通知 {failure.notificationId} ／ {failure.errorCode} ／ {formatDate(failure.updatedAt)}</p>)}
      </div></details> : null}
      {noticeEditId && <div className="cs-overlay"><div ref={extraModalRef} className="cs-modal" role="dialog" aria-modal="true" aria-label="通知の状態変更"><h2>{noticeNextStatus === "acknowledged" ? "通知を確認済みにする" : "通知を対応済みにする"}</h2><label className="cs-field">実操作者名 <em>必須</em><input value={noticeOperator} onChange={(event) => setNoticeOperator(event.target.value)} maxLength={100} /></label><label className="cs-field">理由 {noticeNextStatus === "resolved" && <em>必須</em>}<input value={noticeReason} onChange={(event) => setNoticeReason(event.target.value)} maxLength={200} /></label>{noticeError && <p className="cs-message" role="alert">{noticeError}</p>}<div className="cs-pair">{button("キャンセル", () => setNoticeEditId(""), true, noticeSaving)}{button("保存", saveNoticeChange, false, noticeSaving)}</div></div></div>}
    </>;
  }
  if (path === "/manage/admin/analysis") {
    const cutoff = Date.now() - Number(analysisDays) * 86400000;
    const count = scopedLogs.filter((l) => l.status === "active" && new Date(l.occurred_at).getTime() >= cutoff);
    const used = count.filter((l) => l.change_amount < 0).reduce((sum,l) => sum-l.change_amount,0);
    const ranked = data.solvents.map((s) => ({ id: s.id, name: s.name, amount: count.filter((l) => scopedStocks.find((stock) => stock.id === l.inventory_id)?.solvent_id === s.id && l.change_amount < 0).reduce((sum,l) => sum-l.change_amount,0) })).filter((item) => item.amount > 0).sort((a,b) => b.amount - a.amount);
    return <>{header("利用履歴分析", "/manage/admin")}<label className="cs-field">期間<select value={analysisDays} onChange={(event) => setAnalysisDays(event.target.value)}><option value="30">1ヶ月</option><option value="90">3ヶ月</option><option value="365">1年</option></select></label>{card(<div className="cs-metrics"><div><small>対象研究室</small><strong>{roomName}</strong></div><div><small>入出庫件数</small><strong>{count.length}件</strong></div><div><small>累計使用量</small><strong>{formatAmount(used)}</strong></div></div>)}<h3 className="cs-section-title">使用量ランキング</h3>{ranked.length ? ranked.map((item) => <div className="cs-card" key={item.id}><div className="cs-record-inline"><span>{item.name}</span><strong>{formatAmount(item.amount)}</strong></div></div>) : card("この期間の使用記録はありません。")}</>;
  }
  if (path === "/manage/admin/master") {
    const saveMaster = async () => {
      if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(masterValue) || Number(masterValue) <= 0 || Number(masterValue) >= 100000000 || !masterOperator.trim() || !masterReason.trim()) { setMasterError("指定数量（小数第2位まで）・実操作者名・理由を入力してください。"); return; }
      if (!window.confirm("指定数量を変更しますか？")) return;
      setMasterError(""); setManageSaving(true);
      try {
        if (preview) mutateDemo((current) => ({ ...current, solvents: current.solvents.map((solvent) => solvent.id === masterEditId ? { ...solvent, designated_quantity: Number(masterValue) } : solvent) }));
        else await ctx.runAdminManagementCommand("update_designated", masterEditId, { designatedQuantity: masterValue, operatorName: masterOperator.trim(), reason: masterReason.trim() });
        setMasterEditId("");
      } catch (cause) { setMasterError(cause instanceof Error ? cause.message : "保存に失敗しました。"); }
      finally { setManageSaving(false); }
    };
    return <>{header("溶媒マスタ管理", "/manage/admin")}{data.solvents.map((s) => <div className="cs-card" key={s.id}><div className="cs-record-inline"><strong>{s.name}</strong>{data.account.role === "global_admin" && <button className="cs-small-button" onClick={() => { setMasterEditId(s.id); setMasterValue(String(s.designated_quantity ?? "")); setMasterOperator(""); setMasterReason(""); setMasterError(""); }}>編集</button>}</div><small>CAS: {s.cas_number || "—"}　指定数量: {s.designated_quantity == null ? "未設定" : formatAmount(s.designated_quantity)}</small></div>)}{masterEditId && <div className="cs-overlay"><div ref={extraModalRef} className="cs-modal" role="dialog" aria-modal="true" aria-label="指定数量の編集"><h2>{solventName(masterEditId)}の指定数量</h2><p className="cs-muted">法令値を確認して入力してください。</p><label className="cs-field">指定数量（L）<input type="number" min="0.01" step="0.01" value={masterValue} onChange={(event) => setMasterValue(event.target.value)} /></label><label className="cs-field">実操作者名 <em>必須</em><input value={masterOperator} onChange={(event) => setMasterOperator(event.target.value)} maxLength={100} /></label><label className="cs-field">変更理由 <em>必須</em><input value={masterReason} onChange={(event) => setMasterReason(event.target.value)} maxLength={200} /></label>{masterError && <p className="cs-message" role="alert">{masterError}</p>}<div className="cs-pair">{button("キャンセル", () => setMasterEditId(""), true, manageSaving)}{button("確認して保存", () => { void saveMaster(); }, false, manageSaving)}</div></div></div>}</>;
  }
  if (path === "/manage/admin/settings") {
    const warning = data.adminManagement?.warningRatio ?? data.adminOverview?.warningRatio ?? 0.8;
    const saveSetting = async () => {
      const valid = settingEdit === "warning_ratio"
        ? /^(?:0\.\d+)$/.test(settingValue) && Number(settingValue) > 0 && Number(settingValue) < 1
        : /^\d{1,3}$/.test(settingValue) && Number(settingValue) >= 1 && Number(settingValue) <= 365;
      if (!valid || !settingOperator.trim() || !settingReason.trim()) { setSettingError("値・実操作者名・理由を確認してください。"); return; }
      if (!window.confirm("設定を変更しますか？")) return;
      setSettingSaving(true); setSettingError("");
      try {
        if (preview) mutateDemo((current) => ({ ...current,
          settings: settingEdit === "forecast_window_days" ? { ...current.settings, forecastWindowDays: Number(settingValue) } : current.settings,
          adminManagement: { solvents: current.solvents.map((solvent) => ({ id: solvent.id, designatedQuantity: solvent.designated_quantity ?? null })), warningRatio: settingEdit === "warning_ratio" ? Number(settingValue) : warning, forecastWindowDays: settingEdit === "forecast_window_days" ? Number(settingValue) : current.settings.forecastWindowDays },
        }));
        else await ctx.runAdminManagementCommand("update_setting", settingEdit, { value: settingValue, operatorName: settingOperator.trim(), reason: settingReason.trim() });
        setSettingEdit("");
      } catch (cause) { setSettingError(cause instanceof Error ? cause.message : "保存に失敗しました。"); }
      finally { setSettingSaving(false); }
    };
    return <>{header("各種設定", "/manage/admin")}{card(<><h2>表示・予測設定</h2><div className="cs-record-inline"><span>早期警告倍率</span><strong>{warning} 倍</strong></div><div className="cs-record-inline"><span>予測参照期間</span><strong>{data.settings.forecastWindowDays} 日</strong></div><div className="cs-record-inline"><span>ガロン換算</span><strong>{data.settings.unitGalToL} L</strong></div><div className="cs-record-inline"><span>斗缶換算</span><strong>{data.settings.unitTokanToL} L</strong></div></>)}{data.account.role === "global_admin" && <div className="cs-actions">{button("早期警告倍率を変更", () => { setSettingEdit("warning_ratio"); setSettingValue(String(warning)); setSettingOperator(""); setSettingReason(""); setSettingError(""); })}{button("予測参照期間を変更", () => { setSettingEdit("forecast_window_days"); setSettingValue(String(data.settings.forecastWindowDays)); setSettingOperator(""); setSettingReason(""); setSettingError(""); }, true)}</div>}{linkRow("指定数量モニター", "/manage/admin/designated-quantity", <AlertTriangle size={20} />)}<p className="cs-muted">早期警告倍率はアプリ独自の表示基準です。</p>{settingEdit && <div className="cs-overlay"><div ref={extraModalRef} className="cs-modal" role="dialog" aria-modal="true" aria-label="設定の変更"><h2>{settingEdit === "warning_ratio" ? "早期警告倍率" : "予測参照期間"}を変更</h2><label className="cs-field">新しい値 {settingEdit === "warning_ratio" ? "（0より大きく1未満）" : "（1〜365日）"}<input type="number" step={settingEdit === "warning_ratio" ? "0.01" : "1"} value={settingValue} onChange={(event) => setSettingValue(event.target.value)} /></label><label className="cs-field">実操作者名 <em>必須</em><input value={settingOperator} onChange={(event) => setSettingOperator(event.target.value)} maxLength={100} /></label><label className="cs-field">変更理由 <em>必須</em><input value={settingReason} onChange={(event) => setSettingReason(event.target.value)} maxLength={200} /></label>{settingError && <p className="cs-message" role="alert">{settingError}</p>}<div className="cs-pair">{button("キャンセル", () => setSettingEdit(""), true, settingSaving)}{button("保存", () => { void saveSetting(); }, false, settingSaving)}</div></div></div>}</>;
  }
  if (path === "/manage/admin/designated-quantity") {
    const ratio = preview ? data.notices[0]?.ratio ?? 0 : data.adminOverview?.totalRatio;
    const warning = data.adminManagement?.warningRatio ?? data.adminOverview?.warningRatio ?? 0.8;
    return <>{header("指定数量モニター", "/manage/admin")}{ratio == null ? card("倍率を取得できませんでした。") : <>
      {card(<div className={`cs-dq ${ratio >= 1 ? "cs-dq-exceeded" : ratio >= warning ? "cs-dq-warning" : ""}`}><small>溶媒庫 合算倍率</small><strong>{Number(ratio).toFixed(3)} 倍</strong><span>{ratio >= 1 ? "⚠ 基準超過" : ratio >= warning ? "⚠ 接近" : "基準内"}</span><small>接近の表示基準：{warning}倍（ChemStock独自の早期警告）</small></div>)}
      {linkRow(`未確認の通知 ${unreadCount}件`, "/manage/admin/notifications", <Bell size={20} />)}
      {preview ? <p className="cs-muted">画面確認用の表示例です。</p> : <>
        <h3 className="cs-section-title">溶媒別の内訳</h3>
        {data.adminOverview?.breakdown.length ? data.adminOverview.breakdown.map((item) =>
          <div className="cs-card cs-record-inline" key={item.solventId}><span>{item.solventName}　{formatAmount(Number(item.amount))}</span><strong>{Number(item.ratio).toFixed(2)} 倍</strong></div>
        ) : card("指定数量を集計できる在庫はありません。")}
        {!!data.adminOverview?.unconfiguredSolvents.length && card(<><strong>指定数量が未設定の溶媒</strong>{data.adminOverview.unconfiguredSolvents.map((item) => <p key={item.solventId}>{item.solventName}：{formatAmount(Number(item.amount))}</p>)}</>)}
      </>}
    </>}</>;
  }
  return <>{header("画面が見つかりません", "/protected")}{card("指定された画面はありません。")}</>;
}
