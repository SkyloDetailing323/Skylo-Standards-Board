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
  audit: {
    formId: "6bvUQqmnOb3auzX0hw9W",
    techLabels: ["Tech", "Detail Tech"],
    dateLabels: ["Date"],
    // Each job's questions start with its time slot, e.g. "9 am. Audits".
    slots: [
      { key: "9am",  label: "9 AM",  prefixes: ["9 am", "9am", "9:00 am"],   onTime: true },
      { key: "12pm", label: "12 PM", prefixes: ["12 pm", "12pm", "12:00 pm"], onTime: false },
      { key: "3pm",  label: "3 PM",  prefixes: ["3 pm", "3pm", "3:00 pm"],   onTime: false },
    ],
    // The job flow checkbox ("Audits"): 1/7 point per step.
    flowLabels: ["Audits", "Job Flow"],
    flowSteps: ["On my Way", "Start Job", "Before Pictures", "Workflow Checklist", "After Pictures", "Finish", "Send Invoice"],
    notScheduled: "Not Scheduled",
    ignoreOptions: ["Type an Option", "Other"],
    // Yes/No questions worth 1 point each.
    yesNo: [
      // "Satifaction" is how the 3 pm question is spelled on the GHL form.
      { key: "card",      name: "Customer Satisfaction Card", labels: ["Customer Satisfaction Card", "Satisfaction Card", "Satifaction Card"] },
      { key: "marketing", name: "Tech Marketing (3 flyers)",  labels: ["Tech Marketing", "Flyers"] },
      { key: "nightText", name: "Night Before Text",          labels: ["Night Before Text", "Night Before"] },
    ],
    // 9 AM job only.
    onTimeLabels: ["Arriving on time", "Arrived on time", "On time"],
    onTimeOptions: [
      { match: ["On time", "On Time"], points: 1 },
      { match: ["1-10 min late", "1-10 minutes late", "1 - 10 min late"], points: 0.5 },
      { match: ["More than 10 min late", "More than 10 minutes late", "10+ min late"], points: 0 },
    ],
  },
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
// Answers whose label starts with a slot prefix and contains one of `labels`.
function findSlotAnswer(answers, prefixes, labels) {
  const pre = prefixes.map(norm), want = labels.map(norm);
  for (const [label, value] of Object.entries(answers || {})) {
    const n = norm(label);
    const p = pre.find(x => n.startsWith(x));
    if (p && want.some(w => n.slice(p.length).includes(w))) return { found: true, value };
  }
  return { found: false, value: undefined };
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
export function techNameOf(formId, answers) {
  const kind = formKind(formId);
  return kind ? firstText(findAnswer(answers, AUDIT_CONFIG[kind].techLabels)) || null : null;
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
export function scoreTechAudit(sub, cfg = AUDIT_CONFIG.audit) {
  const answers = sub.answers || {};
  const ignore = cfg.ignoreOptions.map(norm);
  const ns = norm(cfg.notScheduled);
  const jobs = [];
  for (const slot of cfg.slots) {
    // The job flow question is "12 pm. Audits", but the 9 am one is labelled
    // just "9 am" on the form -- a label that's only the slot counts as flow.
    let flow = findSlotAnswer(answers, slot.prefixes, cfg.flowLabels);
    if (!flow.found) {
      const pre = slot.prefixes.map(norm);
      const hit = Object.entries(answers || {}).find(([l]) => pre.includes(norm(l)));
      if (hit) flow = { found: true, value: hit[1] };
    }
    const picked = toList(flow.value).filter(v => !ignore.includes(norm(v)));
    const notSched = picked.some(v => norm(v) === ns);
    const steps = picked.filter(v => norm(v) !== ns);
    const yn = cfg.yesNo.map(q => ({ q, ...findSlotAnswer(answers, slot.prefixes, q.labels) }));
    const onTime = slot.onTime ? findSlotAnswer(answers, slot.prefixes, cfg.onTimeLabels) : null;
    const otherAnswered = yn.some(a => firstText(a.value)) || (onTime && firstText(onTime.value));
    const job = { slot: slot.key, label: slot.label, skipped: false, points: 0, max: slot.onTime ? 5 : 4, pct: 0, missed: [], flags: [] };
    if (notSched && !steps.length) { jobs.push({ ...job, skipped: true, skipReason: "Not scheduled" }); continue; }
    if (!steps.length && !otherAnswered) { jobs.push({ ...job, skipped: true, skipReason: "No answers" }); continue; }
    if (notSched) job.flags.push("Marked Not Scheduled but also has job steps — check this");

    const done = new Set(steps.map(norm));
    const stepNames = cfg.flowSteps.map(norm);
    steps.filter(s => !stepNames.includes(norm(s))).forEach(s => job.flags.push(`Unrecognized job flow step "${s}"`));
    const missedSteps = cfg.flowSteps.filter(s => !done.has(norm(s)));
    job.points += (cfg.flowSteps.length - missedSteps.length) / cfg.flowSteps.length;
    missedSteps.forEach(s => job.missed.push(`Job flow: ${s}`));

    for (const a of yn) {
      const v = norm(firstText(a.value));
      if (v === "yes") job.points += 1;
      else job.missed.push(a.found && v ? `${a.q.name}: ${firstText(a.value)}` : `${a.q.name}: no answer`);
    }
    if (onTime) {
      const v = norm(firstText(onTime.value));
      const opt = cfg.onTimeOptions.find(o => o.match.map(norm).includes(v));
      if (opt) { job.points += opt.points; if (opt.points < 1) job.missed.push(`Arrival: ${firstText(onTime.value)}`); }
      else job.missed.push(v ? `Arrival: "${firstText(onTime.value)}" (unrecognized answer)` : "Arrival: no answer");
    }
    job.pct = job.points / job.max * 100;
    jobs.push(job);
  }
  const scoredJobs = jobs.filter(j => !j.skipped);
  const flags = scoredJobs.length ? [] : ["No jobs scored on this audit — all slots blank or Not Scheduled"];
  if (!Object.keys(answers).some(l => cfg.slots.some(s => s.prefixes.some(p => norm(l).startsWith(norm(p))))))
    flags.push("No \"9 am. / 12 pm. / 3 pm.\" questions found — check the field labels in AUDIT_CONFIG");
  return { kind: "audit", id: sub.id, work_date: sub.work_date, submitted_at: sub.submitted_at, jobs,
    dayPct: scoredJobs.length ? scoredJobs.reduce((s, j) => s + j.pct, 0) / scoredJobs.length : null, flags };
}

// One day can have more than one audit submission (e.g. resubmitted): every
// scored job from that day counts, and the day score is the average of them.
export function auditDays(scored) {
  const byDay = {};
  for (const a of scored) (byDay[a.work_date] = byDay[a.work_date] || []).push(a);
  return Object.entries(byDay).map(([date, list]) => {
    const jobs = list.flatMap(a => a.jobs.filter(j => !j.skipped));
    return { date, audits: list, jobs, pct: jobs.length ? jobs.reduce((s, j) => s + j.pct, 0) / jobs.length : null };
  }).sort((a, b) => b.date.localeCompare(a.date));
}
// Weekly score = average of the day scores (each day counts the same).
export function weeklyAuditPct(days) {
  const scored = days.filter(d => d.pct != null);
  return scored.length ? scored.reduce((s, d) => s + d.pct, 0) / scored.length : null;
}
