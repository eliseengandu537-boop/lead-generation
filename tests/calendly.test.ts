import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizedCalendlyPage,
  calendlyBookingUrl,
  calendlyScheduledMessage,
} from "../src/platform/calling/calendly-options";
const page = "https://calendly.com/tristandearaujo261/30min";
test("Calendly settings accept only public event pages and remove supplied tracking or contact data", () => {
  assert.equal(
    normalizedCalendlyPage(page + "/?email=someone%40example.com#fragment"),
    page,
  );
  assert.equal(normalizedCalendlyPage(""), "");
  for (const invalid of [
    "http://calendly.com/name/30min",
    "https://calendly.com.attacker.example/name/30min",
    "https://user:secret@calendly.com/name/30min",
    "https://calendly.com:8080/name/30min",
    "javascript:alert(1)",
    "https://localhost/name/30min",
    "https://calendly.com/name",
    "https://calendly.com/name/30min/other",
  ])
    assert.equal(normalizedCalendlyPage(invalid), null);
});
test("booking links prefill the prospect with escaped data, use SAST and do not add CRM identifiers", () => {
  const value = new URL(
    calendlyBookingUrl(
      page,
      { name: "Owner & Partner", email: "owner+sales@example.com" },
      "concrete.example",
    ),
  );
  assert.equal(value.origin + value.pathname, page);
  assert.equal(value.searchParams.get("name"), "Owner & Partner");
  assert.equal(value.searchParams.get("email"), "owner+sales@example.com");
  assert.equal(value.searchParams.get("timezone"), "Africa/Johannesburg");
  assert.equal(value.searchParams.get("embed_domain"), "concrete.example");
  assert.equal(value.searchParams.get("embed_type"), "Inline");
  assert.equal(value.searchParams.get("utm_source"), "concrete");
  assert.ok(!calendlyBookingUrl(page, {}).includes("embed_domain"));
  assert.ok(
    ![...value.searchParams.keys()].some((key) =>
      /lead|workspace|callerId|callId/.test(key),
    ),
  );
});
test("only correctly shaped Calendly confirmation messages change the confirmation display", () => {
  const message = {
    event: "calendly.event_scheduled",
    payload: {
      event: { uri: "https://api.calendly.com/scheduled_events/test-event" },
      invitee: {
        uri: "https://api.calendly.com/scheduled_events/test-event/invitees/test-invitee",
      },
    },
  };
  assert.ok(calendlyScheduledMessage("https://calendly.com", message));
  assert.equal(
    calendlyScheduledMessage("https://calendly.com.attacker.example", message),
    false,
  );
  assert.equal(
    calendlyScheduledMessage("https://calendly.com", {
      event: "calendly.event_scheduled",
    }),
    false,
  );
  assert.equal(
    calendlyScheduledMessage("https://calendly.com", {
      ...message,
      event: "calendly.date_and_time_selected",
    }),
    false,
  );
});
