// auditScoring.test.js -- run with `npm test` (Node's built-in test runner).
// Tech Audit scoring checked against the worked example from the spec and the
// three TEST submissions in GHL (answers copied from ghl_form_submissions).

import test from "node:test";
import assert from "node:assert/strict";
import { AUDIT_CONFIG, toteCharges, scoreTechAudit, auditDays, weeklyAuditPct, auditWeekStart, techNameOf, auditJobDate, submissionPhotoUrls } from "./auditScoring.js";

const ALL = ["On my Way", "Start Job", "Before Pictures", "Workflow Checklist", "After Pictures", "Finish", "Send Invoice"];
const OLD_FORM = ["Ga8aYHKmIy2SQ9KGqqEf","FY37nOA0b0rDZZaxRqAM","Vub4DsjU4dfJlgUzfq67","wWEni4JJVpTdbpRFzZRu","AqH3PL6wI1TROYl86C3M","zRIHBlKBZT8KrcY6l7rI","ndftAbwlEYb1VE4OfCPO","6ku5mwXQIpIahX7JvcT9","8oM3PJ48QtcrbxzeYLuQ","tpZsIalOFoFkBIWMtyua","XDlSPqE6ZBuHAgYr1oSE","KUQsapPszHcamVVGyTKU","V7gx9O3Tjuyt4hvIbrkm","EJJQZ19dNUswO6Kwuodj","button","header"];
const NEW_FORM = ["Ga8aYHKmIy2SQ9KGqqEf","FY37nOA0b0rDZZaxRqAM","Vub4DsjU4dfJlgUzfq67","05OLtXaKM8pSHVkhOqgd","wWEni4JJVpTdbpRFzZRu","AqH3PL6wI1TROYl86C3M","h6JuR4LttlIbf6lRV9aU","zRIHBlKBZT8KrcY6l7rI","ndftAbwlEYb1VE4OfCPO","XukjjfMrjTfLU5avtVwq","6ku5mwXQIpIahX7JvcT9","8oM3PJ48QtcrbxzeYLuQ","VlUP3BVq7XSNgrIX63H4","tpZsIalOFoFkBIWMtyua","0lqU9nNMrhT2lXo4vonS","XDlSPqE6ZBuHAgYr1oSE","KUQsapPszHcamVVGyTKU","1QLMckw9gCJckKg1pUA4","V7gx9O3Tjuyt4hvIbrkm","EJJQZ19dNUswO6Kwuodj","button","header"];
const round1 = n => Math.round(n * 10) / 10;
const job = (a, key) => a.jobs.find(j => j.slot === key);

const workedExample = {
  id: "worked", work_date: "2026-10-08", submitted_at: "2026-10-08T23:00:00Z",
  fields: {
    fieldsOriSequance: NEW_FORM,
    "05OLtXaKM8pSHVkhOqgd": "Yes",
    "wWEni4JJVpTdbpRFzZRu": ALL.filter(s => s !== "Before Pictures"),
    "AqH3PL6wI1TROYl86C3M": "Yes", "h6JuR4LttlIbf6lRV9aU": "Yes", "zRIHBlKBZT8KrcY6l7rI": "5 min or more", "ndftAbwlEYb1VE4OfCPO": "Yes",
    "XukjjfMrjTfLU5avtVwq": "Yes",
    "6ku5mwXQIpIahX7JvcT9": ALL,
    "8oM3PJ48QtcrbxzeYLuQ": "Yes", "VlUP3BVq7XSNgrIX63H4": "No", "tpZsIalOFoFkBIWMtyua": "Yes",
    "0lqU9nNMrhT2lXo4vonS": "Not Scheduled",
  },
};

test("worked example: 87.1% / 75.0% / skipped -> day 81.1%", () => {
  const a = scoreTechAudit(workedExample);
  const nine = job(a, "9am"), noon = job(a, "12pm"), three = job(a, "3pm");
  assert.equal(nine.max, 5);
  assert.equal(Math.round(nine.points * 1000) / 1000, 4.357);
  assert.equal(round1(nine.pct), 87.1);
  assert.deepEqual(nine.missed, ["Job flow: Before Pictures", "Late: 5 min or more"]);
  assert.equal(noon.points, 3); assert.equal(noon.max, 4); assert.equal(round1(noon.pct), 75.0);
  assert.deepEqual(noon.missed, ["No flyers"]);
  assert.equal(three.skipped, true);
  assert.equal(round1(a.dayPct), 81.1);
  assert.deepEqual(a.flags, []);
});

