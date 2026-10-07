"use client";

import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useChemstock } from "./chemstock-provider";
import { formatAmount, Stock } from "@/lib/chemstock-ui";
import { StockRisk, stockRiskText } from "@/lib/stock-risk";

const reasonLabels: Record<string, string> = {
  history_quality_unverified: "出庫履歴の確認が完了していません。",
  history_changed_since_review: "確認後に過去の履歴が変更されています。再確認が必要です。",
  history_too_short: "確認できる記録期間が90日未満です。",
  too_few_outbound_days: "出庫のあった日区間が10未満です。",
  too_few_non_overlapping_windows: "使用できる非重複の7日間区間が12未満です。",
  ledger_mismatch: "現在量と入出庫履歴の残高が一致していません。",
  invalid_history_balance: "過去の残量を正しく復元できません。",
};
const when = (value: string) => new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const matches = (risk: StockRisk, stock: Stock) => risk.currentAmount === stock.amount && risk.lowStockThreshold === stock.low_stock_threshold && stock.is_active;

function RiskConfirmation({ title, description, onCancel, onConfirm }: { title: string; description: string; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>("button");
    buttons?.[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
      if (event.key !== "Tab" || !buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [onCancel]);
  return <div className="cs-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <div className="cs-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2><p>{description}</p>
      <div className="cs-pair"><button type="button" className="cs-button cs-secondary" onClick={onCancel}>キャンセル</button><button type="button" className="cs-button" onClick={onConfirm}>確定</button></div>
    </div>
  </div>;
}

export function StockRiskDetails({ stock }: { stock: Stock }) {
  const ctx = useChemstock();
  if (!ctx.stockRiskEnabled || !stock.is_active) return null;
  const risk = ctx.stockRisks.find((item) => item.inventoryId === stock.id);
  if (risk?.status === "already_below_threshold") return null;
  return <section className="cs-card cs-risk" aria-label="7日間の出庫を踏まえた見通し">
    <h3>7日間の出庫を踏まえた見通し</h3>
    {ctx.riskLoading ? <p role="status">見通しを更新しています…</p> : ctx.error || ctx.riskError || !risk || !matches(risk, stock) ? <><p>見通しを確認できません。画面を更新してください。</p><button className="cs-small-button" onClick={ctx.refresh}>更新</button></> : <>
      {risk.marginAmount != null && risk.marginAmount > 0 && <p>下限まで <strong>{formatAmount(risk.marginAmount)}</strong></p>}
      <p>{stockRiskText(risk)}</p>
      {risk.reasonCodes.map((code) => <p className="cs-muted" key={code}>{reasonLabels[code] || "履歴の日時・数量・確認期間を確認してください。"}</p>)}
      {risk.status === "ready" && <p className="cs-muted">補充がない場合の参考として、使用予定と残量を確認してください。</p>}
      {risk.referenceDays != null && <details className="cs-risk-evidence"><summary>計算の根拠</summary>
        <dl><dt>参照期間</dt><dd>{risk.referenceDays}日（{risk.historyStartAt && when(risk.historyStartAt)}〜{when(risk.historyEndAt)}）</dd>
          <dt>使用した7日間の区間</dt><dd>{risk.sampleWindowCount}区間{risk.reachedWindowCount != null && ` ／ 余裕量以上の出庫 ${risk.reachedWindowCount}区間`}</dd>
          <dt>出庫のあった日区間</dt><dd>{risk.outboundDayCount}区間</dd><dt>非重複の7日間区間</dt><dd>{risk.nonOverlappingWindowCount}区間</dd>
          <dt>除外した区間</dt><dd>{risk.excludedWindowCount}区間{risk.excludedWindowCount ? "（在庫ゼロが継続した期間）" : ""}</dd>
          {risk.windowOutbound && <><dt>7日間出庫量の中央値</dt><dd>{formatAmount(risk.windowOutbound.median)}</dd><dt>95%点</dt><dd>{formatAmount(risk.windowOutbound.p95)}</dd><dt>最大値</dt><dd>{formatAmount(risk.windowOutbound.max)}</dd></>}
          <dt>計算日時（日本時間）</dt><dd>{when(risk.generatedAt)}</dd></dl>
        <p className="cs-muted">7日間の区間は1日ずつずらしているため、同じ出庫が複数区間に含まれます。割合は過去の出庫に基づくもので、将来の確率や安全の保証ではありません。</p>
      </details>}
    </>}
  </section>;
}

export function StockRiskHomeRows({ stocks }: { stocks: Stock[] }) {
  const ctx = useChemstock();
  const low = stocks.filter((stock) => stock.is_active && stock.low_stock_threshold != null && stock.amount <= stock.low_stock_threshold);
  const risks = !ctx.stockRiskEnabled || ctx.riskLoading || ctx.error || ctx.riskError ? [] : ctx.stockRisks.filter((risk) => risk.status === "ready" && risk.needsAttention && stocks.some((stock) => stock.id === risk.inventoryId && matches(risk, stock)))
    .sort((a, b) => b.reachedWindowCount! * a.sampleWindowCount! - a.reachedWindowCount! * b.sampleWindowCount! || a.inventoryId.localeCompare(b.inventoryId));
  if (!low.length && !risks.length) return null;
  const name = (stock: Stock) => ctx.data?.solvents.find((item) => item.id === stock.solvent_id)?.name || "不明な溶媒";
  const row = (risk: StockRisk) => {
    const stock = stocks.find((item) => item.id === risk.inventoryId)!;
    return <Link className="cs-alert-row cs-risk-row" href={ctx.href(`/inventory/detail/${stock.id}`)} key={stock.id}><span><strong>{name(stock)}：使用予定を確認</strong><small>{stockRiskText(risk)}</small></span><ChevronRight size={15} /></Link>;
  };
  return <div className="cs-card cs-alert cs-risk-home"><strong className="cs-alert-title"><AlertTriangle size={18} />在庫のお知らせ</strong>
    {low.map((stock) => <Link className="cs-alert-row" href={ctx.href(`/inventory/detail/${stock.id}`)} key={stock.id}>{name(stock)}：下限以下（残量 {formatAmount(stock.amount)}）<ChevronRight size={15} /></Link>)}
    {risks.length > 0 && <><p className="cs-muted">7日間の出庫を踏まえた見通し</p>{risks.slice(0, 3).map(row)}{risks.length > 3 && <details><summary>他{risks.length - 3}件</summary>{risks.slice(3).map(row)}</details>}</>}
  </div>;
}

export function StockRiskQualityControl({ stock }: { stock: Stock }) {
  const ctx = useChemstock();
  const [from, setFrom] = useState(() => new Date(Math.ceil(new Date(stock.opened_at).getTime() / 1000) * 1000 + 9 * 3600000).toISOString().slice(0, 19));
  const [operator, setOperator] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingEligible, setPendingEligible] = useState<boolean | null>(null);
  const sending = useRef(false);
  if (ctx.data?.account.role !== "global_admin" || !ctx.stockRiskAvailable) return null;
  const save = async (eligible: boolean, confirmed = false) => {
    if (sending.current) return;
    const date = new Date(`${from}+09:00`);
    if (!operator.trim() || !reason.trim() || (eligible && (!Number.isFinite(date.getTime()) || date.getTime() < Date.parse(stock.opened_at) || date.getTime() > Date.now()))) { setError("確認期間・実操作者名・理由を入力してください。"); return; }
    if (!ctx.preview && !stock.last_updated) { setError("更新日時を取得できません。画面を更新してください。"); return; }
    if (!confirmed) { setError(""); setSaved(""); setPendingEligible(eligible); return; }
    setPendingEligible(null);
    sending.current = true; setSaving(true); setError(""); setSaved("");
    try {
      await ctx.runStockRiskCommand("quality", stock.id, { eligible, verifiedFrom: eligible ? date.toISOString() : null, operatorName: operator.trim(), reason: reason.trim(), expectedLastUpdated: stock.last_updated });
      setOperator(""); setReason("");
      setSaved(eligible ? "履歴の確認を保存しました。" : "確認対象から外しました。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存できませんでした。"); }
    finally { sending.current = false; setSaving(false); }
  };
  return <details className="cs-card cs-risk-quality"><summary>見通しに使う履歴を確認（全体管理者）</summary><p className="cs-muted">出庫・訂正の記録に漏れがないことを確認した期間を指定します。確認内容と理由を監査に残します。</p>
    <form onSubmit={(event) => { event.preventDefault(); void save(true); }}><label className="cs-field">確認した期間の開始（日本時間）<input type="datetime-local" step="1" value={from} onChange={(event) => setFrom(event.target.value)} required /></label>
      <label className="cs-field">実操作者名 <em>必須</em><input value={operator} maxLength={100} onChange={(event) => setOperator(event.target.value)} required /></label>
      <label className="cs-field">確認内容・理由 <em>必須</em><input value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} required /></label>
      {error && <p className="cs-message" role="alert">{error}</p>}{saved && <p role="status">{saved}</p>}<div className="cs-actions"><button className="cs-button" disabled={saving || !stock.is_active}>確認済みとして保存</button><button type="button" className="cs-button cs-secondary" disabled={saving} onClick={() => { void save(false); }}>確認対象から外す</button></div></form>
    {pendingEligible !== null && <RiskConfirmation title={pendingEligible ? "履歴の確認を保存しますか？" : "確認対象から外しますか？"} description={pendingEligible ? "指定した期間の出庫履歴を確認済みとして、実操作者名と理由を記録します。" : "この在庫の見通し表示を抑止し、実操作者名と理由を記録します。"} onCancel={() => setPendingEligible(null)} onConfirm={() => { void save(pendingEligible, true); }} />}
  </details>;
}

