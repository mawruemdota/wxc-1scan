# Admin Dashboard Polish — Implementation notes

The app retains its original `POST /api/lock`, `POST /api/claim`, and `GET /api/receipt` behavior and the three preceding critical protections.

## Main changes

- A dark sidebar and responsive dashboard layout with four global metrics
- Status-filtered and searchable server-side pass table, 25 rows/page
- Manual and 10-second automatic refresh preserving current status, search, and page
- Sticky QR preview on desktop; scroll-to-preview behavior on narrow screens
- Selected QR PNG export and available-only QR PNG ZIP per current page
- Admin-only claim CSV export with protection against spreadsheet formula injection
- Username CSV/TXT preview, safe merge, and confirmation-gated atomic full replacement
- Asia/Manila display times and server-clock reservation countdowns
- New unit tests for filtering, CSV safety, and ZIP format

## Files added

- `lib/admin-query.ts` — safe search and CSV serialization
- `lib/zip.ts` — minimal stored ZIP writer for QR PNGs
- `app/api/admin/export/route.ts` — authorized export endpoint
- `supabase/migrations/20261118020000_admin_dashboard.sql` — replace RPC
- `supabase/tests/admin_dashboard.sql` — rollback-only smoke tests
- `tests/admin-dashboard.test.mjs` — helper tests

## Key operations and constraints

1. Uploading a username list initially previews up to 16 entries and counts the normalized unique names.
2. `Merge` adds usernames without deleting existing ones. `Replace entire list` requires checking a confirmation and calls a single database transaction. Do not use Replace until the new migration is installed.
3. ZIP download exports available QRs **on the currently filtered page only** (up to 25); the user can download subsequent pages separately.
4. CSV export returns matching *claimed* passes (regardless of the active status tab) and is capped at 10,000 rows. It contains private data and should be handled accordingly.
5. No existing Supabase project was modified, and the GitHub repository remains uncreated. Install the migration on a dedicated project, test there, then deploy.

## Tests performed / not performed

- Passed: JS/TS helper unit tests, TypeScript/TSX syntax parser, ZIP CRC and archive integrity
- Not yet verified: `npm run build`, `npm run typecheck`, browser rendering, database integration/migration, Vercel preview

Consult `README.md` for detailed deployment and environmental setup.
