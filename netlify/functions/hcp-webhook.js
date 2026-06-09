// netlify/functions/hcp-webhook.js
// Receives real-time job updates pushed from HCP whenever a job is saved/completed.
// Set this URL in HCP Settings → Integrations → Webhooks:
//   https://skylotechleaderboard.netlify.app/.netlify/functions/hcp-webhook

const UPSELL_SERVICES = [
  "Seat Steam and Shampoo",
  "Engine Bay Cleaning",
  "Carpet Steam and Shampoo",
  "Heavy Pet Hair Removal Service",
  "Full Interior Detail",
  "Full Exterior Detail",
  "Full Synthetic Hand Wax",
];

const TECH_MAP = {
  "Myles Madarieta":   "Myles Madarieta",
  "Kade Andrew":       "Kade Andrew",
  "Trevor Prince":     "Trevor Prince",
  "Kyle Reiff":        "Kyle Rieff",
  "Zak Lundblade":     "Zak Lundblade",
  "Josh Halafuka":     "Josh Halufuka",
  "Matthew Durkovich": "Matthew Durkovich",
  "Max Hancock":       "Max Hancock",
  "Milos Lewit":       "Milos Lewit",
  "Mason Dixon":       "Mason Dixon",
  "Tom Lorenc":        "Tom Lorenc",
  "Ethan Hamilton":    "Ethan Hamilton",
  "Caleb McDaniel":    "Caleb McDaniel",
  "Riley Lyon":        "Riley Lyon",
  "Britton Dookhran":  "Britton Dookhran",
  "Atticus Andersen":  "Atticus Anderson",
  "Landon White":      "Landon White",
  "Jackson Vaughn":    "Jackson Vaughn",
  "Brian Wheelus":     "Brian Wheelus",
};

function getWeekKey(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay();
  const daysBack = day === 0 ? 6 : day - 1;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - daysBack);
  return monday.toISOString().split("T")[0];
}

async function sbFetch(path, options = {}) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    body: options.body,
    headers: {
      "Content-Type": "application/json",
      "apikey": process.env.SUPABASE_KEY,
      "Authorization": `Bearer ${process.env.SUPABASE_KEY}`,
      "Prefer": options.prefer || "return=representation",
    },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

exports.handler = async (event) => {
  // Log raw payload so we can inspect what HCP sends
  console.log("HCP webhook received:", event.httpMethod, JSON.stringify(event.body).slice(0, 500));

  if (event.httpMethod !== "POST") {
    return { statusCode: 200, body: "ok" };
  }

  let payload;
  try { payload = JSON.parse(event.body || "{}"); } catch {
    return { statusCode: 200, body: "ok" };
  }

  // HCP wraps the job in different fields depending on event type
  const job = payload.job || payload.data?.job || payload;
  if (!job || !job.id) {
    console.log("No job in payload, keys:", Object.keys(payload));
    return { statusCode: 200, body: "ok" };
  }

  const jobId = String(job.id);
  const status = job.work_status || "";

  // Only process completed jobs
  if (!status.includes("complete")) {
    console.log(`Job ${jobId} status "${status}" — skipping`);
    return { statusCode: 200, body: "ok" };
  }

  const employee = (job.assigned_employees || [])[0];
  if (!employee) return { statusCode: 200, body: "ok" };

  const hcpName = `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
  const skyloName = TECH_MAP[hcpName];
  if (!skyloName) {
    console.log(`No TECH_MAP entry for "${hcpName}"`);
    return { statusCode: 200, body: "ok" };
  }

  const allTechs = await sbFetch("techs?select=id,name");
  const tech = (allTechs || []).find(t => t.name === skyloName);
  if (!tech) {
    console.log(`Tech "${skyloName}" not in Supabase`);
    return { statusCode: 200, body: "ok" };
  }

  const revenue = (job.total_amount || 0) / 100;
  const tips    = (job.tip_amount || job.tips || 0) / 100;

  const schedStart = job.schedule?.scheduled_start || job.schedule?.start;
  const schedEnd   = job.schedule?.scheduled_end   || job.schedule?.end;
  let hours = 0;
  if (schedStart && schedEnd) {
    hours = Math.round(((new Date(schedEnd) - new Date(schedStart)) / 3600000) * 100) / 100;
  }

  const jobDate = schedStart ? schedStart.split("T")[0] : new Date().toISOString().split("T")[0];
  const weekKey = getWeekKey(jobDate);

  // Scan line items for upsells
  const lineItems = job.line_items || job.invoice?.line_items || [];
  console.log(`Job ${jobId}: ${lineItems.length} line items`);

  let upsellTotal = 0;
  const upsellItems = [];
  for (const item of lineItems) {
    const name = (item.name || item.description || "").trim();
    if (UPSELL_SERVICES.some(s => s.toLowerCase() === name.toLowerCase())) {
      const qty   = item.quantity || 1;
      const price = (item.unit_price || item.price || 0) / 100; // cents → dollars
      const total = qty * price;
      upsellTotal += total;
      upsellItems.push({ name, amount: total });
    }
  }

  // Upsert job record
  await sbFetch("jobs?on_conflict=hcp_job_id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify({
      hcp_job_id:    jobId,
      tech_id:       tech.id,
      job_date:      jobDate,
      revenue,
      upsell_amount: upsellTotal,
      hours,
      tips,
      week_key:      weekKey,
    }),
  });

  // Upsert upsell record if applicable
  if (upsellTotal > 0) {
    const note = upsellItems.map(i => `${i.name} ($${i.amount})`).join(", ");
    await sbFetch("upsells?on_conflict=hcp_job_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify({
        tech_id:    tech.id,
        week_key:   weekKey,
        amount:     upsellTotal,
        hcp_job_id: jobId,
        note,
      }),
    });
    console.log(`Upsell recorded: ${skyloName} | ${note} | $${upsellTotal}`);
  }

  console.log(`Webhook processed: ${skyloName} | $${revenue} rev | $${upsellTotal} upsells`);
  return { statusCode: 200, body: "ok" };
};
