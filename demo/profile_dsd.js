// demo/profile_dsd.js -- the made-up company for VITE_TENANT=dsd demo builds.
// Each build includes only its own profile (vite.config.js resolves virtual:demo-profile).
// demo/profiles.js -- the made-up company each demo build shows (VITE_TENANT).
export const P = {
  owner: "Cael Bray", plate: "DSD", commission: 27, title: "detail_pro", leadTitle: "lead_detail_pro", seniorTitle: "senior_detail_pro",
  leads: [["Jake Turner", "Diamond Crew", "2024-04-15"], ["Mason Reed", "Ozark Elite", "2024-06-01"]],
  crew: [["Tyler Brooks", 0, "2025-01-10"], ["Luke Harmon", 0, "2025-02-20"], ["Caleb Fisher", 0, "2025-05-05"], ["Noah Pierce", 1, "2024-11-11"], ["Wyatt Cole", 1, "2025-04-01"], ["Brady Lane", 1, "2025-07-14", true]],
  rep: "Ryan Hale", field: "Hunter Shaw",
  prices: [150, 175, 195, 225, 250, 275, 295, 325, 350, 395, 450, 550], upsells: [25, 35, 45, 60, 75, 95, 120],
  plans: ["monthly", "monthly", "bimonthly", "quarterly", "biweekly"], exterior: 0.4,
  callbacks: ["Streaks on windshield", "Missed cupholders", "Pet hair left in trunk"],
  cars: ["Ford Transit", "F-150"],
  campaigns: [
    ["NWA Interior Detail – Fall", 0.45, "Bentonville / Rogers", ["Before & After Reel", "Pet Hair Carousel"]],
    ["Membership Plans", 0.35, "Fayetteville 25mi", ["Monthly Plan Video", "Keep It Clean Offer"]],
    ["Boat & RV Season", 0.2, "Beaver Lake area", ["Boat Detail Reel", "RV Wash Photo"]],
  ],
  pages: ["/memberships", "/boat-rv-detailing", "/services-pricing"],
  google: ["Search – Mobile Detailing NWA", "Search – Boat & RV"],
  salePrices: [175, 225, 250, 295, 325, 395], salePlans: [["Monthly", 28], ["Bimonthly", 56], ["Quarterly", 84], ["Biweekly", 14], [null, 0], [null, 0]],
  byPlan: s => ({ Monthly: Math.round(s * 0.35), Bimonthly: Math.round(s * 0.15), Quarterly: Math.round(s * 0.1) }),
  income: 61000, wages: 15400,
};
