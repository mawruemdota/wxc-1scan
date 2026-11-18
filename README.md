# 1scan — QR Pass & Verification

## Current 1scan deployment — shared 1xb Supabase project

The Vercel app uses the existing **1xb** Supabase database (project ref `cedxzjijdboojwjvkxqv`), **not** a new Supabase project. To avoid altering the earlier 1xb QR application, 1scan's tables and SQL functions have a `one_scan_` prefix in the existing `public` schema.

The applied SQL is saved in `supabase/1xb_shared/` in execution order:
`01_initial.sql`, `02_critical_fixes.sql`, `03_admin_dashboard.sql`, `04_one_minute_reservation.sql`, `05_username_only_daily_claims.sql`, and `06_registration_link_setting.sql`.
Rollback-only test scripts are in `supabase/1xb_shared/tests/`.
These migrations have already been applied to 1xb through Supabase; **do not rerun** them on 1xb.

Original `supabase/migrations/` files remain for a **new, dedicated** database and would conflict with the existing 1xb tables if applied to 1xb. Do not run the original unprefixed migrations on 1xb.

Configure Vercel project `1scan` with:
- `NEXT_PUBLIC_SUPABASE_URL=https://cedxzjijdboojwjvkxqv.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` (sensitive: obtain from 1xb Supabase Settings → API Keys; set directly in Vercel, never GitHub)
- `ADMIN_PASSWORD` (sensitive: Vercel only)

Set production, preview and development targets as appropriate. Trigger a new deployment after changing environment variables. The server key must never have a `NEXT_PUBLIC_` prefix.

**Important:** Pre-existing 1xb `public.lock_pass` and `public.claim_pass` functions are separate from 1scan. Supabase security advisors reported those legacy functions are publicly executable; 1scan does not use them. Review their permissions separately before using the original 1xb app for sensitive operations.

---

A Next.js 15 App Router/TypeScript/Tailwind web app with **Supabase PostgreSQL** atomic pass reservation, single-use claims, username allow-list imports, recovery receipts, persistent public request throttling, and an administrator claim log. Target hosting: **Vercel**.

## Core behavior

- An `/admin` password-protected dashboard imports usernames from `.csv`/`.txt`, generates 1–100 random 96-bit QR pass keys per batch, offers PNG QR downloads, and displays claim logs (name, username, email, Manila timestamp).
- `/claim?key=...` runs client-side JavaScript immediately on mount, calls `POST /api/lock`, and starts a one-minute exclusive reservation. Refreshing from the **same browser/cookie** resumes instead of resetting the timer.
- `POST /api/claim` checks ownership/expiry against the PostgreSQL clock, canonical allow-listed username, and uniqueness for registered player username on the **Asia/Manila date**; emails and public IPs do not restrict claims.
- Invalid approved-username lookup or duplicate daily claim **releases** the pass in the same database transaction. A successful claim is permanent.
- There are **no public database policies**. Privileged RPC `EXECUTE` permissions are restricted to Supabase `service_role`. The server alone holds its key.
- Admin sessions are signed HttpOnly cookies (12-hour expiry). Admin login attempts are limited per public IP to eight per 15-minute bucket.
- Concurrent first-load requests from separate tabs cannot overwrite a successful reservation cookie: only a successful lock/resume writes `qr_session`.
- Lost claim responses can be recovered: `claim_pass` is idempotent for its original session, `/api/receipt` checks recorded claims without changing them, and reopening a claimed QR from its original session displays the receipt.
- Public `/api/lock`, `/api/claim`, and `/api/receipt` are database-rate-limited by QR pass key or browser session (hashed before storage), not public IP. Limits are **15/min + 100/hour for locks, 8/min + 40/hour for claims, and 30/min + 200/hour for receipt checks**.

## Registration link configuration (administrator)

- Go to **Admin → Registered players → Registration link**.
- Paste the full `https://` (or `http://`) registration page address and select **Save registration link**.
- If a claimant submits a username absent from `one_scan_allowed_players`, the page displays **“User not found in the current database”** and an external **Register here** button.
- If no URL is configured, the button is visible but disabled with an explanatory message. Clearing and saving the link disables it again.
- The public `GET /api/registration` route exposes **only** the registration URL. Changing it requires the authenticated admin `POST /api/registration` route with same-origin checks.
- An invalid username still releases its 60-second QR reservation, as before. A player must scan an available pass after being added to the allow-list.
- The URL is saved in the RLS-protected `one_scan_settings` table. The `06_registration_link_setting.sql` migration has already been applied to shared 1xb; do not rerun it there.

