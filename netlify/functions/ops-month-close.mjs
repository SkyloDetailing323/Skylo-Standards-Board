// netlify/functions/ops-month-close.mjs
// Scheduled just after midnight Mountain Time on the 1st: saves last month's
// operations-bonus results (staffing, callbacks, quota, and retention at
// quarter end) into ops_monthly_results so the month is on record even if
// the underlying data changes later. It never overwrites a month that's
// already saved -- owners re-save from the Operations Progress page after
// fixing data, which keeps their adjustments.
//
// Uses the same opsBonus.js the app page uses, so the numbers match.

import { computeOpsMonth, mountainDate } from "../../opsBonus.js";

const PAGE = 1000;
const FIRST_BONUS_MONTH = "2026-10";

async function sbGetAll(path) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: process.env.SUPABASE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
        Range: `${from}-${from + PAGE - 1}`,
      },
    });
    if (!res.ok) throw new Error(`Supabase ${path} failed (HTTP ${res.status}): ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

function previousMonthKey(today) {
  let [y, m] = today.slice(0, 7).split("-").map(Number);
  m -= 1; if (m === 0) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

function parseSetting(rows, key, fallback) {
  const row = rows.find(r => r.key === key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}

export default async () => {
  const today = mountainDate(new Date().toISOString());
  const monthKey = previousMonthKey(today);
  // The plan starts in October 2026; September is only a preview.
  if (monthKey < FIRST_BONUS_MONTH) {
    return new Response(JSON.stringify({ ok: true, monthKey, skipped: "before the bonus plan started" }));
  }

  const existing = await sbGetAll(`ops_monthly_results?month_key=eq.${monthKey}&select=month_key`);
  if (existing.length) {
    console.log(`ops-month-close: ${monthKey} already saved, leaving it alone`);
    return new Response(JSON.stringify({ ok: true, monthKey, skipped: "already saved" }));
  }

  const [techs, jobs, reviews, switchovers, callbacks, schedule, exceptions, settings] = await Promise.all([
    sbGetAll("techs?select=*"),
    sbGetAll("jobs?select=hcp_job_id,tech_id,job_date,revenue,upsell_amount&order=job_date.asc,id.asc"),
    sbGetAll("reviews?select=*"),
    sbGetAll("switchovers?select=*"),
    sbGetAll("callbacks?select=*"),
    sbGetAll("tech_schedule?select=*"),
    sbGetAll("schedule_exceptions?select=*"),
    sbGetAll("settings?select=key,value"),
  ]);

  const results = computeOpsMonth({
    monthKey, today, techs, jobs, reviews, switchovers, callbacks, schedule, exceptions,
    quota: parseSetting(settings, "quota", {}),
    truckCount: parseSetting(settings, "truck_count", 12),
    holidays: parseSetting(settings, "holidays", []),
  });

  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/ops_monthly_results?on_conflict=month_key`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify({ month_key: monthKey, results, saved_by: "month-end" }),
  });
  if (!res.ok) throw new Error(`Saving ${monthKey} failed (HTTP ${res.status}): ${await res.text()}`);

  console.log(`ops-month-close: saved ${monthKey} — total $${results.totalPay}`);
  return new Response(JSON.stringify({ ok: true, monthKey, totalPay: results.totalPay }));
};

// 07:10 UTC = 12:10am MST / 1:10am MDT on the 1st.
export const config = { schedule: "10 7 1 * *" };
