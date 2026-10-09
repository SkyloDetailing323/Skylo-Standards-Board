// laborCost.test.js -- run with `npm test`.

import test from "node:test";
import assert from "node:assert/strict";
import { payrollTaxRate, tipsPaidByMonth, qbLaborMonth, DEFAULT_PAYROLL_TAX_RATE } from "./laborCost.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test("payroll tax rate = taxes / wages across months, default when none", () => {
  close(payrollTaxRate([{ wages_cogs: 100, payroll_taxes_cogs: 12 }, { wages_cogs: 300, payroll_taxes_cogs: 36 }]), 0.12);
  assert.equal(payrollTaxRate([]), DEFAULT_PAYROLL_TAX_RATE);
});

test("tips land in the month of their pay date", () => {
  const periods = [{ start: "2026-09-06", end: "2026-09-19", payout: "2026-09-25" }, { start: "2026-09-20", end: "2026-09-30", payout: "2026-10-07" }];
  const out = tipsPaidByMonth([{ work_date: "2026-09-10", amount: 20 }, { work_date: "2026-09-25", amount: 30 }, { work_date: "2026-08-01", amount: 99 }], periods);
  assert.deepEqual(out, { "2026-09": 20, "2026-10": 30 });
});

test("QuickBooks month: tips come out of labor and revenue", () => {
  const m = qbLaborMonth({ month: "2026-09", income: 158000.38, wages_cogs: 43134.74, payroll_taxes_cogs: 5325.59, training_pay: 2558.95, tips: null }, 13689);
  close(m.labor, 43134.74 + 5325.59 + 2558.95 - 13689);
  close(m.revenue, 158000.38 - 13689);
  close(m.pct, m.labor / m.revenue * 100);
  // a stored tips amount wins over the worked-out one
  assert.equal(qbLaborMonth({ month: "x", income: 100, wages_cogs: 40, payroll_taxes_cogs: 5, training_pay: 0, tips: 10 }, 999).tips, 10);
});
