# Inua Mkulima — Implementation Specification

Version: 1.0 | Date: 18 September 2026

## 1. Purpose and scope rule

Build the Cooperative Bank full-stack assessment as a small, working agro-dealer checkout application. A dealer signs in, selects products, specifies subsidy deductions, reviews a purchase, and submits it against a persisted farmer wallet. The application provides confirmation and a receipt.

Use production-minded implementation practices within this assessment's scope: validation, secure session handling, correct database transactions, safe retries, useful logs, focused tests, and reproducible setup. The result remains an assessment application with demo credentials and simulated verification, not an approved live banking system.

**Build only the requirements below. Do not add features because they might be useful later.** The assessment allows approximately 2.5 hours; prioritize a complete, understandable implementation. Do not silently omit required queuing or log aggregation to meet the timebox.

### Source of truth

1. `FULL STACK DEVELOPER TECHNICAL ASSESMENT - ONLINE.pdf`: written functional, technical, and submission requirements.
2. Eight supplied Adobe XD screenshots: visual layout and shown checkout interactions.
3. Explicit assumptions in this specification: resolve gaps without adding business rules.

Adobe reference: https://xd.adobe.com/view/51a6da3d-6e97-4d85-b670-57ba3f9fad37-04f5/

The user has already downloaded the design assets. Reuse those files. Their exact local filenames and directory must be inspected during implementation; this specification does not invent asset paths or claim that the assets have been inspected.

## 2. Requirement boundaries and assumptions

| Topic | Implementation decision | Basis |
|---|---|---|
| User | One configured demo agro-dealer account; no user management | Hardcoded credentials are allowed |
| Login identifier | Username; no extra email field | Supplied login design; PDF's email reference is a generic validation example |
| Wallet owner | Deduct from the farmer's subsidy wallet | Later PDF requirements refer to the farmer; introductory merchant wording conflicts |
| Farmer selection | One seeded fictional farmer and wallet associated with the demo dealer | No selection or registration screen is supplied |
| Deduction | Dealer enters a subsidy amount per product line; no invented subsidy rate | Editable-looking deduction fields and partial-payment note in the design |
| Outstanding amount | Purchase total minus subsidy deduction; customer settles it outside the application | Design's instruction to collect the balance from the customer |
| Verification | Six-digit demo code, validated by the backend; no actual SMS | Shown in design, but SMS integration is not required |
| Payment | Save a transaction and debit the wallet when Pay succeeds | Covers the PDF's API requirements despite its later allowance for a UI-only submit |
| Product management | Basic product API operations; no management screen | PDF requires APIs to manage products |
| Transaction management | Create, list, and retrieve completed purchases; no editing or deletion | Purchase records should remain consistent with wallet deductions |
| Receipt | Download a simple PDF generated from the saved transaction | Supplied confirmation and receipt designs |
| Navigation | Reproduce Dashboard, Transactions, Reports labels; only Dashboard is an active page in this scope | No transaction-list or report screen is specified; other labels are visibly disabled, not broken links |
| Quantity changes | Preserve the entered line deduction; flag it if it exceeds the new line total | No automatic recalculation rule for subsidy amounts is supplied |
| Initial deduction | Start at zero and require the dealer to enter amounts | Avoid assuming entitlement to the entire product price |

Record these assumptions in the README. They are implementation decisions, not confirmed policy from the assessor.

### Resolve sample inconsistencies

- Use the API's product price consistently. Mineral salts appear at KES 300 in selection and KES 400 in summary; seed KES 300 from the product listing.
- Use the same saved items for checkout, confirmation, and receipt. Do not copy the receipt's unrelated example products.
- Change the summary's reference to a "parent" to "farmer".
- A deduction is a line amount, not an amount multiplied again by quantity.
- The Deduct button opens Summary. It never changes the wallet. Only Pay commits the purchase.

### Explicit exclusions

No registration, password recovery, roles/permissions interface, farmer onboarding/search, wallet funding, stock management, merchant settlement ledger, refunds, reversals, reports, analytics, real SMS/OTP, M-Pesa/card integrations, subsidy rules engine, email notifications, WebSockets, microservices, Kubernetes, or cloud deployment pipeline. Hosting is not a submission requirement.

