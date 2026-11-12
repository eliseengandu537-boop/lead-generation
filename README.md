# Monettic

Multi-tenant business research, lead qualification, approved email campaigns and reply management. This replaces the previous CRM application. All figures come from the new platform's actual records; there is no demonstration mode or sample-business seed.

Live app: [Monettic](https://orbit-lead-generation.onrender.com). Hosting uses Render Free and Neon Free, with automation on the local computer. Real sending still requires the provider and client mailbox configuration below.

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

To create a client login, open **Admin → Clients → Create client login**. Enter the client's name and email, then select their existing business or create a new business. Monettic generates a strong password and displays it in the creation result. Copy or download the details and share them privately with the client; they can sign in immediately. Passwords are stored as bcrypt hashes and cannot be retrieved later. Existing email accounts are not overwritten. Clients can use **Forgot password** to choose a new password through their email account. This action creates portal access only and does not send email or activate campaigns.

## Connect real services

**Admin → Clients → Edit client** opens the business settings form. Website inspection also links directly to the website profile, lead editor and campaign controls. **Admin → Email Outreach → Create and send campaign** opens the selected business's campaign page. Campaigns and email outreach share one navigation area. Its **Create and send** form collects the sender, recipients, message, follow-ups and sending window, then previews every personalised email. The final **Create and send** action saves, approves and queues the campaign in one database transaction; it does not require saving a draft first. Missing sending setup is listed before launch and blocks the action without creating an unwanted draft. A review becomes invalid if its content or eligibility changes. Retrying the same request cannot create a second campaign. Queued campaigns still require the local sending worker to be online.

**Admin → AI Assistant** opens a normal chat powered by OpenAI's Responses API. **Working with → All clients** handles platform-wide requests; selecting a client binds the command's existing-business tools to that client. Every active client appears automatically. Prompts have no hardcoded business. **Add client** opens client login creation directly, and selecting a client reveals **Create and send campaign** independently of AI availability. Conversation history remains private to the administrator who created it.

Open **AI settings** to save an OpenAI API key; a small request tests it before the key is stored encrypted. Keys rejected for authentication or model access are not saved. A valid key without credit is saved with an explicit **API credit needed** status, and no success or action is fabricated. **Send message** can be retried after adding credit. The composer is editable before connection; **Connect OpenAI to chat** opens AI settings and preserves the message. The default model is GPT-4.1 mini. Requests use `store: false` and serialized function calls. Model output cannot bypass the backend's roles, tenant scope, eligibility or sending checks. See [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling).

The assistant reads the actual client directory, creates requested client logins, prepares campaigns, pauses campaigns and queues supported research. It never receives generated passwords. New logins are available privately from their action cards for 30 minutes. Chat-assisted sending requires review of the actual sender, recipients, email content and follow-ups, then the administrator's **Approve and launch campaign** action. The direct **Create and send** composer provides review and launch in one flow. Chat is separate from each business's research connection. An email address alone does not connect or authorise a mailbox; the client signs in to Google Workspace or Microsoft 365 to authorise it.

- **Website → Research connections:** each client stores its own encrypted Brave Search and OpenAI keys.
- **Google Cloud OAuth:** configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the exact callback `/api/platform/oauth/google/callback`. Each client authorizes its own Google Workspace mailbox matching its website domain. Outreach comes from that client mailbox.
- **Microsoft 365:** configure `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` and the exact callback `/api/platform/oauth/microsoft/callback` from a Microsoft Entra app registration. Each client authorizes its own Microsoft 365 mailbox matching its website domain; its administrator may need to approve the app once. See [deployment](docs/DEPLOYMENT.md#real-provider-setup).
- **Email verification:** a free DNS check marks dead domains `INVALID`. For mailbox-level checks set `EMAIL_VERIFICATION_PROVIDER` to `millionverifier` or `zerobounce` with `EMAIL_VERIFICATION_API_KEY`, or to `gateway` with your own HTTPS adapter at `EMAIL_VERIFICATION_URL`. **My Leads → Verify emails** queues every unverified or stale address.
- **Permission requests (POPIA):** **Create and send → One-time permission request** asks verified, qualified leads once, with no follow-ups. A clear yes reply records consent with the reply as evidence; other replies are flagged for review. See [asking for permission](docs/DEPLOYMENT.md#asking-for-permission-popia).
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

## Caller workspaces

**Admin → Call Centre** creates caller logins, privately connects business websites and configures automatic calling queues. Callers sign in through `/login` and go to `/caller`, with only **My day, Find leads, My calls and My meetings**. They see Monettic branding and their prospects; website setup, client portals and email outreach remain outside their access. **Find leads** accepts any typed business category and a South African town, suburb or province; **South Africa** searches nationwide across all nine provinces. Research prepares public Overture listings with phone numbers and no website listed, without an AI/search key. Source evidence is saved and the caller confirms website needs. The local worker must stay online; admin scope, daily and queue limits apply.

After an interested call, available South African meeting slots open automatically. Saving a prospect-agreed appointment reserves the host, adds an admin bell notification and optionally queues a transactional admin email. Calendar invitations can be downloaded and shared separately. Admin reporting distinguishes caller-reported phone logs from provider-confirmed browser calls. Client portal logins retain their existing experience.

A normal Vodacom SIM opens a `tel:` phone handoff and records caller-reported outcomes. Browser calling uses an optional, existing Twilio Voice account configured per business in Call Centre; Monettic never buys a calling number automatically. Provider-confirmed call events are reported separately from manual phone logs. See [caller setup and operation](docs/CALL-CENTRE.md) for configuration, verification and remaining service requirements.
