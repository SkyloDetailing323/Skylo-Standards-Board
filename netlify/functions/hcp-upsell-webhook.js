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
  "Myles Medanaris":   "Myles Madarieta",
  "Trevor Prince":     "Trevor Prince",
  "Kyle Rieff":        "Kyle Reiff",
  "Zak Lundblade":     "Zak Lundblade",
  "Josh Halafulia":    "Josh Halafuka",
  "Matthew Durkovich": "Matthew Durkovich",
  "Max Hancock":       "Max Hancock",
  "Miles Lewis":       "Milos Lewit",
  "Mason Dixon":       "Mason Dixon",
  "Tom Lorenc":        "Tom Lorenc",
  "Ethan Hansen":      "Ethan Hansen",
  "Caleb McDaniel":    "Caleb McDaniel",
  "Riley Lyon":        "Riley Lyon",
  "Britton Dozelman":  "Britton Dookhran",
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

  // HCP sends different event types
  const eventType = payload.event || "";
  console.log("Event type:", eventType);
  console.log("Full payload keys:", Object.keys(payload));

  // Handle both job and invoice events
  const job = payload.job || payload.data?.job || payload.data || null;
  const invoice = payload.invoice || null;

  // Fetch full job details from HCP API (includes line items)
  console.log(`Fetching full job details for: ${jobId}`);

  const hcpRes = await fetch(`https://api.housecallpro.com/jobs/${jobId}`, {
    headers: {
      "Authorization": `Token ${process.env.HCP_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!hcpRes.ok) {
    const errText = await hcpRes.text();
    console.log(`HCP API error: ${hcpRes.status} — ${errText}`);
    return { statusCode: 200, body: "Could not fetch job details" };
  }

  const fullJob = await hcpRes.json();
  console.log("Full job keys:", Object.keys(fullJob));
  console.log("Full job sample:", JSON.stringify(fullJob).substring(0, 1000));

  // Try every possible location for line items
  const lineItems = fullJob?.line_items
    || fullJob?.invoice?.line_items
    || fullJob?.invoices?.[0]?.line_items
    || fullJob?.work_order?.line_items
    || [];

  console.log(`Found ${lineItems.length} line items`);
  const assignedEmployee = job?.assigned_employees?.[0] || job?.employee || null;
  console.log(`Employee: ${JSON.stringify(assignedEmployee)}`);

  if (!assignedEmployee) {
    console.log("No employee found in payload");
    return { statusCode: 200, body: "No employee" };
  }

  const hcpName = `${assignedEmployee.first_name} ${assignedEmployee.last_name}`.trim();
  console.log(`HCP employee name: "${hcpName}"`);
  const skyloName = TECH_MAP[hcpName];

  if (!skyloName) {
    console.log(`No Skylo mapping for: ${hcpName}`);
    return { statusCode: 200, body: `No mapping for ${hcpName}` };
  }

  // Look up tech in Supabase
  const techs = await supabase(`techs?name=eq.${encodeURIComponent(skyloName)}&select=id,name`);
  if (!techs || techs.length === 0) {
    console.log(`Tech not found in Skylo: ${skyloName}`);
    return { statusCode: 200, body: `Tech not found: ${skyloName}` };
  }
  const tech = techs[0];

  // Find upsell line items
  let upsellTotal = 0;
  const upsellItems = [];
  console.log("Checking line items for upsells...");

  for (const item of lineItems) {
    const itemName = (item.name || item.description || "").trim();
    const isUpsell = UPSELL_SERVICES.some(u => u.toLowerCase() === itemName.toLowerCase());
    if (isUpsell) {
      const qty = item.quantity || 1;
      const price = parseFloat(item.unit_price || item.price || 0);
      const total = qty * price;
      upsellTotal += total;
      upsellItems.push({ name: itemName, amount: total });
    }
  }

  if (upsellTotal === 0) {
    // If upsells were removed, zero out the existing entry if there is one
    const jobId = String(job.id);
    const existing = await supabase(`upsells?hcp_job_id=eq.${jobId}&select=id`).catch(() => []);
    if (existing && existing.length > 0) {
      await supabase(`upsells?id=eq.${existing[0].id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({ amount: 0, note: "Upsells removed" }),
      });
      console.log(`Zeroed out upsell for job ${jobId} — upsells removed`);
    }
    return { statusCode: 200, body: "No upsells in this job" };
  }

  console.log(`Found upsells for ${skyloName}: $${upsellTotal}`, upsellItems);

  // Always upsert by job ID — overwrite if exists, insert if new
  const jobId = String(job.id);
  const weekKey = getWeekKey();

  // Check if this job already has an entry
  const existing = await supabase(`upsells?hcp_job_id=eq.${jobId}&select=id`).catch(() => []);

  if (existing && existing.length > 0) {
    // Update existing entry with latest amount
    await supabase(`upsells?id=eq.${existing[0].id}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({
        amount:   upsellTotal,
        note:     upsellItems.map(i => `${i.name} ($${i.amount})`).join(", "),
        week_key: weekKey,
      }),
    });
    console.log(`✅ Updated existing upsell for job ${jobId} — ${skyloName} $${upsellTotal}`);
  } else {
    // Insert new entry
    await supabase("upsells", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({
        tech_id:    tech.id,
        week_key:   weekKey,
        amount:     upsellTotal,
        hcp_job_id: jobId,
        note:       upsellItems.map(i => `${i.name} ($${i.amount})`).join(", "),
      }),
    });
    console.log(`✅ Logged new upsell for job ${jobId} — ${skyloName} $${upsellTotal}`);
  }

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
