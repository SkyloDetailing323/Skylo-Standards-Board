// netlify/functions/tech-bookings-scan.js
// Hourly (after hcp-sales-sync): looks for HCP jobs with a
// "Technician Booking - " line item and adds them to tech_bookings as
// 'pending', so an admin is notified in the app to pick who booked it.
// Each job is checked twice at most: once when it's new (created in the last
// 3 days) and once after it's completed (last 4 days), tracked in
// tech_booking_item_checks. Never confirms or pays anything by itself.
const { canRunSync } = require("./lib/authToken");
const { sb, lineItemNames, bookingItems } = require("./lib/techBookings");

const TIME_BUDGET_MS = 20000;

exports.handler = async (event) => {
  // Scheduled runs come from Netlify's timer; a visit by URL needs an owner token.
  const scheduled = !event?.httpMethod || (event.body && String(event.body).includes("next_run"));
  if (!scheduled && !canRunSync(event)) return { statusCode: 403, body: "Owners only" };
  const started = Date.now();
  const stats = { checked: 0, found: 0 };
  try {
    const ago = d => encodeURIComponent(new Date(Date.now() - d * 864e5).toISOString());
    const cols = "hcp_job_id,invoice_number,first_name,last_name,scheduled_start";
    const [fresh, done] = await Promise.all([
      sb(`hcp_sales_jobs?job_created_at=gte.${ago(3)}&select=${cols}&order=job_created_at.desc&limit=300`),
      sb(`hcp_sales_jobs?completed_at=gte.${ago(4)}&select=${cols}&order=completed_at.desc&limit=400`),
    ]);
    const todo = [...(done || []).map(j => ({ ...j, key: `${j.hcp_job_id}:done` })), ...(fresh || []).map(j => ({ ...j, key: `${j.hcp_job_id}:new` }))];
    const checked = new Set();
    for (let i = 0; i < todo.length; i += 150) {
      const keys = todo.slice(i, i + 150).map(j => `"${j.key}"`).join(",");
      (await sb(`tech_booking_item_checks?check_key=in.(${keys})&select=check_key`)).forEach(r => checked.add(r.check_key));
    }
    const existing = new Set((await sb("tech_bookings?select=hcp_job_id")).map(r => r.hcp_job_id));

    for (const j of todo) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      if (checked.has(j.key)) continue;
      checked.add(j.key);
      const items = bookingItems(await lineItemNames(j.hcp_job_id));
      await sb("tech_booking_item_checks?on_conflict=check_key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify({ check_key: j.key, has_item: items.length > 0, items: items.join(" · ") || null }) });
      stats.checked++;
      if (!items.length || existing.has(j.hcp_job_id)) continue;
      await sb("tech_bookings?on_conflict=hcp_job_id", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: JSON.stringify({
        hcp_job_id: j.hcp_job_id, invoice_number: j.invoice_number,
        customer_name: `${j.first_name || ""} ${j.last_name || ""}`.trim() || null,
        scheduled_start: j.scheduled_start, booking_items: items.join(" · "),
      }) });
      existing.add(j.hcp_job_id);
      stats.found++;
    }
    console.log("tech-bookings-scan:", JSON.stringify(stats));
    return { statusCode: 200, body: JSON.stringify({ ok: true, ...stats }) };
  } catch (e) {
    console.error("tech-bookings-scan:", e.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message, ...stats }) };
  }
};