test("arrival answers map from config", () => {
  const pts = ans => job(scoreTechAudit({ ...workedExample, fields: { ...workedExample.fields, "zRIHBlKBZT8KrcY6l7rI": ans } }), "9am").points - 6 / 7 - 3;
  assert.equal(round1(pts("On time")), 1);
  assert.equal(round1(pts("5 min or more")), 0.5);
  assert.equal(round1(pts("1-10 min late")), 0.5);
  assert.equal(round1(pts("More than 10 min late")), 0);
});

test("TEST Landon Bliss 2026-10-01: all complete, on time -> 100% (Marketing question didn't exist yet)", () => {
  const fields = {
    fieldsOriSequance: OLD_FORM,
    "Ga8aYHKmIy2SQ9KGqqEf": "Landon Bliss", "FY37nOA0b0rDZZaxRqAM": "Zak Lundblade", "Vub4DsjU4dfJlgUzfq67": "2026-10-01",
    "wWEni4JJVpTdbpRFzZRu": [...ALL, "Type an Option"], "AqH3PL6wI1TROYl86C3M": "Yes", "zRIHBlKBZT8KrcY6l7rI": "On time", "ndftAbwlEYb1VE4OfCPO": "Yes",
    "6ku5mwXQIpIahX7JvcT9": ["On My Way", "Start Job", "Before Pictures", "Workflow Checklist", "After Pictures", "Finish", "Send Invoice"], "8oM3PJ48QtcrbxzeYLuQ": "Yes", "tpZsIalOFoFkBIWMtyua": "Yes",
    "XDlSPqE6ZBuHAgYr1oSE": ["On My Way", "Start Job", "Before Pictures", "After Pictures", "Workflow Checklist", "Finish", "Send Invoice"], "KUQsapPszHcamVVGyTKU": "Yes", "V7gx9O3Tjuyt4hvIbrkm": "Yes",
  };
  assert.equal(techNameOf(AUDIT_CONFIG.audit.formId, {}, fields), "Landon Bliss");
  assert.equal(auditJobDate(fields), "2026-10-01");
  const a = scoreTechAudit({ id: "6ac42710879e3cd4e4b1bf4a", work_date: "2026-10-01", fields });
  assert.equal(a.test, true);
  assert.equal(a.lead, "Zak Lundblade");
  assert.ok(a.jobs.every(j => !j.skipped && j.pct === 100 && !j.flags.length));
  assert.equal(a.dayPct, 100);
});

test("TEST Brock Morrow 2026-10-03: Not Scheduled with steps -> scored and flagged 'check this'", () => {
  const a = scoreTechAudit({ id: "6ac4289100db83258b8a2c3c", work_date: "2026-10-03", fields: {
    fieldsOriSequance: OLD_FORM,
    "wWEni4JJVpTdbpRFzZRu": ["Not scheduled", "On my Way", "Before Pictures", "After Pictures", "Send Invoice"], "AqH3PL6wI1TROYl86C3M": "Yes", "zRIHBlKBZT8KrcY6l7rI": "On time", "ndftAbwlEYb1VE4OfCPO": "No",
    "6ku5mwXQIpIahX7JvcT9": ["Start Job", "Not Scheduled", "On My Way", "Before Pictures", "Workflow Checklist", "After Pictures", "Finish", "Send Invoice"], "8oM3PJ48QtcrbxzeYLuQ": "Yes", "tpZsIalOFoFkBIWMtyua": "Yes",
    "XDlSPqE6ZBuHAgYr1oSE": ALL, "KUQsapPszHcamVVGyTKU": "Yes", "V7gx9O3Tjuyt4hvIbrkm": "Yes",
  } });
  const nine = job(a, "9am"), noon = job(a, "12pm");
  assert.ok(!nine.skipped && !noon.skipped);
  assert.ok(nine.flags.some(f => /check this/.test(f)) && noon.flags.some(f => /check this/.test(f)));
  assert.deepEqual(nine.missed, ["Job flow: Start Job", "Job flow: Workflow Checklist", "Job flow: Finish", "No night-before text"]);
  assert.equal(round1(nine.pct), 64.3);
  assert.equal(noon.pct, 100);
  assert.equal(round1(a.dayPct), 88.1);
});