## 3. Technology and architecture

Use one repository with two application folders and one backend process.

| Concern | Choice | Reason |
|---|---|---|
| Frontend | React, TypeScript, Vite, React Router | Small client application with three routes |
| Styling | Plain CSS with reusable variables and components | Match supplied assets/design without another component framework |
| State and requests | React state/context and native fetch | Cart is small; no global state or query library is needed |
| Backend | Node.js, Express, TypeScript | Direct routing and business logic |
| Validation | Zod | Explicit request shapes and readable validation errors |
| Database | SQLite with better-sqlite3 and numbered SQL migrations | Persistent relational storage without a separate database server |
| Authentication | express-session with a compatible SQLite session-store adapter | Server-managed session and actual logout; no custom token scheme |
| Password check | bcryptjs against the configured demo password hash | Demo identity remains server-side |
| Message queue | RabbitMQ with amqplib | Real broker, one queue and one consumer |
| Logging | Winston file transport and a compatible Loki transport | Same structured events sent to a file and a log aggregation system |
| Log aggregation | Grafana Loki, single-instance local configuration | Queryable centralized logs; no separate Grafana dashboard required |
| Receipt | PDFKit on the backend | Small server-generated PDF from saved data |
| Tests | Vitest, Supertest; one Playwright checkout smoke test | Focus on business risks and required user flow |

Pin compatible dependency/container versions when implementing and commit the lockfile. Do not use floating `latest` image tags. Use an active Node LTS supported by the selected dependencies and record its exact major version.

### Runtime arrangement

- Development: Vite proxies `/api` to Express; RabbitMQ and Loki run through Docker Compose.
- Production build: Express serves the built frontend and `/api` on the same origin.
- SQLite database, session database, application logs, RabbitMQ data, and Loki data live in persistent local directories/volumes.
- Run one API instance. SQLite and the small background publisher are intentionally scoped to this deployment; do not claim horizontal scalability.
- The API handles money synchronously in SQLite. RabbitMQ handles a post-purchase activity-log event, never the wallet debit itself.

### Folder structure

```text
frontend/
  public/assets/             # User-provided images, logos and fonts
  src/
    api.ts                  # Fetch wrapper and response types
    App.tsx                 # Routes and session initialization
    pages/                  # LoginPage, ProductsPage, SummaryPage
    components/             # Header, Sidebar, ProductList, CartTable, dialogs
    cart/                   # Small cart context and pure calculations
    styles/                 # Tokens, layout and responsive CSS
backend/
  src/
    app.ts                  # Express setup; importable in tests
    server.ts               # Startup and shutdown
    config.ts               # Validated environment variables
    db/                     # Connection, migrations, seed and prepared queries
    auth/                   # Session setup, routes and middleware
    products/               # Routes and request schemas
    wallets/                # Read route
    transactions/           # Routes, purchase service, preview, receipt
    infrastructure/         # Logger and RabbitMQ publisher/consumer
    middleware/             # Request ID and error handler
  tests/
infra/                      # RabbitMQ/Loki Compose configuration
tests/e2e/                  # Checkout smoke test
README.md
.env.example
package.json
package-lock.json
```

Use npm workspaces solely to run both folders conveniently. No shared-package build system, generic repository layer, dependency injection framework, event bus abstraction, or base controller classes. Routes validate and call functions; the purchase service owns the database transaction.

## 4. Screens and behavior

### 4.1 Shared design and assets

- Preserve the green headings, gold buttons, black payment actions, light backgrounds, spacing, and supplied imagery.
- Use downloaded font files when available; do not guess the exact typeface from screenshots.
- Do not recreate Adobe's viewer breadcrumbs or surrounding screenshot margins inside the app.
- Desktop: sidebar, header, and two-column products/selection layout.
- Mobile: compact navigation and stacked panels; allow the selected-items table to scroll inside its own container without making the page overflow.
- Provide labels, visible keyboard focus, accessible button names, and dialog focus handling. Use real buttons for controls.

### 4.2 Login — `/login`

