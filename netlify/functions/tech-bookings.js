// netlify/functions/tech-bookings.js
// Technician Bookings, admin only (owners and managers):
//   GET  ?invoice=1234          -> the job (customer, date, line items)
//   POST { invoice, booker_id } -> add it as a confirmed booking for that tech
// Reads hcp_sales_jobs (synced hourly from HCP) to find the job by its HCP
// job number, and HCP for its line items.
const { verifyToken, tokenFrom } = require("./lib/authToken");
const { sb, lineItemNames, bookingItems } = require("./lib/techBookings");

const json = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  const who = verifyToken(tokenFrom(event));
  if (!who) return json(401, { error: "Log in again" });
  if (who.role !== "owner" && who.role !== "manager") return json(403, { error: "Admins only" });
  try {
    const q = event.queryStringParameters || {};
    let body = {};
    if (event.httpMethod === "POST") { try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad request" }); } }
    const inv = String((event.httpMethod === "POST" ? body.invoice : q.invoice) || "").replace(/[^0-9A-Za-z-]/g, "");
    if (!inv) return json(400, { error: "Enter a job number" });
    const job = (await sb(`hcp_sales_jobs?invoice_number=eq.${encodeURIComponent(inv)}&select=hcp_job_id,invoice_number,first_name,last_name,scheduled_start,completed_at,work_status,lead_source&limit=1`))?.[0];
    if (!job) return json(404, { error: "No job with that number yet. New jobs show up within about an hour of being created in HCP." });

    const [names, existingRows] = await Promise.all([
      lineItemNames(job.hcp_job_id),
      sb(`tech_bookings?hcp_job_id=eq.${encodeURIComponent(job.hcp_job_id)}&select=status,booker_id`),
    ]);
    const items = bookingItems(names);
    const info = {
      hcp_job_id: job.hcp_job_id,
      invoice_number: job.invoice_number,
      customer_name: `${job.first_name || ""} ${job.last_name || ""}`.trim() || null,
      scheduled_start: job.scheduled_start,
      completed: !!job.completed_at,
      has_booking_item: items.length > 0,
      booking_items: items,
      existing_status: existingRows?.[0]?.status || null,
    };
    if (event.httpMethod !== "POST") return json(200, { job: info });

    if (!body.booker_id) return json(400, { error: "Pick the tech who booked it" });
    let byName = who.name || null;
    if (!byName && who.techId) byName = (await sb(`techs?id=eq.${who.techId}&select=name`))?.[0]?.name || "Admin";
    await sb("tech_bookings?on_conflict=hcp_job_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify({
      hcp_job_id: job.hcp_job_id, invoice_number: job.invoice_number, customer_name: info.customer_name,
      scheduled_start: job.scheduled_start, booking_items: items.join(" · ") || null,
      booker_id: body.booker_id, status: "confirmed", confirmed_by: byName, confirmed_at: new Date().toISOString(),
    }) });
    return json(200, { ok: true, job: info });
  } catch (e) {
    console.error("tech-bookings:", e.message);
    return json(500, { error: "Couldn't reach HCP right now. Try again in a minute." });
  }
};
