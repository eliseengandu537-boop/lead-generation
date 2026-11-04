# Concrete

Multi-tenant business research, lead qualification, approved email campaigns and reply management. This replaces the previous CRM application. All figures come from the new platform's actual records; there is no demonstration mode or sample-business seed.

Live app: [Concrete](https://orbit-lead-generation.onrender.com). Hosting uses Render Free and Neon Free, with automation on the local computer. Real sending still requires the provider and client mailbox configuration below.

[Deploy this repository on Render](https://dashboard.render.com/blueprint/new?repo=https://github.com/eliseengandu537-boop/lead-generation). The default Blueprint requests only a free web service. Supply a private connection to a free Neon database, your administrator email and a unique 16+ character password. n8n and the worker run on your computer while it stays online. Free usage limits and provider costs still apply; see [deployment instructions](docs/DEPLOYMENT.md).

## Run

Use Node 22.9+ and PostgreSQL. Preserve the existing `.env`; use `.env.example` only for a new environment.

```powershell
npm ci
npm run db:generate
npm run db:migrate
npm run dev
```

The local application is at **http://localhost:3100**. Run `npm run worker` in a separate terminal. Production uses `npm run build` followed by `npm start`, alongside the same worker.

For the hosted app with local automation, use `npm run automation:check` and `npm run automation:start` after configuring the separate ignored `.local/hosted-worker.env`. This starts loopback-only n8n and the worker against the hosted database. `Ctrl+C` stops the worker; `npm run automation:stop` stops n8n. Your original local `.env` is preserved. The hosted app remains accessible when the computer is off; automation waits in PostgreSQL until the worker resumes.

`TENANT_DATABASE_URL` is mandatory. It must use a separate, restricted login inheriting `crm_tenant`, without table ownership, superuser, BYPASSRLS or `crm_control` membership. For a local database only, `node --env-file=.env --import tsx scripts/provision-local-tenant-db.ts` provisions that login and updates the ignored `.env`. This rotates its password; restart web and worker afterward.

Existing user accounts are preserved. Each new business workspace has independent data and a configurable trial allowance. `npm run admin:create` creates a new platform administrator from temporary `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`; it never changes an existing account.

Clients receive a separate results portal for their leads, campaigns, conversations, website profile and reports. Only platform administrators manage integrations, automation, sending, teams and workspace configuration. Legacy client administrator memberships also use the results portal; they cannot access the operational APIs. New client access uses the CLIENT_VIEWER role.

To create a client login, open **Admin → Clients → Create client login**. Enter the client's name and email, then select their existing business or create a new business. Concrete generates a strong password and displays it in the creation result. Copy or download the details and share them privately with the client; they can sign in immediately. Passwords are stored as bcrypt hashes and cannot be retrieved later. Existing email accounts are not overwritten. Clients can use **Forgot password** to choose a new password through their email account. This action creates portal access only and does not send email or activate campaigns.

## Connect real services

**Admin → AI Assistant** connects Claude to real operations. Enter an Anthropic API key in its separate connection form; a small API request verifies the key before it is stored encrypted. Claude can read the actual client directory, create requested client logins, save campaign drafts, pause campaigns and queue supported research. It never receives generated passwords. New logins are available privately from their action cards for 30 minutes. Sending requires a separate review of the actual sender, recipients, email content and follow-ups, then the administrator's **Approve and launch campaign** action. All existing sending and subscription checks still apply. Claude chat is separate from the business research connections below. It stays disconnected until an API key is supplied; a Claude chat subscription does not configure this API connection.

- **Website → Research connections:** each client stores its own encrypted Brave Search and OpenAI keys.
- **Google Cloud OAuth:** configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the exact callback `/api/platform/oauth/google/callback`. Each client authorizes its own Google Workspace mailbox matching its website domain. Outreach comes from that client mailbox.
- **Email verification gateway:** configure `EMAIL_VERIFICATION_URL` and `EMAIL_VERIFICATION_API_KEY`. The HTTPS gateway accepts `POST { email }` with bearer authorization and returns `{ email, status: VALID|INVALID|RISKY|UNKNOWN }`.
- **Account verification/reset:** configure `RESEND_API_KEY` and a verified `IDENTITY_FROM_EMAIL`. These transactional account emails are separate from client outreach. Registration fails clearly until configured.
- **n8n:** configure `N8N_BASE_URL` and a 32+ character `N8N_WEBHOOK_SECRET`; import the twelve workflows under `n8n/workflows`, configure their Header Auth credential and activate them. The worker executes admitted durable jobs. No credentials or email content are sent to n8n.
- **Live sending:** requires `LIVE_EMAIL_ENABLED=true`, an approved website profile, an explicitly enabled client mailbox, exact content approval, recent verification, sufficient qualification, documented consent, an active subscription allowance and no suppression or prior reply.

Missing configuration is shown honestly. Queued work is not reported as completed. Payment collection is not connected; administrators can configure plans and record verified billing references.

## Validate

```powershell
npm test
npm run test:integration
npm run typecheck
npm run lint
npm run build
```

The integration check requires the app running on port 3100 and the configured local database. It creates isolated temporary businesses, exercises PostgreSQL RLS, authentication, tenant APIs, email reservations, mocked Gmail replies, suppression and durable jobs, then removes its own fixtures. It never sends real email. Live-provider acceptance still needs a configured hosted environment and an explicitly approved recipient.

See [architecture and replacement safety](docs/ARCHITECTURE.md), [deployment and service configuration](docs/DEPLOYMENT.md), and [verification evidence and remaining limits](docs/VERIFICATION.md).

The interface includes persistent light/dark appearances, separate client and administrator navigation, website management, interactive performance charts, approval previews and automation monitoring. See the [interface system](docs/DESIGN.md). Desktop/mobile screenshots are under `artifacts/orbit`.
