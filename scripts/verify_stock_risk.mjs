// Native Node TypeScript stripping; no test framework or external data needed.
import assert from "node:assert/strict";
import { calculateStockRisk, stockRiskText } from "../lib/stock-risk.ts";

export function fixtures(clock = "2026-10-05T03:00:00.000Z") {
  const t = Date.parse(clock), day = 86400000;
  const ago = (days) => new Date(t - days * day).toISOString();
  const uuid = (n) => "00000000-0000-0000-0000-" + String(n).padStart(12, "0");
  const stock = { id: uuid(201), amount: 6, opening_amount: 61, opened_at: ago(180), low_stock_threshold: 4, is_active: true };
  const review = { eligible: true, verifiedFrom: stock.opened_at, verifiedAt: clock };
  const log = (id, age, qty, status = "active") => ({ id: uuid(id), inventory_id: stock.id, change_amount: qty, status, occurred_at: ago(age), created_at: ago(age), updated_at: ago(age) });
  const weekly = Array.from({ length: 22 }, (_, i) => log(1000 + i, i * 7 + 1, -2.5));
  const make = (name, s = stock, logs = weekly, r = review) => ({ name, stock: s, logs, review: r, asOf: clock });
  const dailyStock = { ...stock, opening_amount: 38, amount: 20, low_stock_threshold: 19.3 };
  const daily = Array.from({ length: 180 }, (_, i) => log(2000 + i, i + 0.5, -0.1));
  return [
    make("weekly"),
    make("reversed", stock, [...weekly].reverse()),
    make("decimal-equality", dailyStock, daily),
    make("one-cent-beyond", { ...dailyStock, low_stock_threshold: 19.29 }, daily),
    ...[16, 17].map((age) => make("attention-boundary-" + age,
      { ...stock, opened_at: ago(90), opening_amount: 5.07, amount: 2, low_stock_threshold: 1 },
      [log(4200, 7, -1), log(4201, 11, -1), log(4202, age, -1), ...[25, 35, 45, 55, 65, 75, 85].map((d, i) => log(4210 + i, d, -0.01))],
      { ...review, verifiedFrom: ago(90) })),
    make("over-200-records", dailyStock, Array.from({ length: 360 }, (_, i) => log(3000 + i, Math.floor(i / 2) + (i % 2 ? 0.75 : 0.25), -0.05))),
    make("cancelled-excluded", stock, [...weekly, log(4000, 3, -100, "cancelled")]),
    make("inbound-not-demand", { ...stock, opening_amount: 58 }, [...weekly, log(4001, 3, 3)]),
    make("inactive", { ...stock, is_active: false }),
    make("no-threshold", { ...stock, low_stock_threshold: null }),
    make("below-threshold", { ...stock, amount: 4 }),
    make("unverified", stock, weekly, null),
    make("revoked", stock, weekly, { ...review, eligible: false }),
    make("short-history", { ...stock, opening_amount: 8.5, opened_at: ago(3) }, [log(4010, 1, -2.5)], { ...review, verifiedFrom: ago(3) }),
    make("no-outbound", { ...stock, opening_amount: 6 }, []),
    make("sparse", { ...stock, opening_amount: 8.5 }, [log(4011, 1, -2.5)]),
    make("mismatched-ledger", { ...stock, amount: 6.01 }),
    make("negative-history", { ...stock, opening_amount: 5, amount: 6 }, [log(4012, 2, -6), log(4013, 1, 7)]),
    make("future-occurrence", stock, [...weekly.slice(1), log(1000, -1, -2.5)]),
    make("retroactive-change", stock, weekly.map((x, i) => i ? x : { ...x, updated_at: clock }), { ...review, verifiedAt: ago(0.5) }),
    make("late-registration", stock, weekly.map((x, i) => i ? x : { ...x, created_at: clock, updated_at: clock }), { ...review, verifiedAt: ago(0.5) }),
    make("new-movement", { ...stock, amount: 5.5 }, [...weekly, log(4300, 0.1, -0.5)], { ...review, verifiedAt: ago(0.5) }),
    make("new-record-corrected", { ...stock, amount: 5.5 }, [...weekly, { ...log(4300, 0.1, -0.5), updated_at: clock }], { ...review, verifiedAt: ago(0.5) }),
    make("new-record-cancelled", stock, [...weekly, { ...log(4300, 0.1, -0.5, "cancelled"), updated_at: clock }], { ...review, verifiedAt: ago(0.5) }),
    make("resumed-recently", stock, weekly, { ...review, resumedAt: ago(10) }),
    make("stockout-exclusions", { ...stock, opening_amount: 10, amount: 11 }, [log(4100, 170, -10), log(4101, 20, 12), ...Array.from({ length: 10 }, (_, i) => log(4110 + i, i + 1, -0.1))]),
  ];
}

