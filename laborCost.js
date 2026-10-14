// laborCost.js -- Labor Cost % (owner goal: 29% or lower, Oct 2026).
//
// Labor = crew wages (commission, training pay, upsell and switchover
// bonuses) + employer payroll taxes. Revenue = serviced revenue. Tips are
// left out of both: they run through payroll and QuickBooks income but
// aren't Skylo's money. Salary, owners' guaranteed payments and sales
// commission (office) are not crew labor and don't count.

export const LABOR_TARGET_PCT = 29;
// Used until QuickBooks months are loaded: Payroll Taxes - COGS / Wages -
// COGS for Jul-Sep 2026 was 11.7-12.3%.
export const DEFAULT_PAYROLL_TAX_RATE = 0.12;

// Employer payroll tax rate from the QuickBooks months on file: total
// Payroll Taxes - COGS / total Wages - COGS (wages include tips, and so do
// the taxes, so the ratio holds for wages without tips too).
export function payrollTaxRate(months) {
  const wages = (months || []).reduce((s, m) => s + Number(m.wages_cogs || 0), 0);
  const taxes = (months || []).reduce((s, m) => s + Number(m.payroll_taxes_cogs || 0), 0);
  return wages > 0 ? taxes / wages : DEFAULT_PAYROLL_TAX_RATE;
}

// Tips paid out per month ('YYYY-MM' -> $): each tip is paid on the pay
// date of the pay period it was earned in, which is when QuickBooks books it.
// periods: [{ start, end, payout }].
export function tipsPaidByMonth(tipEntries, periods) {
  const out = {};
  for (const t of tipEntries || []) {
    const p = (periods || []).find(p => t.work_date >= p.start && t.work_date <= p.end);
    if (!p) continue;
    const m = p.payout.slice(0, 7);
    out[m] = (out[m] || 0) + Number(t.amount || 0);
  }
  return out;
}

// One QuickBooks month -> labor and revenue with tips taken out of both.
// row: labor_actuals row; tipsPaid: that month's tips when row.tips is null.
export function qbLaborMonth(row, tipsPaid = 0) {
  const tips = row.tips != null ? Number(row.tips) : Number(tipsPaid || 0);
  const labor = Number(row.wages_cogs) + Number(row.payroll_taxes_cogs) + Number(row.training_pay || 0) - tips;
  const revenue = Number(row.income) - tips;
  return { month: row.month, tips, labor, revenue, pct: revenue > 0 ? labor / revenue * 100 : null };
}
