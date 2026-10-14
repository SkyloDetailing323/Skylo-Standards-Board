// Shared helpers for Technician Bookings (tech-bookings.js and
// tech-bookings-scan.js). A job is a technician booking when it has an HCP
// line item named "Technician Booking - ...".
const BOOKING_PREFIX = "technician booking";

async function sb(path, options = {}) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    body: options.body,
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.SUPABASE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
      Prefer: options.prefer || "return=representation",
    },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${path.split("?")[0]} (HTTP ${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function hcp(path, attempt = 1) {
  const res = await fetch(`https://api.housecallpro.com/${path}`, {
    headers: { Authorization: `Token ${process.env.HCP_API_KEY}`, Accept: "application/json" },
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await new Promise(r => setTimeout(r, 800 * attempt * attempt));
    return hcp(path, attempt + 1);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HCP ${path.split("?")[0]} HTTP ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Line item names on a job. Uses the job's line items (exist before the job
// is done), falling back to its invoices (same source the revenue sync uses).
// null = HCP couldn't be read (the scan then leaves the job to check again).
async function lineItemNames(hcpJobId) {
  const names = [];
  const li = await hcp(`jobs/${encodeURIComponent(hcpJobId)}/line_items`).catch(() => undefined);
  const arr = Array.isArray(li) ? li : (li?.data || li?.line_items || []);
  for (const it of arr) if (it?.name) names.push(String(it.name).trim());
  if (!names.length) {
    const inv = await hcp(`jobs/${encodeURIComponent(hcpJobId)}/invoices`).catch(() => undefined);
    if (li === undefined && inv === undefined) return null;
    const invoices = Array.isArray(inv) ? inv : (inv?.invoices || inv?.data || []);
    for (const i of invoices) for (const it of (i.items || i.line_items || [])) if (it?.name) names.push(String(it.name).trim());
  }
  return names;
}

const bookingItems = names => names.filter(n => n.toLowerCase().startsWith(BOOKING_PREFIX));

module.exports = { sb, hcp, lineItemNames, bookingItems };