One page with two states. Username -> Continue -> Password -> Sign in. Let the user return to correct the username.

- Trim username; require it to be nonempty. Do not trim the password.
- Password uses a masked input and an accessible show/hide toggle.
- Validate empty fields before submission. Display a generic invalid-credentials message for a wrong username or password.
- Submit both fields to the backend only on Sign in. Checking a username locally is not authentication.
- Disable duplicate submissions and show progress. Preserve username after failure.
- On success, fetch session context and navigate to `/products`.

### 4.3 Product selection — `/products`

- Fetch the active product list and the assigned persisted wallet balance.
- Show loading, request failure with Retry, and an empty-products message as separate states.
- List the five seeded products with API names/prices and an Add button.
- Show the cream-colored empty selection message and disabled Deduct button until there is a valid selection.
- Each selected row shows name, quantity, unit price, line total, deduction input, and quantity controls.
- Add on an existing product increments its quantity rather than adding a duplicate row.
- Plus increases by one. Minus decreases by one; zero removes the row.
- Numeric fields accept digits only, including when pasting; reject signs, exponent notation, letters, and decimal points. Blank is an editing state, not a valid submitted value.
- Quantity must be a whole number. Deduction input is whole KES for this assessment, converted to minor units before API submission.
- Show the combined deduction on the button. Flag a deduction above its row total or above the available wallet balance.
- Keep the design's message explaining that the customer pays any uncovered amount.
- Deduct requests a backend preview and navigates to Summary only if valid. It does not debit or reserve funds.

### 4.4 Summary — `/summary`

- Display the server-calculated preview: names, quantities, prices, line totals, deductions, and total subsidy deduction.
- Reuse quantity controls where required by the assessment; changing a row invalidates the preview and disables Pay until a fresh preview succeeds. Back preserves the cart.
- Display six code boxes, numeric-only, supporting paste of a six-digit code, backspace, and keyboard navigation.
- Use `123456` as the documented demo verification code. Validate it server-side at Pay.
- A 30-second resend countdown may be reproduced locally; Resend clears the boxes and restarts the countdown. It sends no SMS. Mark verification as simulated in README and a small demo helper near the code entry.
- Pay stays disabled for invalid inputs, missing preview, or an active payment request.
- A direct visit with no cart returns to Products. A page reload may reset an unsubmitted cart; retain an unresolved payment attempt as described in section 8.

### 4.5 Confirmation, receipt and logout

- Show success only after the API confirms a committed transaction.
- Display saved reference, timestamp, subsidy amount and fictional farmer details.
- Download Receipt requests the PDF for that saved transaction. A failed download offers retry and never repeats payment.
- Done clears cart/verification state, returns to Products, and refetches the wallet.
- The receipt reproduces the supplied layout sufficiently: provided logos, dealer/farmer details, reference/date, item table, and total deduction. Use real saved values and include purchase total/customer remainder clearly if needed to remove ambiguity.
- Logout shows the supplied confirmation dialog. Back cancels; confirm destroys the session, clears frontend state, and navigates to Login.

## 5. Money rules and worked example

All API/database money values are integer KES minor units: `100` = KES 1.00. Use names ending in `Minor`. Never calculate money with floating-point shilling values. Validate all values and calculated sums as bounded safe integers.

```text
lineTotalMinor       = quantity * unitPriceMinor
purchaseTotalMinor   = sum(lineTotalMinor)
deductionTotalMinor  = sum(lineDeductionMinor)
customerDueMinor     = purchaseTotalMinor - deductionTotalMinor
walletAfterMinor     = walletBeforeMinor - deductionTotalMinor
```

For every line: quantity >= 1 and 0 <= deduction <= line total. Across the cart: deduction total > 0 and <= wallet balance. Reject duplicate product IDs, empty carts, inactive/missing products and unsafe numeric values. Apply practical validation limits: 50 distinct lines and quantities 1–999; document them as technical input limits, not subsidy policy.

| Item | Quantity | Unit price | Line total | Deduction |
|---|---:|---:|---:|---:|
| Animal feeds 10kg | 1 | KES 1,500 | KES 1,500 | KES 900 |
| Mineral salts 500g | 2 | KES 300 | KES 600 | KES 500 |
| Total | | | KES 2,100 | KES 1,400 |

