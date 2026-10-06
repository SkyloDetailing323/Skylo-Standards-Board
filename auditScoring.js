// auditScoring.js
// Scores the two GoHighLevel inspection forms team leads fill out: Tote
// Checks (what's missing from a tech's tote, in dollars) and Tech Audits
// (job flow, cards, flyers, night-before text and on-time arrival for up to
// three jobs a day). Pure functions with no React or network code, so the
// Audit Scores page and the sync function (netlify/functions/ghl-forms-sync.mjs)
// read the forms exactly the same way.
//
// Display only -- nothing here feeds pay or bonuses.
//
// Every form label, option name and price lives in AUDIT_CONFIG below. The
// audit form is still being finalized: when a question is renamed in GHL,
// change its matcher here. Matching ignores case, spaces and punctuation, so
// "Drill - Battery - Charger" matches "Drill-Battery-Charger".

export const AUDIT_CONFIG = {
  tote: {
    formId: "xU7BPLPkUCLiefCvawVx",
    techLabels: ["Tech", "Detail Tech"],
    checkedByLabels: ["Checked by", "Checked By", "Team Lead", "Inspector"],
    dateLabels: ["Date"],
    // The checkbox question(s) listing what IS in the tote. If none of these
    // labels match, every checkbox answer on the form is read instead.
    itemsLabels: ["Tote", "Tote Items", "Tote Check", "Items"],
    passMaxMissingCents: 700,           // $7.00 missing = 95% = pass; $7.50 = fail
    // Techs whose tote checks only count when one of these leads did them.
    restrictedTechs: ["Kyle Reiff", "Tom Lorenc", "Mason Dixon"],
    allowedCheckers: ["Zak Lundblade", "Will Faulkner"],
    // Prices in cents. Total $278.00.
    items: [
      { name: "Drill-Battery-Charger", cents: 10000, aliases: ["Drill", "Drill Battery Charger"] },
      { name: "Tornador",              cents: 6000 },
      { name: "Foam Cannon",           cents: 2500 },
      { name: "Wash Wand",             cents: 2000 },
      { name: "Tire Brush",            cents: 800 },
      { name: "Wheel Well Brush",      cents: 400 },
      { name: "LVP",                   cents: 350 },
      { name: "All Purpose",           cents: 350, aliases: ["All Purpose Cleaner", "APC"] },
      { name: "Carpet Cleaner",        cents: 350 },
      { name: "Window",                cents: 350, aliases: ["Window Cleaner", "Glass Cleaner"] },
      { name: "Air Deodorizer",        cents: 350, aliases: ["Deodorizer", "Air Freshener"] },
      { name: "Adhesive Remover",      cents: 350 },
      { name: "Hard Water Spot",       cents: 350, aliases: ["Hard Water Spot Remover"] },
      { name: "IPA",                   cents: 350 },
      { name: "Bug remover",           cents: 350, aliases: ["Bug Remover"] },
      { name: "Tire Shine",            cents: 350 },
      { name: "Tire Cleaner",          cents: 350 },
      { name: "Tar Remover",           cents: 350 },
      { name: "Wax",                   cents: 300 },
      { name: "Detail Brush",          cents: 300 },
      { name: "Flat Head Brush",       cents: 300 },
      { name: "Cone Head Brush",       cents: 300 },
      { name: "Carpet Striper",        cents: 200 },
      { name: "Scrub Ninja",           cents: 100 },
      { name: "Wax Applicator",        cents: 100 },
      { name: "Tire Shine Applicator", cents: 100 },
      { name: "Tooth Brush",           cents: 100, aliases: ["Toothbrush"] },
      { name: "Pumice Stone",          cents: 100 },
    ],
  },
  // Tech Audit Form. Matched by GHL FIELD ID, not label: labels were renamed
  // while the form was being set up, so older submissions carry old labels.
  // Ids marked "inferred" have only ever been answered "Yes" (or never
  // answered) in the test submissions, so they were placed by their position
  // in the form -- confirm them if a score looks off.
  audit: {
    formId: "6bvUQqmnOb3auzX0hw9W",
    fields: {
      tech:    "Ga8aYHKmIy2SQ9KGqqEf",   // Detail Tech
      lead:    "FY37nOA0b0rDZZaxRqAM",   // Tech Lead
      jobDate: "Vub4DsjU4dfJlgUzfq67",   // Job Date
      notes:   "EJJQZ19dNUswO6Kwuodj",   // Notes (Optional) -- inferred
    },
    // GHL bookkeeping in each submission that isn't a form question.
    ignoreFieldIds: ["button", "header"],
    slots: [
      { key: "9am", label: "9 AM", fields: {
        scheduled: "05OLtXaKM8pSHVkhOqgd",  // "Job 9 am." Not Scheduled / Yes
        flow:      "wWEni4JJVpTdbpRFzZRu",  // "9 am" job flow checkbox
        card:      "AqH3PL6wI1TROYl86C3M",  // "9 am. Customer Satisfaction Card"
        marketing: "h6JuR4LttlIbf6lRV9aU",  // "9 am. Tech Marketing" -- inferred (never answered yet)
        nightText: "ndftAbwlEYb1VE4OfCPO",  // "9 am. Night Before"
        arrival:   "zRIHBlKBZT8KrcY6l7rI",  // "9 am. Arrival on time"
      } },
      { key: "12pm", label: "12 PM", fields: {
        scheduled: "XukjjfMrjTfLU5avtVwq",  // "Job 12 pm." -- inferred (never answered yet)
        flow:      "6ku5mwXQIpIahX7JvcT9",  // "12 pm. Audits"
        card:      "8oM3PJ48QtcrbxzeYLuQ",  // "12 pm. Customer Satisfaction Card" -- inferred
        marketing: "VlUP3BVq7XSNgrIX63H4",  // "12 pm. Tech Marketing"
        nightText: "tpZsIalOFoFkBIWMtyua",  // "12 pm. Night Before Text" -- inferred
      } },
      { key: "3pm", label: "3 PM", fields: {
        scheduled: "0lqU9nNMrhT2lXo4vonS",  // "Job 3 pm."
        flow:      "XDlSPqE6ZBuHAgYr1oSE",  // "3 pm. Audits"
        card:      "KUQsapPszHcamVVGyTKU",  // "3 pm. Customer Satifaction Card" -- inferred
        marketing: "1QLMckw9gCJckKg1pUA4",  // "3 pm. Tech Marketing"
        nightText: "V7gx9O3Tjuyt4hvIbrkm",  // "3 pm. Night Before Text" -- inferred
      } },
    ],
    // Job flow: 1 point total, 1/7 per step.
    flowSteps: ["On my Way", "Start Job", "Before Pictures", "Workflow Checklist", "After Pictures", "Finish", "Send Invoice"],
    notScheduled: "Not Scheduled",
    ignoreOptions: ["Type an Option", "Other", "Not Scheduled"],
    // Yes = 1, No = 0.
    yesNo: [
      { key: "card",      name: "Customer Satisfaction Card", missed: "No satisfaction card" },
      { key: "marketing", name: "Tech Marketing (3 flyers)",  missed: "No flyers" },
      { key: "nightText", name: "Night Before Text",          missed: "No night-before text" },
    ],
    // 9 AM only. "5 min or more" is the form's current wording until it's
    // changed to "1-10 min late".
    arrivalOptions: [
      { answer: "On time",               points: 1 },
      { answer: "1-10 min late",         points: 0.5 },
      { answer: "5 min or more",         points: 0.5 },
      { answer: "More than 10 min late", points: 0 },
    ],
  },
  // The Audit Scores tab's week. 1 = Monday (Mon-Sun), 0 = Sunday (Sun-Sat,
  // like the rest of the app).
  weekStartsOn: 1,
};

