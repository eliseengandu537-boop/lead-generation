# Verification

## Executed locally

- Original PostgreSQL dump restored to an independent database; row counts and sorted full-row fingerprints matched across all 37 original public tables.
- Eleven unit tests passed for SSRF/private network blocking, sender-domain matching, evidence validation, bounded AI scores, incomplete AI rejection, opt-out priority, safety thresholds, timezone windows, MIME/header safety, signed feedback and tenant-bound automation capabilities.
- Ten integration groups passed using temporary isolated PostgreSQL businesses. These checked new organization creation, SQL isolation even without filters, failed plain-setting spoofing, archived-table and directory protection, blocked cross-tenant writes, live flag and consent/approval gates, committed-before-provider reservation, duplicate prevention, uncertain-send blocking, mocked Gmail reply association, stopped follow-ups, approved replies, complaint pauses, immediate signed opt-out suppression, durable job admission/execution, report reconciliation, CSV permission safety and tenant-scoped retention.
- Authenticated HTTP checks cover all fourteen workspace resources; cross-tenant requests and non-admin access return 403, wrong-origin mutations return 403, and retired CRM route examples return 404.
- Premium browser QA passed all fourteen client and eleven administrator sections at desktop width 1512 and mobile width 390, in light and dark themes. Theme persistence, real lead/template/campaign forms, website directory/inspector and client/admin permissions passed. No browser runtime, console or unexpected HTTP errors remained. Temporary fixtures were removed by exact IDs.
- Both reply composer paths passed: new incoming reply and edited saved draft preserved exact approved subject/body and queued `SEND_REPLY` jobs with zero attempts, dispatches, provider IDs or send events. No worker executed the test jobs. Their users, organizations and all queued jobs were removed afterward.
- After replacement, 33 original data tables still matched the pre-replacement backup exactly; migration history and transient account/rate records were excluded from that preservation comparison.

Email, search, AI and n8n network integration tests must not be interpreted as real provider certification. Integration email and automation transports are mocked explicitly. Test users and new business fixtures are removed after the run. No real outreach was sent.

## Remaining external acceptance

Public hosting, verified account email, Google OAuth consent and real mailbox sends, paid Brave/OpenAI requests, a deployed verification gateway, and imported/activated n8n workflows require external accounts/configuration. These were unavailable in this local environment. Payment collection, authenticated provider delivery/open events and automatic payment reconciliation are not connected. The application does not display placeholder success or fabricated business metrics for those integrations.

`npm run test:integration` requires a running web service and the configured database. Browser screenshots are stored under `artifacts/orbit`; see the current handoff for production build, browser and runtime verification results.
