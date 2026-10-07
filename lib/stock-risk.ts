export const STOCK_RISK_POLICY = Object.freeze({ horizonDays: 7, referenceDays: 180, minHistoryDays: 90, minOutboundDays: 10, minNonOverlappingWindows: 12, attentionRate: 0.2 });
export const STOCK_RISK_METHOD = "empirical_outbound_window_v1";
const DAY = 86_400_000;

export type RiskStock = { id: string; amount: number; opening_amount: number; opened_at: string; low_stock_threshold: number | null; is_active: boolean };
export type RiskLog = { id: string; inventory_id: string; change_amount: number; status: "active" | "cancelled"; occurred_at: string; created_at?: string; updated_at?: string };
export type RiskReview = { eligible: boolean; verifiedFrom: string | null; verifiedAt: string; lastInvalidatedAt?: string | null; resumedAt?: string | null };
export type StockRiskStatus = "inactive" | "threshold_not_set" | "already_below_threshold" | "data_quality_issue" | "insufficient_history" | "no_outbound_history" | "sparse_history" | "ready";
export type StockRisk = {
  inventoryId: string; status: StockRiskStatus; currentAmount: number; lowStockThreshold: number | null; marginAmount: number | null; baseUnit: "L";
  horizonDays: number; referenceDays: number | null; historyStartAt: string | null; historyEndAt: string;
  candidateWindowCount: number | null; sampleWindowCount: number | null; excludedWindowCount: number | null; reachedWindowCount: number | null;
  historicalReachRate: number | null; outboundDayCount: number | null; nonOverlappingWindowCount: number | null;
  windowOutbound: { median: number; p95: number; max: number } | null; needsAttention: boolean | null;
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
    referenceDays: null, historyStartAt: null, historyEndAt: asOf.toISOString(), candidateWindowCount: null,
    sampleWindowCount: null, excludedWindowCount: null, reachedWindowCount: null, historicalReachRate: null,
    outboundDayCount: null, nonOverlappingWindowCount: null, windowOutbound: null, needsAttention: null,
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
  const W = Math.min(STOCK_RISK_POLICY.referenceDays, Math.floor((t - Math.max(opened, from, resumed)) / DAY));
  const H = STOCK_RISK_POLICY.horizonDays;
  result.referenceDays = W;
  result.historyStartAt = new Date(t - W * DAY).toISOString();
  result.candidateWindowCount = Math.max(0, W - H + 1);
  const valid = (start: number, end: number) => !zeroPeriods.some(([a, b]) => a < end && b > start);
  const outbound = active.filter((log) => log.quantity! < 0);
  const samples: number[] = [];
  let nonOverlapping = 0;
  for (let k = 0; k <= W - H; k++) {
    const end = t - k * DAY, start = end - H * DAY;
    if (!valid(start, end)) continue;
    samples.push(outbound.filter((log) => log.time > start && log.time <= end).reduce((sum, log) => sum - log.quantity!, 0));
    if (k % H === 0) nonOverlapping++;
  }
  result.sampleWindowCount = samples.length;
  result.excludedWindowCount = result.candidateWindowCount - samples.length;
  result.exclusionReasonCodes = result.excludedWindowCount ? ["stockout_period"] : [];
  result.nonOverlappingWindowCount = nonOverlapping;
  result.outboundDayCount = 0;
  for (let k = 0; k < W; k++) {
    const end = t - k * DAY, start = end - DAY;
    if (valid(start, end) && outbound.some((log) => log.time > start && log.time <= end)) result.outboundDayCount++;
  }
  if (W < STOCK_RISK_POLICY.minHistoryDays) return state("insufficient_history", "history_too_short");
  if (!outbound.some((log) => log.time > t - W * DAY && log.time <= t)) return state("no_outbound_history");
  const reasons = [];
  if (result.outboundDayCount < STOCK_RISK_POLICY.minOutboundDays) reasons.push("too_few_outbound_days");
  if (nonOverlapping < STOCK_RISK_POLICY.minNonOverlappingWindows) reasons.push("too_few_non_overlapping_windows");
  if (!samples.length) reasons.push("no_usable_windows");
  if (reasons.length) return state("sparse_history", ...reasons);
  const reached = samples.filter((value) => value >= margin!).length;
  const sorted = samples.sort((a, b) => a - b);
  return {
    ...result, status: "ready", reachedWindowCount: reached, historicalReachRate: Math.round(reached / samples.length * 1e6) / 1e6,
    windowOutbound: { median: sorted[Math.ceil(sorted.length * 0.5) - 1] / 100, p95: sorted[Math.ceil(sorted.length * 0.95) - 1] / 100, max: sorted[sorted.length - 1] / 100 },
    needsAttention: reached * 5 >= samples.length,
  };
}

export function stockRiskText(risk: StockRisk): string {
  const amount = `${risk.marginAmount?.toLocaleString("ja-JP", { maximumFractionDigits: 2 })} L`;
  if (risk.status === "ready") {
    const k = risk.reachedWindowCount!, n = risk.sampleWindowCount!;
    if (k === 0) return `参照した${risk.horizonDays}日間の区間には、${amount}以上の出庫はありません。`;
    if (k === n) return `参照したすべての${risk.horizonDays}日間の区間で、${amount}以上を出庫しています。`;
    const percent = k / n < 0.01 ? "1%未満" : `約${Math.round(k / n * 100)}%`;
    return `過去${risk.referenceDays}日の履歴で、${risk.horizonDays}日分の出庫が余裕量${amount}以上だった割合：${percent}。`;
  }
  if (risk.status === "inactive") return "利用停止中です。";
  if (risk.status === "threshold_not_set") return "下限値が未設定です。";
  if (risk.status === "already_below_threshold") return "下限以下です。";
  if (risk.status === "no_outbound_history") return "参照期間に出庫履歴がありません。";
  if (risk.status === "data_quality_issue") return "履歴の確認が必要なため、見通しを表示できません。";
  return "見通しを表示するための履歴が不足しています。";
}
