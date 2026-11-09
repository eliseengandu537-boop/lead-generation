import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateFromPlace,
  prospectQueryPredicate,
  publicPlaceFiles,
} from "../src/platform/calling/overture";
import {
  gautengDayStart,
  inProspectArea,
  prospectCities,
} from "../src/platform/calling/prospect-options";
import {
  provinceDefinitions,
  matchesBusinessType,
  matchesSouthAfricanArea,
  matchesProspectingScope,
  salesNiches,
} from "../src/platform/calling/prospect-search";
import { DuckDBInstance } from "@duckdb/node-api";

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
test("public fragment discovery rejects alternate hosts, releases and SQL-bearing paths", () => {
  const file = `https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/${release}/theme=places/type=place/part-00008-source.zstd.parquet`;
  assert.deepEqual(publicPlaceFiles([{ file }, { file }], release), [file]);
  for (const value of [
    "http://127.0.0.1/places.parquet",
    file.replace(release, "2025-01-01.0"),
    file.replace("part-00008", "part-' OR 1=1 --"),
    file + "?redirect=1",
  ])
    assert.throws(() => publicPlaceFiles([{ file: value }], release));
});
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
test("research rejects listed websites, unverifiable fields and records outside South Africa", () => {
  for (const changes of [
    { websites: ["https://example.com"] },
    { websites: "[malformed" },
    { websites: {} },
    { websites: undefined },
    { addresses: [{ country: "GB", region: "GP" }] },
    { phone: "1234" },
    { phone: "+442079460958" },
    { phone: "" },
    { confidence: 0.7 },
    { lat: -36 },
    { lon: 35 },
    { category: "" },
  ])
    assert.equal(
      candidateFromPlace({ ...listing, ...changes }, release),
      null,
      JSON.stringify(changes),
    );
});
test("any listed business type in South Africa is eligible, with its actual category and province", () => {
  const dentist = candidateFromPlace(
    {
      ...listing,
      category: "dentist",
      addresses: [{ country: "ZA", region: "WC", locality: "Cape Town" }],
      lon: 18.42,
      lat: -33.92,
    },
    release,
  )!;
  assert.equal(dentist.industry, "Dentist");
  assert.equal(dentist.location, "Cape Town, Western Cape");
  for (const province of provinceDefinitions)
    assert.ok(
      candidateFromPlace(
        {
          ...listing,
          category: "plumber",
          addresses: [{ country: "ZA", region: province.code }],
          lon: 28,
          lat: -29,
        },
        release,
      ),
    );
});
test("sales research includes listed websites only when requested and excludes closed businesses", () => {
  const raw = {
    ...listing,
    category: "auto_parts_store",
    websites: ["https://example.com/"],
  };
  assert.equal(candidateFromPlace(raw, release), null);
  const found = candidateFromPlace(raw, release, {
    requireMissingWebsite: false,
  })!;
  assert.equal(found.website, "https://example.com/");
  assert.equal(found.websitePresence, "WEBSITE_LISTED");
  assert.match(String(found.evidence.finding), /have not been verified/);
  for (const operatingStatus of ["temporarily_closed", "permanently_closed"])
    assert.equal(
      candidateFromPlace({ ...raw, operatingStatus }, release, {
        requireMissingWebsite: false,
      }),
      null,
    );
});
test("sales queue matches the ten requested niches while retaining source categories and website evidence", () => {
  const sourceCategories = [
    "construction_company",
    "electrical_services",
    "plumbing",
    "auto_parts_store",
    "shopping_mall",
    "estate_agent",
    "building_materials",
    "steel_fabricator",
    "metal_recycling",
    "machine_shop",
  ];
  salesNiches.forEach((niche, index) =>
    assert.ok(matchesBusinessType(niche, sourceCategories[index]), niche),
  );
  const config = {
    categories: salesNiches,
    cities: ["South Africa"],
    requireMissingWebsite: false,
  };
  assert.equal(
    matchesProspectingScope(
      {
        company: "Steel City Scrap Shop",
        industry: "Arts Crafts And Hobby Store",
        websitePresence: "WEBSITE_LISTED",
      },
      config,
    ),
    false,
  );
  assert.equal(
    matchesProspectingScope(
      {
        company: "Restaurant at Example Mall",
        industry: "Restaurant",
        websitePresence: "WEBSITE_LISTED",
      },
      config,
    ),
    false,
  );
  assert.ok(
    matchesProspectingScope(
      {
        company: "Example Mall",
        industry: "Shopping Mall",
        websitePresence: "WEBSITE_LISTED",
      },
      config,
    ),
  );
  assert.ok(
    matchesProspectingScope(
      {
        company: "Public listing",
        industry: "Auto Parts Store",
        websitePresence: "WEBSITE_LISTED",
      },
      config,
    ),
  );
  assert.equal(
    matchesProspectingScope(
      { industry: "Restaurant", websitePresence: "NO_WEBSITE_LISTED" },
      config,
    ),
    false,
  );
  assert.equal(
    matchesProspectingScope(
      { industry: "Plumber", websitePresence: "WEBSITE_LISTED" },
      { ...config, requireMissingWebsite: true },
    ),
    false,
  );
});
test("typed business keywords and area searches match the source facts without treating every query as restaurants", () => {
  assert.ok(matchesBusinessType("Plumbers", "Plumbing services"));
  assert.ok(matchesBusinessType("Dentists", "Dental clinic"));
  assert.ok(matchesBusinessType("Car repair", "Auto repair workshop"));
  assert.ok(matchesBusinessType("Bicycle shops", "Bicycle shop"));
  assert.equal(matchesBusinessType("Bars", "Barber shop"), false);
  assert.equal(matchesBusinessType("Dentists", "Restaurant"), false);
  assert.ok(matchesBusinessType("", "Any source category"));
  assert.ok(
    matchesSouthAfricanArea("South Africa", {
      country: "ZA",
      region: "EC",
      locality: "Gqeberha",
    }),
  );
  assert.ok(
    matchesSouthAfricanArea("Western Cape", { country: "ZA", region: "ZA-WC" }),
  );
  assert.ok(
    matchesSouthAfricanArea("Cape Town, Western Cape", {
      country: "ZA",
      region: "WC",
      locality: "Cape Town",
    }),
  );
  assert.equal(
    matchesSouthAfricanArea("Cape Town", {
      country: "ZA",
      region: "GP",
      locality: "Johannesburg",
    }),
    false,
  );
  assert.equal(
    matchesSouthAfricanArea("Gauteng", {
      country: "ZA",
      region: "WC",
      locality: "Cape Town",
    }),
    false,
  );
});
test("the real DuckDB predicate supports arbitrary niches, all provinces and parameterized hostile text", async () => {
  const instance = await DuckDBInstance.create(":memory:"),
    connection = await instance.connect();
  try {
    await connection.run(
      `CREATE TABLE places AS SELECT 'cape-dental' AS id, {'primary':'City Dental'} AS names, {'primary':'dentist', 'hierarchy':['health','dental_clinic']} AS taxonomy, [{'country':'ZA','region':'WC','locality':'Cape Town','freeform':'Main Road'}] AS addresses, {'xmin':18.42,'ymin':-33.92} AS bbox, 0.9 AS confidence, NULL::VARCHAR[] AS websites, ['+27211234567'] AS phones UNION ALL SELECT 'durban-plumber',{'primary':'Coastal Plumbing'},{'primary':'plumber','hierarchy':['home_service','plumbing']},[{'country':'ZA','region':'KZN','locality':'Durban','freeform':'Beach Road'}],{'xmin':31.02,'ymin':-29.85},0.9,NULL::VARCHAR[],['+27311234567'] UNION ALL SELECT 'foreign-plumber',{'primary':'Outside South Africa'},{'primary':'plumber','hierarchy':['plumbing']},[{'country':'BW','region':'GP','locality':'Gaborone','freeform':'Main Road'}],{'xmin':25.9,'ymin':-24.6},0.9,NULL::VARCHAR[],['+26712345678']`,
    );
    await connection.run(
      "ALTER TABLE places ADD COLUMN operating_status VARCHAR DEFAULT 'open'",
    );
    await connection.run(
      "UPDATE places SET websites=['https://example.com/'] WHERE id='durban-plumber'",
    );
    async function search(
      industry: string,
      city: string,
      categories = ["ALL"],
      cities = ["South Africa"],
      requireMissingWebsite = false,
    ) {
      const predicate = prospectQueryPredicate({
        industry,
        city,
        categories,
        cities,
        exclude: [],
        limit: 10,
        requireMissingWebsite,
      });
      const results = await connection.runAndReadAll(
        `SELECT id FROM places WHERE ${predicate.sql}`,
        predicate.params,
      );
      return results.getRowObjectsJson().map((row) => row.id);
    }
    assert.deepEqual(await search("Dentists", "Western Cape"), ["cape-dental"]);
    assert.deepEqual(await search("Plumbers", "Durban"), ["durban-plumber"]);
    assert.deepEqual(
      await search("Plumbers", "Durban", ["ALL"], ["South Africa"], true),
      [],
    );
    assert.deepEqual(await search("ALL", "South Africa"), [
      "cape-dental",
      "durban-plumber",
    ]);
    assert.deepEqual(await search("Dentists", "Cape Town, Western Cape"), [
      "cape-dental",
    ]);
    assert.deepEqual(
      await search("Plumbers", "South Africa", ["Dentists"]),
      [],
    );
    assert.deepEqual(
      await search("ALL", "South Africa", ["ALL"], ["Gauteng"]),
      [],
    );
    assert.deepEqual(await search("plumber' OR 1=1 --", "Durban"), []);
    assert.deepEqual(await search("ALL", "Durban') OR true --"), []);
    await connection.run(
      "UPDATE places SET operating_status='permanently_closed' WHERE id='durban-plumber'",
    );
    assert.deepEqual(await search("Plumbers", "Durban"), []);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
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
