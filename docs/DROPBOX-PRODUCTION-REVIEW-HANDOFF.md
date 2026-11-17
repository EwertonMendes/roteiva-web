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

## Reviewer instructions (draft; release only after live acceptance)

Roteiva helps creative professionals organize projects, files and client approvals. Original files remain in the selected storage provider. Roteiva stores project information and file references; access is controlled by the user's permissions and Roteiva's authorization checks.

1. Open https://roteiva.com in a normal browser window. Select **Criar conta** (Create account), then **Cadastrar com Google** (Sign up with Google). Choose your Google identity. If you already have a Roteiva profile, use **Entrar com Google** (Sign in with Google).
2. For a new profile, enter a professional name, optionally a studio name, choose your working style and confirm the data-use notice. Select **Criar meu espaço de trabalho** (Create my workspace). No payment card is required. New eligible identities receive a seven-day trial; contact support before testing if access has expired. A longer review entitlement must be verified before providing a dedicated reviewer account.
3. From the Dashboard, select **Projetos** (Projects) and create a project with fictitious information. Then open **Biblioteca** (Library) and choose that project using the project selector.
4. Select **Contas** (Accounts). In Dropbox, choose **Adicionar conta** (Add account). Sign in to your own Dropbox account, review the requested permissions and approve only if you agree. Return to Roteiva; the account should be listed as **Conectada** (Connected).
5. Close the accounts panel. Use **Adicionar** (Add) to select existing Dropbox files or import an existing folder. Choose your connected Dropbox account, browse folders and subfolders, and select disposable review materials. Review the selection before importing references into your project.
6. Open an image, PDF or video from the Library to preview it. For videos, test playback and seeking. For PDFs, test page navigation and zoom. Use a dedicated Dropbox test folder and synthetic materials for uploads; choose the upload action under **Adicionar** and confirm the destination before sending a file. Verify the uploaded file independently in Dropbox.
7. Files displayed under the selected project are linked to that project. Under **Aprovações** (Approvals), create a test approval using the project and an authorized file, then open the generated review-room link. Follow the room's configured access method. Test preview and comments using fictitious content. Do not send invitations to unrelated people.
8. Reload Roteiva and return to the Library to verify the connection and project references persist. You may add a second Dropbox account from **Contas** without replacing the first.
9. To disconnect, open **Contas** and select **Desconectar** (Disconnect) beside the intended Dropbox identity. Review any warning about dependent projects or approvals before confirming. Disconnecting does not authorize deleting your original Dropbox files.

Privacy: https://roteiva.com/privacidade.html. Support: https://roteiva.com/suporte.html. Product information: https://roteiva.com/sobre.html.

### Permissions and access type

- `account_info.read`: identify the connected Dropbox account and distinguish multiple accounts.
- `files.metadata.read`: browse selected folders and list file metadata.
- `files.content.read`: retrieve authorized file content and previews.
- `files.content.write`: upload user-selected files to the selected Dropbox destination.

Full Dropbox is required because customers select existing folders and files throughout their own Dropbox account, rather than only a new application folder. Roteiva uses these materials in projects and approval workflows. No team administration, public-sharing or permanent-deletion scope is requested.

### Resubmission gate

Do not submit this draft as a statement of successful QA. Record the exact deployed SHA, real first-signup outcome, reviewed identity/entitlement arrangement, provider test results and remaining limitations first. Do not share the owner's support mailbox or personal account credentials as a reviewer identity. Provide dedicated credentials only through an approved secure channel, if needed.
