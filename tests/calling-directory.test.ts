import assert from "node:assert/strict";
import test from "node:test";
import {
  directoryQuery,
  fetchDirectory,
} from "../src/platform/calling/directory";

test("directory searches are bounded to explicit supported city/category selections", () => {
  const { query } = directoryQuery({
    city: "Johannesburg",
    category: "Vehicle repair",
  });
  assert.match(query, /around:8000,-26\.2041,28\.0473/);
  assert.match(query, /\["shop"="car_repair"\]/);
  assert.match(query, /out tags 10/);
  assert.throws(() =>
    directoryQuery({
      city: 'Johannesburg"];out;node',
      category: "Vehicle repair",
    }),
  );
  assert.throws(() =>
    directoryQuery({
      city: "Johannesburg",
      category: "Vehicle repair",
      radius: 1000000,
    }),
  );
});
test("directory results use returned facts and source attribution; missing contact details are never guessed", async () => {
  let requests = 0;
  const result = await fetchDirectory(
    { city: "Johannesburg", category: "Vehicle repair" },
    async (_url, init) => {
      requests++;
      assert.equal(init?.method, "POST");
      assert.ok(!JSON.stringify(init).includes("Authorization"));
      return Response.json({
        elements: [
          {
            id: 123,
            type: "node",
            tags: {
              name: "A workshop",
              phone: "0111234567",
              website: "workshop.example.invalid",
            },
          },
          {
            id: 124,
            type: "way",
            tags: {
              name: "B workshop",
              email: "bad-email",
              website: "javascript:alert(1)",
            },
          },
        ],
      });
    },
  );
  assert.equal(requests, 1);
  assert.equal(result.results.length, 2);
  assert.equal(
    result.results[0].sourceUrl,
    "https://www.openstreetmap.org/node/123",
  );
  assert.equal(result.results[0].website, "https://workshop.example.invalid/");
  assert.equal(result.results[0].email, "");
  assert.equal(result.results[1].email, "");
  assert.equal(result.results[1].phone, "");
  assert.ok(result.attribution.includes("OpenStreetMap"));
});
test("directory timeouts, provider errors and partial searches stay failures", async () => {
  for (const response of [
    new Response("busy", { status: 429 }),
    Response.json({ remark: "timeout", elements: [] }),
    Response.json({ elements: [{ id: "bad" }] }),
  ])
    await assert.rejects(() =>
      fetchDirectory(
        { city: "Johannesburg", category: "Vehicle repair" },
        async () => response,
      ),
    );
});
