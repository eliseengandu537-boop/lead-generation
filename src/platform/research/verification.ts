import { promises as dns } from "node:dns";
import { z } from "zod";
import { HttpError } from "@/lib/auth";

export type VerificationStatus = "VALID" | "INVALID" | "RISKY" | "UNKNOWN";
export type VerificationResult = { status: VerificationStatus; detail: string };
export type VerificationSetup =
  | { provider: "millionverifier"; key: string }
  | { provider: "zerobounce"; key: string }
  | { provider: "gateway"; key: string; url: string };
type Resolver = Pick<typeof dns, "resolveMx" | "resolve4" | "resolve6">;

/** The configured mailbox verification service, or null when only the free domain check is available. */
export function verificationSetup(
  env: Record<string, string | undefined> = process.env,
): VerificationSetup | null {
  const key = env.EMAIL_VERIFICATION_API_KEY?.trim();
  if (!key) return null;
  const provider = (
    env.EMAIL_VERIFICATION_PROVIDER ||
    (env.EMAIL_VERIFICATION_URL ? "gateway" : "")
  )
    .trim()
    .toLowerCase();
  if (provider === "millionverifier") return { provider, key };
  if (provider === "zerobounce") return { provider, key };
  if (provider === "gateway" && env.EMAIL_VERIFICATION_URL)
    return { provider, key, url: env.EMAIL_VERIFICATION_URL };
  return null;
}
export const verificationConfigured = () => verificationSetup() !== null;

const missing = (error: unknown) =>
  ["ENOTFOUND", "ENODATA"].includes(
    String((error as NodeJS.ErrnoException)?.code),
  );

/** Free DNS pre-check. Returns INVALID only when the domain provably cannot receive email;
 * null means the domain accepts mail (or DNS was inconclusive) and the mailbox is still unconfirmed. */
export async function mailDomainCheck(
  email: string,
  resolver: Resolver = dns,
): Promise<VerificationResult | null> {
  if (!z.email().safeParse(email).success)
    return { status: "INVALID", detail: "The address is not a valid email format." };
  const domain = email.split("@").pop()!.toLowerCase();
  try {
    const records = await resolver.resolveMx(domain);
    const hosts = records.filter(
      (record) => record.exchange && record.exchange !== ".",
    );
    if (hosts.length) return null;
    if (records.length)
      return {
        status: "INVALID",
        detail: `${domain} publishes a null MX record and does not accept email.`,
      };
  } catch (error) {
    if (!missing(error)) return null;
    if ((error as NodeJS.ErrnoException).code === "ENOTFOUND")
      return { status: "INVALID", detail: `${domain} does not exist in DNS.` };
  }
  // Without MX records, mail falls back to the domain's address records (RFC 5321 section 5.1).
  for (const lookup of [
    () => resolver.resolve4(domain),
    () => resolver.resolve6(domain),
  ]) {
    try {
      if ((await lookup()).length) return null;
    } catch (error) {
      if (!missing(error)) return null;
    }
  }
  return {
    status: "INVALID",
    detail: `${domain} has no mail server or address records.`,
  };
}

const millionVerifierStatus: Record<string, VerificationStatus> = {
  ok: "VALID",
  catch_all: "RISKY",
  disposable: "INVALID",
  invalid: "INVALID",
  unknown: "UNKNOWN",
  error: "UNKNOWN",
};
const zeroBounceStatus: Record<string, VerificationStatus> = {
  valid: "VALID",
  "catch-all": "RISKY",
  invalid: "INVALID",
  spamtrap: "INVALID",
  abuse: "INVALID",
  do_not_mail: "INVALID",
  unknown: "UNKNOWN",
};
function sameAddress(returned: string | undefined, email: string) {
  if (returned && returned.toLowerCase() !== email.toLowerCase())
    throw new HttpError(502, "Verifier returned a different address");
}
async function providerJson(
  name: string,
  url: string | URL,
  init: RequestInit,
  request: typeof fetch,
) {
  const response = await request(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new HttpError(502, `${name} returned HTTP ${response.status}`);
  return response.json();
}

/** Mailbox-level verification through the configured paid service. */
export async function providerVerification(
  email: string,
  setup: VerificationSetup,
  request: typeof fetch = fetch,
): Promise<VerificationResult> {
  if (setup.provider === "millionverifier") {
    const url = new URL("https://api.millionverifier.com/api/v3/");
    url.searchParams.set("api", setup.key);
    url.searchParams.set("email", email);
    url.searchParams.set("timeout", "20");
    const data = z
      .object({
        email: z.string().optional(),
        result: z.string().optional(),
        subresult: z.string().optional(),
        error: z.string().optional(),
      })
      .parse(await providerJson("MillionVerifier", url, {}, request));
    if (data.error)
      throw new HttpError(502, `MillionVerifier: ${data.error.slice(0, 200)}`);
    sameAddress(data.email, email);
    const result = (data.result || "").toLowerCase();
    return {
      status: millionVerifierStatus[result] ?? "UNKNOWN",
      detail: `MillionVerifier: ${result || "no result"}${data.subresult ? ` (${data.subresult})` : ""}.`,
    };
  }
  if (setup.provider === "zerobounce") {
    const url = new URL("https://api.zerobounce.net/v2/validate");
    url.searchParams.set("api_key", setup.key);
    url.searchParams.set("email", email);
    url.searchParams.set("ip_address", "");
    const data = z
      .object({
        address: z.string().optional(),
        status: z.string().optional(),
        sub_status: z.string().optional(),
        error: z.string().optional(),
      })
      .parse(await providerJson("ZeroBounce", url, {}, request));
    if (data.error)
      throw new HttpError(502, `ZeroBounce: ${data.error.slice(0, 200)}`);
    sameAddress(data.address, email);
    const status = (data.status || "").toLowerCase();
    return {
      status: zeroBounceStatus[status] ?? "UNKNOWN",
      detail: `ZeroBounce: ${status || "no result"}${data.sub_status ? ` (${data.sub_status})` : ""}.`,
    };
  }
  const url = new URL(setup.url);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new HttpError(503, "Verification gateway requires HTTPS");
  const data = z
    .object({
      email: z.email(),
      status: z.enum(["VALID", "INVALID", "RISKY", "UNKNOWN"]),
    })
    .parse(
      await providerJson(
        "Email verification gateway",
        url,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${setup.key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email }),
        },
        request,
      ),
    );
  sameAddress(data.email, email);
  return { status: data.status, detail: `Verification gateway: ${data.status}.` };
}