test("TEST Brock Morrow 2026-10-08 (newer format): gate skips 9 AM, blank gate on a job with answers is flagged", () => {
  const a = scoreTechAudit({ id: "6ac42d177ce1d36fe8bbadf5", work_date: "2026-10-08", fields: {
    fieldsOriSequance: NEW_FORM,
    "05OLtXaKM8pSHVkhOqgd": "Not Scheduled", "wWEni4JJVpTdbpRFzZRu": [],
    "6ku5mwXQIpIahX7JvcT9": ["Before Pictures", "Start Job", "Workflow Checklist", "After Pictures", "Finish"], "8oM3PJ48QtcrbxzeYLuQ": "Yes", "VlUP3BVq7XSNgrIX63H4": "Yes", "tpZsIalOFoFkBIWMtyua": "Yes",
    "0lqU9nNMrhT2lXo4vonS": "Yes", "XDlSPqE6ZBuHAgYr1oSE": ["Workflow Checklist", "Before Pictures", "Start Job"], "KUQsapPszHcamVVGyTKU": "Yes", "1QLMckw9gCJckKg1pUA4": "Yes", "V7gx9O3Tjuyt4hvIbrkm": "Yes",
  } });
  assert.equal(job(a, "9am").skipped, true);
  assert.equal(round1(job(a, "12pm").pct), 92.9);
  assert.ok(job(a, "12pm").flags.some(f => /left blank/.test(f)));
  assert.equal(round1(job(a, "3pm").pct), 85.7);
  assert.equal(round1(a.dayPct), 89.3);
});

test("blank scored question on a scheduled job = 0 and 'incomplete'", () => {
  const fields = { ...workedExample.fields }; delete fields["ndftAbwlEYb1VE4OfCPO"];
  const nine = job(scoreTechAudit({ ...workedExample, fields }), "9am");
  assert.equal(round1(nine.pct), round1((6 / 7 + 0.5 + 2) / 5 * 100));
  assert.ok(nine.flags.some(f => /incomplete/.test(f)));
});

test("a renamed question listed with old and new ids reads either one", () => {
  const cfg = structuredClone(AUDIT_CONFIG.audit);
  cfg.slots[0].fields.arrival.ids.push("NEWARRIVALID");
  const fields = { ...workedExample.fields, fieldsOriSequance: NEW_FORM.map(id => id === "zRIHBlKBZT8KrcY6l7rI" ? "NEWARRIVALID" : id) };
  delete fields["zRIHBlKBZT8KrcY6l7rI"]; fields.NEWARRIVALID = "On time";
  const a = scoreTechAudit({ ...workedExample, fields }, cfg);
  assert.equal(round1(job(a, "9am").pct), round1((6 / 7 + 4) / 5 * 100));
  assert.deepEqual(a.unmappedFieldIds, []);
  // Without the new id in config, it's reported as unmapped.
  assert.deepEqual(scoreTechAudit({ ...workedExample, fields }).unmappedFieldIds, ["NEWARRIVALID"]);
});

test("same Job Date twice keeps the latest; job count never hurts; week = average of days", () => {
  const two = scoreTechAudit({ ...workedExample, id: "late", submitted_at: "2026-10-09T01:00:00Z", fields: { ...workedExample.fields, "05OLtXaKM8pSHVkhOqgd": "Not Scheduled" } });
  const days = auditDays([scoreTechAudit(workedExample), two]);
  assert.equal(days.length, 1);
  assert.equal(days[0].audit.id, "late");
  assert.equal(days[0].pct, 75);   // only the 12 PM job is scheduled on the latest one
  const perfect = { ...workedExample.fields, "wWEni4JJVpTdbpRFzZRu": ALL, "zRIHBlKBZT8KrcY6l7rI": "On time", "VlUP3BVq7XSNgrIX63H4": "Yes" };
  assert.equal(scoreTechAudit({ ...workedExample, fields: perfect }).dayPct, 100);   // 2 perfect jobs = 100%
  assert.equal(weeklyAuditPct([{ pct: 81.1 }, { pct: 100 }, { pct: null }]), 90.55);
});

