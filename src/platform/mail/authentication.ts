import { promises as dns } from "node:dns";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";

type Resolver = Pick<typeof dns, "resolveTxt" | "resolveCname">;
const checkSchema = z.object({
  status: z.enum(["PASS", "WARN", "FAIL", "ERROR"]),
  detail: z.string(),
});
const healthSchema = z.object({
  domain: z.string(),
  checkedAt: z.string(),
  spf: checkSchema,
  dkim: checkSchema,
  dmarc: checkSchema,
});
export type DomainCheck = z.infer<typeof checkSchema>;
export type DomainHealth = z.infer<typeof healthSchema>;

const providerSetup = {
  GMAIL: {
    label: "Google Workspace",
    spf: "_spf.google.com",
    selectors: ["google"],
    dkimHelp: "Google Admin › Apps › Gmail › Authenticate email",
  },
  MICROSOFT: {
    label: "Microsoft 365",
    spf: "spf.protection.outlook.com",
    selectors: ["selector1", "selector2"],
    dkimHelp: "Microsoft Defender › Email authentication settings › DKIM",
  },
};

const absent = (error: unknown) =>
  ["ENODATA", "ENOTFOUND"].includes(
    String((error as NodeJS.ErrnoException)?.code),
  );
async function txt(resolver: Resolver, name: string) {
  try {
    return (await resolver.resolveTxt(name)).map((parts) => parts.join("").trim());
  } catch (error) {
    if (absent(error)) return [];
    throw error;
  }
}
const isSpf = (record: string) => /^v=spf1(\s|$)/i.test(record);

/** Whether an SPF record, or a record it includes (two levels deep), names the provider. */
async function spfIncludes(
  record: string,
  target: string,
  resolver: Resolver,
  depth = 2,
): Promise<boolean> {
  const names = record
    .split(/\s+/)
    .map((term) => /^(?:[+?~-]?include:|redirect=)(.+)$/i.exec(term)?.[1])
    .filter((name): name is string => !!name)
    .map((name) => name.toLowerCase().replace(/\.$/, ""));
  if (names.includes(target)) return true;
  if (depth <= 0) return false;
  for (const name of names.slice(0, 5)) {
    const nested = (await txt(resolver, name)).find(isSpf);
    if (nested && (await spfIncludes(nested, target, resolver, depth - 1)))
      return true;
  }
  return false;
}

async function spfCheck(
  domain: string,
  setup: (typeof providerSetup)["GMAIL"],
  resolver: Resolver,
): Promise<DomainCheck> {
  const records = (await txt(resolver, domain)).filter(isSpf);
  if (!records.length)
    return {
      status: "FAIL",
      detail: `${domain} has no SPF record. Add this TXT record at ${domain}: v=spf1 include:${setup.spf} ~all`,
    };
  if (records.length > 1)
    return {
      status: "FAIL",
      detail: `${domain} has ${records.length} SPF records, so receiving servers reject all of them. Merge them into one.`,
    };
  if (!(await spfIncludes(records[0], setup.spf, resolver)))
    return {
      status: "WARN",
      detail: `The SPF record for ${domain} does not include ${setup.label} (include:${setup.spf}), so SPF will fail and delivery depends on DKIM alone.`,
    };
  const all = /(?:^|\s)([+?~-]?)all(?:\s|$)/i.exec(records[0]);
  if (all && (all[1] === "" || all[1] === "+"))
    return {
      status: "WARN",
      detail: `The SPF record for ${domain} ends in +all, which lets anyone send as this domain. Change it to ~all.`,
    };
  return { status: "PASS", detail: `SPF authorizes ${setup.label}.` };
}

async function dkimCheck(
  domain: string,
  setup: (typeof providerSetup)["GMAIL"],
  resolver: Resolver,
): Promise<DomainCheck> {
  let delegated = false;
  for (const selector of setup.selectors) {
    const name = `${selector}._domainkey.${domain}`;
    if ((await txt(resolver, name)).some((record) => /(?:^|;)\s*p=[A-Za-z0-9+/]/.test(record)))
      return { status: "PASS", detail: `DKIM key published at ${name}.` };
    try {
      delegated ||= (await resolver.resolveCname(name)).length > 0;
    } catch (error) {
      if (!absent(error)) throw error;
    }
  }
  return {
    status: "WARN",
    detail: delegated
      ? `The DKIM records for ${domain} point to ${setup.label}, but no key is published yet. Turn on DKIM signing in ${setup.dkimHelp}.`
      : `No DKIM key found for ${domain} at the ${setup.label} selector. Turn on DKIM in ${setup.dkimHelp}. If you set up a custom selector, you can ignore this.`,
  };
}

