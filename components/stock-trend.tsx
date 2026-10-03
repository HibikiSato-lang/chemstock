"use client";

import { Forecast, Stock, StockLog, formatAmount } from "@/lib/chemstock-ui";

export function StockTrend({ stock, logs, forecast, periodDays, name, roomName }: { stock: Stock; logs: StockLog[]; forecast?: Forecast; periodDays: number; name: string; roomName: string }) {
  const now = Date.now();
  const start = Math.max(new Date(stock.opened_at).getTime(), now - periodDays * 86400000);
  const active = logs.filter((log) => log.inventory_id === stock.id && log.status === "active")
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  let amount = stock.opening_amount + active.filter((log) => new Date(log.occurred_at).getTime() < start)
    .reduce((total, log) => total + log.change_amount, 0);
  const points = [{ time: start, amount }];
  for (const log of active) {
    const time = new Date(log.occurred_at).getTime();
    if (time < start || time > now) continue;
    amount += log.change_amount;
    points.push({ time, amount });
  }
  points.push({ time: now, amount: stock.amount });

  const future = forecast?.status === "forecast" && forecast.forecastAt ? new Date(forecast.forecastAt).getTime() : null;
  const end = Math.max(now, future || now);
  const duration = Math.max(1, end - start);
  const ceiling = Math.max(1, stock.low_stock_threshold || 0, ...points.map((point) => point.amount)) * 1.08;
  const x = (time: number) => 38 + (time - start) / duration * 286;
  const y = (litres: number) => 160 - Math.max(0, litres) / ceiling * 132;
  const actualLine = points.map((point) => `${x(point.time)},${y(point.amount)}`).join(" ");
  const stateText = forecast?.status === "forecast" && forecast.forecastAt
    ? `${new Date(forecast.forecastAt).toLocaleDateString("ja-JP", { year: "numeric", month: "numeric", day: "numeric" })}頃に下限到達の見込み`
    : forecast?.status === "already_below_threshold" ? "下限以下"
      : forecast?.status === "threshold_not_set" ? "下限値が未設定です"
        : forecast?.status === "no_outbound_history" ? "期間内の出庫履歴がなく、予測できません"
          : forecast?.status === "beyond_horizon" ? "下限到達は365日より先の見込みです"
            : "予測できる在庫がありません";

  return <>
    <div className="cs-card cs-chart-card">
      <h2 className="cs-chart-title">{roomName} ／ {name}の残量推移</h2>
      <svg className="cs-chart" viewBox="0 0 340 205" role="img" aria-label={`${name}の残量推移。${stateText}`}>
        <line x1="38" y1="160" x2="324" y2="160" stroke="#9db0a6" />
        <line x1="38" y1="20" x2="38" y2="160" stroke="#9db0a6" />
        <text x="2" y="23" fontSize="11" fill="#66766e">{Math.ceil(ceiling)} L</text>
        <text x="18" y="160" fontSize="11" fill="#66766e">0</text>
        {stock.low_stock_threshold != null && <><line x1="38" y1={y(stock.low_stock_threshold)} x2="324" y2={y(stock.low_stock_threshold)} stroke="#bb6d27" strokeWidth="1.5" strokeDasharray="3 3" /><text x="40" y={Math.max(15, y(stock.low_stock_threshold) - 4)} fontSize="10" fill="#9a571f">下限 {formatAmount(stock.low_stock_threshold)}</text></>}
        <polyline points={actualLine} fill="none" stroke="#2e6b58" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {future && stock.low_stock_threshold != null && <><line x1={x(now)} y1={y(stock.amount)} x2={x(future)} y2={y(stock.low_stock_threshold)} stroke="#7c3aed" strokeWidth="2.5" strokeDasharray="6 4" /><circle cx={x(future)} cy={y(stock.low_stock_threshold)} r="4" fill="#7c3aed" /><line x1={x(now)} y1="20" x2={x(now)} y2="160" stroke="#aab8b0" strokeDasharray="2 4" /></>}
        <text x="38" y="184" fontSize="10" fill="#66766e">{new Date(start).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}</text>
        <text x={Math.min(280, Math.max(55, x(now) - 12))} y="184" fontSize="10" fill="#66766e">今日</text>
        {future && <text x="256" y="198" fontSize="10" fill="#66766e">{new Date(future).toLocaleDateString("ja-JP", { year: "numeric", month: "numeric", day: "numeric" })}頃</text>}
      </svg>
      <p className="cs-chart-legend">実線：入出庫の実績　{future ? "紫の点線：使用ペースによる予測" : ""}</p>
    </div>
    <div className="cs-card"><div className="cs-metrics"><div><small>現在残量</small><strong>{formatAmount(stock.amount)}</strong></div><div><small>下限</small><strong>{stock.low_stock_threshold == null ? "未設定" : formatAmount(stock.low_stock_threshold)}</strong></div></div><p className="cs-forecast-status">{stateText}</p></div>
  </>;
}