// ─── matching helpers ──────────────────────────────────────────────────────
export const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const toList = v => v == null || v === "" ? [] : Array.isArray(v) ? v.flatMap(toList) : typeof v === "string" && v.includes(",") && !/\d,\d/.test(v) ? v.split(",").map(s => s.trim()).filter(Boolean) : [String(v).trim()];
const firstText = v => toList(v)[0] || "";

// First answer whose label exactly matches one of `labels` (normalized).
export function findAnswer(answers, labels) {
  const want = labels.map(norm);
  for (const [label, value] of Object.entries(answers || {})) if (want.includes(norm(label))) return value;
  return undefined;
}
// Mountain-time calendar date of a submission: the form's own Date question
// if it has one, otherwise when it was submitted. Fixed -6h, same as the rest
// of the app.
export function workDateOf(answers, submittedAt, dateLabels) {
  // GHL can save the question with a suffix (e.g. "Date 84cb"), so a label
  // that starts with one of dateLabels counts too.
  let raw = findAnswer(answers, dateLabels);
  if (raw === undefined) {
    const want = dateLabels.map(norm);
    const hit = Object.entries(answers || {}).find(([l]) => want.some(w => norm(l).startsWith(w)));
    raw = hit ? hit[1] : undefined;
  }
  const d = firstText(raw);
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/) || null;
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const us = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const ms = Date.parse(submittedAt);
  return isNaN(ms) ? null : new Date(ms - 6 * 3600 * 1000).toISOString().slice(0, 10);
}