Starting wallet: KES 2,400. Customer due outside this app: KES 700. Wallet after purchase: KES 1,000.

Format money consistently with `Intl.NumberFormat` using currency KES. The wallet endpoint also supplies a formatted balance to satisfy the requirement to retrieve and format it.

## 6. Database design

Four business tables are sufficient. Farmer details belong to the single wallet in this scope; no separate farmer-management model is needed. The session adapter may create its own infrastructure table/database, which is not part of the business schema.

Use parameterized statements, foreign keys enabled on every connection, numbered migrations, WAL mode, a bounded busy timeout, and UTC timestamps. Retain normal durability settings; do not disable synchronization for speed.

### `products`

| Column | Type / constraint |
|---|---|
| id | INTEGER PRIMARY KEY |
| name | TEXT NOT NULL; trimmed, nonempty |
| price_minor | INTEGER NOT NULL CHECK > 0 |
| active | INTEGER NOT NULL DEFAULT 1 CHECK IN (0,1) |
| created_at, updated_at | TEXT NOT NULL; UTC ISO timestamps |

Deactivate instead of physically deleting products. Existing transaction items retain historical values.

### `wallets`

| Column | Type / constraint |
|---|---|
| id | INTEGER PRIMARY KEY |
| dealer_id | TEXT NOT NULL; configured demo dealer identifier |
| farmer_name | TEXT NOT NULL; fictional seed value |
| farmer_reference | TEXT NOT NULL UNIQUE; fictional identifier |
| farmer_phone | TEXT NOT NULL; fictional demo value |
| name | TEXT NOT NULL; display name |
| currency | TEXT NOT NULL DEFAULT 'KES' CHECK = 'KES' |
| balance_minor | INTEGER NOT NULL CHECK >= 0 |
| updated_at | TEXT NOT NULL |

### `transactions`

| Column | Type / constraint |
|---|---|
| id | TEXT PRIMARY KEY; server-generated UUID, also the receipt reference |
| dealer_id | TEXT NOT NULL; from authenticated session |
| wallet_id | INTEGER NOT NULL REFERENCES wallets(id) |
| idempotency_key | TEXT NOT NULL |
| request_hash | TEXT NOT NULL; hash of canonical purchase payload |
| request_id | TEXT NOT NULL; correlation ID from the original payment request |
| purchase_total_minor | INTEGER NOT NULL CHECK > 0 |
| deduction_total_minor | INTEGER NOT NULL CHECK > 0 AND <= purchase_total_minor |
| customer_due_minor | INTEGER NOT NULL CHECK = purchase_total_minor - deduction_total_minor |
| wallet_before_minor | INTEGER NOT NULL CHECK >= deduction_total_minor |
| wallet_after_minor | INTEGER NOT NULL CHECK = wallet_before_minor - deduction_total_minor |
| receipt_parties_json | TEXT NOT NULL; server-created snapshot of dealer/farmer display details |
| created_at | TEXT NOT NULL |
| event_published_at | TEXT NULL; pending when NULL |

Add `UNIQUE(dealer_id, idempotency_key)`, an index on `(dealer_id, created_at)`, and a partial index for rows whose `event_published_at IS NULL`.

Only completed purchases are inserted. Failed validation attempts belong in logs, not as editable financial records. No pending/payment-status state machine is necessary.

### `transaction_items`

| Column | Type / constraint |
|---|---|
| id | INTEGER PRIMARY KEY |
| transaction_id | TEXT NOT NULL REFERENCES transactions(id) |
| product_id | INTEGER NOT NULL REFERENCES products(id) |
| product_name | TEXT NOT NULL; snapshot |
| quantity | INTEGER NOT NULL CHECK BETWEEN 1 AND 999 |
| unit_price_minor | INTEGER NOT NULL CHECK > 0; snapshot |
| line_total_minor | INTEGER NOT NULL CHECK = quantity * unit_price_minor |
| deduction_minor | INTEGER NOT NULL CHECK >= 0 AND <= line_total_minor |