if (process.argv[2] === "--fixtures") {
  process.stdout.write(JSON.stringify(fixtures(process.argv[3])));
} else if (process.argv[2] === "--calculate") {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const cases = JSON.parse(input);
  process.stdout.write(JSON.stringify(cases.map((c) => calculateStockRisk(c.stock, c.logs, c.review, new Date(c.asOf)))));
} else {
  const cases = fixtures(), results = Object.fromEntries(cases.map((c) => [c.name, calculateStockRisk(c.stock, c.logs, c.review, new Date(c.asOf))]));
  const weekly = results.weekly;
  assert.equal(weekly.status, "ready");
  // Weekly events at ages 1,8,...,148 cover precisely endpoints k=0,...,148.
  assert.equal(weekly.sampleWindowCount, 174);
  assert.equal(weekly.reachedWindowCount, 149);
  assert.equal(weekly.outboundDayCount, 22);
  assert.deepEqual(weekly.windowOutbound, { median: 2.5, p95: 2.5, max: 2.5 });
  assert.equal(weekly.historicalReachRate, 0.856322);
  assert.equal(weekly.needsAttention, true);
  for (const name of ["reversed", "cancelled-excluded", "inbound-not-demand"]) assert.deepEqual(results[name], weekly);
  for (const name of ["decimal-equality", "over-200-records"]) {
    assert.equal(results[name].status, "ready");
    assert.equal(results[name].reachedWindowCount, 174);
    assert.deepEqual(results[name].windowOutbound, { median: 0.7, p95: 0.7, max: 0.7 });
  }
  assert.equal(results["one-cent-beyond"].reachedWindowCount, 0);
  assert.equal(results["one-cent-beyond"].needsAttention, false);
  for (const k of [16, 17]) {
    const r = results["attention-boundary-" + k];
    assert.equal(r.status, "ready");
    assert.equal(r.sampleWindowCount, 84);
    assert.equal(r.reachedWindowCount, k);
    assert.equal(r.needsAttention, k === 17);
  }
  const statuses = { inactive: "inactive", "no-threshold": "threshold_not_set", "below-threshold": "already_below_threshold", unverified: "data_quality_issue", revoked: "data_quality_issue", "short-history": "insufficient_history", "no-outbound": "no_outbound_history", sparse: "sparse_history", "mismatched-ledger": "data_quality_issue", "negative-history": "data_quality_issue", "future-occurrence": "data_quality_issue", "retroactive-change": "data_quality_issue", "late-registration": "data_quality_issue", "resumed-recently": "insufficient_history", "stockout-exclusions": "sparse_history" };
  for (const [name, status] of Object.entries(statuses)) {
    assert.equal(results[name].status, status, name);
    assert.equal(results[name].historicalReachRate, null, name);
    assert.equal(results[name].windowOutbound, null, name);
    assert.equal(results[name].needsAttention, null, name);
  }
  assert.equal(results["resumed-recently"].referenceDays, 10);
  // Valid endpoints k=0,...,13 and k=170,...,173; crossing the zero period is censored.
  assert.equal(results["stockout-exclusions"].sampleWindowCount, 18);
  assert.equal(results["stockout-exclusions"].excludedWindowCount, 156);
  assert.deepEqual(results["retroactive-change"].reasonCodes, ["history_changed_since_review"]);
  assert.equal(results["new-movement"].status, "ready");
  for (const name of ["new-record-corrected", "new-record-cancelled"]) {
    assert.deepEqual(results[name].reasonCodes, ["history_changed_since_review"]);
    assert.equal(results[name].historicalReachRate, null);
  }
  assert.match(stockRiskText(results["one-cent-beyond"]), /ありません/);
  assert.match(stockRiskText(results["decimal-equality"]), /すべて/);
  assert.match(stockRiskText({ ...weekly, reachedWindowCount: 1 }), /1%未満/);
  const first = cases[0];
  const duplicate = calculateStockRisk(first.stock, [...first.logs, first.logs[0]], first.review, new Date(first.asOf));
  assert.deepEqual(duplicate.reasonCodes, ["duplicate_log"]);
  console.log("stock risk: " + cases.length + " synthetic scenarios, boundaries, decimal equality and wording verified");
}
