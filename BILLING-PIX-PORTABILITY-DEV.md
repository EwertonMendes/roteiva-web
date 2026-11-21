# Billing PIX + payment-provider portability (DEV only)

## Deployment safety
- Scope: GitHub PR #201. Production remains unchanged until separate approval.
- Enable `BILLING_PIX_ENABLED` only for configured DEV testers during homologation. Keep general checkout access disabled.
- `BILLING_PIX_ENABLED=true` works only in DEV, only for UIDs in `BILLING_CHECKOUT_TEST_UIDS` (comma-separated) or the legacy `BILLING_CHECKOUT_TEST_UID`, and only with a valid Sandbox API key, webhook token and existing billing enablement.
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

| Checkout evidence | User action | Server action |
| --- | --- | --- |
| In flight without provider ID | Refresh, then contact support if it stays unresolved after expiry | Keep the unique intent and await an authenticated event. Never repeat the create POST. |
| Open with provider ID and valid link | Resume or request a switch | Persist one close job per intent before contacting the provider. |
| Expired locally with provider ID | Refresh or request a switch | Schedule the same close job. The local clock only stops presenting the old payment link. |
| Close requested, terminal result uncertain | Follow the status, then contact support if review is required | Retry with backoff. Keep the intent and retain its payment lease. |
| Payment visible or an authenticated paid event received | Follow the pending settlement | Reconcile using verified payment data. Keep the intent blocked if payment evidence is incomplete. |
| Authenticated terminal event or verified cancel result, no payment | Start another purchase if eligible | Close the intent after checking the provider and local ledger. Preserve its IDs for late events. |
| Rejected create with definitive provider 400 | Select an available payment method | Mark the intent failed without opening a new attempt. |

Late confirmations can recover a closed intent when no competing checkout or contract exists. A conflict remains in review for financial reconciliation. Removing a UID from the QA list blocks new purchases from that account. It preserves owner-scoped recovery and reconciliation of existing activity. Redirect parameters are consumed once and do not grant access.

### Commercial policy in DEV

A verified manual Pix payment can extend an existing manual period. A live card recurrence or a remaining card period blocks a new Pix purchase. The customer can cancel renewal and contract after that paid period expires. Card recurrence starts only after existing access ends. Future automatic switches and scheduled downgrades remain outside this policy.

### Initial provider and ledger evidence

On 21/11/2026, Chrome showed an expired-access account with a contradictory callback message and no checkout action. After the provider terminal event and a reload, the old attempt was no longer open in D1. The same screen still showed checkout unavailable because a different account had replaced it in the single-UID flag.

Asaas Sandbox request logs showed that the two HTTP 400 responses on 20/11 were returned for a missing Pix key. The request used the documented PIX/DETACHED combination. The Sandbox accepted registration of an EVP key and showed it as pending. No QR generation or PIX settlement can be marked complete based on this evidence. [Checkout para Pix](https://docs.asaas.com/docs/checkout-para-pix) · [FAQ Sandbox](https://docs.asaas.com/docs/faq-sandbox).

The D1 audit found seven `CHECKOUT_PAID` reviews exhausted with `billing_payment_not_visible`. Each was linked to a completed checkout with a verified ledger entry. Six were refunded and one remained confirmed. The worker can now close this redundant event once from already verified ledger evidence. This does not replay charges, refunds or access. A paid signal without a ledger continues to block checkout closure.

For operations, monitor pending or review counts by event type, maximum pending age, and projection retry exhaustion. Check the associated intent, remote payment and ledger before changing any queue record. A DEV Time Travel bookmark was captured before promotion. Prefer rolling back compatible Worker and Hosting releases on the current D1 data and turning off new payments independently of webhooks. Restoring the database to a pre-payment point requires separately reconciling later provider activity.

**No-go for PROD while Sandbox acceptance remains incomplete.** Migration 0041 stays DEV-only. Production needs separate credentials, endpoints, migration review, rollout, provider verification, and explicit approval.
