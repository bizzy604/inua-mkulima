# Inua Mkulima

Inua Mkulima is a small full-stack agro-dealer checkout application for the Cooperative Bank assessment. An authenticated dealer selects products, enters a subsidy deduction for each line, reviews a server-calculated purchase, verifies it with a simulated demo code, and completes the purchase against a persisted fictional farmer wallet.

The repository contains a React/Vite frontend and a Node.js/Express backend. SQLite owns the financial transaction. RabbitMQ carries a post-purchase activity event, and Winston writes structured events to a rotated local file and to Grafana Loki.

## Delivered scope

### Frontend

- Two-step username and password login with masked password and show/hide control.
- Session restoration through `GET /api/auth/me`.
- Product list loaded from the backend, with wallet balance and KES formatting.
- Add, increment, decrement, and remove cart lines.
- Whole-KES subsidy deduction inputs with numeric filtering and line-total validation.
- Server-side preview before the summary screen.
- Summary of product lines, purchase total, subsidy deduction, customer remainder, and projected wallet balance.
- Six-digit simulated verification code entry and payment submission.
- Idempotency key retained in `sessionStorage` for payment retries.
- Payment confirmation showing the saved farmer and transaction reference.
- Receipt download from the backend-generated PDF.
- Logout confirmation and responsive desktop/mobile layouts using the supplied image and logo assets.

The frontend intentionally does not provide registration, farmer search, product administration, transactions/report pages, SMS, or real payment rails. Transactions and Reports remain visibly inactive because those screens are outside the supplied scope.

### Backend

- Express 5 API written in TypeScript.
- SQLite migrations with foreign keys, WAL mode, bounded busy timeout, and normal durability settings.
- Repeat-safe seed data: five products and one fictional farmer wallet starting at KES 2,400.
- Server-side SQLite sessions with finite expiry, session regeneration on login, and session destruction on logout.
- Origin enforcement for browser mutations, security headers, bounded JSON bodies, and login/payment rate limits.
- Product create, update, deactivate, active-list, and assigned-wallet APIs.
- Preview API that performs no writes.
- Atomic payment transaction with guarded wallet debit, immutable product and farmer snapshots, rollback safety, ownership checks, and dealer-scoped idempotency.
- Transaction list/detail APIs and a PDF receipt built only from saved transaction data.
- Durable RabbitMQ `purchase.completed` publication with publisher confirms and pending-event recovery.
- Consumer acknowledgement only after the local activity log write succeeds.
- Rotated JSON file logs plus best-effort Loki delivery with bounded buffering and timeouts.
- Business-only SQL dump and explicit demo reset commands.

## Architecture

```text
Browser
  |
  | Vite dev server on :5173, /api proxy
  v
Express API on :3000
  |-- express-session -> SQLite session database
  |-- product/wallet/transaction routes -> SQLite business database
  |-- receipt route -> PDFKit
  |-- post-commit publisher -> RabbitMQ purchase.completed
  |-- structured logger -> local JSON file + Loki
```

The wallet debit is synchronous and never depends on RabbitMQ or Loki. The purchase service performs validation, guarded debit, transaction-header insertion, and item-snapshot insertion in one immediate SQLite transaction. The queue is only for post-purchase activity logging.

The business database contains `products`, `wallets`, `transactions`, and `transaction_items`. Session records are stored separately and are not included in the business SQL dump.

## Prerequisites

- Node.js **24.14.0** or another Node 24 release supported by the pinned dependencies.
- npm.
- Docker Desktop with Linux containers for RabbitMQ and Loki.
- PowerShell examples below assume Windows, but the application scripts are standard npm commands.

Dependencies and Docker image versions are pinned. Do not commit `.env`, runtime databases, session data, logs, or secrets.

## Local setup

Run from the repository root:

```powershell
npm ci
npm run setup:local
docker compose -f infra/compose.yaml up -d
npm run db:migrate
npm run db:seed
```

`setup:local` creates a gitignored `.env` with a random session secret and the disposable demo password hash. It preserves an existing `.env`. The full configuration is documented in [.env.example](.env.example).

Start the backend in one terminal:

```powershell
npm run dev
```

Start the frontend in a second terminal:

```powershell
npm run dev --workspace frontend
```

Open http://localhost:5173. Vite proxies `/api` to `http://localhost:3000`, so both processes must be running. The backend API is available at http://localhost:3000/api and its health endpoint is `GET /api/health`.

The configured development browser origin is `http://localhost:5173`. Every mutation, including login and logout, requires that Origin. For a built same-origin deployment, set `APP_ORIGIN=http://localhost:3000`; Express serves `frontend/dist` after `npm run build`.

Backend API documentation is available without authentication at:

- Swagger UI: http://localhost:3000/api-docs
- OpenAPI JSON: http://localhost:3000/api-docs.json

