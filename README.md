# Daylog

Personal day timeline for back pain. Log what you do (with start/end), how your pain moves, and later see what actually helps.

**Stack:** Next.js 16 (App Router, Server Actions, `proxy.ts`) · Supabase (Postgres + Auth + RLS) · Tailwind v4 · Vercel.

## Pages

- **Today** (`/`) — one screen for the whole day
  - **Sky** (top): time-of-day colors, sun/moon position, clock, weather (Open-Meteo), running actions with an **End** button
  - **Timeline** (~60%): 00–24h. Action lanes → pain events → pain level line
  - **View window**: the clock button above the timeline sets how many hours are visible (2–24h presets or custom). Move with ‹ › / Now, arrow keys, scroll or swipe; Ctrl + scroll zooms. Saved per device (`view_hours` cookie)
  - **Hover** (or long-press on touch) shows the exact HH:MM under the cursor — the same time a right-click will use
  - **Pain glider** (bottom): move it when your pain changes; it records a reading and the line holds that level until the next one
  - **Two ways to log an action**
    - *Live*: **▶ Start** → pick the action → it runs until you press **End** (header chip, or right-click → End here)
    - *With stamps*: **drag across the timeline** to select a range, then pick the action — or **+ Add…** to type start and end in a form (best on a phone, where dragging pans)
  - **Day stepper** in the sky header: ‹ yesterday / Today, so a past day is one click away without leaving the page
  - **Right-click / long-press** anywhere on the timeline, in three groups — **Activities**, **Exercises** (prefilled sets/reps/weight/rest, adjust what you did) and **Pain events**: start an action at that time, end a running one **here or at a time you type** (for actions you forgot to end), set pain level, or add a pain event. Click a block to edit start/end, effort, pain and notes
  - **Timer field** (replaces a pomodoro app): tap a task to start it — it ends the previous one and logs straight to the timeline. With a threshold the timer counts **down** (30:00 → 00:00) and then straight into minus (-02:22) — it never stops; without one it counts **up** from zero. Notifications are opt-in per activity: tick **Notify after** to enable the minutes field; left off, the activity just runs and logs (browser notification + beep + the panel turns red, repeating every 5 min). The **browser tab title** shows the live countdown (`29:58 · 🪑 Sitting`, or `⏰ +02:08 · 🚶 Walk` once over), so you can read it without switching back to the tab. The running task also takes a **pain 0–10** and a note, so you can record "sitting = 7, walking = 3"
  - **Left running by mistake**: an action running longer than 12 h shows a warning on the timer bar with **Fix the end time**, which opens the end form with +15m … +8h presets measured from the start
  - **Erase day** (trash icon above the timeline): deletes every action, pain reading and pain event of that day after a yes/no confirmation
  - At midnight the page rolls over to a fresh, empty day
- **All days** (`/days`) — **7d**: seven tall day columns with stats · **30d**: a calendar (7 weekday columns, Monday first) where each square shows that day's actions across 00→24 and its pain bar · **90d**: three 30-day calendar cards in one row. Hover a day for its summary; click to open it (`/day/YYYY-MM-DD`)
- **Settings** (`/settings`) — **Timer bar**: which activities are on it, their order and their notification thresholds · **Actions**: define everything you can log — emoji, colour, name, with edit, archive and delete · **Exercises**: the library with sets, reps, weight, rest and cues · **Pain types** · **This device**: timezone and alerts. The old `/types` URL redirects here

## Data model

| Table | What |
|---|---|
| `action_types` | Your action vocabulary: name, emoji, color, `timer` (on the timer bar), `limit_min` (notify after N minutes), `sort` |
| `actions` | Things you did: `started_at`, `ended_at` (null = still running), effort, **pain during it**, notes; exercises also carry `exercise_id`, sets, reps, `weight_kg`, `rest_sec` |
| `pain_types` | Your pain vocabulary: name, color |
| `exercises` | Your exercise library: name, emoji, colour, usual sets, reps, weight, rest, minutes, cues |
| `pain_levels` | Pain readings (0–10). Each holds until the next → a continuous line |
| `pain_events` | One-off pain moments of a given type, with intensity |

All tables have owner-only RLS. Nothing is created automatically: a fresh account stays empty until you add your own activities, exercises and pain types. Settings offers `seed_default_types()` as an opt-in **Add starter set** button while everything is empty.
Because the pain line is continuous, "pain before/after an action" can be derived for analysis later.

Times are stored in UTC; the browser's timezone is synced to a `tz` cookie so "today" is computed correctly on the server.

## Login

Single-person app: **one password**, no accounts.

- Set it in `.env.local` → `APP_PASSWORD=...` (locally) and in Vercel → Settings → Environment Variables (deployed).
- To change it: edit the value (and redeploy on Vercel). Sessions stay logged in until you press Sign out.
- Behind the scenes the server opens a session for one internal Supabase account
  (`DAYLOG_DB_EMAIL` / `DAYLOG_DB_PASSWORD`) so database row-level security stays on. You never type those.
- Wrong passwords wait 1 second before answering, to slow down guessing.

## Local dev

```bash
# put your password in .env.local → APP_PASSWORD=
npm install
npm run dev
```

## Env vars

| Name | What |
|---|---|
| `APP_PASSWORD` | **Your login password** |
| `SUPABASE_URL` | `https://ijcmrejyckhoajancfbr.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys (`sb_publishable_…`) |
| `DAYLOG_DB_EMAIL` / `DAYLOG_DB_PASSWORD` | Internal Supabase account that owns the data (copy from `.env.local`) |
| `NEXT_PUBLIC_APP_TIMEZONE` | Fallback timezone before the browser syncs, e.g. `Asia/Ulaanbaatar` |
| `NEXT_PUBLIC_WEATHER_LAT` / `NEXT_PUBLIC_WEATHER_LON` | Optional weather location (defaults to Ulaanbaatar) |

All Supabase values are server-only; nothing database-related is sent to the browser.

## Testing against real data

`sandbox@daylog.local` is a second Supabase account used for browser tests, so they never touch the real log.
Point a local server at it with `DAYLOG_DB_EMAIL=sandbox@daylog.local DAYLOG_DB_PASSWORD=… npm start`.

## Database

Migrations live in `supabase/migrations/`. After changing the schema, update `src/lib/database.types.ts`
(or regenerate: `npx supabase gen types typescript --project-id ijcmrejyckhoajancfbr`).

## Speed

- Timeline changes are optimistic: they show instantly and save in the background (rolled back with an error toast if the save fails). Ids are generated in the browser so the saved row matches what you see.
- Each change is one database round trip (~130 ms to Seoul).
- `vercel.json` pins the server to **Seoul (`icn1`)**, next to the database. Without it Vercel runs in the US and every query crosses the Pacific.
- `npm run dev` is slower than the real thing (compiles on demand). To feel real speed locally: `npm run build && npm start`.

## Deploy (Vercel)

1. Push this repo to GitHub and import it in Vercel (framework auto-detected).
2. Copy every variable from `.env.local` into Vercel → Settings → Environment Variables.
3. Optional hardening: Supabase → Authentication → Sign In / Providers → turn off "Allow new users to sign up".
