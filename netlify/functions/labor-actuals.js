// netlify/functions/labor-actuals.js
// GET: monthly labor numbers pulled from QuickBooks (labor_actuals table),
// for the Labor Cost card on Reports. Owners only -- it's the company's
// books. The table has RLS on with no policies, so only this function
// (service key) can read it.

const { verifyToken, tokenFrom } = require("./lib/authToken");

exports.handler = async (event) => {
  const who = verifyToken(tokenFrom(event));
  if (!who || who.role !== "owner") return { statusCode: 403, body: JSON.stringify({ error: "Owners only" }) };
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/labor_actuals?select=*&order=month.asc`, {
    headers: { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}` },
  });
  const text = await res.text();
  if (!res.ok) return { statusCode: 502, body: JSON.stringify({ error: `Supabase ${res.status}: ${text.slice(0, 200)}` }) };
  return { statusCode: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify({ months: JSON.parse(text) }) };
};
