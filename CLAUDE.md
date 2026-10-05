# Skylo Dashboard — rules for Claude sessions

This repo is the live Skylo Detailing app (techs, payroll inputs, training,
marketing/sales reports). Netlify deploys `main` to production automatically,
and every deploy — including pull-request previews — talks to the **live**
Supabase database.

## How changes ship

- Work on a branch and open a pull request. **Never push to `main`** unless an
  owner (Truxton or Casey) explicitly says to in this session. `main` is
  protected; only owners merge.
- One feature per pull request, with a plain-English description of what it
  does and how to test it on the Deploy Preview link Netlify posts on the PR.
- Run `npx vite build` before pushing; don't push a branch that doesn't build.

## Database (Supabase)

- Don't change the database directly. New tables, columns or functions go in
  a SQL file in the pull request: `supabase/migrations/YYYYMMDD_short_name.sql`.
  An owner reviews and applies it before merging.
- Only add things (new tables, new columns with defaults). Never drop,
  rename, or change existing tables, columns, or data.
- New tables: enable row level security, and follow how existing tables in
  `App.jsx` are read/written.
- Deploy Previews write to the live database. Test entries must be clearly
  marked (e.g. name "TEST") and deleted after testing.

## Hands off without an owner's OK

- Pay, commission, tips, revenue, upsells, switchovers, and week math
  (weeks run Sunday–Saturday to match HCP).
- Anything under `netlify/functions/` that syncs HCP, GHL, Gmail, Meta or
  Google, and `netlify/functions/lib/authToken.js` (logins).
- Login/PIN handling and owner/manager access rules.
- Never put passwords, PINs, API keys, key-box codes or tokens in code.
  Secrets live in Netlify environment variables.

## Code style

- The app is one React file (`App.jsx`) using inline styles and the `C`
  color constants; match the surrounding code. Netlify functions are
  CommonJS (`require`), not ES modules.