export function formKind(formId) {
  if (formId === AUDIT_CONFIG.tote.formId) return "tote";
  if (formId === AUDIT_CONFIG.audit.formId) return "audit";
  return null;
}
// fields: the submission's raw answers keyed by GHL field id (raw.others).
export function techNameOf(formId, answers, fields) {
  const kind = formKind(formId);
  if (kind === "audit") return firstText((fields || {})[AUDIT_CONFIG.audit.fields.tech]) || null;
  return kind ? firstText(findAnswer(answers, AUDIT_CONFIG[kind].techLabels)) || null : null;
}
export function auditJobDate(fields) {
  const d = firstText((fields || {})[AUDIT_CONFIG.audit.fields.jobDate]);
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

// Monday (or Sunday, per weekStartsOn) that starts the week holding a
// YYYY-MM-DD date.
export function auditWeekStart(dateStr, startsOn = AUDIT_CONFIG.weekStartsOn) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - startsOn + 7) % 7));
  return d.toISOString().slice(0, 10);
}

// ─── tote checks ───────────────────────────────────────────────────────────
// sub: { id, answers, submitted_at, work_date, tech_name }
export function scoreToteCheck(sub, cfg = AUDIT_CONFIG.tote) {
  const answers = sub.answers || {};
  const flags = [];
  let picked = toList(findAnswer(answers, cfg.itemsLabels));
  if (!picked.length) {
    // No items question by name -- read every multi-choice answer instead.
    picked = Object.values(answers).filter(Array.isArray).flatMap(toList);
  }
  const lookup = {};
  cfg.items.forEach(it => [it.name, ...(it.aliases || [])].forEach(n => { lookup[norm(n)] = it.name; }));
  const present = new Set();
  const techN = norm(sub.tech_name), checkerN = norm(firstText(findAnswer(answers, cfg.checkedByLabels)));
  for (const p of picked) {
    const hit = lookup[norm(p)];
    if (hit) present.add(hit);
    else if (norm(p) && norm(p) !== techN && norm(p) !== checkerN) flags.push(`Unrecognized item "${p}" — add it to AUDIT_CONFIG if it's a tote item`);
  }
  if (!picked.length) flags.push("No checked items found on this form — check the field labels in AUDIT_CONFIG");
  const missing = cfg.items.filter(it => !present.has(it.name)).map(it => ({ name: it.name, cents: it.cents }));
  const missingCents = missing.reduce((s, m) => s + m.cents, 0);
  const score = Math.max(0, 100 - missingCents * 5 / 700);
  const checkedBy = firstText(findAnswer(answers, cfg.checkedByLabels)) || null;
  let excluded = false;
  if (cfg.restrictedTechs.map(norm).includes(techN) && !cfg.allowedCheckers.map(norm).includes(norm(checkedBy))) {
    excluded = true;
    flags.push(`Checked by ${checkedBy || "(blank)"} — ${sub.tech_name}'s tote must be checked by ${cfg.allowedCheckers.join(" or ")}. Not counted.`);
  }
  return { kind: "tote", id: sub.id, work_date: sub.work_date, submitted_at: sub.submitted_at, checkedBy,
    missing, missingCents, score, pass: missingCents <= cfg.passMaxMissingCents, excluded, flags };
}