export function StockRiskEnableControl() {
  const ctx = useChemstock();
  const [operator, setOperator] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);
  const sending = useRef(false);
  if (ctx.data?.account.role !== "global_admin" || !ctx.stockRiskAvailable) return null;
  const save = async (enabled: boolean, confirmed = false) => {
    if (sending.current) return;
    if (!operator.trim() || !reason.trim()) { setError("実操作者名と理由を入力してください。"); return; }
    if (!confirmed) { setError(""); setPendingEnabled(enabled); return; }
    setPendingEnabled(null); sending.current = true; setSaving(true); setError("");
    try { await ctx.runStockRiskCommand("enable", null, { enabled, operatorName: operator.trim(), reason: reason.trim() }); setOperator(""); setReason(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "保存できませんでした。"); }
    finally { sending.current = false; setSaving(false); }
  };
  return <details className="cs-card cs-risk-quality"><summary>下限の見通し（試行）：{ctx.stockRiskEnabled ? "有効" : "無効"}</summary><p className="cs-muted">7日間の出庫量を使う方式を試行します。表示できるのは確認済みの履歴が十分にある在庫です。期間と表示条件は検証用の仮値です。</p>
    <form onSubmit={(event) => { event.preventDefault(); void save(!ctx.stockRiskEnabled); }}><label className="cs-field">実操作者名 <em>必須</em><input value={operator} onChange={(event) => setOperator(event.target.value)} maxLength={100} required /></label><label className="cs-field">変更理由 <em>必須</em><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} required /></label>
      {error && <p className="cs-message" role="alert">{error}</p>}<button className="cs-button" disabled={saving}>{ctx.stockRiskEnabled ? "無効にする" : "有効にする"}</button></form>
    {pendingEnabled !== null && <RiskConfirmation title={pendingEnabled ? "下限の見通しを有効にしますか？" : "下限の見通しを無効にしますか？"} description="変更内容・実操作者名・理由を記録します。" onCancel={() => setPendingEnabled(null)} onConfirm={() => { void save(pendingEnabled, true); }} />}
  </details>;
}
