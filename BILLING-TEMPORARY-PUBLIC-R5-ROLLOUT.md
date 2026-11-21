# Public R$5 billing test — temporary PROD rollout

## Goal and safety boundary

The owner explicitly authorized opening the temporary **R$ 5,00 per month** offer to **all otherwise eligible, authenticated production accounts** to test real Asaas charges. This replaces the previous single-UID restriction *only while a separate, explicit public rollout is active*. It does not change normal plan prices, D1 financial constraints, or entitlements.

**Real money.** Asaas' published minimum per charge is R$5.00; provider fees may apply. A credit-card purchase creates an **actual automatically recurring monthly subscription of R$5.00** until canceled. PIX is a **one-time R$5.00** payment with **manual** renewal. The Roteiva frontend must clearly show these terms and collect explicit consent before redirecting.

The standard monthly/quarterly/yearly plans remain respectively **R$39.90 / R$109.90 / R$399.90**. The distinct test offer is `{code:'test',version:'2026-11-private-test-v1',amountCents:500}`, and the Worker resolves it to canonical `monthly` + a trusted fixed 500-cent price, with a separate immutable pricing version. D1 does not need any new migration.

The browser cannot send a price, discount, customer UID, or gateway amount. POST `/billing/checkout` accepts only approved plan code, matching price catalog version, explicitly accepted billing consent, and optional payment method. Backend policy validates the authenticated UID, the exact account status, open checkout uniqueness and paid period fences. It sends the price to Asaas from **server code** and verifies reconciled payment amounts against the persisted immutable intent.

## One-run guarded deployment with no UID or manual environment-variable edits

1. Merge the PR after API + frontend + Playwright checks pass.
2. Run `Promote approved commit to PROD` (workflow `.github/workflows/production.yml`) from the **current approved master SHA**, with:
   - `confirmation=DEPLOY ROTEIVA PROD`
   - `public_test_billing=true` (NEW explicit owner-only temporary release)
   - `domain_cutover=false`
   - `billing_schema=false`
3. Approve the **cloudflare-production** and **firebase-production** protected environments in the GitHub Actions run.
4. The protected Worker job revalidates prod credentials, origins, D1 identity, billing schema and read-only Asaas PROD authentication. The explicit workflow input makes all four flags true **for that deployment**:
   - `BILLING_CHECKOUT_ENABLED`
   - `BILLING_PIX_ENABLED`
   - `BILLING_PUBLIC_ROLLOUT_ENABLED`
   - `BILLING_TEST_PLAN_ENABLED`

No `BILLING_TEST_PLAN_UID`, `BILLING_CHECKOUT_TEST_UIDS`, email, Firebase UID lookup, or Cloudflare manual patch is necessary for this explicitly approved public run.

**Temporary/kill switch:** the workflow input defaults to `false`. Future unrelated PROD deployments read the protected GitHub vars again and may disable checkout and the temporary test offer if those vars are false/missing. To end the R$5 public testing period deliberately, dispatch the same protected workflow with `public_test_billing=false` and the protected vars configured to disable `PRODUCTION_BILLING_TEST_PLAN_ENABLED` (and optionally `PRODUCTION_BILLING_CHECKOUT_ENABLED`, `PRODUCTION_BILLING_PIX_ENABLED` and `PRODUCTION_BILLING_PUBLIC_ROLLOUT_ENABLED`). This affects **only new checkouts**: never disable `PRODUCTION_BILLING_ENABLED=true`, webhook ingestion or reconciliation while any payment is pending.

## Verification procedure — real Asaas production

- Open `https://app.roteiva.com/configuracoes` under an otherwise eligible PROD account, including a new user still in their finite courtesy period.
- Enter Assinatura > Conhecer planos e contratar. All eligible accounts should see **Teste (temporário), R$5,00** alongside the original commercial prices. The normal monthly plan must remain R$39,90; a changed client request cannot lower its charge.
- Choose PIX, verify **R$5,00 one-time charge** in the Asaas-hosted checkout, pay a real PIX, and verify Asaas reports `RECEIVED` before Roteiva grants paid access. Verify exactly one receipt in `billing_payment_records`, one active period, correct `pricing_version` and `amount_cents=500`, and the PROD Firebase entitlement projection. A trial/courtesy expiry must be preserved as designed.
- For a different eligible account, choose cartão, verify **R$5,00 immediate recurring monthly**, and verify confirmed charge, D1 ledger, provider subscription, account paid-until, scheduled billing date, and successful cancellation. A second paid plan should remain blocked while the first is valid.
- Exercise a canceled or abandoned checkout, a success redirect without payment (must never grant), stale catalog version, malformed extra pricing fields (must fail), duplicate webhook, delayed webhook, and refunded payment handling. Inspect Cloudflare logs without exposing customer data or keys.
- During public testing, watch Asaas and Roteiva's billing queues for failed or review events; pause **new** checkout if reconciliation becomes uncertain.

**Caution:** A successful Asaas PIX payment link created outside the Roteiva integration does **not** prove that an Asaas-hosted Checkout PIX session is available to this account. Real end-to-end PIX must be verified once in the Roteiva UI; failed provider POST must not create an entitlement or phantom charge.

## Cleanup

Turn off the temporary offer in the next controlled PROD deployment. **Do not delete historic intent/ledger/subscriptions.** Cancel any R$5 auto-renewing card subscription through the UI, check cancellation directly with Asaas, and allow previously initiated PIX/card transactions to reconcile. Normal plans and real subscription rights must remain untouched.