test("Audit Scores weeks run Wednesday-Tuesday", () => {
  assert.equal(auditWeekStart("2026-09-30"), "2026-09-30");   // Wednesday
  assert.equal(auditWeekStart("2026-10-04"), "2026-09-30");   // Sunday
  assert.equal(auditWeekStart("2026-10-06"), "2026-09-30");   // Tuesday
  assert.equal(auditWeekStart("2026-10-07"), "2026-10-07");   // next Wednesday
  assert.equal(auditWeekStart("2026-10-10", 0), "2026-10-04"); // Sunday option still works
});

test("Tote deductions: failed checks only, each lost item charged once, waivers skip", () => {
  const chk = (id, work_date, missing) => { const m = missing.map(name => ({ name, cents: AUDIT_CONFIG.tote.items.find(i => i.name === name).cents })); const cents = m.reduce((s, x) => s + x.cents, 0); return { id, work_date, submitted_at: work_date, missing: m, missingCents: cents, pass: cents <= AUDIT_CONFIG.tote.passMaxMissingCents }; };
  const r = toteCharges([
    chk("a", "2026-10-01", ["Tooth Brush"]),                       // $1 -- passes, not charged
    chk("b", "2026-10-07", ["Tornador", "Tooth Brush"]),           // fails: both charged
    chk("c", "2026-10-14", ["Tornador", "Wax"]),                   // Tornador still gone: already charged; Wax $3 charged
    chk("d", "2026-10-21", []),                                    // everything back
    chk("e", "2026-10-28", ["Tornador", "Foam Cannon"]),           // lost again: charged again; Foam Cannon waived
  ], new Set(["e|Foam Cannon"]));
  assert.deepEqual(r.map(x => x.check.id), ["b", "c", "e"]);
  assert.equal(r[0].chargedCents, 6100);
  assert.deepEqual(r[1].items.map(i => i.status), ["already", "charged"]);
  assert.equal(r[1].chargedCents, 300);
  assert.deepEqual(r[2].items.map(i => i.status), ["charged", "waived"]);
  assert.equal(r[2].chargedCents, 6000);
});

test("Tech name falls back to the form's First/Last Name (Forms tab prefill)", () => {
  assert.equal(techNameOf(AUDIT_CONFIG.tote.formId, {}, { first_name: "Brett", last_name: "Buhler" }), "Brett Buhler");
  assert.equal(techNameOf(AUDIT_CONFIG.audit.formId, {}, { first_name: " Landon ", last_name: "Bliss" }), "Landon Bliss");
  assert.equal(techNameOf(AUDIT_CONFIG.tote.formId, { Tech: "Kyle Reiff" }, { first_name: "X", last_name: "Y" }), "Kyle Reiff");
});

test("truck check photos: any image or GHL file link, anywhere in the submission", () => {
  const sub = {
    answers: { "Front of truck": "https://example.com/a.JPG", Notes: "all good, see http://x.com/page", "Date": "2026-10-05" },
    fields: {
      abc123: { "f1e2": { url: "https://services.leadconnectorhq.com/documents/download/XYZ", meta: { name: "IMG_1.heic" } } },
      def456: [{ url: "https://storage.googleapis.com/msgsndr/loc/media/b.png?alt=1" }, "https://example.com/a.JPG"],
      list: "https://example.com/c.jpeg, https://example.com/d.webp",
    },
  };
  assert.deepEqual(submissionPhotoUrls(sub).map(p => [p.url, p.image]), [
    ["https://example.com/a.JPG", true],
    ["https://services.leadconnectorhq.com/documents/download/XYZ", false],
    ["https://storage.googleapis.com/msgsndr/loc/media/b.png?alt=1", true],
    ["https://example.com/c.jpeg", true],
    ["https://example.com/d.webp", true],
  ]);
  assert.deepEqual(submissionPhotoUrls({}), []);
});
