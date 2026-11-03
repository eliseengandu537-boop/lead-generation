# Verification

## Administrator-created client logins — November 3, 2026

All 24 unit tests, type checking, lint and the production build passed. Twelve local integration groups passed, including administrator-only login provisioning, existing and new business membership, immediate sign-in with a generated password, bcrypt verification, duplicate-email conflict handling, atomic rollback for an invalid business, cache prevention, secret exclusion from directory and audit reads, and blocked client access to other businesses and administration. No email is queued by provisioning, and all campaign transports in the integration checks were mocked.

Local browser checks passed creation for both an existing business and a new business, masked password display, reveal/hide, copying and downloading login details, immediate client sign-in, client-only portal access and duplicate-email handling. Desktop and mobile layouts passed without browser errors. Screenshots keep passwords masked and are stored under `artifacts/concrete/client-access/local`. The temporary accounts, business fixtures and downloaded test credentials were removed.

## Dedicated client portal — November 3, 2026

- All 24 unit tests, type checking, lint and the production build passed.
- Eleven local integration groups passed with isolated fixtures, including all seven client portal views, denial of raw operational reads and mutations, blocked workspace creation, cross-client isolation, and denial of operations for legacy CLIENT_ADMIN memberships. Separate operator checks still passed. Email and automation transports were mocked; no outreach was sent.
- Headless Chrome passed the seven-page client portal at widths 1512 and 390 in light and dark appearances. Lead details, campaign message previews, server authorization, administrator-page redirects, and unavailable visitor analytics labels passed. No horizontal document overflow or browser runtime errors remained. Review fixtures were removed. Screenshots and the local verification record are under `artifacts/concrete/client-portal/local`.

The earlier fourteen-section browser results below describe the operational workspace. Clients now use the dedicated seven-section results portal.

## Executed locally

- Original PostgreSQL dump restored to an independent database; row counts and sorted full-row fingerprints matched across all 37 original public tables.
- Fifteen unit tests passed for SSRF/private network blocking, sender-domain matching, evidence validation, bounded AI scores, incomplete AI rejection, opt-out priority, safety thresholds, timezone windows, MIME/header safety, signed feedback, tenant-bound automation capabilities, Render startup, local automation configuration and isolation from the original local credentials.
- Ten integration groups passed using temporary isolated PostgreSQL businesses. These checked new organization creation, SQL isolation even without filters, failed plain-setting spoofing, archived-table and directory protection, blocked cross-tenant writes, live flag and consent/approval gates, committed-before-provider reservation, duplicate prevention, uncertain-send blocking, mocked Gmail reply association, stopped follow-ups, approved replies, complaint pauses, immediate signed opt-out suppression, durable job admission/execution, report reconciliation, CSV permission safety and tenant-scoped retention.
- Authenticated HTTP checks cover all fourteen workspace resources; cross-tenant requests and non-admin access return 403, wrong-origin mutations return 403, and retired CRM route examples return 404.
- Premium browser QA passed all fourteen client and eleven administrator sections at desktop width 1512 and mobile width 390, in light and dark themes. Theme persistence, real lead/template/campaign forms, website directory/inspector and client/admin permissions passed. No browser runtime, console or unexpected HTTP errors remained. Temporary fixtures were removed by exact IDs.
- Both reply composer paths passed: new incoming reply and edited saved draft preserved exact approved subject/body and queued `SEND_REPLY` jobs with zero attempts, dispatches, provider IDs or send events. No worker executed the test jobs. Their users, organizations and all queued jobs were removed afterward.
- After replacement, 33 original data tables still matched the pre-replacement backup exactly; migration history and transient account/rate records were excluded from that preservation comparison.

Email, search, AI and n8n network integration tests must not be interpreted as real provider certification. Integration email and automation transports are mocked explicitly. Test users and new business fixtures are removed after the run. No real outreach was sent.

## Remaining external acceptance

The application is deployed at https://orbit-lead-generation.onrender.com on Render Free with a dedicated Neon Free PostgreSQL 17 database. Render deploy `dep-dbk7p76q1p3s73bh00t0` reached `live` on source commit `3685916e0d2d0fe48197d94f38630c09ef1d9d95`. Hosted health, administrator login, authenticated dashboard data, rejection of anonymous administrative requests and rejection of unauthenticated job admission passed. Headless Chrome passed the actual hosted login and administrator dashboard at desktop and mobile widths without runtime errors or horizontal overflow.

A dedicated local n8n 3.0.0 container runs twelve published workflows with a configured header credential. An isolated report in the hosted database progressed through QUEUED, READY, RUNNING and SUCCEEDED using local worker dispatch, authenticated n8n admission to the hosted app, tenant-scoped execution and status callbacks. The temporary organization and job records were removed. Separate transport checks rejected missing webhook authentication. Repeat database bootstrap passed twice with Neon's non-superuser owner, retaining restricted tenant attributes. The temporary bootstrap password was removed from Render after administrator login verification. Local worker configuration explicitly excludes inherited credentials from the original local application.

Verified account email, Google OAuth consent and real mailbox sends, Brave/OpenAI requests, and a deployed verification gateway still require external accounts/configuration. Live email remains disabled; no real outreach has been sent. Payment collection, authenticated provider delivery/open events and automatic payment reconciliation are not connected. The application does not display placeholder success or fabricated business metrics for those integrations.

Render's authenticated server-side Blueprint validation accepted the free-only web configuration. Source changes are published to the GitHub main branch. No paid Render resources have been created. The current free setup passed unit tests, type checking, lint and a production build.

`npm run test:integration` requires a running web service and the configured database. Browser screenshots are stored under `artifacts/orbit`; see the current handoff for production build, browser and runtime verification results.
