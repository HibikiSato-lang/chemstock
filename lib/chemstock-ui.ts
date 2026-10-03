export type Role = "lab" | "solvent_room_admin" | "global_admin";
export type Room = { id: string; name: string };
export type Solvent = { id: string; name: string; cas_number: string | null; formula: string | null; molecular_weight: string | null; designated_quantity?: number | null };
export type Stock = { id: string; room_id: string; solvent_id: string; amount: number; opening_amount: number; opened_at: string; low_stock_threshold: number | null; is_active: boolean; last_updated?: string };
export type StockLog = { id: string; inventory_id: string; change_amount: number; operator_name: string; purpose: string | null; status: "active" | "cancelled"; occurred_at: string };
export type DemoAudit = { id: string; account_id: string; target_type: "log" | "inventory" | "notification"; target_id: string; action: "cancel" | "correct" | "threshold" | "deactivate" | "status_change"; operator_name: string; reason: string; before_value: Record<string, unknown>; after_value: Record<string, unknown>; created_at: string };
export type Notice = { id: string; message: string; ratio: number; status: "unread" | "acknowledged" | "resolved"; notified_at: string };
export type AdminOverview = { totalRatio: number; warningRatio: number; state: "normal" | "warning" | "exceeded"; breakdown: { solventId: string; solventName: string; amount: number; baseUnit: "L"; designatedQuantity: number; ratio: number }[]; unconfiguredSolvents: { solventId: string; solventName: string; amount: number }[]; unreadNotificationCount: number; notifications: Notice[] };
export type AdminEmailStatus = { enabled: boolean; recipientEmail: string | null; senderEmail: string | null; pendingCount: number; acceptedCount: number; failedCount: number; recentFailures: { notificationId: string; errorCode: string; updatedAt: string }[] };
export type AdminManagement = { solvents: { id: string; designatedQuantity: number | null }[]; warningRatio: number; forecastWindowDays: number };
export type Account = { id: string; room_id: string | null; role: Role; login_id: string };
export type AppSettings = { unitGalToL: number; unitTokanToL: number; forecastWindowDays: number };
export type Forecast = { inventoryId: string; status: "forecast" | "no_outbound_history" | "threshold_not_set" | "already_below_threshold" | "inactive" | "beyond_horizon"; dailyUse: number; daysUntilLow: number | null; forecastAt: string | null };
export type DataSet = { account: Account; rooms: Room[]; solvents: Solvent[]; stocks: Stock[]; logs: StockLog[]; audits: DemoAudit[]; notices: Notice[]; settings: AppSettings; forecasts: Forecast[]; adminOverview?: AdminOverview | null; adminEmailStatus?: AdminEmailStatus | null; adminManagement?: AdminManagement | null };

const now = new Date();
const ago = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();

