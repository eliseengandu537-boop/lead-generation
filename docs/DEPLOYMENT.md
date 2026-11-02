# Deployment

The application needs a Node web server, PostgreSQL, n8n and a Node queue worker. The selected $0 hosting setup places the web app on Render Free and the database on Neon Free; n8n and the worker run on the user's computer. Automation runs only while that computer is awake and the worker is running. A static website host cannot run this application.

The deployed app is [Concrete](https://orbit-lead-generation.onrender.com). Hosted health, administrator sign-in, desktop/mobile rendering and a complete queued report through local n8n/worker have been verified. Local login details are stored in the ignored `.local/hosted-admin-login.txt`; local n8n login details are in `.local/local-automation-login.txt`. Secrets are not committed. Provider setup below is still required for real email sending.

## Server setup

### Render deployment

The root `render.yaml` defines only a free web service in Frankfurt. It does not request a paid worker or a Render database. Render Free sleeps after 15 idle minutes and can take about a minute to wake. The workflow HTTP timeout accommodates that startup. Do not substitute Render's free PostgreSQL database for durable storage without accounting for its 30-day expiry.

Create a new Neon project on its Free plan with PostgreSQL 17. Keep its database owner connection private; use the direct connection for migration/bootstrap. Roles created through SQL are deliberately restricted, unlike roles created through the Neon Console/API. The application provisions its tenant runtime role through SQL and verifies that it cannot bypass tenant isolation. Do not use the owner or a Neon console-created privileged role as `TENANT_DATABASE_URL`.

After the source is published to GitHub, open the Blueprint creation link for that repository or create the single free web service through the authenticated Render CLI/API. Set `DATABASE_URL` to the private Neon connection, enter `BOOTSTRAP_ADMIN_EMAIL` and choose a unique administrator password of at least 16 characters. Generate stable `NEXTAUTH_SECRET`, `PLATFORM_ENCRYPTION_SEED`, `TENANT_DATABASE_PASSWORD` and `N8N_WEBHOOK_SECRET` values. The Blueprint can generate those secrets, while direct provisioning supplies cryptographically random values privately. The application derives its public HTTPS URL from Render's service metadata. `ORBIT_AUTOMATION_LOCATION=local` lets the hosted web app accept authenticated workflow admissions without pretending it can contact n8n on the user's computer.

The web startup command applies migrations, provisions the restricted tenant login and creates the initial administrator only when there are no users. Repeat startups never reset passwords or promote existing accounts. The local worker waits for database bootstrap. Existing local data and the verified replacement backup are not uploaded or changed automatically; migrate preserved records separately through an approved database transfer if required.

After signing in, remove `BOOTSTRAP_ADMIN_PASSWORD` from the web service's environment. Keep authentication and encryption secrets stable. Google OAuth, transactional account email, verification and activated n8n workflows still need their real credentials before those operations can run. Live sending remains off until the real mailbox and recipients are explicitly approved.

### Account verification and password-reset email

Account email supports Resend and Brevo through their HTTPS APIs. Select `IDENTITY_EMAIL_PROVIDER=RESEND` with `RESEND_API_KEY`, or `IDENTITY_EMAIL_PROVIDER=BREVO` with `BREVO_API_KEY`. Set `IDENTITY_FROM_EMAIL` to the plain, verified sender email address. Configure the same provider and sender privately on Render and in `.local/hosted-worker.env`, redeploy the web service, and restart the local worker. Account registration requires these settings; the local worker must be online to deliver verification and reset links.

Resend requires a verified domain. Brevo can temporarily rewrite a verified Gmail sender to its own sending domain; account and transactional sending activation still apply. Register at https://onboarding.brevo.com/, verify the account, add a sender named Concrete, and verify its email. Create an API key with transactional sending permissions, not an SMTP key. Never publish provider keys or enter them in chat. Provider acceptance must be checked with a real test, and inbox receipt remains a separate check.

Keep pending account email drained or expired before changing providers. Brevo retries expire after ten minutes, inside its provider deduplication period; Resend retries expire after six hours. After an expired email, request a fresh verification/reset link. This setting controls account emails only; client campaign mail still uses each client's authorised mailbox.

SMTP is also supported for account email. For Brevo SMTP, use `IDENTITY_EMAIL_PROVIDER=SMTP`, `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, the Login shown in Brevo's SMTP tab as `SMTP_USER`, and a generated SMTP key as `SMTP_PASSWORD`. Keep these credentials only in the private local worker configuration. Port 587 requires STARTTLS and validated certificates; port 465 requires `SMTP_SECURE=true`.

Render Free blocks standard SMTP ports, so SMTP delivery runs on the local worker. After the local connection and an actual test message pass, set only `IDENTITY_EMAIL_PROVIDER=SMTP`, the verified `IDENTITY_FROM_EMAIL`, and `IDENTITY_SMTP_READY=true` on Render. This enables registration to enqueue mail without copying the SMTP key to the web service. The computer and worker must stay online to deliver queued messages. SMTP has no guaranteed deduplication: uncertain or interrupted attempts are marked failed and are never automatically resent. Request a fresh account link after such a failure.

### Local automation for the hosted app

Use a separate ignored `.local/hosted-worker.env`; do not overwrite the existing `.env`. It contains the same hosted `DATABASE_URL`, `NEXTAUTH_SECRET`, `PLATFORM_ENCRYPTION_SEED`, `TENANT_DATABASE_PASSWORD`, and `N8N_WEBHOOK_SECRET`, plus `NEXTAUTH_URL` set to the actual public app origin. Add a stable random `N8N_ENCRYPTION_KEY`, `N8N_BASE_URL=http://127.0.0.1:5678`, `ORBIT_AUTOMATION_LOCATION=local`, `WORKER_POLL_MS=60000`, and `LIVE_EMAIL_ENABLED=false`. Copy configured Google/verification/transactional provider settings privately when those become available. Bootstrap administrator credentials are not needed by the worker.

The launcher derives the restricted database URL and shared encryption key exclusively from that private hosted configuration. It clears unrelated inherited platform settings and explicitly sets the control URL so Prisma cannot import the original local database settings. It uses Neon's pooled hostname for local worker connections, while web migration/bootstrap retains the direct database URL.

`npm run automation:check` validates configuration without starting work. `npm run automation:start` starts the dedicated `orbit-local-automation` Docker Compose project with `docker-compose.n8n.local.yml` and then the queue worker. n8n's editor is available only at `http://localhost:5678`; its separate named volume preserves workflows and credentials. Set up its local owner, import the twelve workflow exports, configure the shared header credential, and publish each workflow. Verify webhook authentication and a harmless queued report before claiming activation. No public tunnel, router port forwarding, or cloud worker is required: the local worker calls local n8n, and n8n calls the hosted app's capability-protected admission/status endpoints.

Keep the terminal open and computer awake while automations should run. `Ctrl+C` stops the worker; `npm run automation:stop` stops n8n without deleting its volume. Closing the computer queues new work until it is restarted. Review interrupted jobs before retrying; uncertain sends are never resent automatically. Free database compute/storage and Render usage limits still apply, and continuous polling consumes Neon compute while the computer is online. Provider accounts can have separate limits or charges. This is a limited small-use setup, not a promise of unlimited free SaaS capacity.

The Render CLI validation command requires a separate CLI login, independent of the connected Render app. Where that login is unavailable, validate against Render's downloaded current JSON Schema and review the Blueprint in Render before applying it.

### Other server hosts

1. Create the web and worker services from the same source revision using the included Dockerfile, or build with `npm ci && npm run db:generate && npm run build`.
2. Preserve the database and secrets. Take a fresh custom-format dump and test restoration in an independent database before production migration.
3. Run `npm run db:migrate` once with the migration/database-owner credential. Historical tables remain intentionally archived.
4. Provision separate control and tenant logins. The control service must inherit `crm_control` for infrastructure operations; the tenant login inherits only `crm_tenant`. Set `DATABASE_URL`, optional `CONTROL_DATABASE_URL`, and mandatory `TENANT_DATABASE_URL` in both services' secret stores. Do not run normal tenant traffic with a table-owner URL.
5. Set `NEXTAUTH_URL` to the public HTTPS origin, `NEXTAUTH_SECRET` to a strong random secret and `ENCRYPTION_KEY` to a stable 64-character hex key. Losing that encryption key loses access to encrypted OAuth/provider credentials.
6. Start the web service with `npm start` and the worker with `npm run worker`. The web port follows `PORT` (default 3100). Health check: `/api/platform/health` checks the database and tenant role configuration.
7. Use HTTPS at the reverse proxy. Preserve secure cookies and the configured origin. The production Docker Compose retains the existing database service and volume names to avoid inadvertently replacing storage.

The runtime SQL roles must be created by the database administrator. Example role attributes: `LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`; grant `crm_tenant` to the tenant login. Grant `crm_control` only to the control login. Do not grant ownership, privilege escalation, or cross-role membership to the tenant login. Use your host's secret input for passwords; do not put credentials in shell history or versioned files. The local provisioning helper refuses non-local and production databases.

## n8n

`npm run n8n:generate` produces twelve inactive workflow exports. Import them into your tested n8n version. In every webhook, select an HTTP Header Auth credential named `Concrete webhook authentication`, header name `X-Orbit-Secret`, value equal to the platform's `N8N_WEBHOOK_SECRET`. Replace the exported placeholder credential reference. Validate the nodes and activate the workflows. Use the production `/webhook/orbit-...` paths, not test-webhook paths.

Each workflow receives only job identity and a job-scoped token. It asks the platform to admit the durable job, waits, and polls the actual status until terminal. The authenticated HTTP request returns quickly; the Node worker performs the lengthy operation. A workflow never writes invented success results. Retain execution timeouts and disable successful/error execution payload retention because job capabilities are sensitive.

For fully hosted n8n, set `N8N_BASE_URL` to its HTTPS origin and `N8N_WEBHOOK_SECRET` to 32+ characters in web and worker. For the selected local setup, use the separate instructions above. `NEXTAUTH_URL` must be reachable from n8n. `docker-compose.n8n.yml` supplies an optional isolated n8n database, persistent volume and externally supplied image version for other hosts. On this computer, a dedicated n8n 3.0.0 instance has twelve published workflows; authentication and report admission/status callbacks passed a transport test using harmless fixtures. Real provider operations remain unverified.

The workflow authentication follows [n8n's official webhook configuration](https://github.com/n8n-io/skills/blob/main/skills/n8n-node-configuration-official/references/WEBHOOK_NODES.md); credential handling follows [its official HTTP request guidance](https://docs.n8n.io/integrations/builtin/credentials/httprequest/).

## Real provider setup

Configure Google OAuth for a web application with the exact redirect URI `https://YOUR_HOST/api/platform/oauth/google/callback`. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on web and worker. Google may require consent-screen verification for the requested Gmail read/send scopes. The client connects its business website, approves its profile and authorizes the matching business-domain mailbox. A platform account address is never substituted as the client's outreach sender.

Configure a verified Resend sender using `RESEND_API_KEY` and `IDENTITY_FROM_EMAIL` for registration/reset emails. The worker sends that transactional outbox independently of n8n. Clients add their own Brave Search and OpenAI keys in Website settings. These keys stay encrypted server-side and are never returned to the browser.

An approved verifier adapter must expose HTTPS `POST {"email":"address"}` with `Authorization: Bearer EMAIL_VERIFICATION_API_KEY`, returning the same email and `VALID`, `INVALID`, `RISKY` or `UNKNOWN`. Configure its URL with `EMAIL_VERIFICATION_URL`. Merely finding a public email never establishes consent or marks it verified.

## First live acceptance test

After all services are configured, test website analysis, discovery and qualification using a small permitted business search. Review the evidence and profile. Connect the client's mailbox. Use a recipient who has explicitly approved this test, record the actual consent, verify the address and review the exact message/sequence. Enable live delivery globally and for that mailbox, approve the campaign, then start it. Verify provider acceptance in Gmail, a real reply, stopped follow-ups and a signed unsubscribe. Confirm actual results against reports. This live acceptance test has not been performed by the local automated tests.

Gmail does not supply delivery/open tracking or complaint webhooks as implemented here. Structured DSNs are processed; a trusted external bridge may submit supported normalized events to `/api/platform/provider-feedback/MAILBOX_ID`, signed with `EMAIL_FEEDBACK_SECRET`. HMAC input is `TIMESTAMP.MAILBOX_ID.RAW_BODY`, SHA-256 hex, timestamp within five minutes; headers are documented by the route. The endpoint rejects fabricated Gmail delivery events. Payment checkout and automatic payment reconciliation are not implemented; configure plans and record verified billing references through platform administration.
