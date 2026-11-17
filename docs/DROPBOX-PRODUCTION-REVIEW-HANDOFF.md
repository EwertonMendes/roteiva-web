# Dropbox production-review handoff (2026-11-17)

The Dropbox review refusal on 2026-11-16 did **not** report a Dropbox API violation. The reviewer could not finish Google sign-in / first workspace load and saw: "Não foi possível salvar ou carregar os dados. Recarregue para recuperar a versão salva."

## Engineering corrections
- Confirm missing profiles with authenticated, Firestore-Rules-enforced server reads. Recover from transient SDK/persistence/Auth handoff errors. Do not synthesize profiles or grant access on errors.
- Treat the D1 account-deletion status check as part of the first-login read-only bootstrap. A missing profile **must not** bypass a pending deletion; transient failures retry, permanent failure blocks registration.
- When registration commit has an uncertain outcome, **read** the authoritative profile to verify before reporting failure. Never replay an uncertain write.
- Classify HTTP status/transport errors; log only error codes and stages, never user identifiers, tokens, response bodies or credentials.
- Browser regressions cover a new Google identity, a transient deletion-status outage and a permanent outage. These run on the emulator, **not production**.

## External acceptance (mandatory before Dropbox resubmission)
1. Test an entirely fresh Google identity on real https://roteiva.com in a clean Chrome profile, not an already-signed-in QA session. Collect privacy-safe network statuses and sanitized console diagnostics on failures.
2. Confirm registration, active Roteiva entitlement, Dashboard, Biblioteca, Dropbox OAuth, list folders/files, previews (image/video/PDF), uploads to a dedicated disposable Dropbox folder, reconnect and disconnect; test desktop/mobile.
3. In Dropbox Developer Console check the PROD app **Roteiva**, not Roteiva DEV: redirect `https://api.roteiva.com/oauth/dropbox/callback`, name, logo assets, privacy policy, support, and scopes `account_info.read files.metadata.read files.content.read files.content.write`. Do not add sharing/admin permissions.
4. Explain why Full Dropbox is needed: customers choose existing folders throughout their own Dropbox account. The private Roteiva review portal does not issue public Dropbox shares.
5. Provide a publicly reachable URL, English step-by-step test instructions, and a dedicated test Google identity where required. **Never** commit passwords, refresh tokens, auth browser states or provider credentials. Transmit review credentials by a secure channel, and verify any test account has access beyond seven days if the review may take longer.
6. Keep release separation: merge only after green checks and real DEV smoke; promote to PROD only after owner approval and both production environment approvals. Validate live PROD after deploy; code CI/emulator passes alone do not demonstrate external access.
7. Send updated request through Dropbox Developer Console or to `api-program@dropbox.com` referencing the rejection. Record the request date, exact evidence tested, receipt/confirmation, and follow up with the reviewer if access is blocked.

## Limitations
Repository edits cannot validate real Google and Dropbox accounts, external console settings, protected secrets or live production deployment. Never claim production readiness or approval before those tests pass.
