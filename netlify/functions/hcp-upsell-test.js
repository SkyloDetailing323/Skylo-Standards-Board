// netlify/functions/hcp-upsell-test.js
// Dry-run test: simulates a completed HCP job and traces every step without writing to Supabase

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
  const { prefer, method, body } = options;
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: method || "GET",
    body,
    headers: {
      "Content-Type": "application/json",
      "apikey": process.env.SUPABASE_KEY,
      "Authorization": `Bearer ${process.env.SUPABASE_KEY}`,
      "Prefer": prefer || "return=representation",
    },
  });
  if (res.status === 204) return null;
  return res.json();
}

exports.handler = async () => {
  const steps = [];
  const log = (label, data, status = "ok") => {
    steps.push({ step: steps.length + 1, status, label, data });
  };

  // --- Simulated job payload ---
  const MOCK_JOB = {
    id: "TEST-JOB-001",
    assigned_employees: [{ first_name: "Kade", last_name: "Andrew" }],
    line_items: [
      { name: "Seat Steam and Shampoo", quantity: 1, unit_price: "50.00" },
    ],
  };

  log("Mock job payload", MOCK_JOB);

  // Step: extract employee
  const employee = (MOCK_JOB.assigned_employees || [])[0];
  if (!employee) {
    log("Extract employee", null, "fail");
    return respond(steps, false, "No employee on job");
  }
  const hcpName = `${employee.first_name} ${employee.last_name}`.trim();
  log("Extract employee", { hcpName });

  // Step: TECH_MAP lookup
  const skyloName = TECH_MAP[hcpName];
  if (!skyloName) {
    log("TECH_MAP lookup", { hcpName, result: "no match" }, "fail");
    return respond(steps, false, `No TECH_MAP entry for "${hcpName}"`);
  }
  log("TECH_MAP lookup", { hcpName, skyloName });

  // Step: check env vars
  const envCheck = {
    SUPABASE_URL: process.env.SUPABASE_URL ? "set" : "MISSING",
    SUPABASE_KEY: process.env.SUPABASE_KEY ? "set" : "MISSING",
    HCP_API_KEY:  process.env.HCP_API_KEY  ? "set" : "MISSING",
  };
  const missingEnv = Object.entries(envCheck).filter(([, v]) => v === "MISSING").map(([k]) => k);
  log("Environment variables", envCheck, missingEnv.length ? "warn" : "ok");

  // Step: line item scan
  const lineItems = MOCK_JOB.line_items || [];
  log("Line items from job", lineItems);

  let upsellTotal = 0;
  const upsellItems = [];
  for (const item of lineItems) {
    const name = (item.name || item.description || "").trim();
    const matched = UPSELL_SERVICES.some(s => s.toLowerCase() === name.toLowerCase());
    if (matched) {
      const qty = item.quantity || 1;
      const price = parseFloat(item.unit_price || item.price || 0);
      const total = qty * price;
      upsellTotal += total;
      upsellItems.push({ name, qty, unit_price: price, total });
    }
    log(`Line item "${name}"`, { matched, qty: item.quantity, unit_price: item.unit_price });
  }

  if (upsellTotal === 0) {
    log("Upsell total", { upsellTotal }, "fail");
    return respond(steps, false, "No upsell items found — nothing to write");
  }
  log("Upsell total", { upsellItems, upsellTotal });

  // Step: Supabase tech lookup (real read — safe, no writes)
  let tech = null;
  try {
    const techs = await sbFetch(`techs?name=eq.${encodeURIComponent(skyloName)}&select=id,name`);
    if (!techs || techs.length === 0) {
      log("Supabase tech lookup", { query: `name=eq.${skyloName}`, result: "not found" }, "fail");
      return respond(steps, false, `Tech "${skyloName}" not found in Supabase techs table`);
    }
    tech = techs[0];
    log("Supabase tech lookup", { query: `name=eq.${skyloName}`, result: tech });
  } catch (err) {
    log("Supabase tech lookup", { error: err.message }, "fail");
    return respond(steps, false, `Supabase read failed: ${err.message}`);
  }

  // Step: check for existing upsell row (real read — safe, no writes)
  let existingRow = null;
  try {
    const existing = await sbFetch(`upsells?hcp_job_id=eq.${MOCK_JOB.id}&select=id,hcp_job_id,amount`);
    existingRow = existing && existing.length > 0 ? existing[0] : null;
    log("Supabase duplicate check", {
      query: `hcp_job_id=eq.${MOCK_JOB.id}`,
      existing: existingRow || "none — would INSERT",
    });
  } catch (err) {
    log("Supabase duplicate check", { error: err.message }, "warn");
  }

  // Step: dry-run upsert payload
  const weekKey = getWeekKey();
  const note = upsellItems.map(i => `${i.name} ($${i.total})`).join(", ");
  const upsertPayload = {
    tech_id:     tech.id,
    week_key:    weekKey,
    amount:      upsellTotal,
    hcp_job_id:  MOCK_JOB.id,
    note,
  };
  log("DRY RUN — upsert payload (not written)", {
    endpoint: "POST /upsells?on_conflict=hcp_job_id",
    prefer:   "resolution=merge-duplicates,return=minimal",
    body:     upsertPayload,
    action:   existingRow ? "would UPDATE existing row" : "would INSERT new row",
  });

  return respond(steps, true, "Dry run complete — all steps passed, nothing written to Supabase");
};

function respond(steps, ok, summary) {
  const failCount  = steps.filter(s => s.status === "fail").length;
  const warnCount  = steps.filter(s => s.status === "warn").length;
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok, summary, failCount, warnCount, steps }, null, 2),
  };
}
