import type { DataSet, StockLog } from "./chemstock-ui";

// Explicit preview scenario; it is never submitted to the database.
export function withStockRiskSample(data: DataSet, now = new Date()): DataSet {
  const stock = data.stocks.find((item) => item.id === "stock-methanol");
  if (!stock) return data;
  const ago = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();
  const openedAt = new Date(now.getTime() - 180 * 86400000 - 1000).toISOString();
  const logs: StockLog[] = Array.from({ length: 22 }, (_, i) => ({
    id: `risk-sample-${i}`, inventory_id: stock.id, change_amount: -2.5, operator_name: "表示例",
    purpose: "見通しの表示確認用（合成データ）", status: "active", occurred_at: ago(i * 7 + 1),
    created_at: ago(i * 7 + 1), updated_at: ago(i * 7 + 1),
  }));
  const sampleStock = { ...stock, opening_amount: 61, amount: 6, low_stock_threshold: 4, opened_at: openedAt, last_updated: now.toISOString(), is_active: true };
  return {
    ...data, settings: { ...data.settings, stockRiskAvailable: true, stockRiskEnabled: true },
    stocks: data.stocks.map((item) => item.id === stock.id ? sampleStock : item),
    logs: [...data.logs.filter((item) => item.inventory_id !== stock.id), ...logs],
    audits: [...data.audits.filter((item) => !(item.target_type === "inventory" && item.target_id === stock.id) && !(item.target_type === "log" && data.logs.some((log) => log.id === item.target_id && log.inventory_id === stock.id))), {
      id: crypto.randomUUID(), account_id: data.account.id, target_type: "inventory", target_id: stock.id,
      action: "stock_risk_quality", operator_name: "表示例", reason: "合成データの表示確認",
      before_value: {}, after_value: { eligible: true, verifiedFrom: openedAt, verifiedAt: now.toISOString() }, created_at: now.toISOString(),
    }],
  };
}
