-- Damage reports are owners / Will (Field Supervisor) / Zak only: closed to
-- the browser. Reads and writes go through netlify/functions/damage-reports.js
-- with the service key, which checks the login token. Other logins get only
-- the scoring fields from that function. Applied Oct 15 2026.
alter policy "public access" on damage_reports using (false) with check (false);
notify pgrst, 'reload schema';