// Same tech, same day, more than one check: keep the latest.
export function latestPerDay(scored) {
  const byDay = {};
  for (const s of scored) {
    const k = s.work_date;
    if (!byDay[k] || (s.submitted_at || "") > (byDay[k].submitted_at || "")) byDay[k] = s;
  }
  return Object.values(byDay).sort((a, b) => (b.work_date || "").localeCompare(a.work_date || ""));
}

// ─── tech audits ───────────────────────────────────────────────────────────
// sub: { id, work_date, submitted_at, tech_name, fields } -- fields keyed by
// GHL field id. fields.fieldsOriSequance lists the questions the form had
// when it was submitted: a question missing from it didn't exist yet (e.g.
// Tech Marketing on the first test submissions) and isn't scored, while a
// question on the form but left blank scores 0 and is flagged incomplete.
export function scoreTechAudit(sub, cfg = AUDIT_CONFIG.audit) {
  const f = sub.fields || {};
  const seq = Array.isArray(f.fieldsOriSequance) ? f.fieldsOriSequance : null;
  const onForm = id => !seq || seq.includes(id);
  const blank = v => toList(v).length === 0;
  const ns = norm(cfg.notScheduled);
  const ignore = cfg.ignoreOptions.map(norm);
  const stepByNorm = Object.fromEntries(cfg.flowSteps.map(s => [norm(s), s]));
  const unmapped = [];   // answers the config doesn't know: fix the form or AUDIT_CONFIG
  const jobs = [];

  for (const slot of cfg.slots) {
    const q = slot.fields;
    const job = { slot: slot.key, label: slot.label, skipped: false, points: 0, max: 0, pct: 0, missed: [], flags: [] };
    const flowRaw = toList(f[q.flow]);
    const flowNotSched = flowRaw.some(v => norm(v) === ns);
    const answered = ["flow", "card", "marketing", "nightText", "arrival"].some(k => q[k] && !blank(f[q[k]]));

    if (q.scheduled && onForm(q.scheduled)) {
      const gate = firstText(f[q.scheduled]);
      if (norm(gate) === ns) { jobs.push({ ...job, skipped: true, skipReason: "Not scheduled" }); continue; }
      if (!gate && !answered) { jobs.push({ ...job, skipped: true, skipReason: "No answers" }); continue; }
      if (!gate) job.flags.push(`"Job ${slot.label.toLowerCase()}." question left blank — scored because the job has answers`);
      else if (norm(gate) !== "yes") { job.flags.push(`Unrecognized answer "${gate}" on "Job ${slot.label.toLowerCase()}."`); unmapped.push(`Job ${slot.label}: "${gate}"`); }
    } else {
      // Older submissions had no "Job <time>." question: "Not Scheduled"
      // alone in the job flow means skip.
      const steps = flowRaw.filter(v => !ignore.includes(norm(v)));
      if (flowNotSched && !steps.length) { jobs.push({ ...job, skipped: true, skipReason: "Not scheduled" }); continue; }
      if (!answered) { jobs.push({ ...job, skipped: true, skipReason: "No answers" }); continue; }
      if (flowNotSched) job.flags.push("Not Scheduled checked along with job steps — check this");
    }

    // Job flow
    if (onForm(q.flow)) {
      job.max += 1;
      const done = new Set();
      for (const v of flowRaw) {
        if (ignore.includes(norm(v))) continue;
        if (stepByNorm[norm(v)]) done.add(stepByNorm[norm(v)]);
        else { job.flags.push(`Unrecognized job flow option "${v}"`); unmapped.push(`${slot.label} job flow: "${v}"`); }
      }
      const missedSteps = cfg.flowSteps.filter(s => !done.has(s));
      job.points += done.size / cfg.flowSteps.length;
      missedSteps.forEach(s => job.missed.push(`Job flow: ${s}`));
      if (!done.size) job.flags.push("Job flow left blank — incomplete");
    }
    // Yes / No questions
    for (const yn of cfg.yesNo) {
      const id = q[yn.key];
      if (!id || !onForm(id)) continue;
      job.max += 1;
      const v = firstText(f[id]);
      if (norm(v) === "yes") job.points += 1;
      else if (norm(v) === "no") job.missed.push(yn.missed);
      else if (!v) { job.missed.push(`${yn.name}: no answer`); job.flags.push(`${yn.name} left blank — incomplete`); }
      else { job.missed.push(`${yn.name}: "${v}"`); job.flags.push(`Unrecognized answer "${v}" on ${yn.name}`); unmapped.push(`${slot.label} ${yn.name}: "${v}"`); }
    }
    // Arrival (9 AM only)
    if (q.arrival && onForm(q.arrival)) {
      job.max += 1;
      const v = firstText(f[q.arrival]);
      const opt = cfg.arrivalOptions.find(o => norm(o.answer) === norm(v));
      if (opt) { job.points += opt.points; if (opt.points < 1) job.missed.push(`Late: ${v}`); }
      else if (!v) { job.missed.push("Arrival: no answer"); job.flags.push("Arrival on time left blank — incomplete"); }
      else { job.missed.push(`Arrival: "${v}"`); job.flags.push(`Unrecognized arrival answer "${v}"`); unmapped.push(`${slot.label} arrival: "${v}"`); }
    }
    job.pct = job.max ? job.points / job.max * 100 : 0;
    jobs.push(job);
  }

  // Questions on the form that AUDIT_CONFIG doesn't know about.
  const known = new Set([...Object.values(cfg.fields), ...cfg.slots.flatMap(s => Object.values(s.fields)), ...cfg.ignoreFieldIds]);
  const unmappedFieldIds = (seq || []).filter(id => !known.has(id));
  const scoredJobs = jobs.filter(j => !j.skipped);
  const flags = [];
  if (!scoredJobs.length) flags.push("No jobs scored on this audit — every job blank or Not Scheduled");
  if (unmappedFieldIds.length) flags.push(`Form has question id(s) not in AUDIT_CONFIG: ${unmappedFieldIds.join(", ")}`);
  return { kind: "audit", id: sub.id, work_date: sub.work_date, submitted_at: sub.submitted_at,
    lead: firstText(f[cfg.fields.lead]) || null, notes: firstText(f[cfg.fields.notes]) || null,
    jobs, dayPct: scoredJobs.length ? scoredJobs.reduce((s, j) => s + j.pct, 0) / scoredJobs.length : null,
    flags, unmapped, unmappedFieldIds };
}

// One audit per tech per Job Date: if the same day was submitted twice, the
// latest submission wins. Day score = average of that day's scheduled jobs,
// so 2 perfect jobs = 100%, same as 3.
export function auditDays(scored) {
  return latestPerDay(scored).map(a => ({ date: a.work_date, audit: a, replaced: scored.filter(x => x.work_date === a.work_date).length - 1, pct: a.dayPct }));
}
// Weekly score = average of the day scores (each day counts the same).
export function weeklyAuditPct(days) {
  const scored = days.filter(d => d.pct != null);
  return scored.length ? scored.reduce((s, d) => s + d.pct, 0) / scored.length : null;
}
