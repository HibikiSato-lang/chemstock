export const STOCK_RISK_POLICY = Object.freeze({ horizonDays: 7, referenceDays: 365, minHistoryDays: 2, minOutboundDays: 2, alpha: 0.1 });
export const STOCK_RISK_METHOD = "sba_daily_outbound_v1";
const DAY = 86_400_000;
const JST = 9 * 3_600_000;
const dayStart = (time: number) => Math.floor((time + JST) / DAY) * DAY - JST;
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

export type RiskStock = { id: string; amount: number; opening_amount: number; opened_at: string; low_stock_threshold: number | null; is_active: boolean };
export type RiskLog = { id: string; inventory_id: string; change_amount: number; status: "active" | "cancelled"; occurred_at: string; created_at?: string; updated_at?: string };
export type RiskReview = { eligible: boolean; verifiedFrom: string | null; verifiedAt: string; lastInvalidatedAt?: string | null; resumedAt?: string | null };
export type StockRiskStatus = "inactive" | "threshold_not_set" | "already_below_threshold" | "data_quality_issue" | "insufficient_history" | "no_outbound_history" | "sparse_history" | "ready";
export type StockRisk = {
  inventoryId: string; status: StockRiskStatus; currentAmount: number; lowStockThreshold: number | null; marginAmount: number | null; baseUnit: "L";
  horizonDays: number; referenceDays: number | null; historyStartAt: string | null; historyEndAt: string;
  outboundDayCount: number | null; dailyOutboundForecast: number | null; forecastOutboundAmount: number | null;
  forecastMarginAmount: number | null; smoothedOutboundSize: number | null; smoothedIntervalDays: number | null;
  lastOutboundAt: string | null; smoothingAlpha: number; needsAttention: boolean | null;
  reasonCodes: string[]; exclusionReasonCodes: string[]; assumptions: string[]; generatedAt: string; methodVersion: string;
};

// Quantities are cents of a litre; comparisons never use binary fractions of L.
function cents(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const scaled = Math.round(value * 100);
  return Number.isSafeInteger(scaled) && Math.abs(value * 100 - scaled) < 0.00001 ? scaled : null;
}

