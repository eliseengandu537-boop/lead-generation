import test from "node:test";
import assert from "node:assert/strict";
import { unfilledEmailFields, personalizeFollowup } from "../src/platform/mail/content";
import { personalize } from "../src/lib/security";

test("imported script fields remain visible until completed, including subject and follow-ups", () => {
  const lead = { name: "Pat", company: "Parts workshop", email: "pat@example.invalid", industry: "Motor parts" };
  const body = personalize("Hi {{name}}, {{company}} in {{city}} has {{reviews}} reviews. {{ locationLine }}", lead);
  assert.deepEqual(unfilledEmailFields("Parts in {{ city }}", body), ["city", "reviews", "locationLine"]);
  assert.deepEqual(unfilledEmailFields(personalizeFollowup("Hi {{name}}, {{industry}} in {{city}}", lead)), ["city"]);
  assert.deepEqual(unfilledEmailFields(personalize("Hi {{name}} at {{company}}: {{email}}", lead)), []);
  assert.deepEqual(unfilledEmailFields("Parts catalogue", "We list 1,528 parts."), []);
});