The document is maintained in `backend/src/openapi.ts` and describes the implemented session, product, wallet, preview, payment, transaction-history, and receipt endpoints. Swagger UI loads its presentation assets from the pinned public CDN URL; the API contract itself is served locally by Express.

Demo credentials:

- Username: `demo`
- Password: `Demo-checkout-123!`
- Verification code: `123456`
- Initial fictional wallet: KES 2,400

Verification is simulated. No SMS is sent.

## Commands

| Command                            | Purpose                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run dev`                      | Start the backend in watch mode                                                            |
| `npm run dev --workspace frontend` | Start the Vite frontend on port 5173                                                       |
| `npm run build`                    | Build the frontend, compile the backend, and copy runtime assets                           |
| `npm start`                        | Start the compiled backend; it does not seed or reset data                                 |
| `npm run typecheck`                | Typecheck both workspaces                                                                  |
| `npm test`                         | Run the backend API, database, concurrency, infrastructure-isolation, and evaluation tests |
| `npm run test:eval`                | Run the deterministic varied-cart evaluation                                               |
| `npm run test:infra`               | Verify real RabbitMQ and Loki behavior; requires Docker services                           |
| `npm run db:migrate`               | Apply numbered business migrations                                                         |
| `npm run db:seed`                  | Insert missing fictional products and wallet without replenishing a spent wallet           |
| `npm run db:reset`                 | Reset local demo business data only when explicitly confirmed                              |
| `npm run db:dump`                  | Write a restorable business-data SQL dump                                                  |

For an intentional local demo reset, stop the backend first and run:

```powershell
npm run db:reset --workspace backend -- --confirm-demo-reset
```

This refuses production mode, clears business purchases, and restores the fictional seed. It does not reset session data. SQLite has no database username or password.

Create a business-only SQL dump with an explicit filename. The command refuses to overwrite an existing file:

```powershell
npm run db:dump --workspace backend -- business-data.sql
```

Restore a trusted dump into a fresh database. The target must be empty, and session data is not part of the dump:

```powershell
$env:DATABASE_PATH = 'backend/var/restored.db'
npm exec --workspace backend -- tsx src/db/cli.ts restore business-data.sql
Remove-Item Env:DATABASE_PATH
```

## API summary

All normal responses use `{ "data": ... }`. Errors use `{ "error": { "code", "message", "requestId", "fields?" } }`. Responses include `X-Request-ID`. Protected routes require the server session and use the wallet assigned to that session; clients cannot choose an arbitrary wallet.

| Method   | Path                                  | Purpose                                                    |
| -------- | ------------------------------------- | ---------------------------------------------------------- |
| `POST`   | `/api/auth/login`                     | Establish a server session from `{username,password}`      |
| `GET`    | `/api/auth/me`                        | Restore dealer and wallet context                          |
| `POST`   | `/api/auth/logout`                    | Destroy the session                                        |
| `GET`    | `/api/products`                       | List active products                                       |
| `POST`   | `/api/products`                       | Create a product                                           |
| `PATCH`  | `/api/products/:id`                   | Update a product                                           |
| `DELETE` | `/api/products/:id`                   | Deactivate a product                                       |
| `GET`    | `/api/wallet`                         | Retrieve the assigned wallet and formatted KES balance     |
| `POST`   | `/api/transactions/preview`           | Validate and calculate without writing                     |
| `POST`   | `/api/transactions`                   | Verify and atomically complete or safely replay a purchase |
| `GET`    | `/api/transactions?limit=20&offset=0` | List owned purchases                                       |
| `GET`    | `/api/transactions/:id`               | Retrieve an owned saved purchase                           |
| `GET`    | `/api/transactions/:id/receipt`       | Download a PDF built from saved snapshots                  |

Money values in API and database fields are integer KES minor units: `100` means KES 1.00. Technical input limits are 50 distinct lines and quantities from 1 to 999. A deduction is entered per line, not multiplied again by quantity.

A payment request must include the same economic payload used for preview, `verificationCode`, and an `Idempotency-Key` UUID. Keep the same key and unchanged payload when retrying an ambiguous response. A different economic payload with the same key returns an idempotency conflict.

Example API flow using PowerShell and `curl.exe`:

```powershell
$login = '{"username":"demo","password":"Demo-checkout-123!"}'
$login | curl.exe -s -c cookies.txt -H 'Origin: http://localhost:5173' -H 'Content-Type: application/json' --data-binary '@-' http://localhost:3000/api/auth/login
curl.exe -s -b cookies.txt http://localhost:3000/api/products
curl.exe -s -b cookies.txt http://localhost:3000/api/wallet

