# beforeu-backend — the BeforeU API

Node 20 + Express 5 + Mongoose 9, **TypeScript strict** compiled to CommonJS. The single backend for
the admin dashboard, the mobile app and the (uncloned) customer web platform.
`git@github.com:vishesh774/beforeu-backend.git`, branch `main` (work lands via PRs from `dev`).

## Entrypoints

- `src/app.ts` — the whole bootstrap: dotenv, helmet, CORS allowlist, body parsers (50 MB),
  request logging, route mounting, error handlers, then `startServer()` which connects Mongo, starts
  the scheduler, wraps the app in `http.createServer`, attaches Socket.io and listens.
  **It is not side-effect-free** — importing it starts a server. Tests build their own app instead.
- `PORT` is read from the env and then **force-overridden to 5000** if it is anything else, to match
  `fly.toml`'s `internal_port`.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | nodemon + ts-node on `src/app.ts` |
| `npm run build` | `tsc` → `dist/` |
| `npm start` | `node dist/app.js` |
| `npm test` | Jest (3 test files) |
| `npm run test:coverage` | Jest + coverage — **cannot pass**, the global threshold is 95% |
| `npm run lint` / `lint:fix` | ESLint 9 flat config over `src/**/*.ts` |
| `npm run seed:admin` | creates the first admin user |
| `npm run update:admin` | resets an admin password |
| `npm run migrate:invoices` | backfills `invoiceNumber` on old bookings |
| `npm run migrate:cleanup-emails` | fixes empty-string emails that break the sparse unique index |

`npm run prepare` installs husky. `.husky/pre-commit` → `lint-staged` → `jest --findRelatedTests
--passWithNoTests` + `eslint --fix` on staged `src/**/*.ts`.

## Layout

```
src/app.ts                    bootstrap + server (see above)
src/config/database.ts        Mongo connection
src/middleware/               auth.ts (protect/authorize) · adminAuth.ts (requireAdmin) ·
                              partnerAuth.ts (protectPartner) · asyncHandler · errorHandler · validate
src/models/        30 schemas — Booking 275L, OrderItem 213L, ServiceVariant 170L, User 135L …
src/routes/        13 routers (see mount table)
src/controllers/   34 controllers, ~16k LOC — bookingController 2739L, paymentController 1392L,
                   planController 1207L, extraChargesController 976L, authController 778L
src/services/      bookingService (assignment + status sync) · otpService · whatsappService ·
                   emailService · pushNotificationService · sosCallService · schedulerService ·
                   socketService · crmService · crmTaskService
src/utils/         the business-logic core — see below
src/constants/     bookingStatus.ts (the status enum + label + group definitions) · holdReasons.ts
src/scripts/       one-off seeds and migrations (run via the npm scripts above)
src/tests/         auth · booking · extraCharges + setup.ts
```

`BeforeU_API_Collection.postman_collection.json` at the repo root is a working Postman collection.

## Route mount table (`src/app.ts`)

`/api/auth` · `/api/admin` · `/api/roles` · `/api/partners` · `/api/provider` · `/api/sos` ·
`/api/coupons` · `/api/reviews` · `/api/referral` · `/api/health` — plus **three routers mounted at
bare `/api`**: `bookingRoutes`, `paymentRoutes`, `configRoutes`. Those three define their own full
paths (`/api/bookings`, `/api/services/all`, `/api/payments/create-order`, `/api/config`,
`/api/booking/slots`). When adding a route to them, remember the prefix is not in the mount.

`/` and `/health` are unauthenticated liveness endpoints (the Docker `HEALTHCHECK` hits `/health`).

`adminRoutes.ts` is one big `router.use(requireAdmin)` followed by ~90 routes covering users,
service regions, services, service partners, service locations, customers, bookings, policies, FAQs,
visit rules, T&Cs, plans, plan transactions, checkout config, app config, payment reconciliation,
company settings, customer-app settings, invoices, reviews, health partners and referral config.

## utils/ — read these before touching money, dispatch or invoices

| File | Owns |
|------|------|
| `checkoutUtils.ts` | **The only place totals are computed.** Coupon discount first, then each active `CheckoutField` in `order`; percentages are taken on the *discounted* item total; a field whose `fieldName` contains "discount" subtracts instead of adds. Returns the `breakdown[]` that gets persisted on the booking. |
| `pointInPolygon.ts` | Ray-casting point-in-polygon. Decides which `ServiceRegion` a booking or SOS falls in — the input to both partner assignment and SOS calling. |
| `invoiceUtils.ts` | `BUC/YY-YY/NNN` numbering. Financial year starts 1 April. Atomic `$inc` on `InvoiceCounter`, so this one *is* race-safe. |
| `timeCalculations.ts` | Active work time = elapsed − summed `holdHistory[]` windows. |
| `phoneUtils.ts` | `normalizePhone()` → E.164 `+91…`. Use before any phone lookup. |
| `dateUtils.ts` | The only IST formatting helpers. There is no global `TZ`. |
| `systemServices.ts` | Lazily creates the `sos` and `plan-purchase` pseudo-services/variants so emergencies and plan purchases can ride the normal booking pipeline. |
| `healthCardGenerator.ts`, `pdfGenerator.ts` | PDFKit invoice and health-card generation. |
| `userHelpers.ts` | Assembles the aggregated user payload (credits + active plan + family + addresses) that `/api/auth/me` and the admin customer views return. |

`services/bookingService.ts` is the other centre of gravity: `isPartnerAvailableAtTime()`,
`syncBookingStatus()` and `autoAssignServicePartner()`. See the workspace
`.claude/rules/architecture.md` for the full lifecycle.

## Environment variables

No `.env.example` exists. Referenced in code:

`PORT` `NODE_ENV` `MONGODB_URI` / `MONGODB_URI_PROD` `JWT_SECRET` `JWT_EXPIRE` `CORS_ORIGIN` ·
`RAZORPAY_KEY_ID` `RAZORPAY_API_SECRET` · `FIREBASE_PROJECT_ID` `FIREBASE_CLIENT_EMAIL`
`FIREBASE_PRIVATE_KEY` · `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS`
`SMTP_FROM_NAME` `SMTP_FROM_EMAIL` `ACCOUNTS_TEAM_EMAILS` · `SMS_PROVIDER` (`brevo` | `pinnacle`)
`BREVO_API_KEY` `BREVO_SMS_SENDER` · `WHATSAPP_ACCESS_TOKEN` `WHATSAPP_API_URL`
`WHATSAPP_API_VERSION` `WHATSAPP_WABA_ID` `WHATSAPP_PHONE_NUMBER_ID` `WHATSAPP_BUSINESS_ID` ·
`AUTOMATE_BUSINESS_CRM_API_KEY` `AUTOMATE_BUSINESS_TASK_API_KEY` `AUTOMATE_BUSINESS_API_URL`
`CRM_PIPELINE_ID` `CRM_DEFAULT_ASSIGNED_TO` `CRM_TASK_CATEGORY_ID` `CRM_DEFAULT_TASK_ASSIGNEE_ID` ·
`SMARTFLO_API_KEY` `SMARTFLO_FAMILY_API_KEY` · `RATE_LIMIT_WINDOW_MS` `RATE_LIMIT_MAX_REQUESTS` (currently unused) ·
`ACCOUNT_DELETION_RETENTION_DAYS` (default 30) · `OPERATIONS_TEAM_EMAILS`.

**`SMARTFLO_FAMILY_API_KEY`** deserves a note: the SmartFlo click-to-call request carries no
payload, so the script a recipient hears is decided by the flow bound to the API key. Family SOS
alerts therefore need their own key pointing at a family IVR flow. If it is unset, family calls fall
back to `SMARTFLO_API_KEY` — meaning family members hear the *partner* script. The fallback is
logged as a warning on every SOS rather than passing silently.

Several WhatsApp IDs have **live-looking hardcoded defaults** in `services/whatsappService.ts`.
Most integrations degrade quietly (log a warning, return `false`) when their vars are missing —
`JWT_SECRET` is the exception and throws.

## Deployment

Fly.io, `fly.toml` app `beforeu-backend-dev`, region `bom`, 1 GB shared-cpu-1, `auto_stop_machines =
'stop'` with `min_machines_running = 0`. Multi-stage `Dockerfile` on `node:20-slim`
(`npm ci --include=dev` → `tsc` → `npm prune --omit=dev`); `.npmrc` sets `production=false` so the
build stage gets TypeScript. `deploy.sh` and the four `*DEPLOYMENT*`/`QUICK_*` markdown files
document the flow. **`.github/workflows/fly-deploy.yml` does not work** — it filters on `backend/**`
and `cd`s into `./backend`, a directory that doesn't exist here.

## Gotchas

- **`POST /api/partners/auth/login` has no credential check.** Any active partner phone number
  yields a valid JWT (`controllers/partnerController.ts`). The code comment says OTP verification is
  the frontend's job.
- **Socket.io is unauthenticated.** `services/socketService.ts` accepts every connection, and any
  client emitting `join_admin` joins `admin_room` and receives live SOS payloads (customer name,
  phone, coordinates). The dashboard sends a token in the handshake; nothing reads it.
- **Hardcoded OTP `123456`** for the phone ending `8197744060` (`services/otpService.ts:193`), plus
  a hardcoded skip so that OTP is never actually sent.
- **`axios` is not in `package.json`** but is imported by `crmService`, `crmTaskService`,
  `whatsappService` and `sosCallService`. It resolves transitively today; a dependency bump breaks
  the build.
- **Rate limiting is commented out** in `src/app.ts` — including on OTP sending. `express-rate-limit`
  is still installed.
- **`Booking.pre('save')` generates `bookingId` with `countDocuments`** on today's date prefix.
  Concurrent bookings can collide on the `unique` index. (`invoiceNumber` in the same hook is
  atomic and fine.)
- **`OrderItem.pre('save')` regenerates missing start/end job OTPs on every save**, not just on
  create.
- **`User.role` is a free-form string** with no enum, defaulting to `customer`; `requireAdmin` lets
  through anything that isn't literally `customer`. The backend never enforces the `Role` permission
  matrix — only the dashboard does, client-side.
- **`/api/provider/*` finds the partner by matching `user.phone` to `ServicePartner.phone`** and
  returns an empty job list rather than a 403 if there's no match. It duplicates `/api/partners/*`,
  which uses a different auth path entirely.
- **The scheduler is a 2-hour `setInterval` in-process**, not cron. Combined with
  `min_machines_running = 0`, the 08:00 IST daily report only fires when the machine happens to be
  awake. More than one instance double-sends.
- **No `TZ` is pinned.** IST is applied ad hoc at four call sites. `isPartnerAvailableAtTime()`
  derives the weekday with `getUTCDay()` and parses `scheduledTime` in both `"HH:mm"` and
  `"H:mm AM/PM"` forms.
- **`.gitignore` ends with `*.json` plus `!package.json` / `!tsconfig.json` / `!package-lock.json`.**
  Any new JSON file you add is silently ignored — including service-account keys (good) and fixtures
  you actually wanted to commit (bad).
- The error handler returns `{ success: false, error }`; there is no structured logging, just
  `console.log` with emoji prefixes and an `[API-AUDIT]` line per request.