## 1. Install locally

Requirements: Node.js 22 LTS (or supported Node.js 20 LTS), npm, and the configured Supabase project.

```bash
npm install
cp .env.example .env.local
```

> **Important**: The included Node.js session-policy unit tests pass and TS/TSX files pass syntax parsing. An npm registry timeout prevented installation, so `npm install`, complete TypeScript type checking, linting, production build, migration execution, and deployment are **not yet verified**. The first successful `npm install` creates `package-lock.json`; commit it before deploying. Run `npm audit` before production launch.

```bash
npm run test:unit
npm run typecheck
npm run lint
npm run build
```

## 2. Configure Supabase (existing 1xb shared project)

1scan currently uses Supabase project **1xb** (ref `cedxzjijdboojwjvkxqv`) with isolated `one_scan_*` tables and RPC functions. The SQL in `supabase/1xb_shared/` has already been applied. **Do not rerun these migrations in 1xb.** The original unprefixed files in `supabase/migrations/` are only for a fresh, dedicated project.

For local development, create `.env.local` with the project URL and a valid server-side service-role key from the 1xb Supabase API Keys settings. Do not commit secrets or prefix the server key with `NEXT_PUBLIC_`.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://cedxzjijdboojwjvkxqv.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_SIDE_SECRET
ADMIN_PASSWORD=YOUR_LONG_RANDOM_PASSWORD
```

`ADMIN_PASSWORD` must contain at least 16 characters. Rotating it invalidates existing admin sessions.

Start the development app:

```bash
npm run dev
# browse http://localhost:3000/admin
```

**Network policy:** shared Wi-Fi is permitted. Public QR routes never require, compare, or record the visitor IP. Admin login retains its separate IP-based protection against password guessing.

## 3. GitHub repository

Source repository: [mawruemdota/wxc-1scan](https://github.com/mawruemdota/wxc-1scan). The production branch is `main`, and Vercel automatically deploys new commits.

## 4. Vercel deployment

Vercel project: [1scan](https://vercel.com/wxc4/1scan).
Live website: [1scan.vercel.app](https://1scan.vercel.app).
Admin dashboard: [1scan.vercel.app/admin](https://1scan.vercel.app/admin).

Set the three environment variables listed above in the production environment. **Store API secrets only in Vercel**, never in GitHub. Redeploy after changing environment variables.

To verify claims, log in, import a CSV with a `username` column, and generate a test QR pass. Its first eligible scan should acquire a one-minute lock; a second scanner should see a reservation error; a completed claim must remain permanent. Generate final QR links using the intended production domain.

## 5. Routes & contracts

| Path | Method | Purpose |
| --- | --- | --- |
| `/admin` | GET | Server-validated admin cookie; login or dashboard |
| `/claim?key=...` | GET | Client-side lock starts after browser hydration |
| `/api/admin/login` | POST | Admin password → signed HttpOnly cookie |
| `/api/admin/logout` | POST | Delete local admin cookie |
| `/api/admin?offset=0` | GET | Paginated private dashboard data (100 passes/page) |
| `/api/admin` | POST | `{action:"generate",count:1}` or `{action:"upsert_players",usernames:[...]}` |
| `/api/lock` | POST | `{key}`; exclusive, server-timed reservation |
| `/api/claim` | POST | `{key,fullName,username,email}`; final claim or idempotent re-claim by original session |
| `/api/receipt?key=...` | GET | Read-only receipt recovery for the original claimant session |
| `/api/registration` | GET | Public registration-button URL only |
| `/api/registration` | POST | Authenticated admin-only registration URL update |

All mutating routes check same-origin `Origin`. Session tokens are random 256-bit cookie values; the raw token is never exposed to the browser JavaScript.

## 6. Security and operational notes

1. **Daily limit:** one successful claim per registered player username per Asia/Manila calendar day; usernames are canonicalized to lowercase. An email and network may be shared by multiple players.
2. **QR security:** a successful claim permanently consumes the QR. A one-minute reservation belongs to a browser session, not an IP.
3. **Identity:** an approved username alone does not prove account ownership. For prizes or sensitive events, require a verified account or player-specific code.
4. **Public rate limits:** lock requests are limited per QR pass key; claim/receipt requests per browser session token. Only hashed subjects are stored. Each endpoint has a 60-second and one-hour quota and returns HTTP 429 with `Retry-After` when exceeded. Token-limit rows should periodically be purged when more than two days old.
5. **Privacy:** new claims do not record public IP addresses. Historical IP values remain in the database but are no longer shown or exported by the admin dashboard. Names and email addresses still require appropriate privacy and retention controls.
6. **Admin security:** admin login remains separately IP-throttled to protect passwords.
7. **Recovery:** original browser sessions can resume after changing networks or recover confirmed receipts after a lost response.
8. **Database isolation:** existing 1xb tables and functions unrelated to 1scan are left unchanged.

## 7. Verification checklist

- [x] One-minute database reservation duration
- [x] Two participants behind the same public IP can reserve and claim separate QR passes
- [x] Different usernames can share an email without blocking
- [x] Same username cannot claim twice on the same Manila day
- [x] Claimed QR codes are permanently single-use
- [x] Browser sessions can resume after a network change
- [x] Token-based rate limits work independently by pass key and session
- [x] Supabase rollback-only tests verified with no lasting test rows
- [ ] Perform event-scale end-to-end testing with real devices

## 8. Historical critical fixes (some behaviors superseded by username-only policy)

| Concern | Behavior |
| --- | --- |
| Parallel first scans from one browser | Only successful locks/resumes can send `Set-Cookie`; rejected parallel responses cannot replace a winner's session |
| Lost claim confirmation | Original session can repeat `POST /api/claim`, read `GET /api/receipt?key=...`, or reopen `/claim?key=...` for the same receipt |
| Public request abuse | Atomic, database-backed per-IP 60-second and 3600-second quotas for three public endpoints |

**Important rollout sequence:** apply the second migration before deploying these updated API routes; otherwise the new rate-limit function will be missing and the public routes will fail closed. Do not run these changes against an unrelated Supabase project. A smoke test is not a substitute for real multi-device Vercel testing, and this app has not yet been deployed or verified against a live database.

## 9. Admin Dashboard Polishing Sprint (2026-11-18)

The redesigned dashboard retains password protection, all first-to-scan database guarantees, and the prior critical fixes.

### Admin console features

- **Overview:** total, available (including expired reservations), active reservations, and claimed passes. Counts come from the server, not the current page.
- **Pass log:** responsive table, server-side search (pass ID/key, username, name, email), status filters, and 25 rows/page. Refresh every 10 seconds preserves the current page and filters.
- **QR details:** select a row for a 512px QR canvas, PNG download, copyable claim URL, live hold countdown, and protected claimant details.
- **Bulk QR ZIP:** downloads **available passes from the current page** (maximum 25 PNGs) without any player information. Expired reservations count as available. Use the next page to download additional passes. Claimed or actively reserved QR codes are deliberately excluded.
- **Claim log CSV:** exports matching claimed rows, including personal details and timestamps in Asia/Manila. Admin auth is mandatory. CSV formula-like cells are escaped. The export has a 10,000-row cap; narrow the search for larger datasets.
- **Username management:** CSV/TXT preview with merge and full replacement modes. Merge preserves the allowed list. **Replace** removes usernames absent from the uploaded file, with an explicit confirmation checkbox and one atomic PostgreSQL function. Completed claim history is never removed.
- **Mobile:** collapsible navigation, scrollable pass table, accessible page navigation, and a separate pass-detail panel.

### Additional SQL migration required for replace mode

On a dedicated Supabase project that already has the first two migrations applied, run:

```text
supabase/migrations/20261118020000_admin_dashboard.sql
```

The migration defines `replace_allowed_players`, granted only to `service_role`. The server-side UI uses this RPC exclusively for full replacements. **Apply the SQL before using Replace; without it, Merge still works, but Replace will return an error.** Run `supabase/tests/admin_dashboard.sql` on a disposable test project; it rolls back all test changes.

### API changes

| Route | Purpose |
| --- | --- |
| `GET /api/admin?offset=0&limit=25&status=all&search=` | Private filtered pass log and global status counts |
| `GET /api/admin/export?search=` | Private UTF-8 claim-history CSV (up to 10,000 rows) |
| `POST /api/admin` with `action: "replace_players"` | Atomic full allowed-username replacement, requires `confirm: true` |

The existing `generate` and `upsert_players` actions remain supported. Do not expose the service-role key to client-side code. For launch, test a real admin password login, each status filter, claimed-row CSV download, available-only QR ZIP download, and merge/replace behavior against a test database.

**Build note:** The admin dashboard's TS/TSX was checked for syntax and helper unit tests were run, but this environment could not download npm dependencies, so `npm run build`, `npm run typecheck`, and database integration tests remain to be completed in CI or on a machine with npm network access.