$cart = '{"items":[{"productId":1,"quantity":1,"expectedUnitPriceMinor":150000,"deductionMinor":90000},{"productId":2,"quantity":2,"expectedUnitPriceMinor":30000,"deductionMinor":50000}],"expectedDeductionTotalMinor":140000}'
$cart | curl.exe -s -b cookies.txt -H 'Origin: http://localhost:5173' -H 'Content-Type: application/json' --data-binary '@-' http://localhost:3000/api/transactions/preview

$payment = ($cart | ConvertFrom-Json)
$payment | Add-Member verificationCode '123456'
$key = [guid]::NewGuid().ToString()
$payment | ConvertTo-Json -Depth 5 -Compress | curl.exe -s -b cookies.txt -H 'Origin: http://localhost:5173' -H 'Content-Type: application/json' -H "Idempotency-Key: $key" --data-binary '@-' http://localhost:3000/api/transactions
```

The worked example represents KES 2,100 of products, KES 1,400 of subsidy deduction, KES 700 due from the customer outside this application, and a wallet balance of KES 1,000 after payment.

Delete `cookies.txt` after local testing. It is ignored by Git.

## Queue and logging verification

Start the local infrastructure:

```powershell
docker compose -f infra/compose.yaml up -d
docker compose -f infra/compose.yaml ps
curl.exe http://127.0.0.1:3100/ready
```

RabbitMQ management is at http://127.0.0.1:15672 with the local credentials documented in [infra/README.md](infra/README.md). Logs are written to `backend/var/logs/application.log` by default and rotated at 5 MiB. Loki delivery is best effort; local file logging remains available during a Loki outage.

Run the real dependency verification from the repository root:

```powershell
npm run test:infra
```

This creates a temporary database, publishes to the real RabbitMQ queue, verifies local and Loki activity records, and exercises pending-event recovery. It fails when RabbitMQ or Loki is unavailable. See [infra/README.md](infra/README.md) for query commands and the actual-purchase outage recovery procedure.

## Verification status

The current automated checks completed successfully during implementation:

- `npm run typecheck`: frontend and backend TypeScript checks pass.
- `npm run build`: frontend bundle and backend production compilation pass.
- `npm test`: 39 backend tests pass across five test files.
- `npm run test:eval`: deterministic varied-cart invariants pass.
- Backend tests cover authentication, origin enforcement, validation, preview non-mutation, rollback, guarded debit, idempotent replay/conflict, concurrent writers, ownership, historical receipts, restart persistence, SQL restore, and logging failure isolation.

Still requiring environment-dependent verification:

- `npm run test:infra` against running RabbitMQ and Loki.
- Browser-level Playwright checkout coverage and screenshot review at desktop and mobile sizes.
- Manual visual comparison with all supplied Adobe reference screens.

These are verification gaps, not replacements for the implemented behavior.

## Data, assumptions, and exclusions

The seed contains one configured dealer, one fictional farmer wallet, and five products. Seeding is repeat-safe and never replenishes a wallet after purchases. Product and farmer details are snapshotted into completed transactions so later edits do not rewrite receipts.

Implementation assumptions recorded for this assessment:

- The dealer uses one assigned fictional farmer wallet; there is no farmer selection workflow.
- Subsidy deductions are dealer-entered line amounts. No subsidy entitlement or rate is invented.
- The customer settles any uncovered purchase amount outside this application.
- The six-digit verification code is simulated and validated by the backend.
- Preview never reserves or debits funds. Only Pay commits a purchase.
- Mineral salts are seeded at KES 300, matching the product API source.
- This is a single-instance local assessment deployment.

Explicit exclusions include registration, password recovery, role management, farmer onboarding/search, wallet funding, stock management, merchant settlement, refunds, reversals, reports, analytics, real SMS, M-Pesa/card integrations, WebSockets, microservices, Kubernetes, and cloud deployment.

## Repository guide

- `frontend/src/App.tsx`: route-level login, selection, summary, confirmation, and logout flow.
- `frontend/src/api.ts`: typed fetch wrapper and money formatting.
- `frontend/src/styles.css`: responsive application styling.
- `backend/src/app.ts`: Express middleware and route composition.
- `backend/src/db/`: SQLite connection, migration, seed, dump, and restore logic.
- `backend/src/transactions/`: validation, preview, atomic purchase service, routes, and PDF receipt.
- `backend/src/infrastructure/`: structured logger and RabbitMQ publisher/consumer.
- `backend/tests/`: focused API, money, retry, persistence, concurrency, and infrastructure-isolation tests.
- `infra/`: RabbitMQ/Loki Compose configuration and live verification instructions.

The supplied assets are reused from `frontend/public/assets` and the reference screenshots are retained under `frontend/public/screenshots` for visual review. The production build is generated in `frontend/dist` and is ignored by Git.

## License and assessment data

This repository contains fictional assessment data only. Do not use the demo credentials, local infrastructure credentials, or seeded wallet data in a live environment.
