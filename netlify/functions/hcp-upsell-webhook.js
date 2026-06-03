// ─── Netlify Serverless Function: hcp-upsell-webhook.js ──────────────────────
// Place this file in your project at: netlify/functions/hcp-upsell-webhook.js
//
// What it does:
//   1. Receives a webhook from HouseCall Pro when a job is updated/completed
//   2. Looks for upsell line items in the job
//   3. Matches the HCP employee to a Skylo tech
//   4. Writes the upsell amount to Supabase automatically
//
// Environment variables to set in Netlify (Site → Environment Variables):
//   HCP_API_KEY       = your new HouseCall Pro API key
//   SUPABASE_URL      = https://mjmwxxvqcsptrocwucis.supabase.co
//   SUPABASE_KEY      = your Supabase anon/service key (Settings → API → anon public)
// ─────────────────────────────────────────────────────────────────────────────

// ── Upsell service names from your HCP pricebook ─────────────────────────────
// These must match EXACTLY how they appear in HCP (case-insensitive match used)
const UPSELL_SERVICES = [
  "Seat Steam and Shampoo",
  "Engine Bay Cleaning",
  "Carpet Steam and Shampoo",
  "Heavy Pet Hair Removal Service",
  "Full Interior Detail",
  "Full Exterior Detail",
];

// ── HCP employee name → Skylo tech name mapping ──────────────────────────────
// Left side: full name as it appears in HCP
// Right side: name as it appears in your Skylo app
const TECH_MAP = {
  "Myles Medanaris":   "Myles Medanaris",
  "Trevor Prince":     "Trevor Prince",
  "Kyle Rieff":        "Kyle Rieff",
  "Zak Lundblade":     "Zak Lundblade",
  "Josh Halafulia":    "Josh Halafulia",
  "Matthew Durkovich": "Matthew Durkovich",
  "Max Hancock":       "Max Hancock",
  "Miles Lewis":       "Miles Lewis",
  "Mason Dixon":       "Mason Dixon",
  "Tom Lorenc":        "Tom Lorenc",
  "Ethan Hansen":      "Ethan Hansen",
  "Caleb McDaniel":    "Caleb McDaniel",
  "Riley Lyon":        "Riley Lyon",
  "Britton Dozelman":  "Britton Dozelman",
  "Atticus Andersen":  "Atticus Andersen",
  "Landon White":      "Landon White",
  "Jackson Vaughn":    "Jackson Vaughn",
  "Kade Andrew":       "Kade Andrew",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function getWeekKey() {
  // Monday-based week key in MT (UTC-6)
  const mt = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const day = mt.getDay();
  const daysBack = day === 0 ? 6 : day - 1;
  const monday = new Date(mt);
  monday.setDate(mt.getDate() - daysBack);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const d = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function supabase(path, options = {}) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "apikey": process.env.SUPABASE_KEY,
      "Authorization": `Bearer ${process.env.SUPABASE_KEY}`,
      "Prefer": options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // Only accept POST requests
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  console.log("HCP webhook received:", JSON.stringify(payload, null, 2));

  // HCP sends different event types — we only care about job completed/updated
  const eventType = payload.event;
  if (!eventType || (!eventType.includes("job") && !eventType.includes("invoice"))) {
    return { statusCode: 200, body: "Ignored event type" };
  }

  // Get the job data
  const job = payload.job || payload.data;
  if (!job) {
    return { statusCode: 200, body: "No job data" };
  }

  // Get the assigned employee
  const assignedEmployee = job.assigned_employees?.[0] || job.employee;
  if (!assignedEmployee) {
    console.log("No employee assigned to job");
    return { statusCode: 200, body: "No employee" };
  }

  const hcpName = `${assignedEmployee.first_name} ${assignedEmployee.last_name}`.trim();
  const skyloName = TECH_MAP[hcpName];

  if (!skyloName) {
    console.log(`No Skylo mapping for HCP employee: ${hcpName}`);
    return { statusCode: 200, body: `No mapping for ${hcpName}` };
  }

  // Look up the tech in Supabase by name
  const techs = await supabase(`techs?name=eq.${encodeURIComponent(skyloName)}&select=id,name`);
  if (!techs || techs.length === 0) {
    console.log(`Tech not found in Skylo: ${skyloName}`);
    return { statusCode: 200, body: `Tech not found: ${skyloName}` };
  }
  const tech = techs[0];

  // Find upsell line items in the job
  const lineItems = job.line_items || job.invoice?.line_items || [];
  let upsellTotal = 0;
  const upsellItems = [];

  for (const item of lineItems) {
    const itemName = (item.name || item.description || "").trim();
    const isUpsell = UPSELL_SERVICES.some(u =>
      u.toLowerCase() === itemName.toLowerCase()
    );
    if (isUpsell) {
      const qty = item.quantity || 1;
      const price = parseFloat(item.unit_price || item.price || 0);
      const total = qty * price;
      upsellTotal += total;
      upsellItems.push({ name: itemName, amount: total });
    }
  }

  if (upsellTotal === 0) {
    console.log(`No upsell line items found for job ${job.id}`);
    return { statusCode: 200, body: "No upsells in this job" };
  }

  console.log(`Found upsells for ${skyloName}: $${upsellTotal}`, upsellItems);

  // Check if we already logged this job (avoid duplicates)
  const jobId = String(job.id);
  const existing = await supabase(`upsells?hcp_job_id=eq.${jobId}&tech_id=eq.${tech.id}&select=id`).catch(() => []);
  if (existing && existing.length > 0) {
    console.log(`Job ${jobId} already logged for ${skyloName}, skipping`);
    return { statusCode: 200, body: "Already logged" };
  }

  // Insert into Supabase upsells table
  const weekKey = getWeekKey();
  await supabase("upsells", {
    method: "POST",
    prefer: "return=minimal",
    body: JSON.stringify({
      tech_id:     tech.id,
      week_key:    weekKey,
      amount:      upsellTotal,
      hcp_job_id:  jobId,
      note:        upsellItems.map(i => `${i.name} ($${i.amount})`).join(", "),
    }),
  });

  console.log(`✅ Logged $${upsellTotal} upsell for ${skyloName} (week ${weekKey})`);
  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      tech: skyloName,
      amount: upsellTotal,
      items: upsellItems,
      week: weekKey,
    }),
  };
};
