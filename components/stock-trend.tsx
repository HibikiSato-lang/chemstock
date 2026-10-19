"use client";

import { Stock, StockLog, formatAmount } from "@/lib/chemstock-ui";
import { quantityAxis } from "@/lib/stock-chart";

export function StockTrend({ stock, logs, periodDays, name, roomName }: { stock: Stock; logs: StockLog[]; periodDays: number; name: string; roomName: string }) {
  const now = Date.now();
  const start = Math.min(now, Math.max(new Date(stock.opened_at).getTime(), now - periodDays * 86400000));
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

  const duration = Math.max(1, now - start);
  const axis = quantityAxis(Math.max(...points.map((point) => point.amount)));
  const left = Math.max(52, ...axis.ticks.map((tick) => tick.label.length * 8 + 12));
  const right = 344;
  const top = 38;
  const bottom = 218;
  const x = (time: number) => now === start ? right : left + (time - start) / duration * (right - left);
  const y = (litres: number) => bottom - Math.max(0, litres) / axis.maximum * (bottom - top);
  const actualLine = points.map((point) => `${x(point.time)},${y(point.amount)}`).join(" ");
  const dateFormat = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" });
  const shortPeriod = duration < 2 * 86400000;
  const timeFormat = new Intl.DateTimeFormat("ja-JP", shortPeriod ? { hour: "2-digit", minute: "2-digit" } : { month: "numeric", day: "numeric" });
  const dateTickCount = duration < 60000 ? 2 : shortPeriod ? 3 : 4;
  const dateTicks = Array.from({ length: dateTickCount }, (_, index) => start + (now - start) * index / (dateTickCount - 1));


  return <>
    <div className="cs-card cs-chart-card">
      <h2 className="cs-chart-title">{roomName} ／ {name}の残量推移</h2>
      <p className="cs-chart-period">{dateFormat.format(start)} 〜 {dateFormat.format(now)}</p>
      <svg className="cs-chart cs-trend-chart" viewBox="0 0 360 256" role="img" aria-label={`${name}の残量推移。縦軸はリットル、0から${axis.maximum} L。現在${formatAmount(stock.amount)}。`}>
        <text x={left} y="20" fontSize="13" fill="#52675a">残量（L）</text>
        <text x={right} y="20" textAnchor="end" fontSize="14" fontWeight="700" fill="#2e6b58">現在 {formatAmount(stock.amount)}</text>
        {dateTicks.map((time, index) => {
          const position = left + index / (dateTickCount - 1) * (right - left);
          return <g key={index}>
            <line x1={position} y1={top} x2={position} y2={bottom} stroke="#e8eeea" strokeDasharray="2 4" />
            <text x={position} y="244" textAnchor={index === 0 ? "start" : index === dateTicks.length - 1 ? "end" : "middle"} fontSize="14" fill="#52675a">{duration < 60000 ? index === 0 ? "開始" : "現在" : timeFormat.format(time)}</text>
          </g>;
        })}
        {axis.ticks.map((tick) => <g key={tick.value}>
          <line x1={left} y1={y(tick.value)} x2={right} y2={y(tick.value)} stroke={tick.value === 0 ? "#9db0a6" : "#dbe6e0"} />
          <text x={left - 10} y={y(tick.value)} textAnchor="end" dominantBaseline="middle" fontSize="14" fill="#52675a">{tick.label}</text>
        </g>)}
        <line x1={left} y1={top} x2={left} y2={bottom} stroke="#9db0a6" />
        <polyline points={actualLine} fill="none" stroke="#2e6b58" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {points.length <= 16 && points.slice(0, -1).map((point, index) => <circle key={index} cx={x(point.time)} cy={y(point.amount)} r="3" fill="white" stroke="#2e6b58" strokeWidth="1.5"><title>{`${new Date(point.time).toLocaleString("ja-JP")}：${formatAmount(point.amount)}`}</title></circle>)}
        <circle cx={x(now)} cy={y(stock.amount)} r="4.5" fill="#2e6b58" stroke="white" strokeWidth="2"><title>{`現在：${formatAmount(stock.amount)}`}</title></circle>
      </svg>
      <div className="cs-trend-legend"><span><i className="cs-trend-line" />残量</span></div>
      <p className="cs-chart-legend">記録点を直線で接続しています（記録間は補間）。</p>
    </div>
  </>;
}
