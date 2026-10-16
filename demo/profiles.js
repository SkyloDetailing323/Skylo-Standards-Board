// demo/profiles.js -- the made-up company each demo build shows (VITE_TENANT).
const dsd = {
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

// House cleaners: crews paid ~40% of the job, recurring weekly / biweekly / monthly
// cleans, add-ons like inside the oven or fridge.
const mvp = {
  owner: "MVP Owner", plate: "MVP", commission: 40, title: "detail_pro", leadTitle: "lead_detail_pro", seniorTitle: "senior_detail_pro",
  leads: [["Ashley Moreno", "All-Stars", "2024-03-18"], ["Brianna Cruz", "Starting Five", "2024-05-06"]],
  crew: [["Jasmine Reyes", 0, "2025-01-13"], ["Kayla Brooks", 0, "2025-02-24"], ["Sofia Ramirez", 0, "2025-05-12"], ["Megan Foster", 1, "2024-10-21"], ["Destiny Hall", 1, "2025-03-31"], ["Lauren Price", 1, "2025-06-30", true]],
  rep: "Ryan Hale", field: "Taylor Shaw",
  prices: [140, 155, 165, 180, 195, 210, 225, 245, 285, 340, 395, 475], upsells: [25, 30, 35, 35, 40, 45, 60],
  plans: ["biweekly", "biweekly", "weekly", "monthly", "monthly"], exterior: 0,
  callbacks: ["Dust left on ceiling fan", "Streaks on shower glass", "Missed baseboards in hallway"],
  cars: ["Toyota Corolla", "Nissan Rogue"],
  campaigns: [
    ["Recurring Clean – $50 Off", 0.45, "Homeowners 15mi", ["Before & After Kitchen Reel", "Sparkling Bathroom Carousel"]],
    ["Move-Out Cleaning", 0.35, "Renters 10mi", ["Get Your Deposit Back", "Move-Out Checklist Video"]],
    ["Deep Clean Fall Special", 0.2, "Busy Families 25mi", ["Deep Clean Reel", "Fall Refresh Offer"]],
  ],
  pages: ["/recurring-cleaning", "/move-out-cleaning", "/pricing"],
  google: ["Search – House Cleaning Near Me", "Search – Move-Out Cleaning"],
  salePrices: [155, 165, 180, 195, 225, 285], salePlans: [["Biweekly", 14], ["Weekly", 7], ["Monthly", 28], ["Biweekly", 14], [null, 0], [null, 0]],
  byPlan: s => ({ Weekly: Math.round(s * 0.15), Biweekly: Math.round(s * 0.35), Monthly: Math.round(s * 0.1) }),
  income: 54000, wages: 21500,
};

export const P = { dsd, mvp }[import.meta.env.VITE_TENANT] || dsd;
