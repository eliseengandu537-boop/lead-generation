# Architecture and replacement record

## Audit

The previous application used Next.js 15 App Router, React 19, TypeScript, Prisma 6, PostgreSQL, NextAuth credentials/JWT sessions, bcrypt, encrypted provider credentials, a Node worker and Docker deployment definitions. It had 37 public database tables at backup time. No Git repository or configured public deployment was present in the workspace.

The replacement retains the generic authentication, identity-token, cryptography, database and tenant infrastructure. The active application, navigation, components, business services, old API routes and previous workflows were removed and replaced with Concrete. Old user accounts, credentials, database contents and deployment storage remain preserved.

## Verified backup before removal

Source and a PostgreSQL custom-format dump were saved under `.local/replacement-backups/2026-11-01T18-38-27-159Z`. The dump SHA-256 is `43f7cf16508a14338838bd396fe6bcca304862fb9d7d7ee70cef1333dc65debd`.

The dump was restored into the separate local database `replacement_restore_1793558308053`. All 37 tables passed row-count and sorted full-row fingerprint comparison. The manifest records `RESTORE_VERIFIED`; `.local/replacement-backup.json` identifies the recovery location. Existing `.env` secrets were preserved in place, never printed or copied into source archives. Store a separate secure backup of those secrets before moving hosts.

Historical tables and migrations remain for recovery; the active Prisma schema does not expose old CRM models. Migration 016 revokes the tenant runtime role's access to legacy business tables. No legacy production table was dropped or repurposed. Do not use `prisma db push`, `migrate reset`, or an automatically generated schema-diff migration against this database: the intentionally preserved tables are absent from the active schema.

## Active modules

| Area           | Implementation                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Application    | `src/app` and `src/product`: new Concrete login, workspace selection, overview, research, leads, campaigns, inbox, templates, analytics, website, email, notifications, team, billing and settings           |
| Auth           | Existing user identities, bcrypt, eight-hour JWT sessions, session version invalidation, hashed single-use verification/reset tokens and encrypted transactional outbox                                      |
| Tenant data    | New `Platform*` models; independent organizations, encrypted provider credentials, leads, approvals, campaigns, mailbox messages, feedback, reports, usage and subscriptions                                 |
| Isolation      | PostgreSQL FORCE RLS; restricted pool; opaque, expiring database capabilities bound after server-side membership authorization; SQL cannot select a tenant using a fabricated plain setting                  |
| Research       | SSRF-resistant public website fetcher with DNS-pinned transport, robots handling, size/time limits, Brave Search, strict AI schemas and source-quote validation                                              |
| Email          | Domain-matched Google OAuth with PKCE/browser-bound state, encrypted refresh credentials, exact approved content, committed send reservations, stable message IDs and explicit uncertain-send reconciliation |
| Feedback       | Gmail reply matching and structured delivery-status failures; immediate suppression, stopped follow-ups, bounce/complaint safety thresholds; optional authenticated normalized feedback bridge               |
| Automation     | Durable `PlatformJob` queue, HMAC job capabilities, n8n admission/polling workflows and worker execution, bounded dispatch retries and review of uncertain results                                           |
| Analytics      | Actual accepted messages, recorded replies and supported feedback events; timezone-aware day grouping, date filters and CSV/print-to-PDF exports                                                             |
| Administration | Aggregate organization counts, access suspension, configurable plan prices/limits and manual verified subscription references                                                                                |

HTTP handlers authorize memberships before binding a tenant pool. Database RLS protects queries even when a business query omits a workspace filter. Workers claim globally through the control pool, then execute one operation inside a restricted tenant scope. Cross-tenant foreign keys supplement RLS.

### Client portal and operations

Non-platform-admin users render `src/product/client-portal.tsx`; platform administrators retain the operations application and Command Centre. The seven-page client portal reads only `/api/platform/[workspaceId]/portal`, where membership and workspace status are checked before tenant binding. Responses explicitly select business-facing fields, excluding provider credentials, internal job payloads, suggested drafts, approval identities and account settings. Raw operational resources and workspace creation require a platform administrator. Existing CLIENT_ADMIN and SALES_MEMBER memberships retain access to their own results, without the former management permissions. New client memberships use CLIENT_VIEWER. No user or client record is deleted or reassigned for this permission change.

