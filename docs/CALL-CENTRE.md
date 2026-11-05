# Concrete calling workspace

Callers sign in at `/login` and go directly to `/caller`. Navigation contains **My day, Find leads, My calls and My meetings**. They see Concrete branding, their queue and their own activity. Connected business websites, website profiles, email outreach, client portals and administration are excluded from their UI and API access. Older campaign permissions do not reopen those features. Clients retain their separate results portal.

## Administrator setup

1. In **Admin → Call Centre**, connect the business website if it has no workspace. Website configuration remains private to administrators.
2. Select **Create caller**, enter the caller's name/email and assign queues. Download the generated credentials and share privately. Existing accounts/passwords cannot be overwritten here. **Edit access** changes assignments; suspension invalidates sessions.
3. Open **Configure automatic leads**. Enable restaurants and/or beauty businesses, choose Gauteng areas, daily import limit (1–50), ready-queue limit (10–250), an active administrator as meeting host and optional admin email notifications.
4. Keep the automation computer online. `npm run automation:worker` uses private `.local/hosted-worker.env` to run the hosted worker without Docker. `npm run automation:start` additionally starts n8n. Public prospect research and transactional notifications run directly in the worker without n8n admission or an AI/search API key.

## Automatic ready leads

The worker schedules daily research for enabled real businesses with an active assigned caller. **Find more leads** requests another enabled niche/area. Opening a low-stock queue requests research once per browser session. Ready leads appear after the durable job finishes. Queued work is not reported as complete.

Research queries the public [Overture Maps places dataset](https://docs.overturemaps.org/guides/places/) with DuckDB, following the [official access guide](https://docs.overturemaps.org/getting-data/duckdb/). The default release is `2026-10-21.0`; `OVERTURE_RELEASE` selects a reviewed compatible release. Test schema changes before switching releases. The worker caches DuckDB's official httpfs extension under ignored `.local/duckdb-extensions`, with bounded memory/threads and network/query timeouts. Page requests never execute the large data query.

Filters require a South African phone, Gauteng province/address and coordinates, restaurant/beauty category, source confidence at least 0.75 and no listed website. Each prospect retains release, source record ID, original references, coordinates, confidence, check time and [attribution](https://docs.overturemaps.org/attribution/#places). **No website listed** means this source does not list one. It is not proof that no website exists. Listings can be outdated; the caller confirms with the owner. Public-data filtering does not claim an LLM verified the business.

Imports deduplicate source IDs and normalized phones within each business, retain opt-outs and never grant email consent/verification. Daily limits reset at South African midnight. The ready-queue cap spans all assigned callers. Research rechecks configuration, caps and caller access before saving. Failures preserve existing leads. Search records use forced tenant RLS; configuration is control-only.

## The caller's day

**My day** shows ready leads, logged outcomes, qualified prospects and bookings. Due callbacks come before new leads. **Find leads** filters by niche, area, ready/callback/all accessible records and name/phone search. Callers can add/edit prospects. They work their own or unassigned records in assigned active queues. The first write claims a record; competing claims cannot both succeed. Another caller's assigned leads are excluded.

Choose **Call this business**. A normal Vodacom SIM uses **Open phone dialler**, a tel: handoff to a compatible linked phone or dialler. Concrete cannot place a cellular SIM call itself. Preparing a handoff does not place a call. Phone outcomes are caller-reported, without fabricated provider identifiers or verified durations.

After the conversation, save notes and choose **Interested — book a meeting**, **Call later**, **Not interested**, **No answer** or **Do not call**. Qualification and outcome save together. Callbacks need a future time; no answer creates a reminder for tomorrow. Do-not-call blocks that number, including duplicate leads. Sales qualification cannot grant email permission.

## Meeting booking and administrator notifications

An interested call opens the booking dialog. Enter the contact name, optional email and notes, select an available 30-minute slot and confirm prospect agreement. Slots use South African time (SAST), weekdays 09:00–17:00, at least 30 minutes ahead and up to 60 days out. The admin-configured host is assigned automatically. Availability considers scheduled Concrete bookings across businesses without disclosing other meetings. External calendars are not connected; manage outside commitments separately.

Saving reserves the host transactionally, adds the appointment to both dashboards and creates an admin notification. The admin header bell shows unread bookings/updates, polls while visible and opens Call Centre. Notifications are idempotent per booking revision. When account email is configured and the setting enabled, encrypted transactional messages queue for active platform administrators through the account-email worker. This is separate from prospect outreach. Delivery is not claimed before the SMTP/provider result.

**My meetings** provides calendar invitations and status updates. Conflicts and stale revisions are rejected. The .ics file preserves ID, revision and exact UTC times; internal notes are omitted. Download/share through an authorised channel. Booking does not email the prospect, connect external calendars or create a video meeting automatically.

## Optional browser calling

Connect an existing Twilio Voice account, authorised number, TwiML application and API key in **Admin → Call Centre → Calling connections**. Provider costs/restrictions apply; no account/number is purchased. A normal Vodacom SIM is not a browser voice connection. Set the application's Voice URL to the displayed webhook using POST. Credentials are validated, encrypted and control-only.

When connected, **Call this business** prepares an outgoing-only short-lived token and one-use nonce. The signed webhook rechecks user/business access, lead ownership and opt-outs, then dials only the stored number. Arbitrary client destinations are ignored. HTTPS/microphone access are needed; mute/hang-up operate on the SDK connection. Recording is off; calls have a 30-minute maximum. Signed callbacks establish status/duration. Duplicate/stale events cannot fabricate results. Unconfigured browser calls fail without creating a call record. Mocked tests do not establish live provider authorisation.

## Verification and recovery

Migrations `202611040002_call_centre` and `202611040003_caller_prospecting` are additive. Preserve existing accounts, workspaces and credentials. Back up production and verify restoration before deployment. Meeting host reservations use control transactions for conflicts across businesses.

Run `npm test`, `npm run lint`, `npm run typecheck` and `npm run build`. With a local-only database and local server, run `node --env-file=.env --import tsx scripts/calling-integration.ts`. It covers caller privacy, concurrent ownership, source imports/deduplication/caps, access revocation during research, manual outcomes, signed mocked callbacks, booking conflicts/revisions, calendar privacy, notifications, obsolete campaign permission rejection and suspension. Tests clean their own fixtures and place no real calls or prospect emails.
