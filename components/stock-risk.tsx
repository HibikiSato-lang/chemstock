"use client";

import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useChemstock } from "./chemstock-provider";
import { formatAmount, Stock, StockRiskReviewState } from "@/lib/chemstock-ui";
import { demoReviewState, reviewStartInput, sameVersion } from "@/lib/inventory-review";
import { STOCK_RISK_METHOD, StockRisk, stockRiskText } from "@/lib/stock-risk";

const reasonLabels: Record<string, string> = {
  history_quality_unverified: "出庫履歴の確認が完了していません。",
  history_changed_since_review: "確認後に過去の履歴が変更されています。再確認が必要です。",
  history_too_short: "確認できる完全な日次記録が2日未満です。",
  too_few_outbound_days: "出庫間隔を計算するため、異なる2日以上の出庫が必要です。",
  ledger_mismatch: "現在量と入出庫履歴の残高が一致していません。",
  invalid_history_balance: "過去の残量を正しく復元できません。",
};
const when = (value: string) => new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const matches = (risk: StockRisk, stock: Stock) => risk.methodVersion === STOCK_RISK_METHOD && risk.currentAmount === stock.amount && risk.lowStockThreshold === stock.low_stock_threshold && stock.is_active;
const forecastAmount = (amount: number) => Math.abs(amount) > 0 && Math.abs(amount) < 0.01 ? "0.01 L未満" : formatAmount(Math.abs(amount));

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
  return <section className="cs-card cs-risk" aria-label="7日間の予測出庫量">
    <h3>7日間の予測出庫量（試行）</h3>
    {ctx.riskLoading ? <p role="status">見通しを更新しています…</p> : ctx.error || ctx.riskError || !risk || !matches(risk, stock) ? <><p>見通しを確認できません。画面を更新してください。</p><button className="cs-small-button" onClick={ctx.refresh}>更新</button></> : <>
      {risk.marginAmount != null && risk.marginAmount > 0 && <p>下限まで <strong>{formatAmount(risk.marginAmount)}</strong></p>}
      <p>{stockRiskText(risk)}</p>
      {risk.status === "ready" && <p>{risk.forecastMarginAmount! > 0 ? <>予測出庫後、下限までの余裕：約 <strong>{forecastAmount(risk.forecastMarginAmount!)}</strong></> : risk.forecastMarginAmount === 0 ? <strong>予測出庫後は下限と同じ量になります。</strong> : <>予測出庫後、下限に対する不足：約 <strong>{forecastAmount(risk.forecastMarginAmount!)}</strong></>}</p>}
      {ctx.data?.account.role !== "global_admin" && risk.reasonCodes.some((code) => code === "history_quality_unverified" || code === "history_changed_since_review") && <p className="cs-muted">全体管理者に履歴の確認を依頼してください。</p>}
      {risk.reasonCodes.map((code) => <p className="cs-muted" key={code}>{reasonLabels[code] || "履歴の日時・数量・確認期間を確認してください。"}</p>)}
      {risk.status === "ready" && <p className="cs-muted">補充がなく、過去と同様の出庫が続く場合の平均的な見積もりです。次の出庫日・1回の出庫量は予測していません。</p>}
      {risk.referenceDays != null && <details className="cs-risk-evidence"><summary>計算の根拠</summary>
        <dl><dt>参照期間</dt><dd>{risk.referenceDays}日（{risk.historyStartAt && when(risk.historyStartAt)}〜{when(risk.historyEndAt)}）</dd>
          <dt>出庫があった日</dt><dd>{risk.outboundDayCount}日</dd>
          {risk.lastOutboundAt && <><dt>最後の出庫（参照期間内）</dt><dd>{when(risk.lastOutboundAt)}</dd></>}
          {risk.status === "ready" && <><dt>平滑化した日別出庫量</dt><dd>{forecastAmount(risk.smoothedOutboundSize!)}</dd><dt>平滑化した出庫間隔</dt><dd>{risk.smoothedIntervalDays?.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}日</dd></>}
          <dt>予測手法</dt><dd>SBA法（Syntetos–Boylan Approximation）</dd><dt>平滑化係数（試行値）</dt><dd>{risk.smoothingAlpha}</dd>
          <dt>計算日時（日本時間）</dt><dd>{when(risk.generatedAt)}</dd></dl>
        <p className="cs-muted">日本時間の前日までの記録を使用します。2日以上の出庫は計算上の条件であり、精度を保証する条件ではありません。出庫の停止・研究計画の変更には追随しにくい手法です。</p>
        {risk.exclusionReasonCodes.includes("stockout_restart") && <p className="cs-muted">在庫ゼロが継続したため、補充後の完全な日次記録から計算し直しています。</p>}
        <p className="cs-muted"><a href="https://doi.org/10.1016/j.ijforecast.2004.10.001" target="_blank" rel="noreferrer">手法の論文：Syntetos &amp; Boylan（2005）</a>。本システムの実データでの予測精度は未検証です。</p>
      </details>}
    </>}
  </section>;
}

