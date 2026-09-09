// netlify/functions/lib/tipEmailParser.js
// Parses a Housecall Pro payment-receipt email body (plain text, or HTML with
// tags already stripped to newlines by gmailClient.extractBody) into the
// fields the tip-sync function needs.
//
// IMPORTANT: the subject line's dollar amount ("Client Name - $230.00") is
// Amount Paid, NOT the tip -- this file never reads the subject for a dollar
// figure, only the body's own "Tip" line, per the spec that got this whole
// automation built (some payments legitimately have a $0 tip even on a large
// Amount Paid, which is normal and means "skip", not "error").

function findAfterLabel(text, labelRegex, valuePattern) {
  const m = labelRegex.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  const window = text.slice(start, start + 150);
  const vm = window.match(valuePattern);
  return vm ? vm[1] : null;
}

function toISODate(str) {
  // e.g. "Sep 07, 2026" -> "2026-09-07". Noon avoids any UTC-offset day
  // rollover from a bare midnight Date parse.
  const d = new Date(`${str} 12:00:00`);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function parseMoney(str) {
  if (str == null) return null;
  const n = parseFloat(str.replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

// Returns { jobNumber, serviceDateISO, tipAmount, amountPaid }. Any field
// that couldn't be found comes back null -- callers decide what's fatal.
function parseTipEmail(bodyText) {
  const jobNumber = findAfterLabel(bodyText, /Job\s*Number\s*:?/i, /(\d{3,})/);
  const dateStr   = findAfterLabel(bodyText, /Service\s*Date\s*:?/i, /([A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4})/);
  const tipStr    = findAfterLabel(bodyText, /\bTip\b\s*:?/i, /\$?\s*(-?[\d,]+\.\d{2})/);
  const paidStr   = findAfterLabel(bodyText, /Amount\s*Paid\s*:?/i, /\$?\s*(-?[\d,]+\.\d{2})/);

  return {
    jobNumber,
    serviceDateISO: dateStr ? toISODate(dateStr) : null,
    tipAmount: parseMoney(tipStr),
    amountPaid: parseMoney(paidStr),
  };
}

module.exports = { parseTipEmail };
