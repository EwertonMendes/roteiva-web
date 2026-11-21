# PIX / Credit Card — courtesy purchase and guarded PROD release

## Product and financial policy

- Plans and amounts are defined by the trusted server catalog (monthly R$39.90, quarterly R$109.90, yearly R$399.90).
- A finite initial 7-day trial or active finite complimentary grant does **not** prohibit the **first** checkout. A lifetime grant, suspended account, in-flight checkout, outstanding paid period or running card recurrence does prohibit a new checkout.
- **Card**: user explicitly authorizes an **immediate** first charge and periodic automatic renewals. At checkout, remaining free time is frozen into one immutable `courtesy_credit_ms`. Every payment's due-date-derived coverage end gets the **same constant credit**. It must never compound on each renewal. Card recurring charge dates are **not postponed**; the consent and plan page must say so.
- **PIX**: user explicitly authorizes a detached one-time payment; no card subscription exists. On provider-verified `RECEIVED`, the access period begins after the surviving trial/complimentary time (or at payment verification if later), using the local civil date/time for Sao Paulo; the period is never silently stacked on another still-valid paid entitlement.
- **No prepaid repeat purchases** while paid access is still active. This deliberately avoids unbounded stacks and non-local refund/reversal arithmetic. Manual renewal is available at the end of the paid period. Future prepaid renewals require a separate priced queue/ledger and dedicated approval.
- An existing active card contract cannot coexist with an independent PIX purchase. Never grant access from browser redirects alone, and do not create a second order when an existing order's provider status is ambiguous.
- No payments, access records or trial end times are rewritten by migration 0042. Existing checkout intents get courtesy credit 0.

## Rollout gates and separation

- DEV and PROD use completely separate Firebase projects, Cloudflare accounts/D1 and Asaas credentials.
- `BILLING_ENABLED=true`: allows provider communication and continuing webhook reconciliation for *already placed* orders.
- `BILLING_CHECKOUT_ENABLED=true`: **master kill-switch** for new PROD checkout creation. Required even for canaries.
- `BILLING_CHECKOUT_TEST_UIDS=<comma-separated Firebase Auth PROD UIDs>`: PROD canary allowlist; no email-based authentication. Avoid mixing DEV UIDs with PROD identities.
- `BILLING_PIX_ENABLED=true`: separate per-environment PIX **opt-in**; never automatically on in PROD. Only effective when a checkout user is otherwise allowed.
- `BILLING_PUBLIC_ROLLOUT_ENABLED=true`: additional independent PROD approval to permit *all* authenticated eligible users when checkout is enabled. Without this, only allowed canary UIDs may start checkouts. This new flag must not be set during code deployment.
- GitHub production workflow uses the corresponding repository variables `PRODUCTION_BILLING_PIX_ENABLED` and `PRODUCTION_BILLING_PUBLIC_ROLLOUT_ENABLED`. Missing variables mean `false`. Worker secrets must be uploaded atomically via the existing guarded PROD workflow, not manually patched then overwritten.
- Disable **new PIX** by switching `BILLING_PIX_ENABLED=false`. Keep `BILLING_ENABLED=true` and webhook reconciliation active for previously created PIX orders.

## Verification required before production checkout canary or public activation

1. API tests, frontend build/typecheck, migration 0042 pin verification, local D1, Firestore rules and isolated mobile/desktop E2E all pass at the exact git SHA.
2. Publish the exact PR SHA to DEV through guarded GitHub Actions, verify API and frontend versions, then perform trial/courtesy purchase and checkout switch smoke in DEV.
3. Check real Asaas Sandbox key status. As of 21 Nov 2026, Sandbox PIX key was pending, PIX Checkout POST returned HTTP 400; a **separate** Asaas production invoice displayed a PIX QR code. This is *not proof* that Roteiva's hosted PIX Checkout/webhook/ledger will work in production.
4. Deploy production code/migration only after owner approval and automated PROD environment protections; keep `PRODUCTION_BILLING_PIX_ENABLED=false` and `PRODUCTION_BILLING_PUBLIC_ROLLOUT_ENABLED=false`.
5. For a **controlled live** canary, identify an authorized **PROD** UID and verify production callbacks, Asaas webhook authentication, host redirects, logging, receipt IDs and cancellation. Enable PIX only for that UID; confirm one actual payment and independent evidence in Asaas, PROD D1 ledger, access subscription and Firebase PROD projection. Do not present a publicly open checkout before this.
6. Verify a single payment cannot create two periods (double webhook), that late/failed cancellation cannot enable an overlap, and partial/total refunds and recurring card renewal behave as expected.
7. For wide rollout, obtain separate approval to set both `PRODUCTION_BILLING_CHECKOUT_ENABLED` and `PRODUCTION_BILLING_PUBLIC_ROLLOUT_ENABLED`; stage metrics and a reversible disable procedure.
8. Never use live credentials or make real transactions from emulator/Playwright suites.

## Invariants / diagnostics

- `billing_checkout_one_open` and `billing_contract_one_running` remain in place.
- Durable checkout intent holds plan, method, amount, provider ID, locked courtesy credit and approval/expiry state. Uncertain payments remain in review until corroborated by provider.
- D1 batching gives atomic ledger and rights; queued Firestore projections must be reconciled and verified.
- Fraudulent callbacks/duplicate or delayed webhooks must not grant additional access.
- Existing paid recurring card periods remain based on their original due date, with old intent `courtesy_credit_ms = 0`.
- Never change immutable free-trial timestamps or directly edit the production ledger to force a customer into an eligibility state.
