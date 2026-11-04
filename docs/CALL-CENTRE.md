# Caller setup and operation

The caller dashboard is `/caller`. Staff accounts use their own email and a generated password. They have no access to platform administration or general workspace operation endpoints. Administrators keep `/admin`, and clients keep their results portal.

## Assign a caller

1. In **Admin → Call Centre**, connect the business website if it has no existing workspace.
2. Select **Create caller**, enter a name/email and choose their businesses. Download the generated login immediately and share it privately. Existing email accounts are preserved and cannot be overwritten through this action.
3. Enable email permission only for the businesses where this caller should manage outreach. Website profile approval, sender authorisation, verified eligible recipients and enabled sending remain required.
4. Use **Edit access** to change assignments. Removing email permission or suspending a caller pauses their running/approved campaigns. Suspending access also invalidates existing login sessions. In-flight provider calls cannot be recalled by changing an application permission.

## Work prospects

**Find leads → Search the web** opens a Google Maps search for the entered niche and city in a separate tab. Review the business and use **Add a prospect** to save its real contact information and source. This manual workflow does not require an AI/search key or public-directory availability.

**Find leads** also includes a public OpenStreetMap directory search around supported South African city centres. Searches are manual, limited to ten listings within eight kilometres, rate limited and cached per business/day. The default [Private.coffee Overpass service](https://overpass.private.coffee/) permits commercial applications. Its [privacy policy](https://overpass.private.coffee/#privacy-policy) applies to those public queries; no caller identities, prospect details or credentials are included in requests. Results carry OSM source links and attribution. Review a listing before adding it. Missing phone numbers/emails are never guessed. These public services can be busy, unavailable or contain outdated records; the directory was unavailable during hosted acceptance checks, so automated directory import is not claimed as live-verified. `BUSINESS_DIRECTORY_URL` can select a different trusted HTTPS Overpass instance without a code change. Larger deployments should provision a suitable directory service.

Website research search additionally uses the existing business-specific Brave/AI connection and an approved business profile. It queues existing research jobs and needs the automation computer online. Public directory searches and manual lead entry do not need AI credit or that worker.

Callers can work on their own or unassigned leads in assigned active businesses. The first write claims an unassigned lead; concurrent claims cannot both succeed. Another caller's assigned records are excluded. Sales qualification is distinct from AI suitability, email verification and contact permission. A caller cannot use qualification or lead editing to grant email consent. Changes to recipient details invalidate previous email approvals and pause affected campaigns for review.

## Vodacom phone calls

Choose **Vodacom phone** on a lead, then **Open phone dialler**. A compatible phone/dialler must handle the `tel:` link. Desktop computers need a linked phone or installed dialler; Concrete cannot place a cellular SIM call by itself.

After the conversation, record the actual outcome and optional reported duration. Preparing a phone handoff does not count as a completed call. These logs are labelled caller-reported and never receive fabricated provider SIDs or verified durations. A do-not-call outcome prevents another call to that number, including duplicate leads in the same business. Existing opt-outs also block calling.

## Browser calls

Browser calls need an existing Twilio Voice account, an authorised calling number, a TwiML application and API key credentials. Provider fees and restrictions apply; this implementation does not purchase an account or number. A normal Vodacom SIM is not a browser Voice connection.

In **Admin → Call Centre → Calling connections**, copy the business's Voice webhook URL into the TwiML application's Voice URL using POST, then provide the private connection fields. The app validates the account/application and stores credentials encrypted in a control-only table. Configuration is not included in caller responses or general tenant SQL access.

An explicit **Call in browser** action prepares a short-lived outgoing-only token and one-use dial nonce. The signed provider webhook rechecks identity, current account/business access, lead ownership and opt-outs, then dials only the stored lead number. Client-supplied arbitrary destinations are ignored. Microphone access and HTTPS are required. Recording is disabled and calls have a 30-minute maximum. Mute and hang-up controls operate on the active SDK connection.

Signed call-leg callbacks update actual status and duration. Duplicate or out-of-order events cannot regress state or overwrite terminal results. Abandoned preparations do not count as provider attempts. Human outcomes and conversation notes remain separate from provider events. Provider credentials must work and calling permissions must be active for an end-to-end live call; mocked integration verification does not establish this.

## Qualify and book

Use **Qualify** to record interest and notes. Use **Book meeting** to choose an active host and a future appointment. The prospect must have agreed to that appointment. Form times use the operator's local timezone; stored calendar times are UTC. Meetings last between one minute and eight hours. Host conflicts are checked across businesses without disclosing another business's details. Updates use revision checks to prevent overwriting a newer booking.

Bookings appear in caller and administrator views. **Download calendar** creates an `.ics` invitation with stable ID, current revision and exact appointment times. Internal notes are omitted. Share the file or meeting details through an authorised channel. Creating/updating a booking does not send email, integrate an external calendar or create a video meeting automatically.

## Email outreach

Campaigns and email sending share **Email outreach**. Authorised callers compose and preview campaigns using their own/available leads, then explicitly select **Create and send**. All existing sender-domain, consent, verification, suppression, plan, schedule and live-enable checks remain in effect. An incomplete launch creates no unwanted draft. Callers can alter only campaigns they created; administrators can manage all campaigns.

Campaign sending uses the client's connected sending mailbox, never its dashboard login email by assumption. Account-verification Brevo SMTP settings are not a client campaign connection. Queued outreach needs the existing local sending worker online. Saving a website does not install visitor tracking or invent leads, replies, calls or email activity.

## Verification and recovery

Migration `202611040002_call_centre` is additive: existing user accounts, credentials, workspaces and email history remain. New call, call-event and booking tables use forced tenant RLS; provider credentials use control-only RLS. Back up the hosted database and verify a restore before deployment.

Run `npm test`, `npm run lint`, `npm run typecheck` and `npm run build`. With the application running and **a local-only database**, run `node --env-file=.env --import tsx scripts/calling-integration.ts` (set `TEST_BASE_URL` to the test server). It exercises caller isolation, lead ownership/races, human qualification, manual call logging, booking conflicts/revisions/calendar privacy, delegated campaign gates, signed mocked voice callbacks, accurate metrics and access suspension. It creates/removes only its own fixtures and places no real calls or emails.