export function StockRiskHomeRows({ stocks }: { stocks: Stock[] }) {
  const ctx = useChemstock();
  const low = stocks.filter((stock) => stock.is_active && stock.low_stock_threshold != null && stock.amount <= stock.low_stock_threshold);
  const risks = !ctx.stockRiskEnabled || ctx.riskLoading || ctx.error || ctx.riskError ? [] : ctx.stockRisks.filter((risk) => risk.status === "ready" && risk.needsAttention && stocks.some((stock) => stock.id === risk.inventoryId && matches(risk, stock)))
    .sort((a, b) => a.forecastMarginAmount! - b.forecastMarginAmount! || a.inventoryId.localeCompare(b.inventoryId));
  if (!low.length && !risks.length) return null;
  const name = (stock: Stock) => ctx.data?.solvents.find((item) => item.id === stock.solvent_id)?.name || "不明な溶媒";
  const row = (risk: StockRisk) => {
    const stock = stocks.find((item) => item.id === risk.inventoryId)!;
    return <Link className="cs-alert-row cs-risk-row" href={ctx.href(`/inventory/detail/${stock.id}`)} key={stock.id}><span><strong>{name(stock)}：使用予定を確認</strong><small>{stockRiskText(risk)}</small></span><ChevronRight size={15} /></Link>;
  };
  return <div className="cs-card cs-alert cs-risk-home"><strong className="cs-alert-title"><AlertTriangle size={18} />在庫のお知らせ</strong>
    {low.length > 0 && <p className="cs-muted">下限以下：{low.length}件</p>}
    {low.slice(0, 3).map((stock) => <Link className="cs-alert-row" href={ctx.href(`/inventory/detail/${stock.id}`)} key={stock.id}>{name(stock)}：下限以下（残量 {formatAmount(stock.amount)}）<ChevronRight size={15} /></Link>)}
    {low.length > 3 && <details><summary>他{low.length - 3}件</summary>{low.slice(3).map((stock) => <Link className="cs-alert-row" href={ctx.href(`/inventory/detail/${stock.id}`)} key={stock.id}>{name(stock)}：下限以下（残量 {formatAmount(stock.amount)}）<ChevronRight size={15} /></Link>)}</details>}
    {risks.length > 0 && <><p className="cs-muted">7日間の予測出庫で下限以下になる見込み（補充なし・試行）</p>{risks.slice(0, 3).map(row)}{risks.length > 3 && <details><summary>他{risks.length - 3}件</summary>{risks.slice(3).map(row)}</details>}</>}
  </div>;
}