export function calculateStockRisk(stock: RiskStock, logs: RiskLog[], review: RiskReview | null, asOf: Date = new Date()): StockRisk {
  const t = asOf.getTime();
  if (!Number.isFinite(t)) throw new Error("INVALID_RISK_CLOCK");
  const amount = cents(stock.amount), opening = cents(stock.opening_amount);
  const threshold = stock.low_stock_threshold == null ? null : cents(stock.low_stock_threshold);
  const margin = amount != null && threshold != null ? amount - threshold : null;
  const result: StockRisk = {
    inventoryId: stock.id, status: "data_quality_issue", currentAmount: stock.amount, lowStockThreshold: stock.low_stock_threshold,
    marginAmount: margin == null ? null : margin / 100, baseUnit: "L", horizonDays: STOCK_RISK_POLICY.horizonDays,
    referenceDays: null, historyStartAt: null, historyEndAt: new Date(dayStart(t)).toISOString(),
    outboundDayCount: null, dailyOutboundForecast: null, forecastOutboundAmount: null, forecastMarginAmount: null,
    smoothedOutboundSize: null, smoothedIntervalDays: null, lastOutboundAt: null, smoothingAlpha: STOCK_RISK_POLICY.alpha, needsAttention: null,
    reasonCodes: [], exclusionReasonCodes: [], assumptions: ["no_inbound", "similar_outbound_pattern"],
    generatedAt: asOf.toISOString(), methodVersion: STOCK_RISK_METHOD,
  };
  const state = (status: StockRiskStatus, ...reasons: string[]): StockRisk => ({ ...result, status, reasonCodes: reasons });
  if (!stock.is_active) return state("inactive");
  if (stock.low_stock_threshold == null) return state("threshold_not_set");
  if (amount == null || opening == null || threshold == null || amount < 0 || opening < 0 || threshold < 0) return state("data_quality_issue", "invalid_quantity");
  if (margin! <= 0) return state("already_below_threshold");
  const opened = Date.parse(stock.opened_at);
  if (!Number.isFinite(opened) || opened > t) return state("data_quality_issue", "invalid_history_start");
  if (!review?.eligible || !review.verifiedFrom) return state("data_quality_issue", "history_quality_unverified");
  const verified = Date.parse(review.verifiedAt), from = Date.parse(review.verifiedFrom);
  const resumed = review.resumedAt ? Date.parse(review.resumedAt) : opened;
  if (![verified, from, resumed].every(Number.isFinite) || from < opened || from > verified || verified > t || resumed > t) return state("data_quality_issue", "invalid_quality_review");
  if (review.lastInvalidatedAt && Date.parse(review.lastInvalidatedAt) > verified) return state("data_quality_issue", "history_changed_since_review");

  const all = logs.filter((log) => log.inventory_id === stock.id);
  if (new Set(all.map((log) => log.id)).size !== all.length) return state("data_quality_issue", "duplicate_log");
  const active = all.filter((log) => log.status === "active").map((log) => ({ ...log, time: Date.parse(log.occurred_at), quantity: cents(log.change_amount) }))
    .sort((a, b) => a.time - b.time || (a.created_at || a.occurred_at).localeCompare(b.created_at || b.occurred_at) || a.id.localeCompare(b.id));
  if (active.some((log) => !Number.isFinite(log.time) || log.time < opened || log.time > t || log.quantity == null || log.quantity === 0)) return state("data_quality_issue", "invalid_history_log");
  if (all.some((log) => {
    const recorded = Date.parse(log.created_at || log.occurred_at), updated = Date.parse(log.updated_at || log.created_at || log.occurred_at);
    return updated > verified && (recorded <= verified || Date.parse(log.occurred_at) <= verified || updated > recorded);
  })) return state("data_quality_issue", "history_changed_since_review");

  let balance = opening, cursor = opened;
  const zeroPeriods: [number, number][] = [];
  for (const log of active) {
    if (balance === 0 && log.time > cursor) zeroPeriods.push([cursor, log.time]);
    balance += log.quantity!;
    if (!Number.isSafeInteger(balance) || balance < 0) return state("data_quality_issue", "invalid_history_balance");
    cursor = log.time;
  }
  if (balance !== amount) return state("data_quality_issue", "ledger_mismatch");
  if (balance === 0 && t > cursor) zeroPeriods.push([cursor, t]);
  // Use complete Japanese calendar days. An incomplete first/current day is not
  // a zero-demand observation. Restart after stockouts rather than compress time.
  const end = dayStart(t);
  const zeroEnd = Math.max(0, ...zeroPeriods.filter(([a, b]) => a < end && b > end - STOCK_RISK_POLICY.referenceDays * DAY).map(([, b]) => b));
  const rawStart = Math.max(opened, from, resumed, zeroEnd, end - STOCK_RISK_POLICY.referenceDays * DAY);
  const start = Math.min(end, dayStart(rawStart) + (rawStart === dayStart(rawStart) ? 0 : DAY));
  const W = Math.round((end - start) / DAY);
  result.referenceDays = W;
  result.historyStartAt = new Date(start).toISOString();
  result.exclusionReasonCodes = zeroEnd ? ["stockout_restart"] : [];
  const outbound = active.filter((log) => log.quantity! < 0);
  let z = 0, p = 0, lastDay = -1;
  result.outboundDayCount = 0;
  for (let k = 0; k < W; k++) {
    const day = start + k * DAY;
    const events = outbound.filter((log) => log.time >= day && log.time < day + DAY);
    const used = events.reduce((sum, log) => sum - log.quantity!, 0) / 100;
    if (!used) continue;
    result.outboundDayCount++;
    result.lastOutboundAt = new Date(events[events.length - 1].time).toISOString();
    if (lastDay < 0) z = used;
    else {
      z += STOCK_RISK_POLICY.alpha * (used - z);
      const interval = k - lastDay;
      p = p === 0 ? interval : p + STOCK_RISK_POLICY.alpha * (interval - p);
    }
    lastDay = k;
  }
  if (W < STOCK_RISK_POLICY.minHistoryDays) return state("insufficient_history", "history_too_short");
  if (!result.outboundDayCount) return state("no_outbound_history");
  if (result.outboundDayCount < STOCK_RISK_POLICY.minOutboundDays) return state("sparse_history", "too_few_outbound_days");
  // Croston size/interval smoothing with the Syntetos–Boylan bias correction.
  // Initialization from the first size and first complete interval is our policy;
  // leading zeros before the first occurrence are left-censored, not an interval.
  const rate = (1 - STOCK_RISK_POLICY.alpha / 2) * z / p;
  const forecast = round6(rate * STOCK_RISK_POLICY.horizonDays);
  return {
    ...result, status: "ready", dailyOutboundForecast: round6(rate), forecastOutboundAmount: forecast,
    forecastMarginAmount: round6(margin! / 100 - forecast), smoothedOutboundSize: round6(z), smoothedIntervalDays: round6(p),
    needsAttention: forecast >= margin! / 100,
  };
}

export function stockRiskText(risk: StockRisk): string {
  if (risk.status === "ready") {
    const amount = risk.forecastOutboundAmount!;
    const shown = amount > 0 && amount < 0.01 ? "0.01 L未満" : `${amount.toLocaleString("ja-JP", { maximumFractionDigits: 2 })} L`;
    return `今後${risk.horizonDays}日間の予測出庫量：約${shown}。`;
  }
  if (risk.status === "inactive") return "利用停止中です。";
  if (risk.status === "threshold_not_set") return "下限値が未設定です。";
  if (risk.status === "already_below_threshold") return "下限以下です。";
  if (risk.status === "no_outbound_history") return "参照期間に出庫履歴がありません。";
  if (risk.status === "data_quality_issue") return "履歴の確認が必要なため、見通しを表示できません。";
  return "見通しを表示するための履歴が不足しています。";
}
