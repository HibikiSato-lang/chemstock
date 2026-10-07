import type { DataSet, StockRiskReviewState } from "./chemstock-ui";

export function withDemoVersions(data: DataSet): DataSet {
  return { ...data,
    stocks: data.stocks.map((stock) => ({ ...stock, last_updated: stock.last_updated || stock.opened_at })),
    logs: data.logs.map((log) => ({ ...log, created_at: log.created_at || log.occurred_at,
      updated_at: log.updated_at || log.created_at || log.occurred_at })),
  };
}

export function sameVersion(left?: string, right?: string): boolean {
  // PostgreSQL revisions can differ within one millisecond.
  const micros = (value: string) => (value.match(/:\d{2}\.(\d+)/)?.[1] || "").padEnd(6, "0").slice(3, 6);
  return !!left && !!right && Date.parse(left) === Date.parse(right) && micros(left) === micros(right);
}

export function localDateTime(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}

export function reviewStartInput(value: string): string {
  const fraction = value.match(/:\d{2}\.(\d+)/)?.[1] || "";
  const milliseconds = Date.parse(value);
  const rounded = /[1-9]/.test(fraction) ? Math.floor(milliseconds / 1000) * 1000 + 1000 : milliseconds;
  return new Date(rounded + 9 * 3600000).toISOString().slice(0, 19);
}

// An untouched datetime field must preserve fractional seconds and its original offset.
export function editedOccurredAt(original: string, input: string): string {
  return input === localDateTime(original) ? original : new Date(input).toISOString();
}

export function demoReviewState(data: DataSet, inventoryId: string): StockRiskReviewState | undefined {
  const stock = data.stocks.find((item) => item.id === inventoryId);
  if (!stock?.last_updated) return undefined;
  const audit = data.audits.filter((item) => item.target_type === "inventory" && item.target_id === inventoryId && item.action === "stock_risk_quality")
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0];
  return { inventoryId, inventoryLastUpdated: stock.last_updated, auditId: audit?.id || null,
    eligible: audit?.after_value.eligible === true,
    verifiedFrom: audit?.after_value.verifiedFrom as string | null ?? null,
    verifiedAt: audit?.after_value.verifiedAt as string | null ?? null,
    operatorName: audit?.operator_name || null, reason: audit?.reason || null };
}

export function activateDemoStock(data: DataSet, roomId: string, solventId: string, operatorName: string, reason: string, now = new Date().toISOString()): DataSet {
  const before = data.stocks.find((item) => item.room_id === roomId && item.solvent_id === solventId);
  if (before?.is_active) return data;
  const after = before ? { ...before, is_active: true, last_updated: now } : {
    id: crypto.randomUUID(), room_id: roomId, solvent_id: solventId, amount: 0, opening_amount: 0,
    opened_at: now, last_updated: now, low_stock_threshold: null, is_active: true,
  };
  return { ...data, stocks: before ? data.stocks.map((item) => item.id === before.id ? after : item) : [...data.stocks, after],
    audits: [{ id: crypto.randomUUID(), account_id: data.account.id, target_type: "inventory", target_id: after.id,
      action: before ? "reactivate" : "activate", operator_name: operatorName, reason,
      before_value: before ? { inventory: before } : {}, after_value: { inventory: after }, created_at: now }, ...data.audits] };
}