Add `UNIQUE(transaction_id, product_id)`. The purchase service ensures that row sums equal transaction header totals. Historical name/price snapshots are intentional: later product edits must not rewrite receipts.

### Seed and export

Seed one fictional wallet with `balance_minor = 240000` and these products:

| ID | Name | price_minor |
|---:|---|---:|
| 1 | Animal feeds 10kg | 150000 |
| 2 | Mineral salts 500g | 30000 |
| 3 | Maize seeds 2kg | 36000 |
| 4 | Mango seedling 1pc | 15000 |
| 5 | Mango fruit fly trap 1pc | 150000 |

Seeding must not overwrite an existing wallet balance or purchases. Provide an explicit local reset command for repeatable demos. Export a restorable SQL dump of the business database for submission, excluding session data. SQLite has no database username/password; state this in the README. Share only fictional assessment data.

## 7. API contracts

Prefix: `/api`. Request and normal response content type: `application/json`. Receipt download is the explicit `application/pdf` exception. All business routes require an authenticated dealer session and wallet/transaction ownership checks. Resolve the assigned wallet from the session; clients cannot choose arbitrary wallet IDs.

| Method and path | Purpose | Success |
|---|---|---|
| POST `/auth/login` | Validate `{username,password}` and establish session | 200, dealer context |
| GET `/auth/me` | Restore session context, including assigned wallet ID | 200 |
| POST `/auth/logout` | Destroy session and clear cookie | 200, `{loggedOut:true}` |
| GET `/products` | List active products | 200, array; empty array is valid |
| POST `/products` | Create `{name,priceMinor}` | 201, product |
| PATCH `/products/:id` | Update provided name/price fields | 200, product |
| DELETE `/products/:id` | Deactivate product | 200, `{id,active:false}` |
| GET `/wallet` | Read assigned wallet, balance and formatted balance | 200 |
| POST `/transactions/preview` | Validate items and calculate purchase without writes | 200, calculated preview |
| POST `/transactions` | Verify demo code and atomically complete purchase | 201 new; 200 replay |
| GET `/transactions?limit=20&offset=0` | List this dealer's saved purchases, newest first | 200, items and total count; limit capped at 100 |
| GET `/transactions/:id` | Retrieve saved transaction, items and receipt parties | 200 |
| GET `/transactions/:id/receipt` | Download PDF generated from saved data | 200 PDF |

Register `/transactions/preview` before parameterized routes. Product-write APIs exist to satisfy basic management; do not build a product-admin UI. In this single-account exercise all protected routes belong to the demo dealer; do not add a role system.

### Shared cart request

```json
{
  "items": [
    {"productId": 1, "quantity": 1, "expectedUnitPriceMinor": 150000, "deductionMinor": 90000},
    {"productId": 2, "quantity": 2, "expectedUnitPriceMinor": 30000, "deductionMinor": 50000}
  ],
  "expectedDeductionTotalMinor": 140000
}
```

`expectedUnitPriceMinor` detects a price change; it never supplies the authoritative price. The backend reads database prices and verifies the submitted total against the line deductions. A mismatch returns a clear validation/conflict response rather than silently changing what the customer reviewed.

Preview returns canonical product names/prices and line totals plus `purchaseTotalMinor`, `deductionTotalMinor`, `customerDueMinor`, `walletBalanceMinor`, and `walletAfterMinor`. It is advisory and creates no reservation; payment revalidates all values.

For payment, submit the same shape plus `verificationCode: "123456"` and the header `Idempotency-Key: <client-generated UUID>`. Return the persisted transaction with its items and before/after balances. Read operations use the same camelCase field names.

Wallet response example:

```json
{
  "data": {
    "id": 1,
    "name": "Inua Mkulima",
    "currency": "KES",
    "balanceMinor": 240000,
    "formattedBalance": "KES 2,400.00"
  }
}
```

Normal successes use `{ "data": ... }`. Errors use:

```json
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "The wallet balance is too low for this deduction.",
    "requestId": "server-request-id"
  }
}
```

Optional `error.fields` maps field paths to readable validation messages. Never expose stack traces or SQL errors to the browser.

