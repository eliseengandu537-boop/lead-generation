import assert from "node:assert/strict";
import test from "node:test";
import { candidateFromPlace } from "../src/platform/calling/overture";
import {
  gautengDayStart,
  inProspectArea,
  prospectCities,
} from "../src/platform/calling/prospect-options";

const listing = {
  id: "public-place",
  company: "Fixture restaurant",
  category: "pizza_restaurant",
  phone: "011 234 5678",
  confidence: 0.9,
  websites: null,
  addresses: [{ country: "ZA", region: "GP", locality: "Johannesburg" }],
  sources: [{ dataset: "synthetic fixture", record_id: "source-7" }],
  lon: 28.04,
  lat: -26.2,
};
const release = "2026-10-21.0";
test("prospects preserve source evidence and make a missing website claim only about the listing", () => {
  const found = candidateFromPlace(listing, release)!;
  assert.equal(found.phone, "+27112345678");
  assert.equal(found.email, null);
  assert.equal(found.websitePresence, "NO_WEBSITE_LISTED");
  assert.equal(found.industry, "Restaurants");
  assert.deepEqual(found.evidence.sources, listing.sources);
  assert.equal(found.evidence.release, release);
  assert.match(String(found.evidence.finding), /does not establish/);
  const beauty = candidateFromPlace(
    { ...listing, category: "nail_salon" },
    release,
  )!;
  assert.equal(beauty.industry, "Beauty");
  assert.ok(
    candidateFromPlace(
      {
        ...listing,
        category: "pizzeria",
        categoryHierarchy: '["restaurant","food"]',
      },
      release,
    ),
  );
});
test("research rejects listed websites, unverifiable fields, unsuitable businesses and out-of-area records", () => {
  for (const changes of [
    { websites: ["https://example.com"] },
    { websites: "[malformed" },
    { websites: {} },
    { websites: undefined },
    { addresses: [{ country: "ZA", region: "FS" }] },
    { addresses: [{ country: "ZA" }] },
    { addresses: [{ country: "GB", region: "GP" }] },
    { phone: "1234" },
    { phone: "+442079460958" },
    { phone: "" },
    { confidence: 0.7 },
    { lat: -29.8 },
    { lon: 31 },
    { category: "lawyer" },
  ])
    assert.equal(
      candidateFromPlace({ ...listing, ...changes }, release),
      null,
      JSON.stringify(changes),
    );
});
test("city scopes retain Gauteng-wide targeting and constrain selected city areas", () => {
  assert.ok(inProspectArea(-26.2, 28.04, ["Johannesburg"]));
  assert.equal(inProspectArea(-25.75, 28.23, ["Johannesburg"]), false);
  assert.ok(inProspectArea(-25.75, 28.23, ["Pretoria"]));
  assert.ok(inProspectArea(-26.67, 27.93, [...prospectCities]));
  assert.equal(inProspectArea(-26.2, 28.04, []), false);
});
test("daily research limits reset at South African midnight rather than UTC midnight", () => {
  assert.equal(
    gautengDayStart(new Date("2026-11-04T21:59:59Z")).toISOString(),
    "2026-11-03T22:00:00.000Z",
  );
  assert.equal(
    gautengDayStart(new Date("2026-11-04T22:00:00Z")).toISOString(),
    "2026-11-04T22:00:00.000Z",
  );
});
