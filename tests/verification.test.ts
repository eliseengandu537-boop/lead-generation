import test from "node:test";
import assert from "node:assert/strict";
import {
  mailDomainCheck,
  providerVerification,
  verificationSetup,
} from "../src/platform/research/verification";

const dnsError = (code: string) => Object.assign(new Error(code), { code });
function resolver(records: {
  mx?: { exchange: string; priority: number }[] | string;
  a?: string[] | string;
  aaaa?: string[] | string;
}) {
  const answer = <T>(value: T | string | undefined) =>
    typeof value === "string"
      ? Promise.reject(dnsError(value))
      : value === undefined
        ? Promise.reject(dnsError("ENODATA"))
        : Promise.resolve(value);
  return {
    resolveMx: () => answer(records.mx),
    resolve4: () => answer(records.a),
    resolve6: () => answer(records.aaaa),
  } as unknown as Parameters<typeof mailDomainCheck>[1];
}

test("verification provider is chosen from configuration without guessing", () => {
  assert.equal(verificationSetup({}), null);
  assert.equal(verificationSetup({ EMAIL_VERIFICATION_PROVIDER: "zerobounce" }), null);
  assert.deepEqual(
    verificationSetup({ EMAIL_VERIFICATION_PROVIDER: "MillionVerifier", EMAIL_VERIFICATION_API_KEY: "k" }),
    { provider: "millionverifier", key: "k" },
  );
  assert.deepEqual(
    verificationSetup({ EMAIL_VERIFICATION_URL: "https://verify.example", EMAIL_VERIFICATION_API_KEY: "k" }),
    { provider: "gateway", key: "k", url: "https://verify.example" },
  );
  assert.equal(
    verificationSetup({ EMAIL_VERIFICATION_PROVIDER: "someone-else", EMAIL_VERIFICATION_API_KEY: "k" }),
    null,
  );
});

test("the free domain check only rejects domains that provably cannot receive mail", async () => {
  assert.equal((await mailDomainCheck("not-an-address", resolver({})))?.status, "INVALID");
  assert.equal((await mailDomainCheck("a@gone.example", resolver({ mx: "ENOTFOUND" })))?.status, "INVALID");
  assert.equal(
    (await mailDomainCheck("a@nullmx.example", resolver({ mx: [{ exchange: "", priority: 0 }] })))?.status,
    "INVALID",
  );
  assert.equal(
    (await mailDomainCheck("a@none.example", resolver({ mx: "ENODATA", a: "ENODATA", aaaa: "ENODATA" })))?.status,
    "INVALID",
  );
  // Working or inconclusive domains are left for the mailbox-level service.
  assert.equal(
    await mailDomainCheck("a@mail.example", resolver({ mx: [{ exchange: "mx.mail.example", priority: 10 }] })),
    null,
  );
  assert.equal(await mailDomainCheck("a@implicit.example", resolver({ mx: "ENODATA", a: ["192.0.2.1"] })), null);
  assert.equal(await mailDomainCheck("a@flaky.example", resolver({ mx: "ESERVFAIL" })), null);
  assert.equal(
    await mailDomainCheck("a@flaky.example", resolver({ mx: "ENODATA", a: "ETIMEOUT", aaaa: "ENODATA" })),
    null,
  );
});

function jsonResponder(body: unknown, capture?: (url: string, init?: RequestInit) => void) {
  return (async (url: string | URL, init?: RequestInit) => {
    capture?.(String(url), init);
    return Response.json(body);
  }) as typeof fetch;
}

test("MillionVerifier results map to cautious statuses and errors never echo the key", async () => {
  const setup = { provider: "millionverifier" as const, key: "secret-key" };
  let requested = "";
  const ok = await providerVerification(
    "a@x.example",
    setup,
    jsonResponder({ email: "a@x.example", result: "ok" }, (url) => (requested = url)),
  );
  assert.equal(ok.status, "VALID");
  assert.match(requested, /^https:\/\/api\.millionverifier\.com\/api\/v3\/\?api=secret-key&email=a%40x\.example/);
  for (const [result, status] of [
    ["catch_all", "RISKY"],
    ["disposable", "INVALID"],
    ["invalid", "INVALID"],
    ["unknown", "UNKNOWN"],
    ["error", "UNKNOWN"],
    ["something-new", "UNKNOWN"],
  ])
    assert.equal(
      (await providerVerification("a@x.example", setup, jsonResponder({ result }))).status,
      status,
      result,
    );
  await assert.rejects(
    providerVerification("a@x.example", setup, jsonResponder({ error: "Insufficient credits" })),
    (error: Error) => /Insufficient credits/.test(error.message) && !error.message.includes("secret-key"),
  );
  await assert.rejects(
    providerVerification("a@x.example", setup, jsonResponder({ email: "b@x.example", result: "ok" })),
    /different address/,
  );
});

test("ZeroBounce and gateway results map correctly and the gateway must use HTTPS", async () => {
  const zero = { provider: "zerobounce" as const, key: "k" };
  for (const [status, expected] of [
    ["valid", "VALID"],
    ["catch-all", "RISKY"],
    ["do_not_mail", "INVALID"],
    ["spamtrap", "INVALID"],
    ["unknown", "UNKNOWN"],
  ])
    assert.equal(
      (await providerVerification("a@x.example", zero, jsonResponder({ address: "a@x.example", status }))).status,
      expected,
    );
  let init: RequestInit | undefined;
  const gateway = await providerVerification(
    "a@x.example",
    { provider: "gateway", key: "k", url: "https://verify.example/check" },
    jsonResponder({ email: "a@x.example", status: "RISKY" }, (_url, value) => (init = value)),
  );
  assert.equal(gateway.status, "RISKY");
  assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer k");
  await assert.rejects(
    providerVerification(
      "a@x.example",
      { provider: "gateway", key: "k", url: "http://verify.example/check" },
      jsonResponder({}),
    ),
    /HTTPS/,
  );
});
