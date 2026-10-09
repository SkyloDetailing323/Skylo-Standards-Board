import { useState, useEffect, useCallback, Fragment } from "react";
import { TEST_QUESTIONS, TESTS, TEST_KEYS, questionsFor, shuffle } from "./trainingTest.js";
import { computeOpsMonth, monthRange, mountainDate, CALLBACK_TIERS, QUOTA_TIERS, RETENTION_TIERS, NON_ROUTE_VEHICLES, OPS_EXCLUDED_TITLES } from "./opsBonus.js";
import { techDriverDays, weeklyDriverScore, findUnassignedDriving, DRIVER_CONFIG } from "./driverScoring.js";
import { buildFordImport } from "./fordReports.js";
import { techWeekCard, techScoreCard, teamSummary, scoreWindow, truckScore, isTruckExempt, TECH_SCORE_CONFIG } from "./techScores.js";
import { LABOR_TARGET_PCT, payrollTaxRate, tipsPaidByMonth, qbLaborMonth } from "./laborCost.js";
import { formKind, scoreToteCheck, scoreTechAudit, latestPerDay, auditDays, weeklyAuditPct, auditWeekStart, toteCharges, submissionPhotoUrls } from "./auditScoring.js";

// ─── SUPABASE CONFIG ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://mjmwxxvqcsptrocwucis.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qbXd4eHZxY3NwdHJvY3d1Y2lzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4Njk2MjAsImV4cCI6MjA5NDQ0NTYyMH0.YLwGKFvrAn3F8viFgP0oZ6hzqSSq7w8FrNT1y3sy_Sc";

// Every techs column the browser is allowed to read. `pin` is deliberately
// left out: PINs are checked server-side (netlify/functions/auth-login.js)
// and the anon role has no SELECT on that column. Add new techs columns here
// AND grant them to anon/authenticated, or they won't load.
const TECH_COLUMNS = "id,name,avatar,badges,start_date,is_lead,team_lead_id,team_name,hourly_rate,commission_rate,is_active,onboarding_stage,assigned_trainer_id,cert_status,cert_attempts,classroom_complete,title,left_date,leave_reason,fire_category,fire_notes,fire_approval,fire_reviewed_at,on_leave,perfect_day_rubric_complete,misc_rubric_complete,onboarding_complete,onboarding_signed_by,onboarding_complete_date";

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      "Prefer": opts.prefer || "return=representation",
      ...opts.headers,
    },
    ...opts,
  });
  if (!res.ok) { const err = await res.text(); throw new Error(err); }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Supabase/PostgREST caps a single request at 1000 rows regardless of any
// `limit` in the query string — tables that grow past that (like `jobs`)
// silently lose their oldest rows unless paginated explicitly.
async function sbAll(path, pageSize = 1000) {
  let all = [];
  let offset = 0;
  while (true) {
    const sep = path.includes("?") ? "&" : "?";
    const page = await sb(`${path}${sep}limit=${pageSize}&offset=${offset}`);
    if (!page || page.length === 0) break;
    all = all.concat(page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
// Apple-style system font (San Francisco on iPhone/Mac).
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", "Segoe UI", Roboto, sans-serif';
const C = {
  brand:   "#0092f9", // Skylo logo blue (skylod.com)
  blue:    "#0092f9",
  blueDk:  "#0077d4",
  blueLt:  "#eaf3ff",
  blueXlt: "#f5f9ff",
  black:   "#1d1d1f",
  dark:    "#f5f5f7",
  card:    "#ffffff",
  cardLt:  "#f5f5f7",
  border:  "#e5e5ea",
  white:   "#ffffff",
  offWhite:"#1d1d1f",
  muted:   "#6e6e73",
  green:   "#34c759",
  // Owner rule (Oct 2026): only Skylo blue and white -- green for good, red
  // for bad. These three used to be gold/orange/purple accents; they're now
  // shades of the brand blue so old call sites pick it up.
  gold:    "#0077d4",
  orange:  "#0092f9",
  purple:  "#005fb0",
  red:     "#ff3b30",
};

const PP_ANCHOR_END = "2026-06-13"; // known bi-weekly period end: pay date Jun 19, submit Jun 17
// Pay moved from every other week to the 10th and 25th (owner's call, Oct
// 2026). Bi-weekly periods end Sep 19; Sep 20-30 is a one-off bridge period
// paid Oct 7; then the 1st-15th is paid on the 25th and the 16th-month end is
// paid on the 10th of the next month.
const PP_SEMI_MONTHLY_FROM = "2026-09-20";
const PP_BRIDGE = { start:"2026-09-20", end:"2026-09-30", submit:"2026-10-07", payout:"2026-10-07" };
const UPSELL_PTS_PER_DOLLAR = 0.5; // $2 = 1 pt
const REVIEW_PTS = 5;
const REVIEW_BONUS_PTS = 20; // bonus at 10+ reviews in a month
const CALLBACK_PTS = -300; // legacy callbacks logged before severity levels existed
// Callback severity -> points deducted on the Journey Map. A split job's
// callback is logged once per tech with weight 1/n, so the deduction splits too.
const CALLBACK_SEVERITY = {
  1: { pts:100, label:"Level 1", desc:"1 small missed spot — easy touch-up, 5–15 min" },
  2: { pts:200, label:"Level 2", desc:"2–3 things missed — 15–45 min" },
  3: { pts:300, label:"Level 3", desc:"4+ spots missed — almost a full reclean, 1–2 hrs" },
};
const CALLBACK_AREAS = [
  { area:"Interior", items:[
    { id:"int_lvp",      label:"LVP", hint:"seats, dash, console, cupholders, door panels" },
    { id:"int_vacuum",   label:"Vacuuming", hint:"crumbs on carpets, trunk, under/between seats, leftover trash" },
    { id:"int_windows",  label:"Windows", hint:"windshield, all windows, rear view mirror, displays, drop-down mirrors" },
    { id:"int_mats",     label:"Floor mats", hint:"dirt, gunk, streaks" },
    { id:"int_upsells",  label:"Interior upsells", hint:"seat shampoo, carpet shampoo, pet hair, deodorization" },
  ]},
  { area:"Exterior", items:[
    { id:"ext_wheels",   label:"Tires, rims & wheel wells", hint:"sloppy tire shine, dirt on rims" },
    { id:"ext_wash",     label:"Exterior wash", hint:"dirt, soap or water marks dripping" },
    { id:"ext_windows",  label:"Exterior windows", hint:"streaks, soap, bugs" },
    { id:"ext_jambs",    label:"Door jambs & running boards", hint:"" },
    { id:"ext_upsells",  label:"Exterior upsells", hint:"wax, clay bar, headlight restoration" },
  ]},
];
const CALLBACK_ITEM_LABEL = Object.fromEntries(CALLBACK_AREAS.flatMap(a=>a.items.map(i=>[i.id, `${a.area}: ${i.label}`])));
function callbackPoints(c) {
  const base = CALLBACK_SEVERITY[c.severity]?.pts ?? Math.abs(CALLBACK_PTS);
  return -Math.round(base * (c.weight==null ? 1 : Number(c.weight)));
}
// The day the missed job was completed (older rows only have created_at).
function callbackDate(c) {
  return c.job_date || (c.created_at ? new Date(c.created_at).toLocaleDateString("en-CA",{timeZone:"America/Denver"}) : null);
}

// ─── QUOTA CONFIG (set by whoever holds Head of Operations) ────────────────────
const DEFAULT_QUOTA = {
  upsells: 175,      // $ per month — mid between $150 floor and $200 avg
  reviews: 6,        // count per month — mid between 5 floor and 7 avg
  switchovers: 2,    // count per month — floor for now, team is still developing
};
// Why a tech left -- recorded when they're archived, drives the retention KPIs.
const LEAVE_REASONS = [
  { value:"fired",       label:"Fired",                                   short:"Fired" },
  { value:"quit_notice", label:"Quit with 2 weeks' notice",               short:"Quit w/ notice" },
  { value:"walked_off",  label:"Left with no notice / walked off",        short:"Walked off" },
];
const FIRE_CATEGORIES = [
  { value:"low_production", label:"Low production" },
  { value:"policy_breach",  label:"Broke the policy manual" },
  { value:"culture",        label:"Hurting the company culture" },
];

// Skylo logo (traced from the skylod.com logo), drawn in any color.
const LOGO_VIEWBOX = "0 0 1617 699";
const LOGO_PATH = "M812.7 685.1C827.2 682.4 831.3 681.3 838.7 677.7L847.5 673.5L1176.0 673.0C1476.2 672.5 1505.0 672.3 1510.0 670.8C1521.4 667.4 1538.7 660.8 1543.0 658.1C1545.5 656.6 1549.7 654.1 1552.3 652.6C1577.3 638.4 1600.8 604.1 1606.1 574.0C1607.8 564.2 1607.8 539.5 1606.1 530.0C1600.8 500.3 1579.4 467.8 1555.5 453.2C1544.6 446.4 1540.8 441.8 1536.1 429.5C1533.8 423.4 1530.3 415.0 1528.3 410.7C1523.9 400.9 1524.3 398.2 1530.8 390.2C1543.1 375.5 1555.9 355.5 1560.6 344.0C1562.0 340.4 1564.2 335.5 1565.5 333.0C1568.5 327.1 1576.7 294.4 1578.0 283.3C1581.7 250.7 1575.5 209.2 1563.0 183.5C1545.1 146.7 1514.6 120.6 1475.9 109.1C1458.2 103.8 1451.3 102.7 1434.0 102.7C1369.9 102.7 1305.7 140.5 1272.8 197.5C1264.4 212.0 1260.8 220.2 1254.4 239.7C1248.5 257.7 1247.0 268.6 1247.0 294.9L1247.0 307.4L1242.2 311.9C1239.6 314.4 1234.0 318.4 1229.8 320.7C1222.1 324.9 1210.8 332.7 1203.6 338.7C1199.6 342.1 1194.8 343.1 1193.4 340.8C1191.1 337.0 1192.7 331.4 1200.0 318.6C1209.2 302.6 1208.5 309.0 1209.9 222.5C1211.3 136.9 1212.3 107.9 1215.6 60.9C1218.4 20.2 1218.3 16.2 1214.5 12.4C1211.6 9.5 1208.2 9.4 1195.8 11.5C1191.0 12.4 1176.6 14.6 1163.8 16.5C1151.0 18.4 1136.5 20.6 1131.5 21.5C1126.5 22.3 1121.1 23.3 1119.3 23.6C1110.5 25.0 1108.5 30.0 1107.0 55.0C1106.5 64.1 1105.1 83.7 1104.0 98.5C1101.8 127.3 1100.1 192.5 1100.0 251.0C1100.0 284.8 1098.6 315.2 1095.5 354.0C1092.6 389.8 1092.1 397.4 1091.4 415.0C1090.7 435.3 1090.1 438.4 1085.1 446.4C1081.5 452.3 1081.5 452.5 1081.1 464.7C1080.7 479.8 1081.7 484.1 1087.8 494.3C1096.9 509.5 1104.3 508.9 1109.1 492.6C1116.5 467.3 1149.1 448.2 1174.2 454.5C1186.7 457.6 1189.2 455.7 1191.5 441.5C1192.4 436.2 1194.1 430.4 1195.6 427.5C1197.0 424.8 1199.2 419.7 1200.5 416.4C1204.7 405.4 1217.9 387.5 1230.5 375.9C1259.8 348.8 1303.5 338.1 1342.5 348.3C1378.4 357.7 1406.9 380.5 1421.6 411.6C1427.1 423.0 1430.9 424.3 1442.8 418.4C1468.7 405.6 1499.1 430.9 1493.5 460.7C1490.9 474.4 1491.6 475.1 1510.5 481.0C1531.5 487.4 1554.1 510.5 1559.7 531.2C1562.1 540.1 1562.1 564.0 1559.7 573.0C1555.0 590.3 1538.2 610.1 1520.8 618.8C1507.3 625.5 1504.2 626.0 1469.5 627.1C1398.3 629.2 1209.4 633.3 1101.5 635.0C1068.0 635.5 1008.7 636.7 969.8 637.6C902.5 639.2 899.0 639.2 896.4 637.6C892.2 634.8 893.3 628.5 899.8 618.4C905.3 609.9 919.6 581.0 923.6 570.2C924.9 566.7 927.3 561.3 928.9 558.2C930.4 555.1 932.7 549.4 934.0 545.7C935.2 542.0 937.2 537.0 938.5 534.7C939.8 532.4 941.6 527.8 942.5 524.5C943.5 521.2 945.5 516.0 947.0 513.0C948.5 510.0 950.7 504.4 951.9 500.6C953.1 496.8 955.2 491.6 956.5 489.0C957.8 486.5 959.6 481.7 960.5 478.5C961.4 475.2 963.5 470.2 965.1 467.3C966.7 464.4 968.9 458.8 969.9 454.7C971.0 450.7 973.5 444.8 975.4 441.6C977.3 438.4 979.4 433.2 980.0 430.1C980.7 427.0 982.9 421.4 985.0 417.5C987.0 413.6 989.3 408.0 990.0 405.0C990.7 402.0 992.8 396.5 994.6 392.9C996.4 389.3 998.6 383.7 999.5 380.4C1000.5 377.2 1002.5 372.0 1004.0 368.9C1005.6 365.9 1007.6 360.7 1008.5 357.4C1009.5 354.2 1011.5 349.0 1013.0 346.0C1014.5 343.0 1016.7 337.1 1017.9 333.0C1019.2 328.9 1021.0 324.1 1022.0 322.5C1023.0 320.9 1024.8 316.1 1026.1 312.0C1027.3 307.9 1029.4 302.0 1030.8 299.0C1032.1 296.0 1034.7 289.4 1036.5 284.5C1038.3 279.6 1041.6 270.6 1044.0 264.5C1046.3 258.4 1050.1 248.3 1052.4 242.0C1054.8 235.7 1057.4 229.2 1058.2 227.5C1059.1 225.8 1060.7 221.5 1061.8 217.8C1063.0 214.2 1065.2 208.6 1066.8 205.3C1068.4 202.1 1070.3 197.2 1070.9 194.5C1071.6 191.8 1073.5 186.4 1075.2 182.6C1080.7 170.1 1077.4 166.9 1062.4 169.9C1056.9 171.0 1047.5 172.4 1041.5 173.0C1035.5 173.7 1021.5 175.9 1010.5 178.0C999.5 180.1 987.6 182.1 984.0 182.5C971.9 183.7 966.7 184.9 964.2 187.3C960.1 191.1 953.1 206.3 951.5 214.9C950.6 219.3 948.6 225.8 947.0 229.4C945.3 233.1 943.3 239.2 942.5 243.1C941.7 246.9 939.7 253.2 938.1 256.9C936.5 260.7 934.5 267.2 933.6 271.3C932.8 275.5 930.7 281.9 929.0 285.6C927.3 289.3 925.5 295.5 924.9 299.4C924.3 303.3 922.3 309.7 920.5 313.5C918.7 317.4 916.5 324.0 915.6 328.3C914.7 332.6 912.7 339.1 911.1 342.8C909.5 346.5 907.6 352.4 907.0 356.0C903.5 375.9 893.0 379.0 888.4 361.5C887.5 358.3 885.6 353.1 884.0 350.1C882.5 347.0 880.5 341.0 879.6 336.7C878.7 332.0 876.6 326.3 874.5 322.6C872.1 318.2 870.7 314.2 870.0 309.0C869.2 303.2 868.0 300.0 865.0 295.0C862.2 290.4 860.8 286.5 860.0 281.7C859.4 277.6 857.5 271.9 855.4 267.9C853.5 264.0 851.2 257.7 850.3 253.7C849.4 249.7 847.4 243.9 845.9 240.8C844.3 237.6 842.1 231.4 841.1 226.9C838.0 213.5 832.6 208.5 822.5 209.3C812.3 210.1 786.7 213.8 769.2 217.0C760.0 218.6 747.2 220.7 740.6 221.5C718.3 224.4 715.6 229.6 725.6 250.1C728.0 255.1 730.0 259.8 730.0 260.5C730.0 261.3 731.9 265.7 734.3 270.2C736.7 274.8 739.2 280.8 739.9 283.5C740.6 286.2 742.7 290.8 744.6 293.6C746.5 296.4 748.8 301.3 749.6 304.6C750.4 307.8 752.6 313.0 754.4 316.0C756.2 319.0 758.5 324.0 759.5 327.0C760.4 330.0 762.9 336.1 765.1 340.5C767.2 344.9 770.1 351.2 771.4 354.5C772.7 357.8 775.9 365.4 778.5 371.5C781.1 377.6 784.7 386.1 786.4 390.5C788.2 394.9 790.8 400.8 792.2 403.5C793.6 406.3 795.3 410.6 796.0 413.0C796.6 415.5 798.5 419.8 800.1 422.6C801.7 425.4 803.9 430.8 805.1 434.6C806.2 438.4 808.0 442.9 809.0 444.5C810.0 446.1 812.6 452.0 814.8 457.5C817.0 463.0 820.9 472.4 823.5 478.5C826.1 484.6 829.5 492.7 831.0 496.7C832.6 500.6 835.4 506.7 837.2 510.2C840.4 516.3 840.5 516.9 840.5 528.0C840.5 539.2 840.4 539.7 837.2 545.2C835.4 548.3 832.8 554.2 831.4 558.2C821.0 588.8 795.1 602.3 765.1 592.5C750.1 587.7 744.6 591.1 739.9 608.2C738.8 612.0 736.6 617.7 735.1 620.9C733.5 624.0 731.4 629.2 730.5 632.3C729.5 636.0 727.9 638.8 726.0 640.4C722.4 643.4 719.4 643.5 626.5 645.0C564.3 646.0 472.1 648.1 420.3 649.8C394.0 650.7 392.8 651.0 390.1 658.7C388.9 662.1 388.9 663.3 390.0 665.9C392.9 673.0 378.7 672.4 557.0 673.0L717.6 673.5L725.6 677.6C749.2 689.9 774.6 692.0 812.7 685.1ZM165.0 648.0C227.5 643.9 275.3 628.9 310.5 602.1C327.2 589.5 345.2 568.1 351.7 553.2C353.0 550.1 355.2 545.5 356.4 543.0C359.9 536.1 360.7 532.9 363.5 514.1C366.8 490.9 366.6 484.4 361.0 449.7C359.0 437.1 345.7 412.4 333.3 398.4C314.6 377.3 280.7 360.2 237.0 350.0C180.6 336.8 160.7 327.6 151.9 311.0C148.5 304.6 148.5 290.8 151.9 283.2C157.2 271.3 174.7 260.1 194.5 256.1C227.6 249.4 259.8 254.6 284.9 270.7C294.8 277.0 300.0 276.9 306.2 270.3C309.4 267.0 346.4 218.9 351.8 211.2C357.3 203.1 357.0 199.1 350.3 193.1C339.5 183.4 312.9 169.7 296.0 165.0C253.6 153.3 217.0 151.7 178.0 160.0C170.6 161.6 161.8 163.4 158.5 164.0C155.2 164.7 148.0 166.9 142.5 169.0C137.0 171.0 130.7 173.3 128.5 174.0C122.9 175.8 104.9 185.4 96.0 191.4C59.0 216.0 36.0 247.0 29.0 281.9C24.0 306.6 24.1 316.0 29.5 344.0C35.1 372.6 52.1 396.8 79.0 414.4C90.1 421.7 107.8 431.2 113.5 433.0C115.7 433.7 121.2 435.8 125.8 437.6C130.3 439.5 138.2 441.9 143.3 443.1C148.3 444.2 156.1 446.2 160.5 447.5C164.9 448.8 172.6 450.8 177.6 451.9C189.3 454.4 210.8 462.9 217.1 467.5C229.6 476.8 234.6 487.2 233.8 502.3C232.7 521.3 220.1 532.7 191.2 540.6C183.6 542.7 152.3 543.6 141.2 542.1C124.7 539.9 95.4 528.9 76.0 517.6C64.5 511.0 64.9 510.6 27.5 570.4C8.4 601.1 7.4 603.7 12.5 609.9C20.6 619.4 53.0 634.0 82.5 641.4C92.5 643.9 126.6 647.8 148.0 648.8C149.4 648.9 157.0 648.5 165.0 648.0ZM415.0 600.5C421.3 599.6 434.1 597.5 443.5 596.0C452.9 594.4 465.9 592.4 472.5 591.5C487.5 589.5 491.3 588.4 494.4 585.1C498.6 580.6 499.0 576.7 499.6 534.0C499.9 511.6 500.6 491.3 501.2 488.7C502.9 480.8 520.0 459.0 524.4 459.0C528.6 459.0 531.5 463.3 558.5 510.0C565.0 521.3 572.6 534.3 575.4 539.0C578.1 543.7 581.5 549.8 582.8 552.5C586.5 560.2 592.8 568.0 596.6 569.6C601.5 571.6 605.9 571.4 622.6 568.0C630.8 566.3 644.9 564.1 654.0 562.9C673.2 560.6 693.8 556.6 699.7 554.0C708.0 550.4 707.8 547.0 698.3 532.5C694.7 527.0 686.3 513.3 679.6 502.0C662.3 473.0 658.2 466.2 654.5 460.5C652.7 457.8 650.0 453.2 648.6 450.5C647.1 447.8 644.4 443.4 642.7 440.8C640.9 438.2 637.7 433.1 635.5 429.4C633.3 425.7 628.8 418.5 625.5 413.4C622.2 408.4 618.3 402.0 616.8 399.4C615.2 396.7 611.5 390.5 608.5 385.5C600.0 371.5 600.2 367.2 610.3 354.9C613.2 351.4 619.5 343.3 624.3 337.0C629.1 330.7 635.7 322.4 639.0 318.5C642.2 314.6 648.6 306.4 653.2 300.2C661.4 288.9 683.3 260.4 693.1 248.2C699.8 239.7 700.9 236.7 698.3 233.2C694.9 228.7 691.7 228.8 650.5 235.5C639.0 237.3 621.6 240.0 612.0 241.5C585.4 245.4 585.6 245.3 563.7 274.9C557.0 283.9 546.8 297.4 540.9 304.9C535.1 312.4 528.1 322.0 525.2 326.1C517.0 338.0 512.4 341.4 508.4 338.6C506.1 336.9 506.0 334.0 507.8 299.5C509.9 259.1 511.1 129.1 509.5 125.9C507.0 121.2 503.6 120.6 491.9 122.9C486.2 124.1 473.6 126.1 464.0 127.5C434.8 131.7 412.5 135.7 409.5 137.1C401.3 141.1 401.3 141.4 400.1 229.0C399.1 300.0 397.8 341.5 396.0 365.5C391.3 427.1 391.1 431.7 389.9 515.2C388.9 589.9 388.9 593.1 390.7 596.7C392.8 601.2 396.3 603.2 400.5 602.6C402.1 602.3 408.7 601.4 415.0 600.5ZM1428.4 343.1C1426.2 342.1 1422.8 339.9 1420.9 338.3C1410.7 329.5 1391.9 317.8 1380.1 313.0C1350.3 300.8 1350.0 300.5 1350.0 285.2C1350.0 272.3 1351.0 267.4 1356.5 253.4C1366.5 227.7 1385.7 209.6 1407.8 204.9C1418.3 202.7 1432.7 204.0 1440.4 208.0C1451.5 213.6 1460.5 222.8 1466.4 234.6C1469.9 241.6 1474.0 262.1 1474.0 272.6C1474.0 281.8 1470.3 301.2 1467.1 308.5C1461.5 321.2 1446.4 339.5 1438.5 343.1C1433.6 345.4 1433.4 345.4 1428.4 343.1Z";

// ─── BADGE DEFS ───────────────────────────────────────────────────────────────
// Rotating trophies: passed to current leader each month, no points
const ROTATING_TROPHIES = [
  { id:"audit_legend",    name:"Audit Legend",     icon:"📋", desc:"100% on audits for the month — passed to the current holder" },
  { id:"upsell_king",     name:"Upsell King",      icon:"👑", desc:"Highest upsells for the month — passed to the current holder" },
  { id:"review_champ",   name:"Review Champion",  icon:"⭐", desc:"Most reviews in the month — passed to the current holder" },
];

// Permanent point badges
// Scale reference: ~800 pts = solid month of work (upsells + reviews + switchovers)
const BADGE_DEFS = [
  // Tenure (show up, stay loyal — meaningful but modest)
  { id:"three_month",    cat:"Tenure",      name:"3-Month Mark",       icon:"📅", pts:40,   desc:"3 months on the team" },
  { id:"six_month",      cat:"Tenure",      name:"Half Year Hustle",   icon:"📆", pts:80,   desc:"6 months of consistency" },
  { id:"one_year",       cat:"Tenure",      name:"One Year Strong",    icon:"🏅", pts:150,  desc:"First full year with Skylo" },
  { id:"two_year",       cat:"Tenure",      name:"Two Year Vet",       icon:"🎖️", pts:225,  desc:"Two years of excellence" },
  { id:"three_year",     cat:"Tenure",      name:"Three Year Elite",   icon:"💎", pts:325,  desc:"Three years — rare commitment" },
  { id:"five_year",      cat:"Tenure",      name:"Five Year Legend",   icon:"👑", pts:500,  desc:"Five years — one of the best" },

  // Revenue (directly tied to company revenue — high value)
  { id:"rev_10k",        cat:"Revenue",     name:"$10K Serviced",      icon:"💵", pts:200,  desc:"First $10,000 in serviced revenue" },
  { id:"rev_25k",        cat:"Revenue",     name:"$25K Serviced",      icon:"💰", pts:400,  desc:"$25,000 in lifetime serviced revenue" },
  { id:"rev_50k",        cat:"Revenue",     name:"$50K Milestone",     icon:"🤑", pts:700,  desc:"$50,000 serviced — elite territory" },
  { id:"rev_100k",       cat:"Revenue",     name:"$100K Club",         icon:"🏦", pts:1200, desc:"$100,000 serviced — hall of fame" },

  // Clean Streaks (quality = retention = revenue)
  { id:"streak_1mo",     cat:"Clean Streak","name":"1-Month Clean",    icon:"✅", pts:150,  desc:"One full month with zero callbacks" },
  { id:"streak_2mo",     cat:"Clean Streak","name":"2-Month Clean",    icon:"🔵", pts:250,  desc:"Two months straight, no callbacks" },
  { id:"streak_3mo",     cat:"Clean Streak","name":"3-Month Clean",    icon:"🔥", pts:375,  desc:"Three months with zero callbacks" },
  { id:"streak_6mo",     cat:"Clean Streak","name":"6-Month Streak",   icon:"⚡", pts:600,  desc:"Six months clean — top tier quality" },
  { id:"streak_1yr",     cat:"Clean Streak","name":"Year of Zero",     icon:"🌟", pts:900,  desc:"A full year with zero callbacks" },

  // Shift Coverage (team first mentality)
  { id:"shift_cover",    cat:"Character",   name:"Shift Hero",         icon:"🫂", pts:175,  desc:"Covered 4+ extra shifts in a month outside normal schedule" },

  // The Prestige Badge
  { id:"perfect_detail", cat:"Prestige",    name:"The Perfect Detail", icon:"💎", pts:1000, desc:"On time every appt, 100% audit, zero callbacks, 1 review/day for a full week, all HCP pics + flyers + satisfaction cards attached" },

  // Performance
  { id:"switchover_5",   cat:"Performance", name:"Converter",          icon:"🔄", pts:150,  desc:"Converted 5 customers to service plans" },
  { id:"switchover_20",  cat:"Performance", name:"Subscription King",  icon:"📈", pts:400,  desc:"Converted 20 customers to service plans" },
  { id:"early_bird",     cat:"Character",   name:"Early Bird",         icon:"⏰", pts:100,  desc:"On time or early to every job for a full month" },
  { id:"customer_whisperer", cat:"Performance", name:"Customer Whisperer", icon:"🤝", pts:250, desc:"3 months straight of 5-star reviews with no gaps" },
];
const ALL_BADGE_DEFS = [...BADGE_DEFS, ...ROTATING_TROPHIES.map(t=>({...t,cat:"Trophy",pts:0}))];
const BADGE_MAP = Object.fromEntries(ALL_BADGE_DEFS.map(b => [b.id, b]));


const SERVICE_PLANS = [
  { id:"biannual",  label:"Bi-Annual",  freq:"2x/yr",   pts:15,  ltv:635  },
  { id:"quarterly", label:"Quarterly",  freq:"4x/yr",   pts:30,  ltv:1030 },
  { id:"bimonthly", label:"Bi-Monthly", freq:"6x/yr",   pts:50,  ltv:1425 },
  { id:"monthly",   label:"Monthly",    freq:"12x/yr",  pts:65,  ltv:2610 },
  { id:"biweekly",  label:"Bi-Weekly",  freq:"26x/yr",  pts:90,  ltv:3900 },
  { id:"weekly",    label:"Weekly",     freq:"52x/yr",  pts:120, ltv:5850 },
];
const PLAN_MAP = Object.fromEntries(SERVICE_PLANS.map(p => [p.id, p]));
const PLAN_COLORS = { biannual:C.blue, quarterly:C.blue, bimonthly:C.blue, monthly:C.blue, biweekly:C.blue, weekly:C.blue };

const JOURNEY_TIERS = [
  { id:"bronze",   name:"BRONZE",   icon:"🥉", minPts:0,    maxPts:2499,   color:"#cd7f32", bg:"#1a1000", reward:"Tier 1 — $150",   perks:["$150 Skylo Cash","Badge tracking","Weekly upsells"] },
  { id:"silver",   name:"SILVER",   icon:"🥈", minPts:2500, maxPts:4499,   color:"#a8c0d6", bg:"#0e1520", reward:"Tier 2 — $300",   perks:["$300 Skylo Cash","Switchover bonuses","Monthly spotlight"] },
  { id:"gold",     name:"GOLD",     icon:"🥇", minPts:4500, maxPts:5999,   color:"#ffd600", bg:"#1a1400", reward:"Tier 3 — $600",   perks:["$600 Skylo Cash","Featured on board","Priority scheduling"] },
  { id:"platinum", name:"PLATINUM", icon:"💎", minPts:6000, maxPts:Infinity,color:"#c4b5fd", bg:"#0d0520", reward:"Tier 4 — $1,200", perks:["$1,200 Skylo Cash","Legend nomination","Annual award"] },
];
function getTier(pts) { return [...JOURNEY_TIERS].reverse().find(t => pts >= t.minPts) || JOURNEY_TIERS[0]; }

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const calcBadgePts = (badges) => (badges||[]).reduce((s,id) => s+(BADGE_MAP[id]?.pts||0), 0);
const medal = (i) => i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`;

function getWeekKey() {
  // Week runs Sun–Sat (same as HCP's reports), resets Sunday 12:00am MT
  const mtOffset = 6 * 60 * 60 * 1000;
  const mt = new Date(Date.now() - mtOffset);
  const day = mt.getDay(); // 0=Sun,1=Mon,2=Tue...6=Sat
  // Days since last Sunday
  const daysBack = day;
  const monday = new Date(mt);
  monday.setDate(mt.getDate() - daysBack);
  const y = monday.getFullYear();
  const m = String(monday.getMonth()+1).padStart(2,"0");
  const d = String(monday.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
// Snaps an arbitrary YYYY-MM-DD date to that week's Sunday (same Sun-Sat
// convention as getWeekKey, just for a picked date instead of "now").
function dateToWeekKey(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay();
  const back = day;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().split("T")[0];
}
// Sunday that starts the current reporting week (Sun–Sat, Mountain Time) --
// matches HCP's weekly reports. Used by the WTD / Last Week date presets.
function getSundayWeekStart() {
  const mt = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const sun = new Date(mt);
  sun.setDate(mt.getDate() - mt.getDay());
  return `${sun.getFullYear()}-${String(sun.getMonth()+1).padStart(2,"0")}-${String(sun.getDate()).padStart(2,"0")}`;
}
function getMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
}
// Real upsell $ for a tech (or team-wide if techId is falsy) over a job_date
// range -- the same day-exact method ReportsTab uses (jobs.upsell_amount by
// job_date), so quota/gamification views agree with Reports/personal logins
// instead of the separate upsells table, whose week_key (a week's Sunday)
// month-prefix bucketing misattributes any week spanning a month boundary.
function upsellAmountInRange(jobs, techId, start, end) {
  return (jobs||[]).filter(j => (!techId || j.tech_id===techId) && j.job_date && j.job_date>=start && j.job_date<=end).reduce((s,j)=>s+(j.upsell_amount||0),0);
}
function monthBounds(year, month) {
  const y = Number(year), m = Number(month);
  const start = `${y}-${String(m).padStart(2,"0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${y}-${String(m).padStart(2,"0")}-${String(lastDay).padStart(2,"0")}`;
  return { start, end };
}
function weekEndDate(wk) {
  const d = new Date(wk+"T12:00:00Z"); d.setUTCDate(d.getUTCDate()+6);
  return d.toISOString().split("T")[0];
}
function formatWeekLabel(key) {
  const d = new Date(key+"T00:00:00"), end = new Date(d);
  end.setDate(d.getDate()+6);
  const fmt = dt => dt.toLocaleDateString("en-US",{month:"short",day:"numeric"});
  return `${fmt(d)} – ${fmt(end)}`;
}
function formatMonthLabel(key) {
  const [y,m] = key.split("-");
  return new Date(y,m-1).toLocaleDateString("en-US",{month:"long",year:"numeric"});
}
function fmtShortDate(str) {
  return new Date(str+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"});
}
function formatLastEntered(isoTimestamp) {
  if (!isoTimestamp) return null;
  return new Date(isoTimestamp).toLocaleString("en-US", { month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit" });
}
function mostRecentTimestamp(rows) {
  if (!rows || rows.length === 0) return null;
  return rows.reduce((latest, r) => (!latest || (r.created_at||"") > latest) ? (r.created_at||latest) : latest, null);
}
function getPayPeriods() {
  const anchor = new Date(PP_ANCHOR_END+"T12:00:00");
  const todayMs = Date.now()-6*60*60*1000;
  // Forward bound is relative to today (not a fixed offset from the anchor) so
  // periods keep generating indefinitely instead of silently stopping once
  // real time passes anchor + a hardcoded number of periods.
  const periodsAheadOfToday = Math.ceil((todayMs-anchor.getTime())/(14*24*60*60*1000)) + 4;
  const periods = [];
  for (let i=-52; i<=periodsAheadOfToday; i++) {
    const end = new Date(anchor); end.setDate(anchor.getDate()+i*14);
    const start = new Date(end);  start.setDate(end.getDate()-13);
    const submit= new Date(end);  submit.setDate(end.getDate()+4);
    const payout= new Date(end);  payout.setDate(end.getDate()+6);
    const fmt = d=>d.toISOString().split("T")[0];
    if (fmt(end) >= PP_SEMI_MONTHLY_FROM) break;
    periods.push({ key:fmt(end), start:fmt(start), end:fmt(end), submit:fmt(submit), payout:fmt(payout) });
  }
  periods.push({ key:PP_BRIDGE.end, ...PP_BRIDGE });
  // Semi-monthly from October 2026 through two months past today. Submit By
  // is two days before the pay date.
  const ymd = (y,m,d) => new Date(Date.UTC(y,m,d,12)).toISOString().split("T")[0];
  const minus2 = s => { const d = new Date(s+"T12:00:00Z"); d.setUTCDate(d.getUTCDate()-2); return d.toISOString().split("T")[0]; };
  const today = new Date(todayMs);
  const lastMonth = today.getUTCFullYear()*12 + today.getUTCMonth() + 2;
  for (let mi = 2026*12+9; mi <= lastMonth; mi++) {
    const y = Math.floor(mi/12), m = mi%12;
    const first = { start:ymd(y,m,1), end:ymd(y,m,15), payout:ymd(y,m,25) };
    const second = { start:ymd(y,m,16), end:ymd(y,m+1,0), payout:ymd(y,m+1,10) };
    for (const p of [first, second]) periods.push({ key:p.end, ...p, submit:minus2(p.payout) });
  }
  return periods.sort((a,b)=>b.key.localeCompare(a.key));
}
function currentPayPeriod() {
  const today = new Date(Date.now()-6*60*60*1000).toISOString().split("T")[0];
  return getPayPeriods().find(p=>today>=p.start&&today<=p.end) || null;
}
function currentPPKey() {
  return currentPayPeriod()?.key || PP_ANCHOR_END;
}
function formatTenure(startDate) {
  if (!startDate) return null;
  const days = Math.floor((new Date()-new Date(startDate))/(1000*60*60*24));
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days/30)}mo`;
  const yrs = Math.floor(days/365), mos = Math.floor((days%365)/30);
  return mos > 0 ? `${yrs}yr ${mos}mo` : `${yrs}yr`;
}

// ─── TIME TRACKING HELPERS ────────────────────────────────────────────────────
// Fixed -6h convention, matching every other UTC->MT conversion in this app
// (toMTDateStr in the sync/repair functions) -- not DST-aware, intentionally
// consistent with the rest of the codebase rather than more "correct."
function mtDateStr(ms) {
  return new Date(ms - 6*60*60*1000).toISOString().split("T")[0];
}
// End-of-day boundary (next MT midnight) for a given MT calendar date, as a
// UTC ISO timestamp -- MT midnight = UTC 06:00 under the fixed -6h offset.
function mtDayEndUTC(workDate) {
  const d = new Date(workDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(6, 0, 0, 0);
  return d.toISOString();
}
// Hours for one session. An open session (no clock_out) on a past work_date
// is capped at that day's midnight instead of growing unbounded; an open
// session on today is "elapsed so far" -- which IS the live running total,
// no separate code path needed. nowMs defaults to Date.now() but call sites
// that tick a live display pass a fresh value each render.
function sessionHours(entry, nowMs = Date.now()) {
  const inMs = new Date(entry.clock_in).getTime();
  let outMs;
  if (entry.clock_out) {
    outMs = new Date(entry.clock_out).getTime();
  } else if (entry.work_date < mtDateStr(nowMs)) {
    outMs = new Date(mtDayEndUTC(entry.work_date)).getTime();
  } else {
    outMs = nowMs;
  }
  return Math.max(0, (outMs - inMs) / 3600000);
}
// PAID hours of a session: Wednesday team meetings (8-11 AM Mountain) aren't
// paid, so on a Wednesday anything clocked before 11:00 AM MT doesn't count.
// Used for pay (Payroll training hours); the Time Sheet still shows the
// actual clock times.
const UNPAID_MEETING = { weekday:3, untilHHMM:"11:00" };
function paidSessionHours(entry, nowMs = Date.now()) {
  if (new Date(entry.work_date+"T12:00:00Z").getUTCDay() !== UNPAID_MEETING.weekday) return sessionHours(entry, nowMs);
  const cutoff = mtTimeToIso(entry.work_date, UNPAID_MEETING.untilHHMM);
  return sessionHours(entry.clock_in < cutoff ? { ...entry, clock_in:cutoff } : entry, nowMs);
}
function dayHoursTotal(entries, techId, workDate, nowMs = Date.now()) {
  return entries.filter(e => e.tech_id === techId && e.work_date === workDate).reduce((s,e) => s + sessionHours(e, nowMs), 0);
}
function rangeHoursTotal(entries, techId, start, end, nowMs = Date.now()) {
  return entries.filter(e => e.tech_id === techId && e.work_date >= start && e.work_date <= end).reduce((s,e) => s + sessionHours(e, nowMs), 0);
}
// tip_entries totals -- manual entry only, day-exact (unlike the old
// jobs.tips column this replaces, which was week_key/job_date-derived).
function tipsRangeTotal(tipEntries, techId, start, end) {
  return tipEntries.filter(t => t.tech_id === techId && t.work_date >= start && t.work_date <= end).reduce((s,t) => s+(t.amount||0), 0);
}
function tipsDayTotal(tipEntries, techId, workDate) {
  return tipEntries.filter(t => t.tech_id === techId && t.work_date === workDate).reduce((s,t) => s+(t.amount||0), 0);
}
function formatMTTime(iso) {
  const d = new Date(new Date(iso).getTime() - 6*60*60*1000);
  let h = d.getUTCHours(); const m = String(d.getUTCMinutes()).padStart(2,"0");
  const ampm = h>=12 ? "PM" : "AM"; h = h%12; if (h===0) h=12;
  return `${h}:${m} ${ampm}`;
}
// HH:MM (24h, MT) -> UTC ISO timestamp on the given MT calendar date.
function mtTimeToIso(dateStr, hhmm) {
  const [h,m] = hhmm.split(":").map(Number);
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCHours(h + 6, m, 0, 0);
  return d.toISOString();
}
// UTC ISO timestamp -> "HH:MM" (24h, MT) for pre-filling a <input type="time">.
function isoToMtTimeInput(iso) {
  const d = new Date(new Date(iso).getTime() - 6*60*60*1000);
  return `${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`;
}

// ─── DATE RANGE HELPER ────────────────────────────────────────────────────────
function getDateRangeBounds(preset, customStart="", customEnd="") {
  const now = new Date();
  const pad = n => String(n).padStart(2,"0");
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const today = fmt(now);
  if (preset==="today")     return { start:today, end:today };
  if (preset==="yesterday") { const y = new Date(now); y.setDate(now.getDate()-1); const ys = fmt(y); return { start:ys, end:ys }; }
  if (preset==="custom") return { start:customStart||today, end:customEnd||today };
  if (preset==="wtd")    return { start:getSundayWeekStart(), end:today };
  if (preset==="last_week") {
    const wkDate = new Date(getSundayWeekStart()+"T00:00:00");
    const s = new Date(wkDate); s.setDate(wkDate.getDate()-7);
    const e = new Date(s); e.setDate(s.getDate()+6);
    return { start:fmt(s), end:fmt(e) };
  }
  if (preset==="mtd") {
    const [y,m] = getMonthKey().split("-");
    return { start:`${y}-${m}-01`, end:today };
  }
  if (preset==="last_month") {
    const s = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const e = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start:fmt(s), end:fmt(e) };
  }
  if (preset==="ytd") return { start:`${now.getFullYear()}-01-01`, end:today };
  return { start:today, end:today };
}

// ─── SHARED DATE RANGE PICKER ─────────────────────────────────────────────────
// Single implementation for every tab that offers a date-range filter (Reports,
// Upsells, Switchovers, Reviews — admin and tech-facing). Previously each tab
// had its own copy-pasted preset row with small styling drift between them;
// this is the one place to change if a preset is ever added/renamed.
const DATE_RANGE_PRESETS = [["today","Today"],["yesterday","Yesterday"],["wtd","WTD"],["last_week","Last Week"],["mtd","MTD"],["last_month","Last Month"],["ytd","YTD"],["custom","Custom"]];
function DateRangePicker({ label="📊 Time Period", color=C.blue, preset, setPreset, customStart, setCustomStart, customEnd, setCustomEnd, children }) {
  color = C.blue; // one accent everywhere (owner: blue and white)
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"14px 16px" }}>
      <Label color={color}>{label}</Label>
      <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
        {DATE_RANGE_PRESETS.map(([id,lbl])=>(
          <button key={id} onClick={()=>setPreset(id)} style={{ background:preset===id?color:C.cardLt, border:`1px solid ${preset===id?color:C.border}`, color:preset===id?C.white:C.muted, padding:"6px 14px", borderRadius:"8px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"11px", letterSpacing:"-0.01em" }}>{lbl}</button>
        ))}
      </div>
      {preset==="custom"&&(
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px", marginTop:"12px" }}>
          {[["From",customStart,setCustomStart],["To",customEnd,setCustomEnd]].map(([lbl,val,set])=>(
            <div key={lbl}>
              <div style={{ fontSize:"11px", color:C.muted, marginBottom:"4px" }}>{lbl}</div>
              <input type="date" value={val} onChange={e=>set(e.target.value)} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"8px", borderRadius:"10px", fontSize:"13px", fontFamily:FONT, width:"100%", boxSizing:"border-box" }}/>
            </div>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

// ─── PAGE TOOLS + RANK ROWS ──────────────────────────────────────────────────
// Top-right buttons for a tab's less-used actions (Repair from HCP, Log ...).
// Tapping one drops its panel open under the bar; tapping again closes it.
// tools: [{ id, label, icon, primary, render: () => JSX }]
function PageTools({ tools, left }) {
  const [openId, setOpenId] = useState(null);
  const open = tools.find(t=>t.id===openId);
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"8px", flexWrap:"wrap" }}>
        <div style={{ minWidth:0 }}>{left}</div>
        <div style={{ display:"flex", gap:"8px", marginLeft:"auto", flexWrap:"wrap", justifyContent:"flex-end" }}>
          {tools.map(t=>{
            const on = t.id===openId;
            return (
              <button key={t.id} onClick={()=>setOpenId(on?null:t.id)} aria-expanded={on} style={{ display:"flex", alignItems:"center", gap:"6px", background:t.primary||on?C.blue:C.white, color:t.primary||on?"#fff":C.blue, border:`1px solid ${t.primary||on?C.blue:C.border}`, padding:"8px 14px", borderRadius:"980px", cursor:"pointer", fontFamily:FONT, fontWeight:"600", fontSize:"14px", whiteSpace:"nowrap" }}>
                {t.icon&&<span>{t.icon}</span>}{t.label}<span style={{ fontSize:"10px", transform:on?"rotate(180deg)":"none", transition:"transform .2s" }}>▾</span>
              </button>
            );
          })}
        </div>
      </div>
      {open&&<div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px", boxShadow:"0 8px 30px rgba(0,0,0,0.08)" }}>{open.render(()=>setOpenId(null))}</div>}
    </div>
  );
}

// Leaderboard as rounded "bubble" rows (rank, initials, name, total + chip).
// rows: [{ id, name, value, chip?, sub?, bad? }] already sorted best-first;
// bad: true shows the chip in red (e.g. callback deductions).
function RankRows({ rows, currentId, empty="Nothing logged in this range." }) {
  if (!rows.length) return <div style={{ background:C.card, borderRadius:"16px", padding:"20px", textAlign:"center", color:C.muted, fontSize:"14px" }}>{empty}</div>;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
      {rows.map((r,i)=>{
        const me = r.id===currentId;
        const initials = (r.name||"?").split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();
        return (
          <div key={r.id} style={{ display:"flex", alignItems:"center", gap:"12px", background:C.card, border:`1px solid ${me?C.blue:"rgba(0,0,0,0.04)"}`, borderRadius:"18px", padding:"12px 14px", boxShadow:"0 1px 3px rgba(0,0,0,0.05)" }}>
            <div style={{ width:"26px", textAlign:"center", fontFamily:FONT, fontWeight:"700", fontSize:i<3?"18px":"14px", color:C.muted, flexShrink:0 }}>{i<3?["🥇","🥈","🥉"][i]:i+1}</div>
            <div style={{ width:"38px", height:"38px", borderRadius:"50%", background:C.blueLt, color:C.blue, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:FONT, fontWeight:"600", fontSize:"13px", flexShrink:0 }}>{initials}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"16px", color:C.black, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{r.name}{me&&<span style={{ color:C.blue, fontSize:"12px", marginLeft:"6px" }}>You</span>}</div>
              {r.sub&&<div style={{ fontSize:"12px", color:C.muted, marginTop:"1px" }}>{r.sub}</div>}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:"8px", flexShrink:0 }}>
              <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"18px", color:C.black }}>{r.value}</div>
              {r.chip!=null&&<div style={{ background:r.bad?"rgba(255,59,48,0.1)":C.blueLt, color:r.bad?C.red:C.blue, borderRadius:"980px", padding:"4px 10px", fontFamily:FONT, fontWeight:"600", fontSize:"12px", whiteSpace:"nowrap" }}>{r.chip}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Title above a list of rows.
function ListTitle({ children, right }) {
  return (
    <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:"8px", padding:"4px 4px 0" }}>
      <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"20px", color:C.black, letterSpacing:"-0.02em" }}>{children}</div>
      {right&&<div style={{ fontSize:"13px", color:C.muted }}>{right}</div>}
    </div>
  );
}

const TEAM_LEAD_OVERRIDE_PCT_PARTIAL = 0.05; // 5% if lead + 2/3 of team hits quota
const TEAM_LEAD_OVERRIDE_PCT_FULL    = 0.10; // 10% if lead + ALL of team hits quota

function calcTeamOverride(tech, allTechs, upsells, switchovers, reviews, callbacks, quota, jobs) {
  const teamMembers = allTechs.filter(t=>t.team_lead_id===tech.id);
  if (teamMembers.length===0) return { overridePts:0, overridePct:0, teamMembers:[], allTeamHit:false, partialHit:false, leadHitsQuota:false, teamMemberStats:[], hittingCount:0 };
  const q = quota || DEFAULT_QUOTA;
  const now = new Date(); const y=now.getFullYear(); const mo=String(now.getMonth()+1).padStart(2,"0");
  const mk = getMonthKey();
  const { start: mStart, end: mEnd } = monthBounds(y, mo);

  const teamMemberStats = teamMembers.map(m=>{
    const monthUpsellAmt   = upsellAmountInRange(jobs, m.id, mStart, mEnd);
    const monthReviewCount = reviews.filter(r=>r.tech_id===m.id&&r.month_key===mk).reduce((s,r)=>s+r.count,0);
    const monthSwitchCount = switchovers.filter(s=>s.tech_id===m.id&&s.week_key?.startsWith(`${y}-${mo}`)).length;
    const upHit=monthUpsellAmt>=q.upsells, revHit=monthReviewCount>=q.reviews, swHit=monthSwitchCount>=q.switchovers;
    const tt = calcTotals(m,upsells,switchovers,reviews,callbacks,jobs);
    return { ...m, monthUpsellAmt, monthReviewCount, monthSwitchCount, upHit, revHit, swHit, allHit:upHit&&revHit&&swHit, total:tt.total };
  });

  // Lead's own quota
  const leadMonthUpsells  = upsellAmountInRange(jobs, tech.id, mStart, mEnd);
  const leadMonthReviews  = reviews.filter(r=>r.tech_id===tech.id&&r.month_key===mk).reduce((s,r)=>s+r.count,0);
  const leadMonthSwitches = switchovers.filter(s=>s.tech_id===tech.id&&s.week_key?.startsWith(`${y}-${mo}`)).length;
  const leadHitsQuota = leadMonthUpsells>=q.upsells && leadMonthReviews>=q.reviews && leadMonthSwitches>=q.switchovers;

  const hittingCount  = teamMemberStats.filter(m=>m.allHit).length;
  const totalMembers  = teamMembers.length;
  const allTeamHit    = leadHitsQuota && hittingCount === totalMembers;
  const twoThirdsHit  = leadHitsQuota && hittingCount >= Math.ceil(totalMembers * (2/3));
  const teamTotalPts  = teamMemberStats.reduce((s,m)=>s+m.total,0); // team members ONLY — lead excluded

  let overridePct = 0;
  if (allTeamHit)       overridePct = TEAM_LEAD_OVERRIDE_PCT_FULL;
  else if (twoThirdsHit) overridePct = TEAM_LEAD_OVERRIDE_PCT_PARTIAL;

  const overridePts = Math.round(teamTotalPts * overridePct);
  return { overridePts, overridePct, teamMembers, teamMemberStats, allTeamHit, partialHit:twoThirdsHit&&!allTeamHit, leadHitsQuota, teamTotalPts, hittingCount, totalMembers };
}

function calcTotals(tech, upsells, switchovers, reviews, callbacks=[], jobs=[]) {
  const badgePts = calcBadgePts(tech.badges);
  const upsellAmt = (jobs||[]).filter(j=>j.tech_id===tech.id).reduce((s,j)=>s+(j.upsell_amount||0),0);
  const upsellPts = Math.round(upsellAmt*UPSELL_PTS_PER_DOLLAR);
  const switchPts = switchovers.filter(s=>s.tech_id===tech.id).reduce((s,sw)=>s+(PLAN_MAP[sw.plan_id]?.pts||0),0);
  const byMonth = {};
  reviews.filter(r=>r.tech_id===tech.id).forEach(r=>{ byMonth[r.month_key]=(byMonth[r.month_key]||0)+r.count; });
  const reviewPts = Object.values(byMonth).reduce((s,cnt)=>s+(cnt*REVIEW_PTS)+(cnt>=10?REVIEW_BONUS_PTS:0),0);
  const techCallbacks = callbacks.filter(c=>c.tech_id===tech.id);
  const callbackCount = techCallbacks.length;
  const callbackPts = techCallbacks.reduce((s,c)=>s+callbackPoints(c),0);
  const total = Math.max(0, badgePts+upsellPts+switchPts+reviewPts+callbackPts);
  return { badgePts, upsellAmt, upsellPts, switchPts, reviewPts, callbackPts, callbackCount, total };
}

// ─── UPSELL PAY ───────────────────────────────────────────────────────────────
// Tiers run per pay period (same dates as Payroll), not per week. The rate a
// tech reaches pays on ALL of that period's upsells: $650 → 25% × $650.
const UPSELL_PAY_TIERS = [
  { over:0,   rate:0.15, label:"$0–$300"   },
  { over:300, rate:0.20, label:"$301–$600" },
  { over:600, rate:0.25, label:"$601–$800" },
  { over:800, rate:0.30, label:"$801+"     },
];

function calcUpsellPay(upsellAmt) {
  const tier = [...UPSELL_PAY_TIERS].reverse().find(t => upsellAmt > t.over) || UPSELL_PAY_TIERS[0];
  return { totalPay: upsellAmt * tier.rate, rate: tier.rate };
}

function getNextPayTier(amt) {
  const next = UPSELL_PAY_TIERS.slice(1).find(t => amt <= t.over);
  if (!next) return { amt: null, rate: 0.30, label: "MAX RATE — 30% on every upsell this pay period 🔥" };
  return { amt: Math.max(1, Math.ceil(next.over + 1 - amt)), rate: next.rate, label: `${Math.round(next.rate*100)}% on every upsell this pay period` };
}

// ─── SWITCHOVER PAY ───────────────────────────────────────────────────────────
// Per switchover, by plan, +$10 when an exterior was added. Plans with no
// amount here show on Payroll as "rate not set" instead of a guessed number.
const SWITCHOVER_PAY = { weekly:50, biweekly:45, monthly:40, bimonthly:35, quarterly:30, biannual:10 };
const SWITCHOVER_EXTERIOR_PAY = 10;
function switchoverPay(sw) {
  const base = SWITCHOVER_PAY[sw.plan_id];
  return base == null ? null : base + (sw.with_exterior ? SWITCHOVER_EXTERIOR_PAY : 0);
}
// Day the switchover counts for: the day it was logged (sold_date is set to
// that day on entry; older rows fall back to created_at).
function switchoverDate(sw) {
  if (sw.sold_date) return sw.sold_date;
  if (sw.created_at) return mtDateStr(new Date(sw.created_at).getTime());
  return sw.week_key;
}


const GS = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#f5f5f7; color:#1d1d1f; font-family:-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale; letter-spacing:-0.01em; }
  ::-webkit-scrollbar { width:6px; height:6px; } ::-webkit-scrollbar-track { background:transparent; } ::-webkit-scrollbar-thumb { background:rgba(0,0,0,0.18); border-radius:3px; }
  input,select,button,textarea { font-family:inherit; }
  button { transition:opacity .15s, transform .1s, background-color .15s; }
  button:active:not(:disabled) { transform:scale(0.98); }
  input:focus, select:focus, textarea:focus { outline:none; border-color:#0a84ff !important; box-shadow:0 0 0 4px rgba(10,132,255,0.18); }
  input[type=number]::-webkit-inner-spin-button { -webkit-appearance:none; }
  input, select { color-scheme: light; }
`;

// ─── BASE COMPONENTS ──────────────────────────────────────────────────────────
function Logo({ h=40, color=C.brand }) {
  return <svg role="img" aria-label="Skylo" viewBox={LOGO_VIEWBOX} style={{ height:`${h}px`, width:"auto", display:"block", flexShrink:0 }}><path fill={color} fillRule="evenodd" d={LOGO_PATH}/></svg>;
}

function Header({ right, left, title, subtitle }) {
  return (
    <div style={{ background:"rgba(255,255,255,0.78)", backdropFilter:"saturate(180%) blur(20px)", WebkitBackdropFilter:"saturate(180%) blur(20px)", borderBottom:"1px solid rgba(0,0,0,0.08)", padding:"0 16px", display:"flex", alignItems:"center", justifyContent:"space-between", height:"56px", position:"sticky", top:0, zIndex:100 }}>
      <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
        {left}
        <Logo h={34}/>
        {title && (
          <div>
            <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"17px", letterSpacing:"-0.01em", textTransform:"none", color:C.black, lineHeight:1 }}>{title}</div>
            {subtitle && <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", textTransform:"none", marginTop:"2px" }}>{subtitle}</div>}
          </div>
        )}
      </div>
      {right}
    </div>
  );
}

function HamburgerBtn({ onClick }) {
  return (
    <button onClick={onClick} style={{ background:"none", border:"none", cursor:"pointer", padding:"6px", display:"flex", flexDirection:"column", gap:"5px", flexShrink:0 }}>
      <div style={{ width:"20px", height:"2px", background:C.black, borderRadius:"1px" }}/>
      <div style={{ width:"20px", height:"2px", background:C.black, borderRadius:"1px" }}/>
      <div style={{ width:"20px", height:"2px", background:C.black, borderRadius:"1px" }}/>
    </button>
  );
}

function SideNav({ sections, active, setActive, open, onClose, name, role }) {
  const activeSec = sections.findIndex(sec=>sec.items.some(([id])=>id===active));
  const [openSec, setOpenSec] = useState(activeSec);
  // Re-open the current page's group each time the menu is opened.
  useEffect(()=>{ if (open) setOpenSec(activeSec); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {open&&<div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.28)", backdropFilter:"blur(2px)", WebkitBackdropFilter:"blur(2px)", zIndex:300 }}/>}
      <div style={{ position:"fixed", top:0, left:0, height:"100%", width:"280px", background:"rgba(246,246,248,0.94)", backdropFilter:"saturate(180%) blur(24px)", WebkitBackdropFilter:"saturate(180%) blur(24px)", borderRight:"1px solid rgba(0,0,0,0.08)", zIndex:301, transform:open?"translateX(0)":"translateX(-100%)", transition:"transform 0.28s cubic-bezier(.32,.72,0,1)", boxShadow:open?"0 0 40px rgba(0,0,0,0.12)":"none", display:"flex", flexDirection:"column", overflowY:"auto" }}>
        {/* Drawer header */}
        <div style={{ padding:"18px 18px 12px", flexShrink:0 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"14px" }}>
            <Logo h={26}/>
            <button onClick={onClose} aria-label="Close menu" style={{ background:"rgba(0,0,0,0.06)", border:"none", color:C.muted, width:"28px", height:"28px", borderRadius:"50%", cursor:"pointer", fontSize:"13px", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
          </div>
          <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"24px", color:C.black, lineHeight:1.1, letterSpacing:"-0.02em" }}>{name}</div>
          {role&&<div style={{ fontSize:"13px", color:C.muted, marginTop:"2px", fontFamily:FONT }}>{role}</div>}
        </div>
        {/* Nav sections: each group is a dropdown; one open at a time. The
            group holding the current page opens by default. Unlabeled groups
            and one-item groups show their items directly. */}
        <div style={{ flex:1, padding:"4px 10px 24px" }}>
          {sections.map((sec,si)=>{
            const flat = !sec.label || sec.items.length===1;
            const isOpen = flat || openSec===si;
            const hasActive = sec.items.some(([id])=>id===active);
            const item = ([id,icon,label])=>(
              <button key={id} onClick={()=>{ setActive(id); onClose(); }} style={{ width:"100%", display:"flex", alignItems:"center", gap:"10px", padding:flat?"9px 10px":"8px 10px 8px 22px", background:active===id?C.blue:"none", border:"none", borderRadius:"8px", cursor:"pointer", fontFamily:FONT, fontWeight:"500", fontSize:"15px", color:active===id?"#fff":C.black, textAlign:"left", transition:"background 0.12s" }}>
                <span style={{ fontSize:"16px", width:"22px", textAlign:"center" }}>{icon}</span>
                {label}
              </button>
            );
            return (
              <div key={si} style={{ paddingTop:"2px" }}>
                {!flat&&(
                  <button onClick={()=>setOpenSec(isOpen?null:si)} aria-expanded={isOpen} style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 10px", background:"none", border:"none", borderRadius:"8px", cursor:"pointer", fontFamily:FONT, fontWeight:"600", fontSize:"15px", color:C.black, textAlign:"left" }}>
                    <span style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                      {sec.label}
                      {hasActive&&!isOpen&&<span style={{ width:"6px", height:"6px", borderRadius:"50%", background:C.blue }}/>}
                    </span>
                    <span style={{ color:C.muted, fontSize:"12px", transform:isOpen?"rotate(90deg)":"none", transition:"transform .2s" }}>❯</span>
                  </button>
                )}
                {isOpen&&<div style={{ paddingBottom:flat?0:"6px" }}>{sec.items.map(item)}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function LogoutBtn({ onLogout }) {
  return (
    <button onClick={onLogout} style={{ background:"rgba(0,0,0,0.05)", border:"none", color:C.black, padding:"7px 14px", borderRadius:"980px", cursor:"pointer", fontSize:"13px", fontFamily:FONT, fontWeight:"500" }}>
      Sign Out
    </button>
  );
}

function TabBar({ tabs, active, setActive, accent }) {
  const ac = accent || C.blue;
  return (
    <div style={{ display:"flex", background:C.white, borderBottom:`1px solid ${C.border}`, overflowX:"auto", WebkitOverflowScrolling:"touch", scrollbarWidth:"none", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
      {tabs.map(([id,label]) => (
        <button key={id} onClick={()=>setActive(id)} style={{
          background:"none", border:"none", cursor:"pointer", whiteSpace:"nowrap",
          padding:"14px 16px", fontSize:"14px", letterSpacing:"-0.01em", textTransform:"none",
          fontFamily:FONT, fontWeight:"600",
          color:active===id?ac:C.muted, flexShrink:0,
          borderBottom:active===id?`3px solid ${ac}`:"3px solid transparent",
        }}>{label}</button>
      ))}
    </div>
  );
}

function Num({ val, size=32, color=C.white, unit="" }) {
  return (
    <div style={{ display:"flex", alignItems:"baseline", gap:"3px" }}>
      <span style={{ fontFamily:FONT, fontWeight:"700", fontSize:`${size}px`, color, lineHeight:1 }}>{val}</span>
      {unit && <span style={{ fontSize:`${size*0.45}px`, color:C.muted, fontFamily:FONT, fontWeight:"700" }}>{unit}</span>}
    </div>
  );
}

function StatBlock({ label, value, color, sub, accent }) {
  return (
    <div style={{ background:C.white, border:`1px solid ${C.border}`, borderTop:`3px solid ${accent||color||C.blue}`, borderRadius:"16px", padding:"16px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
      <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", textTransform:"none", fontFamily:FONT, fontWeight:"700", marginBottom:"8px" }}>{label}</div>
      <Num val={value} color={color||C.black} size={28}/>
      {sub && <div style={{ fontSize:"11px", color:C.muted, marginTop:"5px" }}>{sub}</div>}
    </div>
  );
}

function Bar({ pct, color=C.blue, h=5 }) {
  return (
    <div style={{ background:C.border, borderRadius:"8px", height:`${h}px`, overflow:"hidden" }}>
      <div style={{ width:`${Math.min(pct,100)}%`, height:"100%", background:color, borderRadius:"8px" }}/>
    </div>
  );
}

function Label({ children, color=C.blue }) {
  return (
    <div style={{ fontSize:"11px", color, letterSpacing:"-0.01em", textTransform:"none", fontFamily:FONT, fontWeight:"700", fontStyle:"normal", marginBottom:"10px" }}>{children}</div>
  );
}

// Marker for archived (is_active=false) techs in historical views — reports,
// payroll, audit history — where their past data must stay visible, just
// clearly labeled so it's not mistaken for a current active tech.
function ArchivedTag() {
  return <span style={{ fontSize:"11px", color:C.muted, fontWeight:"600", fontStyle:"normal", marginLeft:"5px" }}>(Archived)</span>;
}

function Pill({ children, color=C.blue }) {
  return (
    <span style={{ display:"inline-block", background:`${color}22`, border:`1px solid ${color}55`, color, borderRadius:"3px", padding:"2px 8px", fontSize:"11px", fontFamily:FONT, fontWeight:"700", letterSpacing:"-0.01em", textTransform:"none" }}>
      {children}
    </span>
  );
}

// ─── PIN PAD ──────────────────────────────────────────────────────────────────
function PinPad({ onSubmit }) {
  // Drawn on the blue login screen: white dots and frosted round keys, like the iPhone lock screen.
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (pin.length===4) {
      setChecking(true);
      Promise.resolve(onSubmit(pin)).then(result => {
        setChecking(false);
        if (result === true) return;
        setMsg(result === "locked" ? "Too many wrong PINs — try again in 15 minutes." : result === "offline" ? "Can't reach the server — check your connection." : "");
        setShake(true); setTimeout(()=>{ setShake(false); setPin(""); },500);
      });
    }
  }, [pin]);
  const press = d => { if (pin.length<4 && !checking) { setMsg(""); setPin(p=>p+d); } };
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"32px" }}>
      <div style={{ display:"flex", gap:"14px", animation:shake?"shake .4s ease":"none" }}>
        {[0,1,2,3].map(i=>(
          <div key={i} style={{ width:"14px", height:"14px", borderRadius:"50%", background:i<pin.length?"#fff":"transparent", border:"1.5px solid #fff", transition:"background .12s" }}/>
        ))}
      </div>
      {msg && <div style={{ fontSize:"14px", color:"#fff", fontWeight:"600", maxWidth:"260px", textAlign:"center", background:"rgba(255,59,48,0.85)", padding:"8px 14px", borderRadius:"12px" }}>{msg}</div>}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,78px)", gap:"16px 24px" }}>
        {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((d,i)=>(
          <button key={i} onClick={()=>d==="⌫"?setPin(p=>p.slice(0,-1)):d!==""?press(String(d)):null}
            disabled={d===""}
            style={{ width:"78px", height:"78px", borderRadius:"50%", background:d===""||d==="⌫"?"transparent":"rgba(255,255,255,0.18)", backdropFilter:"blur(10px)", WebkitBackdropFilter:"blur(10px)", border:"none", color:"#fff", fontSize:d==="⌫"?"24px":"32px", fontWeight:"400", cursor:d===""?"default":"pointer", fontFamily:FONT }}>
            {d}
          </button>
        ))}
      </div>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}${GS}`}</style>
    </div>
  );
}

// ─── BADGE GRID ───────────────────────────────────────────────────────────────
function BadgeGrid({ earned }) {
  const cats = ["Prestige","Revenue","Clean Streak","Performance","Character","Tenure","Trophy"];
  const catColors = { Prestige:C.gold, Revenue:C.green, "Clean Streak":C.blue, Performance:C.purple, Character:C.orange, Tenure:C.muted, Trophy:"#0092f9" };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"24px" }}>
      {/* Rotating Trophies info */}
      <div style={{ background:"#ff6ef718", border:"1px solid #ff6ef744", borderRadius:"16px", padding:"12px 16px" }}>
        <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"13px", color:"#0092f9", letterSpacing:"-0.01em", marginBottom:"6px" }}>🏆 ROTATING MONTHLY TROPHIES</div>
        <div style={{ fontSize:"12px", color:C.muted }}>These badges are passed to whoever is in the lead each month — no points, pure bragging rights.</div>
        <div style={{ display:"flex", gap:"8px", flexWrap:"wrap", marginTop:"10px" }}>
          {ROTATING_TROPHIES.map(t=>(
            <div key={t.id} style={{ background:earned?.includes(t.id)?"#0092f922":"rgba(0,0,0,0.2)", border:`1px solid ${earned?.includes(t.id)?"#0092f9":"#333"}`, borderRadius:"8px", padding:"6px 12px", opacity:earned?.includes(t.id)?1:0.5 }}>
              <span style={{ fontSize:"16px" }}>{t.icon}</span>
              <span style={{ fontFamily:FONT, fontWeight:"700", fontSize:"12px", color:earned?.includes(t.id)?"#0092f9":C.muted, marginLeft:"6px" }}>{t.name}</span>
            </div>
          ))}
        </div>
      </div>
      {cats.filter(c=>c!=="Trophy").map(cat=>{
        const badges = ALL_BADGE_DEFS.filter(b=>b.cat===cat);
        if (!badges.length) return null;
        const col = catColors[cat] || C.blue;
        return (
          <div key={cat}>
            <div style={{ fontSize:"11px", color:col, letterSpacing:"-0.01em", textTransform:"none", fontFamily:FONT, fontWeight:"600", marginBottom:"10px" }}>{cat}</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:"8px" }}>
              {badges.map(b=>{
                const have = earned?.includes(b.id);
                return (
                  <div key={b.id} style={{ background:have?`${col}18`:"rgba(0,0,0,0.2)", border:`1px solid ${have?col+"55":C.border}`, borderRadius:"16px", padding:"10px 12px", opacity:have?1:0.45 }}>
                    <div style={{ fontSize:"22px", marginBottom:"5px" }}>{b.icon}</div>
                    <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"13px", color:have?C.white:C.muted }}>{b.name}</div>
                    <div style={{ fontSize:"11px", color:col, fontFamily:FONT, fontWeight:"700", marginTop:"2px" }}>{b.pts>0?`+${b.pts} pts`:"Trophy"}</div>
                    <div style={{ fontSize:"11px", color:C.muted, marginTop:"4px", lineHeight:"1.3" }}>{b.desc}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}


// ─── UPSELL LEADERBOARD ───────────────────────────────────────────────────────
function UpsellLeaderboard({ techs, upsells, jobs=[], currentId }) {
  const allTime = {};
  upsells.forEach(u=>{ allTime[u.tech_id]=(allTime[u.tech_id]||0)+u.amount; });


  // Date range — same WTD/Last Week/MTD/Last Month/YTD/Custom control as
  // Revenue's Time Period panel (getDateRangeBounds). Filters by each entry's
  // real completion date (jobs.job_date, joined via hcp_job_id), not
  // week_key, now that Repair Upsells has been run across full history and
  // populates jobs.upsell_amount with day-level data for ~95% of entries.
  // The remaining entries (manually entered, no hcp_job_id) have no exact
  // date to match against, so they're excluded from range filtering rather
  // than approximated by week — surfaced separately below so nothing is
  // silently dropped.
  const [rangePreset, setRangePreset] = useState("wtd");
  const [cStart, setCStart] = useState("");
  const [cEnd, setCEnd] = useState("");
  const { start: rangeStart, end: rangeEnd } = getDateRangeBounds(rangePreset, cStart, cEnd);
  const jobDateByHcpId = {};
  jobs.forEach(j => { if (j.hcp_job_id && !jobDateByHcpId[j.hcp_job_id]) jobDateByHcpId[j.hcp_job_id] = j.job_date; });
  const upsellsWithDate = upsells.map(u => ({ ...u, resolvedDate: u.hcp_job_id ? (jobDateByHcpId[u.hcp_job_id] || null) : null }));
  const rangeInRange = upsellsWithDate.filter(u => u.resolvedDate && u.resolvedDate >= rangeStart && u.resolvedDate <= rangeEnd);
  const noDateEntries = upsellsWithDate.filter(u => !u.resolvedDate);
  const noDateTotal = noDateEntries.reduce((s,u)=>s+(u.amount||0),0);

  const rangeByTech = {};
  rangeInRange.forEach(u => { rangeByTech[u.tech_id] = (rangeByTech[u.tech_id] || 0) + (u.amount || 0); });
  const rangeRanked = techs.map(t => ({ ...t, amt: rangeByTech[t.id] || 0 })).filter(t => t.amt > 0).sort((a, b) => b.amt - a.amt);
  const rangeTotal = rangeRanked.reduce((s,t)=>s+t.amt,0);
  const upsellRow = (t, amt) => ({ id:t.id, name:t.name, value:`$${Math.round(amt).toLocaleString()}`, chip:`${Math.round(amt*UPSELL_PTS_PER_DOLLAR).toLocaleString()} pts` });
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
      <DateRangePicker label="📅 Date Range" preset={rangePreset} setPreset={setRangePreset} customStart={cStart} setCustomStart={setCStart} customEnd={cEnd} setCustomEnd={setCEnd}>
        <div style={{ fontSize:"12px", color:C.muted, marginTop:"8px" }}>{fmtShortDate(rangeStart)} – {fmtShortDate(rangeEnd)} · by job completion date</div>
      </DateRangePicker>
      <ListTitle right={`$${Math.round(rangeTotal).toLocaleString()} team total`}>Upsells</ListTitle>
      <RankRows rows={rangeRanked.map(t=>upsellRow(t,t.amt))} currentId={currentId} empty="No upsells in this range yet."/>
      {noDateEntries.length>0&&(
        <div style={{ fontSize:"12px", color:C.muted, padding:"0 4px" }}>
          {noDateEntries.length} entr{noDateEntries.length!==1?"ies":"y"} totaling ${noDateTotal.toLocaleString()} {noDateEntries.length!==1?"aren't":"isn't"} tied to an HCP job, so {noDateEntries.length!==1?"they're":"it's"} only in the all-time totals.
        </div>
      )}
      <ListTitle>All Time</ListTitle>
      <RankRows rows={[...techs].filter(t=>(allTime[t.id]||0)>0).sort((a,b)=>(allTime[b.id]||0)-(allTime[a.id]||0)).map(t=>upsellRow(t,allTime[t.id]||0))} currentId={currentId} empty="No upsells logged yet."/>
    </div>
  );
}

// ─── SWITCHOVER LEADERBOARD ───────────────────────────────────────────────────
function SwitchoverLeaderboard({ techs, switchovers, currentId }) {
  const allCount={}, allPts={};
  switchovers.forEach(s=>{ allCount[s.tech_id]=(allCount[s.tech_id]||0)+1; allPts[s.tech_id]=(allPts[s.tech_id]||0)+(PLAN_MAP[s.plan_id]?.pts||0); });

  // Date range — same WTD/Last Week/MTD/Last Month/YTD/Custom control as
  // Revenue's Time Period panel (getDateRangeBounds). Entries are only
  // logged with a week_key (Sunday of the week), not an exact day, so range
  // filtering matches by week overlap: any switchover whose week starts
  // on/after the Sunday of the range start and on/before the range end.
  const [rangePreset, setRangePreset] = useState("wtd");
  const [cStart, setCStart] = useState("");
  const [cEnd, setCEnd] = useState("");
  const { start: rangeStart, end: rangeEnd } = getDateRangeBounds(rangePreset, cStart, cEnd);
  function mondayOf(dateStr) {
    const d = new Date(dateStr + "T12:00:00Z");
    const day = d.getUTCDay();
    const back = day; // week starts Sunday
    d.setUTCDate(d.getUTCDate() - back);
    return d.toISOString().split("T")[0];
  }
  const rangeFromWk = mondayOf(rangeStart);
  const rangeInRange = switchovers.filter(s => s.week_key >= rangeFromWk && s.week_key <= rangeEnd);
  const rangeByTech = {};
  rangeInRange.forEach(s => {
    if (!rangeByTech[s.tech_id]) rangeByTech[s.tech_id] = { total: 0, byPlan: {} };
    rangeByTech[s.tech_id].total++;
    rangeByTech[s.tech_id].byPlan[s.plan_id] = (rangeByTech[s.tech_id].byPlan[s.plan_id] || 0) + 1;
  });
  const rangeRanked = techs
    .map(t => ({ ...t, total: rangeByTech[t.id]?.total || 0, byPlan: rangeByTech[t.id]?.byPlan || {} }))
    .filter(t => t.total > 0)
    .sort((a, b) => b.total - a.total);

  const ptsOf = byPlan => Object.entries(byPlan).reduce((s,[planId,n])=>s+n*(PLAN_MAP[planId]?.pts||0),0);
  const planList = byPlan => Object.entries(byPlan).sort((a,b)=>b[1]-a[1]).map(([planId,count])=>`${count} ${PLAN_MAP[planId]?.label||planId}`).join(", ");
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
      <DateRangePicker label="📅 Date Range" preset={rangePreset} setPreset={setRangePreset} customStart={cStart} setCustomStart={setCStart} customEnd={cEnd} setCustomEnd={setCEnd}>
        <div style={{ fontSize:"12px", color:C.muted, marginTop:"8px" }}>{fmtShortDate(rangeStart)} – {fmtShortDate(rangeEnd)} · switchovers are matched by week</div>
      </DateRangePicker>
      <ListTitle right={`${rangeRanked.reduce((s,t)=>s+t.total,0)} team total`}>Switchovers</ListTitle>
      <RankRows rows={rangeRanked.map(t=>({ id:t.id, name:t.name, value:`${t.total}`, chip:`${ptsOf(t.byPlan).toLocaleString()} pts`, sub:planList(t.byPlan) }))} currentId={currentId} empty="No switchovers in this range yet."/>
      <ListTitle>All Time</ListTitle>
      <RankRows rows={[...techs].filter(t=>(allCount[t.id]||0)>0).sort((a,b)=>(allPts[b.id]||0)-(allPts[a.id]||0)).map(t=>({ id:t.id, name:t.name, value:`${allCount[t.id]||0}`, chip:`${(allPts[t.id]||0).toLocaleString()} pts` }))} currentId={currentId} empty="No switchovers logged yet."/>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"14px 16px" }}>
        <Label>Plan Values</Label>
        <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
          {SERVICE_PLANS.map(p=>(
            <div key={p.id} style={{ background:C.cardLt, borderRadius:"980px", padding:"5px 12px", fontSize:"12px" }}>
              <span style={{ fontFamily:FONT, fontWeight:"600", color:C.black }}>{p.label} </span>
              <span style={{ color:C.muted }}>{p.freq} </span>
              <span style={{ color:C.blue, fontFamily:FONT, fontWeight:"600" }}>+{p.pts} pts</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── REVIEW LEADERBOARD ───────────────────────────────────────────────────────
function ReviewLeaderboard({ techs, reviews, currentId }) {
  const byMonth = {};
  reviews.forEach(r=>{ if(!byMonth[r.month_key])byMonth[r.month_key]={}; byMonth[r.month_key][r.tech_id]=(byMonth[r.month_key][r.tech_id]||0)+r.count; });


  // Reviews are logged per month, so a range covers every month it touches.
  // Points are per month (10+ in one month earns the bonus).
  const [rangePreset, setRangePreset] = useState("mtd");
  const [cStart, setCStart] = useState("");
  const [cEnd, setCEnd] = useState("");
  const { start: rangeStart, end: rangeEnd } = getDateRangeBounds(rangePreset, cStart, cEnd);
  const monthsInRange = Object.keys(byMonth).filter(m => m >= rangeStart.slice(0,7) && m <= rangeEnd.slice(0,7));
  const sumFor = (id, months) => months.reduce((acc,m)=>{ const n=byMonth[m]?.[id]||0; return { cnt:acc.cnt+n, pts:acc.pts+n*REVIEW_PTS+(n>=10?REVIEW_BONUS_PTS:0) }; }, { cnt:0, pts:0 });
  const allMonthKeys = Object.keys(byMonth);
  const rows = months => techs.map(t=>({ t, ...sumFor(t.id, months) })).filter(r=>r.cnt>0).sort((a,b)=>b.cnt-a.cnt)
    .map(r=>({ id:r.t.id, name:r.t.name, value:`${r.cnt} ⭐`, chip:`${r.pts.toLocaleString()} pts` }));
  const rangeRows = rows(monthsInRange);
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
      <div style={{ fontSize:"13px", color:C.muted, padding:"0 4px" }}>+{REVIEW_PTS} pts per 5-star review · +{REVIEW_BONUS_PTS} bonus at 10+ in a month</div>
      <DateRangePicker label="📅 Date Range" preset={rangePreset} setPreset={setRangePreset} customStart={cStart} setCustomStart={setCStart} customEnd={cEnd} setCustomEnd={setCEnd}>
        <div style={{ fontSize:"12px", color:C.muted, marginTop:"8px" }}>{fmtShortDate(rangeStart)} – {fmtShortDate(rangeEnd)} · reviews are logged by month</div>
      </DateRangePicker>
      <ListTitle right={`${monthsInRange.reduce((s,m)=>s+Object.values(byMonth[m]).reduce((a,b)=>a+b,0),0)} team total`}>5-Star Reviews</ListTitle>
      <RankRows rows={rangeRows} currentId={currentId} empty="No reviews in this range yet."/>
      <ListTitle>All Time</ListTitle>
      <RankRows rows={rows(allMonthKeys)} currentId={currentId} empty="No reviews logged yet."/>
    </div>
  );
}

// ─── TOTAL LEADERBOARD ────────────────────────────────────────────────────────
function TotalLeaderboard({ techs, upsells, switchovers, reviews, callbacks, jobs=[] }) {
  const ranked = [...techs].map(t=>{ const tt=calcTotals(t,upsells,switchovers,reviews,callbacks||[],jobs); return {...t,...tt,tier:getTier(tt.total)}; }).sort((a,b)=>b.total-a.total);
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
      <ListTitle right="all time">Total Score</ListTitle>
      <RankRows rows={ranked.map(t=>({ id:t.id, name:t.name, value:`${t.total.toLocaleString()} pts`, chip:`${t.tier.icon} ${t.tier.name.charAt(0)+t.tier.name.slice(1).toLowerCase()}`,
        sub:`Badges ${t.badgePts} · Upsells $${Math.round(t.upsellAmt).toLocaleString()} · Switchovers ${t.switchPts} · Reviews ${t.reviewPts}` }))} empty="No points yet."/>
    </div>
  );
}

// ─── REPORTS TAB ─────────────────────────────────────────────────────────────
function ReportsTab({ techs, jobs, upsells=[], switchovers=[], timeEntries=[], tipEntries=[], techId=null, refreshAll=async()=>{}, showToast=()=>{}, token=null, isOwner=false }) {
  // Monthly labor from QuickBooks (owners only) -- also gives the real
  // payroll tax rate the live estimate uses.
  const [qb, setQb] = useState({ months:[], error:null, loaded:false });
  useEffect(() => {
    if (!isOwner) return;
    let live = true;
    fetch("/.netlify/functions/labor-actuals", { headers:{ Authorization:`Bearer ${token||""}` } })
      .then(async r => { const j = await r.json().catch(()=>({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; })
      .then(j => live && setQb({ months:j.months||[], error:null, loaded:true }))
      .catch(e => live && setQb({ months:[], error:e.message, loaded:true }));
    return () => { live = false; };
  }, [isOwner, token]);
  const [preset, setPreset] = useState("wtd");
  const [cStart, setCStart] = useState("");
  const [cEnd,   setCEnd]   = useState("");
  const revTodayDefault = new Date(Date.now() - 6*3600000).toISOString().split("T")[0];
  const [repairRevFrom, setRepairRevFrom] = useState("2026-06-01");
  const [repairRevTo,   setRepairRevTo]   = useState(revTodayDefault);
  const [repairRevResult, setRepairRevResult] = useState(null);
  const [repairingRev, setRepairingRev] = useState(false);
  const [revExpanded, setRevExpanded] = useState(false);

  function exportRevenueCSV() {
    const rows = repairRevResult?.jobs || [];
    if (rows.length === 0) return;
    const header = ["Job ID","Tech","Date","Revenue","Invoice"];
    const csvRows = rows.map(r => [r.jobId, r.tech, r.date, r.revenue.toFixed(2), r.invoiceFound ? "Found" : "Fallback"]);
    const csv = [header, ...csvRows].map(row => row.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `revenue-repair_${repairRevFrom}_to_${repairRevTo}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function repairRevenueFromHCP() {
    setRepairingRev(true);
    setRepairRevResult(null);
    try {
      // Split range into 7-day chunks so each call stays under the 26s Netlify timeout
      const chunks = [];
      let cur = new Date(repairRevFrom + "T12:00:00Z");
      const rangeEnd = new Date(repairRevTo + "T12:00:00Z");
      while (cur <= rangeEnd) {
        const chunkFrom = cur.toISOString().split("T")[0];
        const chunkEnd = new Date(cur);
        chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 6);
        const chunkTo = chunkEnd > rangeEnd ? repairRevTo : chunkEnd.toISOString().split("T")[0];
        chunks.push({ from: chunkFrom, to: chunkTo });
        cur.setUTCDate(cur.getUTCDate() + 7);
      }
      let totalScanned = 0, totalMatched = 0, totalWritten = 0, allJobRows = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        showToast(`Scanning week ${i+1} of ${chunks.length}...`);
        const endpoint = "/.netlify/functions/hcp-revenue-repair";
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chunk),
        });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch {}
        if (!res.ok || !data || !data.ok) {
          // Report the real status instead of guessing a cause — an empty body
          // could mean a timeout, a platform block, or something else entirely.
          const detail = data?.error || (text ? text.slice(0,200) : `HTTP ${res.status}${res.statusText ? " "+res.statusText : ""} from ${endpoint} (empty response body)`);
          showToast(`Repair failed on week ${chunk.from}: ${detail}`, false);
          setRepairingRev(false);
          return;
        }
        totalScanned += data.jobsScanned || 0;
        totalMatched += data.invoicesMatched || 0;
        totalWritten += data.jobsWritten || 0;
        if (data.jobs) allJobRows.push(...data.jobs);
      }
      await refreshAll();
      setRepairRevResult({ jobsScanned: totalScanned, invoicesMatched: totalMatched, jobsWritten: totalWritten, jobs: allJobRows });
      showToast(`✅ Repaired revenue for ${totalWritten} row${totalWritten===1?"":"s"}`);
    } catch(e) { showToast("Error: "+e.message, false); }
    setRepairingRev(false);
  }
  const { start, end } = getDateRangeBounds(preset, cStart, cEnd);

  const inRange = jobs.filter(j => {
    if (!j.job_date) return false;
    if (techId && j.tech_id !== techId) return false;
    return j.job_date >= start && j.job_date <= end;
  });

  // Upsell totals: day-exact via jobs.upsell_amount over inRange (same
  // filtering as totalRevenue below), NOT the upsells table's week_key
  // bucket — that only resolves to whole-week granularity, so any preset
  // sharing a calendar week (e.g. Today/Yesterday/WTD) collapsed to the
  // same total regardless of which was selected.
  const upsellByTech = {};
  inRange.forEach(j => {
    upsellByTech[j.tech_id] = (upsellByTech[j.tech_id] || 0) + (j.upsell_amount || 0);
  });
  const totalUpsells = inRange.reduce((s,j) => s+(j.upsell_amount||0), 0);

  const totalRevenue   = inRange.reduce((s,j) => s+(j.revenue||0), 0);
  const totalTips      = techId
    ? tipsRangeTotal(tipEntries, techId, start, end)
    : tipEntries.filter(t => t.work_date >= start && t.work_date <= end).reduce((s,t) => s+(t.amount||0), 0);
  const totalHours     = techId
    ? rangeHoursTotal(timeEntries, techId, start, end)
    : timeEntries.filter(e => e.work_date >= start && e.work_date <= end).reduce((s,e) => s+sessionHours(e), 0);
  const taxRate        = payrollTaxRate(qb.months);
  const labor          = laborEstimate({ techs, jobs, switchovers, timeEntries, start, end, techId, taxRate });
  const totalLabor     = labor.labor;
  const revPerHr       = totalHours > 0 ? totalRevenue/totalHours : 0;
  const upsellPct      = totalRevenue > 0 ? (totalUpsells/totalRevenue)*100 : 0;
  const laborPct       = labor.pct;
  const qbMonths       = (() => { const tips = tipsPaidByMonth(tipEntries, getPayPeriods()); return qb.months.map(m => qbLaborMonth(m, tips[m.month])).reverse(); })();

  const allWkKeys = [...new Set(inRange.map(j=>j.week_key))].filter(Boolean).sort();
  const techRows = techId ? [] : techs.map(t => {
    const tj = inRange.filter(j=>j.tech_id===t.id);
    const rev  = tj.reduce((s,j)=>s+(j.revenue||0),0);
    const hrs  = rangeHoursTotal(timeEntries, t.id, start, end);
    const ups  = upsellByTech[t.id] || 0;
    const tips = tipsRangeTotal(tipEntries, t.id, start, end);
    const wkBreakdown = allWkKeys.map(wk=>{
      const wj=tj.filter(j=>j.week_key===wk);
      const wkEndDate = new Date(wk+"T12:00:00Z"); wkEndDate.setUTCDate(wkEndDate.getUTCDate()+6);
      const wkEndStr = wkEndDate.toISOString().split("T")[0];
      return { wk, rev:wj.reduce((s,j)=>s+(j.revenue||0),0), tips:tipsRangeTotal(tipEntries, t.id, wk, wkEndStr), count:wj.length };
    }).filter(w=>w.rev>0);
    return { ...t, rev, hrs, ups, tips, revPerHr:hrs>0?rev/hrs:0, upsellPct:rev>0?(ups/rev)*100:0, wkBreakdown };
  }).filter(t=>t.rev>0||t.hrs>0).sort((a,b)=>b.rev-a.rev);

  const metricStyle = { background:C.white, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      {/* Repair Revenue — admin only, tucked in the top-right Tools */}
      {techId===null && <PageTools tools={[{ id:"repair", label:"Repair from HCP", icon:"🔧", render:()=>(
        <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
          <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"16px", color:C.black }}>Repair Revenue from HCP</div>
          <div style={{ fontSize:"12px", color:C.muted }}>Re-scans completed jobs and their invoices across a custom date range and rewrites revenue to the board. Use this to fix missing or wrong revenue.</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
            {[["FROM", repairRevFrom, setRepairRevFrom], ["TO", repairRevTo, setRepairRevTo]].map(([lbl, val, set]) => (
              <div key={lbl}>
                <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", fontFamily:FONT, fontWeight:"700", marginBottom:"4px" }}>{lbl}</div>
                <input type="date" value={val} onChange={e => set(e.target.value)} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"8px 10px", borderRadius:"10px", fontSize:"13px", fontFamily:FONT, width:"100%", boxSizing:"border-box" }}/>
              </div>
            ))}
          </div>
          <button onClick={repairRevenueFromHCP} disabled={repairingRev} style={{ background:repairingRev?C.border:C.orange, border:"none", color:C.white, padding:"13px", borderRadius:"16px", cursor:repairingRev?"not-allowed":"pointer", fontSize:"13px", fontWeight:"700", letterSpacing:"-0.01em", fontFamily:FONT, width:"100%", textTransform:"none" }}>
            {repairingRev ? "Scanning HCP — this may take ~20 sec..." : "Repair Revenue"}
          </button>
          {repairRevResult && (
            <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
              <div style={{ background:C.cardLt, borderRadius:"10px", padding:"10px 14px", fontSize:"12px", color:C.muted, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:"8px" }}>
                <span>
                  Scanned <strong style={{color:C.black}}>{repairRevResult.jobsScanned}</strong> jobs · matched <strong style={{color:C.black}}>{repairRevResult.invoicesMatched}</strong> invoices · wrote <strong style={{color:C.orange}}>{repairRevResult.jobsWritten} row{repairRevResult.jobsWritten===1?"":"s"}</strong> to the board
                </span>
                {repairRevResult.jobs && repairRevResult.jobs.length > 0 && (
                  <div style={{ display:"flex", gap:"6px" }}>
                    <button onClick={()=>setRevExpanded(v=>!v)} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"5px 10px", borderRadius:"8px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"11px", letterSpacing:"-0.01em" }}>
                      {revExpanded ? "Collapse" : "View full report"}
                    </button>
                    <button onClick={exportRevenueCSV} style={{ background:C.blue, border:"none", color:C.white, padding:"5px 10px", borderRadius:"8px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"11px", letterSpacing:"-0.01em" }}>
                      Export CSV
                    </button>
                  </div>
                )}
              </div>
              {repairRevResult.jobs && repairRevResult.jobs.length > 0 && (
                <div style={{ overflowX:"auto", maxHeight: revExpanded ? "none" : "320px", overflowY:"auto", borderRadius:"10px", border:`1px solid ${C.border}` }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"11px", fontFamily:FONT }}>
                    <thead>
                      <tr style={{ background:C.card, position:"sticky", top:0 }}>
                        {["Job ID","Tech","Date","Revenue","Invoice"].map(h => (
                          <th key={h} style={{ padding:"6px 10px", textAlign:"left", color:C.muted, fontWeight:"700", letterSpacing:"-0.01em", fontFamily:FONT, whiteSpace:"nowrap", borderBottom:`1px solid ${C.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {repairRevResult.jobs.map((row, i) => (
                        <tr key={row.jobId+"|"+row.tech} style={{ background: i%2===0 ? C.cardLt : C.card }}>
                          <td style={{ padding:"5px 10px", color:C.muted, whiteSpace:"nowrap" }}>{row.jobId}</td>
                          <td style={{ padding:"5px 10px", color:C.black, whiteSpace:"nowrap" }}>{row.tech}</td>
                          <td style={{ padding:"5px 10px", color:C.muted, whiteSpace:"nowrap" }}>{row.date}</td>
                          <td style={{ padding:"5px 10px", color:C.green, fontWeight:"700", whiteSpace:"nowrap" }}>${row.revenue.toFixed(2)}</td>
                          <td style={{ padding:"5px 10px", color: row.invoiceFound ? C.green : C.muted, whiteSpace:"nowrap" }}>{row.invoiceFound ? "✓" : "fallback"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}]}/>}
      {/* Period selector */}
      <DateRangePicker label="📊 Time Period" color={C.blue} preset={preset} setPreset={setPreset} customStart={cStart} setCustomStart={setCStart} customEnd={cEnd} setCustomEnd={setCEnd}>
        <div style={{ marginTop:"8px", fontSize:"11px", color:C.blue, fontFamily:FONT, fontWeight:"700" }}>
            {start} → {end} · {inRange.length} job{inRange.length!==1?"s":""}
          </div>
      </DateRangePicker>

      {inRange.length===0?(
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"32px", textAlign:"center", color:C.muted, fontSize:"13px" }}>
          No jobs found for this period. The HCP sync runs every 5 minutes.
        </div>
      ):(
        <>
          {/* Metric cards */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"10px" }}>
            {[
              { label:"Serviced Revenue", value:`$${Math.round(totalRevenue).toLocaleString()}`, color:C.green,                                              sub:`${inRange.length} jobs` },
              { label:"Tips",            value:`$${Math.round(totalTips).toLocaleString()}`,   color:C.gold,                                               sub:"separate from revenue" },
              { label:"Hours",           value:totalHours>0?totalHours.toFixed(1):"—",            color:C.blue,                                               sub:totalHours>0?`${(totalHours/Math.max(inRange.length,1)).toFixed(1)}h/job avg`:"Enter hours below" },
              { label:"Rev / Hour",   value:totalHours>0?`$${revPerHr.toFixed(2)}`:"—",        color:totalHours>0?(revPerHr>=75?C.green:C.red):C.muted, sub:"Target: >$75/hr" },
              { label:"Upsell $",     value:`$${Math.round(totalUpsells).toLocaleString()}`,   color:C.gold,                                               sub:`of $${Math.round(totalRevenue).toLocaleString()} revenue` },
              { label:"Upsell Rate",  value:`${upsellPct.toFixed(1)}%`,                        color:upsellPct>=10?C.green:C.red,                       sub:"Target: >10%" },
              { label:"Labor Cost %", value:totalLabor>0?`${laborPct.toFixed(1)}%`:"—",        color:totalLabor>0?(laborPct<=LABOR_TARGET_PCT?C.green:C.red):C.muted,  sub:`Goal: ${LABOR_TARGET_PCT}% or lower · estimate` },
            ].map(s=>(
              <div key={s.label} style={{ ...metricStyle }}>
                <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", textTransform:"none", fontFamily:FONT, fontWeight:"700", marginBottom:"8px" }}>{s.label}</div>
                <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"28px", color:s.color, lineHeight:1 }}>{s.value}</div>
                {s.sub&&<div style={{ fontSize:"11px", color:C.muted, marginTop:"5px" }}>{s.sub}</div>}
              </div>
            ))}
          </div>

          {/* Labor cost: what's in the estimate, and the QuickBooks actual by month */}
          {techId===null&&(
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px", display:"flex", flexDirection:"column", gap:"10px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
                <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"17px", color:C.black }}>Labor Cost</div>
                <div style={{ fontSize:"13px", color:C.muted }}>goal {LABOR_TARGET_PCT}% or lower</div>
              </div>
              {[
                ["Commission", labor.commission],
                ["Upsell bonuses", labor.upsellBonus],
                ["Switchover bonuses", labor.switchBonus],
                ["Training pay", labor.training],
                [`Payroll taxes (${(taxRate*100).toFixed(1)}%${qb.months.length?" from QuickBooks":" est."})`, labor.taxes],
              ].map(([l,v])=>(
                <div key={l} style={{ display:"flex", justifyContent:"space-between", fontSize:"14px", color:C.black }}><span style={{ color:C.muted }}>{l}</span><span>${Math.round(v).toLocaleString()}</span></div>
              ))}
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:"15px", fontWeight:"600", color:C.black, borderTop:`1px solid ${C.border}`, paddingTop:"8px" }}>
                <span>${Math.round(labor.labor).toLocaleString()} of ${Math.round(labor.revenue).toLocaleString()} serviced</span>
                <span style={{ color:labor.pct<=LABOR_TARGET_PCT?C.green:C.red }}>{labor.pct.toFixed(1)}%</span>
              </div>
              <div style={{ fontSize:"12px", color:C.muted }}>Tips aren't counted on either side. Salary, owner pay and office sales commission aren't crew labor.</div>
              {isOwner&&(
                <div style={{ marginTop:"6px", display:"flex", flexDirection:"column", gap:"8px" }}>
                  <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"15px", color:C.black }}>Actual from QuickBooks</div>
                  {qb.error&&<div style={{ fontSize:"13px", color:C.red }}>Couldn't load: {qb.error}</div>}
                  {qb.loaded&&!qb.error&&qbMonths.length===0&&<div style={{ fontSize:"13px", color:C.muted }}>No months pulled yet.</div>}
                  {qbMonths.length>=2&&(()=>{ const last=qbMonths.slice(0,3); const l=last.reduce((s,m)=>s+m.labor,0), r=last.reduce((s,m)=>s+m.revenue,0), pct=r>0?l/r*100:null; return (
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"10px", background:C.blueLt, borderRadius:"14px", padding:"10px 14px" }}>
                      <div>
                        <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"15px", color:C.black }}>Last {last.length} months combined</div>
                        <div style={{ fontSize:"12px", color:C.muted }}>${Math.round(l).toLocaleString()} of ${Math.round(r).toLocaleString()} · evens out the paydays</div>
                      </div>
                      <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"20px", color:pct!=null&&pct<=LABOR_TARGET_PCT?C.green:C.red }}>{pct==null?"—":`${pct.toFixed(1)}%`}</div>
                    </div>
                  ); })()}
                  {qbMonths.map(m=>(
                    <div key={m.month} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"10px", background:C.cardLt, borderRadius:"14px", padding:"10px 14px" }}>
                      <div>
                        <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"15px", color:C.black }}>{formatMonthLabel(m.month)}</div>
                        <div style={{ fontSize:"12px", color:C.muted }}>${Math.round(m.labor).toLocaleString()} of ${Math.round(m.revenue).toLocaleString()} · ${Math.round(m.tips).toLocaleString()} tips taken out</div>
                      </div>
                      <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"20px", color:m.pct!=null&&m.pct<=LABOR_TARGET_PCT?C.green:C.red }}>{m.pct==null?"—":`${m.pct.toFixed(1)}%`}</div>
                    </div>
                  ))}
                  <div style={{ fontSize:"12px", color:C.muted }}>Wages – COGS + Payroll Taxes – COGS + Training Pay, minus tips, over income minus tips. Books by pay date, so a month with three paydays runs high.</div>
                </div>
              )}
            </div>
          )}

          {/* Per-tech breakdown — admin / all-techs view only */}
          {techRows.length>0&&(
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", overflow:"hidden" }}>
              <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}`, background:C.cardLt }}>
                <Label color={C.blue}>Per-Tech Breakdown</Label>
              </div>
              <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"10px" }}>
                {techRows.map((t,i)=>(
                  <div key={t.id} style={{ background:C.cardLt, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"12px 14px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"8px" }}>
                      <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"16px", color:C.black }}>{medal(i)} {t.name}{t.is_active===false&&<ArchivedTag/>}</div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"22px", color:C.green, lineHeight:1 }}>${Math.round(t.rev).toLocaleString()}</div>
                        <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", textTransform:"none", marginBottom:"2px" }}>serviced</div>
                        {t.tips>0&&<div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"14px", color:C.gold }}>${t.tips.toFixed(0)} tips</div>}
                      </div>
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"6px" }}>
                      {[
                        { l:"Hours",    v:t.hrs.toFixed(1),             c:C.blue   },
                        { l:"Rev/hr",   v:`$${t.revPerHr.toFixed(0)}`,  c:C.purple },
                        { l:"Upsells",  v:`$${Math.round(t.ups)}`,      c:C.gold   },
                        { l:"Upsell %", v:`${t.upsellPct.toFixed(1)}%`, c:t.upsellPct>=10?C.green:C.red },
                      ].map(s=>(
                        <div key={s.l} style={{ background:C.white, borderRadius:"8px", padding:"6px", textAlign:"center" }}>
                          <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"14px", color:s.c }}>{s.v}</div>
                          <div style={{ fontSize:"11px", color:C.muted, textTransform:"none", letterSpacing:"-0.01em" }}>{s.l}</div>
                        </div>
                      ))}
                    </div>
                    {t.wkBreakdown?.length>0&&(
                      <div style={{ marginTop:"8px", borderTop:`1px solid ${C.border}`, paddingTop:"8px", display:"flex", flexDirection:"column", gap:"3px" }}>
                        {t.wkBreakdown.map(w=>(
                          <div key={w.wk} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"4px 8px", background:C.white, borderRadius:"8px" }}>
                            <div style={{ fontSize:"11px", color:C.muted, fontFamily:FONT, fontWeight:"700" }}>{formatWeekLabel(w.wk)} · {w.count} job{w.count!==1?"s":""}</div>
                            <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
                              <span style={{ fontFamily:FONT, fontWeight:"700", fontSize:"13px", color:C.green }}>${Math.round(w.rev).toLocaleString()}</span>
                              {w.tips>0&&<span style={{ fontFamily:FONT, fontWeight:"700", fontSize:"12px", color:C.gold }}>+${w.tips.toFixed(0)} tips</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}


    </div>
  );
}

// Payroll lists techs alphabetically by last name (then first), the same
// order as the payroll provider.
const lastNameKey = n => { const p = String(n||"").trim().split(/\s+/); return `${p.slice(1).join(" ") || p[0]} ${p[0]}`.toLowerCase(); };
const byLastName = (a,b) => lastNameKey(a.name).localeCompare(lastNameKey(b.name));
const byFirstName = (a,b) => String(a.name||"").trim().toLowerCase().localeCompare(String(b.name||"").trim().toLowerCase());
const PAYROLL_SORTS = { last:byLastName, first:byFirstName, revenue:(a,b) => b.revenue-a.revenue || byLastName(a,b) };

// Detail Apprentice training pay (owner's rules, Oct 2026): every hour
// clocked BEFORE a tech's first REAL job in HCP is a training hour. A real
// job has revenue and a customer who isn't on the team -- the test job a
// trainee does on Truxton's, Casey's or Will's car doesn't end training. $7.50/hr is
// paid in the pay period it was worked; another $7.50/hr is held and paid in
// the pay period holding their 90th day (start date + 90), if still active.
// From the day of their first job on, they're paid commission only.
const TRAINING_RATE_NOW = 7.5;
const TRAINING_RATE_HELD = 7.5;
const TRAINING_HELD_DAYS = 90;
const normName = s => String(s||"").toLowerCase().replace(/[^a-z]/g, "");
function isRealJob(j, staffNames) {
  if (!((j.revenue||0) > 0)) return false;
  const c = normName(j.customer_name);
  return !c || !staffNames.some(n => n && c.includes(n));
}
function trainingInfo(tech, jobs, timeEntries, techs=[]) {
  const staffNames = techs.map(t => normName(t.name)).filter(n => n.length >= 6);
  const myJobs = jobs.filter(j => j.tech_id===tech.id && j.job_date && isRealJob(j, staffNames));
  const firstJob = myJobs.length ? myJobs.reduce((m,j) => j.job_date < m ? j.job_date : m, myJobs[0].job_date) : null;
  const entries = timeEntries.filter(e => e.tech_id===tech.id && (!firstJob || e.work_date < firstJob));
  if (!entries.length) return null;
  const firstClock = entries.reduce((m,e) => e.work_date < m ? e.work_date : m, entries[0].work_date);
  const base = tech.start_date || firstClock;
  const d = new Date(base+"T12:00:00Z"); d.setUTCDate(d.getUTCDate()+TRAINING_HELD_DAYS);
  return { firstJob, entries, day90:d.toISOString().split("T")[0], totalHours:entries.reduce((s,e)=>s+paidSessionHours(e),0) };
}

// Crew labor for a date range (see laborCost.js for what counts): commission,
// upsell bonus (each pay period's tier rate on the upsells in range),
// switchover bonuses, training pay ($7.50/hr when worked, the held $7.50/hr
// on the day-90 date), times (1 + payroll tax rate). Tips are left out.
// Bonuses follow Payroll: only from the 10th/25th schedule on.
function laborEstimate({ techs, jobs, switchovers=[], timeEntries=[], start, end, techId=null, taxRate }) {
  const who = techId ? techs.filter(t=>t.id===techId) : techs;
  const commMap = Object.fromEntries(techs.map(t => [t.id, (t.commission_rate||27)/100]));
  const inRange = jobs.filter(j => j.job_date>=start && j.job_date<=end && (!techId || j.tech_id===techId));
  const revenue = inRange.reduce((s,j)=>s+(j.revenue||0),0);
  const commission = inRange.reduce((s,j)=>s+(j.revenue||0)*(commMap[j.tech_id]||0.27),0);
  let upsellBonus = 0;
  for (const p of getPayPeriods().filter(p=>p.start>=PP_SEMI_MONTHLY_FROM && p.start<=end && p.end>=start)) {
    const from = p.start>start?p.start:start, to = p.end<end?p.end:end;
    for (const t of who) {
      const amt = upsellAmountInRange(jobs, t.id, from, to);
      if (amt>0) upsellBonus += amt*calcUpsellPay(upsellAmountInRange(jobs, t.id, p.start, p.end)).rate;
    }
  }
  const switchBonus = switchovers.filter(sw=>(!techId||sw.tech_id===techId)&&switchoverDate(sw)>=PP_SEMI_MONTHLY_FROM&&switchoverDate(sw)>=start&&switchoverDate(sw)<=end).reduce((s,sw)=>s+(switchoverPay(sw)||0),0);
  let training = 0;
  for (const t of who) {
    const tr = trainingInfo(t, jobs, timeEntries, techs);
    if (!tr) continue;
    training += tr.entries.filter(e=>e.work_date>=start&&e.work_date<=end).reduce((s,e)=>s+paidSessionHours(e),0)*TRAINING_RATE_NOW;
    if (t.is_active!==false && tr.day90>=start && tr.day90<=end) training += tr.totalHours*TRAINING_RATE_HELD;
  }
  const wages = commission+upsellBonus+switchBonus+training;
  const taxes = wages*taxRate;
  const labor = wages+taxes;
  return { revenue, commission, upsellBonus, switchBonus, training, wages, taxes, labor, pct: revenue>0 ? labor/revenue*100 : 0 };
}

// ─── PAYROLL TAB ──────────────────────────────────────────────────────────────
function PayrollTab({ techs, jobs, tipEntries=[], switchovers=[], timeEntries=[], token=null, canWaive=false }) {
  const allPeriods = getPayPeriods();
  const activePeriods = allPeriods.filter(p=>jobs.some(j=>j.job_date>=p.start&&j.job_date<=p.end)||p.key===currentPPKey());
  const [selKey, setSelKey] = useState(currentPPKey());
  // Tote Checks since the 10th/25th schedule started: failed checks deduct
  // the missing items (auditScoring.js toteCharges), minus owner waivers.
  const [tote, setTote] = useState({ loading:true, error:null, subs:[], waivers:[] });
  const [toteBump, setToteBump] = useState(0);
  const [waiving, setWaiving] = useState(null);
  const [sortBy, setSortBy] = useState("last");
  useEffect(() => {
    let live = true;
    fetch(`/.netlify/functions/audit-scores?kind=tote&from=${PP_SEMI_MONTHLY_FROM}&to=${mtDateStr(Date.now())}`, { headers:{ Authorization:`Bearer ${token || ""}` } })
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; })
      .then(j => live && setTote({ loading:false, error:null, subs:j.submissions||[], waivers:j.tote_waivers||[] }))
      .catch(e => live && setTote(t => ({ ...t, loading:false, error:e.message })));
    return () => { live = false; };
  }, [token, toteBump]);
  async function setWaived(checkId, item, waived) {
    setWaiving(`${checkId}|${item}`);
    try {
      const r = await fetch("/.netlify/functions/audit-scores", { method:"POST", headers:{ Authorization:`Bearer ${token || ""}`, "Content-Type":"application/json" }, body:JSON.stringify({ submission_id:checkId, item, waived }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setToteBump(b => b+1);
    } catch(e) { window.alert("Couldn't save: "+e.message); }
    setWaiving(null);
  }
  const toteByTech = (() => {
    const waived = new Set(tote.waivers.map(w => `${w.submission_id}|${w.item}`));
    const byTech = {};
    tote.subs.filter(sb => sb.tech_id && formKind(sb.form_id)==="tote").forEach(sb => { (byTech[sb.tech_id] = byTech[sb.tech_id] || []).push(sb); });
    const out = {};
    for (const [id, subs] of Object.entries(byTech)) out[id] = toteCharges(latestPerDay(subs.map(sb => scoreToteCheck(sb)).filter(c => !c.excluded)), waived);
    return out;
  })();
  const period = allPeriods.find(p=>p.key===selKey) || allPeriods[0];
  if (!period) return null;

  const periodJobs = jobs.filter(j=>j.job_date>=period.start&&j.job_date<=period.end);
  // Upsell and switchover bonuses ride on payroll from the 10th/25th schedule
  // on; before that they were paid weekly and aren't shown here.
  const showBonuses = period.start >= PP_SEMI_MONTHLY_FROM;
  const wkKeys = [...new Set(periodJobs.map(j=>j.week_key))].filter(Boolean).sort();

  const rows = techs.map(t=>{
    const tj      = periodJobs.filter(j=>j.tech_id===t.id);
    const revenue = tj.reduce((s,j)=>s+(j.revenue||0),0);
    const tips    = tipsRangeTotal(tipEntries, t.id, period.start, period.end);
    const rate    = t.commission_rate||27;
    const commission = revenue*(rate/100);
    const upsellAmt = showBonuses ? upsellAmountInRange(periodJobs, t.id, period.start, period.end) : 0;
    const { totalPay:upsellPay, rate:upsellRate } = calcUpsellPay(upsellAmt);
    const sws = showBonuses ? switchovers.filter(sw=>sw.tech_id===t.id&&switchoverDate(sw)>=period.start&&switchoverDate(sw)<=period.end).sort((a,b)=>switchoverDate(a).localeCompare(switchoverDate(b))) : [];
    const switchPay = sws.reduce((s,sw)=>s+(switchoverPay(sw)||0),0);
    const switchUnpriced = sws.filter(sw=>switchoverPay(sw)==null).length;
    const toteAll = showBonuses ? (toteByTech[t.id] || []) : [];
    const toteHere = toteAll.filter(c=>c.check.work_date>=period.start&&c.check.work_date<=period.end);
    const toteCents = toteHere.reduce((s,c)=>s+c.chargedCents,0);
    const toteDeduct = toteCents/100;
    // Training pay (see trainingInfo above). Shown from the 10th/25th
    // schedule on; earlier training hours were paid outside the app.
    const tr = showBonuses ? trainingInfo(t, jobs, timeEntries, techs) : null;
    const trEntries = tr ? tr.entries.filter(e=>e.work_date>=period.start&&e.work_date<=period.end) : [];
    const trainingHours = trEntries.reduce((s,e)=>s+paidSessionHours(e),0);
    const trainingDays = [...new Set(trEntries.map(e=>e.work_date))].sort();
    const trainingPay = Math.round(trainingHours*TRAINING_RATE_NOW*100)/100;
    const heldDue = tr && t.is_active!==false && tr.day90>=period.start && tr.day90<=period.end ? Math.round(tr.totalHours*TRAINING_RATE_HELD*100)/100 : 0;
    const total   = commission+tips+upsellPay+switchPay-toteDeduct+trainingPay+heldDue;
    const weeks   = wkKeys.map(wk=>{
      const wj=tj.filter(j=>j.week_key===wk);
      const wkEndDate = new Date(wk+"T12:00:00Z"); wkEndDate.setUTCDate(wkEndDate.getUTCDate()+6);
      const wkEndStr = wkEndDate.toISOString().split("T")[0];
      const wkTips = tipsRangeTotal(tipEntries, t.id, wk, wkEndStr);
      return { wk, rev:wj.reduce((s,j)=>s+(j.revenue||0),0), tips:wkTips, count:wj.length };
    }).filter(w=>w.rev>0||w.tips>0);
    return { ...t, revenue, tips, rate, commission, upsellAmt, upsellPay, upsellRate, sws, switchPay, switchUnpriced, toteHere, toteDeduct, tr, trainingHours, trainingDays, trainingPay, heldDue, total, weeks };
  }).filter(r=>r.revenue>0||r.tips>0||r.upsellAmt>0||r.sws.length>0||r.toteHere.length>0||r.trainingHours>0||r.heldDue>0).sort(PAYROLL_SORTS[sortBy] || byLastName);

  const teamTotal = rows.reduce((s,r)=>s+r.total,0);

  function exportCSV() {
    const lines=["Tech,Revenue,Commission Rate,Commission,Tips,Upsells,Upsell Rate,Upsell Bonus,Switchovers,Switchover Bonus,Tote Deduction,Training Hours,Training Pay,90-Day Training Pay,Total Pay",...rows.map(r=>[r.name,`$${r.revenue.toFixed(2)}`,`${r.rate}%`,`$${r.commission.toFixed(2)}`,`$${r.tips.toFixed(2)}`,`$${r.upsellAmt.toFixed(2)}`,`${Math.round(r.upsellRate*100)}%`,`$${r.upsellPay.toFixed(2)}`,r.sws.length,`$${r.switchPay.toFixed(2)}`,`-$${r.toteDeduct.toFixed(2)}`,r.trainingHours.toFixed(2),`$${r.trainingPay.toFixed(2)}`,`$${r.heldDue.toFixed(2)}`,`$${r.total.toFixed(2)}`].join(","))].join("\n");
    const url=URL.createObjectURL(new Blob([lines],{type:"text/csv"}));
    const a=Object.assign(document.createElement("a"),{href:url,download:`skylo-payroll-${selKey}.csv`});
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>

      {/* Period selector */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px 18px" }}>
        <Label color={C.green}>💵 Pay Period</Label>
        <select value={selKey} onChange={e=>setSelKey(e.target.value)} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"10px 14px", borderRadius:"16px", fontSize:"14px", fontFamily:FONT, fontWeight:"700", width:"100%", cursor:"pointer", marginBottom:"12px" }}>
          {activePeriods.map(p=>(
            <option key={p.key} value={p.key}>{fmtShortDate(p.start)} – {fmtShortDate(p.end)}{p.key===currentPPKey()?" — Current":""}</option>
          ))}
        </select>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"8px" }}>
          {[
            { l:"Pay Period",  v:`${fmtShortDate(period.start)} – ${fmtShortDate(period.end)}` },
            { l:"Submit By",   v:fmtShortDate(period.submit) },
            { l:"Pay Date",    v:fmtShortDate(period.payout) },
          ].map(s=>(
            <div key={s.l} style={{ background:C.cardLt, borderRadius:"10px", padding:"8px 10px", textAlign:"center" }}>
              <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"14px", color:C.black }}>{s.v}</div>
              <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", textTransform:"none", marginTop:"2px" }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Sort */}
      <div style={{ display:"flex", alignItems:"center", gap:"8px", flexWrap:"wrap" }}>
        <span style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", textTransform:"none", fontFamily:FONT, fontWeight:"700" }}>Sort by</span>
        {[["last","Last name"],["first","First name"],["revenue","Serviced revenue"]].map(([id,label])=>(
          <button key={id} onClick={()=>setSortBy(id)} style={{ background:sortBy===id?C.blue:C.white, border:`1px solid ${sortBy===id?C.blue:C.border}`, color:sortBy===id?C.white:C.black, padding:"6px 12px", borderRadius:"16px", cursor:"pointer", fontSize:"12px", fontWeight:"700", fontFamily:FONT, letterSpacing:"-0.01em", textTransform:"none" }}>{label}</button>
        ))}
      </div>

      {/* Team total */}
      <div style={{ background:`${C.green}15`, border:`2px solid ${C.green}44`, borderRadius:"16px", padding:"16px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"13px", color:C.green, letterSpacing:"-0.01em" }}>Team total</div>
        <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"34px", color:C.black }}>${teamTotal.toFixed(2)}</div>
      </div>

      {showBonuses&&tote.error&&(
        <div style={{ background:`${C.red}10`, border:`1px solid ${C.red}`, borderRadius:"12px", padding:"12px", fontSize:"13px", color:C.red }}>Couldn't load tote checks, so tote deductions are NOT included below: {tote.error}</div>
      )}
      {rows.length===0?(
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"32px", textAlign:"center", color:C.muted, fontSize:"13px" }}>
          No jobs synced for this pay period yet. HCP sync runs every 5 min.
        </div>
      ):(
        <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
          {rows.map(r=>(
            <div key={r.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px 18px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"12px" }}>
                <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"20px", color:C.black }}>{r.name}{r.is_active===false&&<ArchivedTag/>}</div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"28px", color:C.green, lineHeight:1 }}>${r.total.toFixed(2)}</div>
                  <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em" }}>Total pay</div>
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"8px", marginBottom:r.weeks.length>1?"10px":0 }}>
                {[
                  { l:"Revenue",                v:`$${Math.round(r.revenue).toLocaleString()}`, c:C.blue  },
                  { l:`Commission (${r.rate}%)`, v:`$${r.commission.toFixed(2)}`,                c:C.green },
                  { l:"Tips",                   v:`$${r.tips.toFixed(2)}`,                      c:C.gold  },
                ].map(item=>(
                  <div key={item.l} style={{ background:C.cardLt, borderRadius:"10px", padding:"10px 12px" }}>
                    <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"18px", color:item.c }}>{item.v}</div>
                    <div style={{ fontSize:"11px", color:C.muted, marginTop:"3px" }}>{item.l}</div>
                  </div>
                ))}
              </div>
              {showBonuses&&(
                <div style={{ display:"flex", flexDirection:"column", gap:"6px", marginTop:"8px", marginBottom:r.weeks.length>1?"10px":0 }}>
                  {(r.trainingHours>0||r.heldDue>0)&&(
                    <div style={{ background:`${C.purple}0d`, border:`1px solid ${C.purple}33`, borderRadius:"10px", padding:"10px 12px" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"10px" }}>
                        <div style={{ fontSize:"11px", color:C.purple, letterSpacing:"-0.01em", textTransform:"none", fontFamily:FONT, fontWeight:"700" }}>🎓 Training Pay</div>
                        <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"18px", color:C.purple }}>${(r.trainingPay+r.heldDue).toFixed(2)}</div>
                      </div>
                      {r.trainingHours>0&&<div style={{ fontSize:"13px", color:C.black, marginTop:"4px" }}>{r.trainingHours.toFixed(2)} training hrs × ${TRAINING_RATE_NOW.toFixed(2)} = <strong>${r.trainingPay.toFixed(2)}</strong> <span style={{ fontSize:"11px", color:C.muted }}>({r.trainingDays.map(fmtShortDate).join(", ")})</span></div>}
                      {r.heldDue>0&&<div style={{ fontSize:"13px", color:C.black, marginTop:"4px" }}>90-day training pay due ({fmtShortDate(r.tr.day90)}): {r.tr.totalHours.toFixed(2)} hrs × ${TRAINING_RATE_HELD.toFixed(2)} = <strong>${r.heldDue.toFixed(2)}</strong></div>}
                      {r.trainingHours>0&&!r.heldDue&&r.tr&&<div style={{ fontSize:"11px", color:C.muted, marginTop:"3px" }}>Plus ${TRAINING_RATE_HELD.toFixed(2)}/hr held: ${(Math.round(r.tr.totalHours*TRAINING_RATE_HELD*100)/100).toFixed(2)} so far ({r.tr.totalHours.toFixed(2)} hrs), paid at 90 days ({fmtShortDate(r.tr.day90)}) if still active.{r.tr.firstJob ? ` Training ended with their first real job ${fmtShortDate(r.tr.firstJob)}.` : ""}</div>}
                    </div>
                  )}
                  <div style={{ background:C.cardLt, borderRadius:"10px", padding:"10px 12px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:"10px" }}>
                    <div>
                      <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", textTransform:"none", fontFamily:FONT, fontWeight:"700" }}>📈 Upsell Bonus</div>
                      <div style={{ fontSize:"13px", color:C.black, marginTop:"2px" }}>{r.upsellAmt>0 ? <>${r.upsellAmt.toFixed(2)} of upsells, {Math.round(r.upsellRate*100)}% is <strong>${r.upsellPay.toFixed(2)}</strong></> : "No upsells this pay period"}</div>
                    </div>
                    <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"18px", color:C.purple }}>${r.upsellPay.toFixed(2)}</div>
                  </div>
                  <div style={{ background:C.cardLt, borderRadius:"10px", padding:"10px 12px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"10px" }}>
                      <div>
                        <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", textTransform:"none", fontFamily:FONT, fontWeight:"700" }}>🔄 Switchover Bonus</div>
                        <div style={{ fontSize:"13px", color:C.black, marginTop:"2px" }}>{r.sws.length>0 ? `${r.sws.length} switchover${r.sws.length!==1?"s":""}` : "No switchovers this pay period"}</div>
                      </div>
                      <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"18px", color:C.purple }}>${r.switchPay.toFixed(2)}</div>
                    </div>
                    {r.sws.map(sw=>{
                      const pay = switchoverPay(sw), base = SWITCHOVER_PAY[sw.plan_id];
                      return (
                        <div key={sw.id} style={{ display:"flex", justifyContent:"space-between", gap:"8px", fontSize:"12px", color:C.black, borderTop:`1px solid ${C.border}`, marginTop:"6px", paddingTop:"6px" }}>
                          <span>{fmtShortDate(switchoverDate(sw))} · {PLAN_MAP[sw.plan_id]?.label||sw.plan_id} · {sw.with_exterior?"Interior + Exterior":"Interior only"}</span>
                          <span style={{ fontWeight:"700", color:pay==null?C.red:C.black, whiteSpace:"nowrap" }}>{pay==null ? "rate not set" : sw.with_exterior ? `$${base} + $${SWITCHOVER_EXTERIOR_PAY} = $${pay}` : `$${pay}`}</span>
                        </div>
                      );
                    })}
                    {r.switchUnpriced>0&&<div style={{ fontSize:"11px", color:C.red, marginTop:"6px" }}>⚠ {r.switchUnpriced} switchover{r.switchUnpriced!==1?"s":""} on a plan with no pay amount set — not included in the total.</div>}
                  </div>
                  {r.toteHere.length>0&&(
                    <div style={{ background:`${C.red}0d`, border:`1px solid ${C.red}33`, borderRadius:"10px", padding:"10px 12px" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"10px" }}>
                        <div>
                          <div style={{ fontSize:"11px", color:C.red, letterSpacing:"-0.01em", textTransform:"none", fontFamily:FONT, fontWeight:"700" }}>🧰 Tote Losses (failed checks)</div>
                          <div style={{ fontSize:"12px", color:C.muted, marginTop:"2px" }}>{r.toteHere.length} failed check{r.toteHere.length!==1?"s":""} {fmtShortDate(period.start)} – {fmtShortDate(period.end)}</div>
                        </div>
                        <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"18px", color:C.red }}>−${r.toteDeduct.toFixed(2)}</div>
                      </div>
                      {r.toteHere.map(c=>(
                        <div key={c.check.id} style={{ borderTop:`1px solid ${C.red}22`, marginTop:"6px", paddingTop:"6px" }}>
                          <div style={{ fontSize:"12px", color:C.black, fontWeight:"700" }}>{fmtShortDate(c.check.work_date)}{c.check.checkedBy?` · checked by ${c.check.checkedBy}`:""} · −{fmtCents(c.chargedCents)}</div>
                          {c.check.notes&&<div style={{ fontSize:"11px", color:C.muted, fontStyle:"normal", marginTop:"2px" }}>📝 {c.check.notes}</div>}
                          {c.items.map(it=>{
                            const key = `${c.check.id}|${it.name}`;
                            return (
                              <div key={it.name} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"8px", fontSize:"12px", marginTop:"3px" }}>
                                <span style={{ color:it.status==="charged"?C.black:C.muted, textDecoration:it.status==="charged"?"none":"line-through" }}>{it.name} · {fmtCents(it.cents)}</span>
                                <span style={{ display:"flex", alignItems:"center", gap:"6px", whiteSpace:"nowrap" }}>
                                  {it.status==="already"&&<span style={{ fontSize:"11px", color:C.muted }}>already charged</span>}
                                  {it.status==="waived"&&<span style={{ fontSize:"11px", color:C.muted }}>waived</span>}
                                  {canWaive&&it.status!=="already"&&(
                                    <button disabled={waiving===key} onClick={()=>setWaived(c.check.id, it.name, it.status!=="waived")} style={{ background:"none", border:`1px solid ${C.border}`, color:it.status==="waived"?C.blue:C.red, padding:"2px 8px", borderRadius:"8px", cursor:"pointer", fontSize:"11px", fontWeight:"700" }}>{waiving===key?"…":it.status==="waived"?"Undo":"Waive"}</button>
                                  )}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {r.weeks.length>1&&(
                <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:"10px" }}>
                  <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", textTransform:"none", marginBottom:"6px", fontFamily:FONT, fontWeight:"700" }}>Week Breakdown</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:"4px" }}>
                    {r.weeks.map(w=>(
                      <div key={w.wk} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:C.cardLt, borderRadius:"10px", padding:"6px 10px" }}>
                        <div style={{ fontSize:"12px", color:C.muted, fontFamily:FONT, fontWeight:"700" }}>{formatWeekLabel(w.wk)} · {w.count} job{w.count!==1?"s":""}</div>
                        <div style={{ display:"flex", gap:"10px", alignItems:"center" }}>
                          <span style={{ fontFamily:FONT, fontWeight:"700", fontSize:"13px", color:C.blue }}>${Math.round(w.rev).toLocaleString()}</span>
                          {w.tips>0&&<span style={{ fontFamily:FONT, fontWeight:"700", fontSize:"12px", color:C.gold }}>+${w.tips.toFixed(0)} tips</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <button onClick={exportCSV} style={{ background:C.blue, border:"none", color:C.white, padding:"13px", borderRadius:"16px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"13px", letterSpacing:"-0.01em", textTransform:"none" }}>
        📥 Export CSV — {fmtShortDate(period.start)} to {fmtShortDate(period.end)}
      </button>
    </div>
  );
}

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────
function Leaderboard({ techs, jobs, upsells, reviews, callbacks, switchovers, timeEntries=[] }) {
  const METRICS = [
    { id:"revenue",  label:"Revenue",    icon:"💰" },
    { id:"upsells",  label:"Upsells",    icon:"📈" },
    { id:"revhr",    label:"Rev / Hr",   icon:"⚡" },
    { id:"reviews",  label:"Reviews",    icon:"⭐" },
    { id:"pts",      label:"Points",     icon:"🏆" },
  ];
  const [metric, setMetric] = useState("revenue");
  const [rangePreset, setRangePreset] = useState("wtd");
  const [cStart, setCStart] = useState("");
  const [cEnd, setCEnd] = useState("");
  const { start, end } = getDateRangeBounds(rangePreset, cStart, cEnd);

  // Revenue, upsells and rev/hr use the exact range; reviews are logged by
  // month (any month the range touches); points are all-time.
  const rows = techs.map(t => {
    const revenue = jobs.filter(j=>j.tech_id===t.id&&j.job_date>=start&&j.job_date<=end).reduce((s,j)=>s+(j.revenue||0),0);
    const hours   = rangeHoursTotal(timeEntries, t.id, start, end);
    const ups     = upsellAmountInRange(jobs, t.id, start, end);
    const revs    = reviews.filter(r=>r.tech_id===t.id&&r.month_key>=start.slice(0,7)&&r.month_key<=end.slice(0,7)).reduce((s,r)=>s+r.count,0);
    const tt      = calcTotals(t,upsells,switchovers,reviews,callbacks||[],jobs);
    return { ...t, revenue, hours, revhr:hours>0?revenue/hours:0, ups, revs, pts:tt.total };
  });
  const key = { revenue:"revenue", upsells:"ups", revhr:"revhr", reviews:"revs", pts:"pts" }[metric];
  const sorted = rows.filter(r=>r[key]>0).sort((a,b)=>b[key]-a[key]);
  const fmt = r => {
    if (metric==="revenue") return { value:`$${Math.round(r.revenue).toLocaleString()}`, sub:r.hours>0?`${r.hours.toFixed(1)} hrs`:null };
    if (metric==="upsells") return { value:`$${Math.round(r.ups).toLocaleString()}`, chip:`${Math.round(r.ups*UPSELL_PTS_PER_DOLLAR).toLocaleString()} pts` };
    if (metric==="revhr")   return { value:`$${r.revhr.toFixed(0)}/hr`, sub:`$${Math.round(r.revenue).toLocaleString()} over ${r.hours.toFixed(1)} hrs` };
    if (metric==="reviews") return { value:`${r.revs} ⭐` };
    return { value:`${r.pts.toLocaleString()} pts`, sub:"all time" };
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
      <Segmented options={METRICS.map(m=>[m.id,`${m.icon} ${m.label}`])} value={metric} onChange={setMetric}/>
      {metric!=="pts"&&(
        <DateRangePicker label="📅 Date Range" preset={rangePreset} setPreset={setRangePreset} customStart={cStart} setCustomStart={setCStart} customEnd={cEnd} setCustomEnd={setCEnd}>
          <div style={{ fontSize:"12px", color:C.muted, marginTop:"8px" }}>{fmtShortDate(start)} – {fmtShortDate(end)}{metric==="reviews"?" · reviews are logged by month":""}</div>
        </DateRangePicker>
      )}
      <ListTitle right={metric==="pts"?"all time":null}>{METRICS.find(m=>m.id===metric).label}</ListTitle>
      <RankRows rows={sorted.map(r=>({ id:r.id, name:r.name, ...fmt(r) }))} empty="Nothing yet for this range."/>
    </div>
  );
}

// Apple-style segmented control. options: [[id, label], ...]
function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display:"flex", background:"rgba(118,118,128,0.12)", borderRadius:"10px", padding:"2px", overflowX:"auto", scrollbarWidth:"none" }}>
      {options.map(([id,label])=>{
        const on = id===value;
        return (
          <button key={id} onClick={()=>onChange(id)} style={{ flex:"1 0 auto", background:on?C.white:"transparent", border:"none", borderRadius:"8px", padding:"7px 12px", fontFamily:FONT, fontWeight:on?"600":"500", fontSize:"13px", color:C.black, cursor:"pointer", boxShadow:on?"0 1px 3px rgba(0,0,0,0.12)":"none", whiteSpace:"nowrap" }}>{label}</button>
        );
      })}
    </div>
  );
}

// ─── JOURNEY BOARD ────────────────────────────────────────────────────────────
function JourneyBoard({ techs, upsells, switchovers, reviews, quota, callbacks, jobs=[] }) {
  const [selected, setSelected] = useState(null);
  const mk = getMonthKey();
  const ranked = [...techs].map(t=>{
    const tt=calcTotals(t,upsells,switchovers,reviews,callbacks||[],jobs);
    const tier=getTier(tt.total);
    const nextTier=JOURNEY_TIERS.find(t2=>t2.minPts>tt.total);
    const ptsToNext=nextTier?nextTier.minPts-tt.total:0;
    const tierPct=nextTier?Math.round(((tt.total-tier.minPts)/(nextTier.minPts-tier.minPts))*100):100;
    const totalReviews=reviews.filter(r=>r.tech_id===t.id).reduce((s,r)=>s+r.count,0);
    const totalSwitches=switchovers.filter(s=>s.tech_id===t.id).length;
    // This month's actuals
    const monthUpsellAmt = (() => {
      const now = new Date(); const y = now.getFullYear(); const m = String(now.getMonth()+1).padStart(2,"0");
      const { start, end } = monthBounds(y, m);
      return upsellAmountInRange(jobs, t.id, start, end);
    })();
    const monthReviewCount = reviews.filter(r=>r.tech_id===t.id && r.month_key===mk).reduce((s,r)=>s+r.count,0);
    const monthSwitchCount = switchovers.filter(s=>s.tech_id===t.id && s.week_key && (() => { const now=new Date(); const y=now.getFullYear(); const m=String(now.getMonth()+1).padStart(2,"0"); return s.week_key.startsWith(`${y}-${m}`); })()).length;
    return {...t,...tt,tier,nextTier,ptsToNext,tierPct,totalReviews,totalSwitches,monthUpsellAmt,monthReviewCount,monthSwitchCount};
  }).sort((a,b)=>b.total-a.total);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"20px" }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:"12px" }}>
        {ranked.map((t,idx)=>(
          <JourneyCard key={t.id} tech={t} rank={idx+1} total={ranked.length} upsells={upsells} jobs={jobs}
            quota={quota||DEFAULT_QUOTA}
            onClick={()=>setSelected(selected===t.id?null:t.id)} expanded={selected===t.id}/>
        ))}
      </div>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px 18px" }}>
        <Label>Arena Tiers</Label>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:"8px" }}>
          {JOURNEY_TIERS.map(tier=>(
            <div key={tier.id} style={{ background:tier.bg, border:`1px solid ${tier.color}33`, borderLeft:`3px solid ${tier.color}`, borderRadius:"16px", padding:"12px" }}>
              <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"20px", color:tier.color, letterSpacing:"-0.01em" }}>{tier.icon} {tier.name}</div>
              <div style={{ fontSize:"11px", color:C.muted, fontFamily:FONT, marginBottom:"4px" }}>
                {tier.maxPts===Infinity?`${tier.minPts.toLocaleString()}+ pts`:`${tier.minPts.toLocaleString()} – ${tier.maxPts.toLocaleString()} pts`}
              </div>
              <div style={{ fontSize:"11px", color:tier.color, fontFamily:FONT, fontWeight:"700" }}>🎁 {tier.reward}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function JourneyCard({ tech, rank, total, onClick, expanded, upsells, quota, jobs=[] }) {
  const tier = tech.tier;
  const tenure = formatTenure(tech.start_date);
  const earnedBadges = ALL_BADGE_DEFS.filter(b=>tech.badges?.includes(b.id));
  const q = quota || DEFAULT_QUOTA;

  // Current pay period upsell bonus (tiers reset each pay period)
  const pp = currentPayPeriod();
  const weekUpsellAmt = pp ? upsellAmountInRange(jobs, tech.id, pp.start, pp.end) : 0;
  const { totalPay } = calcUpsellPay(weekUpsellAmt);
  const nextPayTier = getNextPayTier(weekUpsellAmt);

  // Month quota tracking
  const upPct     = Math.min(Math.round((tech.monthUpsellAmt / q.upsells) * 100), 100);
  const revPct    = Math.min(Math.round((tech.monthReviewCount / q.reviews) * 100), 100);
  const swPct     = Math.min(Math.round((tech.monthSwitchCount / q.switchovers) * 100), 100);
  const upHit     = tech.monthUpsellAmt >= q.upsells;
  const revHit    = tech.monthReviewCount >= q.reviews;
  const swHit     = tech.monthSwitchCount >= q.switchovers;
  const allHit    = upHit && revHit && swHit;
  const hitsCount = [upHit, revHit, swHit].filter(Boolean).length;

  return (
    <div onClick={onClick} style={{ background:C.white, border:`2px solid ${allHit ? "#34c759" : tier.color}44`, borderTop:`3px solid ${allHit ? "#34c759" : tier.color}`, borderRadius:"16px", cursor:"pointer", overflow:"hidden", boxShadow:"0 2px 10px rgba(0,0,0,0.06)" }}>
      <div style={{ padding:"16px 18px" }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:"14px" }}>
          <div>
            <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"22px", color:C.black, lineHeight:1 }}>{tech.name}</div>
            <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"13px", color:tier.color, letterSpacing:"-0.01em", marginTop:"3px" }}>{tier.icon} {tier.name} ARENA</div>
            {tenure&&<div style={{ fontSize:"11px", color:C.muted, marginTop:"3px" }}>⏱ {tenure} with Skylo</div>}
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"30px", color:C.blue, lineHeight:1 }}>{tech.total.toLocaleString()}</div>
            <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em" }}>PTS</div>
            <div style={{ fontSize:"11px", color:tier.color, fontFamily:FONT, fontWeight:"700", marginTop:"2px" }}>#{rank} of {total}</div>
          </div>
        </div>

        {/* ── MONTHLY QUOTA TRACKER ── */}
        <div style={{ background:allHit?`${C.green}12`:`${C.blue}08`, border:`1px solid ${allHit?C.green:C.border}`, borderRadius:"12px", padding:"12px 14px", marginBottom:"14px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"10px" }}>
            <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"12px", color:allHit?C.green:C.black, letterSpacing:"-0.01em", textTransform:"none" }}>
              {allHit ? "✅ QUOTA HIT THIS MONTH" : `📊 MONTHLY QUOTA — ${hitsCount}/3`}
            </div>
            <div style={{ fontSize:"11px", color:C.muted }}>{formatMonthLabel(getMonthKey())}</div>
          </div>
          {[
            { label:"Upsells",     actual:`$${tech.monthUpsellAmt}`,       target:`$${q.upsells}`,  pct:upPct,  hit:upHit,  color:C.green  },
            { label:"Reviews",     actual:tech.monthReviewCount,            target:q.reviews,        pct:revPct, hit:revHit, color:C.gold   },
            { label:"Switchovers", actual:tech.monthSwitchCount,            target:q.switchovers,    pct:swPct,  hit:swHit,  color:C.blue   },
          ].map(row=>(
            <div key={row.label} style={{ marginBottom:"8px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"3px" }}>
                <span style={{ fontSize:"11px", color:C.muted, fontFamily:FONT, fontWeight:"700" }}>{row.label}</span>
                <span style={{ fontSize:"11px", fontFamily:FONT, fontWeight:"700", color:row.hit?C.green:C.black }}>
                  {row.actual} <span style={{ color:C.muted, fontWeight:"600" }}>/ {row.target}</span>
                  {row.hit && <span style={{ color:C.green, marginLeft:"4px" }}>✓</span>}
                </span>
              </div>
              <div style={{ background:C.border, borderRadius:"8px", height:"5px", overflow:"hidden" }}>
                <div style={{ width:`${row.pct}%`, height:"100%", background:row.hit?C.green:row.color, borderRadius:"8px", transition:"width 0.3s" }}/>
              </div>
            </div>
          ))}
        </div>

        {tech.nextTier?(
          <div style={{ background:`${tier.color}12`, border:`1px solid ${tier.color}44`, borderRadius:"12px", padding:"12px 14px", marginBottom:"14px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"8px" }}>
              <div>
                <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"13px", color:tier.color, letterSpacing:"-0.01em" }}>🎯 WORKING TOWARD</div>
                <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"22px", color:C.black, lineHeight:1, marginTop:"2px" }}>{tech.nextTier.reward}</div>
              </div>
              <div style={{ textAlign:"right", flexShrink:0 }}>
                <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"22px", color:tier.color, lineHeight:1 }}>{tech.ptsToNext.toLocaleString()}</div>
                <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em" }}>Pts to go</div>
              </div>
            </div>
            <Bar pct={tech.tierPct} color={tier.color} h={7}/>
            <div style={{ fontSize:"11px", color:C.muted, marginTop:"5px" }}>{tech.tierPct}% of the way there · {tech.total.toLocaleString()} / {tech.nextTier.minPts.toLocaleString()} pts</div>
          </div>
        ):(
          <div style={{ marginBottom:"14px", background:`${tier.color}18`, border:`1px solid ${tier.color}44`, borderRadius:"10px", padding:"8px 12px", textAlign:"center" }}>
            <span style={{ fontFamily:FONT, fontWeight:"700", fontSize:"13px", color:tier.color, letterSpacing:"-0.01em" }}>💎 PLATINUM STATUS ACHIEVED</span>
          </div>
        )}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"6px" }}>
          {[
            {l:"Badges",   v:tech.badges?.length||0,        c:C.purple},
            {l:"Upsells",  v:`$${Math.round(tech.upsellAmt).toLocaleString()}`, c:C.green},
            {l:"Switchovers", v:tech.totalSwitches,        c:C.blue},
            {l:"Reviews",  v:tech.totalReviews,         c:C.gold},
          ].map(s=>(
            <div key={s.l} style={{ background:C.cardLt, borderRadius:"10px", padding:"8px 4px", textAlign:"center" }}>
              <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"16px", color:s.c }}>{s.v}</div>
              <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", textTransform:"none" }}>{s.l}</div>
            </div>
          ))}
        </div>
        {expanded&&(
          <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:"14px", marginTop:"14px", display:"flex", flexDirection:"column", gap:"12px" }}>
            
            {/* 💵 Weekly Pay Scale */}
            <div style={{ background:C.cardLt, borderRadius:"16px", padding:"12px 14px", border:`1px solid ${C.green}44` }}>
              <div style={{ fontSize:"11px", color:C.green, letterSpacing:"-0.01em", textTransform:"none", fontFamily:FONT, fontWeight:"700", fontStyle:"normal", marginBottom:"10px" }}>💵 Upsell Pay Scale{pp ? ` · ${fmtShortDate(pp.start)}–${fmtShortDate(pp.end)}` : ""}</div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:"10px" }}>
                <span style={{ fontSize:"12px", color:C.muted }}>Pay period upsells</span>
                <span style={{ fontFamily:FONT, fontWeight:"700", fontSize:"20px", color:C.black }}>${weekUpsellAmt.toLocaleString()}</span>
              </div>
              {/* Pay scale — backfill display */}
              <div style={{ display:"flex", flexDirection:"column", gap:"4px", marginBottom:"8px" }}>
                {(()=>{
                  const { rate } = calcUpsellPay(weekUpsellAmt);
                  const currentPct = Math.round(rate*100);
                  return UPSELL_PAY_TIERS.map((t,i)=>{
                    const b = { baseRate:Math.round(t.rate*100), label:t.label, ceil:UPSELL_PAY_TIERS[i+1]?.over ?? Infinity };
                    const isCurrent    = (i===0 || weekUpsellAmt > t.over) && (b.ceil===Infinity || weekUpsellAmt <= b.ceil);
                    const isPast       = b.ceil !== Infinity && weekUpsellAmt > b.ceil;
                    const isLocked     = i>0 && weekUpsellAmt <= t.over;
                    const backfilled   = isPast && currentPct > b.baseRate;
                    const displayRate  = isLocked ? b.baseRate : currentPct;
                    return (
                      <div key={b.label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:isCurrent?`${C.green}22`:isPast?`${C.green}08`:"transparent", border:isCurrent?`1px solid ${C.green}55`:"1px solid transparent", borderRadius:"10px", padding:"6px 10px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                          <span style={{ fontSize:"11px", color:isCurrent?C.green:isPast?C.black:C.muted, fontFamily:FONT, fontWeight:isCurrent?"900":"600" }}>{b.label}</span>
                          {isCurrent && <span style={{ fontSize:"11px", background:C.green, color:C.white, borderRadius:"10px", padding:"1px 7px", fontFamily:FONT, fontWeight:"700" }}>Your tier</span>}
                          {backfilled && <span style={{ fontSize:"11px", background:`${C.green}22`, color:C.green, borderRadius:"10px", padding:"1px 7px", fontFamily:FONT, fontWeight:"600" }}>↑ BACKFILLED</span>}
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:"5px" }}>
                          {backfilled && <span style={{ fontSize:"11px", color:C.muted, textDecoration:"line-through", fontFamily:FONT }}>{b.baseRate}%</span>}
                          <span style={{ fontSize:"13px", color:isLocked?C.muted:C.green, fontFamily:FONT, fontWeight:"700" }}>{displayRate}%</span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
              <div style={{ borderTop:`1px solid ${C.green}33`, paddingTop:"8px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:"12px", color:C.muted }}>Est. upsell bonus <span style={{ fontFamily:FONT, fontWeight:"600", color:C.black }}>({Math.round(calcUpsellPay(weekUpsellAmt).rate*100)}% × ${weekUpsellAmt})</span></span>
                <span style={{ fontFamily:FONT, fontWeight:"700", fontSize:"22px", color:C.green }}>${totalPay.toFixed(2)}</span>
              </div>
              {nextPayTier&&(
                <div style={{ marginTop:"8px", background:nextPayTier.amt===null?`${C.green}18`:`${C.gold}18`, border:`1px solid ${nextPayTier.amt===null?C.green:C.red}44`, borderRadius:"10px", padding:"6px 10px", fontSize:"11px", color:nextPayTier.amt===null?C.green:C.red, fontFamily:FONT, fontWeight:"700" }}>
                  {nextPayTier.amt===null
                    ? `🔥 ${nextPayTier.label}`
                    : `💡 Upsell $${nextPayTier.amt.toFixed(0)} more to unlock ${nextPayTier.label}`}
                </div>
              )}
            </div>

            <div>
              <Label color={tier.color}>Points Breakdown</Label>
              {[
                {l:"Badge Points",      v:tech.badgePts,   c:C.purple},
                {l:"Upsell Points",     v:tech.upsellPts,  c:C.green},
                {l:"Switchover Points", v:tech.switchPts,  c:C.blue},
                {l:"Review Points",     v:tech.reviewPts,  c:C.gold},
              ].map(item=>(
                <div key={item.l} style={{ display:"flex", justifyContent:"space-between", marginBottom:"6px" }}>
                  <span style={{ fontSize:"12px", color:C.muted }}>{item.l}</span>
                  <span style={{ fontFamily:FONT, fontWeight:"600", fontSize:"14px", color:item.c }}>{item.v.toLocaleString()}</span>
                </div>
              ))}
            </div>
            {tech.start_date&&(
              <div style={{ background:C.cardLt, borderRadius:"10px", padding:"10px 12px", display:"flex", justifyContent:"space-between" }}>
                <span style={{ fontSize:"12px", color:C.muted }}>Started</span>
                <span style={{ fontFamily:FONT, fontWeight:"700", fontSize:"13px", color:C.black }}>{new Date(tech.start_date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})} · {tenure}</span>
              </div>
            )}
            {earnedBadges.length>0&&(
              <div>
                <Label color={tier.color}>Badges</Label>
                <div style={{ display:"flex", flexWrap:"wrap", gap:"5px" }}>
                  {earnedBadges.map(b=>(
                    <span key={b.id} style={{ background:`${tier.color}18`, border:`1px solid ${tier.color}44`, borderRadius:"10px", padding:"3px 10px", fontSize:"11px", color:C.black, fontFamily:FONT, fontWeight:"700" }}>{b.icon} {b.name}</span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <Label color={tier.color}>Current Perks</Label>
              {tier.perks.map((p,i)=>(
                <div key={i} style={{ fontSize:"12px", color:C.black, display:"flex", alignItems:"center", gap:"6px", marginBottom:"4px" }}>
                  <span style={{ color:tier.color, fontWeight:"700" }}>✓</span>{p}
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ textAlign:"center", marginTop:"12px", fontSize:"11px", color:C.muted, letterSpacing:"-0.01em" }}>
          {expanded?"▲ COLLAPSE":"▼ EXPAND"}
        </div>
      </div>
    </div>
  );
}


// ─── STAFFING SETTINGS (trucks + holidays) ───────────────────────────────────
// Will's staffing KPI: every Mon-Sat workday that isn't a company holiday needs
// one scheduled tech per working truck; a full roster is trucks / 2 * 3.
const DEFAULT_TRUCK_COUNT = 12;
const DEFAULT_HOLIDAYS = ["2026-11-26","2026-11-27","2026-11-28","2026-12-24","2026-12-25","2026-12-26","2027-01-01"];
async function saveSetting(key, value) {
  const existing = await sb(`settings?key=eq.${key}&select=id`).catch(()=>[]);
  if (existing && existing.length > 0) await sb(`settings?id=eq.${existing[0].id}`,{method:"PATCH",body:JSON.stringify({value:JSON.stringify(value)}),prefer:"return=minimal"});
  else await sb("settings",{method:"POST",body:JSON.stringify({key,value:JSON.stringify(value)})});
}
function useStaffingSettings() {
  const [truckCount, setTruckCount] = useState(DEFAULT_TRUCK_COUNT);
  const [holidays, setHolidays] = useState(DEFAULT_HOLIDAYS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    sb("settings?key=in.(truck_count,holidays)&select=key,value").then(rows => {
      for (const r of rows||[]) {
        try {
          const v = JSON.parse(r.value);
          if (r.key==="truck_count" && Number.isFinite(v)) setTruckCount(v);
          if (r.key==="holidays" && Array.isArray(v)) setHolidays(v);
        } catch {}
      }
      setLoaded(true);
    }).catch(()=>setLoaded(true));
  }, []);
  return { truckCount, setTruckCount, holidays, setHolidays, loaded };
}
function StaffingSettings({ showToast=()=>{}, readOnly=false }) {
  const { truckCount, setTruckCount, holidays, setHolidays, loaded } = useStaffingSettings();
  const [newHoliday, setNewHoliday] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(nextTrucks, nextHolidays) {
    if (readOnly) return;
    setSaving(true);
    try {
      await saveSetting("truck_count", nextTrucks);
      await saveSetting("holidays", nextHolidays);
      setTruckCount(nextTrucks); setHolidays(nextHolidays);
      showToast("✅ Staffing settings saved");
    } catch(e) { showToast("Error saving: "+e.message,false); }
    setSaving(false);
  }
  const sorted = [...holidays].sort();
  const btn = { border:"none", borderRadius:"10px", padding:"6px 14px", cursor:saving?"not-allowed":"pointer", fontFamily:FONT, fontWeight:"600", fontSize:"13px" };
  return (
    <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"20px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
      <Label color={C.blue}>🚚 Trucks & Staffing</Label>
      {!loaded ? <div style={{ fontSize:"12px", color:C.muted }}>Loading…</div> : (<>
        <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"8px" }}>
          <span style={{ fontSize:"13px", color:C.black }}>Working trucks:</span>
          {!readOnly&&<button disabled={saving||truckCount<=1} onClick={()=>save(truckCount-1, holidays)} style={{ ...btn, background:C.cardLt, color:C.black }}>−</button>}
          <span style={{ fontFamily:FONT, fontWeight:"700", fontSize:"22px", color:C.black, minWidth:"28px", textAlign:"center" }}>{truckCount}</span>
          {!readOnly&&<button disabled={saving} onClick={()=>save(truckCount+1, holidays)} style={{ ...btn, background:C.cardLt, color:C.black }}>+</button>}
        </div>
        <div style={{ fontSize:"12px", color:C.muted, marginBottom:"16px" }}>
          Needs <strong style={{ color:C.black }}>{truckCount} techs scheduled</strong> every Mon–Sat workday · Fully staffed roster: <strong style={{ color:C.black }}>{Math.ceil(truckCount/2*3)} techs</strong> (trucks ÷ 2 × 3)
        </div>
        <div style={{ fontSize:"13px", color:C.black, marginBottom:"6px" }}>Company holidays (not counted as workdays):</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:"6px", marginBottom:"10px" }}>
          {sorted.map(d=>(
            <span key={d} style={{ background:C.cardLt, border:`1px solid ${C.border}`, borderRadius:"10px", padding:"3px 8px", fontSize:"12px", display:"inline-flex", alignItems:"center", gap:"6px" }}>
              {new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"})}
              {!readOnly&&<button disabled={saving} onClick={()=>save(truckCount, holidays.filter(h=>h!==d))} style={{ background:"none", border:"none", color:"#ff3b30", cursor:"pointer", fontSize:"13px", padding:0 }}>×</button>}
            </span>
          ))}
          {sorted.length===0&&<span style={{ fontSize:"12px", color:C.muted }}>None</span>}
        </div>
        {readOnly ? <div style={{ fontSize:"12px", color:C.muted, fontStyle:"normal" }}>Only an owner can change trucks or holidays.</div> :
        <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
          <input type="date" value={newHoliday} onChange={e=>setNewHoliday(e.target.value)} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"4px 8px", borderRadius:"8px", fontSize:"12px" }}/>
          <button disabled={saving||!newHoliday||holidays.includes(newHoliday)} onClick={()=>{ save(truckCount, [...holidays,newHoliday]); setNewHoliday(""); }} style={{ ...btn, background:C.blue, color:C.white }}>Add holiday</button>
        </div>}
      </>)}
    </div>
  );
}

// ─── KYLE BONUS + QUOTA SETTINGS ─────────────────────────────────────────────
function QuotaSettings({ quota, onSave, saving, readOnly=false }) {
  const [form, setForm] = useState({ ...quota });
  const inp = { background:C.white, border:`1px solid ${C.border}`, color:C.black, padding:"10px 14px", borderRadius:"10px", fontSize:"16px", fontFamily:FONT, fontWeight:"700", width:"100%", boxSizing:"border-box" };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"20px", display:"flex", flexDirection:"column", gap:"14px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
        <Label color={C.blue}>📋 Monthly Quota Targets</Label>
        <div style={{ fontSize:"13px", color:C.muted }}>Set the baseline expectation for each tech per month. These show up on every Journey card so techs always know what they're working toward.</div>
        {[
          { key:"upsells",     label:"Upsell Target",      icon:"💰", suffix:"$ / month",  desc:"Minimum upsell revenue expected per tech" },
          { key:"reviews",     label:"Review Target",       icon:"⭐", suffix:"reviews / month", desc:"Minimum Google reviews expected" },
          { key:"switchovers", label:"Switchover Target",   icon:"🔄", suffix:"switchovers / month", desc:"Minimum service plan conversions expected" },
        ].map(f=>(
          <div key={f.key}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"6px" }}>
              <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"14px", color:C.black }}>{f.icon} {f.label}</div>
              <div style={{ fontSize:"11px", color:C.muted }}>{f.desc}</div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
              <input type="number" value={form[f.key]} min={0} disabled={readOnly}
                onChange={e=>setForm(v=>({...v,[f.key]:Number(e.target.value)}))}
                style={inp}/>
              <span style={{ fontSize:"12px", color:C.muted, whiteSpace:"nowrap", fontFamily:FONT }}>{f.suffix}</span>
            </div>
          </div>
        ))}
        {readOnly ? (
          <div style={{ fontSize:"12px", color:C.muted, fontStyle:"normal" }}>Only an owner can change quota targets.</div>
        ) : (
        <button disabled={saving} onClick={()=>onSave(form)}
          style={{ background:saving?C.border:C.blue, border:"none", color:C.white, padding:"13px", borderRadius:"24px", cursor:saving?"not-allowed":"pointer", fontSize:"14px", fontWeight:"700", fontStyle:"normal", letterSpacing:"-0.01em", fontFamily:FONT, textTransform:"none" }}>
          {saving?"Saving...":"Save Quota Targets"}
        </button>
        )}
      </div>
      <div style={{ background:`${C.blue}10`, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px 18px" }}>
        <Label color={C.blue}>💡 How these feed Will's bonus</Label>
        <div style={{ fontSize:"13px", color:C.black }}>These are the per-tech monthly targets for the quota bonus. Will is paid a flat amount by the share of counted techs who hit all three (60% → $200, 70% → $300, 85% → $400, 100% → $500). See Operations Progress for all four of his bonuses.</div>
      </div>
    </div>
  );
}

// Will's (Field Supervisor) bonus page: staffing (the gate), callback rate,
// quota and quarterly retention. All the math lives in opsBonus.js so the
// month-end snapshot function computes the same numbers as this page.
// Past months show the saved snapshot when there is one; owners can re-save
// after fixing data, but the Field Supervisor can only view.
function opsMonthOptions(today) {
  const out = [];
  let [y, m] = today.slice(0,7).split("-").map(Number);
  while (y > 2026 || (y === 2026 && m >= 9)) {
    out.push(`${y}-${String(m).padStart(2,"0")}`);
    m -= 1; if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}
const OPS_LEAVE_LABEL = { fired:"Fired", quit_notice:"Quit w/ notice", walked_off:"Walked off" };
const money = n => `$${Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2})}`;

function OpsCard({ title, color, pay, status, statusColor, children }) {
  return (
    <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"18px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:"10px", marginBottom:"10px" }}>
        <Label color={color}>{title}</Label>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"24px", color:pay>0?C.green:C.muted, lineHeight:1 }}>{money(pay)}</div>
          {status && <div style={{ fontSize:"11px", fontWeight:"600", letterSpacing:"-0.01em", color:statusColor||C.muted, marginTop:"3px" }}>{status}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}
function TierTable({ tiers, activeLabel, suffix="" }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"3px", marginTop:"10px" }}>
      {tiers.map(t=>{
        const on = t.label===activeLabel;
        return (
          <div key={t.label} style={{ display:"flex", justifyContent:"space-between", fontSize:"12px", padding:"4px 8px", borderRadius:"10px", background:on?`${C.green}18`:C.cardLt, border:`1px solid ${on?C.green:"transparent"}`, color:C.black, fontWeight:on?"800":"400" }}>
            <span>{on?"▶ ":""}{t.label}</span><span>{money(t.pay)}{suffix}</span>
          </div>
        );
      })}
    </div>
  );
}
const statLine = { fontSize:"12px", color:C.muted, marginTop:"4px" };
const bigNum = { fontFamily:FONT, fontWeight:"700", fontSize:"32px", color:C.black, lineHeight:1 };

function OperationsProgressTab({ techs, switchovers, reviews, quota, callbacks=[], jobs=[], isManager=false }) {
  const today = mountainDate(new Date().toISOString());
  const months = opsMonthOptions(today);
  const [monthKey, setMonthKey] = useState(months[0]);
  const { truckCount, holidays, loaded:settingsLoaded } = useStaffingSettings();
  const [schedule, setSchedule] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [snapshots, setSnapshots] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [showLive, setShowLive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const loadExtras = useCallback(async () => {
    const [sch, exc, snaps] = await Promise.all([
      sb("tech_schedule?select=*").catch(()=>[]),
      sb("schedule_exceptions?select=*").catch(()=>[]),
      sb("ops_monthly_results?select=*").catch(()=>[]),
    ]);
    setSchedule(sch||[]); setExceptions(exc||[]);
    setSnapshots(Object.fromEntries((snaps||[]).map(s=>[s.month_key,s])));
    setLoaded(true);
  }, []);
  useEffect(() => { loadExtras(); }, [loadExtras]);

  const live = (loaded && settingsLoaded) ? computeOpsMonth({
    monthKey, today, techs, jobs, reviews, switchovers, callbacks, quota,
    schedule, exceptions, truckCount, holidays,
  }) : null;
  const monthOver = monthRange(monthKey).end < today;
  const snap = snapshots[monthKey];
  const r = (monthOver && snap && !showLive) ? snap.results : live;

  async function saveSnapshot() {
    if (isManager || !live) return;
    setSaving(true);
    try {
      await sb("ops_monthly_results?on_conflict=month_key",{ method:"POST", prefer:"resolution=merge-duplicates,return=minimal",
        body: JSON.stringify({ month_key:monthKey, results:live, saved_at:new Date().toISOString(), saved_by:"owner" }) });
      await loadExtras(); setShowLive(false);
      setMsg(`✅ Saved ${formatMonthLabel(monthKey)} results`);
    } catch(e) { setMsg("Error saving: "+e.message); }
    setSaving(false);
  }

  if (!r) return <div style={{ fontSize:"13px", color:C.muted, padding:"20px" }}>Loading…</div>;
  const { staffing:st, callbacks:cb, quota:qt, retention:rt } = r;
  const gateNote = !r.gateOpen ? "Voided — staffing was missed this month" : null;
  const statusMap = {
    earned:{ text:"✅ EARNED", color:C.green }, on_track:{ text:"ON TRACK", color:C.green },
    at_risk:{ text:"⚠️ SHORT DAYS AHEAD", color:C.gold }, missed:{ text:"❌ MISSED", color:"#ff3b30" },
  };
  const stStatus = statusMap[st.status] || statusMap.on_track;
  const inProgress = !monthOver;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      {/* Month picker + total */}
      <div style={{ background:r.gateOpen?C.white:"#fff5f5", border:`2px solid ${r.gateOpen?C.border:"#ff3b30"}`, borderTop:`3px solid ${r.gateOpen?C.blue:"#ff3b30"}`, borderRadius:"16px", padding:"18px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:"10px" }}>
          <div>
            <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"13px", color:C.muted, letterSpacing:"-0.01em" }}>Will's operations bonus</div>
            <select value={monthKey} onChange={e=>{ setMonthKey(e.target.value); setShowLive(false); setMsg(null); }}
              style={{ marginTop:"6px", maxWidth:"100%", background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"6px 10px", borderRadius:"10px", fontSize:"15px", fontFamily:FONT, fontWeight:"600" }}>
              {months.map(m=><option key={m} value={m}>{formatMonthLabel(m)}{m==="2026-09"?" (preview — plan starts Oct)":""}</option>)}
            </select>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"36px", color:r.totalPay>0?C.green:C.black, lineHeight:1 }}>{money(r.totalPay)}</div>
            <div style={{ fontSize:"11px", color:C.muted }}>{inProgress?"projected so far":"for the month"}{r.isQuarterEnd?` · includes ${rt.quarter.label} retention`:""}</div>
          </div>
        </div>
        {!r.gateOpen && <div style={{ marginTop:"10px", fontSize:"13px", color:"#ff3b30", fontWeight:"700" }}>Staffing was short on {st.missedDays.length} day{st.missedDays.length!==1?"s":""}, so this month's callback and quota bonuses are voided.</div>}
        <div style={{ display:"flex", gap:"10px", alignItems:"center", marginTop:"10px", flexWrap:"wrap", fontSize:"12px", color:C.muted }}>
          {monthOver && snap && <span>Saved {new Date(snap.saved_at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}{showLive?" · showing live numbers":""}</span>}
          {monthOver && !snap && <span>Not saved yet — showing live numbers</span>}
          {monthOver && snap && <button onClick={()=>setShowLive(v=>!v)} style={{ background:"none", border:`1px solid ${C.border}`, color:C.blue, padding:"3px 10px", borderRadius:"10px", cursor:"pointer", fontSize:"11px", fontWeight:"700" }}>{showLive?"Show saved":"Show live"}</button>}
          {monthOver && !isManager && <button onClick={saveSnapshot} disabled={saving} style={{ background:C.blue, border:"none", color:C.white, padding:"4px 12px", borderRadius:"10px", cursor:saving?"not-allowed":"pointer", fontSize:"11px", fontWeight:"600" }}>{saving?"Saving…":snap?"Recalculate & save":"Save results"}</button>}
          {msg && <span style={{ color:C.black }}>{msg}</span>}
        </div>
      </div>

      {/* 1. Staffing */}
      <OpsCard title="🚚 Staffing — the gate" color={C.blue} pay={st.pay} status={stStatus.text} statusColor={stStatus.color}>
        <div style={{ fontSize:"13px", color:C.black }}>Needs <strong>{st.days[0]?.needed ?? truckCount} techs</strong> scheduled on the trucks every Mon–Sat workday. One short day misses the month and voids the callback and quota bonuses.</div>
        <div style={statLine}>Full roster target: {st.rosterTarget} techs (trucks ÷ 2 × 3) · Holidays skipped</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(64px,1fr))", gap:"4px", marginTop:"12px" }}>
          {st.days.map(d=>{
            const bg = d.short ? (d.past ? "#ff3b30" : C.gold) : (d.past ? C.green : `${C.green}55`);
            return (
              <div key={d.date} title={`${d.scheduled} of ${d.needed} scheduled`} style={{ background:bg, color:C.white, borderRadius:"10px", padding:"4px", textAlign:"center", fontSize:"11px", fontWeight:"600" }}>
                <div>{new Date(d.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",day:"numeric"})}</div>
                <div style={{ fontSize:"12px" }}>{d.scheduled}/{d.needed}</div>
              </div>
            );
          })}
        </div>
        {st.missedDays.length>0 && <div style={{ ...statLine, color:"#ff3b30", fontWeight:"700" }}>Short: {st.missedDays.map(d=>`${fmtShortDate(d.date)} (${d.scheduled}/${d.needed})`).join(", ")}</div>}
        {st.upcomingShort.length>0 && <div style={{ ...statLine, color:C.gold, fontWeight:"700" }}>Coming up short: {st.upcomingShort.map(d=>`${fmtShortDate(d.date)} (${d.scheduled}/${d.needed})`).join(", ")}</div>}
        <div style={statLine}>Based on the Work Schedule tab plus any time off or extra days entered there.</div>
      </OpsCard>

      {/* 2. Callback rate */}
      <OpsCard title="📞 Callback Rate" color="#ff3b30" pay={r.gateOpen?cb.pay:0} status={gateNote || (cb.tier?cb.tier.label:"2.00%+ — no bonus")} statusColor={gateNote?"#ff3b30":cb.tier?C.green:C.muted}>
        <div style={{ display:"flex", alignItems:"baseline", gap:"10px" }}>
          <div style={bigNum}>{cb.rate.toFixed(2)}%</div>
          <div style={{ fontSize:"13px", color:C.muted }}>{cb.count} callback{cb.count!==1?"s":""} ÷ {cb.jobCount} jobs</div>
        </div>
        <div style={statLine}>Standard is 2%. Split-job callbacks count ½ per tech.</div>
        <TierTable tiers={CALLBACK_TIERS} activeLabel={cb.tier?.label}/>
        {inProgress && cb.jobCount>0 && (
          <div style={{ ...statLine, color:C.black }}>
            At {cb.jobCount} jobs so far: {cb.allowance.map(a=>`≤${a.maxCallbacks} for ${money(a.pay)}`).join(" · ")}
          </div>
        )}
      </OpsCard>

      {/* 3. Quota */}
      <OpsCard title="📋 Team Quota" color={C.green} pay={r.gateOpen?qt.pay:0} status={gateNote || (qt.tier?`${qt.tier.label} tier`:"Under 60% — no bonus")} statusColor={gateNote?"#ff3b30":qt.tier?C.green:C.muted}>
        <div style={{ display:"flex", alignItems:"baseline", gap:"10px" }}>
          <div style={bigNum}>{qt.pct.toFixed(2)}%</div>
          <div style={{ fontSize:"13px", color:C.muted }}>{qt.hitting} of {qt.counted} counted techs hit all 3</div>
        </div>
        <div style={statLine}>Targets: {money(quota?.upsells??400)} upsells · {quota?.reviews??6} Google 5-star reviews · {quota?.switchovers??1} switchover (Zak: $300 · 4 · 1)</div>
        {qt.nextTier && qt.counted>0 && <div style={{ ...statLine, color:C.black, fontWeight:"700" }}>{qt.neededForNext} more tech{qt.neededForNext!==1?"s":""} hitting quota → {qt.nextTier.label} ({money(qt.nextTier.pay)})</div>}
        <TierTable tiers={QUOTA_TIERS} activeLabel={qt.tier?.label}/>
        <div style={{ display:"flex", flexDirection:"column", gap:"6px", marginTop:"14px" }}>
          {qt.rows.map(t=>(
            <div key={t.id} style={{ background:t.allHit?`${C.green}10`:C.cardLt, border:`1px solid ${t.allHit?C.green:C.border}`, borderRadius:"10px", padding:"8px 10px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"6px" }}>
                <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"15px", color:C.black }}>
                  {t.name}
                  {t.prorated && <span style={{ fontSize:"11px", color:C.gold, marginLeft:"6px" }}>LEFT {fmtShortDate(t.left_date).toUpperCase()} · {t.prorated}-WEEK TARGETS</span>}
                  {!t.prorated && t.left_date && <span style={{ fontSize:"11px", color:C.gold, marginLeft:"6px" }}>LEFT {fmtShortDate(t.left_date).toUpperCase()}</span>}
                </div>
                <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"13px", color:t.allHit?C.green:C.muted }}>{t.allHit?"✅ ALL HIT":`${t.hitsCount}/3`}</div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"4px" }}>
                {[
                  { label:"Upsells", val:money(t.upsells), target:money(t.targets.upsells), hit:t.upHit },
                  { label:"Reviews", val:t.reviews, target:t.targets.reviews, hit:t.revHit },
                  { label:"Switchovers", val:t.switchovers, target:t.targets.switchovers, hit:t.swHit },
                ].map(col=>(
                  <div key={col.label} style={{ background:col.hit?`${C.green}15`:C.white, border:`1px solid ${col.hit?C.green:C.border}`, borderRadius:"10px", padding:"4px 6px", textAlign:"center" }}>
                    <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"14px", color:col.hit?C.green:C.black }}>{col.val}{col.hit?" ✓":""}</div>
                    <div style={{ fontSize:"11px", color:C.muted, textTransform:"none", letterSpacing:"-0.01em" }}>{col.label} / {col.target}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {qt.rows.length===0 && <div style={{ fontSize:"12px", color:C.muted }}>No counted techs this month.</div>}
        </div>
        {qt.ramping.length>0 && (
          <div style={{ marginTop:"12px", fontSize:"12px", color:C.muted }}>
            <strong style={{ color:C.black }}>Not counted this month:</strong> {qt.ramping.map(t=>`${t.name} (${t.reason})`).join(" · ")}
          </div>
        )}
        {qt.leftEarly.length>0 && (
          <div style={{ marginTop:"6px", fontSize:"12px", color:C.muted }}>
            <strong style={{ color:C.black }}>Left with under 4 workdays (not counted):</strong> {qt.leftEarly.map(t=>`${t.name} (${fmtShortDate(t.left_date)})`).join(" · ")}
          </div>
        )}
        <div style={statLine}>Counts once a tech's first paid job is on or before the 2nd of the month. Commercial, sales, owners and Will aren't counted.</div>
      </OpsCard>

      {/* 4. Retention */}
      <OpsCard title={`🤝 Retention — ${rt.quarter.label}`} color={C.purple} pay={rt.pay}
        status={rt.quarterOver?"FOR THE QUARTER":"PROJECTED · PAID AT QUARTER END"} statusColor={rt.quarterOver?C.green:C.muted}>
        <div style={{ display:"flex", alignItems:"baseline", gap:"10px" }}>
          <div style={bigNum}>{rt.baseCount>0?`${rt.pct.toFixed(2)}%`:"—"}</div>
          <div style={{ fontSize:"13px", color:C.muted }}>{rt.baseCount} techs past 90 days on {fmtShortDate(rt.quarter.start)} · {rt.losses} regrettable loss{rt.losses!==1?"es":""}</div>
        </div>
        <div style={statLine}>Owner-approved firings are left out. Quits, walk-offs and unapproved firings count as losses. Pays the tier × 3 for the quarter.</div>
        <TierTable tiers={RETENTION_TIERS} activeLabel={rt.tier?.label} suffix=" × 3"/>
        <div style={{ marginTop:"12px", display:"flex", flexDirection:"column", gap:"6px", fontSize:"12px", color:C.black }}>
          <div><strong>Regrettable (counts against Will):</strong> {rt.regrettable.length ? rt.regrettable.map(t=>`${t.name} — ${OPS_LEAVE_LABEL[t.leave_reason]||"left"} ${t.left_date?fmtShortDate(t.left_date):""}${t.leave_reason==="fired"?(t.fire_approval==="denied"?" (firing denied)":" (firing not approved yet)"):""}`).join(" · ") : "None"}</div>
          <div><strong>Non-regrettable (approved firings):</strong> {rt.approvedFires.length ? rt.approvedFires.map(t=>`${t.name} — ${fmtShortDate(t.left_date)}`).join(" · ") : "None"}</div>
          {rt.pendingFires.length>0 && <div style={{ color:C.gold, fontWeight:"700" }}>Waiting for owner approval: {rt.pendingFires.map(t=>t.name).join(", ")} — counted as losses until approved</div>}
        </div>
        <div style={{ marginTop:"14px", paddingTop:"12px", borderTop:`1px solid ${C.border}` }}>
          <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"14px", color:C.black }}>
            New hires reaching 90 days: {rt.newHires.pct==null?"—":`${rt.newHires.pct.toFixed(0)}%`}{rt.newHires.rating?` · ${rt.newHires.rating}`:""}
            <span style={{ fontSize:"11px", color:C.muted, fontWeight:"600", marginLeft:"6px" }}>tracked, not paid</span>
          </div>
          <div style={statLine}>90%+ excellent · 80–89.99% great · 70–79.99% average · under 70% underperforming</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:"4px", marginTop:"8px" }}>
            {rt.newHires.cohort.map(c=>(
              <span key={c.id} style={{ fontSize:"11px", padding:"3px 8px", borderRadius:"12px", background:c.status==="made_it"?`${C.green}20`:c.status==="left"?"#ef444420":C.cardLt, color:C.black }}>
                {c.name} · {c.status==="made_it"?"made 90 days":c.status==="left"?`left ${fmtShortDate(c.left_date)}`:`day 90 on ${fmtShortDate(c.day90)}`}
              </span>
            ))}
            {rt.newHires.cohort.length===0 && <span style={{ fontSize:"12px", color:C.muted }}>No new hires hit day 90 this quarter.</span>}
          </div>
        </div>
      </OpsCard>
    </div>
  );
}

// ─── WORK SCHEDULE ───────────────────────────────────────────────────────────
// Each tech's regular Mon–Sat days and vehicle, plus one-off time off / extra
// days. Feeds the staffing check in Operations Progress. BB (commercial) and
// AUX (Zak's backup truck) are on the schedule but don't count toward staffing.
// Rows are grouped into pods (techs who share trucks) and colored by crew,
// which is worked out from the days each tech works -- nothing to maintain.
const SCHEDULE_DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat"];
const SCHEDULE_VEHICLES = ["Mav 1","Mav 2","Mav 3","Mav 4","Mav 5","Mav 6","Mav 7","Mav 8","Mav 9","Mav 10","Mav 11","Van 3","Van 5","BB","AUX"];
const CREWS = [
  { id:"red",    label:"Red crew",   days:"1235", color:"#e53935" },
  { id:"blue",   label:"Blue crew",  days:"3456", color:"#1e40af" },
  { id:"green",  label:"Green crew", days:"1246", color:"#16a34a" },
  { id:"other",  label:"Other days", days:null,   color:"#005fb0" },
  { id:"bb",     label:"BB (commercial)", days:null, color:"#0077d4" },
  { id:"aux",    label:"AUX (backup)",    days:null, color:"#64748b" },
];
const CREW_BY_ID = Object.fromEntries(CREWS.map(c=>[c.id,c]));
function crewFor(rows) {
  if (!rows.length) return null;
  if (rows.every(r=>r.vehicle==="BB")) return CREW_BY_ID.bb;
  if (rows.every(r=>r.vehicle==="AUX")) return CREW_BY_ID.aux;
  const days = rows.map(r=>r.weekday).sort().join("");
  return CREWS.find(c=>c.days===days) || CREW_BY_ID.other;
}
const vehicleSortKey = v => { const m=/^(Mav|Van)\s*(\d+)/i.exec(v||""); return m ? (m[1].toLowerCase()==="mav"?0:100)+Number(m[2]) : 500; };
// Pods = techs connected by sharing a vehicle on any day (e.g. Logan, Trey and
// Milos all rotate through Mav 1 and Mav 2).
function schedulePods(active, rows) {
  const parent = {}; const find = x => parent[x]===x ? x : (parent[x]=find(parent[x]));
  active.forEach(t=>parent[t.id]=t.id);
  const byVehicle = {};
  rows.forEach(r=>{ if (parent[r.tech_id]===undefined) return; (byVehicle[r.vehicle]=byVehicle[r.vehicle]||[]).push(r.tech_id); });
  Object.entries(byVehicle).forEach(([v,ids])=>{ if (v==="BB"||v==="AUX") return; ids.forEach(id=>{ parent[find(id)]=find(ids[0]); }); });
  const groups = {};
  active.forEach(t=>{ (groups[find(t.id)]=groups[find(t.id)]||[]).push(t); });
  const crewOrder = { red:0, blue:1, green:2, other:3, bb:4, aux:5 };
  const pods = Object.values(groups).map(ts=>{
    const mine = rows.filter(r=>ts.some(t=>t.id===r.tech_id));
    const key = mine.length ? Math.min(...mine.map(r=>vehicleSortKey(r.vehicle))) : 9999;
    const members = ts.map(t=>({ t, crew: crewFor(rows.filter(r=>r.tech_id===t.id)) }))
      .sort((x,y)=>(crewOrder[x.crew?.id]??9)-(crewOrder[y.crew?.id]??9) || x.t.name.localeCompare(y.t.name));
    return { key, members, scheduled: mine.length>0 };
  });
  const scheduled = pods.filter(p=>p.scheduled).sort((x,y)=>x.key-y.key);
  const unscheduled = pods.filter(p=>!p.scheduled).flatMap(p=>p.members).sort((x,y)=>x.t.name.localeCompare(y.t.name));
  return unscheduled.length ? [...scheduled, { key:99999, members:unscheduled, scheduled:false }] : scheduled;
}
function WorkScheduleTab({ techs, showToast=()=>{} }) {
  const { truckCount, holidays } = useStaffingSettings();
  const [rows, setRows] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [exForm, setExForm] = useState({ tech_id:"", date:"", kind:"off", note:"" });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);   // {techId, wd} with a dropdown open
  const [swapMode, setSwapMode] = useState(false);
  const [swapFirst, setSwapFirst] = useState(null); // {techId, wd}
  const load = useCallback(async () => {
    const [sch, exc] = await Promise.all([
      sb("tech_schedule?select=*").catch(()=>[]),
      sb("schedule_exceptions?select=*&order=date.asc").catch(()=>[]),
    ]);
    setRows(sch||[]); setExceptions(exc||[]); setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  const active = techs.filter(t => t.is_active !== false && t.title !== "owner");
  const cell = (techId, wd) => rows.find(r => r.tech_id===techId && r.weekday===wd);
  async function writeCell(techId, wd, vehicle) {
    if (!vehicle) await sb(`tech_schedule?tech_id=eq.${techId}&weekday=eq.${wd}`, { method:"DELETE", prefer:"return=minimal" });
    else await sb("tech_schedule?on_conflict=tech_id,weekday", { method:"POST", prefer:"resolution=merge-duplicates,return=minimal", body: JSON.stringify({ tech_id:techId, weekday:wd, vehicle }) });
  }
  async function setCell(techId, wd, vehicle) {
    setEditing(null);
    if ((cell(techId,wd)?.vehicle||"") === (vehicle||"")) return;
    setBusy(true);
    try { await writeCell(techId, wd, vehicle); await load(); }
    catch(e) { showToast("Error saving schedule: "+e.message, false); }
    setBusy(false);
  }
  async function tapCell(techId, wd) {
    if (busy) return;
    if (!swapMode) { setEditing({ techId, wd }); return; }
    if (!swapFirst) { setSwapFirst({ techId, wd }); return; }
    const a = swapFirst, b = { techId, wd };
    setSwapFirst(null);
    if (a.techId===b.techId && a.wd===b.wd) return;
    const va = cell(a.techId,a.wd)?.vehicle||"", vb = cell(b.techId,b.wd)?.vehicle||"";
    if (va===vb) return;
    setBusy(true);
    try {
      await writeCell(a.techId, a.wd, vb);
      await writeCell(b.techId, b.wd, va);
      await load();
      const n = id => techs.find(t=>t.id===id)?.name?.split(" ")[0] || "?";
      showToast(`🔁 Swapped ${n(a.techId)} ${SCHEDULE_DAYS[a.wd-1]} ↔ ${n(b.techId)} ${SCHEDULE_DAYS[b.wd-1]}`);
    } catch(e) { showToast("Error swapping: "+e.message, false); }
    setBusy(false);
  }
  async function addException() {
    if (!exForm.tech_id || !exForm.date) return showToast("Pick a tech and a date", false);
    setBusy(true);
    try {
      await sb("schedule_exceptions?on_conflict=tech_id,date", { method:"POST", prefer:"resolution=merge-duplicates,return=minimal", body: JSON.stringify({ ...exForm, note: exForm.note||null }) });
      setExForm(f => ({ ...f, date:"", note:"" }));
      await load(); showToast("✅ Saved");
    } catch(e) { showToast("Error: "+e.message, false); }
    setBusy(false);
  }
  async function removeException(id) {
    setBusy(true);
    try { await sb(`schedule_exceptions?id=eq.${id}`, { method:"DELETE", prefer:"return=minimal" }); await load(); }
    catch(e) { showToast("Error: "+e.message, false); }
    setBusy(false);
  }
  const counts = SCHEDULE_DAYS.map((_,i) => rows.filter(r => r.weekday===i+1 && !NON_ROUTE_VEHICLES.includes(r.vehicle) && active.some(t=>t.id===r.tech_id && !t.on_leave)).length);
  const vehicles = [...new Set([...SCHEDULE_VEHICLES, ...rows.map(r=>r.vehicle)])].sort((x,y)=>vehicleSortKey(x)-vehicleSortKey(y)||x.localeCompare(y));
  const pods = schedulePods(active, rows);
  const today = mountainDate(new Date().toISOString());
  const upcoming = exceptions.filter(e => e.date >= today);
  const techName = id => techs.find(t=>t.id===id)?.name || "Unknown";
  const inp = { background:C.white, border:`1px solid ${C.border}`, color:C.black, padding:"6px 8px", borderRadius:"10px", fontSize:"12px", fontFamily:FONT, fontWeight:"700", boxSizing:"border-box" };
  if (!loaded) return <div style={{ fontSize:"13px", color:C.muted, padding:"20px" }}>Loading…</div>;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"18px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:"10px", flexWrap:"wrap" }}>
          <div>
            <Label color={C.blue}>🗓 Weekly Truck Schedule</Label>
            <div style={{ fontSize:"12px", color:C.muted }}>{swapMode ? "Swap mode: tap one box, then another, and they trade." : "Tap a box to pick the vehicle (or Off)."} Needs {truckCount} on trucks every workday.</div>
          </div>
          <button onClick={()=>{ setSwapMode(v=>!v); setSwapFirst(null); setEditing(null); }}
            style={{ background:swapMode?C.blue:C.cardLt, border:`1px solid ${swapMode?C.blue:C.border}`, color:swapMode?C.white:C.black, padding:"8px 14px", borderRadius:"20px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"13px", letterSpacing:"-0.01em" }}>
            🔁 {swapMode ? "Swap mode on" : "Swap"}
          </button>
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:"10px", margin:"10px 0" }}>
          {CREWS.map(c=>(
            <span key={c.id} style={{ display:"inline-flex", alignItems:"center", gap:"5px", fontSize:"11px", color:C.black }}>
              <span style={{ width:"12px", height:"12px", borderRadius:"3px", background:c.color }}/>{c.label}{c.days&&<span style={{ color:C.muted }}>({c.days.split("").map(d=>SCHEDULE_DAYS[d-1]).join("/")})</span>}
            </span>
          ))}
          <span style={{ display:"inline-flex", alignItems:"center", gap:"5px", fontSize:"11px", color:C.black }}>
            <span style={{ width:"12px", height:"12px", borderRadius:"3px", background:C.blueLt, border:`1px solid ${C.blue}` }}/>⭐ Team lead
          </span>
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ borderCollapse:"separate", borderSpacing:"3px", width:"100%", minWidth:"600px" }}>
            <thead>
              <tr>
                <th style={{ textAlign:"left", fontSize:"11px", color:C.muted, padding:"4px" }}>Tech</th>
                {SCHEDULE_DAYS.map((d,i)=>(
                  <th key={d} style={{ fontSize:"11px", color:counts[i]<truckCount?"#ff3b30":C.green, padding:"4px", fontFamily:FONT }}>{d.toUpperCase()}<div style={{ fontSize:"11px" }}>{counts[i]}/{truckCount}</div></th>
                ))}
              </tr>
            </thead>
            {pods.map((pod,pi)=>(
              <tbody key={pi}>
                {pi>0&&<tr><td colSpan={7} style={{ height:"8px" }}/></tr>}
                {!pod.scheduled&&<tr><td colSpan={7} style={{ fontSize:"11px", color:C.muted, fontWeight:"600", letterSpacing:"-0.01em", padding:"4px 8px" }}>NOT ON THE SCHEDULE — tap a box to add them</td></tr>}
                {pod.members.map(({t, crew})=>{
                  const color = crew?.color || C.muted;
                  return (
                    <tr key={t.id}>
                      <td style={{ fontSize:"13px", fontWeight:"600", color:C.black, padding:"6px 8px", whiteSpace:"nowrap", borderRadius:"10px", fontFamily:FONT, background:t.is_lead?C.blueLt:"transparent", border:t.is_lead?`1px solid ${C.blue}`:"1px solid transparent" }}>
                        {t.is_lead&&"⭐ "}{t.name}{t.on_leave&&<span style={{ fontSize:"11px", color:C.gold, marginLeft:"4px" }}>On leave</span>}
                      </td>
                      {SCHEDULE_DAYS.map((d,i)=>{
                        const wd=i+1, v=cell(t.id,wd)?.vehicle||"";
                        const isEditing = editing && editing.techId===t.id && editing.wd===wd;
                        const isPicked = swapFirst && swapFirst.techId===t.id && swapFirst.wd===wd;
                        if (isEditing) return (
                          <td key={d} style={{ padding:0 }}>
                            <select autoFocus value={v} onChange={e=>setCell(t.id,wd,e.target.value)} onBlur={()=>setEditing(null)}
                              style={{ ...inp, width:"100%", border:`2px solid ${C.blue}` }}>
                              <option value="">Off</option>
                              {vehicles.map(x=><option key={x} value={x}>{x}</option>)}
                            </select>
                          </td>
                        );
                        return (
                          <td key={d} onClick={()=>tapCell(t.id,wd)}
                            style={{ cursor:busy?"wait":"pointer", borderRadius:"10px", padding:"7px 6px", textAlign:"center", fontSize:"12px", fontWeight:"600", fontFamily:FONT, letterSpacing:"-0.01em",
                              background: v ? color : C.cardLt, color: v ? C.white : C.border,
                              outline: isPicked ? `3px solid ${C.black}` : "none", outlineOffset:"-3px",
                              boxShadow: v ? "0 1px 3px rgba(13,34,64,0.15)" : "none" }}>
                            {v || "—"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
        <div style={{ fontSize:"11px", color:C.muted, marginTop:"8px" }}>Crews and groups update on their own from the days each tech works. Team leads are set in the Teams tab. BB and AUX don't count toward staffing.</div>
      </div>
      <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"18px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
        <Label color={C.gold}>🏖 Time Off & Extra Days</Label>
        <div style={{ fontSize:"12px", color:C.muted, marginBottom:"10px" }}>One-off changes to the weekly schedule. "Off" takes a tech off a day they'd normally work; "Extra" adds them on a day they normally don't.</div>
        <div style={{ display:"flex", gap:"8px", flexWrap:"wrap", alignItems:"center" }}>
          <select value={exForm.tech_id} onChange={e=>setExForm(f=>({...f,tech_id:e.target.value}))} style={inp}>
            <option value="">Pick a tech…</option>
            {[...active].sort((a,b)=>a.name.localeCompare(b.name)).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input type="date" value={exForm.date} onChange={e=>setExForm(f=>({...f,date:e.target.value}))} style={inp}/>
          <select value={exForm.kind} onChange={e=>setExForm(f=>({...f,kind:e.target.value}))} style={inp}>
            <option value="off">Off</option>
            <option value="extra">Extra day</option>
          </select>
          <input value={exForm.note} onChange={e=>setExForm(f=>({...f,note:e.target.value}))} placeholder="Note (optional)" style={{ ...inp, width:"180px" }}/>
          <button onClick={addException} disabled={busy} style={{ background:C.gold, border:"none", color:C.white, padding:"7px 14px", borderRadius:"10px", cursor:busy?"not-allowed":"pointer", fontFamily:FONT, fontWeight:"600", fontSize:"13px" }}>Add</button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:"4px", marginTop:"12px" }}>
          {upcoming.map(e=>(
            <div key={e.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:"13px", background:C.cardLt, borderRadius:"10px", padding:"6px 10px" }}>
              <span><strong>{techName(e.tech_id)}</strong> · {new Date(e.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})} · {e.kind==="off"?"Off":"Extra day"}{holidays.includes(e.date)?" (holiday)":""}{e.note?` — ${e.note}`:""}</span>
              <button onClick={()=>removeException(e.id)} disabled={busy} style={{ background:"none", border:"none", color:"#ff3b30", cursor:"pointer", fontSize:"14px" }}>×</button>
            </div>
          ))}
          {upcoming.length===0 && <div style={{ fontSize:"12px", color:C.muted }}>Nothing upcoming.</div>}
        </div>
      </div>
    </div>
  );
}

// ─── TEAM LEAD PANEL ─────────────────────────────────────────────────────────
function TeamLeadPanel({ tech, techs, upsells, switchovers, reviews, callbacks, quota, jobs=[] }) {
  const q = quota || DEFAULT_QUOTA;
  const teamMembers = (techs||[]).filter(t=>t.team_lead_id===tech.id);
  const mk = getMonthKey();
  const now = new Date(); const y=now.getFullYear(); const mo=String(now.getMonth()+1).padStart(2,"0");
  const { start: mStart, end: mEnd } = monthBounds(y, mo);

  // Lead's own quota
  const leadUpsells  = upsellAmountInRange(jobs, tech.id, mStart, mEnd);
  const leadReviews  = (reviews||[]).filter(r=>r.tech_id===tech.id&&r.month_key===mk).reduce((s,r)=>s+r.count,0);
  const leadSwitches = (switchovers||[]).filter(s=>s.tech_id===tech.id&&s.week_key?.startsWith(`${y}-${mo}`)).length;
  const leadHitsQuota = leadUpsells>=q.upsells && leadReviews>=q.reviews && leadSwitches>=q.switchovers;

  // Team member stats
  const teamMemberStats = teamMembers.map(m=>{
    const monthUpsellAmt   = upsellAmountInRange(jobs, m.id, mStart, mEnd);
    const monthReviewCount = (reviews||[]).filter(r=>r.tech_id===m.id&&r.month_key===mk).reduce((s,r)=>s+r.count,0);
    const monthSwitchCount = (switchovers||[]).filter(s=>s.tech_id===m.id&&s.week_key?.startsWith(`${y}-${mo}`)).length;
    const upHit=monthUpsellAmt>=q.upsells, revHit=monthReviewCount>=q.reviews, swHit=monthSwitchCount>=q.switchovers;
    const tt = calcTotals(m,upsells||[],switchovers||[],reviews||[],callbacks||[],jobs);
    return { ...m, monthUpsellAmt, monthReviewCount, monthSwitchCount, upHit, revHit, swHit, allHit:upHit&&revHit&&swHit, total:tt.total };
  });

  const hittingCount   = teamMemberStats.filter(m=>m.allHit).length;
  const totalMembers   = teamMembers.length;
  const neededForPartial = Math.ceil(totalMembers * (2/3));
  const allTeamHit     = leadHitsQuota && hittingCount === totalMembers && totalMembers > 0;
  const partialHit     = leadHitsQuota && hittingCount >= neededForPartial && !allTeamHit && totalMembers > 0;
  const teamTotalPts   = teamMemberStats.reduce((s,m)=>s+m.total,0);
  const overridePct    = allTeamHit ? 0.10 : partialHit ? 0.05 : 0;
  const overridePts    = Math.round(teamTotalPts * overridePct);
  const statusColor    = allTeamHit ? C.green : partialHit ? C.gold : C.blue;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>

      {/* No members yet */}
      {totalMembers===0&&(
        <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"24px 20px", textAlign:"center", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize:"32px", marginBottom:"10px" }}>👥</div>
          <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"20px", color:C.black, marginBottom:"6px" }}>No Team Members Yet</div>
          <div style={{ fontSize:"13px", color:C.muted }}>Ask your admin to assign members to your team.</div>
        </div>
      )}

      {/* Override status card */}
      {totalMembers>0&&(
        <div style={{ background:(allTeamHit||partialHit)?`${statusColor}12`:C.white, border:`2px solid ${allTeamHit||partialHit?statusColor:C.border}`, borderTop:`4px solid ${statusColor}`, borderRadius:"16px", padding:"18px 20px", boxShadow:"0 4px 16px rgba(0,0,0,0.06)" }}>
          <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"13px", color:statusColor, letterSpacing:"-0.01em", marginBottom:"6px" }}>
            {allTeamHit?"🏆 10% OVERRIDE UNLOCKED":partialHit?"⚡ 5% OVERRIDE UNLOCKED":"⏳ TEAM LEAD OVERRIDE"}
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"14px" }}>
            <div>
              <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"36px", color:overridePts>0?statusColor:C.black, lineHeight:1 }}>
                {overridePts>0?`+${overridePts.toLocaleString()} PTS`:"LOCKED"}
              </div>
              <div style={{ fontSize:"12px", color:C.muted, marginTop:"4px" }}>
                {overridePct>0?`${Math.round(overridePct*100)}% of team's ${teamTotalPts.toLocaleString()} pts`:"Get your team to quota to unlock"}
              </div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"22px", color:C.black }}>{hittingCount}/{totalMembers}</div>
              <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em" }}>On quota</div>
            </div>
          </div>

          {/* Conditions */}
          <div style={{ display:"flex", flexDirection:"column", gap:"8px", marginBottom:"12px" }}>
            {[
              { label:"Your own quota hit", hit:leadHitsQuota },
              { label:`${neededForPartial}/${totalMembers} teammates hit quota → 5% override`, hit:hittingCount>=neededForPartial, pts:Math.round(teamTotalPts*0.05) },
              { label:`All ${totalMembers}/${totalMembers} teammates hit quota → 10% override`, hit:allTeamHit, pts:Math.round(teamTotalPts*0.10) },
            ].map((row,i)=>(
              <div key={i} style={{ display:"flex", alignItems:"center", gap:"8px", background:row.hit?`${C.green}10`:`${C.border}30`, border:`1px solid ${row.hit?C.green:C.border}`, borderRadius:"10px", padding:"8px 12px" }}>
                <span style={{ color:row.hit?C.green:"#ff3b30", fontSize:"16px", flexShrink:0 }}>{row.hit?"✓":"✗"}</span>
                <span style={{ fontSize:"12px", color:row.hit?C.black:C.muted, fontFamily:FONT, fontWeight:"700", flex:1 }}>{row.label}</span>
                {i>0&&<span style={{ fontFamily:FONT, fontWeight:"700", fontSize:"12px", color:row.hit?C.green:C.muted }}>+{row.pts} pts</span>}
              </div>
            ))}
          </div>

          {!leadHitsQuota&&<div style={{ fontSize:"12px", color:C.muted, fontStyle:"normal" }}>Hit your own quota first to unlock any override.</div>}
          {leadHitsQuota&&!partialHit&&totalMembers>0&&<div style={{ fontSize:"12px", color:C.muted, fontStyle:"normal" }}>Get {neededForPartial-hittingCount} more teammate{neededForPartial-hittingCount!==1?"s":""} to quota to unlock 5%.</div>}
          {partialHit&&!allTeamHit&&<div style={{ fontSize:"12px", color:C.gold, fontStyle:"normal", fontFamily:FONT, fontWeight:"700" }}>5% unlocked! Get {totalMembers-hittingCount} more to quota for the full 10%.</div>}
        </div>
      )}

      {/* Team member cards */}
      {totalMembers>0&&(
        <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"16px", overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
          <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}`, background:C.cardLt }}>
            <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"16px", color:C.black }}>👥 {tech.team_name||"Your Team"} — {formatMonthLabel(mk)}</div>
            <div style={{ fontSize:"11px", color:C.muted, marginTop:"2px" }}>Push your guys to hit all 3 before month end</div>
          </div>
          <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"10px" }}>
            {teamMemberStats.map(m=>(
              <div key={m.id} style={{ background:m.allHit?`${C.green}10`:C.cardLt, border:`1px solid ${m.allHit?C.green:C.border}`, borderRadius:"12px", padding:"12px 14px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"8px" }}>
                  <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"16px", color:C.black }}>{m.name}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                    <span style={{ fontFamily:FONT, fontWeight:"700", fontSize:"12px", color:m.allHit?C.green:C.muted }}>{m.allHit?"✅ ALL HIT":`${[m.upHit,m.revHit,m.swHit].filter(Boolean).length}/3`}</span>
                    <span style={{ fontSize:"11px", color:C.gold, fontFamily:FONT, fontWeight:"700" }}>+{Math.round(m.total*overridePct)} pts override</span>
                  </div>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"6px" }}>
                  {[
                    { label:"Upsells",  val:`$${m.monthUpsellAmt}`, target:`$${q.upsells}`,  hit:m.upHit,  color:C.green },
                    { label:"Reviews",  val:m.monthReviewCount,      target:q.reviews,         hit:m.revHit, color:C.gold  },
                    { label:"Switchovers", val:m.monthSwitchCount,      target:q.switchovers,     hit:m.swHit,  color:C.blue  },
                  ].map(col=>(
                    <div key={col.label} style={{ background:col.hit?`${col.color}15`:C.white, border:`1px solid ${col.hit?col.color:C.border}`, borderRadius:"10px", padding:"6px 8px", textAlign:"center" }}>
                      <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"14px", color:col.hit?col.color:C.black }}>{col.val}{col.hit?" ✓":""}</div>
                      <div style={{ fontSize:"11px", color:C.muted, textTransform:"none", letterSpacing:"-0.01em" }}>{col.label} / {col.target}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ─── INCENTIVE BOARD ─────────────────────────────────────────────────────────
const INCENTIVE_TIERS = [
  {
    pts: 2500,
    prize: "$150",
    color: "#cd7f32",
    icon: "🔥",
    name: "IGNITION",
    tagline: "3–4 months of solid work. You've earned it.",
    items: [
      { name:"Fresh Kicks",              desc:"$150 toward Nike Air Forces, Jordans, or your shoe of choice", img:"https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&h=240&fit=crop&auto=format" },
      { name:"Premium Apparel",          desc:"$150 to spend on gear, fits, or streetwear", img:"https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=400&h=240&fit=crop&auto=format" },
      { name:"Lagoon Pass or Adventure", desc:"Day pass to local attraction or adventure experience", img:"https://images.unsplash.com/photo-1504701954957-2010ec3bcec1?w=400&h=240&fit=crop&auto=format" },
      { name:"Cash",                     desc:"$150 straight cash — no questions asked", img:"https://images.unsplash.com/photo-1554672408-730436b60dde?w=400&h=240&fit=crop&auto=format" },
      { name:"Gift Cards",               desc:"$150 in gift cards to the stores you actually shop at", img:"https://images.unsplash.com/photo-1556742502-ec7c0e9f34b1?w=400&h=240&fit=crop&auto=format" },
    ],
  },
  {
    pts: 4500,
    prize: "$300",
    color: "#a8c0d6",
    icon: "⚡",
    name: "VOLTAGE",
    tagline: "6–7 months in. The team is noticing.",
    items: [
      { name:"Ray-Bans or Designer Shades", desc:"Premium sunglasses — Tom Ford, Oakley, Ray-Ban", img:"https://images.unsplash.com/photo-1473496169904-658ba7574b0d?w=400&h=240&fit=crop&auto=format" },
      { name:"Designer Cologne",           desc:"Tom Ford, Chanel, or your signature scent — up to $300", img:"https://images.unsplash.com/photo-1541643600914-78b084683702?w=400&h=240&fit=crop&auto=format" },
      { name:"Cash",                        desc:"$300 straight cash — spend it how you want", img:"https://images.unsplash.com/photo-1554672408-730436b60dde?w=400&h=240&fit=crop&auto=format" },
      { name:"Xbox or Gaming Bundle",       desc:"New Xbox or $300 gaming store credit", img:"https://images.unsplash.com/photo-1605979257913-1704eb7b6246?w=400&h=240&fit=crop&auto=format" },
      { name:"Hotel Weekend",               desc:"2-night hotel stay anywhere in-state with your person", img:"https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=400&h=240&fit=crop&auto=format" },
    ],
  },
  {
    pts: 6000,
    prize: "$600",
    color: "#ffd600",
    icon: "🏆",
    name: "OVERDRIVE",
    tagline: "9 months of excellence. Elite territory.",
    items: [
      { name:"Insta360 X5 Camera",         desc:"The sickest action cam — full kit", img:"https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=400&h=240&fit=crop&auto=format" },
      { name:"Apple Watch",                 desc:"Latest Apple Watch — your pick of model", img:"https://images.unsplash.com/photo-1434493789847-2f02dc6ca35d?w=400&h=240&fit=crop&auto=format" },
      { name:"Flights + Trip",              desc:"Domestic flights + hotel — pick your destination", img:"https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=400&h=240&fit=crop&auto=format" },
      { name:"Car Parts Fund",              desc:"$600 toward wheels, tires, suspension, or your build", img:"https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=240&fit=crop&auto=format" },
      { name:"Cash",                        desc:"$600 in your pocket — no strings attached", img:"https://images.unsplash.com/photo-1554672408-730436b60dde?w=400&h=240&fit=crop&auto=format" },
    ],
  },
  {
    pts: 8000,
    prize: "$1,200",
    color: "#c4b5fd",
    icon: "👑",
    name: "LEGEND",
    tagline: "A full year of being the best. One of one.",
    items: [
      { name:"All-Inclusive Resort",        desc:"Cancun, Dominican Republic, or your pick — you + a guest", img:"https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=400&h=240&fit=crop&auto=format" },
      { name:"S&P 500 / Roth IRA Contribution", desc:"$1,200 invested directly into your future — stocks or retirement", img:"https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400&h=240&fit=crop&auto=format" },
      { name:"Performance Car Build",       desc:"$1,200 no-questions-asked contribution to your car build", img:"https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=400&h=240&fit=crop&auto=format" },
      { name:"VIP Concert + Hotel",         desc:"Floor seats to a major show + hotel night for you and a +1", img:"https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&h=240&fit=crop&auto=format" },
      { name:"Paid Time Off Bonus",         desc:"Take time off + $1,200 spending money — you earned it", img:"https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&h=240&fit=crop&auto=format" },
    ],
  },
];

function IncentiveBoard({ techs, upsells, switchovers, reviews, callbacks, currentId, jobs=[] }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px 18px" }}>
        <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"28px", color:C.black, letterSpacing:"-0.01em", marginBottom:"4px" }}>Skylo rewards program</div>
        <div style={{ fontSize:"13px", color:C.muted, marginBottom:"8px" }}>Stack your points from upsells, switchovers, reviews, and badges. Hit a tier, claim your Skylo Cash — then your points reset and the grind starts again.</div>
        <div style={{ background:`${C.blue}12`, border:`1px solid ${C.border}`, borderRadius:"10px", padding:"10px 14px", fontSize:"12px", color:C.muted, display:"flex", gap:"6px", alignItems:"flex-start" }}>
          <span style={{ color:C.blue, fontSize:"14px" }}>ℹ️</span>
          <span><strong style={{ color:C.black }}>How it works:</strong> Every $2 upselled = 1 pt. Reviews are 5 pts each (+20 bonus at 10/mo). Switchovers are 15–120 pts by plan. Hit 2,500 pts ($150) · 4,500 pts ($300) · 6,000 pts ($600) · 8,000 pts ($1,200) — then points reset and you climb again.</span>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"8px", marginTop:"14px" }}>
          {[
            {l:"Upsells",    v:"$2 = 1 pt",        c:C.green},
            {l:"Reviews",    v:"5 pts each",        c:C.gold},
            {l:"Switchovers",v:"15–120 pts",        c:C.purple},
            {l:"Badges",     v:"40–1,000 pts",      c:C.blue},
          ].map(item=>(
            <div key={item.l} style={{ background:C.cardLt, borderRadius:"8px", padding:"8px 12px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:"12px", color:C.muted }}>{item.l}</span>
              <span style={{ fontFamily:FONT, fontWeight:"600", fontSize:"14px", color:item.c }}>{item.v}</span>
            </div>
          ))}
        </div>
      </div>

      {INCENTIVE_TIERS.map((tier, ti) => {
        const myTotal = currentId ? (() => {
          const tech = techs?.find(t=>t.id===currentId);
          if (!tech) return 0;
          return calcTotals(tech, upsells, switchovers, reviews, callbacks, jobs).total;
        })() : null;
        const unlocked = myTotal !== null && myTotal >= tier.pts;
        const progress = myTotal !== null ? Math.min(Math.round((myTotal / tier.pts) * 100), 100) : null;
        const prevPts = ti === 0 ? 0 : INCENTIVE_TIERS[ti-1].pts;
        const tierProgress = myTotal !== null ? Math.min(Math.round(((myTotal - prevPts) / (tier.pts - prevPts)) * 100), 100) : null;

        return (
          <div key={tier.name} style={{ background:C.card, border:`1px solid ${unlocked ? tier.color+"66" : C.border}`, borderTop:`4px solid ${tier.color}`, borderRadius:"16px", overflow:"hidden", opacity: unlocked || myTotal === null ? 1 : 0.85 }}>
            <div style={{ padding:"16px 18px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div>
                <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"28px", color:tier.color, letterSpacing:"-0.01em", lineHeight:1 }}>{tier.icon} {tier.name}</div>
                <div style={{ fontSize:"12px", color:C.muted, marginTop:"3px" }}>{tier.tagline}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"38px", color:C.black, lineHeight:1 }}>{tier.prize}</div>
                <div style={{ fontFamily:FONT, fontSize:"12px", color:tier.color, fontWeight:"700", letterSpacing:"-0.01em" }}>{tier.pts.toLocaleString()} PTS REQUIRED</div>
              </div>
            </div>

            {myTotal !== null && (
              <div style={{ padding:"12px 18px", borderBottom:`1px solid ${C.border}`, background:C.cardLt }}>
                {unlocked ? (
                  <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                    <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"14px", color:tier.color, letterSpacing:"-0.01em" }}>✅ UNLOCKED — SEE ADMIN TO CLAIM</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"6px" }}>
                      <span style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", textTransform:"none" }}>Progress</span>
                      <span style={{ fontFamily:FONT, fontWeight:"600", fontSize:"12px", color:tier.color }}>{(tier.pts - myTotal).toLocaleString()} pts away</span>
                    </div>
                    <div style={{ background:C.border, borderRadius:"2px", height:"6px", overflow:"hidden" }}>
                      <div style={{ width:`${Math.max(tierProgress||0,0)}%`, height:"100%", background:tier.color, borderRadius:"2px" }}/>
                    </div>
                    <div style={{ fontSize:"11px", color:C.muted, marginTop:"4px" }}>{Math.max(tierProgress||0,0)}% of the way there</div>
                  </div>
                )}
              </div>
            )}

            <div style={{ padding:"14px 18px" }}>
              <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", textTransform:"none", fontFamily:FONT, fontWeight:"700", marginBottom:"12px" }}>Choose Your Reward</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:"10px" }}>
                {tier.items.map(item=>(
                  <div key={item.name} style={{ background:C.cardLt, borderRadius:"16px", overflow:"hidden", border:`1px solid ${C.border}` }}>
                    <img src={item.img} alt={item.name} style={{ width:"100%", height:"110px", objectFit:"cover", display:"block" }} loading="lazy"/>
                    <div style={{ padding:"10px" }}>
                      <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"13px", color:C.black, lineHeight:"1.2", marginBottom:"3px" }}>{item.name}</div>
                      <div style={{ fontSize:"11px", color:C.muted, lineHeight:"1.3" }}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── TIME SHEET (tech-facing) ─────────────────────────────────────────────────
// ─── TRUCK PICKS ──────────────────────────────────────────────────────────────
// Which company truck a tech drives today, picked at clock-in. The Ford Pro
// driver scorecard (driverScoring.js) matches each truck's Ford data to the
// tech who picked it. One row per tech per day (truck_assignments); a
// same-day change overwrites it, and every pick/change goes to
// truck_assignment_log. One tech per truck per day: a truck someone already
// picked today is greyed out, and the database's unique index
// (truck_assignments_one_tech_per_truck) rejects a pick if two techs grab the
// same truck at the same moment -- saveTruckPick then throws a TruckTakenError.
class TruckTakenError extends Error {}
const TRUCK_TAKEN_MSG = "Someone just took that truck — pick another";
const isTruckTakenErr = msg => /23505/.test(msg) && /truck_assignments_one_tech_per_truck|\(vehicle_id, work_date\)/.test(msg);
async function saveTruckPick({ tech, vehicle, workDate, action }) {
  try {
    await sb("truck_assignments?on_conflict=tech_id,work_date", { method:"POST", prefer:"resolution=merge-duplicates,return=minimal",
      body:JSON.stringify({ tech_id:tech.id, vehicle_id:vehicle.id, work_date:workDate, shared:false, picked_at:new Date().toISOString() }) });
  } catch(e) {
    if (isTruckTakenErr(e.message)) throw new TruckTakenError(TRUCK_TAKEN_MSG);
    throw e;
  }
  await sb("truck_assignment_log", { method:"POST", prefer:"return=minimal",
    body:JSON.stringify({ tech_id:tech.id, vehicle_id:vehicle.id, work_date:workDate, action }) }).catch(()=>{});
  return true;
}

// Titles that drive a company truck: they must pick one to clock in.
const TRUCK_DRIVER_TITLES = ["detail_pro","senior_detail_pro","lead_detail_pro","commercial_detail","equipment_coordinator"];

function TimeSheetTab({ tech, techs=[], timeEntries, vehicles=[], truckAssignments=[], refreshAll, showToast, nowTick }) {
  const myEntries = timeEntries.filter(e => e.tech_id === tech.id);
  const today = mtDateStr(nowTick);
  const openEntry = myEntries.find(e => !e.clock_out);
  const isClockedInToday = !!openEntry && openEntry.work_date === today;
  const [saving, setSaving] = useState(false);
  const [editDate, setEditDate] = useState(today);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ in:"", out:"" });
  // Truck today. Required to clock in for the detail techs who drive a truck
  // (TRUCK_DRIVER_TITLES) once the vehicles list exists; anyone else (sales,
  // apprentices riding with a trainer, the Field Supervisor) can pick one but
  // doesn't have to. No vehicles table yet = clock-in works like before.
  const activeVehicles = vehicles.filter(v => v.active!==false);
  const truckOffered = activeVehicles.length > 0;
  const truckRequired = truckOffered && TRUCK_DRIVER_TITLES.includes(tech.title || "detail_apprentice");
  const myPick = truckAssignments.find(a => a.tech_id===tech.id && a.work_date===today);
  const [pickId, setPickId] = useState(myPick?.vehicle_id || "");
  const [changingTruck, setChangingTruck] = useState(false);
  useEffect(() => { if (myPick) setPickId(myPick.vehicle_id); }, [myPick?.vehicle_id]);
  // Pre-select the truck on this tech's regular schedule for today, if any.
  useEffect(() => {
    if (myPick || pickId || !truckOffered) return;
    const weekday = new Date(today+"T12:00:00Z").getUTCDay();
    sb(`tech_schedule?tech_id=eq.${tech.id}&weekday=eq.${weekday}&select=vehicle`).then(rows => {
      const v = activeVehicles.find(v => v.name===rows?.[0]?.vehicle);
      if (v && !takenBy(v.id)) setPickId(id => id || v.id);
    }).catch(()=>{});
    // eslint-disable-next-line
  }, [tech.id, today, truckOffered]);
  // Who already has each truck today (not counting this tech).
  const takenBy = vehicleId => truckAssignments.find(a => a.vehicle_id===vehicleId && a.work_date===today && a.tech_id!==tech.id);
  const firstName = id => (techs.find(t=>t.id===id)?.name || "another tech").split(" ")[0];
  // false = the truck is taken (pick another; no clock-in). Any other save
  // error is thrown, and clock-in goes ahead anyway.
  async function pickTruck(vehicleId, action) {
    // Already picked today (even if that truck was deactivated since): done.
    if (myPick?.vehicle_id===vehicleId) return true;
    const vehicle = activeVehicles.find(v => v.id===vehicleId);
    if (!vehicle) return !!myPick;
    const taken = async () => { setPickId(myPick?.vehicle_id || ""); showToast(TRUCK_TAKEN_MSG, false); await refreshAll(); return false; };
    if (takenBy(vehicleId)) return taken();
    try { await saveTruckPick({ tech, vehicle, workDate:today, action: myPick ? "change" : action }); }
    catch(e) { if (e instanceof TruckTakenError) return taken(); throw e; }
    return true;
  }
  async function changeTruck(vehicleId) {
    setPickId(vehicleId); setSaving(true);
    try { if (await pickTruck(vehicleId, "change")) { await refreshAll(); setChangingTruck(false); showToast("✅ Truck updated"); } }
    catch(e) { showToast("Error: "+e.message, false); }
    setSaving(false);
  }

  // Lazy auto-close: any of THIS tech's own sessions still open from a past
  // date get closed at that day's midnight the moment they load this tab.
  // Nothing else depends on this having already run -- sessionHours() caps a
  // past-date open session at midnight regardless -- this just persists the
  // auto_closed flag so it's visible next time they check.
  useEffect(() => {
    const stale = myEntries.filter(e => !e.clock_out && e.work_date < today);
    if (stale.length === 0) return;
    (async () => {
      for (const e of stale) {
        await sb(`time_entries?id=eq.${e.id}`, { method:"PATCH", body:JSON.stringify({ clock_out: mtDayEndUTC(e.work_date), auto_closed:true }), prefer:"return=minimal" }).catch(()=>{});
      }
      await refreshAll();
    })();
    // eslint-disable-next-line
  }, [myEntries.map(e=>e.id+(e.clock_out||"")).join(","), today]);

  async function clockIn() {
    if (truckRequired && !pickId) return showToast("Pick your truck for today first", false);
    setSaving(true);
    try {
      // The truck pick never blocks the time entry (it feeds pay hours): if
      // saving the pick fails, clock in anyway and say so. Only a truck
      // someone else already took stops the clock-in (pick another).
      let pickErr = null;
      if (truckOffered && pickId) {
        let picked = true;
        try { picked = await pickTruck(pickId, "pick"); }
        catch(e) { pickErr = e.message; }
        if (!picked) { setSaving(false); return; }
      }
      await sb("time_entries", { method:"POST", body:JSON.stringify({ tech_id:tech.id, work_date:today, clock_in:new Date().toISOString() }) });
      await refreshAll();
      if (pickErr) showToast("Clocked in, but your truck pick didn't save — tell your lead. ("+pickErr+")", false);
      else showToast("✅ Clocked in!");
    } catch(e) { showToast("Error: "+e.message, false); }
    setSaving(false);
  }
  async function clockOut() {
    if (!openEntry) return;
    setSaving(true);
    try {
      await sb(`time_entries?id=eq.${openEntry.id}`, { method:"PATCH", body:JSON.stringify({ clock_out:new Date().toISOString() }), prefer:"return=minimal" });
      await refreshAll();
      showToast("✅ Clocked out!");
    } catch(e) { showToast("Error: "+e.message, false); }
    setSaving(false);
  }

  const todayTotal = dayHoursTotal(myEntries, tech.id, today, nowTick);
  const autoClosedDays = [...new Set(myEntries.filter(e=>e.auto_closed).map(e=>e.work_date))].sort((a,b)=>b.localeCompare(a));

  const recentDays = Array.from({length:14}, (_,i) => {
    const d = new Date(today+"T12:00:00Z"); d.setUTCDate(d.getUTCDate()-i);
    return d.toISOString().split("T")[0];
  });

  const editEntries = myEntries.filter(e => e.work_date === editDate).sort((a,b)=>a.clock_in.localeCompare(b.clock_in));

  function startEdit(e) {
    setEditingId(e.id);
    setEditForm({ in: isoToMtTimeInput(e.clock_in), out: e.clock_out ? isoToMtTimeInput(e.clock_out) : "" });
  }
  async function saveEdit() {
    if (!editForm.in) return showToast("Clock-in time required", false);
    setSaving(true);
    try {
      const body = { clock_in: mtTimeToIso(editDate, editForm.in), clock_out: editForm.out ? mtTimeToIso(editDate, editForm.out) : null, auto_closed:false };
      await sb(`time_entries?id=eq.${editingId}`, { method:"PATCH", body:JSON.stringify(body), prefer:"return=minimal" });
      await refreshAll();
      setEditingId(null);
      showToast("✅ Session updated");
    } catch(e) { showToast("Error: "+e.message, false); }
    setSaving(false);
  }
  async function addSession() {
    setSaving(true);
    try {
      const res = await sb("time_entries", { method:"POST", body:JSON.stringify({ tech_id:tech.id, work_date:editDate, clock_in:mtTimeToIso(editDate,"08:00"), clock_out:mtTimeToIso(editDate,"16:00") }) });
      await refreshAll();
      if (res && res[0]) startEdit(res[0]);
      showToast("✅ Session added — adjust the times below");
    } catch(e) { showToast("Error: "+e.message, false); }
    setSaving(false);
  }
  async function deleteSession(id) {
    if (!window.confirm("Delete this session?")) return;
    setSaving(true);
    try {
      await sb(`time_entries?id=eq.${id}`, { method:"DELETE", prefer:"return=minimal" });
      await refreshAll();
      setEditingId(null);
      showToast("Session deleted");
    } catch(e) { showToast("Error: "+e.message, false); }
    setSaving(false);
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px 18px" }}>
        <Label color={C.blue}>🕒 Time Sheet</Label>
        <div style={{ fontSize:"12px", color:C.muted, marginTop:"6px" }}>Clock in when you walk in the door for the day, and clock out when you arrive back for the day! This entry does not effect your pay in any way shape or form so please enter the correct time</div>
      </div>

      {autoClosedDays.length>0&&(
        <div style={{ background:`${C.gold}18`, border:`1px solid ${C.gold}`, borderRadius:"12px", padding:"12px 16px", fontSize:"12px", color:C.black }}>
          ⚠ {autoClosedDays.length} day{autoClosedDays.length!==1?"s":""} auto-closed at midnight because a clock-out was missed ({autoClosedDays.slice(0,3).map(fmtShortDate).join(", ")}{autoClosedDays.length>3?"...":""}) — fix it below with Edit Time if it's wrong.
        </div>
      )}

      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"20px", display:"flex", flexDirection:"column", gap:"14px" }}>
        {truckOffered && (
          <div>
            <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", fontWeight:"700", marginBottom:"6px" }}>🚚 TRUCK TODAY{!myPick && truckRequired && <span style={{ color:C.red }}> *</span>}</div>
            {myPick && !changingTruck ? (
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"10px" }}>
                <span style={{ fontFamily:FONT, fontWeight:"700", fontSize:"18px", color:C.black }}>{vehicles.find(v=>v.id===myPick.vehicle_id)?.name || "—"}</span>
                <button onClick={()=>setChangingTruck(true)} style={{ background:"none", border:`1px solid ${C.border}`, color:C.blue, padding:"4px 10px", borderRadius:"8px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"11px" }}>Change</button>
              </div>
            ) : (
              <select value={pickId} disabled={saving} onChange={e => myPick ? changeTruck(e.target.value) : setPickId(e.target.value)} style={{ background:C.white, border:`1px solid ${pickId?C.border:C.red}`, color:pickId?C.black:C.muted, padding:"10px 14px", borderRadius:"10px", fontSize:"14px", width:"100%", boxSizing:"border-box" }}>
                <option value="">Pick your truck…</option>
                {activeVehicles.map(v => {
                  const other = takenBy(v.id);
                  return <option key={v.id} value={v.id} disabled={!!other}>{v.name} — {v.model}{other ? ` (taken by ${firstName(other.tech_id)})` : ""}</option>;
                })}
              </select>
            )}
          </div>
        )}
        <div style={{ display:"flex", gap:"12px" }}>
          <button onClick={clockIn} disabled={saving||isClockedInToday} style={{ flex:1, background:isClockedInToday?C.border:C.green, border:"none", color:C.white, padding:"16px", borderRadius:"16px", cursor:(saving||isClockedInToday)?"not-allowed":"pointer", fontSize:"14px", fontWeight:"700", letterSpacing:"-0.01em", fontFamily:FONT, textTransform:"none" }}>Clock In</button>
          <button onClick={clockOut} disabled={saving||!isClockedInToday} style={{ flex:1, background:!isClockedInToday?C.border:"#ff3b30", border:"none", color:C.white, padding:"16px", borderRadius:"16px", cursor:(saving||!isClockedInToday)?"not-allowed":"pointer", fontSize:"14px", fontWeight:"700", letterSpacing:"-0.01em", fontFamily:FONT, textTransform:"none" }}>Clock Out</button>
        </div>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"32px", color:C.blue }}>{todayTotal.toFixed(2)}h</div>
          <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em" }}>{isClockedInToday ? "Clocked in — live total for today" : "Total for today"}</div>
        </div>
      </div>

      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", overflow:"hidden" }}>
        <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}` }}><Label color={C.blue}>Recent Days</Label></div>
        <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"6px" }}>
          {recentDays.map(d => {
            const total = dayHoursTotal(myEntries, tech.id, d, nowTick);
            const isAutoClosed = myEntries.some(e=>e.work_date===d&&e.auto_closed);
            return (
              <div key={d} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderBottom:`1px solid ${C.border}` }}>
                <span style={{ fontSize:"13px", color:C.black }}>{fmtShortDate(d)}{d===today?" (Today)":""}{isAutoClosed?" ⚠":""}</span>
                <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                  <span style={{ fontFamily:FONT, fontWeight:"600", fontSize:"13px", color:total>0?C.black:C.muted }}>{total.toFixed(2)}h</span>
                  <button onClick={()=>{setEditDate(d);setEditingId(null);}} style={{ background:"none", border:`1px solid ${C.border}`, color:C.blue, padding:"3px 8px", borderRadius:"8px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"11px" }}>Edit</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px 18px", display:"flex", flexDirection:"column", gap:"12px" }}>
        <Label color={C.blue}>Edit a Day</Label>
        <div style={{ fontSize:"11px", color:C.muted }}>Forgot to clock in or out? Pick the date and fix it here — no admin needed.</div>
        <input type="date" value={editDate} onChange={e=>{setEditDate(e.target.value);setEditingId(null);}} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"8px 10px", borderRadius:"10px", fontSize:"13px", fontFamily:FONT, width:"100%", boxSizing:"border-box" }}/>
        {editEntries.length===0 && <div style={{ fontSize:"12px", color:C.muted }}>No sessions logged for this day yet.</div>}
        {editEntries.map(e => (
          <div key={e.id} style={{ background:C.cardLt, borderRadius:"10px", padding:"10px 12px" }}>
            {editingId===e.id ? (
              <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
                  <div>
                    <div style={{ fontSize:"11px", color:C.muted, marginBottom:"4px" }}>Clock In</div>
                    <input type="time" value={editForm.in} onChange={ev=>setEditForm(f=>({...f,in:ev.target.value}))} style={{ background:C.card, border:`1px solid ${C.border}`, color:C.black, padding:"8px", borderRadius:"10px", fontSize:"13px", width:"100%", boxSizing:"border-box" }}/>
                  </div>
                  <div>
                    <div style={{ fontSize:"11px", color:C.muted, marginBottom:"4px" }}>Clock Out</div>
                    <input type="time" value={editForm.out} onChange={ev=>setEditForm(f=>({...f,out:ev.target.value}))} style={{ background:C.card, border:`1px solid ${C.border}`, color:C.black, padding:"8px", borderRadius:"10px", fontSize:"13px", width:"100%", boxSizing:"border-box" }}/>
                  </div>
                </div>
                <div style={{ display:"flex", gap:"8px" }}>
                  <button onClick={saveEdit} disabled={saving} style={{ flex:1, background:C.blue, border:"none", color:C.white, padding:"8px", borderRadius:"10px", cursor:"pointer", fontWeight:"700", fontSize:"12px" }}>Save</button>
                  <button onClick={()=>setEditingId(null)} style={{ background:"none", border:`1px solid ${C.border}`, color:C.muted, padding:"8px 14px", borderRadius:"10px", cursor:"pointer", fontSize:"12px" }}>Cancel</button>
                  <button onClick={()=>deleteSession(e.id)} style={{ background:"none", border:"1px solid #ef4444", color:"#ff3b30", padding:"8px 14px", borderRadius:"10px", cursor:"pointer", fontSize:"12px" }}>Delete</button>
                </div>
              </div>
            ) : (
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:"13px", color:C.black }}>
                  {formatMTTime(e.clock_in)} → {e.clock_out ? formatMTTime(e.clock_out) : (e.work_date===today ? "still clocked in" : "—")}
                  {e.auto_closed && <span style={{ color:C.gold }}> ⚠ auto-closed</span>}
                </span>
                <button onClick={()=>startEdit(e)} style={{ background:"none", border:`1px solid ${C.border}`, color:C.blue, padding:"4px 10px", borderRadius:"8px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"11px" }}>Edit Time</button>
              </div>
            )}
          </div>
        ))}
        <button onClick={addSession} disabled={saving} style={{ background:C.cardLt, border:`1px solid ${C.blue}`, color:C.blue, padding:"10px", borderRadius:"10px", cursor:saving?"not-allowed":"pointer", fontWeight:"700", fontSize:"12px" }}>+ Add Session for This Day</button>
      </div>
    </div>
  );
}

// ─── TECH DASHBOARD ───────────────────────────────────────────────────────────
function TechDashboard({ tech, techs, upsells, switchovers, reviews, callbacks, quota, jobs, timeEntries=[], tipEntries=[], refreshAll=async()=>{}, rideAlongs=[], token=null, vehicles=[], truckAssignments=[], onLogout }) {
  const q = quota || DEFAULT_QUOTA;
  const [tab, setTab] = useState("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const showToast = (msg, ok=true) => { setToast({msg,ok}); setTimeout(()=>setToast(null), 3000); };
  // Ticks while this dashboard is open so an active clock-in's live running
  // total (Time Sheet tab) advances without a manual refresh.
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => { const iv = setInterval(() => setNowTick(Date.now()), 30000); return () => clearInterval(iv); }, []);
  const tt = calcTotals(tech, upsells, switchovers, reviews, callbacks, jobs);
  const tier = getTier(tt.total);
  const nextTier = JOURNEY_TIERS.find(t=>t.minPts>tt.total);
  const allRanked = [...techs].map(t=>({...t,...calcTotals(t,upsells,switchovers,reviews,callbacks||[],jobs)})).sort((a,b)=>b.total-a.total);
  const myPos = allRanked.findIndex(t=>t.id===tech.id)+1;
  const wk=getWeekKey(), mk=getMonthKey();
  const weekUpsell = upsellAmountInRange(jobs, tech.id, wk, weekEndDate(wk));
  const monthReviews = reviews.filter(r=>r.tech_id===tech.id&&r.month_key===mk).reduce((s,r)=>s+r.count,0);
  const tenure = formatTenure(tech.start_date);

  // Month quota actuals
  const now = new Date(); const y = now.getFullYear(); const mo = String(now.getMonth()+1).padStart(2,"0");
  const { start: mStart, end: mEnd } = monthBounds(y, mo);
  const monthUpsellAmt   = upsellAmountInRange(jobs, tech.id, mStart, mEnd);
  const monthSwitchCount = switchovers.filter(s=>s.tech_id===tech.id && s.week_key?.startsWith(`${y}-${mo}`)).length;
  const upHit  = monthUpsellAmt   >= q.upsells;
  const revHit = monthReviews     >= q.reviews;
  const swHit  = monthSwitchCount >= q.switchovers;
  const allQuotaHit = upHit && revHit && swHit;
  const quotaHitCount = [upHit,revHit,swHit].filter(Boolean).length;
  const tenureDays = tech.start_date ? Math.floor((Date.now() - new Date(tech.start_date+"T12:00:00Z")) / 86400000) : 0;
  const myRecentRA = rideAlongs.filter(r=>r.tech_id===tech.id).sort((a,b)=>b.date?.localeCompare(a.date)).slice(0,3);
  const raAvgScore = myRecentRA.length ? myRecentRA.reduce((s,r)=>{ const cl=r.checklist?JSON.parse(r.checklist):{}; const v=Object.values(cl); return s+(v.length?v.filter(x=>x==="✅").length/v.length*100:0); },0)/myRecentRA.length : 0;
  const eligibleForTechII = tenureDays >= 56 && myRecentRA.length >= 3 && raAvgScore >= 85;
  const stageConf = STAGE_CONFIG[tech.onboarding_stage || "active"] || STAGE_CONFIG.active;

  const techNavSections = [
    { label:null, items:[
      ["overview","🏠","Overview"],
      ["timesheet","🕒","Time Sheet"],
      ["reports","📊","My Reports"],
      ["leaderboard","🏆","Leaderboard"],
    ]},
    { label:"Journey", items:[
      ["journey","🗺️","Journey Map"],
      ["total","🎯","Total Score"],
      ["badges","🥇","Badges"],
      ["incentive","🎁","Rewards"],
    ]},
    { label:"My Stats", items:[
      ["upsells","💰","Upsells"],
      ["switchovers","🔄","Switchovers"],
      ["reviews","⭐","Reviews"],
      ...(tech.is_lead?[["myteam","👥","My Team"]]:[]),
    ]},
    ...(SALES_SELF_VIEW[tech.id]||CALLBACK_ENTRY_TECHS.has(tech.id)?[{ label:"Sales", items:[
      ...(SALES_SELF_VIEW[tech.id]?[["mysales","🤝","My Sales"]]:[]),
      ...(CALLBACK_ENTRY_TECHS.has(tech.id)?[["callbacks","📞","Callbacks"]]:[]),
    ] }]:[]),
    ...(!isApprenticeTech(tech)?[{ label:"Forms", items:[["forms","📝","Forms"]] }]:[]),
    { label:"Training", items:[
      ["training","📋","Perfect Day Training"],
      ["auditscores","📊","My Audits"],
    ]},
  ];

  return (
    <div style={{ minHeight:"100vh", background:"#f5f5f7" }}>
      <style>{GS}</style>
      <SideNav sections={techNavSections} active={tab} setActive={setTab} open={menuOpen} onClose={()=>setMenuOpen(false)} name={tech.name} role={`${tier.icon} ${tier.name}`}/>
      <Header left={<HamburgerBtn onClick={()=>setMenuOpen(true)}/>} right={<LogoutBtn onLogout={onLogout}/>}/>
      <div style={{ background:C.white, borderBottom:`1px solid ${C.border}`, padding:"14px 20px 0", boxShadow:"0 2px 12px rgba(0,0,0,0.06)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"14px", marginBottom:"14px" }}>
          <div style={{ width:"50px", height:"50px", borderRadius:"50%", background:`${C.blue}18`, border:`2px solid ${C.blue}`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:FONT, fontSize:"16px", fontWeight:"700", color:C.blue, flexShrink:0 }}>{tech.avatar}</div>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"24px", color:C.black, lineHeight:1 }}>{tech.name}</div>
            <div style={{ display:"flex", gap:"8px", alignItems:"center", marginTop:"4px", flexWrap:"wrap" }}>
              <Pill color={tier.color}>{tier.icon} {tier.name}</Pill>
              {tenure&&<span style={{ fontSize:"11px", color:C.muted }}>⏱ {tenure}</span>}
              {tech.title && <Pill color={C.purple}>🏷 {TITLE_LABELS[tech.title] || tech.title}</Pill>}
              {tech.onboarding_stage && tech.onboarding_stage !== "active" && <Pill color={stageConf.color}>{stageConf.icon} {stageConf.label}</Pill>}
              {eligibleForTechII && <Pill color={C.gold}>🌟 Tech II Eligible</Pill>}
            </div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"34px", color:C.blue, lineHeight:1 }}>{tt.total.toLocaleString()}</div>
            <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em" }}>Total pts</div>
          </div>
        </div>
        {nextTier&&(
          <div style={{ marginBottom:"12px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"5px" }}>
              <span style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em" }}>🎯 TOWARD: {nextTier.reward}</span>
              <span style={{ fontSize:"11px", color:tier.color, fontFamily:FONT, fontWeight:"700" }}>{(nextTier.minPts-tt.total).toLocaleString()} PTS TO GO</span>
            </div>
            <Bar pct={Math.round(((tt.total-tier.minPts)/(nextTier.minPts-tier.minPts))*100)} color={tier.color} h={4}/>
          </div>
        )}
      </div>
      <div style={{ padding:"20px", maxWidth:"800px", margin:"0 auto" }}>
        {tab==="overview"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>

            {/* ── MONTHLY QUOTA CARD ── */}
            <div style={{ background:allQuotaHit?`${C.green}12`:C.white, border:`2px solid ${allQuotaHit?C.green:C.border}`, borderTop:`4px solid ${allQuotaHit?C.green:C.blue}`, borderRadius:"16px", padding:"18px 20px", boxShadow:"0 4px 16px rgba(0,0,0,0.06)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"14px" }}>
                <div>
                  <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"18px", color:allQuotaHit?C.green:C.black, letterSpacing:"-0.01em" }}>
                    {allQuotaHit ? "✅ QUOTA CRUSHED" : `📊 MONTHLY QUOTA`}
                  </div>
                  <div style={{ fontSize:"11px", color:C.muted, marginTop:"2px" }}>{formatMonthLabel(mk)} · {quotaHitCount}/3 targets hit</div>
                </div>
                <div style={{ background:allQuotaHit?C.green:quotaHitCount>=2?C.gold:quotaHitCount===1?C.orange:"#ff3b30", borderRadius:"20px", padding:"4px 12px", fontFamily:FONT, fontWeight:"700", fontSize:"13px", color:C.white }}>
                  {allQuotaHit?"ON FIRE 🔥":quotaHitCount>=2?"CLOSE":"NEEDS WORK"}
                </div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                {[
                  { label:"💰 Upsells",     actual:`$${monthUpsellAmt}`,   target:`$${q.upsells}`,    pct:Math.min(Math.round((monthUpsellAmt/q.upsells)*100),100),    hit:upHit,  color:C.green },
                  { label:"⭐ Reviews",      actual:monthReviews,            target:q.reviews,           pct:Math.min(Math.round((monthReviews/q.reviews)*100),100),       hit:revHit, color:C.gold  },
                  { label:"🔄 Switchovers", actual:monthSwitchCount,        target:q.switchovers,       pct:Math.min(Math.round((monthSwitchCount/q.switchovers)*100),100),hit:swHit,  color:C.blue  },
                ].map(row=>(
                  <div key={row.label}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"5px" }}>
                      <span style={{ fontSize:"12px", fontFamily:FONT, fontWeight:"600", color:C.black }}>{row.label}</span>
                      <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                        <span style={{ fontSize:"12px", fontFamily:FONT, fontWeight:"700", color:row.hit?row.color:C.black }}>
                          {row.actual} <span style={{ color:C.muted, fontWeight:"600" }}>/ {row.target}</span>
                        </span>
                        {row.hit
                          ? <span style={{ background:row.color, color:C.white, borderRadius:"12px", padding:"1px 8px", fontSize:"11px", fontFamily:FONT, fontWeight:"700" }}>✓ HIT</span>
                          : <span style={{ background:C.cardLt, color:C.muted, borderRadius:"12px", padding:"1px 8px", fontSize:"11px", fontFamily:FONT, fontWeight:"700" }}>{row.pct}%</span>
                        }
                      </div>
                    </div>
                    <div style={{ background:C.border, borderRadius:"10px", height:"7px", overflow:"hidden" }}>
                      <div style={{ width:`${row.pct}%`, height:"100%", background:row.hit?row.color:row.color+"99", borderRadius:"10px", transition:"width 0.4s ease" }}/>
                    </div>
                  </div>
                ))}
              </div>
              {!allQuotaHit&&(
                <div style={{ fontSize:"11px", color:C.muted, fontStyle:"normal", marginTop:"12px" }}>
                  Keep pushing — hit all 3 targets this month 💪
                </div>
              )}
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"10px" }}>
              <StatBlock label="Total Points" value={tt.total.toLocaleString()} color={C.blue} accent={C.blue}/>
              <StatBlock label="Team Rank" value={`#${myPos} / ${techs.length}`} color={C.green} accent={C.green}/>
              <StatBlock label="Week Upsells" value={`$${weekUpsell.toLocaleString()}`} color={C.green} sub={`All-time $${Math.round(tt.upsellAmt).toLocaleString()}`} accent={C.green}/>
              <StatBlock label="Month Reviews" value={monthReviews} color={C.gold} sub={`All-time ${reviews.filter(r=>r.tech_id===tech.id).reduce((s,r)=>s+r.count,0)}`} accent={C.gold}/>
            </div>

            {/* ── WEEKLY PROJECTION ── */}
            {(()=>{
              const wkJobs = (jobs||[]).filter(j=>j.tech_id===tech.id&&j.week_key===wk);
              const wkRevenue = wkJobs.reduce((s,j)=>s+(j.revenue||0),0);
              const wkEnd = new Date(wk+"T12:00:00Z"); wkEnd.setUTCDate(wkEnd.getUTCDate()+6);
              const wkHours   = rangeHoursTotal(timeEntries, tech.id, wk, wkEnd.toISOString().split("T")[0], nowTick);
              if (wkRevenue===0&&wkHours===0) return null;
              const mt = new Date(Date.now()-6*60*60*1000);
              const day = mt.getDay();
              const daysElapsed = Math.max(day, 1); // Sun–Sat week, Mon–Sat workdays
              const daysInWeek  = 6;
              const projRevenue = Math.round((wkRevenue/daysElapsed)*daysInWeek);
              const projHours   = Math.round((wkHours/daysElapsed)*daysInWeek*10)/10;
              const projMonthly = Math.round(projRevenue*(52/12));
              const curPP = currentPayPeriod();
              const { totalPay:projBonus } = calcUpsellPay(curPP ? upsellAmountInRange(jobs, tech.id, curPP.start, curPP.end) : 0);
              return (
                <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px 18px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
                  <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"12px", color:C.purple, letterSpacing:"-0.01em", marginBottom:"12px" }}>
                    📈 WEEK PROJECTION — {daysElapsed}/{daysInWeek} DAYS IN
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"8px" }}>
                    {[
                      { l:"Proj. Revenue",      v:`$${projRevenue.toLocaleString()}`,   c:C.green  },
                      { l:"Proj. Hours",         v:`${projHours}h`,                      c:C.blue   },
                      { l:"Proj. Monthly Rev",   v:`$${projMonthly.toLocaleString()}`,   c:C.purple },
                      { l:"Upsell Bonus (pay period so far)",  v:`$${projBonus.toFixed(2)}`,           c:C.gold   },
                    ].map(s=>(
                      <div key={s.l} style={{ background:C.cardLt, borderRadius:"10px", padding:"10px", textAlign:"center" }}>
                        <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"20px", color:s.c }}>{s.v}</div>
                        <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", textTransform:"none" }}>{s.l}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize:"11px", color:C.muted, marginTop:"8px" }}>Based on {daysElapsed} day{daysElapsed!==1?"s":""} of pace · refreshes every 5 min</div>
                </div>
              );
            })()}

            {/* ── EARNINGS CARD ── */}
            {(()=>{
              const wkJobs    = (jobs||[]).filter(j=>j.tech_id===tech.id&&j.week_key===wk);
              const wkRevenue = wkJobs.reduce((s,j)=>s+(j.revenue||0),0);
              const wkEndDate = new Date(wk+"T12:00:00Z"); wkEndDate.setUTCDate(wkEndDate.getUTCDate()+6);
              const wkTips    = tipsRangeTotal(tipEntries, tech.id, wk, wkEndDate.toISOString().split("T")[0]);
              if (wkRevenue===0&&wkTips===0) return null;
              const rate       = tech.commission_rate||27;
              const commission = wkRevenue*(rate/100);
              const total      = commission+wkTips;
              return (
                <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px 18px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
                  <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"12px", color:C.green, letterSpacing:"-0.01em", marginBottom:"12px" }}>💵 YOUR EARNINGS — THIS WEEK</div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"8px", marginBottom:"10px" }}>
                    {[
                      { l:"Revenue",             v:`$${wkRevenue.toLocaleString()}`,   c:C.blue  },
                      { l:`Commission (${rate}%)`,v:`$${commission.toFixed(2)}`,        c:C.green },
                      { l:"Tips",                v:`$${wkTips.toFixed(2)}`,            c:C.gold  },
                    ].map(s=>(
                      <div key={s.l} style={{ background:C.cardLt, borderRadius:"10px", padding:"10px", textAlign:"center" }}>
                        <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"18px", color:s.c }}>{s.v}</div>
                        <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", textTransform:"none", marginTop:"3px" }}>{s.l}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ background:`${C.green}15`, border:`1px solid ${C.green}44`, borderRadius:"10px", padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div style={{ fontSize:"11px", color:C.green, fontFamily:FONT, fontWeight:"700", letterSpacing:"-0.01em" }}>Total this week</div>
                    <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"26px", color:C.black }}>${total.toFixed(2)}</div>
                  </div>
                </div>
              );
            })()}

            {/* Team info — always show if assigned, show unassigned message if not */}
            {(() => {
              const myLead = techs.find(t=>t.id===tech.team_lead_id);
              const myTeam = tech.is_lead
                ? techs.filter(t=>t.team_lead_id===tech.id)
                : techs.filter(t=>t.team_lead_id===tech.team_lead_id&&t.id!==tech.id);
              const teamName = tech.is_lead ? tech.team_name : myLead?.team_name;
              const isOnTeam = tech.team_lead_id || tech.is_lead;

              return (
                <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"14px 16px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"10px" }}>
                    <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"13px", color:C.gold, letterSpacing:"-0.01em" }}>👥 YOUR TEAM</div>
                    {teamName&&<div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"16px", color:C.black }}>{teamName}</div>}
                  </div>

                  {!isOnTeam&&(
                    <div style={{ fontSize:"12px", color:C.muted }}>You haven't been assigned to a team yet — check with your manager.</div>
                  )}

                  {isOnTeam&&(
                    <>
                      {myLead&&(
                        <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"8px", paddingBottom:"8px", borderBottom:`1px solid ${C.border}` }}>
                          <div style={{ width:"32px", height:"32px", borderRadius:"50%", background:`${C.gold}22`, border:`1px solid ${C.gold}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"11px", fontFamily:FONT, fontWeight:"600", color:C.gold }}>{myLead.avatar}</div>
                          <div>
                            <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"14px", color:C.black }}>{myLead.name}</div>
                            <div style={{ fontSize:"11px", color:C.gold, fontFamily:FONT, fontWeight:"700", letterSpacing:"-0.01em" }}>Team lead</div>
                          </div>
                        </div>
                      )}
                      {tech.is_lead&&(
                        <div style={{ fontSize:"11px", color:C.gold, fontFamily:FONT, fontWeight:"600", marginBottom:"8px", letterSpacing:"-0.01em" }}>👑 YOU ARE THE TEAM LEAD</div>
                      )}
                      <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
                        {myTeam.map(m=>(
                          <div key={m.id} style={{ background:C.cardLt, border:`1px solid ${C.border}`, borderRadius:"20px", padding:"4px 12px" }}>
                            <span style={{ fontSize:"11px", fontFamily:FONT, fontWeight:"700", color:C.black }}>{m.name}</span>
                          </div>
                        ))}
                        {myTeam.length===0&&<div style={{ fontSize:"12px", color:C.muted }}>No teammates assigned yet</div>}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${tier.color}`, borderRadius:"16px", padding:"16px 18px" }}>
              <Label color={tier.color}>Points Breakdown</Label>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"8px" }}>
                {[
                  {l:"🏅 Badges",    v:tt.badgePts,   c:C.purple},
                  {l:"💰 Upsells",   v:tt.upsellPts,  c:C.green},
                  {l:"🔄 Switchovers",  v:tt.switchPts,  c:C.blue},
                  {l:"⭐ Reviews",   v:tt.reviewPts,  c:C.gold},
                  ...(tt.callbackCount>0?[{l:`📞 Callbacks (${tt.callbackCount})`, v:tt.callbackPts, c:"#ff3b30"}]:[]),
                  ...(tech.is_lead?(()=>{ const {overridePts,overridePct,allTeamHit,partialHit}=calcTeamOverride(tech,techs,upsells,switchovers,reviews,callbacks||[],q,jobs); const active=allTeamHit||partialHit; return [{l:`👥 Team Override (${active?Math.round(overridePct*100)+"% unlocked":"locked"})`,v:active?`+${overridePts}`:"—",c:active?C.gold:C.muted}]; })():[]),
                ].map(item=>(
                  <div key={item.l} style={{ background:C.cardLt, borderRadius:"8px", padding:"10px 12px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:"12px", color:C.muted }}>{item.l}</span>
                    <span style={{ fontFamily:FONT, fontWeight:"700", fontSize:"18px", color:item.c }}>{item.v.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
            {tech.badges.length>0&&(
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px 18px" }}>
                <Label>My Badges</Label>
                <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
                  {ALL_BADGE_DEFS.filter(b=>tech.badges?.includes(b.id)).map(b=>(
                    <div key={b.id} style={{ background:`${C.blue}18`, border:`1px solid ${C.blue}44`, borderRadius:"8px", padding:"6px 10px", display:"flex", alignItems:"center", gap:"6px" }}>
                      <span style={{ fontSize:"16px" }}>{b.icon}</span>
                      <div>
                        <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"12px", color:C.black }}>{b.name}</div>
                        <div style={{ fontSize:"11px", color:C.blue, fontFamily:FONT, fontWeight:"700" }}>+{b.pts} PTS</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {tab==="timesheet"&&<TimeSheetTab tech={tech} techs={techs} timeEntries={timeEntries} vehicles={vehicles} truckAssignments={truckAssignments} refreshAll={refreshAll} showToast={showToast} nowTick={nowTick}/>}
        {tab==="reports"&&<ReportsTab techs={techs} jobs={jobs||[]} upsells={upsells||[]} switchovers={switchovers||[]} timeEntries={timeEntries} tipEntries={tipEntries} techId={tech.id}/>}
        {tab==="leaderboard"&&<Leaderboard techs={techs} jobs={jobs||[]} upsells={upsells} reviews={reviews} callbacks={callbacks||[]} switchovers={switchovers} timeEntries={timeEntries}/>}
        {tab==="badges"&&<BadgeGrid earned={tech.badges}/>}
        {tab==="upsells"&&<UpsellLeaderboard techs={techs} upsells={upsells} jobs={jobs||[]} currentId={tech.id}/>}
        {tab==="switchovers"&&<SwitchoverLeaderboard techs={techs} switchovers={switchovers} currentId={tech.id}/>}
        {tab==="reviews"&&<ReviewLeaderboard techs={techs} reviews={reviews} currentId={tech.id}/>}
        {tab==="total"&&<TotalLeaderboard techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews} callbacks={callbacks||[]} jobs={jobs}/>}
        {tab==="journey"&&(
          <div>
            <div style={{ fontSize:"13px", color:C.muted, marginBottom:"16px" }}>Tap any card to expand full breakdown.</div>
            <JourneyBoard techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews} quota={q} callbacks={callbacks||[]} jobs={jobs}/>
          </div>
        )}
        {tab==="incentive"&&(
          <div>
            <div style={{ fontSize:"13px", color:C.muted, marginBottom:"16px" }}>Your personal progress toward each reward tier.</div>
            <IncentiveBoard techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews} callbacks={callbacks||[]} currentId={tech.id} jobs={jobs}/>
          </div>
        )}
        {tab==="myteam"&&(
          <TeamLeadPanel tech={tech} techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews} callbacks={callbacks||[]} quota={q} jobs={jobs}/>
        )}
        {tab==="training"&&<PerfectDayTrainingPanel tech={tech} techs={techs}/>}
        {tab==="forms"&&<FormsTab me={tech} role="tech"/>}
        {tab==="auditscores"&&<AuditScoresTab techs={techs} token={token} techId={tech.id} jobs={jobs||[]} callbacks={callbacks||[]} reviews={reviews||[]} switchovers={switchovers||[]} quota={q}/>}
        {tab==="mysales"&&SALES_SELF_VIEW[tech.id]&&<SalesTab token={token} onlyRep={SALES_SELF_VIEW[tech.id]}/>}
        {tab==="callbacks"&&CALLBACK_ENTRY_TECHS.has(tech.id)&&<CallbacksPanel techs={techs} jobs={jobs||[]} callbacks={callbacks||[]} refreshAll={refreshAll} showToast={showToast}/>}
      </div>
      {toast&&(
        <div style={{ position:"fixed", bottom:"24px", left:"50%", transform:"translateX(-50%)", background:toast.ok?C.green:"#ff3b30", color:C.white, padding:"12px 28px", borderRadius:"24px", fontSize:"14px", fontWeight:"700", zIndex:999, whiteSpace:"nowrap", fontFamily:FONT, letterSpacing:"-0.01em", fontStyle:"normal", boxShadow:"0 4px 20px rgba(0,0,0,0.15)" }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}




// ─── DELETE TAB ───────────────────────────────────────────────────────────────
function DeleteTab({ techs, upsells, switchovers, reviews, saving, setSaving, refreshAll, showToast }) {
  const [section, setSection] = useState("upsells");
  const [filterTech, setFilterTech] = useState("");

  const selStyle = { background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"8px 12px", borderRadius:"16px", fontSize:"13px", fontFamily:FONT, width:"100%", cursor:"pointer" };

  async function deleteUpsell(id) {
    if (!window.confirm("Delete this upsell entry?")) return;
    setSaving(true);
    try { await sb(`upsells?id=eq.${id}`,{method:"DELETE",prefer:"return=minimal"}); await refreshAll(); showToast("Upsell deleted"); }
    catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function deleteSwitchover(id) {
    if (!window.confirm("Delete this switchover?")) return;
    setSaving(true);
    try { await sb(`switchovers?id=eq.${id}`,{method:"DELETE",prefer:"return=minimal"}); await refreshAll(); showToast("Switchover deleted"); }
    catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function deleteReview(id) {
    if (!window.confirm("Delete this review entry?")) return;
    setSaving(true);
    try { await sb(`reviews?id=eq.${id}`,{method:"DELETE",prefer:"return=minimal"}); await refreshAll(); showToast("Review entry deleted"); }
    catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }

  const filteredUpsells = upsells.filter(u=>!filterTech||u.tech_id===filterTech).sort((a,b)=>b.week_key?.localeCompare(a.week_key||"")||0);
  const filteredSwitchovers = switchovers.filter(s=>!filterTech||s.tech_id===filterTech).sort((a,b)=>(b.created_at||"").localeCompare(a.created_at||""));
  const filteredReviews = reviews.filter(r=>!filterTech||r.tech_id===filterTech).sort((a,b)=>b.month_key?.localeCompare(a.month_key||"")||0);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
      <div style={{ background:`#ff444418`, border:`1px solid #ff444444`, borderRadius:"16px", padding:"12px 16px", fontSize:"12px", color:C.muted }}>
        <span style={{ color:C.red, fontFamily:FONT, fontWeight:"600" }}>⚠️ DELETE ZONE</span> — Deletions are permanent. Use this to remove test data or mistakes.
      </div>

      {/* Section picker */}
      <div style={{ display:"flex", gap:"8px" }}>
        {[["upsells","💰 Upsells"],["switchovers","🔄 Switchovers"],["reviews","⭐ Reviews"]].map(([id,label])=>(
          <button key={id} onClick={()=>setSection(id)} style={{ background:section===id?C.red:C.card, border:`1px solid ${section===id?C.red:C.border}`, color:section===id?C.white:C.muted, padding:"8px 14px", borderRadius:"8px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"11px", letterSpacing:"-0.01em" }}>{label}</button>
        ))}
      </div>

      {/* Filter by tech */}
      <select value={filterTech} onChange={e=>setFilterTech(e.target.value)} style={selStyle}>
        <option value="">All Techs</option>
        {techs.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
      </select>

      {/* UPSELLS */}
      {section==="upsells"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
          {filteredUpsells.length===0&&<div style={{ fontSize:"13px", color:C.muted, padding:"12px" }}>No upsell entries found.</div>}
          {filteredUpsells.map(u=>{
            const tech=techs.find(t=>t.id===u.tech_id);
            return (
              <div key={u.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px" }}>
                <div>
                  <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"15px", color:C.black }}>{tech?.name}</div>
                  <div style={{ fontSize:"12px", color:C.muted }}>{formatWeekLabel(u.week_key)} · <span style={{ color:C.green, fontWeight:"700" }}>${u.amount?.toLocaleString()}</span></div>
                </div>
                <button onClick={()=>deleteUpsell(u.id)} disabled={saving} style={{ background:"none", border:`1px solid ${C.red}`, color:C.red, padding:"6px 12px", borderRadius:"8px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"12px", letterSpacing:"-0.01em", flexShrink:0 }}>Delete</button>
              </div>
            );
          })}
        </div>
      )}

      {/* SWITCHOVERS */}
      {section==="switchovers"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
          {filteredSwitchovers.length===0&&<div style={{ fontSize:"13px", color:C.muted, padding:"12px" }}>No switchover entries found.</div>}
          {filteredSwitchovers.map(s=>{
            const tech=techs.find(t=>t.id===s.tech_id);
            const plan=PLAN_MAP[s.plan_id];
            const pc=PLAN_COLORS[s.plan_id]||C.muted;
            return (
              <div key={s.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px" }}>
                <div>
                  <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"15px", color:C.black }}>{tech?.name}</div>
                  <div style={{ fontSize:"12px", color:C.muted }}>{formatWeekLabel(s.week_key)} · <span style={{ color:pc, fontWeight:"700" }}>{plan?.label||s.plan_id} · +{plan?.pts||0}pts</span></div>
                </div>
                <button onClick={()=>deleteSwitchover(s.id)} disabled={saving} style={{ background:"none", border:`1px solid ${C.red}`, color:C.red, padding:"6px 12px", borderRadius:"8px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"12px", letterSpacing:"-0.01em", flexShrink:0 }}>Delete</button>
              </div>
            );
          })}
        </div>
      )}

      {/* REVIEWS */}
      {section==="reviews"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
          {filteredReviews.length===0&&<div style={{ fontSize:"13px", color:C.muted, padding:"12px" }}>No review entries found.</div>}
          {filteredReviews.map(r=>{
            const tech=techs.find(t=>t.id===r.tech_id);
            return (
              <div key={r.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px" }}>
                <div>
                  <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"15px", color:C.black }}>{tech?.name}</div>
                  <div style={{ fontSize:"12px", color:C.muted }}>{formatMonthLabel(r.month_key)} · <span style={{ color:C.gold, fontWeight:"700" }}>{r.count} ⭐</span></div>
                </div>
                <button onClick={()=>deleteReview(r.id)} disabled={saving} style={{ background:"none", border:`1px solid ${C.red}`, color:C.red, padding:"6px 12px", borderRadius:"8px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"12px", letterSpacing:"-0.01em", flexShrink:0 }}>Delete</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── ADMIN TIME SHEET ──────────────────────────────────────────────────────────
const MONTH_NAMES = { january:0, jan:0, february:1, feb:1, march:2, mar:2, april:3, apr:3, may:4, june:5, jun:5, july:6, jul:6, august:7, aug:7, september:8, sep:8, sept:8, october:9, oct:9, november:10, nov:10, december:11, dec:11 };
// Owner/manager fixes to a tech's clock-ins: edit a session's in/out times,
// add a missed session, or delete a wrong one. Hours feed Payroll (training
// pay), so the Field Supervisor can't edit his own time here.
function AdminTimeEditor({ techs, timeEntries, start, end, refreshAll, showToast, lockedTechId=null }) {
  const list = techs.filter(t => t.is_active!==false && t.title!=="owner").sort((a,b)=>a.name.localeCompare(b.name));
  const [techId, setTechId] = useState("");
  const [editing, setEditing] = useState(null);           // entry id
  const [form, setForm] = useState({ in:"", out:"" });
  const [add, setAdd] = useState({ date:"", in:"", out:"" });
  const [busy, setBusy] = useState(false);
  const locked = techId && techId===lockedTechId;
  const entries = timeEntries.filter(e => e.tech_id===techId && e.work_date>=start && e.work_date<=end)
    .sort((a,b) => b.work_date.localeCompare(a.work_date) || a.clock_in.localeCompare(b.clock_in));
  const days = [...new Set(entries.map(e => e.work_date))];
  const inp = { background:C.white, border:`1px solid ${C.border}`, color:C.black, padding:"8px", borderRadius:"10px", fontSize:"13px" };
  const small = (bg, fg=C.white) => ({ background:bg, border:"none", color:fg, padding:"6px 12px", borderRadius:"10px", cursor:"pointer", fontSize:"12px", fontWeight:"700" });

  function toIsoPair(date, tin, tout) {
    if (!tin) throw new Error("Clock-in time is required");
    const inIso = mtTimeToIso(date, tin);
    if (!tout) return { clock_in:inIso, clock_out:null };
    let outIso = mtTimeToIso(date, tout);
    if (outIso <= inIso) throw new Error("Clock-out has to be after clock-in");
    return { clock_in:inIso, clock_out:outIso };
  }
  async function save(e) {
    setBusy(true);
    try {
      await sb(`time_entries?id=eq.${e.id}`, { method:"PATCH", prefer:"return=minimal", body:JSON.stringify({ ...toIsoPair(e.work_date, form.in, form.out), auto_closed:false }) });
      await refreshAll(); setEditing(null); showToast("✅ Session updated");
    } catch(err) { showToast("Error: "+err.message, false); }
    setBusy(false);
  }
  async function remove(e) {
    if (!window.confirm(`Delete this session (${isoToMtTimeInput(e.clock_in)}–${e.clock_out ? isoToMtTimeInput(e.clock_out) : "open"} on ${fmtShortDate(e.work_date)})?`)) return;
    setBusy(true);
    try { await sb(`time_entries?id=eq.${e.id}`, { method:"DELETE", prefer:"return=minimal" }); await refreshAll(); showToast("Session deleted"); }
    catch(err) { showToast("Error: "+err.message, false); }
    setBusy(false);
  }
  async function addSession() {
    if (!add.date) return showToast("Pick a date", false);
    if (!add.out) return showToast("Add a clock-out time", false);
    setBusy(true);
    try {
      await sb("time_entries", { method:"POST", prefer:"return=minimal", body:JSON.stringify({ tech_id:techId, work_date:add.date, ...toIsoPair(add.date, add.in, add.out) }) });
      await refreshAll(); setAdd({ date:"", in:"", out:"" }); showToast("✅ Session added");
    } catch(err) { showToast("Error: "+err.message, false); }
    setBusy(false);
  }

  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px 18px", display:"flex", flexDirection:"column", gap:"10px" }}>
      <Label color={C.purple}>✏️ Edit a Tech's Time · {start} → {end}</Label>
      <select value={techId} onChange={e=>{ setTechId(e.target.value); setEditing(null); }} style={{ ...inp, width:"100%" }}>
        <option value="">— Select Tech —</option>
        {list.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {locked && <div style={{ fontSize:"12px", color:C.red }}>You can't edit your own time here — ask an owner.</div>}
      {techId && !locked && (<>
        {days.length===0 && <div style={{ fontSize:"13px", color:C.muted }}>No sessions in this date range. Change the range above, or add one below.</div>}
        {days.map(d => {
          const dayEntries = entries.filter(e => e.work_date===d);
          const total = dayEntries.reduce((s,e)=>s+sessionHours(e),0);
          return (
            <div key={d} style={{ background:C.cardLt, borderRadius:"10px", padding:"10px 12px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:"13px", fontWeight:"700", color:C.black }}>
                <span>{new Date(d+"T12:00:00Z").toLocaleDateString("en-US",{ weekday:"short", month:"short", day:"numeric", timeZone:"UTC" })}</span>
                <span>{total.toFixed(2)}h</span>
              </div>
              {dayEntries.map(e => editing===e.id ? (
                <div key={e.id} style={{ display:"flex", gap:"6px", alignItems:"center", flexWrap:"wrap", marginTop:"6px" }}>
                  <input type="time" value={form.in} onChange={ev=>setForm(f=>({...f,in:ev.target.value}))} style={inp}/>
                  <span style={{ color:C.muted }}>to</span>
                  <input type="time" value={form.out} onChange={ev=>setForm(f=>({...f,out:ev.target.value}))} style={inp}/>
                  <button disabled={busy} onClick={()=>save(e)} style={small(C.green)}>Save</button>
                  <button onClick={()=>setEditing(null)} style={small(C.cardLt, C.muted)}>Cancel</button>
                </div>
              ) : (
                <div key={e.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"8px", fontSize:"13px", color:C.black, marginTop:"6px" }}>
                  <span>{formatMTTime(e.clock_in)} – {e.clock_out ? formatMTTime(e.clock_out) : <span style={{ color:C.gold }}>still clocked in</span>} <span style={{ color:C.muted }}>· {sessionHours(e).toFixed(2)}h{e.auto_closed ? " · auto-closed at midnight" : ""}</span></span>
                  <span style={{ display:"flex", gap:"6px" }}>
                    <button onClick={()=>{ setEditing(e.id); setForm({ in:isoToMtTimeInput(e.clock_in), out:e.clock_out ? isoToMtTimeInput(e.clock_out) : "" }); }} style={small(C.blue)}>Edit</button>
                    <button disabled={busy} onClick={()=>remove(e)} style={small("none", C.red)}>Delete</button>
                  </span>
                </div>
              ))}
            </div>
          );
        })}
        <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:"10px", display:"flex", gap:"6px", alignItems:"center", flexWrap:"wrap" }}>
          <span style={{ fontSize:"12px", color:C.muted }}>Add a missed session:</span>
          <input type="date" value={add.date} max={mtDateStr(Date.now())} onChange={e=>setAdd(a=>({...a,date:e.target.value}))} style={inp}/>
          <input type="time" value={add.in} onChange={e=>setAdd(a=>({...a,in:e.target.value}))} style={inp}/>
          <span style={{ color:C.muted }}>to</span>
          <input type="time" value={add.out} onChange={e=>setAdd(a=>({...a,out:e.target.value}))} style={inp}/>
          <button disabled={busy} onClick={addSession} style={small(C.purple)}>Add</button>
        </div>
      </>)}
    </div>
  );
}

function AdminTimeSheetTab({ techs, timeEntries, refreshAll, showToast, lockedTechId=null }) {
  const [rangePreset, setRangePreset] = useState("wtd");
  const [cStart, setCStart] = useState("");
  const [cEnd, setCEnd] = useState("");
  const { start, end } = getDateRangeBounds(rangePreset, cStart, cEnd);

  // Same active/archived + owner-exclusion pattern used everywhere else
  // (OperationsProgressTab, TechDashboard's activeTechs) -- Truxton/Casey
  // occasionally clocking in shouldn't appear on a per-tech hours ranking.
  const rankedTechs = techs
    .filter(t => t.is_active !== false && t.title !== "owner")
    .map(t => ({ ...t, hours: rangeHoursTotal(timeEntries, t.id, start, end) }))
    .filter(t => t.hours > 0)
    .sort((a,b) => b.hours - a.hours);

  const [bulkText, setBulkText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  async function runImport() {
    setImporting(true);
    setImportResult(null);
    const lines = bulkText.split("\n").map(l=>l.trim()).filter(Boolean);
    const techByName = {};
    techs.forEach(t => { techByName[t.name.toLowerCase()] = t; });
    const nowYear = new Date().getFullYear();
    const rows = [];
    const errors = [];

    lines.forEach((line, i) => {
      // Format 2 — weekly total, historical June-1-to-present backfill only:
      // "Name: Month Day TotalHours" e.g. "JaMuar Hill: July 4 37.18". No
      // daily breakdown exists for this data, so it's spread evenly across 4
      // consecutive days (Mon-Thu) starting at WeekStartDate, one synthetic
      // 8am-start session per day -- keeps daily numbers plausible while
      // still rolling up to the correct weekly total for Rev/Hr etc.
      const weeklyMatch = line.match(/^(.+?):\s*([A-Za-z]+)\s+(\d{1,2})\s+([\d.]+)\s*$/);
      if (weeklyMatch) {
        const [, rawName, monthName, dayStr, hoursStr] = weeklyMatch;
        const tech = techByName[rawName.trim().toLowerCase()];
        if (!tech) { errors.push(`Line ${i+1}: no tech named "${rawName.trim()}"`); return; }
        const monthIdx = MONTH_NAMES[monthName.toLowerCase()];
        if (monthIdx === undefined) { errors.push(`Line ${i+1}: "${monthName}" isn't a recognized month name`); return; }
        const totalHours = parseFloat(hoursStr);
        if (isNaN(totalHours) || totalHours <= 0) { errors.push(`Line ${i+1}: invalid hours "${hoursStr}"`); return; }
        const weekStart = new Date(nowYear, monthIdx, parseInt(dayStr,10));
        if (weekStart.getDay() !== 0) {
          const actualDay = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][weekStart.getDay()];
          errors.push(`Line ${i+1}: "${monthName} ${dayStr}" is a ${actualDay}, not a Sunday — week start dates must be Sundays`);
          return;
        }
        const perDayHours = totalHours / 4;
        for (let d = 1; d <= 4; d++) {
          const dayDate = new Date(weekStart); dayDate.setDate(weekStart.getDate()+d);
          const dayStrFmt = `${dayDate.getFullYear()}-${String(dayDate.getMonth()+1).padStart(2,"0")}-${String(dayDate.getDate()).padStart(2,"0")}`;
          const clockIn = mtTimeToIso(dayStrFmt, "08:00");
          const clockOut = new Date(new Date(clockIn).getTime() + perDayHours*3600000).toISOString();
          rows.push({ tech_id: tech.id, work_date: dayStrFmt, clock_in: clockIn, clock_out: clockOut });
        }
        return;
      }

      // Format 1 — per-session: "Name, YYYY-MM-DD, HH:MM, HH:MM"
      const parts = line.split(",").map(p=>p.trim());
      if (parts.length !== 4) { errors.push(`Line ${i+1}: unrecognized format — expected "Name, YYYY-MM-DD, HH:MM, HH:MM" or "Name: Month Day TotalHours" — "${line}"`); return; }
      const [name, date, inTime, outTime] = parts;
      const tech = techByName[name.toLowerCase()];
      if (!tech) { errors.push(`Line ${i+1}: no tech named "${name}"`); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errors.push(`Line ${i+1}: date must be YYYY-MM-DD, got "${date}"`); return; }
      if (!/^\d{1,2}:\d{2}$/.test(inTime) || !/^\d{1,2}:\d{2}$/.test(outTime)) { errors.push(`Line ${i+1}: times must be 24-hour HH:MM, got "${inTime}" / "${outTime}"`); return; }
      const pad = t => t.length===4 ? "0"+t : t;
      rows.push({ tech_id: tech.id, work_date: date, clock_in: mtTimeToIso(date, pad(inTime)), clock_out: mtTimeToIso(date, pad(outTime)) });
    });

    if (errors.length > 0) { setImportResult({ ok:false, errors }); setImporting(false); return; }
    try {
      await sb("time_entries", { method:"POST", body:JSON.stringify(rows), prefer:"return=minimal" });
      await refreshAll();
      setImportResult({ ok:true, count: rows.length });
      setBulkText("");
      showToast(`✅ Imported ${rows.length} session${rows.length===1?"":"s"}`);
    } catch(e) { setImportResult({ ok:false, errors:[e.message] }); }
    setImporting(false);
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <PageTools tools={[{ id:"import", label:"Bulk Import", icon:"📥", render:()=>(
        <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
          <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"16px", color:C.black }}>Bulk Import — One-Time Backfill</div>
        <div style={{ fontSize:"12px", color:C.muted, display:"flex", flexDirection:"column", gap:"4px" }}>
          <div>Two line formats, mix freely — one entry per line:</div>
          <div>• Per-session: <code>Tech Name, YYYY-MM-DD, HH:MM, HH:MM</code> (24-hour, Mountain Time). Same tech + date twice = two sessions that day (e.g. a lunch break).</div>
          <div>• Weekly total (historical, no daily breakdown available): <code>Tech Name: Month Day TotalHours</code> — day must be a <strong>Sunday</strong> (weeks run Sun–Sat). Spread evenly across 4 synthetic Mon–Thu sessions so daily numbers stay plausible while the weekly total still rolls up correctly.</div>
        </div>
        <textarea value={bulkText} onChange={e=>setBulkText(e.target.value)} rows={8} placeholder={"Riley Lyon, 2026-06-02, 08:15, 16:30\nTom Lorenc, 2026-06-02, 07:30, 15:00\nJaMuar Hill: July 4 37.18"} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"10px", borderRadius:"10px", fontSize:"12px", fontFamily:"monospace", width:"100%", boxSizing:"border-box", resize:"vertical" }}/>
        <button onClick={runImport} disabled={importing||!bulkText.trim()} style={{ background:importing?C.border:C.orange, border:"none", color:C.white, padding:"13px", borderRadius:"16px", cursor:(importing||!bulkText.trim())?"not-allowed":"pointer", fontSize:"13px", fontWeight:"700", letterSpacing:"-0.01em", fontFamily:FONT, width:"100%", textTransform:"none" }}>
          {importing ? "Importing..." : "Import Sessions"}
        </button>
        {importResult && (
          importResult.ok
            ? <div style={{ fontSize:"12px", color:C.green }}>✅ Imported {importResult.count} session{importResult.count===1?"":"s"}.</div>
            : <div style={{ background:"#ef444418", border:"1px solid #ef4444", borderRadius:"10px", padding:"10px", fontSize:"11px", color:"#ff3b30", maxHeight:"200px", overflowY:"auto", display:"flex", flexDirection:"column", gap:"4px" }}>
                {importResult.errors.map((e,i)=><div key={i}>{e}</div>)}
              </div>
        )}
        </div>
      )}]}/>
      <DateRangePicker label="🕒 Time Sheet" color={C.blue} preset={rangePreset} setPreset={setRangePreset} customStart={cStart} setCustomStart={setCStart} customEnd={cEnd} setCustomEnd={setCEnd}>
        <div style={{ fontSize:"11px", color:C.blue, fontFamily:FONT, fontWeight:"700", marginTop:"8px" }}>
          {start} → {end} · {rankedTechs.length} tech{rankedTechs.length!==1?"s":""} with hours
        </div>
      </DateRangePicker>

      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", overflow:"hidden" }}>
        <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}`, background:C.cardLt }}>
          <Label color={C.blue}>🕒 Hours by Tech · {start} → {end}</Label>
        </div>
        <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"8px" }}>
          {rankedTechs.length===0 && <div style={{ fontSize:"13px", color:C.muted, textAlign:"center", padding:"12px" }}>No hours logged in this range.</div>}
          {rankedTechs.map((t,i)=>(
            <div key={t.id} style={{ display:"flex", justifyContent:"space-between" }}>
              <span style={{ fontSize:"13px", color:C.black }}>{medal(i)} {t.name}</span>
              <span style={{ fontFamily:FONT, fontWeight:"600", fontSize:"13px", color:C.black }}>{t.hours.toFixed(2)}h</span>
            </div>
          ))}
        </div>
      </div>

      <AdminTimeEditor techs={techs} timeEntries={timeEntries} start={start} end={end} refreshAll={refreshAll} showToast={showToast} lockedTechId={lockedTechId}/>

    </div>
  );
}

// ─── ADMIN UPSELL ENTRY (with date picker) ────────────────────────────────────
function AdminUpsellEntry({ techs, refreshAll, showToast, upsells, jobs=[] }) {
  const todayDefault = new Date(Date.now() - 6*3600000).toISOString().split("T")[0];
  // Defaults to "custom" pre-filled with the old hardcoded range so existing
  // behavior is unchanged for anyone who doesn't touch the picker -- they
  // also now get Today/WTD/MTD/etc. shortcuts on top.
  const [repairPreset, setRepairPreset] = useState("custom");
  const [repairCStart, setRepairCStart] = useState("2026-06-01");
  const [repairCEnd,   setRepairCEnd]   = useState(todayDefault);
  const { start: repairFrom, end: repairTo } = getDateRangeBounds(repairPreset, repairCStart, repairCEnd);
  const [repairResult, setRepairResult] = useState(null);
  const [repairing, setRepairing] = useState(false);
  const [upsExpanded, setUpsExpanded] = useState(false);

  function exportUpsellsCSV() {
    const rows = repairResult?.jobs || [];
    if (rows.length === 0) return;
    const header = ["Job ID","Tech","Date","Revenue","Discount","Upsell Amount","Invoice Found"];
    const csvRows = rows.map(r => [r.jobId, r.tech, r.date, r.revenue.toFixed(2), r.discount.toFixed(2), r.upsells.toFixed(2), r.invoiceFound ? "Found" : "Fallback"]);
    const csv = [header, ...csvRows].map(row => row.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `upsell-repair_${repairFrom}_to_${repairTo}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function repairFromHCP() {
    setRepairing(true);
    setRepairResult(null);
    try {
      // Split range into 7-day chunks so each call stays under the 26s Netlify timeout
      const chunks = [];
      let cur = new Date(repairFrom + "T12:00:00Z");
      const end = new Date(repairTo + "T12:00:00Z");
      while (cur <= end) {
        const chunkFrom = cur.toISOString().split("T")[0];
        const chunkEnd = new Date(cur);
        chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 6);
        const chunkTo = chunkEnd > end ? repairTo : chunkEnd.toISOString().split("T")[0];
        chunks.push({ from: chunkFrom, to: chunkTo });
        cur.setUTCDate(cur.getUTCDate() + 7);
      }
      let totalUpsells = 0, totalJobs = 0, totalInvMatched = 0, allJobRows = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        showToast(`Scanning week ${i+1} of ${chunks.length}...`);
        const res = await fetch("/.netlify/functions/hcp-upsell-repair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chunk),
        });
        const data = await res.json();
        if (!data.ok) { showToast("Repair failed on week " + chunk.from, false); setRepairing(false); return; }
        totalUpsells += data.upsellsFound || 0;
        totalJobs += data.jobsScanned || 0;
        totalInvMatched += data.invoicesMatched || 0;
        if (data.jobs) allJobRows.push(...data.jobs);
      }
      await refreshAll();
      setRepairResult({ upsellsFound: totalUpsells, jobsScanned: totalJobs, invoicesMatched: totalInvMatched, jobs: allJobRows });
      showToast(`✅ Found ${totalUpsells} upsell${totalUpsells===1?"":"s"} from HCP`);
    } catch(e) { showToast("Error: "+e.message, false); }
    setRepairing(false);
  }

  // What the board shows: its own range (default this month), separate from
  // the repair range inside Tools.
  const [viewPreset, setViewPreset] = useState("mtd");
  const [viewCStart, setViewCStart] = useState("");
  const [viewCEnd, setViewCEnd] = useState("");
  const { start: viewFrom, end: viewTo } = getDateRangeBounds(viewPreset, viewCStart, viewCEnd);

  // Filters by each entry's real completion date (jobs.job_date, joined via
  // hcp_job_id). Manually-entered rows with no hcp_job_id have no date to
  // match and are excluded, surfaced in the note below rather than dropped.
  const jobDateByHcpId = {};
  jobs.forEach(j => { if (j.hcp_job_id && !jobDateByHcpId[j.hcp_job_id]) jobDateByHcpId[j.hcp_job_id] = j.job_date; });
  const upsellsWithDate = (upsells||[]).map(u => ({ ...u, resolvedDate: u.hcp_job_id ? (jobDateByHcpId[u.hcp_job_id] || null) : null }));
  const rangeInRange = upsellsWithDate.filter(u => u.resolvedDate && u.resolvedDate >= viewFrom && u.resolvedDate <= viewTo);
  const noDateEntries = upsellsWithDate.filter(u => !u.resolvedDate);
  const noDateTotal = noDateEntries.reduce((s,u)=>s+(u.amount||0),0);
  const rangeByTech = {};
  rangeInRange.forEach(u => { rangeByTech[u.tech_id] = (rangeByTech[u.tech_id]||0) + (u.amount||0); });
  const rangeRanked = techs.map(t=>({...t, amt: rangeByTech[t.id]||0})).filter(t=>t.amt>0).sort((a,b)=>b.amt-a.amt);
  const teamTotal = rangeRanked.reduce((s,t)=>s+t.amt,0);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
      <PageTools tools={[{ id:"repair", label:"Repair from HCP", icon:"🔧", render:()=>(
        <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
          <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"16px", color:C.black }}>Repair Upsells from HCP</div>
        <div style={{ fontSize:"12px", color:C.muted }}>Scans every "Additional Upgrades" line item across a custom date range and writes the real amounts to the board. Use this to fix missing or wrong upsells.</div>
        <DateRangePicker label="📅 Date Range" color={C.orange} preset={repairPreset} setPreset={setRepairPreset} customStart={repairCStart} setCustomStart={setRepairCStart} customEnd={repairCEnd} setCustomEnd={setRepairCEnd}>
          <div style={{ fontSize:"11px", color:C.orange, fontFamily:FONT, fontWeight:"700", marginTop:"8px" }}>
            {repairFrom} → {repairTo}
          </div>
        </DateRangePicker>
        <button onClick={repairFromHCP} disabled={repairing} style={{ background:repairing?C.border:C.orange, border:"none", color:C.white, padding:"13px", borderRadius:"16px", cursor:repairing?"not-allowed":"pointer", fontSize:"13px", fontWeight:"700", letterSpacing:"-0.01em", fontFamily:FONT, width:"100%", textTransform:"none" }}>
          {repairing ? "Scanning HCP — this may take ~20 sec..." : "Repair Upsells"}
        </button>
        {repairResult && (
          <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
            <div style={{ background:C.cardLt, borderRadius:"10px", padding:"10px 14px", fontSize:"12px", color:C.muted, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:"8px" }}>
              <span>
                Scanned <strong style={{color:C.black}}>{repairResult.jobsScanned}</strong> jobs · matched <strong style={{color:C.black}}>{repairResult.invoicesMatched}</strong> invoices · wrote <strong style={{color:C.orange}}>{repairResult.upsellsFound} upsell{repairResult.upsellsFound===1?"":"s"}</strong> to the board
              </span>
              {repairResult.jobs && repairResult.jobs.length > 0 && (
                <div style={{ display:"flex", gap:"6px" }}>
                  <button onClick={()=>setUpsExpanded(v=>!v)} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"5px 10px", borderRadius:"8px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"11px", letterSpacing:"-0.01em" }}>
                    {upsExpanded ? "Collapse" : "View full report"}
                  </button>
                  <button onClick={exportUpsellsCSV} style={{ background:C.blue, border:"none", color:C.white, padding:"5px 10px", borderRadius:"8px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"11px", letterSpacing:"-0.01em" }}>
                    Export CSV
                  </button>
                </div>
              )}
            </div>
            {repairResult.jobs && repairResult.jobs.length > 0 && (
              <div style={{ overflowX:"auto", maxHeight: upsExpanded ? "none" : "320px", overflowY:"auto", borderRadius:"10px", border:`1px solid ${C.border}` }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"11px", fontFamily:FONT }}>
                  <thead>
                    <tr style={{ background:C.card, position:"sticky", top:0 }}>
                      {["Job ID","Tech","Date","Revenue","Discount","Upsells","Invoice"].map(h => (
                        <th key={h} style={{ padding:"6px 10px", textAlign:"left", color:C.muted, fontWeight:"700", letterSpacing:"-0.01em", fontFamily:FONT, whiteSpace:"nowrap", borderBottom:`1px solid ${C.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {repairResult.jobs.map((row, i) => (
                      <tr key={row.jobId} style={{ background: i%2===0 ? C.cardLt : C.card }}>
                        <td style={{ padding:"5px 10px", color:C.muted, whiteSpace:"nowrap" }}>{row.jobId}</td>
                        <td style={{ padding:"5px 10px", color:C.black, whiteSpace:"nowrap" }}>{row.tech}</td>
                        <td style={{ padding:"5px 10px", color:C.muted, whiteSpace:"nowrap" }}>{row.date}</td>
                        <td style={{ padding:"5px 10px", color:C.green, fontWeight:"700", whiteSpace:"nowrap" }}>${row.revenue.toFixed(2)}</td>
                        <td style={{ padding:"5px 10px", color: row.discount > 0 ? C.orange : C.muted, whiteSpace:"nowrap" }}>{row.discount > 0 ? `-$${row.discount.toFixed(2)}` : "—"}</td>
                        <td style={{ padding:"5px 10px", color: row.upsells > 0 ? C.orange : C.muted, fontWeight: row.upsells > 0 ? "700" : "400", whiteSpace:"nowrap" }}>{row.upsells > 0 ? `$${row.upsells.toFixed(2)}` : "—"}</td>
                        <td style={{ padding:"5px 10px", color: row.invoiceFound ? C.green : C.muted, whiteSpace:"nowrap" }}>{row.invoiceFound ? "✓" : "fallback"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        </div>
      )}]}/>

      <DateRangePicker label="📅 Date Range" preset={viewPreset} setPreset={setViewPreset} customStart={viewCStart} setCustomStart={setViewCStart} customEnd={viewCEnd} setCustomEnd={setViewCEnd}>
        <div style={{ fontSize:"12px", color:C.muted, marginTop:"8px" }}>{fmtShortDate(viewFrom)} – {fmtShortDate(viewTo)} · by job completion date</div>
      </DateRangePicker>

      <ListTitle right={`$${Math.round(teamTotal).toLocaleString()} team total`}>Upsells</ListTitle>
      <RankRows rows={rangeRanked.map(t=>({ id:t.id, name:t.name, value:`$${Math.round(t.amt).toLocaleString()}`, chip:`${Math.round(t.amt*UPSELL_PTS_PER_DOLLAR).toLocaleString()} pts` }))} empty="No upsells in this range."/>
      {noDateEntries.length>0&&(
        <div style={{ fontSize:"12px", color:C.muted, padding:"0 4px" }}>
          {noDateEntries.length} entr{noDateEntries.length!==1?"ies":"y"} totaling ${noDateTotal.toLocaleString()} {noDateEntries.length!==1?"aren't":"isn't"} tied to an HCP job, so {noDateEntries.length!==1?"they're":"it's"} not in any date range.
        </div>
      )}
    </div>
  );
}

// ─── ADMIN REVIEW ENTRY (with month picker) ───────────────────────────────────
function AdminReviewEntry({ techs, reviews, saving, setSaving, refreshAll, showToast }) {
  const mk = getMonthKey();
  const [targetMonth, setTargetMonth] = useState(mk);
  const [form, setForm] = useState({});
  const [rangePreset, setRangePreset] = useState("wtd");
  const [cStart, setCStart] = useState("");
  const [cEnd, setCEnd] = useState("");

  const byMonth = {};
  reviews.forEach(r=>{ byMonth[r.month_key]=(byMonth[r.month_key]||0)+1; });
  const existingMonths = Object.keys(byMonth).sort((a,b)=>b.localeCompare(a));

  const monthData = {};
  reviews.filter(r=>r.month_key===targetMonth).forEach(r=>{ monthData[r.tech_id]=r.count; });

  async function handleSave() {
    setSaving(true);
    try {
      for (const t of techs) {
        const val = parseInt(form[t.id]);
        if (isNaN(val)||val<=0) continue;
        const existing = await sb(`reviews?tech_id=eq.${t.id}&month_key=eq.${targetMonth}&select=id`);
        if (existing&&existing.length>0) await sb(`reviews?id=eq.${existing[0].id}`,{method:"PATCH",body:JSON.stringify({count:val}),prefer:"return=minimal"});
        else await sb("reviews",{method:"POST",body:JSON.stringify({tech_id:t.id,month_key:targetMonth,count:val})});
      }
      await refreshAll();
      showToast("✅ Reviews saved for " + formatMonthLabel(targetMonth) + "!");
      setForm({});
    } catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }

  // Date range — same picker as Reports/Upsells/Switchovers. Reviews are only
  // logged with a month_key ("YYYY-MM"), not an exact day, so range filtering
  // matches by month overlap: any review in a month overlapping the range.
  const { start: rangeStart, end: rangeEnd } = getDateRangeBounds(rangePreset, cStart, cEnd);
  const rangeStartMonth = rangeStart.slice(0, 7);
  const rangeEndMonth   = rangeEnd.slice(0, 7);
  const rangeInRange = reviews.filter(r => r.month_key >= rangeStartMonth && r.month_key <= rangeEndMonth);
  const rangeByTech = {};
  rangeInRange.forEach(r => { rangeByTech[r.tech_id] = (rangeByTech[r.tech_id]||0) + (r.count||0); });
  const rangeRanked = techs
    .map(t => ({ ...t, count: rangeByTech[t.id] || 0 }))
    .filter(t => t.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
      <PageTools tools={[{ id:"log", label:"Log Reviews", icon:"＋", primary:true, render:()=>(
        <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
          <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"16px", color:C.black }}>Log 5-Star Reviews</div>
      <div style={{ fontSize:"12px", color:C.muted }}>+{REVIEW_PTS} pts each · +{REVIEW_BONUS_PTS} bonus at 10+ · Log current or any past month</div>

      <div style={{ background:C.cardLt, borderRadius:"10px", padding:"8px 12px", fontSize:"12px", color:C.muted }}>
        {formatLastEntered(mostRecentTimestamp(reviews)) ? (
          <>Last entered: <strong style={{ color:C.black }}>{formatLastEntered(mostRecentTimestamp(reviews))}</strong> — everything before that is already logged.</>
        ) : "No reviews logged yet."}
      </div>

      <div>
        <div style={{ fontSize:"11px", color:C.muted, marginBottom:"6px" }}>Select month</div>
        <select value={targetMonth} onChange={e=>{ setTargetMonth(e.target.value); setForm({}); }} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"8px 12px", borderRadius:"16px", fontSize:"14px", fontFamily:FONT, fontWeight:"700", width:"100%", cursor:"pointer" }}>
          <option value={mk}>{formatMonthLabel(mk)} — Current</option>
          {existingMonths.filter(m=>m!==mk).map(m=><option key={m} value={m}>{formatMonthLabel(m)}</option>)}
          {/* generate last 12 months as options */}
          {Array.from({length:11},(_,i)=>{
            const d = new Date(); d.setMonth(d.getMonth()-(i+1));
            const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
            return !byMonth[key] ? <option key={key} value={key}>{formatMonthLabel(key)}</option> : null;
          })}
        </select>
      </div>

      <div style={{ background:C.cardLt, borderRadius:"8px", padding:"8px 12px", fontSize:"12px", color:C.gold, fontFamily:FONT, fontWeight:"700" }}>
        Logging for: {formatMonthLabel(targetMonth)}{targetMonth===mk?" (Current Month)":""}
      </div>

      {techs.map(t=>(
        <div key={t.id} style={{ display:"flex", alignItems:"center", gap:"12px" }}>
          <div style={{ width:"150px" }}>
            <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"15px", color:C.black }}>{t.name}</div>
            <div style={{ fontSize:"11px", color:C.muted }}>logged: {monthData[t.id]||0} ⭐</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:"6px", flex:1 }}>
            <span style={{ color:C.gold, fontSize:"16px" }}>⭐</span>
            <input type="number" placeholder={monthData[t.id]||"0"} value={form[t.id]||""} onChange={e=>setForm(f=>({...f,[t.id]:e.target.value}))} style={{ background:C.card, border:`1px solid ${C.border}`, color:C.black, padding:"8px 10px", borderRadius:"16px", fontSize:"14px", fontFamily:FONT, width:"100%", fontWeight:"700" }}/>
          </div>
        </div>
      ))}
      <button onClick={handleSave} disabled={saving} style={{ background:saving?C.border:C.gold, border:"none", color:C.white, padding:"13px", borderRadius:"16px", cursor:saving?"not-allowed":"pointer", fontSize:"13px", fontWeight:"700", letterSpacing:"-0.01em", fontFamily:FONT, width:"100%", textTransform:"none" }}>{saving?"Saving...":"Save Reviews"}</button>
        </div>
      )}]}/>

      <DateRangePicker label="📅 Date Range" preset={rangePreset} setPreset={setRangePreset} customStart={cStart} setCustomStart={setCStart} customEnd={cEnd} setCustomEnd={setCEnd}>
        <div style={{ fontSize:"12px", color:C.muted, marginTop:"8px" }}>{fmtShortDate(rangeStart)} – {fmtShortDate(rangeEnd)} · reviews are logged by month</div>
      </DateRangePicker>

      <ListTitle right={`${rangeRanked.reduce((s,t)=>s+t.count,0)} team total`}>5-Star Reviews</ListTitle>
      <RankRows rows={rangeRanked.map(t=>({ id:t.id, name:t.name, value:`${t.count} ⭐` }))} empty="No reviews logged in this range."/>
    </div>
  );
}

// ─── ADMIN TIP ENTRY ───────────────────────────────────────────────────────────
// Manual entry only — HCP doesn't reliably surface tip data (confirmed: not on
// the invoice, payment, or job objects in any usable way), and the various
// automatic fallbacks that used to run were themselves the source of
// consistently wrong tip numbers. This form is now the only way tips enter
// the system, for both manual use and a future Cowork automation filling the
// same form.
function AdminTipEntry({ techs, tipEntries, refreshAll, showToast }) {
  const todayDefault = new Date(Date.now() - 6*3600000).toISOString().split("T")[0];
  const [form, setForm] = useState({ techId:"", date:todayDefault, amount:"" });
  const [saving, setSaving] = useState(false);

  async function logTip() {
    const amt = parseFloat(form.amount);
    if (!form.techId) return showToast("Select a tech", false);
    if (!form.date) return showToast("Select a date", false);
    if (isNaN(amt) || amt <= 0) return showToast("Enter a valid tip amount", false);
    setSaving(true);
    try {
      await sb("tip_entries", { method:"POST", body:JSON.stringify({ tech_id:form.techId, work_date:form.date, amount:amt }) });
      await refreshAll();
      showToast(`✅ Logged $${amt.toFixed(2)} tip`);
      setForm(f => ({ ...f, amount:"" }));
    } catch(e) { showToast("Error: "+e.message, false); }
    setSaving(false);
  }

  async function deleteTip(id) {
    if (!window.confirm("Delete this tip entry?")) return;
    setSaving(true);
    try {
      await sb(`tip_entries?id=eq.${id}`, { method:"DELETE", prefer:"return=minimal" });
      await refreshAll();
      showToast("Tip entry deleted");
    } catch(e) { showToast("Error: "+e.message, false); }
    setSaving(false);
  }

  const techById = Object.fromEntries(techs.map(t=>[t.id,t]));
  const selStyle = (val) => ({ background:C.cardLt, border:`1px solid ${C.border}`, color:val?C.black:C.muted, padding:"10px 14px", borderRadius:"16px", fontSize:"14px", fontFamily:FONT, fontWeight:"700", width:"100%", boxSizing:"border-box", cursor:"pointer" });

  const [rangePreset, setRangePreset] = useState("mtd");
  const [cStart, setCStart] = useState("");
  const [cEnd, setCEnd] = useState("");
  const { start: rangeStart, end: rangeEnd } = getDateRangeBounds(rangePreset, cStart, cEnd);
  const inRange = tipEntries.filter(t => t.work_date >= rangeStart && t.work_date <= rangeEnd);
  const byTech = {};
  inRange.forEach(t => { byTech[t.tech_id] = (byTech[t.tech_id]||0) + (t.amount||0); });
  const ranked = techs.filter(t=>byTech[t.id]>0).sort((a,b)=>byTech[b.id]-byTech[a.id]);
  const recent = [...inRange].sort((a,b)=>(b.work_date||"").localeCompare(a.work_date||"")||(b.created_at||"").localeCompare(a.created_at||""));

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
      <PageTools tools={[{ id:"log", label:"Log Tip", icon:"＋", primary:true, render:()=>(
        <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
          <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"16px", color:C.black }}>Log a Tip</div>
        <div style={{ fontSize:"12px", color:C.muted }}>Manual entry only — this is the source of truth for tip totals everywhere in the app (Reports, Payroll, etc.).</div>
        <select value={form.techId} onChange={e=>setForm(f=>({...f,techId:e.target.value}))} style={selStyle(form.techId)}>
          <option value="">— Select Tech —</option>
          {techs.filter(t=>t.is_active!==false).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div>
          <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", textTransform:"none", fontFamily:FONT, fontWeight:"700", marginBottom:"6px" }}>Date</div>
          <input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"10px 14px", borderRadius:"16px", fontSize:"14px", fontFamily:FONT, width:"100%", boxSizing:"border-box" }}/>
        </div>
        <div>
          <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", textTransform:"none", fontFamily:FONT, fontWeight:"700", marginBottom:"6px" }}>Amount</div>
          <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
            <span style={{ color:C.gold, fontSize:"16px" }}>$</span>
            <input type="number" min="0" step="0.01" placeholder="e.g. 20.00" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} style={{ flex:1, background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"10px 14px", borderRadius:"16px", fontSize:"16px", fontFamily:FONT, fontWeight:"600", boxSizing:"border-box" }}/>
          </div>
        </div>
        <button onClick={logTip} disabled={saving} style={{ background:saving?C.border:C.blue, border:"none", color:C.white, padding:"13px", borderRadius:"16px", cursor:saving?"not-allowed":"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"13px", letterSpacing:"-0.01em", textTransform:"none" }}>{saving?"Saving...":"Log Tip"}</button>
        </div>
      )}]}/>

      <DateRangePicker label="📅 Date Range" preset={rangePreset} setPreset={setRangePreset} customStart={cStart} setCustomStart={setCStart} customEnd={cEnd} setCustomEnd={setCEnd}>
        <div style={{ fontSize:"12px", color:C.muted, marginTop:"8px" }}>{fmtShortDate(rangeStart)} – {fmtShortDate(rangeEnd)}</div>
      </DateRangePicker>

      <ListTitle right={`$${inRange.reduce((s,t)=>s+(t.amount||0),0).toFixed(2)} team total`}>Tips</ListTitle>
      <RankRows rows={ranked.map(t=>({ id:t.id, name:t.name, value:`$${byTech[t.id].toFixed(2)}` }))} empty="No tips in this range."/>

      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", overflow:"hidden" }}>
        <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}` }}><Label>Tips in this range</Label></div>
        <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"8px" }}>
          {recent.length===0 && <div style={{ fontSize:"13px", color:C.muted, textAlign:"center", padding:"12px" }}>No tips in this range.</div>}
          {recent.map(t=>(
            <div key={t.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontSize:"13px", color:C.black }}>{techById[t.tech_id]?.name||"Unknown"} · {fmtShortDate(t.work_date)}</span>
              <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                <span style={{ fontFamily:FONT, fontWeight:"600", fontSize:"13px", color:C.gold }}>${t.amount.toFixed(2)}</span>
                <button onClick={()=>deleteTip(t.id)} style={{ background:"none", border:"1px solid #ef4444", color:"#ff3b30", padding:"3px 8px", borderRadius:"8px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"11px" }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── RIDE-ALONG SYSTEM ────────────────────────────────────────────────────────
// Covers only the LAST HOUR of a job — the window the ride-along observer is
// actually present for. Items reference RUBRIC_ITEMS_SEED ids (rubric_items table)
// by id rather than duplicating description/script text a second time.
const CHECKLIST_SECTIONS = [
  {
    id: "interior_finish",
    title: "Interior Finish",
    icon: "🧽",
    itemIds: ["item_21", "item_22", "item_23", "item_24", "item_25"],
  },
  {
    id: "exterior_finish",
    title: "Exterior Finish",
    icon: "✨",
    itemIds: ["item_31", "item_32", "item_33", "item_34", "item_35"],
  },
  {
    id: "closeout",
    title: "Client Walkthrough & Close",
    icon: "🤝",
    itemIds: ["item_36", "item_37", "item_38", "item_39"],
    notes: [
      { id:"faults", label:"Technique/script delivery faults — name any:" },
      { id:"wins",   label:"What are they succeeding with?" },
    ],
  },
  {
    id: "job_closeout",
    title: "Job Close-Out",
    icon: "📦",
    itemIds: ["item_43", "item_44", "item_45"],
  },
  {
    id: "next_client",
    title: "Next Client Update",
    icon: "📱",
    itemIds: ["item_46"],
  },
];

// Score = ✅ ÷ (✅ + ❌), N/A excluded. _meta_score_pct's value is a number, not
// "✅"/"❌", so it's naturally excluded from this filter — no special-casing needed.
function scorePctFromChecklist(cl) {
  const vals = Object.values(cl).filter(v => v === "✅" || v === "❌");
  if (!vals.length) return null;
  return Math.round(vals.filter(v => v === "✅").length / vals.length * 100);
}
function scoreColor(pct) {
  if (pct == null) return C.muted;
  if (pct >= 90) return C.green;
  if (pct >= 75) return C.blue;
  return C.red;
}

// Get all upcoming Thursdays
function getThursdays(count = 12) {
  const thursdays = [];
  const now = new Date();
  const day = now.getDay();
  const daysUntilThursday = (4 - day + 7) % 7 || 7;
  let next = new Date(now);
  next.setDate(now.getDate() + daysUntilThursday);
  for (let i = 0; i < count; i++) {
    const d = new Date(next);
    d.setDate(next.getDate() + i * 7);
    thursdays.push(d.toISOString().split("T")[0]);
  }
  return thursdays;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" });
}

function RideAlongTab({ techs, rideAlongs, schedules, onSave, onSaveSchedule, saving }) {
  const [view, setView] = useState("schedule"); // "schedule" | "new" | "history" | "detail"
  const [selectedTech, setSelectedTech] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [checklist, setChecklist] = useState({});
  const [notes, setNotes] = useState({});
  const [generalNotes, setGeneralNotes] = useState("");
  const [viewDetail, setViewDetail] = useState(null);
  const [scheduleMap, setScheduleMap] = useState({});
  const [rubricItems, setRubricItems] = useState([]);
  const [loadingRubric, setLoadingRubric] = useState(true);
  const [expandedScript, setExpandedScript] = useState({});
  const thursdays = getThursdays(12);

  useEffect(() => {
    sb("rubric_items?select=*&order=sort_order")
      .then(items => setRubricItems(items || []))
      .catch(() => setRubricItems([]))
      .finally(() => setLoadingRubric(false));
  }, []);
  const rubricMap = {};
  rubricItems.forEach(r => { rubricMap[r.id] = r; });

  // Load existing schedule into map
  useEffect(() => {
    const map = {};
    schedules.forEach(s => { map[s.date] = s.tech_id; });
    setScheduleMap(map);
  }, [schedules]);

  function resetForm() {
    setChecklist({});
    setNotes({});
    setGeneralNotes("");
    setSelectedTech("");
    setSelectedDate("");
  }

  async function handleSaveRideAlong() {
    if (!selectedTech || !selectedDate) return;
    const scorePct = scorePctFromChecklist(checklist);
    await onSave({
      tech_id: selectedTech,
      date: selectedDate,
      checklist: JSON.stringify({ ...checklist, _meta_score_pct: scorePct }),
      notes: JSON.stringify(notes),
      general_notes: generalNotes,
    });
    resetForm();
    setView("history");
  }

  async function handleScheduleChange(date, techId) {
    const newMap = { ...scheduleMap, [date]: techId };
    setScheduleMap(newMap);
    await onSaveSchedule(date, techId);
  }

  const inp = { background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"10px 14px", borderRadius:"16px", fontSize:"14px", fontFamily:FONT, width:"100%", boxSizing:"border-box", resize:"vertical", minHeight:"80px" };
  const selStyle = (val) => ({ background:C.cardLt, border:`1px solid ${C.border}`, color:val?C.white:C.muted, padding:"10px 14px", borderRadius:"16px", fontSize:"14px", fontFamily:FONT, width:"100%", boxSizing:"border-box", cursor:"pointer" });

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      {/* View switcher */}
      <Segmented options={[["schedule","📅 Schedule"],["new","✏️ New Ride-Along"],["history","📋 History"]]} value={view} onChange={id=>{ setView(id); setViewDetail(null); }}/>

      {/* SCHEDULE VIEW */}
      {view==="schedule"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px 18px" }}>
            <Label color={C.blue}>📅 Thursday Ride-Along Schedule</Label>
            <div style={{ fontSize:"12px", color:C.muted, marginBottom:"14px" }}>Assign a tech to each Thursday. This is your weekly coaching schedule.</div>
            <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
              {thursdays.map(date=>{
                const assignedId = scheduleMap[date];
                const assignedTech = techs.find(t=>t.id===assignedId);
                const isPast = new Date(date) < new Date(new Date().toISOString().split("T")[0]);
                return (
                  <div key={date} style={{ background:C.cardLt, border:`1px solid ${assignedId?C.blue:C.border}`, borderRadius:"16px", padding:"12px 16px", display:"flex", alignItems:"center", gap:"12px", opacity:isPast?0.6:1 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"15px", color:C.black }}>{formatDate(date)}</div>
                      {isPast&&<div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", textTransform:"none" }}>Past</div>}
                    </div>
                    <select
                      value={scheduleMap[date]||""}
                      onChange={e=>handleScheduleChange(date,e.target.value)}
                      style={{ background:C.card, border:`1px solid ${assignedId?C.blue:C.border}`, color:assignedId?C.blue:C.muted, padding:"6px 10px", borderRadius:"8px", fontSize:"13px", fontFamily:FONT, fontWeight:"700", cursor:"pointer", minWidth:"140px" }}
                    >
                      <option value="">— Assign Tech —</option>
                      {techs.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Next up */}
          {(() => {
            const today = new Date().toISOString().split("T")[0];
            const next = thursdays.find(d=>d>=today&&scheduleMap[d]);
            if (!next) return null;
            const tech = techs.find(t=>t.id===scheduleMap[next]);
            return (
              <div style={{ background:`${C.blue}18`, border:`1px solid ${C.blue}44`, borderRadius:"16px", padding:"16px 18px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div>
                  <div style={{ fontSize:"11px", color:C.blue, letterSpacing:"-0.01em", textTransform:"none", fontFamily:FONT, fontWeight:"700", marginBottom:"4px" }}>Next Ride-Along</div>
                  <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"22px", color:C.black }}>{tech?.name}</div>
                  <div style={{ fontSize:"13px", color:C.muted }}>{formatDate(next)}</div>
                </div>
                <button onClick={()=>{ setSelectedTech(scheduleMap[next]); setSelectedDate(next); setView("new"); }} style={{ background:C.blue, border:"none", color:C.white, padding:"10px 18px", borderRadius:"8px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"13px", letterSpacing:"-0.01em" }}>START SESSION →</button>
              </div>
            );
          })()}
        </div>
      )}

      {/* NEW RIDE-ALONG FORM */}
      {view==="new"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px 18px", display:"flex", flexDirection:"column", gap:"12px" }}>
            <Label color={C.green}>✏️ New Ride-Along Session</Label>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px" }}>
              <select value={selectedTech} onChange={e=>setSelectedTech(e.target.value)} style={selStyle(selectedTech)}>
                <option value="">— Select Tech —</option>
                {techs.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:selectedDate?C.white:C.muted, padding:"10px 14px", borderRadius:"16px", fontSize:"14px", fontFamily:FONT, width:"100%", boxSizing:"border-box" }}/>
            </div>
          </div>

          {loadingRubric&&(
            <div style={{ background:C.cardLt, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"14px", fontSize:"13px", color:C.muted }}>Loading checklist items...</div>
          )}

          {!loadingRubric&&CHECKLIST_SECTIONS.map(section=>(
            <div key={section.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderLeft:`3px solid ${C.blue}`, borderRadius:"16px", padding:"16px 18px" }}>
              <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"18px", color:C.black, letterSpacing:"-0.01em", marginBottom:"14px" }}>{section.icon} {section.title.toUpperCase()}</div>
              <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                {section.itemIds.map(itemId=>{
                  const item = rubricMap[itemId];
                  if (!item) return null;
                  const key = section.id+"_"+item.id;
                  return (
                    <div key={item.id} style={{ display:"flex", flexDirection:"column", gap:"2px" }}>
                      <div style={{ display:"flex", alignItems:"flex-start", gap:"12px" }}>
                        <div style={{ display:"flex", gap:"6px", flexShrink:0, marginTop:"2px" }}>
                          {["✅","❌","N/A"].map(val=>(
                            <button key={val} onClick={()=>setChecklist(c=>({...c,[key]:val}))}
                              style={{ background:checklist[key]===val?( val==="✅"?`${C.green}33`:val==="❌"?"#ff444433":"#ffffff22"):C.cardLt, border:`1px solid ${checklist[key]===val?(val==="✅"?C.green:val==="❌"?C.red:C.muted):C.border}`, color:checklist[key]===val?(val==="✅"?C.green:val==="❌"?C.red:C.white):C.muted, padding:"3px 8px", borderRadius:"8px", cursor:"pointer", fontSize:"11px", fontFamily:FONT, fontWeight:"700", whiteSpace:"nowrap" }}>
                              {val}
                            </button>
                          ))}
                        </div>
                        <div style={{ fontSize:"13px", color:C.black, lineHeight:"1.4", paddingTop:"2px" }}>{item.description}</div>
                      </div>
                      {item.has_script&&(
                        <div style={{ marginLeft:"78px" }}>
                          <button onClick={()=>setExpandedScript(s=>({...s,[item.id]:!s[item.id]}))} style={{ background:"none", border:"none", color:C.blue, fontSize:"11px", cursor:"pointer", padding:"2px 0", fontFamily:FONT, fontWeight:"700" }}>
                            {expandedScript[item.id]?"▲ Hide Perfect Day script":"▼ View Perfect Day script"}
                          </button>
                          {expandedScript[item.id]&&(
                            <div style={{ background:C.blueXlt, border:`1px solid ${C.border}`, borderRadius:"10px", padding:"8px 10px", fontSize:"12px", color:C.black, marginTop:"4px", lineHeight:1.5 }}>
                              {item.script_text}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {section.notes?.map(note=>(
                  <div key={note.id} style={{ marginTop:"4px" }}>
                    <div style={{ fontSize:"12px", color:C.muted, marginBottom:"6px" }}>{note.label}</div>
                    <textarea value={notes[section.id+"_"+note.id]||""} onChange={e=>setNotes(n=>({...n,[section.id+"_"+note.id]:e.target.value}))} placeholder="Type notes here..." style={{...inp, minHeight:"64px"}}/>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Live score */}
          {!loadingRubric&&(() => {
            const livePct = scorePctFromChecklist(checklist);
            return (
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${scoreColor(livePct)}`, borderRadius:"16px", padding:"16px 18px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <Label color={scoreColor(livePct)}>📊 Live Score</Label>
                <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"28px", color:scoreColor(livePct) }}>{livePct==null?"—":`${livePct}%`}</div>
              </div>
            );
          })()}

          {/* General notes */}
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderLeft:`3px solid ${C.gold}`, borderRadius:"16px", padding:"16px 18px" }}>
            <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"18px", color:C.black, letterSpacing:"-0.01em", marginBottom:"10px" }}>📝 GENERAL NOTES & COACHING POINTS</div>
            <textarea value={generalNotes} onChange={e=>setGeneralNotes(e.target.value)} placeholder="Overall session notes, things to work on, wins, action items for next ride-along..." style={{...inp, minHeight:"100px"}}/>
          </div>

          <button onClick={handleSaveRideAlong} disabled={saving||!selectedTech||!selectedDate} style={{ background:saving||!selectedTech||!selectedDate?C.border:C.blue, border:"none", color:C.white, padding:"14px", borderRadius:"16px", cursor:saving||!selectedTech||!selectedDate?"not-allowed":"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"14px", letterSpacing:"-0.01em", textTransform:"none" }}>
            {saving?"Saving...":"Save ride-along session"}
          </button>
        </div>
      )}

      {/* HISTORY VIEW */}
      {view==="history"&&!viewDetail&&(
        <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px 18px" }}>
            <Label color={C.purple}>📋 Ride-Along History</Label>
            {rideAlongs.length===0&&<div style={{ fontSize:"13px", color:C.muted }}>No ride-alongs logged yet.</div>}
            {[...rideAlongs].sort((a,b)=>b.date.localeCompare(a.date)).map(ra=>{
              const tech = techs.find(t=>t.id===ra.tech_id);
              const cl = ra.checklist ? JSON.parse(ra.checklist) : {};
              const passed = Object.values(cl).filter(v=>v==="✅").length;
              const failed = Object.values(cl).filter(v=>v==="❌").length;
              const total = Object.values(cl).length;
              const pct = typeof cl._meta_score_pct==="number" ? cl._meta_score_pct : scorePctFromChecklist(cl);
              return (
                <div key={ra.id} onClick={()=>setViewDetail(ra)} style={{ background:C.cardLt, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"14px 16px", marginBottom:"8px", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div>
                    <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"16px", color:C.black }}>{tech?.name}</div>
                    <div style={{ fontSize:"12px", color:C.muted }}>{formatDate(ra.date)}</div>
                    {total>0&&<div style={{ fontSize:"11px", color:C.muted, marginTop:"3px" }}><span style={{ color:C.green }}>✅ {passed}</span> passed · <span style={{ color:C.red }}>❌ {failed}</span> failed</div>}
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                    {pct!=null&&<Pill color={scoreColor(pct)}>{pct}%</Pill>}
                    <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"12px", color:C.blue, letterSpacing:"-0.01em" }}>VIEW →</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* DETAIL VIEW */}
      {view==="history"&&viewDetail&&(
        <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
          <button onClick={()=>setViewDetail(null)} style={{ background:"none", border:`1px solid ${C.border}`, color:C.muted, padding:"8px 16px", borderRadius:"8px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"12px", letterSpacing:"-0.01em", alignSelf:"flex-start" }}>← BACK TO HISTORY</button>
          {(() => {
            const tech = techs.find(t=>t.id===viewDetail.tech_id);
            const cl = viewDetail.checklist ? JSON.parse(viewDetail.checklist) : {};
            const notes = viewDetail.notes ? JSON.parse(viewDetail.notes) : {};
            const pct = typeof cl._meta_score_pct==="number" ? cl._meta_score_pct : scorePctFromChecklist(cl);
            return (
              <>
                <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px 18px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <div>
                    <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"22px", color:C.black }}>{tech?.name}</div>
                    <div style={{ fontSize:"13px", color:C.muted }}>{formatDate(viewDetail.date)}</div>
                  </div>
                  {pct!=null&&<Pill color={scoreColor(pct)}>{pct}% Score</Pill>}
                </div>
                {CHECKLIST_SECTIONS.map(section=>(
                  <div key={section.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderLeft:`3px solid ${C.blue}`, borderRadius:"16px", padding:"16px 18px" }}>
                    <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"16px", color:C.black, letterSpacing:"-0.01em", marginBottom:"12px" }}>{section.icon} {section.title.toUpperCase()}</div>
                    {section.itemIds.map(itemId=>{
                      const item = rubricMap[itemId];
                      if (!item) return null;
                      const val = cl[section.id+"_"+item.id];
                      return (
                        <div key={item.id} style={{ marginBottom:"8px" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                            <span style={{ fontSize:"14px", flexShrink:0 }}>{val||"—"}</span>
                            <span style={{ fontSize:"13px", color:C.black }}>{item.description}</span>
                          </div>
                          {item.has_script&&(
                            <div style={{ marginLeft:"24px" }}>
                              <button onClick={()=>setExpandedScript(s=>({...s,[item.id]:!s[item.id]}))} style={{ background:"none", border:"none", color:C.blue, fontSize:"11px", cursor:"pointer", padding:"2px 0", fontFamily:FONT, fontWeight:"700" }}>
                                {expandedScript[item.id]?"▲ Hide Perfect Day script":"▼ View Perfect Day script"}
                              </button>
                              {expandedScript[item.id]&&(
                                <div style={{ background:C.blueXlt, border:`1px solid ${C.border}`, borderRadius:"10px", padding:"8px 10px", fontSize:"12px", color:C.black, marginTop:"4px", lineHeight:1.5 }}>
                                  {item.script_text}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {section.notes?.map(note=>{
                      const val = notes[section.id+"_"+note.id];
                      if (!val) return null;
                      return (
                        <div key={note.id} style={{ marginTop:"8px", background:C.cardLt, borderRadius:"8px", padding:"10px 12px" }}>
                          <div style={{ fontSize:"11px", color:C.muted, marginBottom:"4px" }}>{note.label}</div>
                          <div style={{ fontSize:"13px", color:C.black, lineHeight:"1.5", whiteSpace:"pre-wrap" }}>{val}</div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                {viewDetail.general_notes&&(
                  <div style={{ background:C.card, border:`1px solid ${C.border}`, borderLeft:`3px solid ${C.gold}`, borderRadius:"16px", padding:"16px 18px" }}>
                    <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"16px", color:C.black, letterSpacing:"-0.01em", marginBottom:"10px" }}>📝 GENERAL NOTES</div>
                    <div style={{ fontSize:"13px", color:C.black, lineHeight:"1.6", whiteSpace:"pre-wrap" }}>{viewDetail.general_notes}</div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ─── EMPLOYEE DEVELOPMENT ────────────────────────────────────────────────────

const RUBRIC_ITEMS_SEED = [
  { id:"item_01", sort_order:1, section:"daily", phase:"night_before", description:"Manual night-before text reminder sent to next day's clients", has_script:true, script_text:"Hey [Client Name] this is [Tech Name] from Skylo Detailing, I am the one who will be doing your car tomorrow! Just wanted to give you one last reminder about the appointment and let you know I'll be there around [9/12/3], and if you could have your personal belongings taken out of the vehicle that would be greatly appreciated, see you tomorrow!" },
  { id:"item_02", sort_order:2, section:"daily", phase:"night_before", description:"Checked schedule/route to confirm first job location and departure time from home/unit", has_script:false, script_text:"" },
  { id:"item_03", sort_order:3, section:"daily", phase:"pre_job", description:"Pre-job checklist completed", has_script:false, script_text:"" },
  { id:"item_04", sort_order:4, section:"daily", phase:"pre_job", description:"Chemicals topped off/full", has_script:false, script_text:"" },
  { id:"item_05", sort_order:5, section:"daily", phase:"pre_job", description:"Equipment, totes, and bucket checked and stocked", has_script:false, script_text:"" },
  { id:"item_06", sort_order:6, section:"daily", phase:"pre_job", description:"Truck stocked with proper towel count", has_script:false, script_text:"" },
  { id:"item_07", sort_order:7, section:"daily", phase:"pre_job", description:"Water tank checked full (topped off if not)", has_script:false, script_text:"" },
  { id:"item_08", sort_order:8, section:"daily", phase:"pre_job", description:"Generator gas checked full (topped off if not)", has_script:false, script_text:"" },
  { id:"item_09", sort_order:9, section:"daily", phase:"pre_job", description:"Departed with enough time to arrive 10 min early to first job", has_script:false, script_text:"" },
  { id:"item_10", sort_order:10, section:"daily", phase:"pre_job", description:"On My Way text sent via HCP automated feature (timing option matching drive time from warehouse)", has_script:true, script_text:"[Tech Name] is scheduled to arrive in [15/30/45] minutes" },
  { id:"item_11", sort_order:11, section:"daily", phase:"arrival", description:"Correct arrival greeting/introduction script used", has_script:true, script_text:"Hey [Client Name], my name is [Tech Name] and I will be the one taking care of your premium detail today. If you could come out we can do the pre-job inspection to make sure we are taking care of everything you wanted today. (If client doesn't come out: tech does the pre-job inspection alone and texts the client about any concerns or upsells found.)" },
  { id:"item_12", sort_order:12, section:"daily", phase:"arrival", description:"Pre-premium-detail inspection walkthrough completed with client, including upsell script if applicable", has_script:true, script_text:"Open all doors and explain what will be done today based on the job's line items. Upsell moment if something is found not on the line items: \"Hey, I noticed there are some [stains on the seat / carpet / pet hair in the carpet] and that will need some extra time and equipment to get that all out. I can go ahead and do that for [$25/$50/$75] today, is that something you'd be interested in?\" If client pushes back: explain the surface will be cleaned as part of the standard detail, but getting it all the way out requires an extra 30-45 minutes and heavier-duty equipment, which is why it's an additional charge." },
  { id:"item_13", sort_order:13, section:"daily", phase:"arrival", description:"Before pics taken", has_script:false, script_text:"" },
  { id:"item_56", sort_order:14, section:"daily", phase:"arrival", description:"Time estimate for the job given", has_script:false, script_text:"" },
  { id:"item_57", sort_order:15, section:"daily", phase:"arrival", description:"Asked order of vehicles, time each vehicle is needed by, and any concerns", has_script:false, script_text:"" },
  { id:"item_14", sort_order:16, section:"daily", phase:"sequencing", description:"Correct interior/exterior order chosen based on weather (exterior first in AM if hot/sunny, exterior last if last job of day)", has_script:false, script_text:"" },
  { id:"item_15", sort_order:17, section:"daily", phase:"cleaning", description:"Trash and floor mats removed", has_script:false, script_text:"" },
  { id:"item_16", sort_order:18, section:"daily", phase:"cleaning", description:"Full vehicle air compressed", has_script:false, script_text:"" },
  { id:"item_17", sort_order:19, section:"daily", phase:"cleaning", description:"Vacuumed (or LVP used if air compressor already cleared majority of dirt/debris)", has_script:false, script_text:"" },
  { id:"item_18", sort_order:20, section:"daily", phase:"cleaning", description:"Interior cleaned starting driver seat, back seat driver side, trunk, back seat passenger side, passenger seat", has_script:false, script_text:"" },
  { id:"item_19", sort_order:21, section:"daily", phase:"mid_job", description:"Mid-job update text sent with before/after photo of dirtiest area", has_script:true, script_text:"Hey [Client Name], your premium detail is coming along well! Here's a before and after of those [stains/issue] we removed in your seats. I should be done in about [time], so if you can be available to come walk through the car with me then that would be awesome!" },
  { id:"item_20", sort_order:22, section:"daily", phase:"mid_job", description:"Timing awareness communicated to next client (early/late notice) if applicable", has_script:false, script_text:"" },
  { id:"item_21", sort_order:23, section:"daily", phase:"interior_finish", description:"Mats dried and returned", has_script:false, script_text:"" },
  { id:"item_22", sort_order:24, section:"daily", phase:"interior_finish", description:"Windows cleaned", has_script:false, script_text:"" },
  { id:"item_23", sort_order:25, section:"daily", phase:"interior_finish", description:"Door jambs cleaned (if exterior is on the job)", has_script:false, script_text:"" },
  { id:"item_24", sort_order:26, section:"daily", phase:"interior_finish", description:"Interior checklist completed", has_script:false, script_text:"" },
  { id:"item_25", sort_order:27, section:"daily", phase:"interior_finish", description:"After pics taken (interior)", has_script:false, script_text:"" },
  { id:"item_26", sort_order:28, section:"daily", phase:"exterior", description:"Pre-rinse completed (mist down, cool and prime surface)", has_script:false, script_text:"" },
  { id:"item_27", sort_order:29, section:"daily", phase:"exterior", description:"Tires sprayed and scrubbed, rinsed off", has_script:false, script_text:"" },
  { id:"item_28", sort_order:30, section:"daily", phase:"exterior", description:"Foam applied (full car if shaded/cool, panel-by-panel if hot)", has_script:false, script_text:"" },
  { id:"item_29", sort_order:31, section:"daily", phase:"exterior", description:"Wash wands used to scrub down full vehicle", has_script:false, script_text:"" },
  { id:"item_30", sort_order:32, section:"daily", phase:"exterior", description:"Rinsed off and thoroughly dried", has_script:false, script_text:"" },
  { id:"item_31", sort_order:33, section:"daily", phase:"exterior", description:"Windows touched up with exterior towel", has_script:false, script_text:"" },
  { id:"item_32", sort_order:34, section:"daily", phase:"exterior", description:"Rims dried, excess water/dirt removed from rims and tire face", has_script:false, script_text:"" },
  { id:"item_33", sort_order:35, section:"daily", phase:"exterior", description:"Tire shine applied", has_script:false, script_text:"" },
  { id:"item_58", sort_order:36, section:"daily", phase:"exterior", description:"Wax applied if needed (after completing the full exterior)", has_script:false, script_text:"" },
  { id:"item_34", sort_order:37, section:"daily", phase:"exterior", description:"Exterior checklist completed", has_script:false, script_text:"" },
  { id:"item_35", sort_order:38, section:"daily", phase:"exterior", description:"After pics taken (exterior), attached in HCP", has_script:false, script_text:"" },
  { id:"item_36", sort_order:39, section:"daily", phase:"closeout", description:"Correct walkthrough script used with client", has_script:true, script_text:"Hey [Client Name], I am just finishing up with a few last-minute touches, could you come out so we can walk through it together? Once they come out: Ok so your premium detail is looking awesome, I want to show you how it came out. If you see anything I missed please point it out so I can get it taken care of, 4 eyes are better than 2. We started off by taking out all the trash from the vehicle, then we did a full air compressor blow-out on your vents, seats, carpets and surfaces to get all the dirt and debris out of there, then we did a full vacuum on the vehicle including seats, carpets, all compartments and the trunk, then we cleaned, disinfected, and protected all hard surfaces such as the dash, console, cupholders, door panels, etc., then we did the interior windows and windshield. Then on the exterior we deep cleaned all the tires, rims, and wheel wells, we did a foam bath with a hand wash that removed all contaminants, bugs, and debris from your paint, touched up the windows, and finished off with a tire dressing on the wheel face." },
  { id:"item_37", sort_order:40, section:"daily", phase:"closeout", description:"Tap-to-pay invoice completed", has_script:false, script_text:"" },
  { id:"item_38", sort_order:41, section:"daily", phase:"closeout", description:"Google review ask made via AirDrop, with a picture added", has_script:true, script_text:"We're doing a competition with our company for a monthly prize of the most Google reviews. If you wouldn't mind leaving me a quick 5-star review it would help me out a lot. I can AirDrop you the link right now. I'll just be cleaning up the equipment, so if you could fill it out and mention my name, that would be amazing!" },
  { id:"item_39", sort_order:42, section:"daily", phase:"closeout", description:"Referral ask made", has_script:true, script_text:"Is there any friends, family, or neighbors that you could think of that would love this service? If so, would you mind giving me their number or address so I could reach out to them? You get $20 off your next service for any referral that books and pays for the detail!" },
  { id:"item_40", sort_order:43, section:"daily", phase:"no_show", description:"30-second video walkthrough recorded and sent (interior: front seats, vacuum/LVP, windows, back area; exterior: rims, tires, wheel wells, windows, grill, back end)", has_script:false, script_text:"" },
  { id:"item_41", sort_order:44, section:"daily", phase:"no_show", description:"Google review link sent via text (same wording as #41)", has_script:true, script_text:"Hey, if you loved your premium detail and thought I did a great job I would love it if you could leave me a 5-star rating on Google, here's the link, and if you just mention my name it would help a ton with a competition we're currently running!" },
  { id:"item_42", sort_order:45, section:"daily", phase:"no_show", description:"Referral ask sent via text (same wording as #42)", has_script:true, script_text:"Is there any friends, family, or neighbors that you could think of that would love this service? If so, would you mind giving me their number or address so I could reach out to them? You get $20 off your next service for any referral that books and pays for the detail!" },
  { id:"item_43", sort_order:46, section:"daily", phase:"job_closeout", description:"3 door hangers placed", has_script:false, script_text:"" },
  { id:"item_44", sort_order:47, section:"daily", phase:"job_closeout", description:"Customer satisfaction card placed", has_script:false, script_text:"" },
  { id:"item_45", sort_order:48, section:"daily", phase:"job_closeout", description:"Photos of door hangers/card attached in HCP", has_script:false, script_text:"" },
  { id:"item_46", sort_order:49, section:"daily", phase:"job_closeout", description:"On My Way text sent to next client", has_script:false, script_text:"" },
  { id:"item_47", sort_order:50, section:"daily", phase:"end_of_day", description:"All trash removed from truck", has_script:false, script_text:"" },
  { id:"item_48", sort_order:51, section:"daily", phase:"end_of_day", description:"All personal belongings removed from truck", has_script:false, script_text:"" },
  { id:"item_49", sort_order:52, section:"daily", phase:"end_of_day", description:"Totes and exterior bucket emptied/cleaned out", has_script:false, script_text:"" },
  { id:"item_50", sort_order:53, section:"daily", phase:"end_of_day", description:"Water tank refilled", has_script:false, script_text:"" },
  { id:"item_51", sort_order:54, section:"daily", phase:"end_of_day", description:"Clean towels returned to correct bin", has_script:false, script_text:"" },
  { id:"item_52", sort_order:55, section:"daily", phase:"end_of_day", description:"Dirty towels placed in correct dirty bin", has_script:false, script_text:"" },
  { id:"item_53", sort_order:56, section:"daily", phase:"end_of_day", description:"Next day's schedule checked", has_script:false, script_text:"" },
  { id:"item_54", sort_order:57, section:"daily", phase:"end_of_day", description:"Night-before texts sent for next day's clients (same script as #1)", has_script:true, script_text:"Hey [Client Name] this is [Tech Name] from Skylo Detailing, I am the one who will be doing your car tomorrow! Just wanted to give you one last reminder about the appointment and let you know I'll be there around [9/12/3], and if you could have your personal belongings taken out of the vehicle that would be greatly appreciated, see you tomorrow!" },
  { id:"item_55", sort_order:58, section:"daily", phase:"end_of_day", description:"First job location confirmed for next day (to plan departure/arrival time)", has_script:false, script_text:"" },
  { id:"misc_01", sort_order:101, section:"misc", phase:"misc_unit", description:"Getting into the unit / opening the garage doors", has_script:true, script_text:"On arrival, the garage and door should be shut and locked.\n\n1. Find the key box hanging from the clear door on the right side. Your trainer will give you the key box code.\n2. Unlock the key box and take the key out.\n3. Unlock the left side black garage door and prop it open so it doesn't lock on you again.\n4. Put the key back into the key box BEFORE entering the unit.\n5. Enter through the left side door you propped open and open the garage from the inside.\n\nWhen you leave, close the garage and exit through the right side garage door." },
  { id:"misc_02", sort_order:102, section:"misc", phase:"misc_unit", description:"Where to park the Mavs", has_script:true, script_text:"If you are standing at the entrance of the garage: Big Bertha goes in the back left of the unit. 4 more Mavs across the back row, 3 Mavs in the 2nd row, then 2 in the 3rd row, then 2 in the front row.\n\nThere is no specific order — when you get back to the unit, fill in the next open space closest to the back of the garage." },
  { id:"misc_03", sort_order:103, section:"misc", phase:"misc_unit", description:"How many towels to take", has_script:true, script_text:"No matter the job, always be prepared for a schedule change, unexpected dirty cars, and upsells.\n\n• LVP: 2–3 per car\n• Exterior: 2 in summer, 3 in winter\n• Window: 1 per car\n• Shmuck: 3 per car\n• Rinseless: 1–2 in summer, at least 3–4 in winter\n• Wax: 1–2" },
  { id:"misc_04", sort_order:104, section:"misc", phase:"misc_unit", description:"Wednesday equipment cleaning — vacuums", has_script:true, script_text:"Unlatch the black latch on both sides of the vacuum. Take off the filter by pulling from the top of the filter. Once it pops off, use the air compressor to blow off all the dirt and debris in an open space outside of the garage.\n\nTo put it back on, push the plastic part on the top of the vacuum through the hole in the top of the filter. Make sure you hear a pop and that it's connected snug." },
  { id:"misc_05", sort_order:105, section:"misc", phase:"misc_unit", description:"Wednesday equipment cleaning — extractors", has_script:true, script_text:"Fill up the extractor with water and put the water line cleaner product into the water tank. Turn the pump on and let it run through the line to clear out any hard water buildup or dried minerals. Empty that tank into a drain or bucket by holding down the trigger.\n\nThen fill a 5-gallon bucket with Dawn dish soap and warm water. Use the vacuum to suck up the water, and empty the black tank out. This cleans any hazardous liquids and buildup (like vomit) out of the extractor hose and tank. Repeat until the bucket is empty.\n\nScrub the vacuum head off so you don't contaminate other vehicles (especially after a biohazard extraction)." },
  { id:"misc_06", sort_order:106, section:"misc", phase:"misc_hcp", description:"HCP: Using the schedule", has_script:true, script_text:"The schedule is where you see your jobs for the day. This is where you access your client's job — their address, phone number, time of the job, line items, etc." },
  { id:"misc_07", sort_order:107, section:"misc", phase:"misc_hcp", description:"HCP: Job flow (On My Way, Start, Finish, Invoice)", has_script:true, script_text:"The job flow is something you are audited on and it needs to be completed on every job: On My Way text, Start, Finish, and Invoice. Make sure these are completed on every job, and on time.\n\nWe use these to track how long jobs are taking, judge how much longer our techs have on jobs, and make sure you get paid for completing the job!" },
  { id:"misc_08", sort_order:108, section:"misc", phase:"misc_hcp", description:"HCP: Create a customer", has_script:true, script_text:"You need a customer to put a job on the schedule — HCP won't let you schedule a job without one.\n\nOn the mobile app's bottom bar there are 5 page options. Tap \"Customer\". A list of every customer shows up. Tap the plus button in the top right corner, select \"Create New Customer\", fill out the information, and tap Save." },
  { id:"misc_09", sort_order:109, section:"misc", phase:"misc_hcp", description:"HCP: Create a job", has_script:true, script_text:"On the Schedule page, tap the plus button in the top right corner and select \"Job\". Fill out all of the information: customer, scheduling, notes, job tags, recurring, line items, checklists, etc." },
  { id:"misc_10", sort_order:110, section:"misc", phase:"misc_hcp", description:"HCP: Putting time off / cover events on the schedule", has_script:true, script_text:"We require you to find a cover for every day you need off and are scheduled to work. Ask someone who isn't already scheduled that day. Once they say yes:\n\n1. In the Schedule section of HCP, tap the plus icon in the top right corner.\n2. Change the time to 8am–5pm.\n3. Change the title to \"Will is off\" — or if you're covering someone, \"Will is covering for Truxton\".\n4. Set the address to \"Wrong Turn Rd Idaho\" — this makes the event red so management can easily see it.\n\nThe person taking your shift (or you taking theirs) does the same. This keeps us fully staffed and makes your day off easy." },
  { id:"misc_11", sort_order:111, section:"misc", phase:"misc_customers", description:"Rainy day procedure", has_script:true, script_text:"Rainy and snowy days are very common in Utah. When it rains, people often try to cancel and push their detail to another day. That's not optimal — it's super hard to book a same-day on rainy days and you'll be out of work.\n\nWhen a client tries to reschedule, use the weather app to your advantage:\n• If the rain will let up within the next few hours, assure them their vehicle will be clean and there's nothing to worry about.\n• If not, ask if they have cover — a garage, covered parking, a parking garage, etc. Washing in the rain isn't the problem, drying it is. If you can get it somewhere dry and covered, you'll be fine.\n• If they have no cover and the rain won't let up, offer to discount the exterior and only do the interior. That way you still have work and are still making money!" },
  { id:"misc_12", sort_order:112, section:"misc", phase:"misc_customers", description:"Answering client questions with confidence", has_script:true, script_text:"Some clients are very concerned with our operations and the chemicals/equipment we use. If you answer with uncertainty, pausing, or \"I don't know,\" they'll be slow to trust you with their vehicle.\n\nThe #1 thing is to always sound confident! Even if you don't know the exact answer, be confident explaining that you can do the job and everything will turn out great. Be knowledgeable enough to answer their questions — and if you have questions, call Will, Zak, Ethan, or Trevor depending on the question and find the answer." },
  { id:"misc_13", sort_order:113, section:"misc", phase:"misc_customers", description:"Google reviews", has_script:true, script_text:"The best time to ask is while collecting payment, after you've walked them through the vehicle — they're happy with the cleaning, they're present, and their phone is already out. Politely ask for a 5-star review and send them the link.\n\nScript: \"We're doing a competition with our company for a monthly prize of the most Google reviews. If you wouldn't mind leaving me a quick 5-star review it would help me out a lot. I can AirDrop you the link right now. I'll just be cleaning up the equipment, so if you could fill it out and mention my name, that would be amazing!\"\n\nClients are always looking for ways to help you because you made their car look amazing and they want to pay the favor back. This is an easy way to do it, so say it confidently!" },
  { id:"misc_14", sort_order:114, section:"misc", phase:"misc_customers", description:"Switchovers", has_script:true, script_text:"Switchovers are a very big way to up your paycheck! Pay for switching a one-time client to a recurring plan:\n\n• Monthly: $40\n• Bi-Monthly: $35\n• Quarterly: $30\n\nAdd an exterior to one of those recurring plans and we add an extra $10 — so Int/Ext Monthly: $50, Bi-Monthly: $45, Quarterly: $40.\n\nThe best way to sell this to a one-time client is the laminated pamphlet that should be in every vehicle. Something visual always helps the client understand.\n\nScript: \"Hey [Client Name], we hope you enjoyed our detail service today. If you're looking to get a premium detail more often as well as save money, I'd like to remind you that we do offer recurring services such as weekly, monthly, bi-monthly, and quarterly plans. For this specific vehicle it would be [weekly …]\"" },
  { id:"misc_15", sort_order:115, section:"misc", phase:"misc_upsells", description:"Upsell / add-on pitch", has_script:true, script_text:"Script for upsells and add-ons:\n\"Hey, I noticed there are some [stains on the seat / carpet / pet hair in the carpet] and that will need some extra time and equipment to get that all out. I can go ahead and do that for [$25/$50/$75] today, is that something you'd be interested in?\"" },
  { id:"misc_16", sort_order:116, section:"misc", phase:"misc_upsells", description:"Carpet/seat shampoo & extraction", has_script:true, script_text:"Carpet/seat shampoo is the most common upsell because it's usually what the customer needs most. If the carpets or seats have deep stains, a shampoo and extraction is definitely needed.\n\nScript: \"Hey, I noticed there are some [stains on the seat / carpet / pet hair in the carpet] and that will need some extra time and equipment to get that all out. I can go ahead and do that for [$25/$50/$75] today, is that something you'd be interested in?\"\n\nFill up the extractor with water and turn the heater on. Once the water is hot:\n1. Get the seat/carpet damp.\n2. Apply the carpet cleaner chemical and let it dwell 1–2 minutes.\n3. Use the flat-head drill brush for carpets and flat parts of the seat, and the cone head for hard-to-reach areas. Agitate the chemical and scrub the dirt and grime out of the surface.\n4. Use the vacuum and steamer on the extractor to steam and extract the surface.\n5. Leave the doors open or the windows cracked to dry out the seats." },
  { id:"misc_17", sort_order:117, section:"misc", phase:"misc_upsells", description:"Headliner shampoo", has_script:true, script_text:"Very similar to any other shampoo. Do this BEFORE anything else on the interior — the chemical and water from the extractor will get everywhere.\n\n1. Use the steamer on the extractor to pre-wet the surface.\n2. Apply the carpet cleaner chemical to the headliner.\n3. Scrub any very noticeable small spots individually with a toothbrush.\n4. Use the flat-head drill brush to scrub the whole headliner.\n5. Use the extractor to pull out the chemical along with the dirt and stains. Repeat until no stains are left.\n6. Wipe down with a dry, clean LVP rag. This helps it dry quicker, and dry without leaving water stains." },
  { id:"misc_18", sort_order:118, section:"misc", phase:"misc_upsells", description:"Pet hair removal", has_script:true, script_text:"For heavy pet hair, make sure the client understands why you're charging more — pet hair is super time-consuming, so we charge more to make it worth your time.\n\n1. Use the air compressor to get out all the dog hair you can.\n2. Use the drill brush with the cone head around all the areas with pet hair.\n3. Use the pumice stone to remove pet hair from the carpets.\n\nAlways use the vacuum on every step to pick up the pet hair while using the other equipment." },
  { id:"misc_19", sort_order:119, section:"misc", phase:"misc_upsells", description:"Deodorization", has_script:true, script_text:"For when the client has a smell they can't get out — after a vomit removal, a long family road trip, spills, dogs, etc.\n\n1. After extracting the spill spot, spray the deodorizer and let it dwell a few minutes.\n2. Extract again and smell the spot. Repeat until no smell is left.\n3. Turn the car on, put the AC on full blast, and push the in-vehicle air recirculation button so the air circulates inside the car.\n4. With the AC off, spray the deodorizer into the air vents and throughout the vehicle.\n5. Turn the AC to full blast, leave the car, and shut all the doors. Let it run 5–10 minutes until the strong deodorizer smell becomes faint.\n6. If you go around the vehicle and there's no smell left, the job is done." },
  { id:"misc_20", sort_order:120, section:"misc", phase:"misc_upsells", description:"Hand wax", has_script:true, script_text:"Script: \"Hey, I noticed we haven't done a hand wax on your exterior in quite some time. We usually recommend every 3–4 months, especially with the harsh weather here in Utah. It will take me an extra 30–45 minutes to get that done. I can go ahead and do that for [$25/$50/$75] today, is that something you'd be interested in?\"\n\nWax is an easy upsell on almost every exterior. Use a clean applicator (yellow, circular) and a clean wax rag (pink microfiber) — dirty equipment leaves streaks everywhere.\n\n• Apply small dots around the wax applicator and tap it lightly and evenly around the panel. Go panel by panel, in straight lines, only on the paint.\n• If it's sunny, don't do more than half the vehicle before wiping off. On a super hot day, especially on a darker vehicle, wipe off ¼ of the way through.\n• Remove with the wax rag in circular motions — more efficient and no streaks.\n• Work in a set order so you don't miss spots (half of hood, half of front bumper, door, quarter panel, etc.). An unwaxed spot is very noticeable.\n• Always bring the car into the sunlight and look it over for missed spots or streaks. In shade or a garage you'll always miss spots you can't see." },
  { id:"misc_21", sort_order:121, section:"misc", phase:"misc_upsells", description:"Tar removal", has_script:true, script_text:"Tar remover is a very strong chemical and should never be left on the paint without being sprayed off, especially in direct sunlight. Always do this before/during the exterior so the car is wet and no chemical is left on the paint.\n\n1. Wet down the spot with tar.\n2. Apply the tar remover.\n3. Scrub the tar off while the chemical is on — shmuck rag for heavy tar, wash mitt for small spots.\n4. Rinse off the spot and everywhere the chemical was applied. No tar or chemical should be left on the vehicle.\n5. Finish the rest of the exterior detail." },
  { id:"misc_22", sort_order:122, section:"misc", phase:"misc_troubleshooting", description:"Troubleshooting: Generator", has_script:false, script_text:"" },
  { id:"misc_23", sort_order:123, section:"misc", phase:"misc_troubleshooting", description:"Troubleshooting: Pressure washer", has_script:false, script_text:"" },
  { id:"misc_24", sort_order:124, section:"misc", phase:"misc_troubleshooting", description:"Troubleshooting: Air compressor", has_script:false, script_text:"" },
  { id:"misc_25", sort_order:125, section:"misc", phase:"misc_troubleshooting", description:"Troubleshooting: Vacuum", has_script:false, script_text:"" },
  { id:"misc_26", sort_order:126, section:"misc", phase:"misc_troubleshooting", description:"Troubleshooting: Extractor", has_script:false, script_text:"" },
];

const PHASE_LABELS = {
  night_before:"Getting Started", pre_job:"Pre-Job", arrival:"Arrival",
  sequencing:"Interior/Exterior Sequencing", cleaning:"Cleaning Sequence",
  mid_job:"Mid-Job Communication", interior_finish:"Interior Finish",
  exterior:"Exterior", closeout:"Client Walkthrough & Close",
  no_show:"Client Not Home Protocol", job_closeout:"Job Close-Out", end_of_day:"End of Day",
  misc_unit:"Unit, Trucks & Towels", misc_hcp:"Housecall Pro", misc_customers:"Clients",
  misc_upsells:"Upsells & Add-Ons", misc_troubleshooting:"Troubleshooting Equipment",
};

const STAGE_CONFIG = {
  classroom:      { label:"Classroom",      color:"#2b9cf0", icon:"📚" },
  field_training: { label:"Field Training", color:"#005fb0", icon:"🔧" },
  cert_pending:   { label:"Cert Pending",   color:"#0077d4", icon:"⏳" },
  cert_passed:    { label:"Certified",      color:"#34c759", icon:"✅" },
  active:         { label:"Active",         color:"#34c759", icon:"⭐" },
  hard_fail:      { label:"Hard Fail",      color:"#ff3b30", icon:"🚫" },
};

const TITLE_LABELS = {
  detail_apprentice:    "Detail Apprentice",
  detail_pro:           "Detail Pro",
  senior_detail_pro:    "Senior Detail Pro",
  lead_detail_pro:      "Lead Detail Pro",
  equipment_coordinator:"Equipment Coordinator",
  field_supervisor:     "Field Supervisor",
  commercial_detail:    "Commercial Detail Pro",
  commercial_sales:     "Commercial Sales",
  sales_booking:        "Sales & Booking",
};
const TRAINER_TITLES = ["lead_detail_pro","equipment_coordinator","field_supervisor"];

async function scheduleCheckins(techId, startDate) {
  const MILESTONES = [
    { milestone:"week_1",  days:7  },
    { milestone:"week_2",  days:14 },
    { milestone:"week_4",  days:28 },
    { milestone:"week_6",  days:42 },
    { milestone:"week_12", days:84 },
  ];
  const base = new Date(startDate + "T12:00:00Z");
  for (const { milestone, days } of MILESTONES) {
    const existing = await sb(`checkins?tech_id=eq.${techId}&milestone=eq.${milestone}&select=id`).catch(()=>[]);
    if (existing && existing.length > 0) continue;
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + days);
    await sb("checkins", { method:"POST", body:JSON.stringify({ tech_id:techId, milestone, scheduled_date:d.toISOString().split("T")[0] }) });
  }
}

// Check-ins (week 1, 2, 4, 6, 12) count from the day a tech finishes
// onboarding, not their hire date. Apprentices have no check-ins until the
// Final Onboarding Cert is signed; anyone hired straight in at another title
// still counts from their start date.
const isInTraining = t => (t.title || "detail_apprentice") === "detail_apprentice" && !t.onboarding_complete_date;
function checkinBaseDate(t) {
  if (t.onboarding_complete_date) return t.onboarding_complete_date;
  return isInTraining(t) ? null : (t.start_date || null);
}

// Training runs day by day: on every training day the trainer goes through
// the whole Perfect Day section with the apprentice (each item checked off,
// or marked N/A when it didn't come up that day), and over the course of
// training every Miscellaneous item gets done MISC_REPS times. Training is
// complete after TRAINING_MIN_DAYS full Perfect Days plus all misc reps.
const TRAINING_MIN_DAYS = 8;
const MISC_REPS = 3;
const TRAINING_PACE = { ahead:"Ahead of pace", on_track:"On track", behind:"Behind pace" };

function trainingProgress(items, checks) {
  const daily = items.filter(i => (i.section || "daily") === "daily");
  const misc = items.filter(i => i.section === "misc");
  const dailyIds = new Set(daily.map(i => i.id)), miscIds = new Set(misc.map(i => i.id));
  const perDay = {}, miscCount = {};
  for (const c of checks) {
    if (dailyIds.has(c.rubric_item_id)) perDay[c.day_date] = (perDay[c.day_date] || 0) + 1;
    else if (miscIds.has(c.rubric_item_id)) miscCount[c.rubric_item_id] = (miscCount[c.rubric_item_id] || 0) + 1;
  }
  const dayCounts = Object.values(perDay);
  const fullDays = daily.length ? dayCounts.filter(n => n >= daily.length).length : 0;
  // Best TRAINING_MIN_DAYS days count toward the bar, so a partial day
  // still moves it but extra days can't push past 100%.
  const dailyDone = dayCounts.sort((a, b) => b - a).slice(0, TRAINING_MIN_DAYS).reduce((s, n) => s + Math.min(n, daily.length), 0);
  const dailyMax = TRAINING_MIN_DAYS * daily.length;
  const miscDone = misc.reduce((s, i) => s + Math.min(miscCount[i.id] || 0, MISC_REPS), 0);
  const miscMax = MISC_REPS * misc.length;
  const max = dailyMax + miscMax;
  return {
    daily, misc, perDay, miscCount, fullDays, dailyDone, dailyMax, miscDone, miscMax,
    pct: max ? Math.round(((dailyDone + miscDone) / max) * 100) : 0,
    complete: daily.length > 0 && fullDays >= TRAINING_MIN_DAYS && miscDone >= miscMax,
  };
}

const fmtDay = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric", timeZone:"UTC" });

// Perfect Day training tracker.
// - Trainers (team leads / trainer titles) pick the apprentice they're
//   training, then check items off day by day and write that day's notes.
// - Everyone else sees their own progress read-only (notes are trainer-only).
// - Admin mode (Development tab) shows one fixed apprentice, editable, with
//   the trainer chosen in the Development tab's "signing off as" picker.
function PerfectDayTrainingPanel({ tech=null, techs=[], admin=false, fixedSubject=null, adminTrainerId="", onChange }) {
  const today = mountainDate(new Date().toISOString());
  const [rubricItems, setRubricItems] = useState([]);
  const [checks, setChecks] = useState([]);
  const [notes, setNotes] = useState([]);
  const [expandedScript, setExpandedScript] = useState({});
  const [loading, setLoading] = useState(true);
  const [subjectId, setSubjectId] = useState(fixedSubject?.id || tech?.id);
  const [day, setDay] = useState(today);
  const [view, setView] = useState("daily");
  const [saving, setSaving] = useState(null);
  const [noteForm, setNoteForm] = useState({});
  const [noteDirty, setNoteDirty] = useState(false);
  const [addingDay, setAddingDay] = useState(false);
  const [selfTest, setSelfTest] = useState(false);

  const isTrainer = admin || !!tech?.is_lead || TRAINER_TITLES.includes(tech?.title);
  const isApprentice = t => t.is_active!==false && t.id!==tech?.id && (t.title||"detail_apprentice")==="detail_apprentice";
  const myTrainees = isTrainer && !admin ? techs.filter(t => isApprentice(t) && (t.team_lead_id===tech.id || t.assigned_trainer_id===tech.id)).sort((x,y)=>x.name.localeCompare(y.name)) : [];
  const otherApprentices = isTrainer && !admin ? techs.filter(t => isApprentice(t) && !myTrainees.includes(t)).sort((x,y)=>x.name.localeCompare(y.name)) : [];
  const subject = fixedSubject || (subjectId===tech?.id ? tech : techs.find(t=>t.id===subjectId)) || tech;
  const training = admin || (subject && tech && subject.id !== tech.id);
  const trainerId = admin ? (adminTrainerId || subject?.assigned_trainer_id || subject?.team_lead_id || null) : tech?.id;
  const techName = id => techs.find(t=>t.id===id)?.name || (id===tech?.id ? tech.name : "a trainer");

  useEffect(() => {
    if (!subject?.id) return;
    setLoading(true);
    Promise.all([
      sb("rubric_items?select=*&order=sort_order"),
      sb(`training_checks?trainee_id=eq.${subject.id}&select=*`),
      training ? sb(`training_day_notes?trainee_id=eq.${subject.id}&select=*&order=day_date.desc`) : Promise.resolve([]),
    ]).then(([items, cks, nts]) => {
      setRubricItems(items || []); setChecks(cks || []); setNotes(nts || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [subject?.id]);

  useEffect(() => {
    setNoteForm(notes.find(n => n.day_date === day) || {});
    setNoteDirty(false);
  }, [day, subject?.id, notes.length]);

  const prog = trainingProgress(rubricItems, checks);
  const dayChecks = {};
  for (const c of checks) if (c.day_date === day) dayChecks[c.rubric_item_id] = c;
  const trainingDays = [...new Set([...checks.map(c => c.day_date), ...notes.map(n => n.day_date)])].sort();
  const dayList = training && !trainingDays.includes(day) ? [...trainingDays, day].sort() : trainingDays;
  const dayNumber = d => trainingDays.filter(x => x <= d).length + (trainingDays.includes(d) ? 0 : 1);
  const dailyToday = prog.daily.filter(i => dayChecks[i.id]).length;

  useEffect(() => {
    // Trainees looking at their own rubric open on their latest training day.
    if (!training && trainingDays.length && !trainingDays.includes(day)) setDay(trainingDays[trainingDays.length - 1]);
  }, [training, trainingDays.length]);

  async function setCheck(item, status) {
    if (!training || saving) return;
    const cur = dayChecks[item.id];
    setSaving(item.id);
    try {
      if (cur && (status === null || cur.status === status)) {
        await sb(`training_checks?id=eq.${cur.id}`, { method:"DELETE", prefer:"return=minimal" });
        setChecks(cs => cs.filter(c => c.id !== cur.id));
      } else {
        const row = { trainee_id:subject.id, day_date:day, rubric_item_id:item.id, status, trainer_id:trainerId };
        const res = await sb("training_checks?on_conflict=trainee_id,day_date,rubric_item_id", { method:"POST", prefer:"resolution=merge-duplicates,return=representation", body:JSON.stringify(row) });
        const saved = res?.[0] || { ...row, id:cur?.id };
        setChecks(cs => [...cs.filter(c => !(c.day_date===day && c.rubric_item_id===item.id)), saved]);
      }
      onChange && onChange();
    } catch(e) { window.alert("Couldn't save: " + e.message); }
    setSaving(null);
  }

  async function saveNotes() {
    setSaving("notes");
    try {
      const row = {
        trainee_id:subject.id, day_date:day, trainer_id:trainerId,
        overall_rating:noteForm.overall_rating || null, pace:noteForm.pace || null,
        jobs_count:noteForm.jobs_count === "" || noteForm.jobs_count == null ? null : Number(noteForm.jobs_count),
        customer_rating:noteForm.customer_rating || null,
        went_well:noteForm.went_well || null, needs_work:noteForm.needs_work || null, focus_tomorrow:noteForm.focus_tomorrow || null,
        incident:!!noteForm.incident, incident_notes:noteForm.incident ? (noteForm.incident_notes || null) : null,
        updated_at:new Date().toISOString(),
      };
      const res = await sb("training_day_notes?on_conflict=trainee_id,day_date", { method:"POST", prefer:"resolution=merge-duplicates,return=representation", body:JSON.stringify(row) });
      const saved = res?.[0] || row;
      setNotes(ns => [saved, ...ns.filter(n => n.day_date !== day)].sort((a,b) => b.day_date.localeCompare(a.day_date)));
      setNoteDirty(false);
    } catch(e) { window.alert("Couldn't save notes: " + e.message); }
    setSaving(null);
  }

  const setNote = (k, v) => { setNoteForm(f => ({ ...f, [k]:v })); setNoteDirty(true); };
  const heading = { fontFamily:FONT, fontWeight:"700", letterSpacing:"-0.01em" };
  const small = { fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", fontFamily:FONT, fontWeight:"600" };
  const inp = { background:C.white, border:`1px solid ${C.border}`, color:C.black, padding:"9px 12px", borderRadius:"10px", fontSize:"14px", fontFamily:FONT, width:"100%", boxSizing:"border-box" };
  const accent = training ? C.purple : C.blue;

  const byPhase = {}, phases = [];
  for (const item of prog.daily) {
    if (!byPhase[item.phase]) { byPhase[item.phase] = []; phases.push(item.phase); }
    byPhase[item.phase].push(item);
  }
  const miscByPhase = {}, miscPhases = [];
  for (const item of prog.misc) {
    const p = item.phase || "misc";
    if (!miscByPhase[p]) { miscByPhase[p] = []; miscPhases.push(p); }
    miscByPhase[p].push(item);
  }

  const scriptToggle = item => item.has_script && (<>
    <button onClick={e => { e.stopPropagation(); setExpandedScript(s => ({...s, [item.id]: !s[item.id]})); }} style={{ background:"none", border:"none", color:C.blue, fontSize:"11px", cursor:"pointer", padding:"2px 0", fontFamily:FONT, fontWeight:"700" }}>
      {expandedScript[item.id] ? "▲ Hide" : item.section==="misc" ? "▼ How to" : "▼ View script"}
    </button>
    {expandedScript[item.id] && <div style={{ background:C.blueXlt, border:`1px solid ${C.border}`, borderRadius:"10px", padding:"8px 10px", fontSize:"12px", color:C.black, marginTop:"4px", lineHeight:1.5, whiteSpace:"pre-wrap" }}>{item.script_text}</div>}
  </>);

  const Stars = ({ k }) => (
    <div style={{ display:"flex", gap:"4px" }}>
      {[1,2,3,4,5].map(n => (
        <button key={n} onClick={() => setNote(k, noteForm[k]===n ? null : n)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:"24px", padding:0, color:(noteForm[k]||0) >= n ? C.gold : C.border, lineHeight:1 }}>★</button>
      ))}
    </div>
  );

  if (!subject) return null;
  const showRoad = !training && !admin && (subject.title || "detail_apprentice") === "detail_apprentice";
  if (selfTest) return <WrittenTestRunner self testKey={selfTest} trainee={subject} onExit={() => setSelfTest(false)}/>;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
      {isTrainer && !admin && (
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"14px 16px" }}>
          <div style={{ ...small, marginBottom:"6px" }}>WHO ARE YOU TRAINING?</div>
          <select value={subjectId} onChange={e=>{ setSubjectId(e.target.value); setDay(today); setView("daily"); }}
            style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"10px 12px", borderRadius:"12px", fontSize:"15px", fontFamily:FONT, fontWeight:"600", width:"100%" }}>
            <option value={tech.id}>My own rubric</option>
            {myTrainees.length>0 && <optgroup label="Apprentices I'm training">{myTrainees.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
            {otherApprentices.length>0 && <optgroup label="Other apprentices">{otherApprentices.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
          </select>
          {myTrainees.length===0 && <div style={{ fontSize:"11px", color:C.muted, marginTop:"6px" }}>No apprentices on your team yet — an admin assigns them in the Teams tab.</div>}
        </div>
      )}

      {/* Progress */}
      <div style={{ background:training?`${C.purple}10`:C.card, border:`1px solid ${training?C.purple:C.border}`, borderRadius:"16px", padding:"16px" }}>
        {training && <div style={{ fontSize:"11px", color:C.purple, letterSpacing:"-0.01em", ...heading, marginBottom:"4px" }}>Training</div>}
        <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:"10px", marginBottom:"8px" }}>
          <div style={{ ...heading, fontSize:"22px", color:C.black, letterSpacing:0 }}>{training ? subject.name : "Perfect Day Training"}</div>
          <div style={{ ...heading, fontSize:"28px", color:prog.complete ? C.green : accent, letterSpacing:0 }}>{prog.pct}%</div>
        </div>
        <Bar pct={prog.pct} color={prog.complete ? C.green : accent} h={12}/>
        <div style={{ fontSize:"12px", color:prog.complete ? C.green : C.muted, marginTop:"6px", fontWeight:prog.complete?"700":"400" }}>
          {prog.complete ? "✅ Field training complete — on to the written test" : `${trainingDays.length} training day${trainingDays.length===1?"":"s"} logged · minimum ${TRAINING_MIN_DAYS}`}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px", marginTop:"14px" }}>
          <div>
            <div style={small}>PERFECT DAY · {prog.fullDays}/{TRAINING_MIN_DAYS} FULL DAYS</div>
            <div style={{ display:"flex", gap:"3px", marginTop:"6px" }}>
              {Array.from({ length:TRAINING_MIN_DAYS }, (_, i) => <div key={i} style={{ flex:1, height:"8px", borderRadius:"3px", background:i < prog.fullDays ? C.green : C.border }}/>)}
            </div>
          </div>
          <div>
            <div style={small}>MISCELLANEOUS · {prog.miscDone}/{prog.miscMax} REPS</div>
            <div style={{ marginTop:"6px" }}><Bar pct={prog.miscMax ? (prog.miscDone/prog.miscMax)*100 : 0} color={prog.miscMax && prog.miscDone>=prog.miscMax ? C.green : C.gold} h={8}/></div>
            {prog.misc.length===0 && <div style={{ fontSize:"11px", color:C.muted, marginTop:"3px" }}>No misc items yet</div>}
          </div>
        </div>
      </div>

      {showRoad && !loading && <ApprenticeFinalDay tech={subject} prog={prog} onStartTest={key => setSelfTest(key)}/>}
      {loading && <div style={{ color:C.muted, padding:"16px" }}>Loading training progress...</div>}
      {!loading && rubricItems.length === 0 && (
        <div style={{ background:C.cardLt, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"14px", fontSize:"13px", color:C.muted }}>
          Rubric items not seeded yet. Ask an admin to seed them in the Development tab.
        </div>
      )}

      {!loading && rubricItems.length > 0 && (<>
        {/* Day picker */}
        {(training || dayList.length > 0) && (
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"12px 14px" }}>
            <div style={{ ...small, marginBottom:"8px" }}>Training day</div>
            <div style={{ display:"flex", gap:"6px", overflowX:"auto", paddingBottom:"4px" }}>
              {dayList.map(d => {
                const n = prog.perDay[d] || 0, full = prog.daily.length && n >= prog.daily.length, on = d === day;
                return (
                  <button key={d} onClick={() => setDay(d)} style={{ flexShrink:0, background:on ? accent : C.cardLt, color:on ? C.white : C.black, border:`1px solid ${on ? accent : full ? C.green : C.border}`, borderRadius:"12px", padding:"6px 10px", cursor:"pointer", textAlign:"left", fontFamily:FONT }}>
                    <div style={{ fontWeight:"700", fontSize:"13px" }}>Day {dayNumber(d)}{full ? " ✓" : ""}</div>
                    <div style={{ fontSize:"11px", opacity:0.85 }}>{d === today ? "Today" : fmtDay(d)} · {n}/{prog.daily.length}</div>
                  </button>
                );
              })}
              {training && (addingDay
                ? <input type="date" max={today} autoFocus onChange={e => { if (e.target.value) { setDay(e.target.value); setAddingDay(false); } }} onBlur={() => setAddingDay(false)} style={{ ...inp, width:"auto", flexShrink:0 }}/>
                : <button onClick={() => setAddingDay(true)} style={{ flexShrink:0, background:"none", border:`1px dashed ${C.border}`, borderRadius:"12px", padding:"6px 10px", cursor:"pointer", color:C.muted, fontFamily:FONT, fontWeight:"600", fontSize:"12px" }}>+ Other date</button>)}
            </div>
          </div>
        )}

        {/* Section switcher */}
        <div style={{ display:"flex", gap:"6px" }}>
          {[["daily",`Perfect Day ${dailyToday}/${prog.daily.length}`],["misc","Miscellaneous"],...(training?[["notes", notes.some(n=>n.day_date===day) ? "Notes ✓" : "Notes"]]:[])].map(([id,label]) => (
            <button key={id} onClick={() => setView(id)} style={{ flex:1, background:view===id ? accent : C.card, color:view===id ? C.white : C.black, border:`1px solid ${view===id ? accent : C.border}`, borderRadius:"20px", padding:"9px 6px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"13px", letterSpacing:"-0.01em", textTransform:"none" }}>{label}</button>
          ))}
        </div>

        {view==="daily" && (<>
          <div style={{ fontSize:"12px", color:C.muted, padding:"0 4px" }}>
            {training
              ? <>Go through every item on {day===today ? "today's" : fmtDay(day)+"'s"} jobs. Tap to check it off · <b>N/A</b> if it didn't come up that day.</>
              : dayList.length ? <>Showing {day===today ? "today" : fmtDay(day)}. Your trainer checks these off as you go.</> : "Your trainer checks these off with you each training day."}
          </div>
          {phases.map(phase => (
            <div key={phase} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", overflow:"hidden" }}>
              <div style={{ background:C.cardLt, padding:"10px 16px", ...heading, fontSize:"13px", color:accent, display:"flex", justifyContent:"space-between" }}>
                <span>{PHASE_LABELS[phase] || phase}</span>
                <span style={{ color:C.muted }}>{byPhase[phase].filter(i=>dayChecks[i.id]).length}/{byPhase[phase].length}</span>
              </div>
              {byPhase[phase].map(item => {
                const ck = dayChecks[item.id], done = ck?.status==="done", na = ck?.status==="na";
                return (
                  <div key={item.id} onClick={() => setCheck(item, "done")} style={{ padding:"10px 16px", borderBottom:`1px solid ${C.border}40`, cursor:training?"pointer":"default", opacity:saving===item.id?0.5:1 }}>
                    <div style={{ display:"flex", alignItems:"flex-start", gap:"10px" }}>
                      <div style={{ width:"22px", height:"22px", borderRadius:"8px", border:`2px solid ${done ? C.green : na ? C.muted : C.border}`, background:done ? C.green : na ? C.border : "transparent", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", marginTop:"1px" }}>
                        {done && <span style={{ color:C.white, fontSize:"12px", lineHeight:1 }}>✓</span>}
                        {na && <span style={{ color:C.muted, fontSize:"11px", fontWeight:"700", lineHeight:1 }}>N/A</span>}
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:"13px", color:ck ? C.muted : C.black, textDecoration:done ? "line-through" : "none", fontStyle:na ? "italic" : "normal" }}>
                          <span style={{ fontFamily:FONT, fontWeight:"700", color:C.muted, marginRight:"4px" }}>#{item.sort_order}</span>
                          {item.description}
                        </div>
                        {ck && ck.trainer_id && training && <div style={{ fontSize:"11px", color:done ? C.green : C.muted, marginTop:"2px" }}>{na ? "N/A" : "Checked"} by {techName(ck.trainer_id)}</div>}
                        {scriptToggle(item)}
                      </div>
                      {training && (
                        <button onClick={e => { e.stopPropagation(); setCheck(item, "na"); }} style={{ flexShrink:0, background:na ? C.muted : "none", color:na ? C.white : C.muted, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"3px 8px", fontSize:"11px", fontWeight:"700", cursor:"pointer", fontFamily:FONT }}>N/A</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </>)}

        {view==="misc" && (<>
          <div style={{ fontSize:"12px", color:C.muted, padding:"0 4px" }}>
            Each of these gets trained {MISC_REPS} times over the course of training — they don't come up on every job.{training ? ` Tap an item to log a rep on ${day===today ? "today" : fmtDay(day)} (tap again to undo).` : ""}
          </div>
          {prog.misc.length === 0 && (
            <div style={{ background:C.cardLt, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"14px", fontSize:"13px", color:C.muted }}>No miscellaneous items have been added yet.</div>
          )}
          {miscPhases.map(phase => (
            <div key={phase} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", overflow:"hidden" }}>
              <div style={{ background:C.cardLt, padding:"10px 16px", ...heading, fontSize:"13px", color:C.gold }}>{PHASE_LABELS[phase] || (phase==="misc" ? "Miscellaneous" : phase)}</div>
              {miscByPhase[phase].map(item => {
                const reps = checks.filter(c => c.rubric_item_id===item.id).sort((a,b)=>a.day_date.localeCompare(b.day_date));
                const doneToday = !!dayChecks[item.id], complete = reps.length >= MISC_REPS;
                return (
                  <div key={item.id} onClick={() => setCheck(item, "done")} style={{ padding:"10px 16px", borderBottom:`1px solid ${C.border}40`, cursor:training?"pointer":"default", opacity:saving===item.id?0.5:1, background:doneToday ? `${C.gold}10` : "transparent" }}>
                    <div style={{ display:"flex", alignItems:"flex-start", gap:"10px" }}>
                      <div style={{ display:"flex", gap:"3px", flexShrink:0, marginTop:"3px" }}>
                        {Array.from({ length:MISC_REPS }, (_, i) => <div key={i} style={{ width:"14px", height:"14px", borderRadius:"50%", background:i < reps.length ? (complete ? C.green : C.gold) : "transparent", border:`2px solid ${i < reps.length ? (complete ? C.green : C.gold) : C.border}` }}/>)}
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:"13px", color:complete ? C.muted : C.black }}>
                          <span style={{ fontFamily:FONT, fontWeight:"700", color:C.muted, marginRight:"4px" }}>#{prog.misc.indexOf(item)+1}</span>
                          {item.description}
                        </div>
                        {reps.length > 0 && <div style={{ fontSize:"11px", color:C.muted, marginTop:"2px" }}>Done {reps.map(r => fmtDay(r.day_date)).join(" · ")}{doneToday && training ? " — logged for this day" : ""}</div>}
                        {scriptToggle(item)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </>)}

        {view==="notes" && training && (
          <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px", display:"flex", flexDirection:"column", gap:"14px" }}>
              <div style={{ ...heading, fontSize:"16px", color:C.black }}>Day {dayNumber(day)} notes · {day===today ? "Today" : fmtDay(day)}</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px" }}>
                <div><div style={{ ...small, marginBottom:"4px" }}>Overall day</div><Stars k="overall_rating"/></div>
                <div><div style={{ ...small, marginBottom:"4px" }}>With customers</div><Stars k="customer_rating"/></div>
                <div>
                  <div style={{ ...small, marginBottom:"4px" }}>Pace</div>
                  <select value={noteForm.pace || ""} onChange={e => setNote("pace", e.target.value)} style={inp}>
                    <option value="">—</option>
                    {Object.entries(TRAINING_PACE).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ ...small, marginBottom:"4px" }}>Jobs today</div>
                  <input type="number" min="0" inputMode="numeric" value={noteForm.jobs_count ?? ""} onChange={e => setNote("jobs_count", e.target.value)} style={inp}/>
                </div>
              </div>
              {[["went_well","👍 WHAT THEY DID WELL","Things they nailed, improvements since yesterday..."],
                ["needs_work","🔧 WHAT NEEDS WORK","Mistakes, missed steps, habits to fix..."],
                ["focus_tomorrow","🎯 FOCUS FOR NEXT DAY","The 1–2 things to drill next time out..."]].map(([k,label,ph]) => (
                <div key={k}>
                  <div style={{ ...small, marginBottom:"4px" }}>{label}</div>
                  <textarea value={noteForm[k] || ""} onChange={e => setNote(k, e.target.value)} placeholder={ph} rows={3} style={{ ...inp, resize:"vertical" }}/>
                </div>
              ))}
              <label style={{ display:"flex", alignItems:"center", gap:"8px", fontSize:"13px", color:C.black, cursor:"pointer" }}>
                <input type="checkbox" checked={!!noteForm.incident} onChange={e => setNote("incident", e.target.checked)} style={{ width:"16px", height:"16px" }}/>
                Damage, safety issue, or customer complaint today
              </label>
              {noteForm.incident && <textarea value={noteForm.incident_notes || ""} onChange={e => setNote("incident_notes", e.target.value)} placeholder="What happened?" rows={2} style={{ ...inp, resize:"vertical", borderColor:C.red }}/>}
              <button onClick={saveNotes} disabled={saving==="notes" || !noteDirty} style={{ background:noteDirty ? C.purple : C.border, border:"none", color:C.white, padding:"11px 18px", borderRadius:"20px", cursor:noteDirty ? "pointer" : "default", fontSize:"13px", fontWeight:"700", fontStyle:"normal", letterSpacing:"-0.01em", fontFamily:FONT, textTransform:"none" }}>
                {saving==="notes" ? "Saving..." : noteDirty ? "Save notes" : notes.some(n=>n.day_date===day) ? "✓ Saved" : "Save notes"}
              </button>
            </div>

            {notes.filter(n => n.day_date !== day).length > 0 && (
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"14px 16px" }}>
                <div style={{ ...small, marginBottom:"8px" }}>Earlier days</div>
                {notes.filter(n => n.day_date !== day).map(n => (
                  <div key={n.day_date} onClick={() => setDay(n.day_date)} style={{ padding:"10px 0", borderTop:`1px solid ${C.border}40`, cursor:"pointer" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", gap:"8px", fontSize:"12px" }}>
                      <span style={{ ...heading, color:C.black, fontSize:"13px" }}>Day {dayNumber(n.day_date)} · {fmtDay(n.day_date)}</span>
                      <span style={{ color:C.gold }}>{n.overall_rating ? "★".repeat(n.overall_rating) : ""}{n.pace ? <span style={{ color:n.pace==="behind" ? C.red : C.muted, marginLeft:"6px" }}>{TRAINING_PACE[n.pace]}</span> : null}</span>
                    </div>
                    {n.went_well && <div style={{ fontSize:"12px", color:C.black, marginTop:"3px" }}>👍 {n.went_well}</div>}
                    {n.needs_work && <div style={{ fontSize:"12px", color:C.black, marginTop:"3px" }}>🔧 {n.needs_work}</div>}
                    {n.focus_tomorrow && <div style={{ fontSize:"12px", color:C.black, marginTop:"3px" }}>🎯 {n.focus_tomorrow}</div>}
                    {n.incident && <div style={{ fontSize:"12px", color:C.red, marginTop:"3px" }}>⚠️ {n.incident_notes || "Incident noted"}</div>}
                    {n.trainer_id && <div style={{ fontSize:"11px", color:C.muted, marginTop:"3px" }}>— {techName(n.trainer_id)}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </>)}
    </div>
  );
}

// ─── FINAL DAY: written test + in-person Perfect Day evaluation ─────────────
// Will (or an owner) runs both from the Detail Apprentice Training tab on the
// apprentice's final training day. Owners see every result there too.

const fmtWhen = iso => iso ? new Date(iso).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric", timeZone:"America/Denver" }) : "";
const QUESTION_BY_ID = Object.fromEntries(TEST_QUESTIONS.map(q => [q.id, q]));
// Tests taken before the split (no test_key) covered both rubrics, so a pass
// on one of those counts for both tests.
const passedTestFor = (tests, key) => tests.find(t => t.status === "passed" && (t.test_key === key || !t.test_key));
const testName = t => t.test_key ? TESTS[t.test_key]?.name || "Written test" : "Written test (both rubrics)";

// The apprentice takes the test on the administrator's device. Questions come
// one at a time with the four answers shuffled; after each round only the
// missed questions come back (re-shuffled) until every one is answered right.
// Right answers are never shown while the test is running.
function WrittenTestRunner({ trainee, adminUser, onExit, self=false, testKey="perfect_day" }) {
  const T = TESTS[testKey];
  const QS = questionsFor(testKey);
  const [test, setTest] = useState(null);
  const [roundIds, setRoundIds] = useState([]);
  const [roundNo, setRoundNo] = useState(1);
  const [order, setOrder] = useState([]);
  const [idx, setIdx] = useState(0);
  const [picks, setPicks] = useState({});
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);

  function startRound(ids, n) {
    setRoundIds(ids); setRoundNo(n); setIdx(0); setPicks({}); setResult(null);
    setOrder(shuffle(ids).map(id => { const q = QUESTION_BY_ID[id]; return { id, choices: shuffle([q.correct, ...q.wrong]) }; }));
  }

  async function begin() {
    setSaving(true);
    try {
      const row = { trainee_id:trainee.id, administered_by:self ? null : (adminUser?.techId || null), administered_by_name:self ? "Self (own phone)" : (adminUser?.name || null), total_questions:QS.length, test_key:testKey, status:"in_progress", rounds:[] };
      const res = await sb("training_tests", { method:"POST", body:JSON.stringify(row) });
      setTest(res?.[0] || row);
      startRound(QS.map(q => q.id), 1);
    } catch(e) { window.alert("Couldn't start the test: " + e.message); }
    setSaving(false);
  }

  async function submitRound() {
    const wrong = order.filter(o => picks[o.id] !== QUESTION_BY_ID[o.id].correct).map(o => ({ id:o.id, picked:picks[o.id] }));
    const rounds = [...(test.rounds || []), { round:roundNo, asked:roundIds, wrong, at:new Date().toISOString() }];
    const passed = wrong.length === 0;
    const patch = { rounds, ...(roundNo === 1 ? { first_try_correct:roundIds.length - wrong.length } : {}), ...(passed ? { status:"passed", completed_at:new Date().toISOString() } : {}) };
    setSaving(true);
    try {
      if (test.id) await sb(`training_tests?id=eq.${test.id}`, { method:"PATCH", prefer:"return=minimal", body:JSON.stringify(patch) });
      setTest(t => ({ ...t, ...patch }));
      setResult({ asked:roundIds.length, wrong });
    } catch(e) { window.alert("Couldn't save answers — check the connection and tap Submit again. " + e.message); }
    setSaving(false);
  }

  async function quit() {
    if (!window.confirm("Stop this test? It will be saved as not finished and they'll start over next time.")) return;
    if (test?.id && test.status === "in_progress") await sb(`training_tests?id=eq.${test.id}`, { method:"PATCH", prefer:"return=minimal", body:JSON.stringify({ status:"abandoned", completed_at:new Date().toISOString() }) }).catch(()=>{});
    onExit();
  }

  const wrap = { background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"18px", display:"flex", flexDirection:"column", gap:"14px" };
  const big = (bg, on=true) => ({ background:on ? bg : C.border, border:"none", color:C.white, padding:"13px 18px", borderRadius:"22px", cursor:on ? "pointer" : "default", fontSize:"14px", fontWeight:"700", fontStyle:"normal", letterSpacing:"-0.01em", fontFamily:FONT, textTransform:"none" });
  const h = { fontFamily:FONT, fontWeight:"700", color:C.black };

  if (!test) return (
    <div style={wrap}>
      <div style={{ ...h, fontSize:"22px" }}>📝 {T.name} — {trainee.name}</div>
      <div style={{ fontSize:"13px", color:C.black, lineHeight:1.6 }}>
        {self
          ? <>{QS.length} multiple-choice questions on {T.covers}. Take your time — no notes or help.<br/><br/>You need <b>100%</b> to pass. After you submit you'll see your score, and any questions you missed come back (in a new order) until you get every one right.</>
          : <>{QS.length} multiple-choice questions covering {T.covers}. Hand the phone to {trainee.name.split(" ")[0]} once you start.<br/><br/>To pass they need <b>100%</b>. After the first try, any missed questions come back (in a new order) until every one is right. The right answers are never shown.</>}
      </div>
      <button onClick={begin} disabled={saving} style={big(C.purple, !saving)}>{saving ? "Starting..." : "Start test"}</button>
      <button onClick={onExit} style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:"13px" }}>Cancel</button>
    </div>
  );

  if (result) {
    const passed = result.wrong.length === 0;
    return (
      <div style={wrap}>
        <div style={{ ...h, fontSize:"13px", color:C.purple, letterSpacing:"-0.01em" }}>{roundNo === 1 ? "FIRST TRY" : `RETAKE ${roundNo - 1}`}</div>
        <div style={{ ...h, fontSize:"40px", color:passed ? C.green : C.black }}>{result.asked - result.wrong.length}/{result.asked}</div>
        {passed ? (<>
          <div style={{ fontSize:"15px", color:C.green, fontWeight:"700" }}>✅ {T.name} passed{roundNo > 1 ? ` after ${roundNo - 1} retake${roundNo > 2 ? "s" : ""}` : " — 100% on the first try!"}</div>
          {test.first_try_correct != null && roundNo > 1 && <div style={{ fontSize:"13px", color:C.muted }}>First try: {test.first_try_correct}/{test.total_questions}</div>}
          <div style={{ fontSize:"13px", color:C.black }}>{self ? "Next up: the other written test if you haven't passed it yet, then your practical Perfect Day test with Will." : `Hand the phone back to ${adminUser?.name || "Will"}. Both written tests have to be passed before the practical.`}</div>
          <button onClick={onExit} style={big(C.green)}>Done</button>
        </>) : (<>
          <div style={{ fontSize:"14px", color:C.black }}>{result.wrong.length} question{result.wrong.length===1?"":"s"} missed. Retake {result.wrong.length===1?"it":"them"} until every answer is right.</div>
          <button onClick={() => startRound(result.wrong.map(w => w.id), roundNo + 1)} style={big(C.purple)}>Retake {result.wrong.length} missed question{result.wrong.length===1?"":"s"}</button>
          <button onClick={quit} style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:"12px" }}>Stop test</button>
        </>)}
      </div>
    );
  }

  const cur = order[idx];
  if (!cur) return null;
  const q = QUESTION_BY_ID[cur.id];
  const answered = order.filter(o => picks[o.id]).length;
  const last = idx === order.length - 1;
  return (
    <div style={wrap}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
        <div style={{ ...h, fontSize:"13px", color:C.purple, letterSpacing:"-0.01em" }}>{roundNo === 1 ? T.name.toUpperCase() : `RETAKE ${roundNo - 1}`} · {trainee.name.split(" ")[0].toUpperCase()}</div>
        <div style={{ fontSize:"12px", color:C.muted }}>{idx + 1} of {order.length}</div>
      </div>
      <Bar pct={(answered / order.length) * 100} color={C.purple} h={6}/>
      <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", fontFamily:FONT, fontWeight:"600" }}>{q.topic.toUpperCase()}</div>
      <div style={{ fontSize:"17px", color:C.black, fontWeight:"600", lineHeight:1.4 }}>{q.q}</div>
      <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
        {cur.choices.map((c, i) => {
          const on = picks[cur.id] === c;
          return (
            <button key={c} onClick={() => setPicks(p => ({ ...p, [cur.id]:c }))} style={{ textAlign:"left", background:on ? `${C.purple}15` : C.white, border:`2px solid ${on ? C.purple : C.border}`, borderRadius:"12px", padding:"12px 14px", cursor:"pointer", fontSize:"14px", color:C.black, display:"flex", gap:"10px", alignItems:"flex-start", lineHeight:1.4 }}>
              <span style={{ fontFamily:FONT, fontWeight:"700", color:on ? C.purple : C.muted }}>{"ABCD"[i]}</span><span>{c}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display:"flex", gap:"8px" }}>
        <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0} style={{ ...big(C.muted, idx > 0), flex:"0 0 auto" }}>Back</button>
        {!last
          ? <button onClick={() => setIdx(i => i + 1)} disabled={!picks[cur.id]} style={{ ...big(C.purple, !!picks[cur.id]), flex:1 }}>Next</button>
          : <button onClick={submitRound} disabled={saving || answered < order.length} style={{ ...big(C.green, !saving && answered === order.length), flex:1 }}>{saving ? "Saving..." : answered < order.length ? `${order.length - answered} unanswered` : "Submit answers"}</button>}
      </div>
      {last && answered < order.length && (
        <button onClick={() => setIdx(order.findIndex(o => !picks[o.id]))} style={{ background:"none", border:"none", color:C.blue, cursor:"pointer", fontSize:"12px" }}>Go to the first unanswered question</button>
      )}
      <button onClick={quit} style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:"12px" }}>Stop test</button>
    </div>
  );
}

// Will walks the apprentice's final day and marks every Perfect Day item
// pass or fail. Saved to perfect_day_certs like the Development tab's cert,
// so attempt counts, cert status and the onboarding stage stay in sync.
function FinalEvalRunner({ trainee, adminUser, rubricItems, priorAttempts, onExit, refreshAll }) {
  // Passing the practical (the written test is already required to start it)
  // marks them Certified. The promotion to Detail Pro happens when the Final
  // Onboarding Cert is signed in the Development tab.
  const items = rubricItems.filter(i => (i.section || "daily") === "daily");
  const [scores, setScores] = useState({});
  const [itemNotes, setItemNotes] = useState({});
  const [date, setDate] = useState(mountainDate(new Date().toISOString()));
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);
  const byPhase = {}, phases = [];
  for (const i of items) { if (!byPhase[i.phase]) { byPhase[i.phase] = []; phases.push(i.phase); } byPhase[i.phase].push(i); }
  const scored = items.filter(i => scores[i.id]).length;
  const fails = items.filter(i => scores[i.id] === "fail");

  async function submit() {
    if (scored < items.length) return window.alert(`Score every item first — ${items.length - scored} left.`);
    const overall = fails.length === 0 ? "pass" : "fail";
    const attempt = priorAttempts + 1;
    setSaving(true);
    try {
      const res = await sb("perfect_day_certs", { method:"POST", body:JSON.stringify({ tech_id:trainee.id, attempt_number:attempt, administered_by:adminUser?.techId || null, test_date:date, overall_result:overall }) });
      const certId = res?.[0]?.id;
      if (!certId) throw new Error("No evaluation id returned");
      await sb("perfect_day_cert_results", { method:"POST", prefer:"return=minimal", body:JSON.stringify(items.map(i => ({ cert_id:certId, rubric_item_id:i.id, result:scores[i.id], notes:itemNotes[i.id] || null }))) });
      const certStatus = overall==="pass" ? "passed" : attempt===1 ? "failed_retest_1" : attempt===2 ? "failed_retest_2" : "hard_fail";
      await sb(`techs?id=eq.${trainee.id}`, { method:"PATCH", prefer:"return=minimal", body:JSON.stringify({ cert_attempts:attempt, cert_status:certStatus, ...(overall==="pass" ? { onboarding_stage:"cert_passed" } : {}) }) });
      refreshAll && refreshAll();
      setDone({ overall, attempt });
    } catch(e) { window.alert("Couldn't save the evaluation: " + e.message); }
    setSaving(false);
  }

  const btn = (bg, on=true) => ({ background:on ? bg : C.border, border:"none", color:C.white, padding:"12px 18px", borderRadius:"22px", cursor:on ? "pointer" : "default", fontSize:"13px", fontWeight:"700", fontStyle:"normal", letterSpacing:"-0.01em", fontFamily:FONT, textTransform:"none" });

  if (done) return (
    <div style={{ background:C.card, border:`1px solid ${done.overall==="pass" ? C.green : C.red}`, borderRadius:"16px", padding:"18px", display:"flex", flexDirection:"column", gap:"10px" }}>
      <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"24px", color:done.overall==="pass" ? C.green : C.red }}>{done.overall==="pass" ? "✅ Passed the practical test" : `❌ Did not pass (attempt ${done.attempt})`}</div>
      {done.overall==="pass" && <div style={{ fontSize:"14px", color:C.black }}>Next: sign {trainee.name.split(" ")[0]}'s <b>Final Onboarding Cert</b> in the Development tab to promote them to Detail Pro.</div>}
      {done.overall!=="pass" && <div style={{ fontSize:"13px", color:C.black }}>Missed {fails.length} item{fails.length===1?"":"s"}: {fails.map(i => `#${i.sort_order}`).join(", ")}. {done.attempt >= 3 ? "That was the third attempt — marked Hard Fail." : "They can retest after more training."}</div>}
      <button onClick={onExit} style={btn(C.blue)}>Done</button>
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px", display:"flex", flexDirection:"column", gap:"8px" }}>
        <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"20px", color:C.black }}>🏁 Practical Test — {trainee.name}</div>
        <div style={{ fontSize:"12px", color:C.muted }}>Attempt {priorAttempts + 1}{priorAttempts >= 2 ? " (last chance — a third fail is a Hard Fail)" : ""}. Watch them run the full Perfect Day and mark every item. Every item must pass.</div>
        <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
          <span style={{ fontSize:"11px", color:C.muted, fontWeight:"600" }}>Date</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"10px", padding:"6px 10px", fontSize:"14px" }}/>
        </div>
        <Bar pct={(scored / items.length) * 100} color={fails.length ? C.red : C.green} h={6}/>
        <div style={{ fontSize:"12px", color:C.muted }}>{scored}/{items.length} scored · {fails.length} fail{fails.length===1?"":"s"}</div>
        <button onClick={() => setScores(Object.fromEntries(items.map(i => [i.id, scores[i.id] || "pass"])))} style={{ alignSelf:"flex-start", background:"none", border:`1px solid ${C.border}`, color:C.muted, borderRadius:"14px", padding:"4px 12px", fontSize:"11px", cursor:"pointer" }}>Mark all unscored as pass</button>
      </div>
      {phases.map(phase => (
        <div key={phase} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", overflow:"hidden" }}>
          <div style={{ background:C.cardLt, padding:"10px 16px", fontFamily:FONT, fontWeight:"700", fontSize:"13px", color:C.gold, letterSpacing:"-0.01em" }}>{PHASE_LABELS[phase] || phase}</div>
          {byPhase[phase].map(item => {
            const s = scores[item.id];
            return (
              <div key={item.id} style={{ padding:"10px 16px", borderBottom:`1px solid ${C.border}40` }}>
                <div style={{ display:"flex", gap:"10px", alignItems:"flex-start" }}>
                  <div style={{ flex:1, fontSize:"13px", color:C.black }}><span style={{ color:C.muted, fontWeight:"700", marginRight:"4px" }}>#{item.sort_order}</span>{item.description}</div>
                  {["pass","fail"].map(v => (
                    <button key={v} onClick={() => setScores(sc => ({ ...sc, [item.id]: sc[item.id]===v ? undefined : v }))} style={{ flexShrink:0, background:s===v ? (v==="pass" ? C.green : C.red) : "none", color:s===v ? C.white : C.muted, border:`1px solid ${s===v ? (v==="pass" ? C.green : C.red) : C.border}`, borderRadius:"16px", padding:"4px 10px", fontSize:"11px", fontWeight:"700", cursor:"pointer", textTransform:"none", fontFamily:FONT }}>{v}</button>
                  ))}
                </div>
                {s === "fail" && <input value={itemNotes[item.id] || ""} onChange={e => setItemNotes(n => ({ ...n, [item.id]:e.target.value }))} placeholder="What went wrong?" style={{ marginTop:"6px", width:"100%", boxSizing:"border-box", background:C.white, border:`1px solid ${C.red}`, borderRadius:"10px", padding:"7px 10px", fontSize:"13px" }}/>}
              </div>
            );
          })}
        </div>
      ))}
      <div style={{ display:"flex", gap:"8px" }}>
        <button onClick={() => { if (window.confirm("Leave without saving this evaluation?")) onExit(); }} style={btn(C.muted)}>Cancel</button>
        <button onClick={submit} disabled={saving || scored < items.length} style={{ ...btn(fails.length ? C.red : C.green, !saving && scored === items.length), flex:1 }}>{saving ? "Saving..." : scored < items.length ? `${items.length - scored} left to score` : fails.length ? `Submit — ${fails.length} fail${fails.length===1?"":"s"}` : "Submit — all pass"}</button>
      </div>
    </div>
  );
}

// The path to Detail Pro, in order. Each step unlocks the next.
function finalDaySteps({ trainee, prog, tests, evals }) {
  const classroom = !!trainee.classroom_complete;
  const fieldDone = prog.daily.length > 0 && prog.fullDays >= TRAINING_MIN_DAYS;
  const miscDone = prog.miscMax === 0 || prog.miscDone >= prog.miscMax;
  const writtenPD = passedTestFor(tests, "perfect_day");
  const writtenMisc = passedTestFor(tests, "misc");
  const written = writtenPD && writtenMisc;
  const practical = evals.find(e => e.overall_result === "pass");
  const testUnlocked = classroom && fieldDone && miscDone;
  return {
    classroom, fieldDone, miscDone, written, writtenPD, writtenMisc, practical, testUnlocked,
    evalUnlocked: !!written,
    promoted: !!practical && trainee.title === "detail_pro",
    list: [
      { key:"classroom", label:"Classroom day", done:classroom },
      { key:"field", label:`${TRAINING_MIN_DAYS} full Perfect Days in the field`, done:fieldDone, detail:`${prog.fullDays}/${TRAINING_MIN_DAYS}` },
      { key:"misc", label:`Miscellaneous — every item ${MISC_REPS}×`, done:miscDone, detail:`${prog.miscDone}/${prog.miscMax}` },
      { key:"written_pd", label:"Perfect Day written test (100%)", done:!!writtenPD, detail:writtenPD ? `${writtenPD.first_try_correct}/${writtenPD.total_questions} first try` : null, locked:!testUnlocked },
      { key:"written_misc", label:"Miscellaneous written test (100%)", done:!!writtenMisc, detail:writtenMisc ? `${writtenMisc.first_try_correct}/${writtenMisc.total_questions} first try` : null, locked:!testUnlocked },
      { key:"practical", label:"Practical test with Will", done:!!practical, locked:!written },
      { key:"pro", label:"Final Onboarding Cert signed → Detail Pro", done:!!practical && trainee.title === "detail_pro", locked:!practical },
    ],
  };
}

function FinalDayStepList({ steps, extra = {} }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
      {steps.list.map((s, i) => (
        <div key={s.key} style={{ display:"flex", alignItems:"center", gap:"10px", fontSize:"13px", color:s.done ? C.black : s.locked ? C.muted : C.black }}>
          <div style={{ width:"22px", height:"22px", borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"11px", fontWeight:"700", background:s.done ? C.green : "transparent", border:`2px solid ${s.done ? C.green : s.locked ? C.border : C.purple}`, color:s.done ? C.white : s.locked ? C.muted : C.purple }}>{s.done ? "✓" : s.locked ? "🔒" : i + 1}</div>
          <div style={{ flex:1 }}>{s.label}{s.detail ? <span style={{ color:C.muted }}> · {s.detail}</span> : null}</div>
          {extra[s.key]}
        </div>
      ))}
    </div>
  );
}

// What an apprentice sees on their own rubric: where they are on the path,
// and the written test once training is done. They only ever see their score
// -- never which answer was right.
function ApprenticeFinalDay({ tech, prog, onStartTest }) {
  const [tests, setTests] = useState([]);
  const [evals, setEvals] = useState([]);
  useEffect(() => {
    Promise.all([
      sb(`training_tests?trainee_id=eq.${tech.id}&select=id,status,test_key,first_try_correct,total_questions,completed_at&order=started_at.desc`),
      sb(`perfect_day_certs?tech_id=eq.${tech.id}&select=id,overall_result,attempt_number,test_date&order=created_at.desc`),
    ]).then(([t, e]) => { setTests(t || []); setEvals(e || []); }).catch(() => {});
  }, [tech.id]);
  const steps = finalDaySteps({ trainee:tech, prog, tests, evals });
  const btn = { background:C.purple, border:"none", color:C.white, padding:"12px 18px", borderRadius:"22px", cursor:"pointer", fontSize:"14px", fontWeight:"700", fontStyle:"normal", letterSpacing:"-0.01em", fontFamily:FONT, textTransform:"none" };
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px", display:"flex", flexDirection:"column", gap:"12px" }}>
      <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"18px", color:C.black }}>🎓 Road to Detail Pro</div>
      <FinalDayStepList steps={steps}/>
      {steps.testUnlocked && !steps.writtenPD && <button onClick={() => onStartTest("perfect_day")} style={btn}>Take the Perfect Day test</button>}
      {steps.testUnlocked && !steps.writtenMisc && <button onClick={() => onStartTest("misc")} style={btn}>Take the Miscellaneous test</button>}
      {!steps.testUnlocked && <div style={{ fontSize:"12px", color:C.muted }}>The written tests unlock once your classroom day, {TRAINING_MIN_DAYS} full Perfect Days, and every Miscellaneous rep are done.</div>}
      {steps.written && !steps.practical && <div style={{ fontSize:"13px", color:C.black }}>✅ Both written tests passed. Next: your practical test — Will watches you run a full Perfect Day.</div>}
      {steps.practical && !steps.promoted && <div style={{ fontSize:"13px", color:C.green, fontWeight:"700" }}>🏁 Practical passed! Last step: your Final Onboarding Cert gets signed, which makes you a Detail Pro.</div>}
      {steps.promoted && <div style={{ fontSize:"13px", color:C.green, fontWeight:"700" }}>🎓 You passed everything — welcome to Detail Pro!</div>}
    </div>
  );
}

// Results for one apprentice: every written test (with what they missed and
// what the right answer was) and every in-person evaluation.
function FinalDayResults({ trainee, prog, tests, evals, evalResults, rubricItems, techs, onStartTest, onStartEval, onToggleClassroom }) {
  const [openTest, setOpenTest] = useState(null);
  const [openEval, setOpenEval] = useState(null);
  const name = id => techs.find(t => t.id === id)?.name;
  const item = id => rubricItems.find(i => i.id === id);
  const passedPD = passedTestFor(tests, "perfect_day");
  const passedMisc = passedTestFor(tests, "misc");
  const passedTest = passedPD && passedMisc;
  const passedEval = evals.find(e => e.overall_result === "pass");
  const small = { fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", fontFamily:FONT, fontWeight:"600" };
  const startBtn = color => ({ background:color, border:"none", color:C.white, padding:"8px 14px", borderRadius:"16px", cursor:"pointer", fontSize:"12px", fontWeight:"700", fontStyle:"normal", letterSpacing:"-0.01em", fontFamily:FONT, textTransform:"none" });
  const row = { padding:"10px 0", borderTop:`1px solid ${C.border}40`, cursor:"pointer" };

  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px", display:"flex", flexDirection:"column", gap:"14px" }}>
      <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"18px", color:C.black }}>🎓 Road to Detail Pro</div>
      {(() => { const st = finalDaySteps({ trainee, prog, tests, evals }); return (
        <FinalDayStepList steps={st} extra={{ classroom: <button onClick={onToggleClassroom} style={{ background:"none", border:`1px solid ${C.border}`, color:C.muted, borderRadius:"16px", padding:"3px 10px", fontSize:"11px", cursor:"pointer" }}>{st.classroom ? "Undo" : "Mark done"}</button> }}/>
      ); })()}

      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"8px" }}>
          <div style={small}>1 · WRITTEN TESTS</div>
        </div>
        {TEST_KEYS.map(key => {
          const p = passedTestFor(tests, key);
          const tried = tests.some(t => t.test_key === key);
          return (
            <div key={key} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"8px", marginTop:"6px" }}>
              <div style={{ fontSize:"13px", color:p ? C.green : C.black }}>
                <b>{TESTS[key].name}</b> · {p ? `✅ Passed ${fmtWhen(p.completed_at)} · ${p.first_try_correct}/${p.total_questions} first try` : tried ? "Not passed yet" : "Not taken yet"}
              </div>
              {!p && <button onClick={() => onStartTest(key)} style={startBtn(C.purple)}>Give on this phone</button>}
            </div>
          );
        })}
        {!passedTest && !tests.length && <div style={{ fontSize:"11px", color:C.muted, marginTop:"4px" }}>They can also take both on their own phone once training is done.</div>}
        {tests.map(t => {
          const missed = t.rounds?.[0]?.wrong || [];
          const retakes = Math.max(0, (t.rounds?.length || 0) - 1);
          const open = openTest === t.id;
          return (
            <div key={t.id} onClick={() => setOpenTest(open ? null : t.id)} style={row}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:"12px", gap:"8px" }}>
                <span style={{ color:C.black, fontWeight:"700" }}>{testName(t)} · {fmtWhen(t.started_at)} · {t.status==="passed" ? "Passed" : t.status==="abandoned" ? "Stopped early" : "In progress"}</span>
                <span style={{ color:C.muted }}>{t.first_try_correct != null ? `${t.first_try_correct}/${t.total_questions} first try` : "—"}{retakes ? ` · ${retakes} retake${retakes===1?"":"s"}` : ""} {open ? "▲" : "▼"}</span>
              </div>
              <div style={{ fontSize:"11px", color:C.muted }}>Given by {t.administered_by_name || name(t.administered_by) || "—"}</div>
              {open && (
                <div style={{ marginTop:"8px", display:"flex", flexDirection:"column", gap:"8px" }}>
                  {(t.rounds || []).length > 0 && <div style={{ fontSize:"12px", color:C.black }}>{t.rounds.map(r => `${r.round === 1 ? "First try" : `Retake ${r.round - 1}`}: ${r.asked.length - r.wrong.length}/${r.asked.length}`).join("  →  ")}</div>}
                  {missed.length === 0 && <div style={{ fontSize:"12px", color:C.green }}>{t.first_try_correct != null ? "No misses on the first try." : "No answers submitted."}</div>}
                  {missed.map(w => {
                    const q = QUESTION_BY_ID[w.id];
                    const tries = (t.rounds || []).filter(r => r.wrong.some(x => x.id === w.id)).length;
                    return q && (
                      <div key={w.id} style={{ background:`${C.red}08`, border:`1px solid ${C.red}30`, borderRadius:"10px", padding:"8px 10px", fontSize:"12px" }}>
                        <div style={{ color:C.black, fontWeight:"600" }}>{q.q}</div>
                        <div style={{ color:C.red, marginTop:"3px" }}>✗ Picked: {w.picked}</div>
                        <div style={{ color:C.green }}>✓ Right: {q.correct}</div>
                        {tries > 1 && <div style={{ color:C.muted, marginTop:"2px" }}>Missed {tries} times before getting it right</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"8px" }}>
          <div>
            <div style={small}>2 · PRACTICAL TEST</div>
            <div style={{ fontSize:"13px", color:passedEval ? C.green : C.black, marginTop:"2px" }}>
              {passedEval ? `✅ Passed ${fmtWhen(passedEval.test_date + "T12:00:00Z")} (attempt ${passedEval.attempt_number})` : evals.length ? `Not passed yet · ${evals.length} attempt${evals.length===1?"":"s"}` : "Not done yet"}
            </div>
            {!passedTest && <div style={{ fontSize:"11px", color:C.gold, marginTop:"2px" }}>🔒 Unlocks after both written tests are passed.</div>}
          </div>
          {!passedEval && passedTest && <button onClick={onStartEval} style={startBtn(C.gold)}>Start practical</button>}
        </div>
        {evals.map(e => {
          const res = evalResults.filter(r => r.cert_id === e.id);
          const fails = res.filter(r => r.result === "fail");
          const open = openEval === e.id;
          return (
            <div key={e.id} onClick={() => setOpenEval(open ? null : e.id)} style={row}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:"12px", gap:"8px" }}>
                <span style={{ color:e.overall_result==="pass" ? C.green : C.red, fontWeight:"700" }}>{fmtWhen(e.test_date + "T12:00:00Z")} · Attempt {e.attempt_number} · {e.overall_result==="pass" ? "Passed" : "Failed"}</span>
                <span style={{ color:C.muted }}>{res.length - fails.length}/{res.length} items {open ? "▲" : "▼"}</span>
              </div>
              <div style={{ fontSize:"11px", color:C.muted }}>Given by {name(e.administered_by) || "—"}</div>
              {open && (
                <div style={{ marginTop:"8px", display:"flex", flexDirection:"column", gap:"6px" }}>
                  {fails.length === 0 && <div style={{ fontSize:"12px", color:C.green }}>Every item passed.</div>}
                  {fails.map(r => (
                    <div key={r.id} style={{ background:`${C.red}08`, border:`1px solid ${C.red}30`, borderRadius:"10px", padding:"8px 10px", fontSize:"12px" }}>
                      <div style={{ color:C.black }}>✗ #{item(r.rubric_item_id)?.sort_order} {item(r.rubric_item_id)?.description || r.rubric_item_id}</div>
                      {r.notes && <div style={{ color:C.muted, marginTop:"2px" }}>{r.notes}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── MARKETING & SALES (owners only) ─────────────────────────────────────────
// Marketing & Sales are on for owners (managers never see them).
const GROWTH_TABS_ON = true;
// Both dashboards come from /.netlify/functions/reports, which reads the GHL
// mirror and ad spend tables server-side (the browser can't read those) after
// checking the login token is an owner's.

const usd = n => n == null ? "—" : `$${Math.round(Number(n)).toLocaleString()}`;
const money2 = n => n == null || !isFinite(n) ? "—" : `$${Number(n).toFixed(2)}`;
const pctOf = (a, b) => b ? `${Math.round((a / b) * 100)}%` : "—";
const fmtSeconds = s => s == null ? "—" : s < 90 ? `${Math.round(s)} sec` : fmtMinutes(Math.round(s / 60));
const fmtMinutes = m => m == null ? "—" : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${(m / 1440).toFixed(1)} days`;

function rangeFor(preset) {
  const today = mountainDate(new Date().toISOString());
  const [y, m] = today.split("-").map(Number);
  const iso = (yy, mm, dd) => `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const back = n => { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  if (preset === "last_month") { const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; return { from: iso(py, pm, 1), to: iso(py, pm, new Date(Date.UTC(py, pm, 0)).getUTCDate()) }; }
  if (preset === "7") return { from: back(6), to: today };
  if (preset === "30") return { from: back(29), to: today };
  if (preset === "today") return { from: today, to: today };
  return { from: iso(y, m, 1), to: today };
}

function GrowthRange({ range, setRange }) {
  const [preset, setPreset] = useState("month");
  const presets = [["today","Today"],["7","7 days"],["month","This month"],["last_month","Last month"],["30","30 days"],["custom","Custom"]];
  const date = { background:C.white, border:`1px solid ${C.border}`, borderRadius:"10px", padding:"6px 8px", fontSize:"13px", color:C.black };
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:"6px", alignItems:"center" }}>
      {presets.map(([k, label]) => (
        <button key={k} onClick={() => { setPreset(k); if (k !== "custom") setRange(rangeFor(k)); }} style={{ background:preset===k ? C.blue : C.white, color:preset===k ? C.white : C.black, border:`1px solid ${preset===k ? C.blue : C.border}`, borderRadius:"16px", padding:"5px 12px", fontSize:"12px", fontWeight:"700", cursor:"pointer", fontFamily:FONT }}>{label}</button>
      ))}
      {preset === "custom" && (<>
        <input type="date" value={range.from} max={range.to} onChange={e => setRange(r => ({ ...r, from:e.target.value }))} style={date}/>
        <span style={{ color:C.muted }}>→</span>
        <input type="date" value={range.to} min={range.from} onChange={e => setRange(r => ({ ...r, to:e.target.value }))} style={date}/>
      </>)}
    </div>
  );
}

function useGrowthReport(params, token) {
  const [state, setState] = useState({ loading:true, data:null, error:null });
  const qs = new URLSearchParams(params).toString();
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading:true, error:null }));
    fetch(`/.netlify/functions/reports?${qs}`, { headers:{ Authorization:`Bearer ${token || ""}` } })
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; })
      .then(data => live && setState({ loading:false, data, error:null }))
      .catch(e => live && setState({ loading:false, data:null, error:e.message }));
    return () => { live = false; };
  }, [qs, token]);
  return state;
}

function StatTile({ label, value, sub, pending }) {
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"12px 14px", minWidth:0 }}>
      <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", fontFamily:FONT, fontWeight:"600", textTransform:"none" }}>{label}</div>
      <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:pending ? "16px" : "26px", color:pending ? C.muted : C.black, marginTop:"2px", lineHeight:1.1 }}>{value}</div>
      {sub && <div style={{ fontSize:"11px", color:C.muted, marginTop:"2px" }}>{sub}</div>}
    </div>
  );
}
const TileGrid = ({ children }) => <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))", gap:"8px" }}>{children}</div>;

// One series per chart, so no legend -- the card title names it. Hover a bar
// for the day's number.
function DailyBars({ title, days, value, color = C.blue, fmt = v => v }) {
  const [hover, setHover] = useState(null);
  const vals = days.map(value), max = Math.max(1, ...vals);
  const total = vals.reduce((s, v) => s + v, 0);
  const W = 600, H = 120, gap = 2, bw = Math.max(1, (W - gap * (days.length - 1)) / Math.max(1, days.length));
  const h = hover != null ? days[hover] : null;
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"12px 14px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:"6px" }}>
        <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", fontFamily:FONT, fontWeight:"600" }}>{title.toUpperCase()}</div>
        <div style={{ fontSize:"12px", color:C.black }}>{h ? <>{fmtDay(h.d)}: <b>{fmt(value(h))}</b></> : <>Total <b>{fmt(total)}</b></>}</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height:"110px", display:"block" }} onMouseLeave={() => setHover(null)}>
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke={C.border} strokeWidth="1"/>
        {days.map((d, i) => {
          const v = vals[i], bh = v ? Math.max(3, (v / max) * (H - 8)) : 0, x = i * (bw + gap);
          return (
            <g key={d.d} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
              <rect x={x} y="0" width={bw + gap} height={H} fill="transparent"/>
              {bh > 0 && <rect x={x} y={H - bh} width={bw} height={bh} rx={Math.min(4, bw / 2)} fill={color} opacity={hover == null || hover === i ? 1 : 0.45}/>}
            </g>
          );
        })}
      </svg>
      {days.length > 1 && <div style={{ display:"flex", justifyContent:"space-between", fontSize:"11px", color:C.muted, marginTop:"4px" }}><span>{fmtDay(days[0].d)}</span><span>{fmtDay(days[days.length - 1].d)}</span></div>}
    </div>
  );
}

function ConnectionCard({ title, connected, lastSync, steps, note, connectUrl, connectLabel, syncFn, token, onSynced, syncDays=90 }) {
  const [open, setOpen] = useState(!connected);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  async function syncNow() {
    setSyncing(true); setSyncMsg(null);
    try {
      const r = await fetch(`/.netlify/functions/${syncFn}?days=${syncDays}`, { headers:{ Authorization:`Bearer ${token || ""}` } });
      const j = await r.json().catch(() => ({}));
      setSyncMsg(j.ok ? `✅ Pulled ${j.rows} rows · ${j.sessions != null ? `${Number(j.sessions).toLocaleString()} visits` : j.clicks != null ? `${Number(j.clicks).toLocaleString()} search clicks` : `$${Math.round(j.spend || 0).toLocaleString()} spend`}${j.lsa?.ok ? ` · ${j.lsa.leads} LSA leads` : ""} (${j.since} → ${j.until})` : `⚠️ ${j.error || j.skipped || `HTTP ${r.status}`}`);
      if (j.ok && onSynced) onSynced();
    } catch(e) { setSyncMsg(`⚠️ ${e.message}`); }
    setSyncing(false);
  }
  return (
    <div style={{ background:connected ? `${C.green}10` : `${C.gold}12`, border:`1px solid ${connected ? C.green : C.gold}`, borderRadius:"16px", padding:"12px 14px" }}>
      <div onClick={() => setOpen(o => !o)} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", gap:"8px" }}>
        <div style={{ fontSize:"13px", color:C.black, fontWeight:"700" }}>{connected ? "✅" : "🔌"} {title}: {connected ? `connected${lastSync ? ` · last sync ${new Date(lastSync).toLocaleString("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit", timeZone:"America/Denver" })}` : ""}` : "not connected yet"}</div>
        {steps && <span style={{ fontSize:"12px", color:C.muted }}>{open ? "▲" : "How to connect ▼"}</span>}
      </div>
      {note && <div style={{ fontSize:"12px", color:C.muted, marginTop:"4px" }}>{note}</div>}
      {open && steps && <ol style={{ margin:"8px 0 0", paddingLeft:"20px", fontSize:"12px", color:C.black, lineHeight:1.6 }}>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
      {connected && syncFn && <button onClick={syncNow} disabled={syncing} style={{ marginTop:"10px", marginRight:"8px", background:C.blue, color:C.white, border:"none", padding:"8px 16px", borderRadius:"18px", fontSize:"12px", fontWeight:"700", cursor:"pointer", fontFamily:FONT, letterSpacing:"-0.01em", textTransform:"none" }}>{syncing ? "Syncing..." : "Sync now"}</button>}
      {syncMsg && <div style={{ fontSize:"12px", color:C.black, marginTop:"6px" }}>{syncMsg}</div>}
      {connectUrl && <a href={connectUrl} style={{ display:"inline-block", marginTop:"10px", background:C.blue, color:C.white, padding:"8px 16px", borderRadius:"18px", fontSize:"12px", fontWeight:"700", textDecoration:"none", fontFamily:FONT, letterSpacing:"-0.01em", textTransform:"none" }}>{connectLabel || "Connect"}</a>}
    </div>
  );
}

const SubTabs = ({ tabs, active, setActive }) => (
  <div style={{ display:"flex", gap:"6px", overflowX:"auto" }}>
    {tabs.map(([k, label]) => (
      <button key={k} onClick={() => setActive(k)} style={{ flexShrink:0, background:active===k ? C.black : C.card, color:active===k ? C.white : C.black, border:`1px solid ${active===k ? C.black : C.border}`, borderRadius:"20px", padding:"8px 14px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"13px", letterSpacing:"-0.01em", textTransform:"none" }}>{label}</button>
    ))}
  </div>
);

// ─── FORMS ────────────────────────────────────────────────────────────────────
// Links to the GHL forms people fill out from their phone.
//   Truck Check: everyone except Detail Apprentices. Opens with their own name
//   as the form's First/Last Name (GHL fills typed fields from the link).
//   Tote Check + Tech Audit: Lead Detail Pros, the Field Supervisor (Will) and
//   owners. They pick the tech and themselves from the form's own dropdowns
//   (GHL can't pre-select a dropdown from a link).
const GHL_FORMS = {
  truck: { id:"70rs6amtoR9LiP9BDY7E", icon:"🚚", label:"Truck Check", desc:"End-of-day truck photos" },
  tote:  { id:"xU7BPLPkUCLiefCvawVx", icon:"🧰", label:"Tote Check",  desc:"Pick whose tote you're checking and your name" },
  audit: { id:"6bvUQqmnOb3auzX0hw9W", icon:"📋", label:"Tech Audit",  desc:"Pick the tech you're auditing and your name" },
};
const isLeadTech = t => !!t && (t.is_lead || t.title === "lead_detail_pro");
const isApprenticeTech = t => !!t && (t.title || "detail_apprentice") === "detail_apprentice";
function ghlFormUrl(formId, name) {
  const base = `https://api.leadconnectorhq.com/widget/form/${formId}`;
  if (!name) return base;
  const parts = String(name).trim().split(/\s+/);
  return `${base}?${new URLSearchParams({ first_name: parts[0] || "", last_name: parts.slice(1).join(" ") }).toString()}`;
}

// me: the logged-in tech row (null for owners). role: "tech" | "manager" | "owner".
function FormsTab({ me, role }) {
  const canCheckOthers = role === "owner" || role === "manager" || isLeadTech(me);
  const card = { display:"flex", alignItems:"center", gap:"12px", background:C.white, border:`1px solid ${C.border}`, borderRadius:"14px", padding:"14px 16px", marginBottom:"10px", textDecoration:"none", color:C.black };
  const link = (k, href, sub) => (
    <a key={k} href={href} target="_blank" rel="noopener noreferrer" style={card}>
      <div style={{ fontSize:"28px" }}>{GHL_FORMS[k].icon}</div>
      <div style={{ flex:1 }}>
        <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"18px" }}>{GHL_FORMS[k].label}</div>
        <div style={{ fontSize:"12px", color:C.muted }}>{sub || GHL_FORMS[k].desc}</div>
      </div>
      <div style={{ fontSize:"18px", color:C.muted }}>›</div>
    </a>
  );
  return (
    <div>
      <div style={{ fontSize:"13px", color:C.muted, marginBottom:"12px", lineHeight:1.5 }}>Tap a form to open it. Submissions show up in the app within about 15 minutes.</div>
      {me && !isApprenticeTech(me) && link("truck", ghlFormUrl(GHL_FORMS.truck.id, me.name), `End-of-day truck photos · sent as ${me.name}`)}
      {canCheckOthers && link("tote", ghlFormUrl(GHL_FORMS.tote.id))}
      {canCheckOthers && link("audit", ghlFormUrl(GHL_FORMS.audit.id))}
      {!(me && !isApprenticeTech(me)) && !canCheckOthers && <div style={{ fontSize:"13px", color:C.muted }}>No forms for this login.</div>}
    </div>
  );
}

const SectionTitle = ({ children }) => <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"16px", color:C.black, marginTop:"6px" }}>{children}</div>;
const ReportState = ({ s }) => s.error ? <div style={{ background:`${C.red}10`, border:`1px solid ${C.red}`, borderRadius:"12px", padding:"12px", fontSize:"13px", color:C.red }}>Couldn't load: {s.error}</div> : s.loading && !s.data ? <div style={{ color:C.muted, padding:"16px" }}>Loading...</div> : null;
const REVENUE_NOTE = "Revenue = HCP jobs these leads booked after coming in (matched by phone, email, or exact full name). Upfront = the first visit only — one-time jobs count once. Committed = first visit + the rest of the plan's minimum visits, when the plan was sold with that booking (weekly 8, bi-weekly 7, monthly 6, bi-monthly 5, quarterly 4). Completed so far = the part of that revenue whose HCP jobs the tech has marked complete. Anything after that — repeat jobs, plan visits past the minimum, plans a tech sells later — is kept by operations and not credited to ads or sales.";

function ChannelTiles({ ch, paid, att }) {
  const cpl = paid && ch.leads ? ch.spend / ch.leads : null;
  const cpb = paid && ch.booked ? ch.spend / ch.booked : null;
  const spend = Number(ch.spend) || 0;
  const roasUp = paid && spend > 0 ? Number(ch.revenue_upfront || 0) / spend : null;
  const roas = paid && spend > 0 ? Number(ch.revenue_sold || 0) / spend : null;
  const margin = Number(att?.gross_margin) || 0;
  const breakeven = margin > 0 ? 1 / margin : null;
  return (
    <TileGrid>
      <StatTile label="Leads" value={ch.leads} sub="New customers in GHL"/>
      {paid && <StatTile label="Ad spend" value={usd(ch.spend)} sub={ch.last_spend_day ? `through ${fmtDay(ch.last_spend_day)}` : "no spend data yet"}/>}
      {paid && <StatTile label="Cost per lead" value={ch.spend ? money2(cpl) : "—"}/>}
      <StatTile label="Booked" value={ch.booked} sub={`${pctOf(ch.booked, ch.leads)} of leads`}/>
      {paid && <StatTile label="Cost per booking" value={ch.spend ? money2(cpb) : "—"}/>}
      {paid && <StatTile label="Cost per new customer" value={spend && ch.customers ? money2(spend / ch.customers) : "—"} sub={`${ch.customers || 0} new paying customers`}/>}
      <StatTile label="Upfront revenue" value={usd(ch.revenue_upfront)} sub={`first visits · ${ch.customers || 0} customers`}/>
      <StatTile label="Committed revenue" value={usd(ch.revenue_sold)} sub={`first visit + plan minimums · ${ch.plans_sold || 0} plans sold`}/>
      <StatTile label="Completed so far" value={usd(ch.revenue_serviced)} sub={`${pctOf(Number(ch.revenue_serviced || 0), Number(ch.revenue_sold || 0))} of committed · jobs marked complete in HCP${paid && spend > 0 ? ` · ${(Number(ch.revenue_serviced || 0) / spend).toFixed(2)}x ROAS` : ""}`}/>
      {paid && <StatTile label="Upfront ROAS" value={roasUp == null ? "—" : `${roasUp.toFixed(2)}x`} sub={roasUp == null ? "needs ad spend" : breakeven ? `break-even ${breakeven.toFixed(2)}x at ${Math.round(margin * 1000) / 10}% margin` : null}/>}
      {paid && <StatTile label="Committed ROAS" value={roas == null ? "—" : `${roas.toFixed(2)}x`} sub={roas == null ? "needs ad spend" : `${usd(ch.revenue_sold)} ÷ ${usd(spend)} spent`}/>}
      {Number(ch.revenue_beyond) > 0 && <StatTile label="Kept by operations" value={usd(ch.revenue_beyond)} sub="later jobs + plan visits past the minimum — not credited to ads"/>}
      {paid && Number(ch.platform_leads) > 0 && <StatTile label="Conversions (ad platform)" value={Math.round(ch.platform_leads)} sub={`${Number(ch.spend) ? money2(Number(ch.spend) / Number(ch.platform_leads)) : "—"} each · as counted by the ad platform`}/>}
      {paid && ch.impressions > 0 && <StatTile label="Clicks" value={Number(ch.clicks).toLocaleString()} sub={`${pctOf(ch.clicks, ch.impressions)} CTR · ${Number(ch.impressions).toLocaleString()} impr.`}/>}
    </TileGrid>
  );
}

// Owner-editable credit rules (report_settings.attribution): how many plan
// visits count toward the ad/sale, and the margin used for break-even ROAS.
function AttributionSettings({ att, token, onSaved }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState("");
  const PLANS = [["weekly","Weekly"],["biweekly","Bi-weekly"],["monthly","Monthly"],["bimonthly","Bi-monthly"],["quarterly","Quarterly"]];
  if (!att) return null;
  const start = () => { setF({ mins:{ ...att.plan_minimums }, gm:Math.round(att.gross_margin * 1000) / 10, tm:Math.round(att.target_margin * 1000) / 10 }); setMsg(""); setOpen(true); };
  const save = async () => {
    setMsg("Saving...");
    const r = await fetch(`/.netlify/functions/reports?type=attribution`, { method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token || ""}` },
      body:JSON.stringify({ plan_minimums:f.mins, gross_margin:Number(f.gm) / 100, target_margin:Number(f.tm) / 100 }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(j.error || "Couldn't save"); return; }
    setOpen(false); onSaved && onSaved();
  };
  const inp = { width:"64px", padding:"6px 8px", border:`1px solid ${C.border}`, borderRadius:"10px", fontSize:"13px" };
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"10px 14px", fontSize:"12px", color:C.muted }}>
      {!open ? (
        <div style={{ display:"flex", justifyContent:"space-between", gap:"8px", flexWrap:"wrap", alignItems:"center" }}>
          <span>Credit rules: plan minimums {PLANS.map(([k, l]) => `${l.toLowerCase()} ${att.plan_minimums?.[k]}`).join(" · ")} · margin {Math.round(att.gross_margin * 1000) / 10}% (target {Math.round(att.target_margin * 1000) / 10}%)</span>
          <button onClick={start} style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:"14px", padding:"4px 12px", fontSize:"11px", fontWeight:"600", cursor:"pointer", color:C.black }}>Edit</button>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:"8px", color:C.black }}>
          <div style={{ fontWeight:"600" }}>Plan minimum visits (credited to the ad / sale)</div>
          <div style={{ display:"flex", gap:"10px", flexWrap:"wrap" }}>
            {PLANS.map(([k, l]) => <label key={k} style={{ display:"flex", flexDirection:"column", gap:"2px" }}>{l}<input type="number" min="1" max="52" value={f.mins[k]} onChange={e => setF({ ...f, mins:{ ...f.mins, [k]:e.target.value } })} style={inp}/></label>)}
          </div>
          <div style={{ display:"flex", gap:"10px", flexWrap:"wrap" }}>
            <label style={{ display:"flex", flexDirection:"column", gap:"2px" }}>Gross margin %<input type="number" step="0.1" value={f.gm} onChange={e => setF({ ...f, gm:e.target.value })} style={inp}/></label>
            <label style={{ display:"flex", flexDirection:"column", gap:"2px" }}>Target margin %<input type="number" step="0.1" value={f.tm} onChange={e => setF({ ...f, tm:e.target.value })} style={inp}/></label>
          </div>
          <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
            <button onClick={save} style={{ background:C.blue, color:C.white, border:"none", borderRadius:"14px", padding:"6px 14px", fontWeight:"700", cursor:"pointer" }}>Save</button>
            <button onClick={() => setOpen(false)} style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:"14px", padding:"6px 14px", cursor:"pointer" }}>Cancel</button>
            <span style={{ color:C.muted }}>{msg}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function MetaCampaigns({ campaigns }) {
  const [open, setOpen] = useState(null);
  if (!campaigns.length) return <div style={{ fontSize:"13px", color:C.muted }}>No Meta campaigns in this range.</div>;
  // Compact: headers wrap, cost columns rounded to whole dollars, so all
  // columns fit on a laptop screen without sideways scrolling.
  const th = { textAlign:"right", padding:"6px 5px", fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", fontWeight:"600", lineHeight:1.2, verticalAlign:"bottom" };
  const td = { textAlign:"right", padding:"8px 5px", fontSize:"12px", color:C.black, whiteSpace:"nowrap", fontVariantNumeric:"tabular-nums" };
  const row = x => [
    usd(x.spend), x.leads, x.spend && x.leads ? usd(x.spend / x.leads) : "—", x.booked, x.spend && x.booked ? usd(x.spend / x.booked) : "—",
    usd(x.revenue_upfront), usd(x.revenue_sold), usd(x.revenue_serviced),
    Number(x.spend) > 0 ? `${(Number(x.revenue_upfront || 0) / Number(x.spend)).toFixed(2)}x / ${(Number(x.revenue_sold || 0) / Number(x.spend)).toFixed(2)}x` : "—",
  ];
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", overflowX:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", minWidth:"700px" }}>
        <thead><tr style={{ background:C.cardLt }}>
          <th style={{ ...th, textAlign:"left" }}>Campaign / ad</th><th style={th}>Spend</th><th style={th}>Leads</th><th style={th}>CPL</th><th style={th}>Booked</th><th style={th}>$/BOOKING</th><th style={th}>Upfront</th><th style={th}>Committed</th><th style={th}>Completed</th><th style={th}>ROAS up / comm.</th>
        </tr></thead>
        <tbody>
          {campaigns.map(c => (<Fragment key={c.id}>
            <tr onClick={() => setOpen(open === c.id ? null : c.id)} style={{ borderTop:`1px solid ${C.border}`, cursor:"pointer" }}>
              <td style={{ ...td, textAlign:"left", whiteSpace:"normal", fontWeight:"700" }}>{open === c.id ? "▾" : "▸"} {c.name || c.id}</td>
              {row(c).map((v, i) => <td key={i} style={td}>{v}</td>)}
            </tr>
            {open === c.id && (c.ads || []).map(a => (
              <tr key={a.id} style={{ background:C.blueXlt }}>
                <td style={{ ...td, textAlign:"left", whiteSpace:"normal", paddingLeft:"24px" }}>{a.name || a.id}<div style={{ fontSize:"11px", color:C.muted }}>{a.adset}</div></td>
                {row(a).map((v, i) => <td key={i} style={td}>{v}</td>)}
              </tr>
            ))}
          </Fragment>))}
        </tbody>
      </table>
    </div>
  );
}

function SpendCampaigns({ rows }) {
  if (!rows?.length) return <div style={{ fontSize:"13px", color:C.muted }}>No spend in this range.</div>;
  const th = { textAlign:"right", padding:"6px 8px", fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", fontWeight:"600", whiteSpace:"nowrap" };
  const td = { textAlign:"right", padding:"8px", fontSize:"12px", color:C.black, whiteSpace:"nowrap", fontVariantNumeric:"tabular-nums" };
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", overflowX:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", minWidth:"520px" }}>
        <thead><tr style={{ background:C.cardLt }}><th style={{ ...th, textAlign:"left" }}>Campaign</th><th style={th}>Spend</th><th style={th}>Clicks</th><th style={th}>CPC</th><th style={th}>Conv.</th><th style={th}>$/CONV.</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.id} style={{ borderTop:`1px solid ${C.border}` }}>
            <td style={{ ...td, textAlign:"left", whiteSpace:"normal", fontWeight:"700" }}>{/^LocalServicesCampaign/.test(r.name) ? "Local Services Ads" : r.name}</td>
            <td style={td}>{usd(r.spend)}</td><td style={td}>{Number(r.clicks).toLocaleString()}</td>
            <td style={td}>{r.clicks ? money2(r.spend / r.clicks) : "—"}</td>
            <td style={td}>{Math.round(r.conversions)}</td><td style={td}>{r.conversions ? money2(r.spend / r.conversions) : "—"}</td>
          </tr>))}
        </tbody>
      </table>
    </div>
  );
}

const META_STEPS = [
  "developers.facebook.com → My Apps → Create App → type Business → name it \"Skylo Reporting\".",
  "business.facebook.com → Settings → Users → System users → Add (Employee role).",
  "On that system user: Assign assets → Ad accounts → your ad account → View performance only.",
  "Generate token → pick the Skylo Reporting app → check ads_read → expiration Never.",
  "Netlify → Site configuration → Environment variables → add META_ADS_TOKEN (the token) and META_AD_ACCOUNT_ID (the number after act= in Ads Manager's URL). Mark both secret.",
  "Tell Claude it's in — one backfill run pulls your history, then it updates every morning.",
];
const GOOGLE_STEPS = [
  "Google Cloud (project Skylo Tip Sync) → Google Ads API → access level Explorer or higher.",
  "Ad account linked to the Skylo Detailing Manager account.",
  "Tap Connect Google Ads below and sign in as team@skylod.com → Allow.",
];
const LSA_STEPS = [
  "Make sure your Local Services account is linked to your Google Ads account.",
  "In Google Ads, schedule a daily Local Services report (leads, charged leads, spend) emailed to team@skylod.com.",
  "LSA leads that come in by phone also need to land in GHL (call forwarding or the LSA → GHL integration) so we can follow them to bookings.",
];
const GA4_STEPS = [
  "Google Cloud (project Skylo Tip Sync) → APIs & Services → Library → enable \"Google Analytics Data API\" and \"Google Analytics Admin API\".",
  "Make sure team@skylod.com can see the site in Google Analytics (GA4 → Admin → Property access management → Viewer or higher).",
  "Tap Reconnect Google below, sign in as team@skylod.com, and allow Analytics access.",
  "Tap Sync now — it finds the GA4 property and pulls 90 days of visitors.",
];

const GSC_STEPS = [
  "Google Cloud (project Skylo Tip Sync) → APIs & Services → Library → enable \"Google Search Console API\".",
  "Make sure team@skylod.com is a user on skylod.com in Search Console (Settings → Users and permissions → Full or Owner).",
  "Tap Reconnect Google below, sign in as team@skylod.com, and allow Search Console access.",
  "Tap Sync now — it pulls the last 16 months of searches, then updates every morning.",
];

// A ranked list of searches or pages: name, clicks, impressions, CTR, position.
function SearchTable({ rows, keyName, empty, limit = 15 }) {
  const th = { textAlign:"right", padding:"6px 8px", fontSize:"11px", color:C.muted, fontWeight:"600", whiteSpace:"nowrap" };
  const td = { textAlign:"right", padding:"6px 8px", fontSize:"13px", color:C.black, borderTop:`1px solid ${C.border}`, whiteSpace:"nowrap" };
  const label = v => keyName === "page" ? (v.replace(/^https?:\/\/[^/]+/, "") || "/") : v;
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"6px", overflowX:"auto" }}>
      {rows.length === 0 ? <div style={{ padding:"10px", fontSize:"13px", color:C.muted }}>{empty}</div> : (
        <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:FONT }}>
          <thead><tr><th style={{ ...th, textAlign:"left" }}>{keyName === "page" ? "Page" : "Search"}</th><th style={th}>Clicks</th><th style={th}>Shown</th><th style={th}>Click rate</th><th style={th}>Avg rank</th></tr></thead>
          <tbody>{rows.slice(0, limit).map(r => (
            <tr key={r[keyName]}>
              <td style={{ ...td, textAlign:"left", whiteSpace:"normal", wordBreak:"break-word" }}>{label(r[keyName])}</td>
              <td style={td}>{r.clicks}</td><td style={td}>{r.impressions}</td><td style={td}>{pctOf(r.clicks, r.impressions)}</td>
              <td style={td}>{r.position ?? "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

// Organic Google search for skylod.com (Search Console). Brand = searches for
// Skylo by name; non-brand = people looking for a detailer who didn't already
// know Skylo -- the number SEO work should grow.
function SearchConsolePanel({ range, token }) {
  const [bump, setBump] = useState(0);
  const s = useGrowthReport({ type:"search", ...range, r:bump }, token);
  const d = s.data, conn = d?.connection || {};
  const change = (a, b) => b ? `${a >= b ? "▲" : "▼"} ${Math.abs(Math.round(((a - b) / b) * 100))}% vs previous ${d.daily.length || ""} days` : "no earlier data";
  const nb = (d?.queries || []).filter(q => !q.brand);
  const almost = nb.filter(q => q.position >= 4 && q.position <= 20).sort((a, b) => b.impressions - a.impressions);
  const unclicked = nb.filter(q => q.position <= 10 && q.impressions >= 10 && q.clicks / q.impressions < 0.02).sort((a, b) => b.impressions - a.impressions);
  const sm = conn.last_result?.sitemaps || [];
  const notIndexed = (d?.page_status || []).filter(p => p.verdict && p.verdict !== "PASS");
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
      <ConnectionCard title="Google Search Console (organic search)" connected={conn.connected} lastSync={conn.last_sync} steps={conn.connected ? null : GSC_STEPS}
        connectUrl={`/.netlify/functions/google-ads-auth?t=${encodeURIComponent(token || "")}`} connectLabel={conn.connected ? "Reconnect Google" : "Reconnect Google (adds Search Console)"}
        syncFn={conn.connected ? "gsc-sync" : null} syncDays={480} token={token} onSynced={() => setBump(b => b + 1)}
        note={conn.last_result?.ok === false ? `Last sync failed: ${conn.last_result.error}`
          : conn.connected ? `Reading ${conn.last_result?.site || "skylod.com"}. Google's search data runs 2–3 days behind.`
          : "Shows what people searched on Google to find skylod.com. Reconnecting Google adds it (same sign-in as Google Ads and Analytics)."}/>
      <ReportState s={s}/>
      {d && d.from === range.from && d.daily.length > 0 && (<>
        <TileGrid>
          <StatTile label="Clicks from Google search" value={d.totals.clicks.toLocaleString()} sub={change(d.totals.clicks, d.prev.clicks)}/>
          <StatTile label="Times shown" value={d.totals.impressions.toLocaleString()} sub={change(d.totals.impressions, d.prev.impressions)}/>
          <StatTile label="Click rate" value={pctOf(d.totals.clicks, d.totals.impressions)} sub={`was ${pctOf(d.prev.clicks, d.prev.impressions)}`}/>
          <StatTile label="Average rank" value={d.totals.position ?? "—"} sub={d.prev.position ? `was ${d.prev.position} · lower is better` : "lower is better"}/>
          <StatTile label="Non-brand clicks" value={d.non_brand.clicks} sub={`${d.non_brand.impressions.toLocaleString()} times shown · new people`}/>
          <StatTile label="Brand clicks" value={d.brand.clicks} sub="searched Skylo by name"/>
        </TileGrid>
        <DailyBars title="Clicks from Google search per day" days={d.daily} value={x => x.clicks}/>

        <SectionTitle>Top non-brand searches</SectionTitle>
        <SearchTable rows={nb} keyName="query" empty="No non-brand searches in this range yet."/>
        <SectionTitle>Almost on page one</SectionTitle>
        <div style={{ fontSize:"12px", color:C.muted }}>Non-brand searches where skylod.com ranks #4–20. Improving the page that ranks for each is the cheapest way to get more free clicks.</div>
        <SearchTable rows={almost} keyName="query" empty="None in this range."/>
        <SectionTitle>Shown but not clicked</SectionTitle>
        <div style={{ fontSize:"12px", color:C.muted }}>On page one, shown 10+ times, under 2% click rate. Usually fixed by rewriting that page's title and description.</div>
        <SearchTable rows={unclicked} keyName="query" empty="None in this range."/>
        <SectionTitle>Top pages</SectionTitle>
        <SearchTable rows={d.pages} keyName="page" empty="No pages in this range."/>

        <SectionTitle>Site health</SectionTitle>
        <div style={{ background:notIndexed.length || sm.some(x => x.errors) ? `${C.red}10` : C.card, border:`1px solid ${notIndexed.length || sm.some(x => x.errors) ? C.red : C.border}`, borderRadius:"16px", padding:"12px 14px", fontSize:"13px", color:C.black, display:"flex", flexDirection:"column", gap:"6px" }}>
          <div>{d.page_status.length ? (notIndexed.length ? `⚠️ ${notIndexed.length} of the ${d.page_status.length} most-seen pages aren't fully indexed by Google:` : `✅ All ${d.page_status.length} most-seen pages are indexed by Google.`) : "Page indexing is checked on the next sync."}</div>
          {notIndexed.map(p => <div key={p.page} style={{ fontSize:"12px" }}>{p.page.replace(/^https?:\/\/[^/]+/, "") || "/"} — {p.coverage || p.verdict}</div>)}
          <div>{sm.length ? sm.map(x => `Sitemap ${x.path.replace(/^https?:\/\/[^/]+/, "")}: ${x.errors ? `⚠️ ${x.errors} errors` : "✅ no errors"}${x.warnings ? `, ${x.warnings} warnings` : ""}${x.last_downloaded ? ` · read by Google ${fmtDay(x.last_downloaded.slice(0, 10))}` : ""}`).join(" · ") : "⚠️ No sitemap submitted — add one in Search Console → Sitemaps so Google finds every page."}</div>
        </div>
        <div style={{ fontSize:"11px", color:C.muted }}>From Google Search Console, regular web search only (ads not included). Brand = searches containing "Skylo" or "Squeegee Boys". Google keeps rare searches private, so brand + non-brand add up to less than total clicks. Average rank is weighted by how often each search showed the site.</div>
        {s.loading && <div style={{ fontSize:"11px", color:C.muted }}>Refreshing...</div>}
      </>)}
      {d && d.from === range.from && d.daily.length === 0 && conn.connected && <div style={{ fontSize:"13px", color:C.muted }}>No search data for this range yet — tap Sync now, or pick an earlier range (Google runs 2–3 days behind).</div>}
    </div>
  );
}

function MarketingTab({ token }) {
  const [range, setRange] = useState(() => rangeFor("month"));
  const [sub, setSub] = useState("meta");
  const [bump, setBump] = useState(0);
  const s = useGrowthReport({ type:"marketing", ...range, r:bump }, token);
  const d = s.data;
  const ch = d?.channels || {};
  const conn = d?.connections || {};
  const all = Object.values(ch).reduce((t, c) => ({ leads:t.leads + c.leads, booked:t.booked + c.booked, spend:t.spend + Number(c.spend), sold:t.sold + Number(c.revenue_sold || 0), up:t.up + Number(c.revenue_upfront || 0), done:t.done + Number(c.revenue_serviced || 0) }), { leads:0, booked:0, spend:0, sold:0, up:0, done:0 });
  // Cost per lead and ROAS only count channels whose spend is connected, so a
  // channel with leads but no spend data doesn't make the numbers look great.
  const withSpend = ["meta","google","lsa"].filter(k => Number(ch[k]?.spend) > 0);
  const paidSpend = withSpend.reduce((s, k) => s + Number(ch[k].spend), 0);
  const paidSold = withSpend.reduce((s, k) => s + Number(ch[k].revenue_sold || 0), 0);
  const paidUp = withSpend.reduce((s, k) => s + Number(ch[k].revenue_upfront || 0), 0);
  const att = d?.attribution;
  const paidLeads = withSpend.reduce((s, k) => s + Number(ch[k].leads || 0), 0);
  const days = d?.daily || [];
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
      <GrowthRange range={range} setRange={setRange}/>
      <ReportState s={s}/>
      {d && (<>
        <div style={{ background:C.black, borderRadius:"16px", padding:"14px 16px", display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(110px, 1fr))", gap:"10px", color:C.white }}>
          {[["All leads", all.leads], ["Booked", `${all.booked} · ${pctOf(all.booked, all.leads)}`], ["Ad spend", usd(all.spend)], ["Paid cost / lead", paidSpend && paidLeads ? money2(paidSpend / paidLeads) : "—"], ["Upfront revenue", usd(all.up)], ["Committed revenue", usd(all.sold)], ["Completed so far", usd(all.done)], ["Paid ROAS up / comm.", paidSpend ? `${(paidUp / paidSpend).toFixed(1)}x / ${(paidSold / paidSpend).toFixed(1)}x` : "—"]].map(([l, v]) => (
            <div key={l}><div style={{ fontSize:"11px", opacity:0.7, letterSpacing:"-0.01em", fontWeight:"600", fontFamily:FONT }}>{l.toUpperCase()}</div><div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"22px" }}>{v}</div></div>
          ))}
        </div>
        <AttributionSettings att={att} token={token} onSaved={() => setBump(b => b + 1)}/>
        <div style={{ fontSize:"11px", color:C.muted }}>{REVENUE_NOTE}</div>
        <SubTabs tabs={[["meta","Meta Ads"],["google","Google Ads"],["lsa","Local Services"],["website","Website"],["search","Google Search"]]} active={sub} setActive={setSub}/>

        {sub === "search" && <SearchConsolePanel range={range} token={token}/>}

        {sub === "meta" && (<>
          <ConnectionCard title="Meta Ads spend" connected={conn.meta?.connected} lastSync={conn.meta?.last_sync} steps={conn.meta?.connected ? null : META_STEPS} syncFn="meta-ads-sync" token={token} onSynced={() => setBump(b => b + 1)}
            note={conn.meta?.connected ? (conn.meta?.last_result?.ok === false ? `Last sync failed: ${conn.meta.last_result.error}` : null) : "Leads below are already live from GHL (Facebook/Instagram ads). Connect Meta to add spend, cost per lead, and cost per booking per ad."}/>
          <ChannelTiles ch={ch.meta} paid att={att}/>
          <DailyBars title="Meta leads per day" days={days} value={x => x.leads?.meta || 0}/>
          {Number(ch.meta.spend) > 0 && <DailyBars title="Meta spend per day" days={days} value={x => Number(x.spend?.meta || 0)} fmt={usd}/>}
          <SectionTitle>Campaigns & ads</SectionTitle>
          <MetaCampaigns campaigns={d.meta_campaigns || []}/>
          <div style={{ fontSize:"11px", color:C.muted }}>Leads and bookings come from GHL, matched to the exact ad by its tracking tag. {REVENUE_NOTE}</div>
        </>)}

        {sub === "google" && (<>
          <ConnectionCard title="Google Ads spend" connected={conn.google?.connected} lastSync={conn.google?.last_sync} steps={conn.google?.connected ? null : GOOGLE_STEPS}
            connectUrl={`/.netlify/functions/google-ads-auth?t=${encodeURIComponent(token || "")}`} connectLabel={conn.google?.connected ? "Reconnect Google Ads" : "Connect Google Ads"}
            syncFn="google-ads-sync" token={token} onSynced={() => setBump(b => b + 1)}
            note={conn.google?.last_result?.ok === false ? `Last sync failed: ${conn.google.last_result.error}` : conn.google?.connected ? null : "Google Ads leads show up here automatically once they arrive in GHL with Google's tracking."}/>
          <ChannelTiles ch={ch.google} paid att={att}/>
          {Number(ch.google.spend) > 0 && ch.google.leads === 0 && <div style={{ background:`${C.gold}12`, border:`1px solid ${C.gold}`, borderRadius:"12px", padding:"10px 12px", fontSize:"12px", color:C.black }}>Google is reporting conversions, but none of your GHL leads are tagged as coming from Google yet — so leads, bookings and revenue for Google show 0 here. Those leads are landing in GHL as website / direct leads. Fix: turn on GHL tracking for Google (see setup notes) so each lead keeps its Google click ID.</div>}
          <DailyBars title="Google Ads spend per day" days={days} value={x => Number(x.spend?.google || 0)} fmt={usd}/>
          <SectionTitle>Campaigns</SectionTitle>
          <SpendCampaigns rows={d.ad_campaigns?.google}/>
        </>)}

        {sub === "lsa" && (<>
          <ConnectionCard title="Local Services Ads" connected={conn.lsa?.connected} lastSync={conn.lsa?.last_sync} steps={conn.lsa?.connected ? null : LSA_STEPS}
            syncFn={conn.lsa?.connected ? "google-ads-sync" : null} token={token} onSynced={() => setBump(b => b + 1)}
            note={conn.google?.last_result?.lsa?.ok === false ? `LSA leads didn't sync: ${conn.google.last_result.lsa.error}`
              : conn.lsa?.connected ? "Spend and every LSA lead (name + phone) come through the Google Ads connection. Leads are matched to HCP jobs by phone/email for bookings and revenue." : "Connect Google Ads (Google Ads tab) — LSA spend and leads come through that same connection."}/>
          <ChannelTiles ch={ch.lsa} paid att={att}/>
          {ch.lsa?.lsa_detail && Number(ch.lsa.lsa_detail.leads) > 0 && (() => {
            const x = ch.lsa.lsa_detail;
            const label = { PHONE_CALL:"Calls", MESSAGE:"Messages", BOOKING:"Bookings", UNKNOWN:"Other" };
            return (
              <TileGrid>
                <StatTile label="LSA leads" value={x.leads} sub={`${x.people} people`}/>
                <StatTile label="Charged by Google" value={x.charged} sub={Number(x.spend || ch.lsa.spend) > 0 && x.charged ? `${usd(Number(ch.lsa.spend) / x.charged)} each` : null}/>
                <StatTile label="Matched to HCP jobs" value={x.customers} sub={x.people ? `${Math.round(100 * x.customers / x.people)}% of people · ${x.jobs} jobs` : null}/>
                {Object.entries(x.by_type || {}).map(([k, n]) => <StatTile key={k} label={label[k] || k.replace(/_/g, " ").toLowerCase()} value={n}/>)}
              </TileGrid>
            );
          })()}
          <DailyBars title="Local Services spend per day" days={days} value={x => Number(x.spend?.lsa || 0)} fmt={usd}/>
          <SpendCampaigns rows={d.ad_campaigns?.lsa}/>
        </>)}

        {sub === "website" && (<>
          <ConnectionCard title="Google Analytics (visitors)" connected={conn.ga4?.connected} lastSync={conn.ga4?.last_sync} steps={conn.ga4?.connected ? null : GA4_STEPS}
            connectUrl={`/.netlify/functions/google-ads-auth?t=${encodeURIComponent(token || "")}`} connectLabel={conn.ga4?.connected ? "Reconnect Google" : "Reconnect Google (adds Analytics)"}
            syncFn={conn.ga4?.connected ? "ga4-sync" : null} token={token} onSynced={() => setBump(b => b + 1)}
            note={conn.ga4?.last_result?.ok === false ? `Last sync failed: ${conn.ga4.last_result.error}`
              : conn.ga4?.connected ? (conn.ga4?.last_result?.property ? `Reading GA4 property ${conn.ga4.last_result.property_name || ""} (${conn.ga4.last_result.property}).` : "Tap Sync now to pull the last 90 days.")
              : "Form leads from skylod.com are live from GHL below. Reconnecting Google adds visitors and the form conversion rate (same sign-in as Google Ads)."}/>
          {d.ga4?.has_data && (() => {
            const g = d.ga4, formLeads = ch.website.leads + ch.social.leads;
            return (<>
              <TileGrid>
                <StatTile label="Visitors" value={Number(g.users).toLocaleString()} sub={`${Number(g.sessions).toLocaleString()} visits`}/>
                <StatTile label="Engaged visits" value={pctOf(g.engaged, g.sessions)} sub="stayed 10s+, 2+ pages, or converted"/>
                <StatTile label="Form lead rate" value={g.sessions ? `${(100 * formLeads / g.sessions).toFixed(2)}%` : "—"} sub={`${formLeads} GHL form leads ÷ visits`}/>
                <StatTile label="Key events (GA4)" value={Math.round(g.key_events)} sub="as counted by Google Analytics"/>
              </TileGrid>
              <SectionTitle>Visits by channel</SectionTitle>
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"6px 14px" }}>
                {g.by_channel.map(c => (
                  <div key={c.channel} style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}40`, fontSize:"13px" }}>
                    <span style={{ color:C.black }}>{c.channel}</span>
                    <span style={{ color:C.muted }}><b style={{ color:C.black }}>{Number(c.sessions).toLocaleString()}</b> visits · {Number(c.users).toLocaleString()} visitors · {Math.round(c.key_events)} key events</span>
                  </div>
                ))}
              </div>
              <SectionTitle>Top landing pages</SectionTitle>
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"6px 14px" }}>
                {g.pages.map(pg => (
                  <div key={pg.page} style={{ display:"flex", justifyContent:"space-between", gap:"8px", padding:"8px 0", borderBottom:`1px solid ${C.border}40`, fontSize:"12px" }}>
                    <span style={{ color:C.black, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{pg.page}</span>
                    <span style={{ color:C.muted, whiteSpace:"nowrap" }}><b style={{ color:C.black }}>{Number(pg.sessions).toLocaleString()}</b> visits · {Math.round(pg.key_events)} events</span>
                  </div>
                ))}
              </div>
            </>);
          })()}
          <ChannelTiles att={att} ch={{ ...ch.website, leads:ch.website.leads + ch.social.leads, booked:ch.website.booked + ch.social.booked,
            customers:ch.website.customers + ch.social.customers, plans_sold:(ch.website.plans_sold || 0) + (ch.social.plans_sold || 0),
            revenue_upfront:Number(ch.website.revenue_upfront || 0) + Number(ch.social.revenue_upfront || 0), revenue_sold:Number(ch.website.revenue_sold || 0) + Number(ch.social.revenue_sold || 0),
            revenue_beyond:Number(ch.website.revenue_beyond || 0) + Number(ch.social.revenue_beyond || 0),
            revenue_serviced:Number(ch.website.revenue_serviced || 0) + Number(ch.social.revenue_serviced || 0) }}/>
          <DailyBars title="Website form leads per day" days={days} value={x => (x.leads?.website || 0) + (x.leads?.social || 0)}/>
          <SectionTitle>Where website leads came from</SectionTitle>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"6px 14px" }}>
            {(d.website_sources || []).length === 0 && <div style={{ fontSize:"13px", color:C.muted, padding:"8px 0" }}>No website leads in this range.</div>}
            {(d.website_sources || []).map(w => (
              <div key={w.source} style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}40`, fontSize:"13px" }}>
                <span style={{ color:C.black }}>{w.source === "Social media" ? "Social media (organic / link in bio)" : w.source}</span>
                <span style={{ color:C.muted }}><b style={{ color:C.black }}>{w.leads}</b> leads · {w.booked} booked · {usd(w.revenue_sold)}</span>
              </div>
            ))}
          </div>
          {(d.website_pages || []).length > 0 && (<>
            <SectionTitle>Top lead pages</SectionTitle>
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"6px 14px" }}>
              {d.website_pages.map(p => (
                <div key={p.page} style={{ display:"flex", justifyContent:"space-between", gap:"8px", padding:"8px 0", borderBottom:`1px solid ${C.border}40`, fontSize:"12px" }}>
                  <span style={{ color:C.black, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.page.replace(/^https?:\/\//, "")}</span><b>{p.leads}</b>
                </div>
              ))}
            </div>
          </>)}
        </>)}
        {s.loading && <div style={{ fontSize:"11px", color:C.muted }}>Refreshing...</div>}
      </>)}
    </div>
  );
}

function FunnelBlock({ k, label, revenue }) {
  if (!k) return null;
  return (
    <TileGrid>
      <StatTile label={`${label} leads`} value={k.leads} sub="New customers in range"/>
      <StatTile label="Contacted" value={k.contacted} sub={`${pctOf(k.contacted, k.leads)} of leads`}/>
      <StatTile label="Speed to lead" value={fmtSeconds(k.median_seconds_to_contact)} sub={`median · ${k.in_hours_leads} leads in work hours`}/>
      <StatTile label="Contacted within 60 sec" value={pctOf(k.within_60s, k.in_hours_leads)} sub={`${k.within_60s} of ${k.in_hours_leads} · ${k.within_5m} within 5 min`}/>
      <StatTile label="After-hours leads" value={k.after_hours_leads} sub={`${pctOf(k.after_hours_auto_replied, k.after_hours_leads)} got an auto-text within 15 min`}/>
      {k.demos > 0 && <StatTile label="Demo details set" value={k.demos}/>}
      <StatTile label="Jobs booked" value={k.booked_in_period} sub="booked in this range"/>
      <StatTile label="Booking rate" value={pctOf(k.booked_from_leads, k.leads)} sub={`${k.booked_from_leads} of these leads booked`}/>
      {revenue && <StatTile label={`${label} committed revenue`} value={usd(revenue.sold)} sub={`${usd(revenue.serviced)} serviced`}/>}
    </TileGrid>
  );
}

// Reps who can see their own Sales report from their tech login (tech id ->
// rep key). reports.js enforces the same list (REPS[...].selfTechId).
const SALES_SELF_VIEW = { "4641f4da-a16f-411b-8688-8b81ac06eda7": "trevor" };

function SalesTab({ token, onlyRep=null }) {
  const [range, setRange] = useState(() => rangeFor("month"));
  const [rep, setRep] = useState(onlyRep || "trevor");
  const s = useGrowthReport({ type:"sales", rep, ...range }, token);
  const d = s.data;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
      {!onlyRep && <SubTabs tabs={[["trevor","Trevor · Inbound"],["ethan","Ethan · Commercial"]]} active={rep} setActive={setRep}/>}
      <GrowthRange range={range} setRange={setRange}/>
      <ReportState s={s}/>
      {d && d.rep?.toLowerCase() === rep && (<>
        {!d.ghl_user_found && <div style={{ fontSize:"12px", color:C.red }}>Couldn't find {d.rep} as a GHL user.</div>}
        <SectionTitle>Revenue</SectionTitle>
        <TileGrid>
          <StatTile label="Upfront revenue" value={usd(d.revenue?.upfront)} sub={`${d.revenue?.sold_jobs || 0} first visits booked`}/>
          <StatTile label="Committed revenue" value={usd(d.revenue?.sold)} sub={`incl. ${usd(d.revenue?.plan_committed)} of plan minimums`}/>
          <StatTile label="Revenue serviced" value={usd(d.revenue?.serviced)} sub={`${d.revenue?.serviced_jobs || 0} of those jobs completed`}/>
          <StatTile label="Recurring plans sold" value={d.plans?.sold ?? 0} sub={Object.entries(d.plans?.by_plan || {}).map(([p, n]) => `${n} ${p}`).join(" · ") || "none in range"}/>
          {d.plans?.cancelled > 0 && <StatTile label="Plans cancelled" value={d.plans.cancelled}/>}
        </TileGrid>
        <div style={{ fontSize:"11px", color:C.muted }}>{REVENUE_NOTE}</div>

        <SectionTitle>Calls & texts</SectionTitle>
        <TileGrid>
          <StatTile label="Outbound calls" value={d.calls?.total ?? 0} sub={`${d.calls?.days_calling || 0} days calling`}/>
          <StatTile label="Calls per day" value={d.calls?.per_day ?? 0} sub="on days calling"/>
          <StatTile label="Conversations" value={d.calls?.connected ?? 0} sub={`calls 1+ min · ${pctOf(d.calls?.connected, d.calls?.total)}`}/>
          <StatTile label="Talk time" value={fmtMinutes(d.calls?.talk_minutes)}/>
          <StatTile label="Texts sent" value={d.texts ?? 0}/>
        </TileGrid>
        <DailyBars title="Outbound calls per day" days={d.daily || []} value={x => x.calls}/>

        {rep === "trevor" ? (<>
          <SectionTitle>Inbound leads</SectionTitle>
          <FunnelBlock k={d.by_kind?.all} label="Inbound"/>
        </>) : (<>
          <SectionTitle>Warm inbound</SectionTitle>
          <FunnelBlock k={d.by_kind?.warm} label="Inbound" revenue={d.revenue?.by_kind?.warm}/>
          <SectionTitle>Cold outreach</SectionTitle>
          <FunnelBlock k={d.by_kind?.cold} label="Cold" revenue={d.revenue?.by_kind?.cold}/>
          <div style={{ fontSize:"11px", color:C.muted }}>Speed to lead only counts leads that came in 8am–5pm Mountain, Mon–Thu, or on a weekend day the rep worked. Cold = commercial deals that started in "Outbound - Uncontacted" or came from Apollo / personal research.</div>
        </>)}
        <DailyBars title="Jobs booked per day" days={d.daily || []} value={x => x.booked} color={C.green}/>
        <div style={{ fontSize:"11px", color:C.muted }}>From GHL pipelines: {(d.pipelines || []).join(", ")}. Calls and texts are the ones {d.rep} made in GHL. Speed to lead = time from the lead landing in GHL to the first call or text by a person, for leads that came in 8am–5pm Mountain Mon–Thu (or a weekend day {d.rep} worked).</div>
        {s.loading && <div style={{ fontSize:"11px", color:C.muted }}>Refreshing...</div>}
      </>)}
    </div>
  );
}

// Owner / manager overview of every Detail Apprentice's training: progress
// toward the 8 full Perfect Days + misc reps, who's training them, and their
// latest day. Tap an apprentice to open their rubric (editable, notes shown).
function TrainingOverviewTab({ techs, currentUser, refreshAll }) {
  const [items, setItems] = useState([]);
  const [checks, setChecks] = useState([]);
  const [notes, setNotes] = useState([]);
  const [tests, setTests] = useState([]);
  const [evals, setEvals] = useState([]);
  const [evalResults, setEvalResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [mode, setMode] = useState(null); // null | "test" | "eval"
  const [testKey, setTestKey] = useState("perfect_day");
  const [trainerSel, setTrainerSel] = useState("");

  // Who is giving the test/evaluation: the manager's own tech record, or the
  // owner's (owners log in by name, so match it to their owner tech row).
  const first = (currentUser?.name || "").toLowerCase().split(" ")[0];
  const adminUser = currentUser?.techId
    ? { techId:currentUser.techId, name:techs.find(t => t.id === currentUser.techId)?.name || currentUser.name }
    : { techId:(first && techs.find(t => t.title === "owner" && t.name.toLowerCase().startsWith(first))?.id) || null, name:currentUser?.name || null };

  async function load() {
    try {
      const [it, ck, nt, ts, ev, er] = await Promise.all([
        sb("rubric_items?select=*&order=sort_order"),
        sb("training_checks?select=trainee_id,day_date,rubric_item_id,status"),
        sb("training_day_notes?select=trainee_id,day_date,overall_rating,pace,incident&order=day_date.desc"),
        sb("training_tests?select=*&order=started_at.desc"),
        sb("perfect_day_certs?select=*&order=created_at.desc"),
        sb("perfect_day_cert_results?select=*"),
      ]);
      setItems(it || []); setChecks(ck || []); setNotes(nt || []);
      setTests(ts || []); setEvals(ev || []); setEvalResults(er || []);
    } catch {}
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const name = id => techs.find(t => t.id === id)?.name;
  const trainerOf = t => t.assigned_trainer_id || t.team_lead_id;
  const withChecks = new Set(checks.map(c => c.trainee_id));
  const trainees = techs
    .filter(t => t.is_active !== false && ((t.title || "detail_apprentice") === "detail_apprentice" || withChecks.has(t.id)))
    .map(t => {
      const mine = checks.filter(c => c.trainee_id === t.id);
      const days = [...new Set([...mine.map(c => c.day_date), ...notes.filter(n => n.trainee_id === t.id).map(n => n.day_date)])].sort();
      return { t, prog: trainingProgress(items, mine), days, lastNote: notes.find(n => n.trainee_id === t.id) };
    })
    .sort((a, b) => (a.prog.complete - b.prog.complete) || (b.prog.pct - a.prog.pct) || a.t.name.localeCompare(b.t.name));

  const small = { fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", fontFamily:FONT, fontWeight:"600" };
  const open = trainees.find(x => x.t.id === openId);

  if (loading) return <div style={{ color:C.muted, padding:"20px" }}>Loading training...</div>;

  if (open && mode === "test") return <WrittenTestRunner testKey={testKey} trainee={open.t} adminUser={adminUser} onExit={() => { setMode(null); load(); }}/>;
  if (open && mode === "eval") return <FinalEvalRunner trainee={open.t} adminUser={adminUser} rubricItems={items} priorAttempts={evals.filter(e => e.tech_id === open.t.id).length} refreshAll={refreshAll} onExit={() => { setMode(null); load(); }}/>;

  if (open) {
    const trainers = techs.filter(t => t.is_active !== false && (t.is_lead || TRAINER_TITLES.includes(t.title)));
    return (
      <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
        <button onClick={() => { setOpenId(null); setTrainerSel(""); load(); }} style={{ alignSelf:"flex-start", background:"none", border:`1px solid ${C.border}`, color:C.blue, padding:"6px 14px", borderRadius:"16px", cursor:"pointer", fontFamily:FONT, fontWeight:"600", fontSize:"13px" }}>← All apprentices</button>
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"10px 14px", display:"flex", alignItems:"center", gap:"10px" }}>
          <span style={{ ...small, whiteSpace:"nowrap" }}>Checking off as</span>
          <select value={trainerSel || trainerOf(open.t) || ""} onChange={e => setTrainerSel(e.target.value)} style={{ flex:1, background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"8px 10px", borderRadius:"10px", fontSize:"14px" }}>
            <option value="">— No trainer —</option>
            {trainers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <FinalDayResults trainee={open.t} prog={open.prog} tests={tests.filter(x => x.trainee_id === open.t.id)} evals={evals.filter(e => e.tech_id === open.t.id)} evalResults={evalResults} rubricItems={items} techs={techs}
          onStartTest={key => { setTestKey(key); setMode("test"); }}
          onStartEval={() => setMode("eval")}
          onToggleClassroom={async () => { try { await sb(`techs?id=eq.${open.t.id}`, { method:"PATCH", prefer:"return=minimal", body:JSON.stringify({ classroom_complete:!open.t.classroom_complete }) }); refreshAll && await refreshAll(); } catch(e) { window.alert("Couldn't save: " + e.message); } }}/>
        <PerfectDayTrainingPanel key={open.t.id} admin techs={techs} fixedSubject={open.t} adminTrainerId={trainerSel || trainerOf(open.t) || ""}/>
      </div>
    );
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
      <div style={{ fontSize:"12px", color:C.muted, padding:"0 4px" }}>
        Every Detail Apprentice's training. Done = {TRAINING_MIN_DAYS} full Perfect Days + every Miscellaneous item {MISC_REPS}×. Tap a name to open their rubric and notes.
      </div>
      {trainees.length === 0 && <div style={{ background:C.cardLt, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"14px", fontSize:"13px", color:C.muted }}>No Detail Apprentices right now.</div>}
      {trainees.map(({ t, prog, days, lastNote }) => (
        <div key={t.id} onClick={() => setOpenId(t.id)} style={{ background:C.card, border:`1px solid ${prog.complete ? C.green : C.border}`, borderRadius:"16px", padding:"14px 16px", cursor:"pointer" }}>
          <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:"10px" }}>
            <div>
              <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"18px", color:C.black }}>{t.name}</div>
              <div style={{ fontSize:"11px", color:C.muted }}>Trainer: {name(trainerOf(t)) || "not assigned"}{days.length ? ` · last trained ${fmtDay(days[days.length-1])}` : " · not started"}</div>
            </div>
            <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"26px", color:prog.complete ? C.green : C.purple }}>{prog.pct}%</div>
          </div>
          <div style={{ marginTop:"8px" }}><Bar pct={prog.pct} color={prog.complete ? C.green : C.purple} h={8}/></div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px", marginTop:"10px" }}>
            <div>
              <div style={small}>PERFECT DAYS {prog.fullDays}/{TRAINING_MIN_DAYS}</div>
              <div style={{ display:"flex", gap:"3px", marginTop:"4px" }}>
                {Array.from({ length:TRAINING_MIN_DAYS }, (_, i) => <div key={i} style={{ flex:1, height:"6px", borderRadius:"3px", background:i < prog.fullDays ? C.green : C.border }}/>)}
              </div>
            </div>
            <div>
              <div style={small}>MISC REPS {prog.miscDone}/{prog.miscMax}</div>
              <div style={{ marginTop:"4px" }}><Bar pct={prog.miscMax ? (prog.miscDone/prog.miscMax)*100 : 0} color={C.gold} h={6}/></div>
            </div>
          </div>
          <div style={{ display:"flex", gap:"10px", flexWrap:"wrap", marginTop:"8px", fontSize:"11px", color:C.muted }}>
            <span>{days.length} day{days.length===1?"":"s"} logged</span>
            {lastNote?.overall_rating ? <span style={{ color:C.gold }}>{"★".repeat(lastNote.overall_rating)}</span> : null}
            {lastNote?.pace === "behind" && <span style={{ color:C.red }}>Behind pace</span>}
            {notes.some(n => n.trainee_id === t.id && n.incident) && <span style={{ color:C.red }}>⚠️ Incident noted</span>}
            {(() => { const mine = tests.filter(x => x.trainee_id === t.id); return prog.complete && !(passedTestFor(mine, "perfect_day") && passedTestFor(mine, "misc")); })() && <span style={{ color:C.green, fontWeight:"700" }}>{t.classroom_complete ? "✅ Ready for the written tests" : "✅ Field training done · classroom day not marked"}</span>}
            {(() => { const mine = tests.filter(x => x.trainee_id === t.id); return TEST_KEYS.map(k => { const pt = passedTestFor(mine, k); return pt ? <span key={k} style={{ color:C.purple }}>📝 {TESTS[k].short} passed · {pt.first_try_correct}/{pt.total_questions} first try</span> : null; }); })()}
            {(() => { const es = evals.filter(e => e.tech_id === t.id); if (!es.length) return null; const p = es.find(e => e.overall_result === "pass"); return <span style={{ color:p ? C.green : C.red, fontWeight:"700" }}>{p ? (t.title === "detail_pro" ? "🎓 Promoted to Detail Pro" : "🏁 Practical passed") : `🏁 Practical failed ×${es.length}`}</span>; })()}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── FINAL ONBOARDING SIGN-OFF ───────────────────────────────────────────────
// Sits under the cert on the Development tab. Once all three boxes are
// checked and an admin types their name, the apprentice becomes a Detail Pro
// and their check-in clock starts that day (week 1 check-in = 7 days later).
const ONBOARDING_BOXES = [
  ["perfect_day_rubric_complete", "Perfect Day Rubric complete"],
  ["misc_rubric_complete",        "Miscellaneous Rubric complete"],
  ["onboarding_complete",         "Onboarding complete"],
];
function OnboardingSignOff({ tech, refreshAll, showToast, onComplete }) {
  const fromTech = t => Object.fromEntries(ONBOARDING_BOXES.map(([k]) => [k, !!t[k]]));
  const [boxes, setBoxes] = useState(fromTech(tech));
  const [sig, setSig] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setBoxes(fromTech(tech)); setSig(""); }, [tech.id]);
  const signed = !!tech.onboarding_complete_date;
  const allChecked = ONBOARDING_BOXES.every(([k]) => boxes[k]);

  async function toggle(key, val) {
    setBoxes(b => ({ ...b, [key]:val }));
    try {
      await sb(`techs?id=eq.${tech.id}`, { method:"PATCH", prefer:"return=minimal", body:JSON.stringify({ [key]:val }) });
      refreshAll && refreshAll();
    } catch(e) { setBoxes(b => ({ ...b, [key]:!val })); showToast("Error: " + e.message, false); }
  }

  async function complete() {
    if (!allChecked) return showToast("Check all three boxes first", false);
    if (!sig.trim()) return showToast("Type your name to sign", false);
    const today = mountainDate(new Date().toISOString());
    // Only an apprentice gets promoted; signing for anyone already past that
    // must never change (demote) their title.
    const promote = (tech.title || "detail_apprentice") === "detail_apprentice";
    if (!window.confirm(`Sign off ${tech.name}'s onboarding?\n\n${promote ? `They'll become a Detail Pro today (${today}) and their` : `Their title stays the same. Their`} 1-week check-in will be due 7 days from now.`)) return;
    setSaving(true);
    try {
      await sb(`techs?id=eq.${tech.id}`, { method:"PATCH", prefer:"return=minimal", body:JSON.stringify({
        perfect_day_rubric_complete:true, misc_rubric_complete:true, onboarding_complete:true,
        onboarding_signed_by:sig.trim(), onboarding_complete_date:today,
        ...(promote ? { title:"detail_pro" } : {}), onboarding_stage:"active",
      }) });
      // Drop any check-ins that were scheduled off the hire date and haven't
      // happened yet, then schedule fresh ones from today.
      await sb(`checkins?tech_id=eq.${tech.id}&or=(status.is.null,status.neq.completed)`, { method:"DELETE", prefer:"return=minimal" });
      await scheduleCheckins(tech.id, today);
      showToast(promote ? `🎓 ${tech.name} is now a Detail Pro. Check-ins start today.` : `✅ ${tech.name}'s onboarding is signed. Check-ins start today.`);
      await refreshAll();
      onComplete && onComplete();
    } catch(e) { showToast("Error: " + e.message, false); }
    setSaving(false);
  }

  return (
    <div style={{ background:C.card, border:`1px solid ${signed ? C.green : C.border}`, borderRadius:"16px", padding:"16px", display:"flex", flexDirection:"column", gap:"10px" }}>
      <Label color={signed ? C.green : C.blue}>Onboarding Sign-Off — {tech.name}</Label>
      {ONBOARDING_BOXES.map(([key, label]) => (
        <div key={key} style={{ display:"flex", alignItems:"center", gap:"10px", padding:"8px", background:`${C.blue}08`, borderRadius:"10px" }}>
          <input type="checkbox" id={`ob_${key}_${tech.id}`} checked={signed || !!boxes[key]} disabled={signed} onChange={e => toggle(key, e.target.checked)} style={{ width:"16px", height:"16px", cursor:signed ? "default" : "pointer" }}/>
          <label htmlFor={`ob_${key}_${tech.id}`} style={{ fontSize:"13px", color:C.black, cursor:signed ? "default" : "pointer" }}>{label}</label>
        </div>
      ))}
      {signed ? (
        <div style={{ fontSize:"13px", color:C.green, fontWeight:"700" }}>
          ✅ Signed by {tech.onboarding_signed_by || "—"} on {tech.onboarding_complete_date}. Check-ins count from this date.
        </div>
      ) : (
        <>
          <div>
            <div style={{ fontSize:"11px", color:C.muted, marginBottom:"4px" }}>Signature (type your full name)</div>
            <input type="text" value={sig} onChange={e => setSig(e.target.value)} placeholder="Your name" style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"10px", borderRadius:"10px", fontSize:"15px", fontStyle:"normal", width:"100%", boxSizing:"border-box" }}/>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"8px", flexWrap:"wrap" }}>
            <div style={{ fontSize:"12px", color:C.muted }}>Signing promotes them to Detail Pro and starts their check-in clock today.</div>
            <button onClick={complete} disabled={saving || !allChecked || !sig.trim()} style={{ ...btnSm(allChecked && sig.trim() ? C.green : C.border), color:C.white }}>{saving ? "Saving..." : "Sign & Complete Onboarding"}</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── WRITTEN TEST QUESTION BANK (admin view) ────────────────────────────────
// Read-only view of both written tests with the right answer marked, so an
// admin can review the questions. Lives on the Development tab, which only
// admins can open; apprentices never see answers.
// Fixed per-question order for the review list (seeded by the question id) so
// the right answer isn't always first and the order doesn't jump around.
function reviewOrder(x) {
  let h = 0; for (const ch of x.id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  const rand = () => { h = (h + 0x6D2B79F5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const a = [x.correct, ...x.wrong];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function TestQuestionBank() {
  const [key, setKey] = useState("perfect_day");
  const [q, setQ] = useState("");
  const all = questionsFor(key);
  const term = q.trim().toLowerCase();
  const shown = term ? all.filter(x => [x.q, x.topic, x.correct, ...x.wrong].join(" ").toLowerCase().includes(term)) : all;
  const topics = [...new Set(shown.map(x => x.topic))];
  const numOf = Object.fromEntries(all.map((x, i) => [x.id, i + 1]));
  const pill = on => ({ flex:1, background:on ? C.purple : C.cardLt, border:`1px solid ${on ? C.purple : C.border}`, color:on ? C.white : C.black, padding:"8px 12px", borderRadius:"16px", cursor:"pointer", fontSize:"12px", fontWeight:"700", fontFamily:FONT, letterSpacing:"-0.01em", textTransform:"none" });
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
      <div style={{ display:"flex", gap:"6px" }}>
        {TEST_KEYS.map(k => <button key={k} onClick={() => setKey(k)} style={pill(key === k)}>{TESTS[k].name} ({questionsFor(k).length})</button>)}
      </div>
      <div style={{ fontSize:"12px", color:C.muted }}>
        Every question on the {TESTS[key].name}, grouped by topic. ✓ marks the right answer. On the real test the A–D order is reshuffled every time, and apprentices never see which answer is right.
      </div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search questions or answers" style={{ background:C.white, border:`1px solid ${C.border}`, color:C.black, padding:"10px 14px", borderRadius:"10px", fontSize:"14px", width:"100%", boxSizing:"border-box" }}/>
      {shown.length === 0 && <div style={{ fontSize:"13px", color:C.muted }}>No questions match.</div>}
      {topics.map(topic => (
        <div key={topic} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"14px 16px", display:"flex", flexDirection:"column", gap:"12px" }}>
          <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"13px", color:C.purple, letterSpacing:"-0.01em" }}>{topic.toUpperCase()} · {shown.filter(x => x.topic === topic).length}</div>
          {shown.filter(x => x.topic === topic).map(x => (
            <div key={x.id} style={{ borderTop:`1px solid ${C.border}40`, paddingTop:"10px" }}>
              <div style={{ fontSize:"14px", color:C.black, fontWeight:"700", lineHeight:1.4 }}><span style={{ color:C.muted, fontWeight:"600" }}>#{numOf[x.id]}</span> {x.q}</div>
              <div style={{ marginTop:"6px", display:"flex", flexDirection:"column", gap:"3px" }}>
                {reviewOrder(x).map((a, i) => {
                  const right = a === x.correct;
                  return (
                    <div key={a} style={{ fontSize:"13px", color:right ? C.green : C.muted, fontWeight:right ? "700" : "400", display:"flex", gap:"8px" }}>
                      <span style={{ fontFamily:FONT, fontWeight:"700", minWidth:"14px" }}>{"ABCD"[i]}</span>
                      <span>{a}{right ? " ✓" : ""}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function DevelopmentTab({ techs, rideAlongs, refreshAll, showToast }) {
  const inp = { background:C.white, border:`1px solid ${C.border}`, color:C.black, padding:"10px 14px", borderRadius:"10px", fontSize:"14px", fontFamily:FONT, width:"100%", boxSizing:"border-box" };
  const sel = (val) => ({...inp, color:val ? C.black : C.muted });
  const btn = (color) => ({ background:color||C.blue, border:"none", color:C.white, padding:"11px 18px", borderRadius:"20px", cursor:"pointer", fontSize:"12px", fontWeight:"700", fontStyle:"normal", letterSpacing:"-0.01em", fontFamily:FONT, textTransform:"none" });
  const btnSm = (color) => ({...btn(color), padding:"6px 14px", fontSize:"11px" });

  const [devView, setDevView] = useState("signoff");
  const [rubricItems, setRubricItems] = useState(null);
  const [signoffs, setSignoffs] = useState([]);
  const [trainingChecks, setTrainingChecks] = useState([]);
  const [certs, setCerts] = useState([]);
  const [certResults, setCertResults] = useState([]);
  const [checkins, setCheckins] = useState([]);
  const [loadingDev, setLoadingDev] = useState(true);
  const [seeding, setSeeding] = useState(false);

  const [trainerSel, setTrainerSel] = useState("");
  // The Perfect Day cert tests the daily rubric only, not the misc section.
  const certItems = (rubricItems || []).filter(i => (i.section || "daily") === "daily");
  const [expandedTech, setExpandedTech] = useState(null);
  const [expandedScript, setExpandedScript] = useState({});

  const [certTechSel, setCertTechSel] = useState("");
  const [certAdminBy, setCertAdminBy] = useState("");
  const [certDate, setCertDate] = useState(new Date().toISOString().split("T")[0]);
  const [certScores, setCertScores] = useState({});
  const [submittingCert, setSubmittingCert] = useState(false);
  const [lastCertResult, setLastCertResult] = useState(null);

  const [selectedCheckin, setSelectedCheckin] = useState(null);
  const [checkinForm, setCheckinForm] = useState({});
  const [savingCheckin, setSavingCheckin] = useState(false);

  useEffect(() => { loadDevData(); }, []);

  async function loadDevData() {
    setLoadingDev(true);
    try {
      const [items, offs, c, cr, ci, tc] = await Promise.all([
        sb("rubric_items?select=*&order=sort_order"),
        sb("training_signoffs?select=*"),
        sb("perfect_day_certs?select=*&order=created_at.desc"),
        sb("perfect_day_cert_results?select=*"),
        sb("checkins?select=*&order=scheduled_date"),
        sb("training_checks?select=trainee_id,day_date,rubric_item_id,status"),
      ]);
      setTrainingChecks(tc || []);
      setRubricItems(items || []);
      setSignoffs(offs || []);
      setCerts(c || []);
      setCertResults(cr || []);
      setCheckins(ci || []);
    } catch(e) { showToast("Error loading dev data: " + e.message, false); }
    setLoadingDev(false);
  }

  async function loadTrainingChecks() {
    try { setTrainingChecks(await sb("training_checks?select=trainee_id,day_date,rubric_item_id,status") || []); } catch {}
  }

  async function seedRubricItems() {
    setSeeding(true);
    try {
      await sb("rubric_items?on_conflict=id", { method:"POST", prefer:"resolution=merge-duplicates,return=minimal", body:JSON.stringify(RUBRIC_ITEMS_SEED) });
      showToast(`✅ ${RUBRIC_ITEMS_SEED.length} rubric items seeded!`);
      await loadDevData();
    } catch(e) { showToast("Error seeding: " + e.message, false); }
    setSeeding(false);
  }

  async function advanceStage(tech) {
    const order = ["classroom","field_training","cert_pending","cert_passed","active"];
    const idx = order.indexOf(tech.onboarding_stage || "classroom");
    if (idx < 0 || idx >= order.length - 1) return;
    const next = order[idx + 1];
    if (next === "cert_pending" && rubricItems) {
      const p = trainingProgress(rubricItems, trainingChecks.filter(c => c.trainee_id === tech.id));
      if (!p.complete) {
        showToast(`❌ Training isn't done yet: ${p.fullDays}/${TRAINING_MIN_DAYS} full Perfect Days, ${p.miscDone}/${p.miscMax} misc reps`, false);
        return;
      }
    }
    try {
      await sb(`techs?id=eq.${tech.id}`, { method:"PATCH", body:JSON.stringify({ onboarding_stage:next }), prefer:"return=minimal" });
      await refreshAll();
      showToast(`✅ ${tech.name} → ${STAGE_CONFIG[next]?.label || next}`);
      await loadDevData();
    } catch(e) { showToast("Error: " + e.message, false); }
  }

  async function submitCert() {
    if (!certTechSel) { showToast("Select a tech", false); return; }
    if (!certAdminBy) { showToast("Select administered by", false); return; }
    if (!certItems.length) { showToast("Rubric items not loaded", false); return; }
    const missing = certItems.filter(i => !certScores[i.id]);
    if (missing.length > 0) { showToast(`Score all items first (${missing.length} remaining)`, false); return; }
    const failedItems = certItems.filter(i => certScores[i.id] === "fail");
    const overall = failedItems.length === 0 ? "pass" : "fail";
    const tech = techs.find(t => t.id === certTechSel);
    const attemptNumber = certs.filter(c => c.tech_id === certTechSel).length + 1;
    setSubmittingCert(true);
    try {
      const certRes = await sb("perfect_day_certs", { method:"POST", body:JSON.stringify({ tech_id:certTechSel, attempt_number:attemptNumber, administered_by:certAdminBy, test_date:certDate, overall_result:overall }) });
      const certId = certRes?.[0]?.id;
      if (!certId) throw new Error("No cert ID returned");
      for (const item of certItems) {
        await sb("perfect_day_cert_results", { method:"POST", body:JSON.stringify({ cert_id:certId, rubric_item_id:item.id, result:certScores[item.id] }) });
      }
      const certStatus = overall==="pass" ? "passed" : attemptNumber===1 ? "failed_retest_1" : attemptNumber===2 ? "failed_retest_2" : "hard_fail";
      const patch = { cert_attempts:attemptNumber, cert_status:certStatus };
      if (overall === "pass") patch.onboarding_stage = "cert_passed";
      await sb(`techs?id=eq.${certTechSel}`, { method:"PATCH", body:JSON.stringify(patch), prefer:"return=minimal" });
      setLastCertResult({ overall, failedItems, techName:tech?.name, attemptNumber });
      showToast(overall==="pass" ? `✅ ${tech?.name} PASSED!` : `${tech?.name} did not pass — study sheet below`);
      await refreshAll();
      await loadDevData();
      setCertScores({});
    } catch(e) { showToast("Error: " + e.message, false); }
    setSubmittingCert(false);
  }

  async function saveCheckin() {
    if (!selectedCheckin) return;
    setSavingCheckin(true);
    try {
      await sb(`checkins?id=eq.${selectedCheckin.id}`, { method:"PATCH", prefer:"return=minimal", body:JSON.stringify({ ...checkinForm, status:"completed", completed_date:new Date().toISOString().split("T")[0] }) });
      showToast("✅ Check-in saved!");
      setSelectedCheckin(null); setCheckinForm({});
      await loadDevData();
    } catch(e) { showToast("Error: " + e.message, false); }
    setSavingCheckin(false);
  }

  if (loadingDev) return <div style={{ color:C.muted, padding:"20px" }}>Loading...</div>;

  const byPhase = {}, phases = [];
  if (rubricItems) {
    for (const item of certItems) {
      if (!byPhase[item.phase]) { byPhase[item.phase] = []; phases.push(item.phase); }
      byPhase[item.phase].push(item);
    }
  }
  const stageOrder = ["classroom","field_training","cert_pending","cert_passed","active"];
  const activeTechs = techs.filter(t => t.is_active !== false);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      {rubricItems && rubricItems.length === 0 && (
        <div style={{ background:`${C.gold}18`, border:`1px solid ${C.gold}`, borderRadius:"12px", padding:"14px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px" }}>
          <div style={{ fontSize:"13px", color:C.black }}>Rubric items not seeded yet.</div>
          <button onClick={seedRubricItems} disabled={seeding} style={btnSm(C.gold)}>{seeding ? "Seeding..." : `Seed ${RUBRIC_ITEMS_SEED.length} Items`}</button>
        </div>
      )}

      {/* Sub-view switcher */}
      <div style={{ display:"flex", gap:"8px", flexWrap:"wrap" }}>
        {[["signoff","📋 Training Sign-Off"],["cert","🏆 Final Onboarding Cert"],["checkins","📅 Check-Ins"],["tests","📝 Written Tests"]].map(([id,label]) => (
          <button key={id} onClick={() => setDevView(id)} style={{ ...btnSm(devView===id ? C.blue : C.cardLt), color:devView===id ? C.white : C.black, flex:1, minWidth:"120px", border:`1px solid ${devView===id ? C.blue : C.border}` }}>{label}</button>
        ))}
      </div>

      {/* ── A. TRAINING SIGN-OFF ── */}
      {devView==="signoff" && (
        <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"12px 16px", display:"flex", alignItems:"center", gap:"12px" }}>
            <span style={{ fontSize:"12px", fontFamily:FONT, fontWeight:"700", color:C.muted, whiteSpace:"nowrap" }}>SIGNING OFF AS:</span>
            <select value={trainerSel} onChange={e=>setTrainerSel(e.target.value)} style={{...sel(trainerSel), flex:1}}>
              <option value="">— Select Trainer —</option>
              {activeTechs.filter(t=>TRAINER_TITLES.includes(t.title)).map(t => <option key={t.id} value={t.id}>{t.name} — {TITLE_LABELS[t.title]}</option>)}
            </select>
          </div>
          {activeTechs.map(tech => {
            const sc = STAGE_CONFIG[tech.onboarding_stage || "classroom"] || STAGE_CONFIG.classroom;
            const items = rubricItems || [];
            const tProg = trainingProgress(items, trainingChecks.filter(c => c.trainee_id === tech.id));
            const isExp = expandedTech === tech.id;
            const stageIdx = stageOrder.indexOf(tech.onboarding_stage || "classroom");
            const canAdv = stageIdx >= 0 && stageIdx < stageOrder.indexOf("active");
            return (
              <div key={tech.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", overflow:"hidden" }}>
                <div onClick={() => setExpandedTech(isExp ? null : tech.id)} style={{ padding:"12px 16px", display:"flex", alignItems:"center", gap:"12px", cursor:"pointer", background:C.cardLt }}>
                  <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"16px", color:C.black, flex:1 }}>{tech.name}</div>
                  <Pill color={sc.color}>{sc.icon} {sc.label}</Pill>
                  <div style={{ fontSize:"12px", color:tProg.complete ? C.green : C.muted }}>{tProg.pct}% · {tProg.fullDays}/{TRAINING_MIN_DAYS} days</div>
                  <div style={{ fontSize:"13px", color:C.muted }}>{isExp ? "▲" : "▼"}</div>
                </div>
                {isExp && (
                  <div style={{ padding:"12px 16px", display:"flex", flexDirection:"column", gap:"10px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:"10px", padding:"8px", background:`${C.blue}08`, borderRadius:"10px" }}>
                      <input type="checkbox" id={`cc_${tech.id}`} checked={!!tech.classroom_complete} onChange={e => sb(`techs?id=eq.${tech.id}`,{method:"PATCH",body:JSON.stringify({classroom_complete:e.target.checked}),prefer:"return=minimal"}).then(()=>refreshAll()).catch(e=>showToast("Error: "+e.message,false))} style={{ width:"16px", height:"16px", cursor:"pointer" }}/>
                      <label htmlFor={`cc_${tech.id}`} style={{ fontSize:"13px", color:C.black, cursor:"pointer" }}>Classroom training complete</label>
                    </div>
                    <PerfectDayTrainingPanel admin techs={techs} fixedSubject={tech} adminTrainerId={trainerSel} onChange={loadTrainingChecks}/>
                    <div style={{ display:"flex", gap:"8px", marginTop:"8px", flexWrap:"wrap" }}>
                      {canAdv && <button onClick={() => advanceStage(tech)} style={btnSm(C.green)}>Advance → {STAGE_CONFIG[stageOrder[stageIdx+1]]?.label}</button>}
                      <button onClick={() => sb(`techs?id=eq.${tech.id}`,{method:"PATCH",body:JSON.stringify({onboarding_stage:"hard_fail"}),prefer:"return=minimal"}).then(()=>{ refreshAll(); showToast(`${tech.name} → Hard Fail`); loadDevData(); }).catch(e=>showToast("Error: "+e.message,false))} style={btnSm(C.red)}>Mark Hard Fail</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── B. FINAL ONBOARDING CERT ── */}
      {devView==="cert" && (
        <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
          {lastCertResult && lastCertResult.overall==="fail" && (
            <div style={{ background:"#ef444410", border:"2px solid #ef4444", borderRadius:"16px", padding:"16px" }}>
              <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"16px", color:C.red, marginBottom:"8px" }}>
                Study Sheet — {lastCertResult.techName} (Attempt {lastCertResult.attemptNumber})
              </div>
              <div style={{ fontSize:"12px", color:C.muted, marginBottom:"10px" }}>Review these before retesting:</div>
              {lastCertResult.failedItems.map(item => (
                <div key={item.id} style={{ padding:"8px 0", borderBottom:`1px solid ${C.border}40` }}>
                  <div style={{ fontSize:"13px", color:C.black, fontWeight:"600" }}>#{item.sort_order} {item.description}</div>
                  {item.has_script && item.script_text && (
                    <div style={{ background:C.blueXlt, border:`1px solid ${C.border}`, borderRadius:"10px", padding:"8px 10px", fontSize:"11px", color:C.black, marginTop:"4px", lineHeight:1.5 }}>{item.script_text}</div>
                  )}
                </div>
              ))}
              <button onClick={() => setLastCertResult(null)} style={{ ...btnSm(C.border), color:C.black, marginTop:"10px" }}>Dismiss</button>
            </div>
          )}
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px", display:"flex", flexDirection:"column", gap:"12px" }}>
            <Label color={C.blue}>Final Onboarding Cert</Label>
            <div style={{ display:"flex", gap:"10px", flexWrap:"wrap" }}>
              <div style={{ flex:1, minWidth:"150px" }}>
                <div style={{ fontSize:"11px", color:C.muted, marginBottom:"4px" }}>Tech</div>
                <select value={certTechSel} onChange={e => { setCertTechSel(e.target.value); setCertScores({}); setLastCertResult(null); }} style={sel(certTechSel)}>
                  <option value="">— Select Tech —</option>
                  {activeTechs.map(t => {
                    const att = certs.filter(c => c.tech_id === t.id).length;
                    return <option key={t.id} value={t.id} disabled={att>=3}>{t.name}{att>=3 ? " (3 attempts — blocked)" : ""}</option>;
                  })}
                </select>
              </div>
              <div style={{ flex:1, minWidth:"150px" }}>
                <div style={{ fontSize:"11px", color:C.muted, marginBottom:"4px" }}>Administered By</div>
                <select value={certAdminBy} onChange={e => setCertAdminBy(e.target.value)} style={sel(certAdminBy)}>
                  <option value="">— Select —</option>
                  {activeTechs.filter(t=>TRAINER_TITLES.includes(t.title)).map(t => <option key={t.id} value={t.id}>{t.name} — {TITLE_LABELS[t.title]}</option>)}
                </select>
              </div>
              <div style={{ flex:1, minWidth:"130px" }}>
                <div style={{ fontSize:"11px", color:C.muted, marginBottom:"4px" }}>Test Date</div>
                <input type="date" value={certDate} onChange={e => setCertDate(e.target.value)} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"10px", borderRadius:"10px", fontSize:"13px", fontFamily:FONT, width:"100%", boxSizing:"border-box" }}/>
              </div>
            </div>
            {certTechSel && certs.filter(c=>c.tech_id===certTechSel).length>=3 ? (
              <div style={{ background:"#ef444410", border:"1px solid #ef4444", borderRadius:"10px", padding:"12px", fontSize:"13px", color:C.red }}>
                ⚠ 3 attempts used. Recommend a fit conversation instead of another retest.
              </div>
            ) : certTechSel && rubricItems && rubricItems.length > 0 && (
              <>
                <div style={{ fontSize:"11px", color:C.muted }}>Score each item — any ❌ = overall fail.</div>
                {phases.map(phase => (
                  <div key={phase}>
                    <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"12px", color:C.blue, letterSpacing:"-0.01em", marginBottom:"4px", marginTop:"8px" }}>{PHASE_LABELS[phase]||phase}</div>
                    {byPhase[phase].map(item => (
                      <div key={item.id} style={{ display:"flex", alignItems:"center", gap:"8px", padding:"5px 0", borderBottom:`1px solid ${C.border}20` }}>
                        <div style={{ flex:1, fontSize:"12px", color:C.black }}><span style={{ color:C.muted, marginRight:"4px" }}>#{item.sort_order}</span>{item.description}</div>
                        <button onClick={() => setCertScores(s => ({...s, [item.id]: s[item.id]==="pass" ? null : "pass"}))} style={{ padding:"4px 10px", borderRadius:"10px", border:"none", cursor:"pointer", background:certScores[item.id]==="pass" ? C.green : C.cardLt, color:certScores[item.id]==="pass" ? C.white : C.black, fontSize:"13px" }}>✅</button>
                        <button onClick={() => setCertScores(s => ({...s, [item.id]: s[item.id]==="fail" ? null : "fail"}))} style={{ padding:"4px 10px", borderRadius:"10px", border:"none", cursor:"pointer", background:certScores[item.id]==="fail" ? C.red : C.cardLt, color:certScores[item.id]==="fail" ? C.white : C.black, fontSize:"13px" }}>❌</button>
                      </div>
                    ))}
                  </div>
                ))}
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:"4px" }}>
                  <div style={{ fontSize:"12px", color:C.muted }}>{Object.values(certScores).filter(Boolean).length}/{certItems.length} scored · {Object.values(certScores).filter(v=>v==="fail").length} fails</div>
                  <button onClick={submitCert} disabled={submittingCert} style={btnSm(C.blue)}>{submittingCert ? "Submitting..." : "Submit Cert"}</button>
                </div>
              </>
            )}
          </div>
          {certTechSel && techs.find(t => t.id === certTechSel) && (
            <OnboardingSignOff tech={techs.find(t => t.id === certTechSel)} refreshAll={refreshAll} showToast={showToast} onComplete={loadDevData}/>
          )}
          {certTechSel && certs.filter(c=>c.tech_id===certTechSel).length > 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
              <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"13px", color:C.muted, letterSpacing:"-0.01em" }}>Past attempts</div>
              {certs.filter(c=>c.tech_id===certTechSel).map(cert => (
                <div key={cert.id} style={{ background:C.card, border:`1px solid ${cert.overall_result==="pass" ? C.green : C.red}60`, borderRadius:"12px", padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div>
                    <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"14px", color:C.black }}>Attempt #{cert.attempt_number} — {cert.test_date}</div>
                    <div style={{ fontSize:"12px", color:cert.overall_result==="pass" ? C.green : C.red }}>{cert.overall_result==="pass" ? "✅ PASS" : "❌ FAIL"}</div>
                  </div>
                  <div style={{ fontSize:"11px", color:C.muted }}>{certResults.filter(r=>r.cert_id===cert.id&&r.result==="fail").length} fails</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── C. CHECK-INS ── */}
      {devView==="tests" && <TestQuestionBank/>}

      {devView==="checkins" && (
        <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
          {selectedCheckin && (
            <div style={{ background:C.card, border:`2px solid ${C.blue}`, borderRadius:"16px", padding:"16px", display:"flex", flexDirection:"column", gap:"10px" }}>
              <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"16px", color:C.black }}>
                {techs.find(t=>t.id===selectedCheckin.tech_id)?.name} — {selectedCheckin.milestone.replace("_"," ")} ({selectedCheckin.scheduled_date})
              </div>
              {(() => {
                const t = techs.find(x => x.id === selectedCheckin.tech_id);
                if (!t) return null;
                const td = t.start_date ? Math.floor((Date.now() - new Date(t.start_date+"T12:00:00Z")) / 86400000) : null;
                const myRA = (rideAlongs||[]).filter(r=>r.tech_id===t.id).sort((a,b)=>b.date?.localeCompare(a.date)).slice(0,3);
                const raAvg = myRA.length ? Math.round(myRA.reduce((s,r)=>{ const cl=r.checklist?JSON.parse(r.checklist):{}; const v=Object.values(cl); return s+(v.length?v.filter(x=>x==="✅").length/v.length*100:0); },0)/myRA.length) : null;
                return (
                  <div style={{ background:C.cardLt, borderRadius:"10px", padding:"10px 12px", fontSize:"12px", color:C.muted, display:"flex", gap:"16px", flexWrap:"wrap" }}>
                    {td!==null && <span>Tenure: <strong style={{color:C.black}}>{td} days</strong></span>}
                    {raAvg!==null && <span>Last 3 ride-along avg: <strong style={{color:C.black}}>{raAvg}%</strong></span>}
                  </div>
                );
              })()}
              <textarea placeholder="Audit notes (specific missed items discussed)..." value={checkinForm.audit_notes||""} onChange={e=>setCheckinForm(f=>({...f,audit_notes:e.target.value}))} style={{ ...inp, minHeight:"60px", resize:"vertical" }}/>
              <input type="text" placeholder="Goal for next milestone..." value={checkinForm.goal_set||""} onChange={e=>setCheckinForm(f=>({...f,goal_set:e.target.value}))} style={inp}/>
              <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                <input type="checkbox" id="happypay" checked={!!checkinForm.happy_with_pay} onChange={e=>setCheckinForm(f=>({...f,happy_with_pay:e.target.checked}))} style={{ width:"16px", height:"16px" }}/>
                <label htmlFor="happypay" style={{ fontSize:"13px", color:C.black }}>Happy with pay</label>
              </div>
              <textarea placeholder="Pay notes..." value={checkinForm.pay_notes||""} onChange={e=>setCheckinForm(f=>({...f,pay_notes:e.target.value}))} style={{ ...inp, minHeight:"50px", resize:"vertical" }}/>
              <textarea placeholder="Team feedback..." value={checkinForm.team_feedback||""} onChange={e=>setCheckinForm(f=>({...f,team_feedback:e.target.value}))} style={{ ...inp, minHeight:"50px", resize:"vertical" }}/>
              <textarea placeholder="QA notes..." value={checkinForm.qa_notes||""} onChange={e=>setCheckinForm(f=>({...f,qa_notes:e.target.value}))} style={{ ...inp, minHeight:"50px", resize:"vertical" }}/>
              <div style={{ display:"flex", gap:"8px" }}>
                <button onClick={saveCheckin} disabled={savingCheckin} style={btnSm(C.green)}>{savingCheckin ? "Saving..." : "Mark Complete & Save"}</button>
                <button onClick={() => { setSelectedCheckin(null); setCheckinForm({}); }} style={{ ...btnSm(C.cardLt), color:C.black, border:`1px solid ${C.border}` }}>Cancel</button>
              </div>
            </div>
          )}
          {activeTechs.map(tech => {
            const training = isInTraining(tech);
            const tci = training ? [] : checkins.filter(c=>c.tech_id===tech.id).sort((a,b)=>a.scheduled_date.localeCompare(b.scheduled_date));
            const today = new Date().toISOString().split("T")[0];
            return (
              <div key={tech.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", overflow:"hidden" }}>
                <div style={{ background:C.cardLt, padding:"10px 16px", fontFamily:FONT, fontWeight:"700", fontSize:"15px", color:C.black }}>
                  {tech.name}
                  {training
                    ? <span style={{ fontSize:"11px", color:C.purple, fontWeight:"700", marginLeft:"8px" }}>🎓 Detail Apprentice — in training</span>
                    : checkinBaseDate(tech) && <span style={{ fontSize:"11px", color:C.muted, fontWeight:"400", marginLeft:"8px" }}>{tech.onboarding_complete_date ? `onboarding complete ${tech.onboarding_complete_date}` : `started ${tech.start_date}`}</span>}
                </div>
                {tci.length === 0 ? (
                  <div style={{ padding:"12px 16px", fontSize:"12px", color:C.muted }}>{training ? "Check-ins start once the Final Onboarding Cert is signed. Their 1-week check-in is 7 days after that." : "No check-ins scheduled. Set a start date to auto-schedule."}</div>
                ) : (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:"8px", padding:"12px 16px" }}>
                    {tci.map(ci => {
                      const done = ci.status==="completed";
                      const over = !done && ci.scheduled_date < today;
                      const clr = done ? C.green : over ? C.red : C.blue;
                      return (
                        <button key={ci.id} onClick={() => { setSelectedCheckin(ci); setCheckinForm({ audit_notes:ci.audit_notes||"", goal_set:ci.goal_set||"", happy_with_pay:ci.happy_with_pay, pay_notes:ci.pay_notes||"", team_feedback:ci.team_feedback||"", qa_notes:ci.qa_notes||"" }); }} style={{ background:`${clr}15`, border:`2px solid ${clr}`, borderRadius:"10px", padding:"8px 12px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:"2px", minWidth:"90px" }}>
                          <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"13px", color:clr }}>{ci.milestone.replace("_"," ")}</div>
                          <div style={{ fontSize:"11px", color:C.muted }}>{ci.scheduled_date}</div>
                          <div style={{ fontSize:"11px", color:clr, fontWeight:"bold" }}>{done ? "✓ Done" : over ? "⚠ Overdue" : "Upcoming"}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── SPLIT JOBS ADMIN ─────────────────────────────────────────────────────────
function SplitJobsAdmin({ techs, pendingSplits, refreshAll, showToast }) {
  const techById = Object.fromEntries(techs.map(t => [t.id, t]));
  const [splitInputs, setSplitInputs] = useState({});
  const [upsellAttrib, setUpsellAttrib] = useState({});
  // Row-scoped save state — which single jobId is currently saving, not a
  // shared boolean, so one row's in-flight save doesn't disable/relabel
  // every other row's button.
  const [savingJobId, setSavingJobId] = useState(null);
  // Jobs saved successfully this session, hidden immediately rather than
  // waiting on the next refreshAll()/split_confirmed filter to catch up.
  const [dismissedJobIds, setDismissedJobIds] = useState(new Set());

  // Pre-load any existing upsell attributions for these split jobs
  useEffect(() => {
    if (!pendingSplits.length) return;
    const jobIds = [...new Set(pendingSplits.map(r => r.hcp_job_id))];
    const inList = jobIds.map(id => `"${id}"`).join(",");
    sb(`job_upsell_attribution?hcp_job_id=in.(${inList})&select=hcp_job_id,tech_id`)
      .then(rows => {
        const map = {};
        for (const row of (rows || [])) map[row.hcp_job_id] = row.tech_id;
        setUpsellAttrib(map);
      })
      .catch(() => {});
  }, [pendingSplits]);

  // Group pending rows by hcp_job_id
  const grouped = {};
  for (const row of pendingSplits) {
    if (!grouped[row.hcp_job_id]) grouped[row.hcp_job_id] = [];
    grouped[row.hcp_job_id].push(row);
  }
  const splitJobs = Object.entries(grouped).map(([jobId, rows]) => ({
    jobId,
    date:          rows[0]?.job_date,
    customerName:  rows.find(r => r.customer_name)?.customer_name || null,
    totalRevenue:  +(rows.reduce((s, r) => s + (r.revenue       || 0), 0)).toFixed(2),
    totalTips:     +(rows.reduce((s, r) => s + (r.tips          || 0), 0)).toFixed(2),
    totalUpsells:  +(rows.reduce((s, r) => s + (r.upsell_amount || 0), 0)).toFixed(2),
    rows,
  })).sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  function getInput(jobId, techId, defaultPct) {
    return (splitInputs[jobId] || {})[techId] ?? String(defaultPct);
  }
  function setInput(jobId, techId, val) {
    setSplitInputs(prev => ({ ...prev, [jobId]: { ...(prev[jobId] || {}), [techId]: val } }));
  }

  async function saveSplit(sj) {
    const n = sj.rows.length;
    const defPct = Math.round(100 / n);
    const entries = sj.rows.map(r => ({
      tech_id: r.tech_id,
      pct: parseFloat(getInput(sj.jobId, r.tech_id, defPct) || "0"),
    }));
    const total = entries.reduce((s, e) => s + e.pct, 0);
    if (Math.abs(total - 100) > 0.5) {
      showToast(`Percentages must add up to 100 (got ${total.toFixed(1)}%)`, false);
      return;
    }
    setSavingJobId(sj.jobId);
    try {
      // 1. Write revenue split percentages
      for (const e of entries) {
        await sb(`job_splits?on_conflict=hcp_job_id,tech_id`, {
          method: "POST",
          prefer: "resolution=merge-duplicates,return=minimal",
          body: JSON.stringify({ hcp_job_id: sj.jobId, tech_id: e.tech_id, percentage: e.pct }),
        });
      }
      // 2. Write upsell attribution if set
      const selectedUpsellTechId = upsellAttrib[sj.jobId];
      if (selectedUpsellTechId && sj.totalUpsells > 0) {
        await sb(`job_upsell_attribution?on_conflict=hcp_job_id`, {
          method: "POST",
          prefer: "resolution=merge-duplicates,return=minimal",
          body: JSON.stringify({ hcp_job_id: sj.jobId, tech_id: selectedUpsellTechId }),
        });
      }
      // 3. Immediately recalculate by triggering repair for this job's date
      showToast("⏳ Split saved — applying changes...");
      const repairRes = await fetch("/.netlify/functions/hcp-upsell-repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: sj.date, to: sj.date }),
      });
      if (!repairRes.ok) throw new Error(`Repair failed (${repairRes.status})`);
      // Hide this row immediately — don't wait on refreshAll()'s
      // split_confirmed filter to catch up before it disappears.
      setDismissedJobIds(prev => new Set(prev).add(sj.jobId));
      await refreshAll();
      showToast("✅ Split confirmed and applied!");
    } catch(err) { showToast("⚠ " + err.message, false); }
    setSavingJobId(null);
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <div style={{ background:C.cardLt, borderRadius:"10px", padding:"12px 16px", fontSize:"12px", color:C.muted, lineHeight:"1.6" }}>
        These jobs have <strong style={{color:C.black}}>multiple techs</strong> with no confirmed revenue split on record — they are currently
        using <strong style={{color:"#0077d4"}}>equal split</strong> as a placeholder. Enter the correct percentages below,
        hit <strong style={{color:C.black}}>Save Split</strong>, then re-run <strong style={{color:C.black}}>Repair Upsells</strong> for that date to apply.
      </div>
      {splitJobs.filter(sj => !dismissedJobIds.has(sj.jobId)).length === 0 ? (
        <div style={{ background:C.card, borderRadius:"16px", padding:"30px", textAlign:"center", color:C.muted, fontSize:"13px" }}>
          ✅ No unconfirmed split jobs — all good!
        </div>
      ) : splitJobs.filter(sj => !dismissedJobIds.has(sj.jobId)).map(sj => {
        const n = sj.rows.length;
        const defPct = Math.round(100 / n);
        const vals = sj.rows.map(r => parseFloat(getInput(sj.jobId, r.tech_id, defPct) || "0"));
        const total = vals.reduce((a, b) => a + b, 0);
        const ok = Math.abs(total - 100) <= 0.5;
        return (
          <div key={sj.jobId} style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid #f59e0b`, borderRadius:"16px", padding:"18px", display:"flex", flexDirection:"column", gap:"12px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"13px", color:C.muted, letterSpacing:"-0.01em" }}>...{sj.jobId.slice(-12)}</div>
                {sj.customerName && (
                  <div style={{ fontWeight:"700", fontSize:"15px", color:C.black, marginTop:"1px" }}>{sj.customerName}</div>
                )}
                <div style={{ fontSize:"13px", color:C.muted, marginTop:"1px" }}>{sj.date}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"16px", color:C.green }}>${(sj.totalRevenue + sj.totalTips).toFixed(2)}</div>
                <div style={{ fontSize:"11px", color:C.muted }}>${sj.totalRevenue.toFixed(2)} rev{sj.totalTips > 0 ? ` + $${sj.totalTips.toFixed(2)} tip` : ""}</div>
              </div>
            </div>
            <div style={{ fontSize:"11px", color:C.muted, fontWeight:"700", letterSpacing:"-0.01em", fontFamily:FONT, textTransform:"none" }}>Revenue Split</div>
            {sj.rows.map((r, i) => {
              const tech = techById[r.tech_id];
              return (
                <div key={r.tech_id} style={{ display:"grid", gridTemplateColumns:"1fr 70px 16px", gap:"8px", alignItems:"center" }}>
                  <div style={{ fontSize:"13px", color:C.black, fontWeight:"600" }}>{tech?.name || r.tech_id.slice(0, 8)}</div>
                  <input
                    type="number" min="0" max="100" step="0.5"
                    value={getInput(sj.jobId, r.tech_id, defPct)}
                    onChange={e => setInput(sj.jobId, r.tech_id, e.target.value)}
                    style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"6px 8px", borderRadius:"10px", fontSize:"13px", textAlign:"center", width:"100%", boxSizing:"border-box" }}
                  />
                  <div style={{ fontSize:"12px", color:C.muted }}>%</div>
                </div>
              );
            })}
            {sj.totalUpsells > 0 && (
              <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:"12px", display:"flex", flexDirection:"column", gap:"8px" }}>
                <div style={{ fontSize:"11px", color:"#0077d4", fontWeight:"700", letterSpacing:"-0.01em", fontFamily:FONT, textTransform:"none" }}>
                  Upsell Credit — ${(+sj.totalUpsells).toFixed(2)} total
                </div>
                <select
                  value={upsellAttrib[sj.jobId] || ""}
                  onChange={e => setUpsellAttrib(prev => ({...prev, [sj.jobId]: e.target.value}))}
                  style={{ background:C.cardLt, border:`1px solid #f59e0b`, color:C.black, padding:"8px 10px", borderRadius:"10px", fontSize:"13px", width:"100%", fontFamily:FONT }}
                >
                  <option value="">— Who sold this upsell? —</option>
                  {sj.rows.map(r => {
                    const t = techById[r.tech_id];
                    return <option key={r.tech_id} value={r.tech_id}>{t?.name || r.tech_id.slice(0,8)}</option>;
                  })}
                </select>
                {!upsellAttrib[sj.jobId] && (
                  <div style={{ fontSize:"11px", color:"#0077d4" }}>⚠ Not set — will split by revenue % until confirmed</div>
                )}
              </div>
            )}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontSize:"12px", color: ok ? C.green : "#ff3b30", fontWeight:"700" }}>
                Total: {total.toFixed(1)}% {ok ? "✓" : "— must equal 100%"}
              </div>
              {(() => {
                const rowSaving = savingJobId === sj.jobId;
                const rowDisabled = rowSaving || !ok;
                return (
                  <button
                    onClick={() => saveSplit(sj)}
                    disabled={rowDisabled}
                    style={{ background: rowDisabled ? "#333" : "#0077d4", border:"none", color: rowDisabled ? "#666" : C.black, padding:"8px 20px", borderRadius:"12px", cursor: rowDisabled ? "not-allowed" : "pointer", fontFamily:FONT, fontWeight:"700", fontSize:"12px", letterSpacing:"-0.01em", textTransform:"none" }}
                  >{rowSaving ? "Applying..." : "Save & Apply"}</button>
                );
              })()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── UPSELL AUDIT ─────────────────────────────────────────────────────────────
// Surfaces upsells.note (the raw HCP line-item text) so totals can be cross-checked
// against HCP's own "Additional Upgrades" report. Joins client-side against the
// already-loaded `jobs` prop by hcp_job_id — no extra fetch needed.
function UpsellAuditTab({ techs, upsells, jobs }) {
  const monthStart = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`; })();
  const today = new Date().toISOString().split("T")[0];
  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(today);
  const [techFilter, setTechFilter] = useState("");
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState("desc");

  const techById = Object.fromEntries(techs.map(t => [t.id, t]));

  const jobByHcpId = {};
  jobs.forEach(j => { if (j.hcp_job_id && !jobByHcpId[j.hcp_job_id]) jobByHcpId[j.hcp_job_id] = j; });

  const rows = upsells.map(u => {
    const job = u.hcp_job_id ? jobByHcpId[u.hcp_job_id] : null;
    const noteText = (u.note || "").trim();
    return {
      id: u.id,
      techId: u.tech_id,
      hcpJobId: u.hcp_job_id || null,
      date: job?.job_date || u.week_key || null,
      customerName: job?.customer_name || null,
      amount: u.amount || 0,
      note: noteText,
      matched: !!job,
      flagged: !job || !noteText,
    };
  });

  const filtered = rows.filter(r => {
    if (techFilter && r.techId !== techFilter) return false;
    if (dateFrom && (!r.date || r.date < dateFrom)) return false;
    if (dateTo && (!r.date || r.date > dateTo)) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let av, bv;
    if (sortKey === "tech") { av = techById[a.techId]?.name || ""; bv = techById[b.techId]?.name || ""; }
    else if (sortKey === "customer") { av = a.customerName || ""; bv = b.customerName || ""; }
    else if (sortKey === "amount") { av = a.amount; bv = b.amount; }
    else { av = a.date || ""; bv = b.date || ""; }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const total = filtered.reduce((s, r) => s + r.amount, 0);
  const flaggedCount = filtered.filter(r => r.flagged).length;

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const sel = (val) => ({ background:C.cardLt, border:`1px solid ${C.border}`, color:val?C.black:C.muted, padding:"8px 12px", borderRadius:"10px", fontSize:"13px", fontFamily:FONT, cursor:"pointer" });
  const dateInp = { background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"8px 12px", borderRadius:"10px", fontSize:"13px", fontFamily:FONT };
  const SORT_COLS = [ { key:"date", label:"Date" }, { key:"tech", label:"Tech" }, { key:"customer", label:"Customer" }, { key:"amount", label:"Amount" } ];
  const thStyle = { padding:"8px 12px", textAlign:"left", color:C.muted, fontWeight:"700", letterSpacing:"-0.01em", fontFamily:FONT, whiteSpace:"nowrap", borderBottom:`1px solid ${C.border}` };
  const sortableTh = (c) => (
    <th key={c.key} onClick={()=>toggleSort(c.key)} style={{ ...thStyle, cursor:"pointer", userSelect:"none" }}>
      {c.label}{sortKey===c.key?(sortDir==="asc"?" ▲":" ▼"):""}
    </th>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px 18px", display:"flex", flexDirection:"column", gap:"12px" }}>
        <Label color={C.orange}>🔍 Upsell Audit</Label>
        <div style={{ fontSize:"12px", color:C.muted }}>Cross-check upsell line items against HCP's "Additional Upgrades" report. Rows with a red border have no matching job or no line-item text — check those first for discrepancies.</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"10px" }}>
          <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={dateInp}/>
          <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={dateInp}/>
          <select value={techFilter} onChange={e=>setTechFilter(e.target.value)} style={sel(techFilter)}>
            <option value="">— All Techs —</option>
            {techs.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px 18px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em", textTransform:"none", fontFamily:FONT, fontWeight:"700" }}>Total Upsells — Active Filters</div>
          <div style={{ fontSize:"11px", color:C.muted, marginTop:"2px" }}>{filtered.length} row{filtered.length===1?"":"s"}{flaggedCount>0?` · ${flaggedCount} flagged`:""}</div>
        </div>
        <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"28px", color:C.green }}>${total.toFixed(2)}</div>
      </div>

      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", overflow:"hidden" }}>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"12px", fontFamily:FONT }}>
            <thead>
              <tr style={{ background:C.cardLt }}>
                {sortableTh(SORT_COLS[0])}
                <th style={thStyle}>Job ID</th>
                {SORT_COLS.slice(1).map(sortableTh)}
                <th style={{ padding:"8px 12px", textAlign:"left", color:C.muted, fontWeight:"700", letterSpacing:"-0.01em", fontFamily:FONT, borderBottom:`1px solid ${C.border}` }}>Line Items</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length===0&&(
                <tr><td colSpan={6} style={{ padding:"20px", textAlign:"center", color:C.muted }}>No upsells in this range.</td></tr>
              )}
              {sorted.map((r,i)=>(
                <tr key={r.id} style={{ background: r.flagged ? "#ef444414" : (i%2===0?C.cardLt:C.card) }}>
                  <td style={{ padding:"8px 12px", color:C.muted, whiteSpace:"nowrap", borderBottom:`1px solid ${C.border}`, borderLeft:`3px solid ${r.flagged?"#ff3b30":"transparent"}` }}>{r.date||"—"}</td>
                  <td style={{ padding:"8px 12px", color:C.muted, whiteSpace:"nowrap", borderBottom:`1px solid ${C.border}`, fontFamily:"'SF Mono',Consolas,monospace", fontSize:"11px", userSelect:"text", cursor:"text" }}>{r.hcpJobId||"—"}</td>
                  <td style={{ padding:"8px 12px", color:C.black, whiteSpace:"nowrap", borderBottom:`1px solid ${C.border}` }}>{techById[r.techId]?.name||"Unknown"}{techById[r.techId]?.is_active===false&&<ArchivedTag/>}</td>
                  <td style={{ padding:"8px 12px", color: r.customerName?C.black:"#ff3b30", whiteSpace:"nowrap", borderBottom:`1px solid ${C.border}` }}>{r.customerName||(r.matched?"—":"No job match")}</td>
                  <td style={{ padding:"8px 12px", color:C.green, fontWeight:"700", whiteSpace:"nowrap", borderBottom:`1px solid ${C.border}` }}>${r.amount.toFixed(2)}</td>
                  <td style={{ padding:"8px 12px", color: r.note?C.black:"#ff3b30", borderBottom:`1px solid ${C.border}` }}>{r.note||"⚠ No line-item note"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── TECH MATCHING ────────────────────────────────────────────────────────────
// Reviews unmatched_hcp_employees (written daily by hcp-tech-match-check.js):
// HCP employee names with no exact match in the techs table, whose revenue/
// tips/upsells are silently being skipped by every hcp-*-sync function.
function TechMatchAdmin({ unmatchedTechs, refreshAll, showToast }) {
  const [busyName, setBusyName] = useState(null);

  async function ignoreName(hcpName) {
    setBusyName(hcpName);
    try {
      await sb("ignored_hcp_names", { method:"POST", body:JSON.stringify({ hcp_name:hcpName, note:"Ignored from Tech Matching admin panel" }) });
      await refreshAll();
      showToast(`"${hcpName}" won't be flagged again`);
    } catch (err) {
      showToast("⚠ " + err.message, false);
    } finally {
      setBusyName(null);
    }
  }

  function copyName(hcpName) {
    try {
      navigator.clipboard.writeText(hcpName);
      showToast(`Copied "${hcpName}" — paste it exactly into Add Tech`);
    } catch {
      showToast(hcpName);
    }
  }

  return (
    <div>
      <div style={{ fontSize:"13px", color:C.muted, marginBottom:"16px", lineHeight:"1.5" }}>
        These names showed up on an HCP job in the last ~2 weeks but don't exactly match any name in the tech roster — checked automatically every morning. Fix a typo in the matching tech's name, or add a new tech with this exact name (Copy Name, then Add Tech), and it'll clear itself off this list within a day. If a name will never be a paid tech in this app (an office account, a one-off contractor), use Ignore instead.
      </div>
      {unmatchedTechs.length === 0 && (
        <div style={{ padding:"32px 16px", textAlign:"center", color:C.muted, fontSize:"14px" }}>Nothing unmatched right now.</div>
      )}
      {unmatchedTechs.map(row => (
        <div key={row.hcp_name} style={{ background:"#fff", border:`1px solid ${C.border}`, borderRadius:"12px", padding:"12px 16px", marginBottom:"10px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:"12px", flexWrap:"wrap" }}>
          <div>
            <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"15px", color:C.black }}>{row.hcp_name}</div>
            <div style={{ fontSize:"12px", color:C.muted, marginTop:"2px" }}>
              {row.job_count} job{row.job_count!==1?"s":""} · {row.first_seen&&fmtShortDate(row.first_seen)}–{row.last_seen&&fmtShortDate(row.last_seen)}
            </div>
          </div>
          <div style={{ display:"flex", gap:"8px", flexShrink:0 }}>
            <button onClick={()=>copyName(row.hcp_name)} style={{ background:"#fff", border:`1px solid ${C.border}`, borderRadius:"10px", padding:"8px 14px", cursor:"pointer", fontSize:"12px", fontWeight:"700", color:C.black }}>Copy Name</button>
            <button disabled={busyName===row.hcp_name} onClick={()=>ignoreName(row.hcp_name)} style={{ background:"#f0f0f0", border:"none", borderRadius:"10px", padding:"8px 14px", cursor:"pointer", fontSize:"12px", fontWeight:"700", color:C.black, opacity:busyName===row.hcp_name?0.6:1 }}>
              {busyName===row.hcp_name ? "..." : "Ignore"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── AUDIT SCORES ─────────────────────────────────────────────────────────────
// Tote Checks and Tech Audits come from GoHighLevel forms the team leads fill
// out (synced by netlify/functions/ghl-forms-sync.mjs) and are scored with
// auditScoring.js. Display only -- not tied to pay or bonuses. Admins see
// every tech; a tech (techId set) sees only their own checks and misses.
const fmtCents = c => `$${(c/100).toFixed(2)}`;
const fmtPct = p => p==null ? "—" : `${(Math.round(p*10)/10).toFixed(1)}%`;
// This tab's week start comes from AUDIT_CONFIG.weekStartsOn (Wed-Tue, to
// match the Wednesday team meeting; the rest of the app is Sun-Sat). The tab
// opens on the week holding yesterday, so on meeting day it shows the week
// that just ended instead of an empty new one.
const auditThisWeek = () => auditWeekStart(mtDateStr(Date.now()));
const auditDefaultWeek = () => auditWeekStart(mtDateStr(Date.now() - 864e5));
const shiftWeek = (wk, weeks) => { const d = new Date(wk+"T12:00:00Z"); d.setUTCDate(d.getUTCDate()+weeks*7); return d.toISOString().split("T")[0]; };

// Ford Pro driver scorecard: one box per driving day -- truck(s), miles, and
// each penalty with its count.
function DriverDetail({ driver, bare=false }) {
  const box = { background:C.white, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"10px 12px", marginTop:"8px" };
  return (
    <div>
      {!bare && <div style={{ marginTop:"14px" }}><SectionTitle>🚗 Driving</SectionTitle></div>}
      {!bare && driver.days.length===0 && <div style={{ fontSize:"13px", color:C.muted, marginTop:"4px" }}>No driving days this week.</div>}
      {driver.days.map(d => (
        <div key={d.date} style={box}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"8px" }}>
            <div style={{ fontSize:"13px", color:C.black, fontWeight:"700" }}>{fmtShortDate(d.date)} · {d.vehicles.join(" + ") || "—"} · {Math.round(d.miles)} mi</div>
            {d.score==null ? <span style={{ fontSize:"12px", color:C.muted }}>no score</span> : <Pill color={d.pass?C.green:C.red}>{fmtScore(d.score)} {d.pass?"Pass":"Fail"}</Pill>}
          </div>
          {d.reason && <div style={{ fontSize:"12px", color:C.muted, marginTop:"3px" }}>{d.reason}</div>}
          {d.score!=null && d.penalties.length===0 && <div style={{ fontSize:"12px", color:C.green, marginTop:"3px" }}>Clean day — no driving events</div>}
          {d.penalties.map(p => (
            <div key={p.key} style={{ display:"flex", justifyContent:"space-between", gap:"8px", fontSize:"12px", color:C.black, marginTop:"3px" }}>
              <span>{p.label}: {p.detail}</span><span style={{ color:C.red, whiteSpace:"nowrap" }}>−{(Math.round(p.points*100)/100).toFixed(2)}</span>
            </div>
          ))}
          {d.speedingUnder>0 && <div style={{ fontSize:"11px", color:C.muted, marginTop:"3px" }}>{d.speedingUnder} speeding event{d.speedingUnder!==1?"s":""} under {DRIVER_CONFIG.speeding.minMphOver} mph over — no penalty</div>}
          {d.flags.map((f,i) => <div key={i} style={{ fontSize:"12px", color:C.gold, marginTop:"3px" }}>⚠ {f}</div>)}
        </div>
      ))}
    </div>
  );
}

// bare: show just the boxes (no section headings) -- used for one audit at a
// time in the "Every audit" lists.
function AuditTechDetail({ week, only="both", bare=false }) {
  const box = { background:C.white, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"10px 12px", marginTop:"8px" };
  const flagList = flags => flags.map((f,i) => <div key={i} style={{ fontSize:"12px", color:C.gold, marginTop:"3px" }}>⚠ {f}</div>);
  return (
    <div>
      {only!=="audit" && <>
      {!bare && <SectionTitle>🧰 Tote Checks</SectionTitle>}
      {!bare && week.totes.length===0 && week.excluded.length===0 && <div style={{ fontSize:"13px", color:C.muted, marginTop:"4px" }}>No tote check this week.</div>}
      {week.totes.map(t => (
        <div key={t.id} style={box}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"8px" }}>
            <div style={{ fontSize:"13px", color:C.black, fontWeight:"700" }}>{fmtShortDate(t.work_date)}{t.checkedBy ? ` · checked by ${t.checkedBy}` : ""}</div>
            <Pill color={t.pass?C.green:C.red}>{fmtPct(t.score)} {t.pass?"Pass":"Fail"}</Pill>
          </div>
          {t.missing.length===0
            ? <div style={{ fontSize:"12px", color:C.green, marginTop:"4px" }}>Nothing missing</div>
            : <div style={{ fontSize:"12px", color:C.black, marginTop:"4px" }}>Missing {fmtCents(t.missingCents)}: {t.missing.map(m => `${m.name} (${fmtCents(m.cents)})`).join(", ")}</div>}
          {flagList(t.flags)}
        </div>
      ))}
      {week.excluded.map(t => (
        <div key={t.id} style={{ ...box, background:`${C.gold}10`, borderColor:C.gold }}>
          <div style={{ fontSize:"13px", color:C.black, fontWeight:"700" }}>{fmtShortDate(t.work_date)} · not counted ({fmtPct(t.score)})</div>
          {flagList(t.flags)}
        </div>
      ))}

      </>}
      {only!=="tote" && <>
      {!bare && <div style={{ marginTop:only==="audit"?0:"14px" }}><SectionTitle>📋 Tech Audits</SectionTitle></div>}
      {!bare && week.days.length===0 && <div style={{ fontSize:"13px", color:C.muted, marginTop:"4px" }}>No audits this week.</div>}
      {week.days.map(d => (
        <div key={d.date} style={box}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ fontSize:"13px", color:C.black, fontWeight:"700" }}>{fmtShortDate(d.date)} {d.audit.test && <Pill color={C.purple}>Test</Pill>}</div>
            <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"16px", color:scoreColor(d.pct??0) }}>Day {fmtPct(d.pct)}</div>
          </div>
          <div style={{ fontSize:"12px", color:C.muted, marginTop:"2px" }}>{d.audit.lead ? `Tech lead: ${d.audit.lead}` : ""}{d.replaced ? `${d.audit.lead ? " · " : ""}latest of ${d.replaced+1} submissions for this day` : ""}</div>
          {d.audit.jobs.map(j => (
            <div key={d.audit.id+j.slot} style={{ borderTop:`1px solid ${C.border}`, marginTop:"6px", paddingTop:"6px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:"12px", color:C.black }}>
                <span style={{ fontWeight:"700" }}>{j.label} job</span>
                <span>{j.skipped ? <span style={{ color:C.muted }}>{j.skipReason} — skipped</span> : `${(Math.round(j.points*100)/100)}/${j.max} · ${fmtPct(j.pct)}`}</span>
              </div>
              {!j.skipped && j.missed.length>0 && <div style={{ fontSize:"12px", color:C.red, marginTop:"2px" }}>Missed: {j.missed.join(" · ")}</div>}
              {flagList(j.flags)}
            </div>
          ))}
          {d.audit.notes && <div style={{ fontSize:"12px", color:C.black, marginTop:"6px" }}>📝 {d.audit.notes}</div>}
          {flagList(d.audit.flags)}
        </div>
      ))}
      </>}
    </div>
  );
}

// ─── Overall Tech Score (techScores.js) ──────────────────────────────────────
const SCORE_SECTIONS = TECH_SCORE_CONFIG.sections;
const fmtMoney0 = n => `$${Math.round(n||0).toLocaleString()}`;
const scoreWindowLabel = (from, to) => `Last ${TECH_SCORE_CONFIG.windowWeeks} weeks · ${fmtShortDate(from)} – ${fmtShortDate(to)}`;
const sectionColor = v => v==null ? C.muted : v>=TECH_SCORE_CONFIG.passLine ? C.green : C.red;
const SCORE_INTRO = `Overall score = ${SCORE_SECTIONS.map(s => `${s.label} ${s.weight}%`).join(" · ")}, over the last ${TECH_SCORE_CONFIG.windowWeeks} weeks (Wed–Tue) ending with the week shown. A section with no data is left out and the others re-weighted. Pass at ${TECH_SCORE_CONFIG.passLine}.`;
const TRUCK_STATUS = {
  graded:     { label:"Graded",                              color:null },
  not_graded: { label:`Not graded yet — counts ${TECH_SCORE_CONFIG.truck.notGradedScore} for now`, color:C.gold },
  missed:     { label:"No Truck Check",                      color:C.red },
  pending:    { label:"Today — not in yet",                  color:C.muted },
};

// The five section scores, labeled.
function SectionChips({ sections, align="flex-end" }) {
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:"4px", justifyContent:align }}>
      {SCORE_SECTIONS.map(s => { const v = sections[s.key]; return (
        <span key={s.key} style={{ fontSize:"12px", color:C.black, background:C.cardLt, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"2px 8px", whiteSpace:"nowrap" }}>
          {s.label} <strong style={{ color:sectionColor(v) }}>{fmtScore(v)}</strong>
        </span>
      ); })}
    </div>
  );
}

// What each section of one tech's overall score is made of.
function ScoreBreakdown({ card }) {
  const box = { background:C.white, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"10px 12px", marginTop:"8px" };
  const line = { display:"flex", justifyContent:"space-between", gap:"8px", fontSize:"13px", color:C.black, marginTop:"4px" };
  const muted = { fontSize:"13px", color:C.muted, marginTop:"4px" };
  const sub = { fontSize:"13px", fontWeight:"700", color:C.black, marginTop:"10px" };
  const head = (key, note) => {
    const s = SCORE_SECTIONS.find(x => x.key===key), v = card.sections[key];
    return (
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:"8px" }}>
        <div>
          <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"17px", color:C.black }}>{s.icon} {s.label} <span style={{ fontSize:"13px", color:C.muted, fontWeight:"700" }}>· {s.weight}%</span></div>
          {note && <div style={{ fontSize:"12px", color:C.muted, marginTop:"2px", lineHeight:1.4 }}>{note}</div>}
        </div>
        <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"22px", color:sectionColor(v), whiteSpace:"nowrap" }}>{v==null ? "—" : fmtScore(v)}</div>
      </div>
    );
  };
  const { week, quality, production, driver, totes, truck, equipment } = card;
  const ded = TECH_SCORE_CONFIG.callbackDeduction;
  return (
    <div>
      <div style={box}>
        {head("audit", "Average of the audited days.")}
        {week.days.length===0 ? <div style={muted}>No audits in these weeks — left out.</div> : week.days.map(d => (
          <div key={d.date} style={line}><span>{fmtShortDate(d.date)}{d.audit.lead ? ` · ${d.audit.lead}` : ""}</span><span style={{ color:scoreColor(d.pct??0), fontWeight:"700" }}>{fmtPct(d.pct)}</span></div>
        ))}
      </div>
      <div style={box}>
        {head("quality", `Starts at 100. Each callback takes off Level 1 −${ded[1]}, Level 2 −${ded[2]}, Level 3 −${ded[3]} (times the tech's share of a split job).`)}
        {quality.score==null ? <div style={muted}>No jobs or callbacks — left out.</div>
          : quality.items.length===0 ? <div style={{ ...muted, color:C.green }}>No callbacks</div>
          : quality.items.map((c,i) => (
            <div key={c.id || i} style={line}>
              <span>{c.date ? fmtShortDate(c.date) : "—"}{c.customer ? ` · ${c.customer}` : ""} · Level {c.level}{c.legacy ? " (no level logged)" : ""}{c.share!==1 ? ` · ${Math.round(c.share*100)}% share` : ""}</span>
              <span style={{ color:C.red, fontWeight:"700", whiteSpace:"nowrap" }}>−{Math.round(c.deduction*10)/10}</span>
            </div>
          ))}
      </div>
      <div style={box}>
        {head("production", `${formatMonthLabel(production.monthKey)} through ${fmtShortDate(production.asOf)}. Monthly targets prorated to ${Math.max(production.daysElapsed, TECH_SCORE_CONFIG.production.minDaysElapsed)} of ${production.daysInMonth} days; each counts up to 100.`)}
        {production.score==null ? <div style={muted}>No paid jobs this month — left out.</div> : production.metrics.map(m => (
          <div key={m.key} style={line}>
            <span>{m.label}: {m.money ? fmtMoney0(m.actual) : m.actual} of {m.money ? fmtMoney0(m.prorated) : Math.round(m.prorated*10)/10} <span style={{ color:C.muted }}>({m.money ? fmtMoney0(m.target) : m.target}/month)</span></span>
            <span style={{ color:sectionColor(m.pct), fontWeight:"700" }}>{fmtPct(m.pct)}</span>
          </div>
        ))}
      </div>
      <div style={box}>
        {head("driver", "Average of the scored driving days (Ford Pro, truck picked at clock-in).")}
        {!driver ? <div style={muted}>No Ford Pro data — left out.</div> : driver.days.length===0 ? <div style={muted}>No driving days — left out.</div> : driver.days.map(d => (
          <div key={d.date} style={line}>
            <span>{fmtShortDate(d.date)} · {d.vehicles.join(" + ") || "—"} · {Math.round(d.miles)} mi</span>
            <span style={{ color:sectionColor(d.score), fontWeight:"700" }}>{d.score==null ? "no score" : fmtScore(d.score)}</span>
          </div>
        ))}
      </div>
      <div style={box}>
        {head("equipment", "Average of the Tote Check and Truck Check scores.")}
        <div style={sub}>🧰 Tote Checks{equipment.tote!=null ? ` · ${fmtScore(equipment.tote)}` : ""}</div>
        <div style={{ fontSize:"12px", color:C.muted }}>Rescaled for this score: nothing missing = 100, $7.00 missing = {TECH_SCORE_CONFIG.passLine}, −15 per $7.</div>
        {totes.length===0 ? <div style={muted}>No tote checks.</div> : totes.map(t => (
          <div key={t.id} style={line}><span>{fmtShortDate(t.work_date)} · {t.missingCents ? `${fmtCents(t.missingCents)} missing` : "Nothing missing"}</span><span style={{ color:sectionColor(t.equipScore), fontWeight:"700" }}>{fmtScore(t.equipScore)}</span></div>
        ))}
        <div style={sub}>🚚 Truck Checks{truck.score!=null ? ` · ${fmtScore(truck.score)}` : ""}</div>
        {truck.exempt ? <div style={muted}>Apprentice in training — not scored.</div>
          : truck.nights.length===0 ? <div style={muted}>No nights worked.</div>
          : <>
            <div style={{ fontSize:"12px", color:C.muted }}>Submitted {truck.submitted} of {truck.worked} night{truck.worked!==1?"s":""} worked. A missed night counts 0.</div>
            {truck.nights.map(n => (
              <div key={n.date} style={line}>
                <span style={{ color:TRUCK_STATUS[n.status].color || C.black }}>{fmtShortDate(n.date)} · {TRUCK_STATUS[n.status].label}</span>
                <span style={{ color:sectionColor(n.score), fontWeight:"700" }}>{n.score==null ? "—" : fmtScore(n.score)}</span>
              </div>
            ))}
          </>}
      </div>
    </div>
  );
}

// view: which section opens first -- "overview" (default), "tote", "audit"
// or "driver". Admins see every tech plus team scores; a tech (techId set)
// sees only their own scores plus the team averages. The overview is the
// overall Tech Score over the last 4 weeks (techScores.js); jobs, callbacks,
// reviews, switchovers and quota feed its Callbacks and Quota sections.
const AUDIT_SECTIONS = [["overview","📊 Overview"],["tote","🧰 Tote Checks"],["audit","📋 Tech Audits"],["driver","🚗 Driving"]];
const fmtScore = n => n==null ? "—" : (Math.round(n*10)/10).toFixed(1);
const passColor = (score, pass) => score==null ? C.muted : pass ? C.green : C.red;

// hideTabs: the admin menu opens each section as its own page (Tech Scores >
// Overview / Tote Checks / Audit Scores / Driving Scores), so no section bar.
function AuditScoresTab({ techs, token, techId=null, canSync=false, view="overview", hideTabs=false, jobs=[], callbacks=[], reviews=[], switchovers=[], quota=null }) {
  const [section, setSection] = useState(view==="both" ? "overview" : view);
  const [wk, setWk] = useState(auditDefaultWeek());
  const [state, setState] = useState({ loading:true, error:null, data:null });
  const [open, setOpen] = useState(null);
  const [openTeam, setOpenTeam] = useState(null);   // admin: team expanded to its members
  const [listMode, setListMode] = useState("tech"); // admin sections: "tech" (by tech) or "each" (every audit)
  const [bump, setBump] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const end = weekEndDate(wk);
  // Everything loads for the overall score's 4-week window; the per-section
  // pages show just the picked week.
  const win = scoreWindow(wk);
  const getJson = url => fetch(url, { headers:{ Authorization:`Bearer ${token || ""}` } })
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; });

  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading:true, error:null }));
    getJson(`/.netlify/functions/audit-scores?from=${win.from}&to=${end}`)
      .then(data => live && setState({ loading:false, error:null, data }))
      .catch(e => live && setState({ loading:false, error:e.message, data:null }));
    return () => { live = false; };
    // eslint-disable-next-line
  }, [wk, end, token, bump]);

  // Ford Pro driver scorecard for the same week (separate so a Ford problem
  // never hides the tote/audit scores).
  const [drive, setDrive] = useState({ loading:true, error:null, data:null });
  useEffect(() => {
    let live = true;
    setDrive(s => ({ ...s, loading:true, error:null }));
    getJson(`/.netlify/functions/driver-scores?from=${win.from}&to=${end}`)
      .then(data => live && setDrive({ loading:false, error:null, data }))
      .catch(e => live && setDrive({ loading:false, error:e.message, data:null }));
    return () => { live = false; };
    // eslint-disable-next-line
  }, [wk, end, token, bump]);

  // A tech can't load everyone's checks, so their team scores come from the
  // server as averages only. Admins compute them from the full data below.
  const [teamState, setTeamState] = useState({ loading:false, error:null, data:null });
  useEffect(() => {
    if (!techId) return;
    let live = true;
    setTeamState({ loading:true, error:null, data:null });
    getJson(`/.netlify/functions/tech-team-scores?from=${win.from}&to=${end}`)
      .then(data => live && setTeamState({ loading:false, error:null, data }))
      .catch(e => live && setTeamState({ loading:false, error:e.message, data:null }));
    return () => { live = false; };
    // eslint-disable-next-line
  }, [techId, wk, end, token]);

  async function syncNow() {
    setSyncing(true); setSyncMsg(null);
    try {
      const r = await fetch(`/.netlify/functions/ghl-forms-sync`, { headers:{ Authorization:`Bearer ${token || ""}` } });
      const j = await r.json().catch(() => ({}));
      setSyncMsg(j.ok ? `✅ Pulled ${j.forms?.tote ?? 0} tote checks, ${j.forms?.audit ?? 0} audits${j.incomplete ? " (more next run)" : ""}` : `⚠️ ${j.error || (j.errors||[]).join("; ") || `HTTP ${r.status}`}`);
      setBump(b => b+1);
    } catch(e) { setSyncMsg(`⚠️ ${e.message}`); }
    setSyncing(false);
  }

  const inWeek = d => !!d && d >= wk && d <= end;
  const subs = state.data?.submissions || [];
  const weekSubs = subs.filter(s => inWeek(s.work_date));
  const byTech = {}, byTechWeek = {};
  subs.forEach(s => { if (s.tech_id) (byTech[s.tech_id] = byTech[s.tech_id] || []).push(s); });
  weekSubs.forEach(s => { if (s.tech_id) (byTechWeek[s.tech_id] = byTechWeek[s.tech_id] || []).push(s); });
  const d0 = drive.data;
  const driveWeek = d0 ? { ...d0, assignments:d0.assignments.filter(r=>inWeek(r.work_date)), daily:d0.daily.filter(r=>inWeek(r.work_date)), events:d0.events.filter(r=>inWeek(r.work_date)), unassigned:d0.unassigned.filter(r=>inWeek(r.work_date)) } : null;
  const today = mtDateStr(Date.now());
  const cardFor = id => techWeekCard(byTechWeek[id] || [], driveWeek, id);
  const fullCardFor = t => techScoreCard({ techId:t.id, tech:t, subs:byTech[t.id] || [], driverData:d0, jobs, callbacks, reviews, switchovers, quota,
    truckGrades:state.data?.truck_grades || [], from:win.from, to:end, today });
  const unmatched = [...new Set((section==="overview" ? subs : weekSubs).filter(s => !s.tech_id && (section==="overview" ? !!formKind(s.form_id) : formKind(s.form_id)===section)).map(s => s.tech_name || "(no Tech answer)"))].sort();
  // Answers and question ids on the Tech Audit form that AUDIT_CONFIG can't map.
  const auditScored = weekSubs.filter(s => formKind(s.form_id)==="audit").map(s => scoreTechAudit(s));
  const unmappedAnswers = [...new Set(auditScored.flatMap(a => a.unmapped))].sort();
  const unmappedIds = [...new Set(auditScored.flatMap(a => a.unmappedFieldIds))].sort();
  const last = state.data?.last_run;
  const arrow = { background:C.white, border:`1px solid ${C.border}`, borderRadius:"50%", width:"36px", height:"36px", padding:0, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:"13px", color:C.blue };
  const thisWeek = auditThisWeek();
  const driveNote = drive.error ? `Driving scores unavailable: ${drive.error}` : section==="overview" ? (d0 && !d0.daily.length ? "No Ford Pro data for these weeks yet, so Driving is left out of the overall score." : null) : driveWeek && !driveWeek.daily.length ? "No Ford Pro data for this week yet — an admin uploads Ford's daily reports on the Trucks tab." : null;
  const big = (text, color, size=20) => <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:`${size}px`, color, lineHeight:1, textAlign:"right" }}>{text}</div>;
  const small = text => <div style={{ fontSize:"11px", color:C.muted, marginTop:"3px", textAlign:"right" }}>{text}</div>;
  const sectionLine = sec => <SectionChips sections={sec} align="flex-start"/>;

  const header = (
    <>
      {!hideTabs && <div style={{ marginBottom:"10px" }}><SubTabs tabs={AUDIT_SECTIONS} active={section} setActive={s => { setSection(s); setOpen(null); }}/></div>}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"8px", marginBottom:"12px" }}>
        <button style={arrow} onClick={() => { setWk(shiftWeek(wk,-1)); setOpen(null); }}>◀</button>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"16px", color:C.black }}>{formatWeekLabel(wk)}{wk===thisWeek ? " · this week" : ""}</div>
          {section==="overview" && <div style={{ fontSize:"12px", color:C.muted, marginTop:"2px" }}>{scoreWindowLabel(win.from, end)}</div>}
        </div>
        <button style={{ ...arrow, opacity:wk>=thisWeek?0.4:1 }} disabled={wk>=thisWeek} onClick={() => { setWk(shiftWeek(wk,1)); setOpen(null); }}>▶</button>
      </div>
      {state.error && <div style={{ background:`${C.red}10`, border:`1px solid ${C.red}`, borderRadius:"12px", padding:"12px", fontSize:"13px", color:C.red, marginBottom:"10px" }}>Couldn't load: {state.error}</div>}
      {state.loading && !state.data && <div style={{ color:C.muted, padding:"16px" }}>Loading...</div>}
    </>
  );
  const intro = {
    overview: `${SCORE_INTRO} Team score = the average of its members' overall scores.`,
    tote: "Tote Checks from the GHL form. $7.00 or less missing passes (95%). Items missing on a FAILED check come off that tech's pay on the Payroll tab.",
    audit: "Tech Audits from the GHL form. Each day is the average of its scheduled jobs; the week is the average of the days.",
    driver: `From Ford Pro data on the truck picked at clock-in. Speeding is scored by minutes over the limit per 100 miles; the week is the average of the days. Pass at ${DRIVER_CONFIG.passLine}.`,
  }[section];
  // A team / company score card. Admins can tap a team (onToggle) to see its
  // members underneath (children).
  const teamCard = (title, t, highlight=false, onToggle=null, isOpen=false, children=null) => (
    <div key={title} style={{ background:highlight?C.blueXlt:C.white, border:`1px solid ${highlight?C.blue:C.border}`, borderRadius:"16px", padding:"12px 14px", marginBottom:"8px" }}>
      <div onClick={onToggle || undefined} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"10px", cursor:onToggle?"pointer":"default" }}>
        <div>
          <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"16px", color:C.black }}>{title} {onToggle && <span style={{ fontSize:"12px", color:C.muted }}>{isOpen?"▲":"▼"}</span>}</div>
          <div style={{ marginTop:"4px" }}>{sectionLine(t)}</div>
        </div>
        <div>{big(t.score==null ? "—" : `${fmtScore(t.score)}`, passColor(t.score, t.pass), 24)}{small(t.score==null ? "no scores yet" : `${t.pass?"Pass":"Fail"} · ${t.scored} of ${t.members} scored`)}</div>
      </div>
      {isOpen && children && <div style={{ marginTop:"10px" }}>{children}</div>}
    </div>
  );

  // ─── tech's own view ───
  if (techId) {
    const me = cardFor(techId);
    const meTech = techs.find(t => t.id===techId) || { id:techId };
    const full = section==="overview" ? fullCardFor(meTech) : null;
    const team = teamState.data;
    return (
      <div>
        {header}
        {state.data && (<>
          {section==="overview" && (<>
            <div style={{ fontSize:"13px", color:C.muted, marginBottom:"12px", lineHeight:"1.5" }}>{SCORE_INTRO} Display only — not tied to pay.</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))", gap:"8px", marginBottom:"12px" }}>
              <StatBlock label="My Overall Score" value={fmtScore(full.overall.score)} color={passColor(full.overall.score, full.overall.pass)} sub={full.overall.score==null ? "no scores yet" : `${full.overall.pass?"Pass":"Fail"} · pass ${TECH_SCORE_CONFIG.passLine}`}/>
              {SCORE_SECTIONS.map(s => {
                const v = full.sections[s.key];
                return <StatBlock key={s.key} label={`${s.icon} ${s.label}`} value={fmtScore(v)} color={sectionColor(v)} sub={v==null ? "no data — left out" : `${s.weight}% of overall`}/>;
              })}
            </div>
            <SectionTitle>🔍 What my score is made of</SectionTitle>
            <div style={{ marginBottom:"14px" }}><ScoreBreakdown card={full}/></div>
            <SectionTitle>👥 Team Scores</SectionTitle>
            <div style={{ fontSize:"12px", color:C.muted, marginTop:"2px" }}>Averages only. A team shows once at least 3 of its members have a score.</div>
            <div style={{ marginTop:"8px" }}>
              {teamState.error && <div style={{ fontSize:"12px", color:C.red }}>Couldn't load team scores: {teamState.error}</div>}
              {teamState.loading && <div style={{ fontSize:"12px", color:C.muted }}>Loading…</div>}
              {team && (<>
                {team.my_team && team.teams.filter(t => t.name===team.my_team).map(t => teamCard(`My team · ${t.name}`, t, true))}
                {teamCard("Whole company", team.company)}
                {team.teams.filter(t => t.name!==team.my_team).map(t => teamCard(t.name, t))}
              </>)}
            </div>
          </>)}
          {section==="tote" && <AuditTechDetail week={me.week} only="tote"/>}
          {section==="audit" && <AuditTechDetail week={me.week} only="audit"/>}
          {section==="driver" && (<>
            {driveNote && <div style={{ fontSize:"12px", color:C.muted, marginBottom:"8px" }}>{driveNote}</div>}
            {me.driver && <DriverDetail driver={me.driver}/>}
          </>)}
        </>)}
      </div>
    );
  }

  // ─── admin view ───
  const overview = section==="overview";
  // Overview: every active non-owner tech's overall score for the window.
  // Section pages: the picked week (plus archived techs who had a check).
  const cards = overview
    ? techs.filter(t => t.is_active!==false && t.title!=="owner").map(t => ({ tech:t, ...fullCardFor(t) }))
    : techs.filter(t => (t.is_active!==false && t.title!=="owner") || byTechWeek[t.id]).map(t => ({ tech:t, ...cardFor(t.id) }));
  const teams = overview ? teamSummary(cards, techs) : null;
  const dd = overview ? d0 : driveWeek;
  const unassignedCount = dd ? findUnassignedDriving(dd).filter(f => !dd.unassigned.some(u => u.vin===f.vin && u.work_date===f.work_date && (u.assigned_tech_id || u.dismissed))).length : 0;
  const unknownFordTypes = [...new Set(cards.flatMap(c => c.driver ? c.driver.days.flatMap(d => d.unknownTypes) : []))];
  const has = c => section==="overview" ? c.overall.score!=null : section==="tote" ? !!(c.week.latestTote || c.week.excluded.length) : section==="audit" ? c.week.days.length>0 : !!c.driver?.days.length;
  const sortVal = c => section==="overview" ? c.overall.score : section==="tote" ? c.sections.tote : section==="audit" ? c.sections.audit : c.sections.driver;
  const rows = cards.map(c => ({ ...c, has:has(c) }))
    .sort((a,b) => (b.has?1:0) - (a.has?1:0) || ((sortVal(b) ?? -1) - (sortVal(a) ?? -1)) || a.tech.name.localeCompare(b.tech.name));
  const rankOf = Object.fromEntries(rows.filter(r => r.has).map((r,i) => [r.tech.id, i+1]));

  // One tech's row: their score for the current section; tap to open every audit
  // they had. prefix keeps the same tech's row under a team separate.
  function techRow(c, prefix="") {
        const { tech, week, driver, sections, overall, has:canOpen } = c;
        const key = prefix + tech.id, isOpen = open===key, t = week.latestTote;
        let summary;
        if (section==="overview") summary = overall.score==null
          ? big("No scores", C.muted)
          : <>{big(fmtScore(overall.score), passColor(overall.score, overall.pass), 28)}{small(`${overall.pass?"Pass":"Fail"} · ${overall.sectionsScored} of ${SCORE_SECTIONS.length} sections`)}</>;
        else if (section==="tote") summary = t
          ? <>{big(`${fmtPct(t.score)} ${t.pass?"Pass":"Fail"}`, t.pass?C.green:C.red)}{small(t.missingCents ? `${fmtCents(t.missingCents)} missing · ${fmtShortDate(t.work_date)}` : `Nothing missing · ${fmtShortDate(t.work_date)}`)}</>
          : <>{big("No check", C.muted)}{week.excluded.length>0 && small(`${week.excluded.length} not counted (wrong checker)`)}</>;
        else if (section==="audit") summary = week.days.length
          ? <>{big(fmtPct(week.auditPct), scoreColor(week.auditPct??0))}{small(`${week.days.length} day${week.days.length!==1?"s":""} audited`)}</>
          : big("No audits", C.muted);
        else summary = driver?.score!=null
          ? <>{big(`${fmtScore(driver.score)} ${driver.pass?"Pass":"Fail"}`, passColor(driver.score, driver.pass))}{small(`${driver.scoredDays} day${driver.scoredDays!==1?"s":""} · ${Math.round(driver.days.reduce((s,d)=>s+d.miles,0))} mi`)}</>
          : big(driver?.days.length ? "No score" : "No driving", C.muted);
        return (
          <div key={key} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"12px 14px", marginBottom:"8px", opacity:canOpen?1:0.6 }}>
            <div onClick={() => canOpen && setOpen(isOpen?null:key)} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"10px", cursor:canOpen?"pointer":"default" }}>
              <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"18px", color:C.black }}>{section==="overview" && rankOf[tech.id] ? <span style={{ color:C.muted }}>#{rankOf[tech.id]} </span> : null}{tech.name} {canOpen && <span style={{ fontSize:"12px", color:C.muted }}>{isOpen?"▲":"▼"}</span>}</div>
              <div>{summary}</div>
            </div>
            {section==="overview" && overall.score!=null && <div style={{ marginTop:"6px" }}><SectionChips sections={sections} align="flex-start"/></div>}
            {isOpen && <div style={{ marginTop:"8px" }}>
              {section==="overview" ? <ScoreBreakdown card={c}/> : section==="driver" ? (driver ? <DriverDetail driver={driver}/> : <div style={{ fontSize:"13px", color:C.muted }}>No driving data for this week.</div>) : <AuditTechDetail week={week} only={section}/>}
            </div>}
          </div>
        );
  }

  // Every single tote check / audit day / driving day this week, newest first.
  function everyAudit() {
    const out = [];
    for (const c of cards) {
      if (section==="tote") {
        for (const t of c.week.totes) out.push({ key:`t:${t.id}`, tech:c.tech, date:t.work_date, sub:t.checkedBy ? `checked by ${t.checkedBy}` : "",
          summary:<>{big(`${fmtPct(t.score)} ${t.pass?"Pass":"Fail"}`, t.pass?C.green:C.red, 18)}{small(t.missingCents ? `${fmtCents(t.missingCents)} missing` : "Nothing missing")}</>,
          detail:<AuditTechDetail bare only="tote" week={{ totes:[t], excluded:[], days:[] }}/> });
        for (const t of c.week.excluded) out.push({ key:`x:${t.id}`, tech:c.tech, date:t.work_date, sub:"not counted",
          summary:big("Not counted", C.gold, 16), detail:<AuditTechDetail bare only="tote" week={{ totes:[], excluded:[t], days:[] }}/> });
      } else if (section==="audit") {
        for (const d of c.week.days) out.push({ key:`a:${d.audit.id}`, tech:c.tech, date:d.date, sub:d.audit.lead ? `tech lead ${d.audit.lead}` : "",
          summary:<>{big(fmtPct(d.pct), scoreColor(d.pct??0), 18)}{small(`${d.audit.jobs.filter(j=>!j.skipped).length} job${d.audit.jobs.filter(j=>!j.skipped).length!==1?"s":""}`)}</>,
          detail:<AuditTechDetail bare only="audit" week={{ totes:[], excluded:[], days:[d] }}/> });
      } else if (c.driver) {
        for (const d of c.driver.days) out.push({ key:`d:${c.tech.id}:${d.date}`, tech:c.tech, date:d.date, sub:`${d.vehicles.join(" + ") || "—"} · ${Math.round(d.miles)} mi`,
          summary:d.score==null ? big("No score", C.muted, 16) : big(`${fmtScore(d.score)} ${d.pass?"Pass":"Fail"}`, passColor(d.score, d.pass), 18),
          detail:<DriverDetail bare driver={{ days:[d] }}/> });
      }
    }
    return out.sort((a,b) => b.date.localeCompare(a.date) || a.tech.name.localeCompare(b.tech.name));
  }


  return (
    <div>
      {header}
      <div style={{ fontSize:"13px", color:C.muted, marginBottom:"12px", lineHeight:"1.5" }}>{intro} Weeks run Wednesday–Tuesday. {section==="tote" ? "Items missing on a FAILED tote check come off that tech's pay on the Payroll tab." : "Display only — not tied to pay."}</div>
      {(section==="tote" || section==="audit") && (
        <div style={{ background:C.cardLt, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"10px 12px", marginBottom:"12px", fontSize:"12px", color:C.black }}>
          {last ? <>Last GHL form sync: {new Date(last.finished_at || last.updated_at).toLocaleString("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit", timeZone:"America/Denver" })}{last.errors?.length ? <span style={{ color:C.red }}> · {last.errors.join("; ")}</span> : ""}{last.labels?.source==="raw_keys" ? <div style={{ color:C.gold, marginTop:"4px" }}>⚠ Couldn't read the form's question labels from GHL ({last.labels.error}). The token may need the locations/customFields.readonly scope.</div> : null}</> : "Not synced yet."}
          {canSync && <div><button onClick={syncNow} disabled={syncing} style={{ marginTop:"8px", background:C.blue, color:C.white, border:"none", padding:"6px 14px", borderRadius:"18px", fontSize:"12px", fontWeight:"700", cursor:"pointer", fontFamily:FONT, letterSpacing:"-0.01em", textTransform:"none" }}>{syncing ? "Syncing..." : "Sync now"}</button></div>}
          {syncMsg && <div style={{ marginTop:"6px" }}>{syncMsg}</div>}
        </div>
      )}
      {state.data && section!=="driver" && unmatched.length>0 && (
        <div style={{ background:"rgba(0,0,0,0.06)", border:"1px solid #ef4444", borderRadius:"12px", padding:"10px 12px", marginBottom:"12px", fontSize:"12px", color:C.black }}>
          <div style={{ fontWeight:"700", color:C.red }}>⚠ Forms this week with a Tech name that doesn't exactly match the roster — not shown below:</div>
          {unmatched.join(", ")}
        </div>
      )}
      {state.data && section==="audit" && (unmappedAnswers.length>0 || unmappedIds.length>0) && (
        <div style={{ background:`${C.gold}12`, border:`1px solid ${C.gold}`, borderRadius:"12px", padding:"10px 12px", marginBottom:"12px", fontSize:"12px", color:C.black }}>
          <div style={{ fontWeight:"700" }}>⚠ Tech Audit answers the scoring doesn't recognize (fix the form or AUDIT_CONFIG):</div>
          {unmappedAnswers.map(u => <div key={u}>• {u}</div>)}
          {unmappedIds.map(id => <div key={id}>• Question id <code>{id}</code>{last?.unmapped_audit_fields?.[id] ? ` = "${last.unmapped_audit_fields[id].trim()}"` : ""} isn't in AUDIT_CONFIG — if it's a renamed question, add the id to that question's list</div>)}
        </div>
      )}
      {(section==="driver" || section==="overview") && (<>
        {driveNote && <div style={{ fontSize:"12px", color:C.muted, marginBottom:"10px" }}>🚗 {driveNote}</div>}
        {unassignedCount>0 && (
          <div style={{ background:"rgba(0,0,0,0.06)", border:"1px solid #ef4444", borderRadius:"12px", padding:"10px 12px", marginBottom:"12px", fontSize:"12px", color:C.black }}>
            🚨 <strong>{unassignedCount} day{unassignedCount!==1?"s":""} of unassigned driving</strong> this week (a truck drove with no tech's pick on it). Assign or dismiss them in Team Activity → 🚚 Trucks.
          </div>
        )}
        {section==="driver" && unknownFordTypes.length>0 && (
          <div style={{ background:`${C.gold}12`, border:`1px solid ${C.gold}`, borderRadius:"12px", padding:"10px 12px", marginBottom:"12px", fontSize:"12px", color:C.black }}>
            ⚠ Ford event types not in DRIVER_CONFIG (scored 0 until mapped): {unknownFordTypes.join(", ")}
          </div>
        )}
      </>)}
      {state.data && section==="overview" && (<>
        <SectionTitle>👥 Team Scores</SectionTitle>
        <div style={{ fontSize:"12px", color:C.muted, marginTop:"2px" }}>Tap a team to see its members, then tap a tech to see what their score is made of.</div>
        <div style={{ marginTop:"8px", marginBottom:"14px" }}>
          {teamCard("Whole company", teams.company, true)}
          {[...teams.teams].sort((a,b) => (b.score ?? -1) - (a.score ?? -1)).map(t => {
            const members = rows.filter(c => t.memberIds.includes(c.tech.id));
            return teamCard(`${t.name} · ${t.lead}`, t, false, () => setOpenTeam(openTeam===t.id ? null : t.id), openTeam===t.id, members.map(c => techRow(c, `team:${t.id}:`)));
          })}
        </div>
        <SectionTitle>🏆 Total Performance Leaderboard</SectionTitle>
        <div style={{ fontSize:"12px", color:C.muted, marginTop:"2px", marginBottom:"8px" }}>{scoreWindowLabel(win.from, end)} · tap a tech for the breakdown.</div>
      </>)}
      {state.data && section!=="overview" && (
        <div style={{ marginBottom:"10px" }}><SubTabs tabs={[["tech","By tech"],["each",`Every ${section==="driver" ? "driving day" : section==="tote" ? "tote check" : "audit"}`]]} active={listMode} setActive={m => { setListMode(m); setOpen(null); }}/></div>
      )}
      {state.data && section!=="overview" && listMode==="each" && (() => {
        const items = everyAudit();
        if (!items.length) return <div style={{ fontSize:"13px", color:C.muted, padding:"8px 0" }}>Nothing this week.</div>;
        return items.map(it => {
          const isOpen = open===`item:${it.key}`;
          return (
            <div key={it.key} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"10px 14px", marginBottom:"8px" }}>
              <div onClick={() => setOpen(isOpen ? null : `item:${it.key}`)} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"10px", cursor:"pointer" }}>
                <div>
                  <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"16px", color:C.black }}>{it.tech.name} <span style={{ fontSize:"12px", color:C.muted }}>{isOpen?"▲":"▼"}</span></div>
                  <div style={{ fontSize:"12px", color:C.muted, marginTop:"2px" }}>{fmtShortDate(it.date)}{it.sub ? ` · ${it.sub}` : ""}</div>
                </div>
                <div>{it.summary}</div>
              </div>
              {isOpen && <div style={{ marginTop:"6px" }}>{it.detail}</div>}
            </div>
          );
        });
      })()}
      {state.data && (section==="overview" || listMode==="tech") && rows.map(c => techRow(c))}
    </div>
  );
}


// ─── TRUCK INSPECTIONS (admin) ────────────────────────────────────────────────
// The nightly Truck Check (GHL form, photos), per tech per night worked (a
// job with revenue). Graded nights use the grade; submitted but not graded
// yet counts 100 for now; a night worked with no Truck Check counts 0.
// Apprentices still in training aren't listed. Owners and the Field
// Supervisor can set or override a grade. Feeds the Truck part of the
// Equipment & Truck section of the Tech Score. Display only -- not tied to pay.
// GHL photos need the GHL login, so they come through audit-scores
// (?photo=<documentId>) with this login's token; plain image links load as-is.
function PhotoThumb({ photo, token }) {
  const [src, setSrc] = useState(photo.documentId ? null : photo.url);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (!photo.documentId) return;
    let live = true, objUrl = null;
    fetch(`/.netlify/functions/audit-scores?photo=${encodeURIComponent(photo.documentId)}`, { headers:{ Authorization:`Bearer ${token || ""}` } })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
      .then(b => { objUrl = URL.createObjectURL(b); if (live) setSrc(objUrl); })
      .catch(() => live && setBad(true));
    return () => { live = false; if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [photo.documentId, token]);
  const box = { display:"inline-flex", alignItems:"center", justifyContent:"center", width:"104px", height:"104px", borderRadius:"10px", border:`1px solid ${C.border}`, background:C.cardLt, overflow:"hidden", fontSize:"12px", color:C.muted, textDecoration:"none", textAlign:"center" };
  if (bad || (!photo.image && !photo.documentId)) return <a href={photo.url} target="_blank" rel="noopener noreferrer" style={{ ...box, color:C.blue }}>📎 Open file</a>;
  if (!src) return <div style={box}>Loading…</div>;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" style={box}>
      <img src={src} alt="Truck Check photo" loading="lazy" onError={() => setBad(true)} style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
    </a>
  );
}

function TruckInspectionsTab({ techs, jobs=[], token, canGrade=false, showToast=()=>{} }) {
  const [wk, setWk] = useState(auditDefaultWeek());
  const [state, setState] = useState({ loading:true, error:null, data:null });
  const [open, setOpen] = useState(null);          // tech id
  const [openNight, setOpenNight] = useState(null); // "<techId>|<date>"
  const [edit, setEdit] = useState({});            // submission id -> { score, notes }
  const [saving, setSaving] = useState(null);
  const end = weekEndDate(wk), today = mtDateStr(Date.now()), thisWeek = auditThisWeek();

  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading:true, error:null }));
    fetch(`/.netlify/functions/audit-scores?from=${wk}&to=${end}&kind=truck`, { headers:{ Authorization:`Bearer ${token || ""}` } })
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; })
      .then(data => live && setState({ loading:false, error:null, data }))
      .catch(e => live && setState({ loading:false, error:e.message, data:null }));
    return () => { live = false; };
  }, [wk, end, token]);

  const subs = (state.data?.submissions || []).filter(s => formKind(s.form_id)==="truck");
  const grades = state.data?.truck_grades || [];
  const unmatched = [...new Set(subs.filter(s => !s.tech_id).map(s => s.tech_name || "(no name)"))].sort();
  const rows = techs.filter(t => t.is_active!==false && t.title!=="owner" && !isTruckExempt(t)).sort(byFirstName)
    .map(t => ({ tech:t, ...truckScore({ techId:t.id, tech:t, jobs, truckSubs:subs.filter(s => s.tech_id===t.id), grades, from:wk, to:end, today }) }));
  const arrow = { background:C.white, border:`1px solid ${C.border}`, borderRadius:"50%", width:"36px", height:"36px", padding:0, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:"13px", color:C.blue };
  const inp = { background:C.white, border:`1px solid ${C.border}`, color:C.black, padding:"8px 10px", borderRadius:"10px", fontSize:"15px", boxSizing:"border-box" };

  async function saveGrade(sub) {
    const e = edit[sub.id] || {};
    const score = Number(e.score);
    if (e.score==null || e.score==="" || !Number.isFinite(score) || score<0 || score>100) return showToast("Grade must be a number from 0 to 100", false);
    setSaving(sub.id);
    try {
      const r = await fetch(`/.netlify/functions/audit-scores`, { method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token || ""}` },
        body:JSON.stringify({ action:"truck_grade", submission_id:sub.id, score, notes:e.notes || "" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setState(st => ({ ...st, data:{ ...st.data, truck_grades:[...(st.data?.truck_grades || []).filter(g => g.submission_id!==sub.id), j.grade || { submission_id:sub.id, score, notes:e.notes || null, graded_at:new Date().toISOString() }] } }));
      setEdit(x => { const n = { ...x }; delete n[sub.id]; return n; });
      showToast("✅ Grade saved");
    } catch(err) { showToast("Couldn't save: "+err.message, false); }
    setSaving(null);
  }

  // One night: when it came in, its photos, its grade, and the override.
  function nightDetail(n) {
    const sub = n.sub, g = n.grade;
    if (!sub) return <div style={{ fontSize:"14px", color:C.red, marginTop:"6px" }}>{n.status==="pending" ? "Not in yet tonight." : "No Truck Check was submitted for this night — counts 0."}</div>;
    const photos = submissionPhotoUrls(sub);
    const e = edit[sub.id] || { score: g?.score ?? "", notes: g?.notes ?? "" };
    const set = (k, v) => setEdit(x => ({ ...x, [sub.id]: { ...e, [k]:v } }));
    return (
      <div style={{ marginTop:"8px" }}>
        <div style={{ fontSize:"14px", color:C.black }}>Submitted {fmtShortDate(mtDateStr(Date.parse(sub.submitted_at)))} at {formatMTTime(sub.submitted_at)}</div>
        {photos.length===0 ? <div style={{ fontSize:"13px", color:C.muted, marginTop:"6px" }}>No photos found on this submission.</div> : (
          <div style={{ display:"flex", flexWrap:"wrap", gap:"6px", marginTop:"8px" }}>{photos.map(p => <PhotoThumb key={p.documentId || p.url} photo={p} token={token}/>)}</div>
        )}
        <div style={{ fontSize:"14px", color:C.black, marginTop:"8px" }}>
          {g ? <>Grade <strong>{fmtScore(Number(g.score))}</strong>{g.graded_by ? ` · by ${g.graded_by}` : ""}{g.graded_at ? ` · ${fmtShortDate(mtDateStr(Date.parse(g.graded_at)))}` : ""}</>
            : <span style={{ color:C.gold }}>Not graded yet — counts {TECH_SCORE_CONFIG.truck.notGradedScore} for now</span>}
        </div>
        {g?.notes && <div style={{ fontSize:"14px", color:C.black, marginTop:"4px" }}>📝 {g.notes}</div>}
        {canGrade && (
          <div style={{ display:"flex", gap:"6px", flexWrap:"wrap", alignItems:"center", marginTop:"8px" }}>
            <input type="number" min="0" max="100" inputMode="decimal" placeholder="0–100" value={e.score} onChange={ev => set("score", ev.target.value)} style={{ ...inp, width:"90px" }} aria-label="Grade"/>
            <input placeholder="Notes (what was wrong)" value={e.notes} onChange={ev => set("notes", ev.target.value)} style={{ ...inp, flex:"1 1 180px" }} aria-label="Notes"/>
            <button disabled={saving===sub.id} onClick={() => saveGrade(sub)} style={{ background:C.blue, border:"none", color:C.white, padding:"9px 16px", borderRadius:"10px", cursor:"pointer", fontSize:"14px", fontWeight:"700" }}>{saving===sub.id ? "Saving…" : g ? "Save override" : "Save grade"}</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"8px", marginBottom:"12px" }}>
        <button style={arrow} onClick={() => { setWk(shiftWeek(wk,-1)); setOpen(null); }}>◀</button>
        <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"16px", color:C.black }}>{formatWeekLabel(wk)}{wk===thisWeek ? " · this week" : ""}</div>
        <button style={{ ...arrow, opacity:wk>=thisWeek?0.4:1 }} disabled={wk>=thisWeek} onClick={() => { setWk(shiftWeek(wk,1)); setOpen(null); }}>▶</button>
      </div>
      <div style={{ fontSize:"13px", color:C.muted, marginBottom:"12px", lineHeight:"1.5" }}>
        Nightly Truck Checks (GHL form) for every night a tech worked (a job with revenue). Graded = the grade; submitted but not graded yet counts {TECH_SCORE_CONFIG.truck.notGradedScore} for now; worked with no Truck Check counts 0. Apprentices in training aren't listed. Part of the Equipment &amp; Truck section of the Tech Score. Weeks run Wednesday–Tuesday. Display only — not tied to pay.
      </div>
      {state.error && <div style={{ background:`${C.red}10`, border:`1px solid ${C.red}`, borderRadius:"12px", padding:"12px", fontSize:"13px", color:C.red, marginBottom:"10px" }}>Couldn't load: {state.error}</div>}
      {state.loading && !state.data && <div style={{ color:C.muted, padding:"16px" }}>Loading...</div>}
      {state.data && unmatched.length>0 && (
        <div style={{ background:"rgba(0,0,0,0.06)", border:"1px solid #ef4444", borderRadius:"12px", padding:"10px 12px", marginBottom:"12px", fontSize:"13px", color:C.black }}>
          <div style={{ fontWeight:"700", color:C.red }}>⚠ Truck Checks this week with a name that doesn't match the roster — not counted:</div>
          {unmatched.join(", ")}
        </div>
      )}
      {state.data && rows.map(r => {
        const isOpen = open===r.tech.id;
        const missedNights = r.nights.filter(n => n.status==="missed");
        const canOpen = r.nights.length>0 || r.extra.length>0;
        return (
          <div key={r.tech.id} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"12px 14px", marginBottom:"8px", opacity:canOpen?1:0.6 }}>
            <div onClick={() => canOpen && setOpen(isOpen ? null : r.tech.id)} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"10px", cursor:canOpen?"pointer":"default" }}>
              <div>
                <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"18px", color:C.black }}>{r.tech.name} {canOpen && <span style={{ fontSize:"12px", color:C.muted }}>{isOpen?"▲":"▼"}</span>}</div>
                <div style={{ fontSize:"14px", color:C.black, marginTop:"2px" }}>{r.worked ? `Submitted ${r.submitted} / ${r.worked} night${r.worked!==1?"s":""} worked` : r.nights.length ? "Worked tonight — Truck Check not in yet" : "No nights worked"}{r.notGraded ? <span style={{ color:C.gold }}> · {r.notGraded} not graded yet</span> : null}</div>
                {missedNights.length>0 && <div style={{ fontSize:"14px", color:C.red, marginTop:"2px", fontWeight:"700" }}>Missing: {missedNights.map(n => fmtShortDate(n.date)).reverse().join(", ")}</div>}
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"24px", color:sectionColor(r.score), lineHeight:1 }}>{fmtScore(r.score)}</div>
                <div style={{ fontSize:"11px", color:C.muted, marginTop:"3px" }}>average grade</div>
              </div>
            </div>
            {isOpen && (
              <div style={{ marginTop:"8px" }}>
                {[...r.nights.map(n => ({ ...n, counted:true })), ...r.extra.map(x => ({ ...x, status:"extra", score:null, counted:false }))].map(n => {
                  const key = `${r.tech.id}|${n.date}`, nOpen = openNight===key;
                  const st = n.status==="extra" ? { label:"No paid job this night — not counted", color:C.muted } : TRUCK_STATUS[n.status];
                  return (
                    <div key={key} style={{ borderTop:`1px solid ${C.border}`, padding:"8px 0" }}>
                      <div onClick={() => setOpenNight(nOpen ? null : key)} style={{ display:"flex", justifyContent:"space-between", gap:"8px", cursor:"pointer", fontSize:"15px" }}>
                        <span style={{ color:st.color || C.black, fontWeight:"700" }}>{fmtShortDate(n.date)} · {st.label} <span style={{ fontSize:"12px", color:C.muted }}>{nOpen?"▲":"▼"}</span></span>
                        <span style={{ color:sectionColor(n.score), fontWeight:"700", fontFamily:FONT, fontSize:"17px" }}>{n.score==null ? "—" : fmtScore(n.score)}</span>
                      </div>
                      {nOpen && nightDetail(n)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── TRUCKS (admin) ───────────────────────────────────────────────────────────
// Who picked which truck on a day (with history by date), driving nobody
// picked a truck for (assign it to a tech or dismiss it), and the vehicle
// list. Feeds the Ford Pro driver scorecard; display only, not tied to pay.
function TrucksAdminTab({ techs, vehicles, timeEntries=[], token, refreshAll, showToast }) {
  const today = mtDateStr(Date.now());
  const [day, setDay] = useState(today);
  const [picks, setPicks] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drive, setDrive] = useState({ loading:true, error:null, data:null });
  const [assignTo, setAssignTo] = useState({});
  const [edits, setEdits] = useState({});
  const [newV, setNewV] = useState({ name:"", model:"", plate:"", vin:"" });
  const [bump, setBump] = useState(0);
  const [imp, setImp] = useState(null);         // parsed Ford report upload, before import
  const [impDate, setImpDate] = useState("");
  const [fileKey, setFileKey] = useState(0);
  const techName = id => techs.find(t=>t.id===id)?.name || "Unknown tech";
  const inp = { background:C.white, border:`1px solid ${C.border}`, color:C.black, padding:"7px 9px", borderRadius:"10px", fontSize:"13px", width:"100%", boxSizing:"border-box" };
  const smallBtn = (color) => ({ background:color, border:"none", color:C.white, padding:"6px 12px", borderRadius:"10px", cursor:busy?"not-allowed":"pointer", fontSize:"12px", fontWeight:"700", whiteSpace:"nowrap" });
  const card = { background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"14px 16px" };

  useEffect(() => {
    let live = true;
    sb(`truck_assignments?select=*&work_date=eq.${day}&order=picked_at`).then(r => live && setPicks(r||[])).catch(() => live && setPicks([]));
    return () => { live = false; };
  }, [day, bump]);

  const from = (() => { const d = new Date(today+"T12:00:00Z"); d.setUTCDate(d.getUTCDate()-13); return d.toISOString().slice(0,10); })();
  useEffect(() => {
    let live = true;
    fetch(`/.netlify/functions/driver-scores?from=${from}&to=${today}`, { headers:{ Authorization:`Bearer ${token||""}` } })
      .then(async r => { const j = await r.json().catch(()=>({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; })
      .then(data => live && setDrive({ loading:false, error:null, data }))
      .catch(e => live && setDrive({ loading:false, error:e.message, data:null }));
    return () => { live = false; };
  }, [from, today, token, bump]);

  async function removePick(a) {
    if (!window.confirm(`Remove ${techName(a.tech_id)}'s pick of ${vehicles.find(v=>v.id===a.vehicle_id)?.name} on ${fmtShortDate(a.work_date)}?`)) return;
    setBusy(true);
    try {
      await sb(`truck_assignments?id=eq.${a.id}`, { method:"DELETE", prefer:"return=minimal" });
      await sb("truck_assignment_log", { method:"POST", prefer:"return=minimal", body:JSON.stringify({ tech_id:a.tech_id, vehicle_id:a.vehicle_id, work_date:a.work_date, action:"admin_remove" }) }).catch(()=>{});
      setBump(b=>b+1); await refreshAll(); showToast("Pick removed");
    } catch(e) { showToast("Error: "+e.message, false); }
    setBusy(false);
  }
  // Give an unpicked truck to a tech for the day. Moves that tech's own pick
  // if they had one (one row per tech per day).
  async function assignPick(vehicle, techId) {
    if (!techId) return;
    const had = (picks||[]).find(a => a.tech_id===techId);
    if (had && !window.confirm(`${techName(techId)} already has ${vehicles.find(v=>v.id===had.vehicle_id)?.name || "a truck"} on ${fmtShortDate(day)}. Move them to ${vehicle.name}?`)) return;
    setBusy(true);
    try {
      await saveTruckPick({ tech:{ id:techId }, vehicle, workDate:day, action:"admin_assign" });
      setBump(b=>b+1); await refreshAll(); showToast(`✅ ${vehicle.name} → ${techName(techId)}`);
    } catch(e) { showToast(e instanceof TruckTakenError ? "That truck already has a tech that day — remove their pick first" : "Error: "+e.message, false); }
    setBusy(false);
  }
  async function driving(action, row, techId=null) {
    setBusy(true);
    try {
      const r = await fetch(`/.netlify/functions/driver-scores?action=${action}`, { method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token||""}` },
        body:JSON.stringify({ vin:row.vin, work_date:row.work_date, miles:row.miles, tech_id:techId }) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setBump(b=>b+1);
      showToast(action==="assign" ? (techId ? `✅ Assigned to ${techName(techId)}` : "Unassigned") : "Dismissed");
    } catch(e) { showToast("Error: "+e.message, false); }
    setBusy(false);
  }
  // Ford's daily "Driver score" email -> download its CSVs -> drop them here.
  async function readFordFiles(fileList) {
    try {
      const files = await Promise.all([...fileList].map(f => f.text().then(text => ({ name:f.name, text }))));
      const r = buildFordImport(files, vehicles);
      // No dated events = no way to know the day: make the admin pick it
      // rather than silently guessing yesterday.
      setImp(r); setImpDate(r.workDate || "");
    } catch(e) { showToast("Couldn't read those files: "+e.message, false); }
  }
  async function importFord() {
    if (!imp || !impDate) return;
    setBusy(true);
    try {
      const r = await fetch(`/.netlify/functions/driver-scores?action=import`, { method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token||""}` },
        body:JSON.stringify({ work_date:impDate, daily:imp.daily, events:imp.events }) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      showToast(`✅ Imported ${j.trucks} trucks and ${j.events} events for ${fmtShortDate(impDate)}`);
      setImp(null); setFileKey(k=>k+1); setBump(b=>b+1);
    } catch(e) { showToast("Import failed: "+e.message, false); }
    setBusy(false);
  }

  async function saveVehicle(v) {
    const e = { ...v, ...edits[v.id] };
    if (!e.name?.trim() || !/^[A-HJ-NPR-Z0-9]{17}$/i.test(e.vin||"")) return showToast("Name and a 17-character VIN are required", false);
    setBusy(true);
    try {
      await sb(`vehicles?id=eq.${v.id}`, { method:"PATCH", prefer:"return=minimal", body:JSON.stringify({ name:e.name.trim(), model:e.model||null, plate:e.plate||null, vin:e.vin.toUpperCase(), active:e.active!==false }) });
      setEdits(x => { const n={...x}; delete n[v.id]; return n; });
      await refreshAll(); showToast(`✅ ${e.name} saved`);
    } catch(err) { showToast(/duplicate|23505/.test(err.message) ? "That name or VIN is already in the list" : "Error: "+err.message, false); }
    setBusy(false);
  }
  async function addVehicle() {
    if (!newV.name.trim() || !/^[A-HJ-NPR-Z0-9]{17}$/i.test(newV.vin)) return showToast("Name and a 17-character VIN are required", false);
    setBusy(true);
    try {
      await sb("vehicles", { method:"POST", prefer:"return=minimal", body:JSON.stringify({ name:newV.name.trim(), model:newV.model||null, plate:newV.plate||null, vin:newV.vin.toUpperCase(), active:true }) });
      setNewV({ name:"", model:"", plate:"", vin:"" }); await refreshAll(); showToast("✅ Vehicle added");
    } catch(err) { showToast(/duplicate|23505/.test(err.message) ? "That name or VIN is already in the list" : "Error: "+err.message, false); }
    setBusy(false);
  }

  if (!vehicles.length) return (
    <div style={{ ...card, fontSize:"13px", color:C.black }}>The vehicles list isn't set up yet — an owner needs to apply the database migration <code>supabase/migrations/20261006_vehicles_driver_scorecard.sql</code>. Until then, clock-in works without a truck pick.</div>
  );

  const dayPicks = picks || [];
  const clockedIn = [...new Set(timeEntries.filter(e => e.work_date===day).map(e => e.tech_id))];
  const noPick = clockedIn.filter(id => !dayPicks.some(a => a.tech_id===id));
  const d = drive.data;
  const found = d ? findUnassignedDriving(d) : [];
  const stored = d?.unassigned || [];
  const openRows = [
    ...found.filter(f => !stored.some(s => s.vin===f.vin && s.work_date===f.work_date && (s.assigned_tech_id || s.dismissed))),
    ...stored.filter(s => !s.assigned_tech_id && !s.dismissed && !found.some(f => f.vin===s.vin && f.work_date===s.work_date))
      .map(s => ({ ...s, vehicle: vehicles.find(v=>v.vin===s.vin)?.name || s.vin })),
  ].sort((a,b) => b.work_date.localeCompare(a.work_date));
  const assignedRows = stored.filter(s => s.assigned_tech_id).sort((a,b) => b.work_date.localeCompare(a.work_date));

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
      <div style={card}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"10px", marginBottom:"10px" }}>
          <Label color={C.blue}>🚚 Trucks {day===today ? "today" : fmtShortDate(day)}</Label>
          <input type="date" value={day} max={today} onChange={e=>e.target.value && setDay(e.target.value)} style={{ ...inp, width:"auto" }}/>
        </div>
        {picks===null ? <div style={{ fontSize:"13px", color:C.muted }}>Loading…</div> : (
          <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
            {vehicles.filter(v => v.active!==false || dayPicks.some(a=>a.vehicle_id===v.id)).map(v => {
              const on = dayPicks.filter(a => a.vehicle_id===v.id);
              return (
                <div key={v.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"8px", padding:"6px 0", borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:"13px", color:C.black, fontWeight:"700", minWidth:"70px" }}>{v.name}</span>
                  <div style={{ flex:1, display:"flex", gap:"6px", flexWrap:"wrap", justifyContent:"flex-end" }}>
                    {on.length===0 && (
                      <select value="" disabled={busy} onChange={e => assignPick(v, e.target.value)} style={{ ...inp, width:"auto", fontSize:"12px", padding:"4px 6px", color:C.muted }}>
                        <option value="">not picked — assign…</option>
                        {techs.filter(t=>t.is_active!==false && t.title!=="owner").sort(byFirstName).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    )}
                    {on.map(a => (
                      <span key={a.id} style={{ display:"inline-flex", alignItems:"center", gap:"6px", fontSize:"12px", color:C.black, background:on.length>1?`${C.gold}20`:C.cardLt, border:`1px solid ${on.length>1?C.gold:C.border}`, borderRadius:"14px", padding:"3px 4px 3px 10px" }}>
                        {techName(a.tech_id)}{on.length>1 && " ⚠"}
                        <button disabled={busy} onClick={()=>removePick(a)} title="Remove this pick" style={{ background:"none", border:"none", color:C.red, cursor:"pointer", fontSize:"13px", padding:"0 4px" }}>×</button>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
            <div style={{ fontSize:"12px", color:C.muted }}>One tech per truck per day. To move a truck to someone else, remove the pick (×) and assign it.</div>
            {dayPicks.some(a => dayPicks.filter(o=>o.vehicle_id===a.vehicle_id).length>1) && <div style={{ fontSize:"12px", color:C.gold }}>⚠ Two techs on one truck (picked before one-truck-per-tech): its driving isn't scored for either until one pick is removed.</div>}
            {noPick.length>0 && <div style={{ fontSize:"12px", color:C.red, marginTop:"4px" }}>Clocked in without a truck pick: {noPick.map(techName).join(", ")}</div>}
          </div>
        )}
      </div>

      <div style={card}>
        <Label color={C.green}>📥 Upload Ford reports</Label>
        <div style={{ fontSize:"12px", color:C.muted, margin:"6px 0 10px", lineHeight:1.5 }}>
          Each morning Ford emails Equipment@skylod.com a "Ford Pro™ Telematics Report Delivered" email (the <strong>Driver score</strong> schedule) covering the day before. Download these from it and drop them here: <strong>Fleet Activity Summary</strong> (required — miles, idle and speeding minutes), <strong>Vehicle Speeding Events Enhanced</strong>, <strong>Vehicle Harsh Events Enhanced</strong>, <strong>Vehicle Seat Belt Violations Enhanced</strong> and <strong>Vehicle Excessive Idling Enhanced</strong>. Other files are skipped. Locations and addresses are never saved. Uploading the same day again replaces it.
          {drive.data?.last_pull && <div style={{ marginTop:"4px", color:C.black }}>Last import: {fmtShortDate(drive.data.last_pull.work_date)} — {drive.data.last_pull.trucks} trucks, {drive.data.last_pull.events} events{drive.data.last_pull.by ? ` (by ${drive.data.last_pull.by})` : ""}</div>}
        </div>
        <input key={fileKey} type="file" accept=".csv,text/csv" multiple onChange={e => e.target.files?.length && readFordFiles(e.target.files)} style={{ fontSize:"13px", color:C.black }}/>
        {imp && (
          <div style={{ marginTop:"10px", background:C.cardLt, border:`1px solid ${C.border}`, borderRadius:"10px", padding:"10px 12px", fontSize:"12px", color:C.black }}>
            <div style={{ display:"flex", alignItems:"center", gap:"8px", flexWrap:"wrap", marginBottom:"6px" }}>
              <strong>Day these reports cover:</strong>
              <input type="date" value={impDate} max={today} onChange={e=>setImpDate(e.target.value)} style={{ ...inp, width:"auto" }}/>
            </div>
            {imp.used.map(u => <div key={u}>✓ {u}</div>)}
            {imp.skipped.length>0 && <div style={{ color:C.muted }}>Skipped: {imp.skipped.join(", ")}</div>}
            {imp.daily.length>0 && (
              <div style={{ marginTop:"6px" }}>
                {imp.daily.map(r => {
                  const n = imp.events.filter(e => e.vin===r.vin).length;
                  return <div key={r.vin}>{vehicles.find(v=>v.vin===r.vin)?.name || r.vehicle} — {Math.round(r.miles)} mi, {Math.round(r.speeding_minutes||0)} min speeding, {Math.round(r.idle_minutes||0)} min idle, {n} event{n!==1?"s":""}</div>;
                })}
              </div>
            )}
            {imp.warnings.map((w,i) => <div key={i} style={{ color:C.gold, marginTop:"4px" }}>⚠ {w}</div>)}
            <div style={{ display:"flex", gap:"8px", marginTop:"10px" }}>
              <button disabled={busy || !impDate || (!imp.daily.length && !imp.events.length)} onClick={importFord} style={smallBtn(C.green)}>Import {impDate ? fmtShortDate(impDate) : ""}</button>
              <button disabled={busy} onClick={()=>{ setImp(null); setFileKey(k=>k+1); }} style={smallBtn(C.muted)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div style={card}>
        <Label color={C.red}>🚨 Unassigned driving (last 14 days)</Label>
        <div style={{ fontSize:"12px", color:C.muted, margin:"6px 0 10px" }}>A truck drove but nobody picked it that day. It doesn't count against anyone until you assign it. Assigning adds −10 ("drove without picking a truck") plus that day's driving events to the tech's driver score.</div>
        {drive.error && <div style={{ fontSize:"12px", color:C.red }}>Couldn't load Ford data: {drive.error}</div>}
        {drive.loading && <div style={{ fontSize:"12px", color:C.muted }}>Loading…</div>}
        {d && !d.daily.length && <div style={{ fontSize:"12px", color:C.muted }}>No Ford Pro data for the last 14 days yet — upload the daily Ford reports above.</div>}
        {d && d.daily.length>0 && openRows.length===0 && <div style={{ fontSize:"12px", color:C.green }}>Nothing unassigned.</div>}
        {openRows.map(r => (
          <div key={r.vin+r.work_date} style={{ display:"flex", alignItems:"center", gap:"8px", flexWrap:"wrap", padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
            <span style={{ fontSize:"13px", color:C.black, fontWeight:"700", flex:"1 1 140px" }}>{r.vehicle} · {fmtShortDate(r.work_date)} · {Math.round(r.miles||0)} mi</span>
            <select value={assignTo[r.vin+r.work_date]||""} onChange={e=>setAssignTo(x=>({...x,[r.vin+r.work_date]:e.target.value}))} style={{ ...inp, width:"auto", flex:"1 1 140px" }}>
              <option value="">Assign to…</option>
              {techs.filter(t=>t.is_active!==false && t.title!=="owner").map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button disabled={busy||!assignTo[r.vin+r.work_date]} onClick={()=>driving("assign", r, assignTo[r.vin+r.work_date])} style={smallBtn(C.blue)}>Assign</button>
            <button disabled={busy} onClick={()=>driving("dismiss", r)} style={smallBtn(C.muted)}>Dismiss</button>
          </div>
        ))}
        {assignedRows.length>0 && (
          <div style={{ marginTop:"10px" }}>
            <div style={{ fontSize:"11px", color:C.muted, fontWeight:"700", letterSpacing:"-0.01em" }}>Assigned</div>
            {assignedRows.map(r => (
              <div key={r.vin+r.work_date} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"8px", fontSize:"12px", color:C.black, padding:"4px 0" }}>
                <span>{vehicles.find(v=>v.vin===r.vin)?.name || r.vin} · {fmtShortDate(r.work_date)} → {techName(r.assigned_tech_id)}{r.assigned_by ? ` (by ${r.assigned_by})` : ""}</span>
                <button disabled={busy} onClick={()=>driving("assign", r, null)} style={{ background:"none", border:`1px solid ${C.border}`, color:C.red, borderRadius:"8px", cursor:"pointer", fontSize:"11px", padding:"2px 8px" }}>Undo</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={card}>
        <Label color={C.blue}>🛻 Vehicles</Label>
        <div style={{ fontSize:"12px", color:C.muted, margin:"6px 0 10px" }}>Ford Pro data is matched to trucks by VIN. Inactive trucks drop off the clock-in list.</div>
        {vehicles.map(v => {
          const e = { ...v, ...edits[v.id] };
          const set = (k, val) => setEdits(x => ({ ...x, [v.id]: { ...x[v.id], [k]: val } }));
          return (
            <div key={v.id} style={{ display:"grid", gridTemplateColumns:"1fr 1.6fr 1fr", gap:"6px", alignItems:"center", padding:"8px 0", borderBottom:`1px solid ${C.border}`, opacity:e.active===false?0.55:1 }}>
              <input value={e.name||""} onChange={ev=>set("name",ev.target.value)} style={{ ...inp, fontWeight:"700" }} aria-label="Name"/>
              <input value={e.model||""} onChange={ev=>set("model",ev.target.value)} style={inp} aria-label="Model"/>
              <input value={e.plate||""} onChange={ev=>set("plate",ev.target.value)} style={inp} aria-label="Plate"/>
              <input value={e.vin||""} onChange={ev=>set("vin",ev.target.value)} style={{ ...inp, fontFamily:"monospace", fontSize:"12px", gridColumn:"1 / span 2" }} aria-label="VIN"/>
              <div style={{ display:"flex", alignItems:"center", gap:"6px", justifyContent:"flex-end" }}>
                <label style={{ fontSize:"11px", color:C.black, display:"flex", alignItems:"center", gap:"3px" }}><input type="checkbox" checked={e.active!==false} onChange={ev=>set("active",ev.target.checked)}/>Active</label>
                <button disabled={busy||!edits[v.id]} onClick={()=>saveVehicle(v)} style={{ ...smallBtn(C.blue), opacity:edits[v.id]?1:0.4 }}>Save</button>
              </div>
            </div>
          );
        })}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1.6fr 1fr", gap:"6px", alignItems:"center", marginTop:"10px" }}>
          <input placeholder="Name" value={newV.name} onChange={e=>setNewV(x=>({...x,name:e.target.value}))} style={inp}/>
          <input placeholder="Model" value={newV.model} onChange={e=>setNewV(x=>({...x,model:e.target.value}))} style={inp}/>
          <input placeholder="Plate" value={newV.plate} onChange={e=>setNewV(x=>({...x,plate:e.target.value}))} style={inp}/>
          <input placeholder="VIN (17 characters)" value={newV.vin} onChange={e=>setNewV(x=>({...x,vin:e.target.value}))} style={{ ...inp, fontFamily:"monospace", fontSize:"12px", gridColumn:"1 / span 2" }}/>
          <button disabled={busy} onClick={addVehicle} style={smallBtn(C.green)}>Add vehicle</button>
        </div>
      </div>
    </div>
  );
}

// ─── CALLBACKS (log + history) ───────────────────────────────────────────────
// Used by the admin panel and by Trevor's login (CALLBACK_ENTRY_TECHS) --
// he's the one who enters callbacks as they come in.
const CALLBACK_ENTRY_TECHS = new Set(["4641f4da-a16f-411b-8688-8b81ac06eda7"]);   // Trevor Prince
function CallbacksPanel({ techs, jobs, callbacks, refreshAll, showToast }) {
  const CB_EMPTY = { techId:"", jobId:"", lookback:14, jobDate:"", customer:"", jobNumber:"", splitTechId:"", missed:[], severity:0, reason:"" };
  const [cbForm, setCbForm] = useState(CB_EMPTY);
  const [cbPreset, setCbPreset] = useState("mtd");
  const [cbCStart, setCbCStart] = useState("");
  const [cbCEnd, setCbCEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const inp={ background:C.white, border:`1px solid ${C.border}`, color:C.black, padding:"10px 14px", borderRadius:"10px", fontSize:"14px", fontFamily:FONT, width:"100%", boxSizing:"border-box" };
  const sel=(val)=>({...inp, color:val?C.black:C.muted});
  const btn=(color)=>({ background:saving?C.border:color||C.blue, border:"none", color:C.white, padding:"13px", borderRadius:"24px", cursor:saving?"not-allowed":"pointer", fontSize:"13px", fontWeight:"700", fontStyle:"normal", letterSpacing:"-0.01em", fontFamily:FONT, width:"100%", textTransform:"none" });
  // The jobs a tech did recently, newest first -- picking one fills in the
  // date and client, and tells us who else was on it (split job).
  function recentJobsFor(techId, days) {
    if (!techId) return [];
    const since = new Date(); since.setDate(since.getDate()-days);
    const sinceStr = since.toLocaleDateString("en-CA",{timeZone:"America/Denver"});
    const seen = new Set();
    return (jobs||[]).filter(j=>j.tech_id===techId && j.job_date>=sinceStr && (j.revenue||0)>0 && !seen.has(j.hcp_job_id) && seen.add(j.hcp_job_id))
      .sort((x,y)=>y.job_date.localeCompare(x.job_date));
  }
  function techsOnJob(hcpJobId) {
    return [...new Set((jobs||[]).filter(j=>j.hcp_job_id===hcpJobId).map(j=>j.tech_id))];
  }
  async function logCallback() {
    const f = cbForm;
    if (!f.techId) return showToast("Select a tech",false);
    const picked = f.jobId && f.jobId!=="manual" ? (jobs||[]).find(j=>j.hcp_job_id===f.jobId && j.tech_id===f.techId) : null;
    if (!picked && f.jobId!=="manual") return showToast("Pick the job (or choose 'Job not listed')",false);
    const jobDate = picked ? picked.job_date : f.jobDate;
    if (!jobDate) return showToast("Enter the date the job was completed",false);
    if (!f.missed.length) return showToast("Pick at least one thing that was missed",false);
    if (!f.severity) return showToast("Pick the severity level",false);
    const techIds = picked
      ? techsOnJob(picked.hcp_job_id)
      : [f.techId, ...(f.splitTechId && f.splitTechId!==f.techId ? [f.splitTechId] : [])];
    const weight = Math.round(1/techIds.length*10000)/10000;
    const group_id = crypto.randomUUID();
    setSaving(true);
    try {
      const rows = techIds.map(id=>({
        tech_id:id, weight, group_id,
        job_date: jobDate,
        customer_name: (picked?.customer_name || f.customer || "").trim() || null,
        job_number: f.jobNumber.trim() || null,
        hcp_job_id: picked ? picked.hcp_job_id : null,
        missed_items: f.missed, severity: f.severity,
        reason: f.reason || "",
      }));
      await sb("callbacks",{method:"POST",body:JSON.stringify(rows)});
      await refreshAll();
      const names = techIds.map(id=>techs.find(t=>t.id===id)?.name||"?").join(" & ");
      const each = Math.round(CALLBACK_SEVERITY[f.severity].pts*weight);
      showToast(`📞 Callback logged for ${names} — ${each} pts deducted${techIds.length>1?" each (split)":""}`);
      setCbForm(CB_EMPTY);
    } catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function deleteCallback(cb) {
    const both = cb.group_id && callbacks.filter(c=>c.group_id===cb.group_id).length>1;
    if (!window.confirm(both ? "Delete this callback for everyone on the job?" : "Delete this callback?")) return;
    setSaving(true);
    try { await sb(cb.group_id ? `callbacks?group_id=eq.${cb.group_id}` : `callbacks?id=eq.${cb.id}`,{method:"DELETE",prefer:"return=minimal"}); await refreshAll(); showToast("Callback removed"); }
    catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
          const f = cbForm;
          const recent = recentJobsFor(f.techId, f.lookback);
          const picked = f.jobId && f.jobId!=="manual" ? recent.find(j=>j.hcp_job_id===f.jobId) : null;
          const crew = picked ? techsOnJob(picked.hcp_job_id) : [];
          const toggleMissed = id => setCbForm(v=>({...v, missed: v.missed.includes(id) ? v.missed.filter(x=>x!==id) : [...v.missed, id]}));
          // Date-filtered view: callbacks by the day the job was completed,
          // grouped so a split job shows once.
          const { start:cbStart, end:cbEnd } = getDateRangeBounds(cbPreset, cbCStart, cbCEnd);
          const inRange = callbacks.filter(c=>{ const d=callbackDate(c); return d && d>=cbStart && d<=cbEnd; });
          const groups = Object.values(inRange.reduce((acc,c)=>{ const k=c.group_id||c.id; (acc[k]=acc[k]||[]).push(c); return acc; },{}))
            .sort((x,y)=>(callbackDate(y[0])||"").localeCompare(callbackDate(x[0])||""));
          const cbCount = inRange.reduce((s,c)=>s+(c.weight==null?1:Number(c.weight)),0);
          const jobCount = new Set((jobs||[]).filter(j=>j.job_date>=cbStart && j.job_date<=cbEnd && (j.revenue||0)>0).map(j=>j.hcp_job_id)).size;
          const rate = jobCount>0 ? cbCount/jobCount*100 : 0;
          const itemCounts = {};
          groups.forEach(g=>(g[0].missed_items||[]).forEach(id=>{ itemCounts[id]=(itemCounts[id]||0)+1; }));
          const topItems = Object.entries(itemCounts).sort((x,y)=>y[1]-x[1]);
          const sevCounts = [1,2,3].map(l=>groups.filter(g=>g[0].severity===l).length);
          const techSummary = techs.map(t=>{
            const mine = inRange.filter(c=>c.tech_id===t.id);
            return { t, count: mine.reduce((s,c)=>s+(c.weight==null?1:Number(c.weight)),0), pts: mine.reduce((s,c)=>s+callbackPoints(c),0) };
          }).filter(x=>x.count>0).sort((x,y)=>y.count-x.count);
          const fmtCount = n => Number.isInteger(n) ? String(n) : n.toFixed(1);
          const chip = on => ({ display:"flex", alignItems:"flex-start", gap:"8px", padding:"6px 8px", borderRadius:"10px", border:`1px solid ${on?"#ff3b30":C.border}`, background:on?"#ef444410":C.white, cursor:"pointer", fontSize:"13px", color:C.black });
          return (
          <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
            <PageTools tools={[{ id:"log", label:"Log Callback", icon:"📞", primary:true, render:()=>(
              <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
                <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"16px", color:C.black }}>Log a Callback</div>
              <select value={f.techId} onChange={e=>setCbForm({...CB_EMPTY, techId:e.target.value, lookback:f.lookback})} style={sel(f.techId)}>
                <option value="">— Select Tech —</option>
                {techs.filter(t=>t.title!=="owner").map(t=><option key={t.id} value={t.id}>{t.name}{t.is_active===false?" (archived)":""}</option>)}
              </select>
              {f.techId&&(<>
                <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
                  <select value={f.jobId} onChange={e=>setCbForm(v=>({...v, jobId:e.target.value}))} style={{ ...sel(f.jobId), flex:1 }}>
                    <option value="">— Pick the job —</option>
                    {recent.map(j=><option key={j.hcp_job_id} value={j.hcp_job_id}>{fmtShortDate(j.job_date)} · {j.customer_name||"(no client name)"} · ${Math.round(j.revenue)}{techsOnJob(j.hcp_job_id).length>1?" · split":""}</option>)}
                    <option value="manual">Job not listed — enter it by hand</option>
                  </select>
                  <select value={f.lookback} onChange={e=>setCbForm(v=>({...v, lookback:Number(e.target.value), jobId:""}))} style={{ ...sel(true), width:"auto" }}>
                    {[14,30,60,90].map(d=><option key={d} value={d}>Last {d} days</option>)}
                  </select>
                </div>
                {picked&&(
                  <div style={{ fontSize:"12px", color:C.black, background:C.cardLt, borderRadius:"10px", padding:"8px 10px" }}>
                    Completed <strong>{fmtShortDate(picked.job_date)}</strong> · {picked.customer_name||"no client name"}
                    {crew.length>1 && <> · <strong style={{ color:"#ff3b30" }}>Split job:</strong> {crew.map(id=>techs.find(t=>t.id===id)?.name||"?").join(" & ")} — each gets 1/{crew.length} of the callback and points</>}
                  </div>
                )}
                {f.jobId==="manual"&&(
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
                    <div>
                      <div style={{ fontSize:"11px", color:C.muted, marginBottom:"4px" }}>Date the job was completed</div>
                      <input type="date" value={f.jobDate} onChange={e=>setCbForm(v=>({...v, jobDate:e.target.value}))} style={inp}/>
                    </div>
                    <div>
                      <div style={{ fontSize:"11px", color:C.muted, marginBottom:"4px" }}>Client name</div>
                      <input value={f.customer} onChange={e=>setCbForm(v=>({...v, customer:e.target.value}))} style={inp}/>
                    </div>
                    <select value={f.splitTechId} onChange={e=>setCbForm(v=>({...v, splitTechId:e.target.value}))} style={{ ...sel(f.splitTechId), gridColumn:"1 / -1" }}>
                      <option value="">Split job? Pick the other tech (optional)</option>
                      {techs.filter(t=>t.id!==f.techId && t.title!=="owner").map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                )}
                <input placeholder="HCP job # (optional)" value={f.jobNumber} onChange={e=>setCbForm(v=>({...v, jobNumber:e.target.value}))} style={inp}/>
                <div>
                  <div style={{ fontSize:"12px", color:C.muted, marginBottom:"6px" }}>What was missed? (pick all that apply)</div>
                  {CALLBACK_AREAS.map(a=>(
                    <div key={a.area} style={{ marginBottom:"8px" }}>
                      <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"13px", color:C.black, marginBottom:"4px" }}>{a.area}</div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:"6px" }}>
                        {a.items.map(i=>{ const on=f.missed.includes(i.id); return (
                          <label key={i.id} style={chip(on)}>
                            <input type="checkbox" checked={on} onChange={()=>toggleMissed(i.id)} style={{ marginTop:"2px" }}/>
                            <span><strong>{i.label}</strong>{i.hint&&<span style={{ display:"block", fontSize:"11px", color:C.muted }}>{i.hint}</span>}</span>
                          </label>
                        ); })}
                      </div>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize:"12px", color:C.muted, marginBottom:"6px" }}>How bad was it?</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
                    {[1,2,3].map(l=>{ const on=f.severity===l, sv=CALLBACK_SEVERITY[l]; return (
                      <label key={l} style={chip(on)}>
                        <input type="radio" name="cb-severity" checked={on} onChange={()=>setCbForm(v=>({...v, severity:l}))} style={{ marginTop:"2px" }}/>
                        <span><strong>{sv.label}</strong> — {sv.desc} <strong style={{ color:"#ff3b30" }}>(−{sv.pts} pts)</strong></span>
                      </label>
                    ); })}
                  </div>
                </div>
                <input placeholder="Notes (optional)" value={f.reason} onChange={e=>setCbForm(v=>({...v, reason:e.target.value}))} style={inp}/>
                <button onClick={logCallback} disabled={saving} style={{ ...btn("#ff3b30"), color:C.white }}>{saving?"Saving...":"Log Callback — Deduct Points"}</button>
              </>)}
              </div>
            )}]}/>
            {/* Date range + rate */}
            <DateRangePicker label="📅 Callbacks by job date" color="#ff3b30" preset={cbPreset} setPreset={setCbPreset} customStart={cbCStart} setCustomStart={setCbCStart} customEnd={cbCEnd} setCustomEnd={setCbCEnd}>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"8px", marginTop:"14px" }}>
                {[
                  { l:"Callback rate", v:`${rate.toFixed(2)}%`, c: rate>=2?"#ff3b30":C.green },
                  { l:"Callbacks", v:fmtCount(cbCount), c:C.black },
                  { l:"Completed jobs", v:jobCount, c:C.black },
                ].map(x=>(
                  <div key={x.l} style={{ background:C.cardLt, borderRadius:"10px", padding:"10px", textAlign:"center" }}>
                    <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"24px", color:x.c }}>{x.v}</div>
                    <div style={{ fontSize:"11px", color:C.muted, textTransform:"none", letterSpacing:"-0.01em" }}>{x.l}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize:"11px", color:C.muted, marginTop:"6px" }}>{cbStart} → {cbEnd} · Standard is under 2% · split-job callbacks count ½ per tech</div>
            </DateRangePicker>

            <ListTitle right={`${fmtCount(cbCount)} total`}>Callbacks by Tech</ListTitle>
            <RankRows rows={techSummary.map(x=>({ id:x.t.id, name:x.t.name, value:`${fmtCount(x.count)}`, chip:`${x.pts} pts`, bad:true }))} empty="No callbacks in this range. Keep it that way! 💪"/>

            {/* Breakdown for the range */}
            {groups.length>0&&(
              <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px 18px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)", display:"flex", flexDirection:"column", gap:"12px" }}>
                <Label color="#ff3b30">📊 Breakdown</Label>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"8px" }}>
                  {[1,2,3].map((l,i)=>(
                    <div key={l} style={{ background:C.cardLt, borderRadius:"10px", padding:"8px", textAlign:"center" }}>
                      <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"20px", color:C.black }}>{sevCounts[i]}</div>
                      <div style={{ fontSize:"11px", color:C.muted, textTransform:"none", letterSpacing:"-0.01em" }}>{CALLBACK_SEVERITY[l].label}</div>
                    </div>
                  ))}
                </div>
                {topItems.length>0&&(
                  <div>
                    <div style={{ fontSize:"12px", color:C.muted, marginBottom:"4px" }}>Most missed</div>
                    {topItems.map(([id,n])=>(
                      <div key={id} style={{ display:"flex", justifyContent:"space-between", fontSize:"13px", color:C.black, padding:"2px 0" }}><span>{CALLBACK_ITEM_LABEL[id]||id}</span><strong>{n}</strong></div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* History for the range */}
            <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"16px", overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
              <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}`, background:C.cardLt }}>
                <Label color="#ff3b30">📋 Callback History</Label>
              </div>
              <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"8px" }}>
                {groups.length===0&&<div style={{ fontSize:"13px", color:C.muted }}>No callbacks for jobs in this date range. Keep it that way! 💪</div>}
                {groups.map(g=>{
                  const c = g[0];
                  const names = g.map(r=>techs.find(t=>t.id===r.tech_id)?.name||"Unknown").join(" & ");
                  return (
                    <div key={c.group_id||c.id} style={{ background:`#ef444410`, border:`1px solid #ef444433`, borderLeft:`3px solid #ef4444`, borderRadius:"10px", padding:"12px 14px", display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:"12px" }}>
                      <div>
                        <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"15px", color:C.black }}>
                          {names}{g.length>1&&<span style={{ fontSize:"11px", color:"#ff3b30", marginLeft:"6px" }}>Split</span>}
                          {c.severity&&<span style={{ fontSize:"11px", color:C.white, background:"#ff3b30", borderRadius:"10px", padding:"1px 7px", marginLeft:"6px" }}>{CALLBACK_SEVERITY[c.severity].label}</span>}
                        </div>
                        <div style={{ fontSize:"12px", color:C.black, marginTop:"3px" }}>
                          Job {callbackDate(c)?fmtShortDate(callbackDate(c)):"?"}{c.customer_name?` · ${c.customer_name}`:""}{c.job_number?` · #${c.job_number}`:""}
                        </div>
                        {(c.missed_items||[]).length>0&&<div style={{ fontSize:"11px", color:C.muted, marginTop:"2px" }}>Missed: {c.missed_items.map(id=>CALLBACK_ITEM_LABEL[id]||id).join(", ")}</div>}
                        {c.reason&&<div style={{ fontSize:"11px", color:C.muted, marginTop:"2px" }}>{c.reason}</div>}
                        <div style={{ fontSize:"11px", color:C.muted, marginTop:"2px" }}>Logged {new Date(c.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:"10px", flexShrink:0 }}>
                        <span style={{ fontFamily:FONT, fontWeight:"700", fontSize:"15px", color:"#ff3b30" }}>{callbackPoints(c)} pts{g.length>1?" each":""}</span>
                        <button onClick={()=>deleteCallback(c)} disabled={saving} style={{ background:"none", border:`1px solid #ef4444`, color:"#ff3b30", padding:"4px 10px", borderRadius:"10px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"11px" }}>Delete</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          );
}

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────
// isManager: logged in as the Field Supervisor. Same panel as the owners, but
// read-only on anything that decides his own bonus (quota targets, trucks and
// holidays, firing approvals, calibration) so he can't move his own numbers.
function AdminPanel({ techs, upsells, switchovers, reviews, callbacks, rideAlongs, schedules, quota, setQuota, jobs, timeEntries=[], tipEntries=[], pendingSplits=[], unmatchedTechs=[], vehicles=[], truckAssignments=[], onLogout, refreshAll, isManager=false, currentUser=null }) {
  // Live-standings views (Leaderboard, Journey Map) should only show active
  // techs, matching what the tech-facing app already does — archived techs
  // stay fully visible in Reports/Payroll/Upsell Audit where historical
  // accuracy matters instead. Same reasoning excludes owner/admin accounts
  // (title:"owner") from these standings views -- they're tracked for
  // revenue completeness (Reports/Repair Revenue/Upsell Totals all still use
  // the raw `techs` prop, unaffected by this filter) but shouldn't appear in
  // gamified rankings.
  const activeTechs = techs.filter(t => t.is_active !== false && t.title !== "owner");
  const [tab, setTab] = useState("upsells");
  const [menuOpen, setMenuOpen] = useState(false);
  const [awardForm, setAwardForm] = useState({techId:"",badgeId:""});
  const [addForm, setAddForm] = useState({name:"",pin:"",avatar:"",start_date:"",commission_rate:27});
  const [swForm, setSwForm] = useState({techId:"",planId:"",exterior:null});
  const [editingSwId, setEditingSwId] = useState(null);
  const [editSwForm, setEditSwForm] = useState({date:"",planId:"",exterior:false});
  const [swRangePreset, setSwRangePreset] = useState("wtd");
  const [swCStart, setSwCStart] = useState("");
  const [swCEnd, setSwCEnd] = useState("");
  const [reviewForm, setReviewForm] = useState({});
  const [archivingId, setArchivingId] = useState(null);
  const [archiveForm, setArchiveForm] = useState({left_date:"",leave_reason:"",fire_category:"",fire_notes:""});
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);

  const showToast=(msg,ok=true)=>{ setToast({msg,ok}); setTimeout(()=>setToast(null),3000); };
  async function saveQuota(newQuota) {
    if (isManager) return showToast("Only an owner can change quota targets",false);
    setSaving(true);
    try {
      const existing = await sb("settings?key=eq.quota&select=id").catch(()=>[]);
      if (existing&&existing.length>0) {
        await sb(`settings?id=eq.${existing[0].id}`,{method:"PATCH",body:JSON.stringify({value:JSON.stringify(newQuota)}),prefer:"return=minimal"});
      } else {
        await sb("settings",{method:"POST",body:JSON.stringify({key:"quota",value:JSON.stringify(newQuota)})});
      }
      setQuota(newQuota);
      showToast("✅ Quota saved — all devices updated!");
    } catch(e) { showToast("Error saving quota: "+e.message,false); }
    setSaving(false);
  }

  async function awardBadge() {
    if (!awardForm.techId||!awardForm.badgeId) return showToast("Select a tech and badge",false);
    const tech=techs.find(t=>t.id===awardForm.techId);
    if (tech.badges.includes(awardForm.badgeId)) return showToast(`${tech.name} already has this badge`,false);
    setSaving(true);
    try { await sb(`techs?id=eq.${tech.id}`,{method:"PATCH",body:JSON.stringify({badges:[...tech.badges,awardForm.badgeId]}),prefer:"return=minimal"}); await refreshAll(); showToast(`✅ Badge awarded to ${tech.name}!`); setAwardForm({techId:"",badgeId:""}); }
    catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function revokeBadge(techId,badgeId) {
    const tech=techs.find(t=>t.id===techId); setSaving(true);
    try { await sb(`techs?id=eq.${techId}`,{method:"PATCH",body:JSON.stringify({badges:tech.badges.filter(b=>b!==badgeId)}),prefer:"return=minimal"}); await refreshAll(); showToast("Badge removed"); }
    catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function addTech() {
    if (!addForm.name||!addForm.pin||addForm.pin.length!==4) return showToast("Name + 4-digit PIN required",false);
    setSaving(true);
    try { const avatar=addForm.avatar||addForm.name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2); const res=await sb("techs?select=id",{method:"POST",body:JSON.stringify({name:addForm.name,pin:addForm.pin,avatar,badges:["day_one"],start_date:addForm.start_date||null,commission_rate:parseInt(addForm.commission_rate)||27,title:addForm.title||"detail_apprentice"})}); if(res&&res[0]&&addForm.start_date&&(addForm.title||"detail_apprentice")!=="detail_apprentice")await scheduleCheckins(res[0].id,addForm.start_date).catch(()=>{}); await refreshAll(); showToast(`✅ ${addForm.name} added!`); setAddForm({name:"",pin:"",avatar:"",start_date:"",commission_rate:27,title:"detail_apprentice"}); }
    catch(e){ showToast(/duplicate|23505|techs_pin/i.test(e.message) ? "That PIN is already in use — pick another" : "Error: "+e.message,false); }
    setSaving(false);
  }
  // PINs aren't readable from the browser, so they can be replaced but not shown.
  async function changePin(tech) {
    const pin = window.prompt(`New 4-digit PIN for ${tech.name}:`);
    if (pin===null) return;
    if (!/^\d{4}$/.test(pin)) return showToast("PIN must be 4 digits",false);
    setSaving(true);
    try { await sb(`techs?id=eq.${tech.id}`,{method:"PATCH",body:JSON.stringify({pin}),prefer:"return=minimal"}); showToast(`✅ PIN changed for ${tech.name}`); }
    catch(e){ showToast(/duplicate|23505|techs_pin/i.test(e.message) ? "That PIN is already in use — pick another" : "Error: "+e.message,false); }
    setSaving(false);
  }
  async function updateStartDate(techId,date) {
    if (isManager && techs.find(t=>t.id===techId)?.start_date) return showToast("Only an owner can change a start date",false);
    try { await sb(`techs?id=eq.${techId}`,{method:"PATCH",body:JSON.stringify({start_date:date||null}),prefer:"return=minimal"}); const st=techs.find(t=>t.id===techId); if(date&&st&&!isInTraining(st)&&!st.onboarding_complete_date)await scheduleCheckins(techId,date).catch(()=>{}); await refreshAll(); showToast("✅ Start date saved!"); }
    catch(e){ showToast("Error: "+e.message,false); }
  }
  function startArchive(tech) {
    setArchivingId(tech.id);
    setArchiveForm({ left_date:new Date().toISOString().split("T")[0], leave_reason:"", fire_category:"", fire_notes:"" });
  }
  // Archiving records when and why a tech left -- the retention KPIs in
  // Operations Progress are built from these. A firing only stops counting
  // against the ops bonus once an admin approves it (fire_approval), so a quit
  // can't be relabeled as a firing to protect the bonus.
  async function archiveTech(tech) {
    const f = archiveForm;
    if (!f.left_date) return showToast("Pick the date they left",false);
    if (!f.leave_reason) return showToast("Pick why they left",false);
    if (f.leave_reason==="fired" && !f.fire_category) return showToast("Pick the reason for the firing",false);
    if (f.leave_reason==="fired" && !f.fire_notes.trim()) return showToast("Add notes explaining the firing",false);
    setSaving(true);
    try {
      const fired = f.leave_reason==="fired";
      await sb(`techs?id=eq.${tech.id}`,{method:"PATCH",body:JSON.stringify({
        is_active:false, left_date:f.left_date, leave_reason:f.leave_reason,
        fire_category: fired ? f.fire_category : null,
        fire_notes: fired ? f.fire_notes.trim() : null,
        fire_approval: fired ? "pending" : null,
        fire_reviewed_at: null,
      }),prefer:"return=minimal"});
      await refreshAll();
      setArchivingId(null);
      showToast(`${tech.name} archived`);
    } catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function reviewFiring(tech, decision) {
    if (isManager) return showToast("Only an owner can approve or deny a firing",false);
    setSaving(true);
    try {
      await sb(`techs?id=eq.${tech.id}`,{method:"PATCH",body:JSON.stringify({fire_approval:decision, fire_reviewed_at:new Date().toISOString()}),prefer:"return=minimal"});
      await refreshAll();
      showToast(decision==="approved" ? `✅ Firing approved for ${tech.name}` : `Firing denied for ${tech.name} — counts as a loss`);
    } catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function reactivateTech(tech) {
    setSaving(true);
    try {
      await sb(`techs?id=eq.${tech.id}`,{method:"PATCH",body:JSON.stringify({is_active:true, left_date:null, leave_reason:null, fire_category:null, fire_notes:null, fire_approval:null, fire_reviewed_at:null}),prefer:"return=minimal"});
      await refreshAll();
      showToast(`✅ ${tech.name} reactivated`);
    } catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function logSwitchover() {
    if (!swForm.techId||!swForm.planId) return showToast("Select a tech and plan",false);
    if (swForm.exterior===null) return showToast("Pick Interior only or Interior + Exterior",false);
    setSaving(true);
    const date = mtDateStr(Date.now());   // counts the day it's entered
    try { await sb("switchovers",{method:"POST",body:JSON.stringify({tech_id:swForm.techId,week_key:dateToWeekKey(date),sold_date:date,plan_id:swForm.planId,with_exterior:!!swForm.exterior})}); await refreshAll(); showToast(`✅ Switchover logged!`); setSwForm({techId:"",planId:"",exterior:null}); }
    catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  function startEditSwitchover(s) {
    setEditingSwId(s.id);
    setEditSwForm({ date: switchoverDate(s), planId: s.plan_id, exterior: !!s.with_exterior });
  }
  async function saveEditSwitchover() {
    if (!editSwForm.date) return showToast("Pick a date",false);
    setSaving(true);
    try {
      const body = { week_key: dateToWeekKey(editSwForm.date), sold_date: editSwForm.date, plan_id: editSwForm.planId, with_exterior: !!editSwForm.exterior };
      await sb(`switchovers?id=eq.${editingSwId}`,{method:"PATCH",body:JSON.stringify(body),prefer:"return=minimal"});
      await refreshAll();
      setEditingSwId(null);
      showToast("✅ Switchover updated");
    } catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function deleteSwitchoverEntry(id) {
    if (!window.confirm("Delete this switchover?")) return;
    setSaving(true);
    try { await sb(`switchovers?id=eq.${id}`,{method:"DELETE",prefer:"return=minimal"}); await refreshAll(); setEditingSwId(null); showToast("Switchover deleted"); }
    catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function toggleTeamLead(tech) {
    setSaving(true);
    try {
      const newVal = !tech.is_lead;
      await sb(`techs?id=eq.${tech.id}`,{method:"PATCH",body:JSON.stringify({is_lead:newVal}),prefer:"return=minimal"});
      // If removing lead status, unassign all their team members
      if (!newVal) {
        const members = techs.filter(t=>t.team_lead_id===tech.id);
        await Promise.all(members.map(m=>sb(`techs?id=eq.${m.id}`,{method:"PATCH",body:JSON.stringify({team_lead_id:null}),prefer:"return=minimal"})));
      }
      await refreshAll();
      showToast(newVal?`✅ ${tech.name} is now a Team Lead`:`${tech.name} removed as Team Lead`);
    } catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function assignTeamMember(member, leadId) {
    setSaving(true);
    try {
      await sb(`techs?id=eq.${member.id}`,{method:"PATCH",body:JSON.stringify({team_lead_id:leadId||null}),prefer:"return=minimal"});
      await refreshAll();
      showToast(leadId?`✅ ${member.name} added to team`:`${member.name} removed from team`);
    } catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }
  async function saveReviews() {
    const mk=getMonthKey(); setSaving(true);
    try {
      for (const t of techs) { const val=parseInt(reviewForm[t.id]); if(isNaN(val)||val<=0)continue; const existing=await sb(`reviews?tech_id=eq.${t.id}&month_key=eq.${mk}&select=id`); if(existing&&existing.length>0)await sb(`reviews?id=eq.${existing[0].id}`,{method:"PATCH",body:JSON.stringify({count:val}),prefer:"return=minimal"}); else await sb("reviews",{method:"POST",body:JSON.stringify({tech_id:t.id,month_key:mk,count:val})}); }
      await refreshAll(); showToast("✅ Reviews saved!"); setReviewForm({});
    } catch(e){ showToast("Error: "+e.message,false); }
    setSaving(false);
  }

  const wk=getWeekKey(), mk=getMonthKey();
  const wkUp={}; upsells.filter(u=>u.week_key===wk).forEach(u=>{wkUp[u.tech_id]=u.amount;});
  const mkRev={}; reviews.filter(r=>r.month_key===mk).forEach(r=>{mkRev[r.tech_id]=r.count;});

  const inp={ background:C.white, border:`1px solid ${C.border}`, color:C.black, padding:"10px 14px", borderRadius:"10px", fontSize:"14px", fontFamily:FONT, width:"100%", boxSizing:"border-box" };
  const sel=(val)=>({...inp, color:val?C.black:C.muted});
  const btn=(color)=>({ background:saving?C.border:color||C.blue, border:"none", color:C.white, padding:"13px", borderRadius:"24px", cursor:saving?"not-allowed":"pointer", fontSize:"13px", fontWeight:"700", fontStyle:"normal", letterSpacing:"-0.01em", fontFamily:FONT, width:"100%", textTransform:"none" });

  const adminNavSections = [
    { label:"Analytics", items:[
      ["reports","📊","Reports"],
      ["leaderboard","🏆","Leaderboard"],
      ["operations","📈","Operations Progress"],
    ]},
    { label:"Payroll & Time", items:[
      ["payroll","💵","Payroll"],
      ["timesheet","🕒","Time Sheet"],
      ["tips","💵","Log Tips"],
      ["schedule","🗓","Work Schedule"],
      ["trucks","🚚","Trucks"],
    ]},
    { label:"Team Activity", items:[
      ["upsells","💰","Upsells"],
      ["reviews","⭐","Reviews"],
      ["switchovers","🔄","Switchovers"],
      ["callbacks","📞","Callbacks"],
      ["ridealong","🚗","Ride-Alongs"],
      ["forms","📝","Forms"],
    ]},
    { label:"Tech Scores", items:[
      ["scoresoverview","📊","Overview"],
      ["totechecks","🧰","Tote Checks"],
      ["auditscores","📋","Audit Scores"],
      ["driving","🚗","Driving Scores"],
      ["truckinspections","🚚","Truck Inspections"],
    ]},
    { label:"Journey", items:[
      ["journey","🗺️","Journey Map"],
      ["incentive","🎁","Rewards"],
      ["award","🥇","Award Badge"],
    ]},
    { label:"HCP Sync", items:[
      ["splits","✂️", pendingSplits.length > 0 ? `Split Jobs (${new Set(pendingSplits.map(r=>r.hcp_job_id)).size})` : "Split Jobs"],
      ["upsellaudit","🔍","Upsell Audit"],
      ["techmatch","🔗", unmatchedTechs.length > 0 ? `Tech Matching (${unmatchedTechs.length})` : "Tech Matching"],
    ]},
    ...(isManager || !GROWTH_TABS_ON ? [] : [{ label:"Growth", items:[
      ["marketing","📣","Marketing"],
      ["sales","🤝","Sales"],
    ]}]),
    { label:"Development", items:[
      ["training","🎓","Detail Apprentice Training"],
      ["development","📋","Development"],
    ]},
    { label:"Management", items:[
      ["add","➕","Add Tech"],
      ["manage","✏️","Manage"],
      ["teams","👥","Teams"],
      ["quota","📋","Quota"],
      ["delete","🗑️","Delete Tech"],
    ]},
  ];

  const adminTabLabel = adminNavSections.flatMap(s=>s.items).find(([id])=>id===tab)?.[2] || "Dashboard";

  return (
    <div style={{ minHeight:"100vh", background:"#f5f5f7" }}>
      <style>{GS}</style>
      <SideNav sections={adminNavSections} active={tab} setActive={setTab} open={menuOpen} onClose={()=>setMenuOpen(false)} name="Admin Panel" role="Skylo Standard Board"/>
      <Header left={<HamburgerBtn onClick={()=>setMenuOpen(true)}/>} title={adminTabLabel} right={<LogoutBtn onLogout={onLogout}/>}/>
      <div style={{ padding:"20px", maxWidth:(tab==="marketing"||tab==="sales") ? "1280px" : "700px", margin:"0 auto" }}>

        {pendingSplits.length > 0 && tab !== "splits" && (()=>{
          const count = new Set(pendingSplits.map(r => r.hcp_job_id)).size;
          return (
            <div style={{ background:C.blueLt, border:"1px solid rgba(0,146,249,0.25)", borderRadius:"16px", padding:"12px 16px", marginBottom:"16px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:"12px" }}>
              <div>
                <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"14px", color:"#0077d4", letterSpacing:"-0.01em" }}>
                  ⚠ {count} job{count !== 1 ? "s" : ""} need split confirmation
                </div>
                <div style={{ fontSize:"12px", color:C.muted, marginTop:"2px" }}>
                  Revenue and upsell splits may be incorrect until reviewed.
                </div>
              </div>
              <button
                onClick={() => setTab("splits")}
                style={{ background:"#0077d4", border:"none", color:C.white, padding:"8px 18px", borderRadius:"10px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"12px", letterSpacing:"-0.01em", textTransform:"none", whiteSpace:"nowrap", flexShrink:0 }}
              >Review Now</button>
            </div>
          );
        })()}

        {unmatchedTechs.length > 0 && tab !== "techmatch" && (
          <div style={{ background:"rgba(0,0,0,0.06)", border:"1px solid #ef4444", borderRadius:"12px", padding:"12px 16px", marginBottom:"16px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:"12px" }}>
            <div>
              <div style={{ fontFamily:FONT, fontWeight:"700", fontSize:"14px", color:"#ff3b30", letterSpacing:"-0.01em" }}>
                ⚠ {unmatchedTechs.length} HCP name{unmatchedTechs.length !== 1 ? "s" : ""} not matched to a tech
              </div>
              <div style={{ fontSize:"12px", color:C.muted, marginTop:"2px" }}>
                Their revenue, tips, and upsells are being silently skipped until this is fixed.
              </div>
            </div>
            <button
              onClick={() => setTab("techmatch")}
              style={{ background:"#ff3b30", border:"none", color:"#fff", padding:"8px 18px", borderRadius:"10px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"12px", letterSpacing:"-0.01em", textTransform:"none", whiteSpace:"nowrap", flexShrink:0 }}
            >Review Now</button>
          </div>
        )}

        {tab==="splits"&&(
          <SplitJobsAdmin techs={techs} pendingSplits={pendingSplits} refreshAll={refreshAll} showToast={showToast}/>
        )}

        {tab==="trucks"&&(
          <TrucksAdminTab techs={techs} vehicles={vehicles} timeEntries={timeEntries} token={currentUser?.token} refreshAll={refreshAll} showToast={showToast}/>
        )}

        {tab==="forms"&&(
          <FormsTab me={isManager ? techs.find(t => t.id===currentUser?.techId) || null : null} role={isManager ? "manager" : "owner"}/>
        )}

        {[["scoresoverview","overview"],["totechecks","tote"],["auditscores","audit"],["driving","driver"]].map(([id, view]) => tab===id && (
          <AuditScoresTab key={id} view={view} hideTabs techs={techs} token={currentUser?.token} canSync={!isManager} jobs={jobs||[]} callbacks={callbacks||[]} reviews={reviews||[]} switchovers={switchovers||[]} quota={quota}/>
        ))}
        {tab==="truckinspections"&&(
          <TruckInspectionsTab techs={techs} jobs={jobs||[]} token={currentUser?.token} canGrade showToast={showToast}/>
        )}

        {tab==="upsellaudit"&&(
          <UpsellAuditTab techs={techs} upsells={upsells} jobs={jobs}/>
        )}

        {tab==="techmatch"&&(
          <TechMatchAdmin unmatchedTechs={unmatchedTechs} refreshAll={refreshAll} showToast={showToast}/>
        )}

        {tab==="marketing"&&!isManager&&GROWTH_TABS_ON&&<MarketingTab token={currentUser?.token}/>}
        {tab==="sales"&&!isManager&&GROWTH_TABS_ON&&<SalesTab token={currentUser?.token}/>}
        {tab==="training"&&<TrainingOverviewTab techs={techs} currentUser={currentUser} refreshAll={refreshAll}/>}

        {tab==="development"&&(
          <DevelopmentTab techs={techs} rideAlongs={rideAlongs||[]} refreshAll={refreshAll} showToast={showToast}/>
        )}

        {tab==="upsells"&&(
          <AdminUpsellEntry techs={techs} refreshAll={refreshAll} showToast={showToast} upsells={upsells} jobs={jobs||[]}/>
        )}

        {tab==="reviews"&&(
          <AdminReviewEntry techs={techs} reviews={reviews} saving={saving} setSaving={setSaving} refreshAll={refreshAll} showToast={showToast}/>
        )}
        {tab==="switchovers"&&(() => {
          const { start: swStart, end: swEnd } = getDateRangeBounds(swRangePreset, swCStart, swCEnd);
          const swFromWk = dateToWeekKey(swStart);
          const swInRange = switchovers.filter(s => s.week_key >= swFromWk && s.week_key <= swEnd);
          const swByTech = {};
          swInRange.forEach(s => {
            if (!swByTech[s.tech_id]) swByTech[s.tech_id] = { total: 0, byPlan: {} };
            swByTech[s.tech_id].total++;
            swByTech[s.tech_id].byPlan[s.plan_id] = (swByTech[s.tech_id].byPlan[s.plan_id] || 0) + 1;
          });
          const swRanked = techs
            .map(t => ({ ...t, total: swByTech[t.id]?.total || 0, byPlan: swByTech[t.id]?.byPlan || {} }))
            .filter(t => t.total > 0)
            .sort((a, b) => b.total - a.total);
          return (
            <>
              <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
              <PageTools tools={[{ id:"log", label:"Log Switchover", icon:"＋", primary:true, render:()=>(
                <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
                  <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"16px", color:C.black }}>Log a Switchover</div>
            <div style={{ background:C.cardLt, borderRadius:"10px", padding:"8px 12px", fontSize:"12px", color:C.muted }}>
              {formatLastEntered(mostRecentTimestamp(switchovers)) ? (
                <>Last entered: <strong style={{ color:C.black }}>{formatLastEntered(mostRecentTimestamp(switchovers))}</strong> — everything before that is already logged.</>
              ) : "No switchovers logged yet."}
            </div>
            <select value={swForm.techId} onChange={e=>setSwForm(f=>({...f,techId:e.target.value}))} style={sel(swForm.techId)}>
              <option value="">— Select Tech —</option>
              {techs.filter(t=>t.is_active!==false).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={swForm.planId} onChange={e=>setSwForm(f=>({...f,planId:e.target.value}))} style={sel(swForm.planId)}>
              <option value="">— Select Plan —</option>
              {SERVICE_PLANS.map(p=><option key={p.id} value={p.id}>{p.label} ({p.freq}) · +{p.pts}pts · ${p.ltv.toLocaleString()}/yr LTV</option>)}
            </select>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
              {[[false,"Interior only"],[true,"Interior + Exterior"]].map(([ext,label])=>{
                const on = swForm.exterior===ext;
                return <button key={label} onClick={()=>setSwForm(f=>({...f,exterior:ext}))} style={{ background:on?C.purple:C.cardLt, border:`1px solid ${on?C.purple:C.border}`, color:on?C.white:C.black, padding:"10px", borderRadius:"10px", cursor:"pointer", fontSize:"13px", fontWeight:"700" }}>{label}</button>;
              })}
            </div>
            {swForm.planId&&swForm.exterior!==null&&SWITCHOVER_PAY[swForm.planId]!=null&&(
              <div style={{ fontSize:"12px", color:C.muted }}>Pays ${switchoverPay({plan_id:swForm.planId,with_exterior:swForm.exterior})} · counts today ({fmtShortDate(mtDateStr(Date.now()))}) on payroll</div>
            )}
            <button onClick={logSwitchover} disabled={saving} style={btn(C.purple)}>{saving?"Saving...":"Log Switchover"}</button>
                </div>
              )}]}/>
              <DateRangePicker label="📅 Date Range" preset={swRangePreset} setPreset={setSwRangePreset} customStart={swCStart} setCustomStart={setSwCStart} customEnd={swCEnd} setCustomEnd={setSwCEnd}>
                <div style={{ fontSize:"12px", color:C.muted, marginTop:"8px" }}>{fmtShortDate(swStart)} – {fmtShortDate(swEnd)} · switchovers are matched by week</div>
              </DateRangePicker>
              <ListTitle right={`${swRanked.reduce((s,t)=>s+t.total,0)} team total`}>Switchovers</ListTitle>
              <RankRows rows={swRanked.map(t=>({ id:t.id, name:t.name, value:`${t.total}`, sub:Object.entries(t.byPlan).sort((a,b)=>b[1]-a[1]).map(([planId,count])=>`${count} ${PLAN_MAP[planId]?.label||planId}`).join(", ") }))} empty="No switchovers logged in this range."/>
              </div>

              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", overflow:"hidden", marginTop:"16px" }}>
                <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}`, background:C.cardLt }}>
                  <Label>Individual Entries · {fmtShortDate(swStart)} – {fmtShortDate(swEnd)}</Label>
                </div>
                <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"6px" }}>
                  {swInRange.length===0 && <div style={{ fontSize:"13px", color:C.muted }}>No switchover entries in this range.</div>}
                  {[...swInRange].sort((a,b)=>b.week_key.localeCompare(a.week_key)).map(s=>{
                    const tech=techs.find(t=>t.id===s.tech_id);
                    const plan=PLAN_MAP[s.plan_id];
                    const pc=PLAN_COLORS[s.plan_id]||C.muted;
                    return (
                      <div key={s.id} style={{ background:C.cardLt, borderRadius:"10px", padding:"10px 12px" }}>
                        {editingSwId===s.id ? (
                          <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                            <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"14px", color:C.black }}>{tech?.name}</div>
                            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
                              <div>
                                <div style={{ fontSize:"11px", color:C.muted, marginBottom:"4px" }}>Date sold</div>
                                <input type="date" value={editSwForm.date} onChange={e=>setEditSwForm(f=>({...f,date:e.target.value}))} style={{ background:C.card, border:`1px solid ${C.border}`, color:C.black, padding:"8px", borderRadius:"10px", fontSize:"13px", width:"100%", boxSizing:"border-box" }}/>
                              </div>
                              <div>
                                <div style={{ fontSize:"11px", color:C.muted, marginBottom:"4px" }}>Plan</div>
                                <select value={editSwForm.planId} onChange={e=>setEditSwForm(f=>({...f,planId:e.target.value}))} style={{ background:C.card, border:`1px solid ${C.border}`, color:C.black, padding:"8px", borderRadius:"10px", fontSize:"13px", width:"100%", boxSizing:"border-box" }}>
                                  {SERVICE_PLANS.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}
                                </select>
                              </div>
                            </div>
                            <label style={{ display:"flex", alignItems:"center", gap:"6px", fontSize:"13px", color:C.black, cursor:"pointer" }}>
                              <input type="checkbox" checked={!!editSwForm.exterior} onChange={e=>setEditSwForm(f=>({...f,exterior:e.target.checked}))} style={{ width:"16px", height:"16px" }}/>
                              Added exterior (+${SWITCHOVER_EXTERIOR_PAY})
                            </label>
                            <div style={{ fontSize:"11px", color:C.muted }}>Will be attributed to the week of {formatWeekLabel(dateToWeekKey(editSwForm.date||s.week_key))}</div>
                            <div style={{ display:"flex", gap:"8px" }}>
                              <button onClick={saveEditSwitchover} disabled={saving} style={{ flex:1, background:C.purple, border:"none", color:C.white, padding:"8px", borderRadius:"10px", cursor:"pointer", fontWeight:"700", fontSize:"12px" }}>Save</button>
                              <button onClick={()=>setEditingSwId(null)} style={{ background:"none", border:`1px solid ${C.border}`, color:C.muted, padding:"8px 14px", borderRadius:"10px", cursor:"pointer", fontSize:"12px" }}>Cancel</button>
                              <button onClick={()=>deleteSwitchoverEntry(s.id)} style={{ background:"none", border:"1px solid #ef4444", color:"#ff3b30", padding:"8px 14px", borderRadius:"10px", cursor:"pointer", fontSize:"12px" }}>Delete</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px" }}>
                            <div>
                              <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"15px", color:C.black }}>{tech?.name}</div>
                              <div style={{ fontSize:"12px", color:C.muted }}>{s.sold_date ? fmtShortDate(s.sold_date) : formatWeekLabel(s.week_key)} · <span style={{ color:pc, fontWeight:"700" }}>{plan?.label||s.plan_id}{s.with_exterior?" + Ext":""} · +{plan?.pts||0}pts</span></div>
                            </div>
                            <button onClick={()=>startEditSwitchover(s)} style={{ background:"none", border:`1px solid ${C.border}`, color:C.purple, padding:"4px 10px", borderRadius:"8px", cursor:"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"11px", flexShrink:0 }}>Edit</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          );
        })()}

        {tab==="timesheet"&&(
          <AdminTimeSheetTab techs={techs} timeEntries={timeEntries} refreshAll={refreshAll} showToast={showToast} lockedTechId={isManager ? currentUser?.techId : null}/>
        )}

        {tab==="tips"&&(
          <AdminTipEntry techs={techs} tipEntries={tipEntries} refreshAll={refreshAll} showToast={showToast}/>
        )}

        {tab==="callbacks"&&<CallbacksPanel techs={techs} jobs={jobs} callbacks={callbacks} refreshAll={refreshAll} showToast={showToast}/>}

        {tab==="award"&&(
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"20px", display:"flex", flexDirection:"column", gap:"12px" }}>
            <Label color={C.blue}>Award a Badge</Label>
            <select value={awardForm.techId} onChange={e=>setAwardForm(f=>({...f,techId:e.target.value}))} style={sel(awardForm.techId)}>
              <option value="">— Select Tech —</option>
              {techs.filter(t=>t.is_active!==false).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={awardForm.badgeId} onChange={e=>setAwardForm(f=>({...f,badgeId:e.target.value}))} style={sel(awardForm.badgeId)}>
              <option value="">— Select Badge —</option>
              {ALL_BADGE_DEFS.map(b=><option key={b.id} value={b.id}>{b.icon} {b.name} ({b.pts>0?`+${b.pts} pts`:"Trophy"})</option>)}
            </select>
            <button onClick={awardBadge} disabled={saving} style={btn(C.blue)}>{saving?"Saving...":"Award Badge"}</button>
          </div>
        )}

        {tab==="add"&&(
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"20px", display:"flex", flexDirection:"column", gap:"12px" }}>
            <Label color={C.green}>Add New Tech</Label>
            <input placeholder="Full Name" value={addForm.name} onChange={e=>setAddForm(f=>({...f,name:e.target.value}))} style={inp}/>
            <input placeholder="4-Digit PIN" value={addForm.pin} maxLength={4} onChange={e=>setAddForm(f=>({...f,pin:e.target.value.replace(/\D/g,"")}))} style={inp}/>
            <input placeholder="Initials (optional)" value={addForm.avatar} maxLength={2} onChange={e=>setAddForm(f=>({...f,avatar:e.target.value.toUpperCase()}))} style={inp}/>
            <div>
              <div style={{ fontSize:"12px", color:C.muted, marginBottom:"6px" }}>Start Date</div>
              <input type="date" value={addForm.start_date} onChange={e=>setAddForm(f=>({...f,start_date:e.target.value}))} style={inp}/>
            </div>
            <div>
              <div style={{ fontSize:"12px", color:C.muted, marginBottom:"6px" }}>Title</div>
              <select value={addForm.title||"detail_apprentice"} onChange={e=>setAddForm(f=>({...f,title:e.target.value}))} style={inp}>
                {Object.entries(TITLE_LABELS).map(([val,label])=><option key={val} value={val}>{label}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize:"12px", color:C.muted, marginBottom:"6px" }}>Commission Rate</div>
              <select value={addForm.commission_rate} onChange={e=>setAddForm(f=>({...f,commission_rate:e.target.value}))} style={inp}>
                {[27,28,29,30,31,32].map(p=><option key={p} value={p}>{p}%</option>)}
              </select>
            </div>
            <button onClick={addTech} disabled={saving} style={btn(C.green)}>{saving?"Saving...":"Add Tech"}</button>
          </div>
        )}

        {tab==="manage"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
            {techs.filter(t=>t.is_active!==false).map(t=>(
              <div key={t.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"16px 18px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"10px" }}>
                  <div style={{ display:"flex", flexDirection:"column", gap:"2px" }}>
                    <input
                      defaultValue={t.name}
                      onBlur={async e=>{
                        const val = e.target.value.trim();
                        if (!val || val===t.name) return;
                        await sb(`techs?id=eq.${t.id}`,{method:"PATCH",body:JSON.stringify({name:val}),prefer:"return=minimal"});
                        await refreshAll();
                        showToast(`✅ Name updated to ${val}`);
                      }}
                      style={{ fontFamily:FONT, fontWeight:"600", fontSize:"17px", color:C.black, background:"transparent", border:"none", borderBottom:`1px dashed ${C.border}`, padding:"2px 4px", width:"200px", cursor:"text" }}
                    />
                    <span style={{ fontSize:"11px", color:C.purple, fontFamily:FONT, fontWeight:"700", paddingLeft:"4px" }}>{TITLE_LABELS[t.title] || "Detail Apprentice"}</span>
                  </div>
                  {!isManager&&t.title!=="owner"&&<button onClick={()=>changePin(t)} disabled={saving} style={{ background:"none", border:`1px solid ${C.border}`, color:C.muted, padding:"3px 10px", borderRadius:"10px", cursor:"pointer", fontSize:"11px", fontFamily:FONT, fontWeight:"700" }}>🔒 Change PIN</button>}
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"10px" }}>
                  <span style={{ fontSize:"12px", color:C.muted }}>Start date:</span>
                  <input type="date" defaultValue={t.start_date||""} disabled={isManager&&!!t.start_date} onBlur={e=>updateStartDate(t.id,e.target.value)} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"4px 8px", borderRadius:"8px", fontSize:"12px", fontFamily:FONT }}/>
                  {t.start_date&&<span style={{ fontSize:"12px", color:C.blue, fontFamily:FONT, fontWeight:"700" }}>{formatTenure(t.start_date)}</span>}
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"10px" }}>
                  <span style={{ fontSize:"12px", color:C.muted }}>Title:</span>
                  <select defaultValue={t.title||"detail_apprentice"} disabled={isManager&&OPS_EXCLUDED_TITLES.includes(t.title)}
                    onChange={async e=>{
                      await sb(`techs?id=eq.${t.id}`,{method:"PATCH",body:JSON.stringify({title:e.target.value}),prefer:"return=minimal"});
                      await refreshAll(); showToast(`✅ Title saved for ${t.name}`);
                    }}
                    style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.purple, padding:"4px 8px", borderRadius:"8px", fontSize:"13px", fontFamily:FONT, fontWeight:"700", cursor:"pointer" }}>
                    {Object.entries(TITLE_LABELS).filter(([val])=>!isManager||val===t.title||!OPS_EXCLUDED_TITLES.includes(val)).map(([val,label])=><option key={val} value={val}>{label}</option>)}
                  </select>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"10px" }}>
                  <span style={{ fontSize:"12px", color:C.muted }}>Commission rate:</span>
                  <select defaultValue={t.commission_rate||27}
                    onChange={async e=>{
                      const val=parseInt(e.target.value);
                      await sb(`techs?id=eq.${t.id}`,{method:"PATCH",body:JSON.stringify({commission_rate:val}),prefer:"return=minimal"});
                      await refreshAll(); showToast(`✅ Rate saved for ${t.name}`);
                    }}
                    style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.black, padding:"4px 8px", borderRadius:"8px", fontSize:"14px", fontFamily:FONT, fontWeight:"700", cursor:"pointer" }}>
                    {[27,28,29,30,31,32].map(p=><option key={p} value={p}>{p}%</option>)}
                  </select>
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:"5px" }}>
                  {t.badges.map(bid=>{ const b=BADGE_MAP[bid]; return b?(
                    <span key={bid} style={{ background:`${C.blue}18`, border:`1px solid ${C.blue}44`, borderRadius:"3px", padding:"3px 8px", fontSize:"12px", display:"inline-flex", alignItems:"center", gap:"4px" }}>
                      <span>{b.icon}</span><span style={{ color:C.black, fontFamily:FONT, fontWeight:"700" }}>{b.name}</span>
                      <button onClick={()=>revokeBadge(t.id,bid)} style={{ background:"none", border:"none", color:"#ff4444", cursor:"pointer", fontSize:"13px", lineHeight:1, padding:"0 0 0 2px" }}>×</button>
                    </span>
                  ):null; })}
                </div>
                <label style={{ display:"flex", alignItems:"center", gap:"8px", marginTop:"10px", fontSize:"12px", color:C.black, cursor:isManager?"not-allowed":"pointer" }}>
                  <input type="checkbox" checked={!!t.on_leave} disabled={isManager||saving}
                    onChange={async e=>{
                      await sb(`techs?id=eq.${t.id}`,{method:"PATCH",body:JSON.stringify({on_leave:e.target.checked}),prefer:"return=minimal"});
                      await refreshAll(); showToast(e.target.checked?`${t.name} marked on leave`:`${t.name} back from leave`);
                    }}/>
                  On leave (injury, etc.) — not counted for staffing or quota while checked{isManager?" · owner only":""}
                </label>
                <div style={{ marginTop:"12px", paddingTop:"12px", borderTop:`1px solid ${C.border}` }}>
                  {archivingId!==t.id ? (
                    <button onClick={()=>startArchive(t)} disabled={saving} style={{ background:"none", border:"1px solid #0077d4", color:"#0077d4", padding:"7px 16px", borderRadius:"10px", cursor:saving?"not-allowed":"pointer", fontFamily:FONT, fontWeight:"600", fontSize:"12px", letterSpacing:"-0.01em", textTransform:"none" }}>
                      📦 Archive {t.name}
                    </button>
                  ) : (
                    <div style={{ background:"#fff8e6", border:"1px solid #f59e0b44", borderRadius:"12px", padding:"12px", display:"flex", flexDirection:"column", gap:"10px" }}>
                      <div style={{ fontSize:"12px", color:C.black }}>Archiving removes {t.name} from the leaderboard. Their revenue and job history stay in the system.</div>
                      <div style={{ display:"flex", alignItems:"center", gap:"10px", flexWrap:"wrap" }}>
                        <span style={{ fontSize:"12px", color:C.muted }}>Last day:</span>
                        <input type="date" value={archiveForm.left_date} onChange={e=>setArchiveForm(f=>({...f,left_date:e.target.value}))} style={{ background:C.white, border:`1px solid ${C.border}`, color:C.black, padding:"4px 8px", borderRadius:"8px", fontSize:"12px", fontFamily:FONT }}/>
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
                        <span style={{ fontSize:"12px", color:C.muted }}>Why did they leave?</span>
                        {LEAVE_REASONS.map(r=>(
                          <label key={r.value} style={{ display:"flex", alignItems:"center", gap:"8px", fontSize:"13px", color:C.black, cursor:"pointer" }}>
                            <input type="radio" name={`leave-${t.id}`} checked={archiveForm.leave_reason===r.value} onChange={()=>setArchiveForm(f=>({...f,leave_reason:r.value}))}/>
                            {r.label}
                          </label>
                        ))}
                      </div>
                      {archiveForm.leave_reason==="fired"&&(
                        <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
                          <span style={{ fontSize:"12px", color:C.muted }}>Reason for firing (an admin has to approve it before it stops counting against the ops bonus):</span>
                          <select value={archiveForm.fire_category} onChange={e=>setArchiveForm(f=>({...f,fire_category:e.target.value}))} style={{ background:C.white, border:`1px solid ${C.border}`, color:C.black, padding:"6px 8px", borderRadius:"8px", fontSize:"13px" }}>
                            <option value="">Pick one…</option>
                            {FIRE_CATEGORIES.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}
                          </select>
                          <textarea value={archiveForm.fire_notes} onChange={e=>setArchiveForm(f=>({...f,fire_notes:e.target.value}))} placeholder="What happened? Production numbers, which policy, etc." rows={3} style={{ background:C.white, border:`1px solid ${C.border}`, color:C.black, padding:"6px 8px", borderRadius:"8px", fontSize:"13px", fontFamily:"inherit" }}/>
                        </div>
                      )}
                      <div style={{ display:"flex", gap:"8px" }}>
                        <button onClick={()=>archiveTech(t)} disabled={saving} style={{ background:"#0077d4", border:"none", color:C.white, padding:"7px 16px", borderRadius:"10px", cursor:saving?"not-allowed":"pointer", fontFamily:FONT, fontWeight:"600", fontSize:"12px", letterSpacing:"-0.01em", textTransform:"none" }}>
                          {saving?"Saving...":`Archive ${t.name}`}
                        </button>
                        <button onClick={()=>setArchivingId(null)} disabled={saving} style={{ background:"none", border:`1px solid ${C.border}`, color:C.muted, padding:"7px 16px", borderRadius:"10px", cursor:"pointer", fontFamily:FONT, fontWeight:"600", fontSize:"12px", letterSpacing:"-0.01em", textTransform:"none" }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {/* Archived techs */}
            {techs.filter(t=>t.is_active===false).length>0&&(
              <div style={{ background:"#fff8e6", border:"1px solid #f59e0b44", borderTop:"3px solid #f59e0b", borderRadius:"16px", padding:"16px 18px" }}>
                <div style={{ fontSize:"11px", color:"#0077d4", letterSpacing:"-0.01em", textTransform:"none", fontFamily:FONT, fontWeight:"600", marginBottom:"12px" }}>📦 Archived Techs — Revenue still counted in totals</div>
                <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                  {techs.filter(t=>t.is_active===false).map(t=>(
                    <div key={t.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:"#fff", border:"1px solid #f59e0b33", borderRadius:"10px", padding:"10px 14px" }}>
                      <div>
                        <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"15px", color:C.muted }}>{t.name}</div>
                        <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"-0.01em" }}>
                          ARCHIVED · NOT ON LEADERBOARD
                          {t.left_date&&` · LEFT ${fmtShortDate(t.left_date).toUpperCase()}`}
                          {t.leave_reason&&` · ${(LEAVE_REASONS.find(r=>r.value===t.leave_reason)?.short||"").toUpperCase()}`}
                        </div>
                        {t.leave_reason==="fired"&&(
                          <div style={{ fontSize:"11px", color:C.black, marginTop:"4px" }}>
                            <strong>{FIRE_CATEGORIES.find(c=>c.value===t.fire_category)?.label||"No reason given"}</strong>{t.fire_notes&&` — ${t.fire_notes}`}
                            <div style={{ fontSize:"11px", fontWeight:"700", marginTop:"2px", color:t.fire_approval==="approved"?C.green:t.fire_approval==="denied"?"#ff3b30":"#0077d4" }}>
                              {t.fire_approval==="approved"?"✅ FIRING APPROVED — doesn't count against the ops bonus":t.fire_approval==="denied"?"❌ FIRING DENIED — counts as a loss":"⏳ WAITING FOR ADMIN APPROVAL"}
                            </div>
                            {t.fire_approval==="pending"&&!isManager&&(
                              <div style={{ display:"flex", gap:"6px", marginTop:"6px" }}>
                                <button onClick={()=>reviewFiring(t,"approved")} disabled={saving} style={{ background:C.green, border:"none", color:C.white, padding:"4px 10px", borderRadius:"10px", cursor:"pointer", fontSize:"11px", fontWeight:"600" }}>Approve</button>
                                <button onClick={()=>reviewFiring(t,"denied")} disabled={saving} style={{ background:"#ff3b30", border:"none", color:C.white, padding:"4px 10px", borderRadius:"10px", cursor:"pointer", fontSize:"11px", fontWeight:"600" }}>Deny</button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <button onClick={()=>reactivateTech(t)} disabled={saving} style={{ background:"none", border:"1px solid #00c853", color:"#34c759", padding:"6px 14px", borderRadius:"10px", cursor:"pointer", fontFamily:FONT, fontWeight:"600", fontSize:"11px", letterSpacing:"-0.01em" }}>
                        Reactivate
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}


        {tab==="teams"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
            <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:"16px", padding:"20px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
              <Label color={C.gold}>👥 Team Lead Assignments</Label>
              <div style={{ fontSize:"13px", color:C.muted, marginBottom:"16px" }}>Mark techs as team leads and assign members to their team. Teams can be changed anytime.</div>
              <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
                {techs.map(t=>(
                  <div key={t.id} style={{ background:C.cardLt, border:`1px solid ${t.is_lead?C.gold:C.border}`, borderLeft:`3px solid ${t.is_lead?C.gold:C.border}`, borderRadius:"12px", padding:"12px 14px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"8px" }}>
                      <div style={{ fontFamily:FONT, fontWeight:"700", fontStyle:"normal", fontSize:"16px", color:C.black }}>
                        {t.name}
                        {t.is_lead&&<span style={{ marginLeft:"8px", background:C.gold, color:C.white, fontSize:"11px", padding:"2px 8px", borderRadius:"10px", fontFamily:FONT, fontWeight:"700", verticalAlign:"middle" }}>Team lead</span>}
                      </div>
                      <button onClick={()=>toggleTeamLead(t)} disabled={saving}
                        style={{ background:t.is_lead?"#ef444422":"transparent", border:`1px solid ${t.is_lead?"#ff3b30":C.gold}`, color:t.is_lead?"#ff3b30":C.gold, padding:"5px 14px", borderRadius:"20px", cursor:"pointer", fontFamily:FONT, fontWeight:"600", fontSize:"11px", letterSpacing:"-0.01em" }}>
                        {t.is_lead?"Remove Lead":"Make Lead"}
                      </button>
                    </div>
                    {t.is_lead&&(
                      <div>
                        <div style={{ fontSize:"11px", color:C.muted, marginBottom:"6px", fontFamily:FONT, fontWeight:"700" }}>Team name</div>
                        <div style={{ display:"flex", gap:"8px", marginBottom:"10px" }}>
                          <input
                            placeholder="e.g. Team Maverick"
                            defaultValue={t.team_name||""}
                            onBlur={async e=>{
                              const val = e.target.value.trim();
                              if (val === (t.team_name||"")) return;
                              await sb(`techs?id=eq.${t.id}`,{method:"PATCH",body:JSON.stringify({team_name:val||null}),prefer:"return=minimal"});
                              await refreshAll();
                              showToast(`✅ Team name saved!`);
                            }}
                            style={{ flex:1, background:C.white, border:`1px solid ${C.border}`, color:C.black, padding:"8px 12px", borderRadius:"10px", fontSize:"14px", fontFamily:FONT, fontWeight:"700" }}
                          />
                        </div>
                        <div style={{ fontSize:"11px", color:C.muted, marginBottom:"6px", fontFamily:FONT, fontWeight:"700" }}>Team members</div>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
                          {techs.filter(m=>m.id!==t.id).map(m=>{
                            const onTeam = m.team_lead_id===t.id;
                            const onOtherTeam = m.team_lead_id && m.team_lead_id!==t.id;
                            const otherLead = techs.find(x=>x.id===m.team_lead_id);
                            return (
                              <button key={m.id} onClick={()=>assignTeamMember(m,onTeam?null:t.id)} disabled={saving||m.is_lead}
                                style={{ background:onTeam?`${C.gold}20`:"transparent", border:`1px solid ${onTeam?C.gold:C.border}`, color:onTeam?C.gold:C.muted, padding:"4px 12px", borderRadius:"16px", cursor:m.is_lead?"not-allowed":"pointer", fontFamily:FONT, fontWeight:"700", fontSize:"11px", opacity:m.is_lead?0.4:1 }}>
                                {onTeam?"✓ ":""}{m.name}{onOtherTeam?` (${otherLead?.name}'s team)`:""}
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ fontSize:"11px", color:C.muted, marginTop:"6px" }}>Tap to add/remove. Can't add other leads.</div>
                      </div>
                    )}
                    {!t.is_lead&&t.team_lead_id&&(
                      <div style={{ fontSize:"11px", color:C.muted }}>
                        On {techs.find(x=>x.id===t.team_lead_id)?.name}'s team
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab==="delete"&&(
          <DeleteTab techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews} saving={saving} setSaving={setSaving} refreshAll={refreshAll} showToast={showToast}/>
        )}
        {tab==="journey"&&(
          <div>
            <div style={{ fontSize:"13px", color:C.muted, marginBottom:"16px" }}>Tap any card to expand full breakdown.</div>
            <JourneyBoard techs={activeTechs} upsells={upsells} switchovers={switchovers} reviews={reviews} quota={quota} callbacks={callbacks||[]} jobs={jobs}/>
          </div>
        )}
        {tab==="operations"&&(
          <OperationsProgressTab techs={techs} switchovers={switchovers} reviews={reviews} quota={quota} callbacks={callbacks||[]} jobs={jobs||[]} isManager={isManager}/>
        )}
        {tab==="schedule"&&(
          <WorkScheduleTab techs={techs} showToast={showToast}/>
        )}
        {tab==="quota"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
            <QuotaSettings quota={quota} onSave={saveQuota} saving={saving} readOnly={isManager}/>
            <StaffingSettings showToast={showToast} readOnly={isManager}/>
          </div>
        )}
        {tab==="incentive"&&(
          <div>
            <div style={{ fontSize:"13px", color:C.muted, marginBottom:"16px" }}>Team rewards overview — all tiers and prizes.</div>
            <IncentiveBoard techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews} callbacks={callbacks||[]} currentId={null} jobs={jobs}/>
          </div>
        )}

        {tab==="reports"&&(
          <ReportsTab techs={techs} jobs={jobs||[]} upsells={upsells||[]} switchovers={switchovers||[]} timeEntries={timeEntries} tipEntries={tipEntries} techId={null} refreshAll={refreshAll} showToast={showToast} token={currentUser?.token} isOwner={!isManager}/>
        )}
        {tab==="leaderboard"&&(
          <Leaderboard techs={activeTechs} jobs={jobs||[]} upsells={upsells} reviews={reviews} callbacks={callbacks||[]} switchovers={switchovers} timeEntries={timeEntries}/>
        )}
        {tab==="payroll"&&(
          <PayrollTab techs={techs} jobs={jobs||[]} upsells={upsells} tipEntries={tipEntries} switchovers={switchovers||[]} timeEntries={timeEntries||[]} token={currentUser?.token} canWaive={!isManager}/>
        )}

        {tab==="ridealong"&&(
          <RideAlongTab
            techs={techs}
            rideAlongs={rideAlongs||[]}
            schedules={schedules||[]}
            saving={saving}
            onSave={async(data)=>{
              setSaving(true);
              try { await sb("ride_alongs",{method:"POST",body:JSON.stringify(data)}); await refreshAll(); showToast("✅ Ride-along saved!"); }
              catch(e){ showToast("Error: "+e.message,false); }
              setSaving(false);
            }}
            onSaveSchedule={async(date,techId)=>{
              try {
                const existing = await sb(`ride_along_schedule?date=eq.${date}&select=id`);
                if(existing&&existing.length>0) await sb(`ride_along_schedule?id=eq.${existing[0].id}`,{method:"PATCH",body:JSON.stringify({tech_id:techId||null}),prefer:"return=minimal"});
                else if(techId) await sb("ride_along_schedule",{method:"POST",body:JSON.stringify({date,tech_id:techId})});
                await refreshAll();
              } catch(e){ showToast("Error saving schedule: "+e.message,false); }
            }}
          />
        )}

      </div>
      {toast&&(
        <div style={{ position:"fixed", bottom:"24px", left:"50%", transform:"translateX(-50%)", background:toast.ok?C.green:"#ff3b30", color:C.white, padding:"12px 28px", borderRadius:"24px", fontSize:"14px", fontWeight:"700", zIndex:999, whiteSpace:"nowrap", fontFamily:FONT, letterSpacing:"-0.01em", fontStyle:"normal", boxShadow:"0 4px 20px rgba(0,0,0,0.15)" }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [techs, setTechs] = useState([]);
  const [upsells, setUpsells] = useState([]);
  const [switchovers, setSwitchovers] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [callbacks, setCallbacks] = useState([]);
  const [rideAlongs, setRideAlongs] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [tipEntries, setTipEntries] = useState([]);
  const [pendingSplits, setPendingSplits] = useState([]);
  const [unmatchedTechs, setUnmatchedTechs] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [truckAssignments, setTruckAssignments] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(null);

  const [quota, setQuota] = useState(DEFAULT_QUOTA);

  const loadAll = useCallback(async () => {
    try {
      // Truck picks: the last ~4 months (the Trucks tab looks older days up itself).
      const truckSince = mtDateStr(Date.now() - 120*864e5);
      const [t,u,s,r,ra,sch,settings,cb,jb,te,tp,ps,ut,vh,ta] = await Promise.all([
        sb(`techs?select=${TECH_COLUMNS}&order=name`),
        sb("upsells?select=*"),
        sb("switchovers?select=*"),
        sb("reviews?select=*"),
        sb("ride_alongs?select=*&order=date.desc").catch(()=>[]),
        sb("ride_along_schedule?select=*").catch(()=>[]),
        sb("settings?key=eq.quota&select=*").catch(()=>[]),
        sb("callbacks?select=*&order=created_at.desc").catch(()=>[]),
        sbAll("jobs?select=*&order=job_date.desc,id.asc").catch(()=>[]),
        sbAll("time_entries?select=*&order=work_date.desc,id.asc").catch(()=>[]),
        sbAll("tip_entries?select=*&order=work_date.desc,id.asc").catch(()=>[]),
        sb("jobs?split_confirmed=eq.false&select=hcp_job_id,tech_id,job_date,revenue,tips,upsell_amount,customer_name&order=job_date.desc").catch(()=>[]),
        sb("unmatched_hcp_employees?select=*&order=hcp_name").catch(()=>[]),
        sb("vehicles?select=*&order=name").catch(()=>[]),
        sbAll(`truck_assignments?select=*&work_date=gte.${truckSince}&order=work_date.desc,id.asc`).catch(()=>[]),
      ]);
      setTechs(t||[]); setUpsells(u||[]); setSwitchovers(s||[]); setReviews(r||[]);
      setRideAlongs(ra||[]); setSchedules(sch||[]); setCallbacks(cb||[]); setJobs(jb||[]); setTimeEntries(te||[]); setTipEntries(tp||[]);
      setPendingSplits(ps||[]); setUnmatchedTechs(ut||[]); setVehicles(vh||[]); setTruckAssignments(ta||[]);
      if (settings&&settings.length>0) {
        try { setQuota(JSON.parse(settings[0].value)); } catch {}
      }
      return true;
    } catch(e) { setDbError(e.message); return false; }
  }, []);

  useEffect(() => {
    (async()=>{ const ok=await loadAll(); setLoading(false); if(!ok)return; })();
    const interval = setInterval(() => { loadAll(); }, 60_000);
    return () => clearInterval(interval);
  }, [loadAll]);

  // PINs are checked on the server so they never ship to the browser. Owners
  // (OWNER_PINS env var) and the Field Supervisor get the admin panel; the
  // Field Supervisor in manager mode -- see `isManager` in AdminPanel.
  async function handlePin(pin) {
    let res;
    try {
      res = await fetch("/.netlify/functions/auth-login", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ pin }) });
    } catch { return "offline"; }
    if (res.status === 429) return "locked";
    if (!res.ok) return false;
    const u = await res.json().catch(()=>null);
    if (!u) return false;
    if (u.type === "admin") setUser({ type:"admin", role:u.role, techId:u.techId, name:u.name, token:u.token });
    else setUser({ type:"tech", techId:u.techId, token:u.token });
    return true;
  }
  // Feeds TechDashboard's entire `techs` prop -- excluding owner/admin
  // accounts (title:"owner") here means every gamification view a tech sees
  // (Leaderboard, Total Score, Switchovers, Upsells, Reviews, Journey Map,
  // Rewards, Team Rank denominator) never counts them, without needing a
  // separate filter in each of those components.
  const activeTechs = (techs || []).filter(t => t.is_active !== false && t.title !== "owner");
  const currentTech = user?.type==="tech" ? techs?.find(t=>t.id===user.techId) : null;

  if (loading) return (
    <div style={{ minHeight:"100vh", background:"#f5f5f7", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:"16px" }}>
      <style>{GS}</style>
      <Logo h={70}/>
      <div style={{ fontFamily:FONT, fontStyle:"normal", color:C.blue, letterSpacing:"-0.01em", fontSize:"14px", fontWeight:"600" }}>Loading…</div>
    </div>
  );

  if (dbError) return (
    <div style={{ minHeight:"100vh", background:"#f5f5f7", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:"16px", padding:"24px", textAlign:"center" }}>
      <style>{GS}</style>
      <Logo h={70}/>
      <div style={{ color:"#ff3b30", fontSize:"13px", maxWidth:"560px" }}>
        <strong>Database setup needed.</strong> Run this SQL in Supabase → SQL Editor:<br/><br/>
        <code style={{ background:C.white, border:`1px solid ${C.border}`, padding:"12px", borderRadius:"12px", fontSize:"11px", display:"block", textAlign:"left", whiteSpace:"pre", color:C.black }}>
{`alter table techs add column if not exists start_date date;
alter table techs add column if not exists is_lead boolean default false;
alter table techs add column if not exists team_lead_id uuid references techs(id);
alter table techs add column if not exists hourly_rate numeric default 0;
alter table techs add column if not exists commission_rate integer default 27;

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  tech_id uuid references techs(id),
  month_key text, count integer default 0,
  created_at timestamptz default now()
);
alter table reviews enable row level security;
drop policy if exists "public access" on reviews;
create policy "public access" on reviews for all using (true) with check (true);

create table if not exists settings (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value text not null,
  created_at timestamptz default now()
);
alter table settings enable row level security;
drop policy if exists "public access" on settings;
create policy "public access" on settings for all using (true) with check (true);

create table if not exists callbacks (
  id uuid primary key default gen_random_uuid(),
  tech_id uuid references techs(id),
  reason text default '',
  created_at timestamptz default now()
);
alter table callbacks enable row level security;
drop policy if exists "public access" on callbacks;
create policy "public access" on callbacks for all using (true) with check (true);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  hcp_job_id text not null,
  tech_id uuid references techs(id),
  job_date date not null,
  revenue numeric default 0,
  upsell_amount numeric default 0,
  hours numeric default 0,
  week_key text,
  created_at timestamptz default now()
);
alter table jobs enable row level security;
drop policy if exists "public access" on jobs;
create policy "public access" on jobs for all using (true) with check (true);
create unique index if not exists jobs_hcp_job_id_key on jobs(hcp_job_id);
alter table jobs add column if not exists tips numeric default 0;`}
        </code><br/>
        <button onClick={()=>{setDbError(null);setLoading(true);loadAll().then(()=>setLoading(false));}} style={{ background:C.blue, border:"none", color:C.white, padding:"12px 28px", borderRadius:"24px", cursor:"pointer", fontFamily:FONT, fontSize:"14px", fontWeight:"700", fontStyle:"normal", letterSpacing:"-0.01em" }}>Retry</button>
      </div>
    </div>
  );

  if (!user) return (
    <div style={{ minHeight:"100vh", background:`radial-gradient(120% 80% at 50% 0%, #2aa8ff 0%, ${C.brand} 45%, #0072d1 100%)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"40px", padding:"32px 16px" }}>
      <style>{GS}</style>
      <div style={{ textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center" }}>
        <Logo h={84} color="#fff"/>
        <div style={{ fontFamily:FONT, fontWeight:"600", fontSize:"22px", color:"#fff", letterSpacing:"-0.02em", marginTop:"18px" }}>The Standard Board</div>
        <div style={{ fontSize:"15px", color:"rgba(255,255,255,0.8)", marginTop:"6px", fontFamily:FONT }}>Enter your PIN</div>
      </div>
      <PinPad onSubmit={handlePin}/>
    </div>
  );

  if (user.type==="admin") return (
    <AdminPanel techs={techs} setTechs={setTechs} upsells={upsells} setUpsells={setUpsells}
      switchovers={switchovers} setSwitchovers={setSwitchovers} reviews={reviews} setReviews={setReviews}
      callbacks={callbacks} rideAlongs={rideAlongs} schedules={schedules} quota={quota} setQuota={setQuota}
      jobs={jobs} timeEntries={timeEntries} tipEntries={tipEntries} pendingSplits={pendingSplits} unmatchedTechs={unmatchedTechs} vehicles={vehicles} truckAssignments={truckAssignments} onLogout={()=>setUser(null)} refreshAll={loadAll}
      isManager={user.role==="manager"} currentUser={user}/>
  );
  if (user.type==="tech"&&currentTech) return (
    <TechDashboard tech={currentTech} techs={activeTechs} upsells={upsells} switchovers={switchovers}
      reviews={reviews} callbacks={callbacks} quota={quota} jobs={jobs} timeEntries={timeEntries} tipEntries={tipEntries} refreshAll={loadAll} rideAlongs={rideAlongs} token={user.token} vehicles={vehicles} truckAssignments={truckAssignments} onLogout={()=>setUser(null)}/>
  );
  return null;
}
