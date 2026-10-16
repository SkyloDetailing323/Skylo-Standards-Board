// demo/profile_lc.js -- the made-up company for VITE_TENANT=lc demo builds.
// Each build includes only its own profile (vite.config.js resolves virtual:demo-profile).
// Lifetime Coatings: garage / concrete floor coatings, American Fork UT showroom,
// Utah + Salt Lake counties and Plano / McKinney TX. Big tickets, one job a day.
export const P = {
  owner: "Spencer", plate: "LC", commission: 16, title: "detail_pro", leadTitle: "lead_detail_pro", seniorTitle: "senior_detail_pro",
  leads: [["Cody Jensen", "Utah Crew", "2023-08-14"], ["Marcus Bell", "Texas Crew", "2024-09-03"]],
  crew: [["Bryce Larsen", 0, "2024-02-12"], ["Tanner Olsen", 0, "2024-06-17"], ["Dallin Sorensen", 0, "2025-03-10"], ["Jose Alvarez", 1, "2024-10-07"], ["Trey Collins", 1, "2025-01-20"], ["Kaden Wright", 1, "2025-05-27", true]],
  rep: "Ryan Hale", field: "Hunter Shaw",
  prices: [2800, 3200, 3600, 3900, 4200, 4600, 4900, 5400, 5900, 6800, 7500, 9200], upsells: [250, 350, 450, 600, 750, 900, 1200],
  jobCount: rnd => (rnd() < 0.62 ? 1 : 0), tipRate: 0.12, switchRate: 0, plans: ["monthly"], exterior: 0,
  callbacks: ["Bubbles in topcoat near door", "Flake coverage thin at edges", "Stem wall line not straight"],
  cars: ["F-150 + Trailer", "RAM 2500 + Trailer"],
  campaigns: [
    ["Garage Floors – Free Estimate", 0.45, "Utah County", ["Garage Reveal Reel", "Flake Color Swatches"]],
    ["Showroom Visit – American Fork", 0.3, "Salt Lake County", ["Showroom Walkthrough", "900+ Reviews Carousel"]],
    ["Texas Launch – Plano / McKinney", 0.25, "Collin County TX", ["Before & After Garage", "Lifetime Warranty Offer"]],
  ],
  pages: ["/garage-floor-coatings", "/commercial", "/request-a-quote"],
  google: ["Search – Garage Floor Coating Utah", "Search – Epoxy Floors Plano TX"],
  salePrices: [3600, 4200, 4900, 5400, 6800, 7500], salePlans: [[null, 0]],
  byPlan: () => ({}), ticket: 15, spend: 3.5,
  income: 470000, wages: 76000,
};
