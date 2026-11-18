# 1scan — QR Pass & Verification

## Current 1scan deployment — shared 1xb Supabase project

The Vercel app uses the existing **1xb** Supabase database (project ref `cedxzjijdboojwjvkxqv`), **not** a new Supabase project. To avoid altering the earlier 1xb QR application, 1scan's tables and SQL functions have a `one_scan_` prefix in the existing `public` schema.

The applied SQL is saved in `supabase/1xb_shared/` in execution order:
`01_initial.sql`, `02_critical_fixes.sql`, and `03_admin_dashboard.sql`.
The three rollback-only test scripts are in `supabase/1xb_shared/tests/`.
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

- An `/admin` password-protected dashboard imports usernames from `.csv`/`.txt`, generates 1–100 random 96-bit QR pass keys per batch, offers PNG QR downloads, and displays claim logs (name, username, email, IP, Manila timestamp).
- `/claim?key=...` runs client-side JavaScript immediately on mount, calls `POST /api/lock`, and starts a five-minute exclusive reservation. Refreshing from the **same browser/cookie and IP** resumes instead of resetting the timer.
- `POST /api/claim` checks ownership/expiry against the PostgreSQL clock, canonical allow-listed username, and uniqueness for username/email/public IP on the **Asia/Manila date**.
- Invalid approved-username lookup or duplicate daily claim **releases** the pass in the same database transaction. A successful claim is permanent.
- There are **no public database policies**. Privileged RPC `EXECUTE` permissions are restricted to Supabase `service_role`. The server alone holds its key.
- Admin sessions are signed HttpOnly cookies (12-hour expiry). Admin login attempts are limited per public IP to eight per 15-minute bucket.
- Concurrent first-load requests from separate tabs cannot overwrite a successful reservation cookie: only a successful lock/resume writes `qr_session`.
- Lost claim responses can be recovered: `claim_pass` is idempotent for its original session, `/api/receipt` checks recorded claims without changing them, and reopening a claimed QR from its original session displays the receipt.
- Public `/api/lock`, `/api/claim`, and `/api/receipt` are database-rate-limited per trusted public IP across all Vercel instances. Limits are **15/min + 100/hour for locks, 8/min + 40/hour for claims, and 30/min + 200/hour for receipt checks**.

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

**Local IP behavior:** all requests in development are identified as `127.0.0.1` unless run on Vercel. This prevents meaningful multi-IP local testing; use a Vercel preview deployment or a controlled test harness to verify distinct IPs. Production refuses to read untrusted forwarding headers outside Vercel.

## 3. GitHub repository

Source repository: [mawruemdota/wxc-1scan](https://github.com/mawruemdota/wxc-1scan). The production branch is `main`, and Vercel automatically deploys new commits.

## 4. Vercel deployment

Vercel project: [1scan](https://vercel.com/wxc4/1scan).
Live website: [1scan.vercel.app](https://1scan.vercel.app).
Admin dashboard: [1scan.vercel.app/admin](https://1scan.vercel.app/admin).

Set the three environment variables listed above in the production environment. **Store API secrets only in Vercel**, never in GitHub. Redeploy after changing environment variables.

To verify claims, log in, import a CSV with a `username` column, and generate a test QR pass. Its first eligible scan should acquire a five-minute lock; a second scanner should see a reservation error; a completed claim must remain permanent. Generate final QR links using the intended production domain.

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

All mutating routes check same-origin `Origin`. Session tokens are random 256-bit cookie values; the raw token is never exposed to the browser JavaScript.

## 6. Security/operational limitations to understand before production

1. **The first scan is the first eligible browser request to successfully reach `POST /api/lock`.** Initial HTML fetch, QR camera preview, and link-preview fetches alone don't reserve. JS-capable automated browsers **can** reserve passes; no JavaScript detection is a guaranteed anti-bot mechanism.
2. **Public IP limits are shared.** Anyone on the same venue Wi-Fi, corporate NAT, or carrier-grade NAT may share one public IP, so the requested once-per-day IP restriction will block additional legitimate participants. Consider making IP a secondary abuse signal instead of a hard daily uniqueness rule if this is a public event. VPN/mobile-network changes can also alter results.
3. **Pseudonymous registrations.** Approved usernames alone do not prove that a scanner owns the username. A malicious scanner who knows an allowed username can claim it first. For stronger identity, add login, verified OTP, or a player-specific code before launch.
4. **Protect QR links.** Anyone who obtains a still-unused QR URL can attempt a reservation. Treat links/PNGs as bearer tickets. Do not send them to public channels before intended release.
5. **Privacy and retention.** Full names, emails, and public IPs are stored in Supabase and shown in the admin log. Publish an appropriate privacy notice and implement a retention/deletion policy consistent with applicable privacy requirements. This code intentionally does not automatically delete claims, to preserve auditability.
6. **Rate limits:** public lock/claim/receipt endpoints now have persistent database-backed per-IP quotas, enforce `429 Too Many Requests`, and send `Retry-After`. They are not CAPTCHA or bot-detection systems; sophisticated attackers with distributed IPs may still contend for passes. For high-value events add WAF/bot rules, monitoring, and a live incident plan. An unusually busy shared network might hit the same per-IP quota.
7. **Rate-limit housekeeping:** the `public_api_rate_limits` table keeps a row per endpoint, IP, and window duration. For long-running production environments, periodically delete records older than two days (`delete from public.public_api_rate_limits where window_started < clock_timestamp() - interval '2 days';`) from trusted admin tooling. Never expose a public cleanup endpoint.
8. **Recovery scope:** newly successful claims have receipt records bound to the original 256-bit HttpOnly session cookie. A different browser, expired/deleted cookie, or pre-upgrade claim cannot recover its receipt automatically. Retry the original submission safely if a response is lost; do not copy tokens to client JavaScript.
9. **Capacity and concurrent traffic:** run a realistic load test with multiple distinct devices/IPs, verify database function grants and edge/CDN behaviors, and rehearse simultaneous claims before using the app for prizes or paid admissions.
10. **Browser sessions:** clearing cookies or switching browsers changes the reservation token. Switching networks during the five minutes is blocked by IP ownership; it does not release the lock until it expires.
11. **Backups and recovery:** decide who can access Supabase backups and GitHub, and test rollback/recovery before an event. Use a dedicated production project.

## 7. Suggested verification checklist

- [x] `npm run test:unit` passes (two initial session race-safety unit tests)
- [ ] `npm install`, `npm run typecheck`, `npm run lint`, `npm run build` succeed
- [ ] `npm audit` reviewed; pinned dependencies current for security releases
- [ ] Both migrations and both transactional SQL smoke tests pass on a dedicated test project
- [ ] Read-only receipt available after claim response drop and repeat POST has the same timestamp/reference
- [ ] Rejected concurrent first-load lock does not set or replace the winning session cookie
- [ ] Public per-IP quotas produce HTTP 429 with a `Retry-After` header, independent per route
- [ ] Supabase `anon` and `authenticated` roles cannot select private tables or execute any privileged RPCs
- [ ] Simultaneous scan from two phones: exactly one reservation
- [ ] Same browser refresh preserves the original 5-minute deadline
- [ ] Another pass from the same IP rejected while reservation is active
- [ ] Invalid username releases the pass immediately
- [ ] Duplicate claimed username, email, or IP (Manila calendar day) rejected
- [ ] Midnight Asia/Manila boundary tested
- [ ] Vercel production environment variables configured and no secrets committed
- [ ] Final domain scanned and downloaded QR codes tested before public use

## 8. Changes in Critical Fixes Sprint (2026-11-18)

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
