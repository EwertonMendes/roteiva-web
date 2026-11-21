# Billing PIX + payment-provider portability (DEV only)

## Deployment safety
- Scope: GitHub PR #201. Production remains unchanged until separate approval.
- Do not activate `BILLING_PIX_ENABLED` until Sandbox tests with real Asaas payment events and Firestore projection are complete.
- `BILLING_PIX_ENABLED=true` works only in DEV, only for `BILLING_CHECKOUT_TEST_UID`, and only with a valid Sandbox API key, webhook token and existing billing enablement.
- The existing CREDIT_CARD checkout remains `RECURRENT`, with no change to its subscription or renewal payload. PIX uses `DETACHED` and never creates automatic recurring subscriptions.
- Migration `0041_billing_payment_methods.sql` is additive. Historical rows default to CREDIT_CARD. The old ledger/history JSON for card remains backward compatible.

## Provider architecture
- `api/src/payments/provider.ts`: provider-neutral interface and domain payment types.
- `api/src/payments/asaas-adapter.ts`: Asaas API mapping and bounded provider responses.
- `api/src/billing-pix.ts`: server-verified manual period, idempotent payment ledger, refunds and projection.
- `api/src/billing-checkout-change.ts`: server-confirmed cancellation of an unpaid checkout before switching.
- Current card renewal/upgrade path is preserved. Do not replace it with a PIX-only flow.

## Financial invariants
1. Never activate access based on redirect parameters or an unsigned webhook payload.
2. Verify payments against the Asaas API and the server-owned checkout intent, customer, method and amount.
3. PIX `PENDING` and `CONFIRMED` never activate access. Only `RECEIVED` creates a manual period.
4. Idempotency is enforced with provider payment unique references, per-intent unique IDs and a transactional D1 batch.
5. Paid periods cannot be shortened by new purchases. Manual renewal extends from the end of the current verified period.
6. Existing recurring credit card contracts block concurrent PIX access grants.
7. A canceled checkout is kept in the ledger for audit and late-event recovery.
8. Refunds must affect only the linked manual purchase, not unrelated card payments.
9. Any ambiguous provider state is held for review, never silently interpreted as a successful payment or cancellation.
10. Production cannot use PIX until a separately reviewed implementation and configuration rollout.

## Validation and remaining acceptance gates
- Required CI: API tests, typecheck, migrations, Worker bundle, frontend build, isolated SaaS E2E.
- In Sandbox: create/return/cancel a PIX checkout, complete a real PIX, observe RECEIVED and Firestore projection, verify manual renewal and payment history.
- Test simultaneous checkout switching and late provider webhook races.
- Test real provider cancellation response schema and return URLs before allowing customer traffic.
- Confirm refund behavior, including partial refunds, for the account's actual Asaas status lifecycle.
- Validate the responsive deletion modal on light/dark mobile and desktop.
- Do not merge the PR if any checks fail or financial edge cases are unresolved.

## Operational recovery
- For ambiguous checkout creation, retain the pending intent and await webhook/reconciliation; do not repost.
- For ambiguous cancellation, leave the original checkout protected; do not offer another purchase.
- For delayed PIX confirmation, show verification status and do not grant workspace access until the verified projection is available.
- To disable new PIX attempts immediately, remove/disable `BILLING_PIX_ENABLED`; preserve webhook processing for any previously created payments.