export function StockRiskQualityControl({ stock }: { stock: Stock }) {
  const ctx = useChemstock();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<StockRiskReviewState | null>(null);
  const [from, setFrom] = useState(() => reviewStartInput(stock.opened_at));
  const [operator, setOperator] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingEligible, setPendingEligible] = useState<boolean | null>(null);
  const sending = useRef(false);
  if (ctx.data?.account.role !== "global_admin" || !ctx.stockRiskAvailable) return null;
  const review = ctx.preview && ctx.data ? demoReviewState(ctx.data, stock.id) : ctx.data?.stockRiskReviews?.find((item) => item.inventoryId === stock.id);
  const stale = !snapshot || !review || !sameVersion(snapshot.inventoryLastUpdated, stock.last_updated)
    || !sameVersion(review.inventoryLastUpdated, stock.last_updated) || snapshot.auditId !== review.auditId;
  const beginReview = () => {
    setSnapshot(review ? { ...review } : null);
    setFrom(reviewStartInput(review?.verifiedFrom || stock.opened_at));
    setOperator(""); setReason(""); setError(""); setSaved(""); setPendingEligible(null);
  };
  const save = async (eligible: boolean, confirmed = false) => {
    if (sending.current) return;
    if (stale || ctx.error || ctx.riskLoading) { setPendingEligible(null); setError("在庫または確認状態が更新されています。最新の履歴を確認して入力し直してください。"); return; }
    const date = new Date(`${from}+09:00`);
    if (!operator.trim() || !reason.trim() || (eligible && (!Number.isFinite(date.getTime()) || date.getTime() < Date.parse(stock.opened_at) || date.getTime() > Date.now()))) { setError("確認期間・実操作者名・理由を入力してください。"); return; }
    if (!ctx.preview && !stock.last_updated) { setError("更新日時を取得できません。画面を更新してください。"); return; }
    if (!confirmed) { setError(""); setSaved(""); setPendingEligible(eligible); return; }
    setPendingEligible(null);
    sending.current = true; setSaving(true); setError(""); setSaved("");
    try {
      await ctx.runStockRiskCommand("quality", stock.id, { eligible, verifiedFrom: eligible ? date.toISOString() : null, operatorName: operator.trim(), reason: reason.trim(), expectedLastUpdated: snapshot!.inventoryLastUpdated, expectedReviewAuditId: snapshot!.auditId });
      setOperator(""); setReason("");
      setSaved(eligible ? "履歴の確認を保存しました。" : "確認対象から外しました。");
      setOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存できませんでした。"); }
    finally { sending.current = false; setSaving(false); }
  };
  return <><details className="cs-card cs-risk-quality" open={open}><summary onClick={(event) => { event.preventDefault(); if (saving) return; if (!open) beginReview(); setOpen(!open); }}>見通しに使う履歴を確認（全体管理者）：{!review ? "取得できません" : !review.auditId ? "未確認" : review.eligible ? "確認済み" : "確認対象から除外"}</summary>
    <p>現在の確認状態：<strong>{!review ? "取得できません" : !review.auditId ? "未確認" : review.eligible ? "確認済み" : "確認対象から除外"}</strong></p>
    {review?.verifiedAt && <p className="cs-muted">最終確認 {when(review.verifiedAt)} ／ {review.operatorName}<br />{review.verifiedFrom && <>確認期間の開始 {when(review.verifiedFrom)}<br /></>}{review.reason}</p>}
    {stale && <div className="cs-message" role="alert">最新の在庫・履歴と確認状態を確認してください。<button type="button" className="cs-small-button" disabled={saving || ctx.riskLoading || !!ctx.error || !review || !sameVersion(review.inventoryLastUpdated, stock.last_updated)} onClick={beginReview}>最新の履歴を確認して入力し直す</button><button type="button" className="cs-small-button" disabled={saving} onClick={ctx.refresh}>画面を更新</button></div>}<p className="cs-muted">出庫・訂正の記録に漏れがないことを確認した期間を指定します。確認内容と理由を監査に残します。</p>
    <form onSubmit={(event) => { event.preventDefault(); void save(true); }}><label className="cs-field">確認した期間の開始（日本時間）<input type="datetime-local" step="1" value={from} onChange={(event) => setFrom(event.target.value)} required /></label>
      <label className="cs-field">実操作者名 <em>必須</em><input value={operator} maxLength={100} onChange={(event) => setOperator(event.target.value)} required /></label>
      <label className="cs-field">確認内容・理由 <em>必須</em><input value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} required /></label>
      {error && <p className="cs-message" role="alert">{error}</p>}<div className="cs-actions"><button className="cs-button" disabled={saving || stale || !!ctx.error || ctx.riskLoading || !stock.is_active}>確認済みとして保存</button><button type="button" className="cs-button cs-secondary" disabled={saving || stale || !!ctx.error || ctx.riskLoading} onClick={() => { void save(false); }}>確認対象から外す</button></div></form>
    {pendingEligible !== null && <RiskConfirmation title={pendingEligible ? "履歴の確認を保存しますか？" : "確認対象から外しますか？"} description={pendingEligible ? "指定した期間の出庫履歴を確認済みとして、実操作者名と理由を記録します。" : "この在庫の見通し表示を抑止し、実操作者名と理由を記録します。"} onCancel={() => setPendingEligible(null)} onConfirm={() => { void save(pendingEligible, true); }} />}
  </details>{saved && <p className="cs-card cs-muted" role="status">{saved}</p>}</>;
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
  return <details className="cs-card cs-risk-quality"><summary>下限の見通し（試行）：{ctx.stockRiskEnabled ? "有効" : "無効"}</summary><p className="cs-muted">SBA法による7日間の予測出庫量と下限までの余裕を表示します。確認済みの履歴を使います。期間・平滑化係数は試行値で、実データでの予測精度は未検証です。</p>
    <form onSubmit={(event) => { event.preventDefault(); void save(!ctx.stockRiskEnabled); }}><label className="cs-field">実操作者名 <em>必須</em><input value={operator} onChange={(event) => setOperator(event.target.value)} maxLength={100} required /></label><label className="cs-field">変更理由 <em>必須</em><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} required /></label>
      {error && <p className="cs-message" role="alert">{error}</p>}<button className="cs-button" disabled={saving}>{ctx.stockRiskEnabled ? "無効にする" : "有効にする"}</button></form>
    {pendingEnabled !== null && <RiskConfirmation title={pendingEnabled ? "下限の見通しを有効にしますか？" : "下限の見通しを無効にしますか？"} description="変更内容・実操作者名・理由を記録します。" onCancel={() => setPendingEnabled(null)} onConfirm={() => { void save(pendingEnabled, true); }} />}
  </details>;
}