export const demoData: DataSet = {
  account: { id: "demo-account", room_id: "room-yamada", role: "solvent_room_admin", login_id: "山田研" },
  rooms: [{ id: "room-yamada", name: "山田研" }, { id: "room-suzuki", name: "鈴木研" }],
  solvents: [
    { id: "methanol", name: "メタノール", cas_number: "67-56-1", formula: "CH₄O", molecular_weight: "32.04", designated_quantity: 400 },
    { id: "ethanol", name: "エタノール", cas_number: "64-17-5", formula: "C₂H₆O", molecular_weight: "46.07", designated_quantity: 400 },
    { id: "acetone", name: "アセトン", cas_number: "67-64-1", formula: "C₃H₆O", molecular_weight: "58.08", designated_quantity: 400 },
    { id: "toluene", name: "トルエン", cas_number: "108-88-3", formula: "C₇H₈", molecular_weight: "92.14", designated_quantity: 200 },
    { id: "hexane", name: "ヘキサン", cas_number: "110-54-3", formula: "C₆H₁₄", molecular_weight: "86.18", designated_quantity: 200 },
  ],
  stocks: [
    { id: "stock-methanol", room_id: "room-yamada", solvent_id: "methanol", amount: 32.5, opening_amount: 29.5, opened_at: ago(30), low_stock_threshold: 5, is_active: true },
    { id: "stock-ethanol", room_id: "room-yamada", solvent_id: "ethanol", amount: 18, opening_amount: 20, opened_at: ago(30), low_stock_threshold: 5, is_active: true },
    { id: "stock-acetone", room_id: "room-yamada", solvent_id: "acetone", amount: 2, opening_amount: 3, opened_at: ago(30), low_stock_threshold: 5, is_active: true },
    { id: "stock-toluene", room_id: "room-yamada", solvent_id: "toluene", amount: 1.5, opening_amount: 1.5, opened_at: ago(30), low_stock_threshold: 3, is_active: true },
    { id: "stock-other", room_id: "room-suzuki", solvent_id: "methanol", amount: 21, opening_amount: 21, opened_at: ago(30), low_stock_threshold: 4, is_active: true },
  ],
  logs: [
    { id: "log-1", inventory_id: "stock-methanol", change_amount: 3, operator_name: "学生A", purpose: null, status: "active", occurred_at: ago(2) },
    { id: "log-2", inventory_id: "stock-acetone", change_amount: -1, operator_name: "学生B", purpose: "実験", status: "active", occurred_at: ago(4) },
    { id: "log-3", inventory_id: "stock-ethanol", change_amount: -2, operator_name: "学生A", purpose: "洗浄", status: "active", occurred_at: ago(7) },
  ],
  audits: [],
  notices: [{ id: "notice-1", message: "溶媒庫の指定数量の合算倍率が基準を超えました", ratio: 1.08, status: "unread", notified_at: ago(1) }],
  settings: { unitGalToL: 3.8, unitTokanToL: 18, forecastWindowDays: 30 },
  forecasts: [],
  adminEmailStatus: { enabled: false, recipientEmail: null, senderEmail: null, pendingCount: 0, acceptedCount: 0, failedCount: 0, recentFailures: [] },
};

export const formatAmount = (amount: number) => `${Number(amount.toFixed(2)).toLocaleString("ja-JP")} L`;
export const formatDate = (value: string) => new Date(value).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
export const toLitres = (amount: number, unit: string, settings: AppSettings) => amount * (unit === "gal" ? settings.unitGalToL : unit === "斗缶" ? settings.unitTokanToL : 1);

export function movementAmount(value: string, unit: string, settings: AppSettings): number | null {
  if (!/^(?:\d+)(?:\.\d{1,4})?$/.test(value)) return null;
  const amount = Number(value);
  const litres = toLitres(amount, unit, settings);
  if (!Number.isFinite(litres) || litres <= 0 || litres >= 100000000) return null;
  const rounded = Math.round((litres + Number.EPSILON) * 100) / 100;
  return rounded > 0 && rounded < 100000000 ? rounded : null;
}

export function previewForecast(stock: Stock, logs: StockLog[], settings: AppSettings, now = new Date()): Forecast {
  const base: Forecast = { inventoryId: stock.id, status: "no_outbound_history", dailyUse: 0, daysUntilLow: null, forecastAt: null };
  if (!stock.is_active) return { ...base, status: "inactive" };
  if (stock.low_stock_threshold == null) return { ...base, status: "threshold_not_set" };
  if (stock.amount <= stock.low_stock_threshold) return { ...base, status: "already_below_threshold" };
  const start = now.getTime() - settings.forecastWindowDays * 86400000;
  const used = logs.filter((log) => log.inventory_id === stock.id && log.status === "active" && log.change_amount < 0 && new Date(log.occurred_at).getTime() >= start && new Date(log.occurred_at).getTime() <= now.getTime()).reduce((total, log) => total - log.change_amount, 0);
  if (used <= 0) return base;
  const dailyUse = used / settings.forecastWindowDays;
  const daysUntilLow = (stock.amount - stock.low_stock_threshold) / dailyUse;
  if (daysUntilLow > 365) return { ...base, status: "beyond_horizon", dailyUse };
  return { inventoryId: stock.id, status: "forecast", dailyUse, daysUntilLow, forecastAt: new Date(now.getTime() + daysUntilLow * 86400000).toISOString() };
}
