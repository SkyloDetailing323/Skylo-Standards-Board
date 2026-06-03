// netlify/functions/hcp-upsell-webhook.js
// Receives HCP webhook, fetches job details, logs upsell line items to Supabase

const UPSELL_SERVICES = [
  "Seat Steam and Shampoo",
  "Engine Bay Cleaning",
  "Carpet Steam and Shampoo",
  "Heavy Pet Hair Removal Service",
  "Full Interior Detail",
  "Full Exterior Detail",
];

const TECH_MAP = {
  "Myles Madarieta":   "Myles Madarieta",
  "Kade Andrew":       "Kade Andrew",
  "Trevor Prince":     "Trevor Prince",
  "Kyle Reiff":        "Kyle Reiff",
  "Zak Lundblade":     "Zak Lundblade",
  "Josh Halafuka":     "Josh Halafuka",
  "Matthew Durkovich": "Matthew Durkovich",
  "Max Hancock":       "Max Hancock",
  "Milos Lewit":       "Milos Lewit",
  "Mason Dixon":       "Mason Dixon",
  "Tom Lorenc":        "Tom Lorenc",
  "Ethan Hansen":      "Ethan Hansen",
  "Caleb McDaniel":    "Caleb McDaniel",
  "Riley Lyon":        "Riley Lyon",
  "Britton Dookhran":  "Britton Dookhran",
  "Atticus Andersen":  "Atticus Andersen",
  "Landon White":      "Landon White",
  "Jackson Vaughn":    "Jackson Vaughn",
};

function getWeekKey() {
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

async function sbFetch(path, options = {}) {
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
  if (res.status === 204) return null;
  return res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const eventType = payload.event || "";
  console.log("Event:", eventType);

  // Get job from payload
  const job = payload.job || payload.data || null;
  if (!job) {
    console.log("No job in payload");
    return { statusCode: 200, body: "No job data" };
  }

  const jobId = String(job.id || "");
  if (!jobId) {
    console.log("No job ID");
    return { statusCode: 200, body: "No job ID" };
  }

  console.log("Job ID:", jobId);
  console.log("Event type:", eventType);

  // Get employee from payload
  const employee = (job.assigned_employees || [])[0] || job.employee || null;
  if (!employee) {
    console.log("No employee on job");
    return { statusCode: 200, body: "No employee" };
  }

  const hcpName = `${employee.first_name} ${employee.last_name}`.trim();
  console.log("HCP name:", hcpName);

  const skyloName = TECH_MAP[hcpName];
  if (!skyloName) {
    console.log("No mapping for:", hcpName);
    return { statusCode: 200, body: `No mapping for ${hcpName}` };
  }

  // Find tech in Supabase
  const techs = await sbFetch(`techs?name=eq.${encodeURIComponent(skyloName)}&select=id,name`);
  if (!techs || techs.length === 0) {
    console.log("Tech not found:", skyloName);
    return { statusCode: 200, body: `Tech not found: ${skyloName}` };
  }
  const tech = techs[0];
  console.log("Found tech:", tech.name);

  // Fetch full job from HCP API to get line items
  console.log("Fetching full job from HCP API...");
  const hcpRes = await fetch(`https://api.housecallpro.com/jobs/${jobId}`, {
    headers: {
      "Authorization": `Token ${process.env.HCP_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  let lineItems = [];
  if (hcpRes.ok) {
    const fullJob = await hcpRes.json();
    console.log("Full job keys:", Object.keys(fullJob));
    lineItems = fullJob.line_items
      || fullJob.invoice?.line_items
      || fullJob.invoices?.[0]?.line_items
      || [];
    console.log("Line items found:", lineItems.length);
    console.log("Line items:", JSON.stringify(lineItems));
  } else {
    console.log("HCP API error:", hcpRes.status, await hcpRes.text());
  }

  // Find upsell items
  let upsellTotal = 0;
  const upsellItems = [];

  for (const item of lineItems) {
    const name = (item.name || item.description || "").trim();
    const isUpsell = UPSELL_SERVICES.some(s => s.toLowerCase() === name.toLowerCase());
    if (isUpsell) {
      const qty = item.quantity || 1;
      const price = parseFloat(item.unit_price || item.price || 0);
      const total = qty * price;
      upsellTotal += total;
      upsellItems.push({ name, amount: total });
      console.log("Upsell found:", name, "$" + total);
    }
  }

  if (upsellTotal === 0) {
    // Zero out if upsells were removed
    const existing = await sbFetch(`upsells?hcp_job_id=eq.${jobId}&select=id`).catch(() => []);
    if (existing && existing.length > 0) {
      await sbFetch(`upsells?id=eq.${existing[0].id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({ amount: 0, note: "No upsells" }),
      });
    }
    console.log("No upsell items found");
    return { statusCode: 200, body: "No upsells" };
  }

  // Upsert — update if exists, insert if new
  const weekKey = getWeekKey();
  const existing = await sbFetch(`upsells?hcp_job_id=eq.${jobId}&select=id`).catch(() => []);

  if (existing && existing.length > 0) {
    await sbFetch(`upsells?id=eq.${existing[0].id}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({
        amount: upsellTotal,
        note: upsellItems.map(i => `${i.name} ($${i.amount})`).join(", "),
        week_key: weekKey,
      }),
    });
    console.log("Updated existing upsell — $" + upsellTotal);
  } else {
    await sbFetch("upsells", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({
        tech_id: tech.id,
        week_key: weekKey,
        amount: upsellTotal,
        hcp_job_id: jobId,
        note: upsellItems.map(i => `${i.name} ($${i.amount})`).join(", "),
      }),
    });
    console.log("Inserted new upsell — $" + upsellTotal);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, tech: skyloName, amount: upsellTotal }),
  };
};
