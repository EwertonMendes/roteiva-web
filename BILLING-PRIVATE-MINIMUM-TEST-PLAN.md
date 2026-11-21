# Private R$5 LIVE billing canary (PROD)

## Goal and price evidence

Asaas' official 19 Aug 2026 account-limits article establishes **R$ 5.00 per charge** for both PF and PJ accounts:
https://central.ajuda.asaas.com/hc/pt-br/articles/31972480144795

This is a **real-money** temporary offer, not a sandbox substitute. Fees may apply. It must never be published to ordinary users.

## Commercial and access invariants

- Standard monthly/trimestral/anual are unchanged: R$39.90 / R$109.90 / R$399.90.
- The owner-only offer is displayed as `test` with **R$5.00, one monthly period**.
- Checkout is a privileged operation on a Firebase-verified PROD UID; emails, frontend flags and request amounts never grant eligibility.
- The backend resolves `test` to the canonical `monthly` DB plan, with an immutable, distinct `2026-11-private-test-v1` pricing version and **500 BRL cents**. Thus no change to existing SQL CHECK constraints, historical records, subscriptions, rights or indexes is necessary.
- The provider adapter derives the amount from a trusted server-owned plan and version; never from client-supplied `value`, `price`, `amountCents`, `discountPercent`, etc. Unknown POST attributes are rejected.
- Open checkout reuse compares canonical code **and price/version/method**, so a cheap test checkout cannot be substituted for the commercial monthly plan.
- PIX is `DETACHED`, manually renewed after expiry. Recurring card is `RECURRENT` and **will auto-charge R$5 each month until the recurrence is canceled**. Removing the feature flag does NOT cancel existing customer/provider obligations.
- Both modes preserve active finite courtesy; paid periods cannot be stacked or bought repeatedly while still active. They require provider-verified settlement and idempotent ledger/projections.
- Only one UID may see/select the offer. Regular public plan discovery, payments, refunds and revocations remain unchanged.
- Do not change `access_accounts`, `access_subscriptions`, payment records, or the gateway's real payments to make another test eligible.

## GitHub protected configuration (not set by code deployment)

**Cloudflare production environment**, GitHub Actions `cloudflare-production`:

1. Identify the **Firebase Authentication UID in project `roteiva-web-prod`** for the single intended tester. Use Firebase Console -> Authentication -> Users, never an email or a DEV UID.
2. Set protected secrets:
   - `BILLING_CHECKOUT_TEST_UIDS` = exactly this PROD UID (may contain other canary UIDs, but only the separate exact UID below has the test price).
   - `BILLING_TEST_PLAN_UID` = this single exact PROD UID.
3. Set environment/repository Actions variables:
   - `PRODUCTION_BILLING_ENABLED=true` (already required by billing)
   - `PRODUCTION_BILLING_CHECKOUT_ENABLED=true` for a controlled canary
   - `PRODUCTION_BILLING_TEST_PLAN_ENABLED=true`
   - `PRODUCTION_BILLING_PIX_ENABLED=true` only when a controlled PIX test is approved
   - `PRODUCTION_BILLING_PUBLIC_ROLLOUT_ENABLED=false` until public sign-off
4. Trigger `Promote approved commit to PROD` on the **current approved master SHA**, with `confirmation=DEPLOY ROTEIVA PROD`, `billing_schema=false`, `domain_cutover=false`. Approve both protected environments. The workflow validates that the test UID is in the checkout canary allowlist, the gateway credentials are valid, and the environment is correctly bound before deploying secrets atomically.
5. A deployment without these secrets/flags is **safe but inactive**: the offer will not be visible and checkout will remain closed. No manual Cloudflare changes: the next Wrangler deployment can overwrite them.

## Controlled acceptance: use real money only on the named account

1. Confirm production API health, `app.roteiva.com` SHA, Firebase Auth and UI; check standard prices for another eligible user. The restricted plan must never appear on the other user's catalog (or in an unauthenticated `/billing/plans` call).
2. Sign in using the authorized PROD UID. In **Configurações > Assinatura > Conhecer planos e contratar**, see `Teste (temporário)` for **R$5,00**.
3. Select it, verify consent and next charge/expiry. For PIX: checkout must say **R$5,00, single payment, no automatic recurrence**. Pay a real PIX; verify Asaas's `CHECKOUT_PAID` and payment `RECEIVED` as appropriate.
4. Correlate one provider checkout/payment against `billing_checkout_intents`, `billing_payment_records`, `access_subscriptions`, `billing_webhook_events` and the PROD Firebase projection. Check `amount_cents=500`, `pricing_version='2026-11-private-test-v1'`, `plan_code='monthly'`. Check rights preserve remaining trial/grant days. Duplicate webhooks must leave **one** ledger record and one period.
5. To test recurring card on **another eligible test account** or after the first paid period ends, choose the test offer and verify R$5 recurring terms and provider subscription. Confirm renewal and cancellation; **cancel automatic renewal before removing the test feature**. Do not force expiry or adjust a genuine transaction in SQL.
6. Exercise a rejected checkout, wrong/extra payload price, owner UID mismatch, stale catalog version, pending order retry, returning from checkout without payment, abandoned checkout, duplicate/late event, refund and mobile layout. A redirected success URL alone must **never** unlock access.
7. Reconcile live webhook delivery and failure queues before considering wider billing activation. Do not deploy an unrestricted public R$5 offer. Never use Playwright against the real Asaas API.

## Disable/cleanup

- Set `PRODUCTION_BILLING_TEST_PLAN_ENABLED=false` and `PRODUCTION_BILLING_PIX_ENABLED=false` as needed; **keep `PRODUCTION_BILLING_ENABLED=true`** for webhook/reconciliation, and keep checkout canary until all in-flight payments close.
- Cancel test recurring card subscriptions through the app, verify Asaas confirms cancellation, and retain all ledger/history. Then remove the test UID and rollout flag from protected settings and publish via guarded workflow.
- Temporary offer removal only affects **new checkouts**, never historical payment evidence or an existing recurring agreement.