async function dmarcCheck(domain: string, resolver: Resolver): Promise<DomainCheck> {
  const labels = domain.split(".");
  // A subdomain without its own record inherits the parent domain's policy.
  for (let start = 0; labels.length - start >= 2; start++) {
    const owner = labels.slice(start).join(".");
    const records = (await txt(resolver, `_dmarc.${owner}`)).filter((record) =>
      /^v=DMARC1\s*(;|$)/i.test(record),
    );
    if (records.length > 1)
      return {
        status: "FAIL",
        detail: `_dmarc.${owner} has ${records.length} DMARC records, so receivers ignore them. Keep one.`,
      };
    if (records.length) {
      const policy = /(?:^|;)\s*p=(none|quarantine|reject)\s*(?:;|$)/i.exec(records[0])?.[1];
      if (!policy)
        return {
          status: "FAIL",
          detail: `The DMARC record at _dmarc.${owner} has no valid p= policy.`,
        };
      return {
        status: "PASS",
        detail: `DMARC policy is p=${policy.toLowerCase()}${start ? ` (set on ${owner})` : ""}.`,
      };
    }
  }
  return {
    status: "FAIL",
    detail: `${domain} has no DMARC record. Add this TXT record at _dmarc.${domain}: v=DMARC1; p=none`,
  };
}

const defaultResolver = () => new dns.Resolver({ timeout: 3000, tries: 2 });

/** Looks up SPF, DKIM and DMARC for the domain a mailbox sends from. */
export async function checkSendingDomain(
  email: string,
  provider: string,
  resolver: Resolver = defaultResolver(),
): Promise<DomainHealth> {
  const domain = email.split("@").pop()!.toLowerCase();
  const setup = providerSetup[provider === "MICROSOFT" ? "MICROSOFT" : "GMAIL"];
  const guard = (check: () => Promise<DomainCheck>) =>
    check().catch(
      (error): DomainCheck => ({
        status: "ERROR",
        detail: `The DNS lookup for ${domain} did not finish (${(error as NodeJS.ErrnoException)?.code || "error"}). Check again shortly.`,
      }),
    );
  const [spf, dkim, dmarc] = await Promise.all([
    guard(() => spfCheck(domain, setup, resolver)),
    guard(() => dkimCheck(domain, setup, resolver)),
    guard(() => dmarcCheck(domain, resolver)),
  ]);
  return { domain, checkedAt: new Date().toISOString(), spf, dkim, dmarc };
}

export function readDomainHealth(value: Prisma.JsonValue | null | undefined) {
  const parsed = healthSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
/** Problems that stop a mailbox sending: SPF and DMARC are required, DKIM is advised. */
export function domainBlockers(value: Prisma.JsonValue | null | undefined) {
  const health = readDomainHealth(value);
  if (!health) return ["The sending domain has not been checked yet."];
  return [health.spf, health.dmarc]
    .filter((check) => check.status === "FAIL" || check.status === "ERROR")
    .map((check) => check.detail);
}
export function domainWarnings(value: Prisma.JsonValue | null | undefined) {
  const health = readDomainHealth(value);
  return health
    ? [health.spf, health.dkim, health.dmarc]
        .filter((check) => check.status === "WARN" || (check === health.dkim && check.status === "ERROR"))
        .map((check) => check.detail)
    : [];
}

/** Re-checks mailboxes whose domain result is older than maxAgeMs. One lookup per domain. */
export async function refreshDomainHealth(
  workspaceId: string,
  maxAgeMs: number,
  mailboxIds?: string[],
  resolver?: Resolver,
) {
  const stale = await db.platformMailbox.findMany({
    where: {
      workspaceId,
      status: { not: "DEMO" },
      ...(mailboxIds ? { id: { in: mailboxIds } } : {}),
      OR: [
        { domainCheckedAt: null },
        { domainCheckedAt: { lt: new Date(Date.now() - maxAgeMs) } },
      ],
    },
    select: { id: true, email: true, provider: true, domainHealth: true },
  });
  const lookups = new Map<string, Promise<DomainHealth>>();
  for (const mailbox of stale) {
    const key = `${mailbox.provider}:${mailbox.email.split("@").pop()}`;
    if (!lookups.has(key))
      lookups.set(key, checkSendingDomain(mailbox.email, mailbox.provider, resolver));
  }
  for (const mailbox of stale) {
    const health = await lookups.get(`${mailbox.provider}:${mailbox.email.split("@").pop()}`)!;
    // A lookup that did not finish must not replace a result that did.
    if (readDomainHealth(mailbox.domainHealth) && [health.spf, health.dmarc].some((check) => check.status === "ERROR"))
      continue;
    await db.platformMailbox.update({
      where: { id: mailbox.id },
      data: { domainHealth: health, domainCheckedAt: new Date() },
    });
  }
  return stale.length;
}
