// salesPoints.js
// Trevor's (residential sales) monthly bonus: every new client he closes
// earns points from the ticket price x service frequency table below, and his
// points for the calendar month pick one bonus tier. Tiers reset each month
// and don't stack. Pure functions with no React or network code.
//
// Owner rules (Oct 2026):
// - The table is the source of truth -- no formula.
// - A ticket price rounds DOWN to the nearest row ($329 -> the $325 row).
// - $145 is the minimum ticket, so anything under it uses the $145 row.
// - Over $1,000 keeps climbing in $50 steps by the same amount the table
//   adds from $950 to $1,000 (e.g. weekly +68 per $50).

export const FREQUENCIES = ["weekly","biweekly","monthly","bimonthly","quarterly","one_time"];
export const FREQ_LABEL = { weekly:"Weekly", biweekly:"Bi-weekly", monthly:"Monthly", bimonthly:"Bi-monthly", quarterly:"Quarterly", one_time:"One-time" };

// [price, weekly, biweekly, monthly, bimonthly, quarterly, one-time]
export const POINTS_TABLE = [
  [145,  116,   58,  27,  13,  9,  2],
  [150,  122,   61,  28,  14,  9,  2],
  [175,  156,   78,  36,  18, 12,  3],
  [200,  190,   95,  44,  22, 15,  4],
  [225,  224,  112,  52,  26, 17,  4],
  [250,  258,  129,  59,  30, 20,  5],
  [275,  291,  146,  67,  34, 22,  6],
  [300,  325,  163,  75,  38, 25,  6],
  [325,  359,  180,  83,  41, 28,  7],
  [350,  393,  196,  91,  45, 30,  8],
  [400,  460,  230, 106,  53, 35,  9],
  [450,  528,  264, 122,  61, 41, 10],
  [500,  596,  298, 137,  69, 46, 11],
  [550,  663,  332, 153,  77, 51, 13],
  [600,  731,  365, 169,  84, 56, 14],
  [650,  798,  399, 184,  92, 61, 15],
  [700,  866,  433, 200, 100, 67, 17],
  [750,  934,  467, 215, 108, 72, 18],
  [800, 1001,  501, 231, 116, 77, 19],
  [850, 1069,  534, 247, 123, 82, 21],
  [900, 1136,  568, 262, 131, 87, 22],
  [950, 1204,  602, 278, 139, 93, 23],
  [1000,1272,  636, 293, 147, 98, 24],
];

// Highest tier reached pays; below the first tier pays $0.
export const BONUS_TIERS = [
  { tier:1, points:1400, pay:400 },
  { tier:2, points:1800, pay:800 },
  { tier:3, points:2200, pay:1250 },
  { tier:4, points:2600, pay:1550 },
  { tier:5, points:3200, pay:1850 },
];

// The table row a ticket price lands on: { price, points:[...6 freqs] }.
export function rowFor(price) {
  const p = Math.max(Number(price) || 0, POINTS_TABLE[0][0]);
  const last = POINTS_TABLE[POINTS_TABLE.length - 1], prev = POINTS_TABLE[POINTS_TABLE.length - 2];
  if (p >= last[0]) {
    const steps = Math.floor((p - last[0]) / 50);
    return { price:last[0] + steps * 50, points:last.slice(1).map((v, i) => v + steps * (v - prev[i + 1])) };
  }
  let row = POINTS_TABLE[0];
  for (const r of POINTS_TABLE) if (r[0] <= p) row = r;
  return { price:row[0], points:row.slice(1) };
}

// Points for one closed client. Unknown frequency -> 0.
export function pointsFor(price, freq) {
  const i = FREQUENCIES.indexOf(freq);
  return i < 0 ? 0 : rowFor(price).points[i];
}

// Month total -> { tier, pay, next, toNext }. tier is null below Tier 1;
// next is null at the top tier.
export function tierFor(points) {
  const n = Number(points) || 0;
  let reached = null;
  for (const t of BONUS_TIERS) if (n >= t.points) reached = t;
  const next = BONUS_TIERS.find(t => n < t.points) || null;
  return { tier:reached?.tier ?? null, pay:reached?.pay ?? 0, next, toNext:next ? next.points - n : 0 };
}
