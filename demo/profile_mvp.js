// demo/profile_mvp.js -- the made-up company for VITE_TENANT=mvp demo builds.
// Each build includes only its own profile (vite.config.js resolves virtual:demo-profile).
// MVP Cleaning, American Fork UT (Utah, Salt Lake, Davis counties). House cleaners: crews paid ~40% of the job, recurring weekly / biweekly / monthly
// cleans, add-ons like inside the oven or fridge.
export const P = {
  owner: "Jaylon Vickers", plate: "MVP", commission: 40, title: "detail_pro", leadTitle: "lead_detail_pro", seniorTitle: "senior_detail_pro",
  leads: [["Ashley Moreno", "All-Stars", "2024-03-18"], ["Brianna Cruz", "Starting Five", "2024-05-06"]],
  crew: [["Jasmine Reyes", 0, "2025-01-13"], ["Kayla Brooks", 0, "2025-02-24"], ["Sofia Ramirez", 0, "2025-05-12"], ["Megan Foster", 1, "2024-10-21"], ["Destiny Hall", 1, "2025-03-31"], ["Lauren Price", 1, "2025-06-30", true]],
  rep: "Ryan Hale", field: "Taylor Shaw",
  prices: [140, 155, 165, 180, 195, 210, 225, 245, 285, 340, 395, 475], upsells: [30, 35, 35, 40, 45, 60, 95, 125],
  plans: ["biweekly", "biweekly", "weekly", "monthly", "monthly"], exterior: 0,
  callbacks: ["Dust left on ceiling fan", "Streaks on shower glass", "Missed baseboards in hallway"],
  cars: ["Toyota Corolla", "Nissan Rogue"],
  campaigns: [
    ["Recurring Clean – $50 Off", 0.45, "Utah County", ["Before & After Kitchen Reel", "Sparkling Bathroom Carousel"]],
    ["Move-In / Move-Out", 0.35, "Salt Lake County", ["Get Your Deposit Back", "Move-Out Checklist Video"]],
    ["Carpet Cleaning – Hot Water Extraction", 0.2, "Davis County", ["Carpet Before & After Reel", "Fall Refresh Offer"]],
  ],
  pages: ["/house-cleaning", "/carpet-cleaning", "/instant-quote"],
  google: ["Search – House Cleaning Utah County", "Search – Carpet Cleaning"],
  salePrices: [155, 165, 180, 195, 225, 285], salePlans: [["Biweekly", 14], ["Weekly", 7], ["Monthly", 28], ["Biweekly", 14], [null, 0], [null, 0]],
  byPlan: s => ({ Weekly: Math.round(s * 0.15), Biweekly: Math.round(s * 0.35), Monthly: Math.round(s * 0.1) }),
  income: 54000, wages: 21500,
};