| Status | Typical error codes |
|---|---|
| 400 | `INVALID_INPUT`, `INVALID_VERIFICATION_CODE`, `TOTAL_MISMATCH` |
| 401 | `INVALID_CREDENTIALS`, `UNAUTHENTICATED` |
| 403 | `FORBIDDEN_ORIGIN` |
| 404 | `PRODUCT_NOT_FOUND`, `WALLET_NOT_FOUND`, `TRANSACTION_NOT_FOUND`; also unauthorized object lookup |
| 409 | `INSUFFICIENT_FUNDS`, `PRICE_CHANGED`, `PRODUCT_UNAVAILABLE`, `IDEMPOTENCY_CONFLICT` |
| 429 | `TOO_MANY_ATTEMPTS` |
| 503 | `DATABASE_BUSY` after bounded lock timeout |
| 500 | `INTERNAL_ERROR` |

## 8. Purchase transaction and safe retries

One service function owns this operation. Keep it short and explicit.

1. Authenticate, validate the payload/key/code, and create a canonical hash of the economic request. Sort items by product ID; include quantities, expected prices, deductions, total and assigned wallet. Exclude the verification code from the stored hash.
2. Begin an immediate SQLite transaction and look up `(dealer_id, idempotency_key)`.
3. If it exists with the same request hash, return the original saved purchase without rechecking current prices or debiting again. A different hash returns `IDEMPOTENCY_CONFLICT`.
4. Read the assigned wallet and active products inside the transaction. Validate ownership, quantities, prices, deductions and totals.
5. Perform a guarded debit: update the wallet only where `balance_minor >= deductionTotalMinor`; require exactly one changed row.
6. Insert the completed transaction and item snapshots with `event_published_at = NULL` in the same database transaction.
7. Commit. Any failure before commit rolls back every change.
8. Return the saved purchase. Trigger the background event publisher after commit; broker/log availability must not turn a committed payment into an HTTP payment failure.

