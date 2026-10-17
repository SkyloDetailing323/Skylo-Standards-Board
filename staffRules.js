// staffRules.js
// Staffing constants shared by the app (App.jsx) and server functions, so a
// rule only lives in one place.

// Titles that drive a company truck: they must pick one to clock in.
export const TRUCK_DRIVER_TITLES = ["detail_pro","senior_detail_pro","lead_detail_pro","commercial_detail","equipment_coordinator"];

// Company holidays used until an owner saves a list (settings key "holidays").
export const DEFAULT_HOLIDAYS = ["2026-11-26","2026-11-27","2026-11-28","2026-12-24","2026-12-25","2026-12-26","2027-01-01"];