Demo workspaces stay read-only and clearly label fictional activity. The results portal does not activate campaign sending, change existing campaigns or connect a mailbox. Website profiles describe outreach targeting; visitor analytics and website enquiry collection remain unconnected and are identified as such in the portal.

### Claude operations assistant

The administrator-only assistant uses Anthropic Messages API tool calls with a fixed application tool catalogue. Business text and tool results remain untrusted data. Global configuration, encrypted conversation history, request runs and action receipts use control-only RLS tables, with no tenant grants; conversation and action reads additionally require the owning administrator. Claude's key never enters a prompt or API read response. Users are directed to the separate connection form rather than asked for keys in chat.

Client creation and campaign drafts execute on requested commands. Client creation stores its encrypted, expiring credential receipt in the same transaction as the new user/membership. Campaign mutations use tenant-scoped encrypted operation receipts committed with the actual change. Replaying an operation returns its previous result; reusing its identifier with different content fails. Request IDs, conversation leases, provider/tool/action bounds and interrupted-request states prevent blind replays. Chat history and model tool results exclude generated passwords; only a separate authenticated, non-cacheable action response can reveal a new client's login for 30 minutes.

The model can only prepare a campaign launch review. The administrator separately reviews every selected recipient, personalized message, sender and follow-up before launching. A fingerprint binds reviewed content and eligibility to both approval and start transactions. Content changes invalidate the review, and existing global sending, mailbox-domain, qualification, verification, consent, suppression, subscription and scheduling controls remain authoritative. Launching queues work rather than proving provider acceptance or delivery. Chat cannot enable live sending, alter credentials/roles, establish consent, reset existing accounts, delete records or run arbitrary code/SQL. Research jobs still use the business's existing provider connections and the configured worker.

The API contract follows [Anthropic's tool-call lifecycle](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls); the selected model is configurable, initially Claude Sonnet 5.5. Existing client records, credentials and archived CRM tables are preserved by the additive migration.

### Administrator-provisioned client logins (form)

`POST /api/platform/admin/client-logins` requires a platform administrator, matching request origin and a per-administrator rate limit. It creates a new non-admin user and CLIENT_VIEWER membership, optionally creating a business and trial subscription in the same transaction. Existing businesses must be active, non-demo organizations with an available team seat. Email and workspace locks prevent duplicate provisioning and concurrent seat overruns. An existing email returns a conflict without changing its password or memberships.

Passwords use 24 random bytes plus a character suffix and bcrypt cost 12. Only the creation response includes the generated password, with `Cache-Control: no-store`; directory reads, activity records and database fields do not contain it in readable form. The administrator can reveal, copy or download it in the creation drawer. Administrator-provisioned accounts can sign in immediately without the public registration step. Their email is not falsely marked as verified, and the creation operation does not queue any email. Standard email-based password recovery remains available.

## Email state and recovery

Campaign approval snapshots each recipient's reviewed personalized subject/body. Changes revoke approvals. Runtime checks repeat immediately before a message is reserved. A committed `SENDING` record exists before Gmail is contacted. Only a confirmed provider response produces `ACCEPTED`; this is not delivery confirmation. Ambiguous outcomes become `REVIEW_REQUIRED` and cannot automatically resend. Reconciliation searches Gmail's Sent folder by the stable RFC Message-ID. An absent result never proves that sending failed.

Incoming replies are matched by exact sender and an existing conversation. Every reply stops follow-ups. Text classification is marked provisional; configured AI can refine it and generate a suggestion. Suggestions require an edited or reviewed, exact approved reply before delivery. Opt-outs persist in suppression even after a lead is archived.

## Recovery

Stop web and worker before restoration. Restore the dump into a new database, verify its manifest fingerprints, and point a separate recovery environment at it before any production cutover. Recover the former source from the backup's `source` directory and the original secrets from secure storage. Restore database and source versions together. Never restore blindly over a running database or delete the verified recovery database before a separate off-machine backup exists.