No network requests, PDF rendering, or queue acknowledgements occur while holding the database transaction open. SQLite permits one writer at a time; immediate transactions and a bounded timeout make contention explicit. See [SQLite transaction documentation](https://www.sqlite.org/lang_transaction.html).

### Frontend retry behavior

- Create a payment key once per attempted purchase and retain it for retries of that unchanged request.
- Before sending Pay, save the key and economic payload in sessionStorage so a reload in the same tab can resume an unresolved attempt. Never store a password, session token or verification code there. After a reload, request the demo code again before retrying the saved purchase. Clear this record only after confirmed success or a definitive pre-commit rejection; this is recovery for one payment, not general cart persistence.
- Disable Pay while the request is running. On an ambiguous network failure, show "We could not confirm the result. Retry to check this payment" and reuse the same key and payload.
- Do not let the user change the cart or create a new key while resolving an ambiguous payment response. On confirmed rejection before commit, allow corrections and start a new attempt.
- On a known price conflict, return to Products, reload prices, and ask the user to review; never silently charge a new amount.
- After a successful replay, display the original receipt/balance snapshot, then fetch the current wallet when returning to Products.

Idempotency and the guarded debit are implementation safeguards for the required payment, not additional product features.

## 9. Message queue and logging

### Required queue use

Use one durable RabbitMQ queue, `purchase.completed`. Publish a persistent event with a stable `eventId` equal to transaction ID, event type, timestamp, request ID, transaction ID, and deduction total. Exclude names, phone numbers, credentials and verification codes.

The consumer records a structured `purchase.completed.processed` activity event through the shared logger. It does not debit wallets, send SMS, or change purchase status. Acknowledge after the local log write succeeds. Use a confirm channel when publishing; publisher confirms and consumer acknowledgements cover different delivery stages. See [RabbitMQ acknowledgement documentation](https://www.rabbitmq.com/docs/confirms).

For a small, recoverable implementation, the transaction's nullable `event_published_at` is the pending-publication marker:

- One non-overlapping background loop reads a bounded batch of pending transactions at startup and periodically, e.g. every five seconds.
- Publish and wait for broker confirmation; only then set `event_published_at`.
- On broker failure, leave the marker NULL, log the failure locally, and retry on later iterations with reconnect delay.
- A crash after publish but before marking may cause a duplicate event. Reuse the stable event ID; duplicate activity logs are acceptable and must never trigger another debit.
- Pause/reconnect on transient consumer failure instead of a hot requeue loop; log and reject malformed messages without repeated requeue.

This is a narrow durable publication mechanism for one event, not a general event framework. Use the saved transaction's `request_id` for correlation when reconstructing its event after a restart.

### Required logs

Write JSON logs to a size-rotated local file and send the same structured events to Loki through a configured transport. Console output alone and a file alone do not satisfy the assessment.

Log request method/path/status/duration, request ID, validation failures without raw inputs, transaction ID and outcome, queue publication/consumption, and dependency failures. Use low-cardinality Loki labels such as `app`, `environment`, and `level`; request and transaction IDs stay in the log body.

Loki transport errors must not crash the API or recursively log through the failing transport. Use a bounded buffer, timeouts, and local fallback. State that aggregation delivery is best effort during an outage; local files remain available. Queue acknowledgement does not depend on Loki being reachable.

Provide a README command to query the event in Loki using its HTTP API; no dashboard product is required. See [Loki HTTP API](https://grafana.com/docs/loki/latest/reference/loki-http-api/).

## 10. Authentication, validation and configuration

- Demo account exists only in backend configuration; no credentials in frontend code. Document disposable demo credentials for the reviewer.
- Use a server-side session stored by a compatible SQLite adapter. Regenerate the session on login and destroy it on logout. Set a finite expiry, e.g. one hour.
- Cookies are HttpOnly and SameSite=Lax; Secure is enabled under HTTPS. Use a strong environment-provided session secret. Local HTTP development may disable Secure explicitly.
- For browser mutations validate Origin against the configured application origin, including login, logout and product writes. Document the required Origin header for API test commands. Same-origin deployment avoids permissive CORS.
- Use basic login/payment attempt rate limits, security headers, a bounded JSON body size, and centralized validation/error middleware.
- Use a password hash for the configured demo account. Never log passwords, cookies, session IDs, codes, full request bodies, or farmer identifying details.
- Return 401 when the session expires; the frontend clears sensitive state and returns to Login.
- Validate environment configuration at startup. Missing session secrets/database configuration fail startup clearly. Temporary queue/Loki outages enter the documented retry/fallback behavior.
- Keep broker management/Loki endpoints local or on a private network; the user-facing app is the only public surface in a later deployment.

These controls apply the narrow production-minded baseline from [Express security guidance](https://expressjs.com/en/advanced/best-practice-security/). They do not introduce a full identity platform.

Required configuration includes `NODE_ENV`, `PORT`, `APP_ORIGIN`, `DATABASE_PATH`, `SESSION_DATABASE_PATH`, `SESSION_SECRET`, `DEMO_USERNAME`, `DEMO_PASSWORD_HASH`, `DEMO_DEALER_ID`, `DEMO_VERIFICATION_CODE`, `RABBITMQ_URL`, `LOKI_URL`, `LOG_DIR`, and `LOG_LEVEL`. Provide safe placeholders and local examples in `.env.example`; never commit a real `.env`.

## 11. Verification and acceptance checklist

Use the PDF's functional checks as the completion checklist. Automate the money/retry risks and one complete UI journey; use a short manual checklist for visual states. Do not chase a coverage percentage.

| ID | Acceptance condition | Verification |
|---|---|---|
| A01 | Empty/wrong credentials fail; correct login succeeds; password show/hide works | API checks and UI smoke |
| A02 | Unauthorized APIs reject access; logout invalidates the session | API integration |
| A03 | Products and wallet come from persisted API data with formatted KES balance | API integration and UI |
| A04 | Add/plus/minus/zero removal work; only numeric quantity/deduction inputs accepted | UI smoke/manual paste checks |
| A05 | Names, prices, quantities, totals and deductions agree across product list, summary and receipt | Worked-example smoke |
| A06 | Invalid deductions, quantities, product IDs, prices and submitted totals are rejected | Purchase-service/API tests |
| A07 | Valid purchase deducts KES 1,400 from KES 2,400, saves header/items and leaves KES 1,000 | Database integration |
| A08 | Insufficient funds save nothing and leave the wallet unchanged | Database integration |
| A09 | An injected failure during item insertion rolls back the debit and header | Database integration |
| A10 | Repeated same key/body debits once; same key/different body returns conflict | Database integration |
| A11 | Competing purchases cannot overspend the wallet | Two real database connections or worker processes against one temporary file |
| A12 | Bad/missing verification code fails; demo code succeeds; preview never changes balance | API/UI checks |
| A13 | API loading/error/empty states render; Pay and Deduct disable appropriately | Manual checklist |
| A14 | Success popup uses saved details; Done returns to refreshed products; receipt is downloadable | UI smoke and PDF inspection |
| A15 | Product create/update/deactivate APIs work; historic receipt survives price/name edits | API integration |
| A16 | Purchase event reaches RabbitMQ consumer; queue recovery processes pending events without another debit | Integration check with real broker |
| A17 | Same transaction ID is present in the local log and a Loki query result | Integration check with real Loki |
| A18 | Desktop and narrow mobile layouts follow supplied assets and remain usable | Browser check at approximately 1440px and 390px |
| A19 | Restart preserves products, wallet and transactions; dump restores into a fresh database | Restart/restore check |
| A20 | Fresh clone installs, migrates, seeds, builds and runs using only README instructions | Final clean setup check |

Do not call a single synchronous connection test a concurrency test. Do not replace RabbitMQ/Loki with console stubs in the submitted application. Test doubles are acceptable only in isolated unit tests.

## 12. Implementation order

1. Inspect supplied assets; establish folder structure, scripts and environment examples. Bring up RabbitMQ and Loki early to uncover setup issues.
2. Add SQL migration, seed, database connection, shared logger and queue connection.
3. Implement session login/logout, product APIs and wallet retrieval.
4. Implement pure cart validation/calculation, preview, atomic purchase and safe retries. Verify the money tests before connecting Pay.
5. Build the three pages and dialogs using the design assets; connect real APIs and required empty/loading/error states.
6. Add receipt download and the pending-event publisher/consumer; verify both log destinations.
7. Run the acceptance checks, fix failures, produce the database dump, and complete the README.

Time pressure should reduce decorative polish, not remove explicitly required integrations or weaken purchase correctness. Do not expand scope beyond this document.

## 13. Submission and definition of done

Provide root scripts with clear purposes: `dev`, `build`, `start`, `typecheck`, `test`, `test:e2e`, `db:migrate`, `db:seed`, `db:reset`, and `db:dump`. Production start must not reset or reseed balances.

README must include:

- What the application does and the exact implemented scope.
- Prerequisites, pinned runtime, install/configuration commands, infrastructure startup, migration/seed and app startup.
- Demo username/password, simulated verification code and fictional wallet setup.
- A short architecture explanation and database table summary.
- API examples, session-cookie handling, Origin header, and idempotency header.
- Test commands and a brief mapping to the assessment checks.
- Instructions to find file logs, query Loki, and verify RabbitMQ consumption/recovery.
- SQL dump filename and restore instructions; state SQLite needs no DB username/password.
- Assumptions from section 2, single-instance limitation, simulated verification, and aggregation outage behavior.
- How the downloaded assets are used and any missing assets that affected visual fidelity.

The repository must include source, tests, migration/seed, dependency lockfile, `.env.example`, infrastructure configuration, README and the fictional business-data SQL dump. Exclude actual environment files, active sessions, runtime logs, live database files and secrets.

Submit the completed code on `main`, resolving the PDF's general branch wording with its final explicit main-branch instruction. Verify the reviewer can access the repository. The PDF asks for the repository link to be sent to `snyambura@co-opbank.co.ke`, with the candidate's name and assessment title. Preparing this project does not authorize automatically sending that email.

**Done means:** every in-scope assessment requirement has a working implementation, the design flow can be demonstrated end to end, wallet changes are correct and repeat-safe, required integrations are real, tests pass, and a reviewer can reproduce the result from the README and database dump.
