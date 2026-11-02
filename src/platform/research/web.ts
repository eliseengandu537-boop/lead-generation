import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { load } from "cheerio";
import ipaddr from "ipaddr.js";
import robotsParser from "robots-parser";

const BOT = "OrbitResearchBot";
const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 10_000;
const BLOCKED_DOMAINS = [
  "google.com",
  "gmail.com",
  "googleusercontent.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
];

export type WebsiteEvidence = {
  url: string;
  title: string;
  excerpt: string;
  fetchedAt: string;
};

export type WebsiteResearch = {
  company: string;
  description: string;
  email: string | null;
  phone: string | null;
  evidence: WebsiteEvidence[];
  warnings: string[];
};

/** Fail closed for private, reserved, multicast and IP translation/tunnel ranges. */
export function isPublicAddress(address: string): boolean {
  if (!isIP(address) || address.includes("%")) return false;
  try {
    const parsed = ipaddr.parse(address);
    if (parsed.range() !== "unicast") return false;
    if (parsed.kind() === "ipv6") {
      const bytes = parsed.toByteArray();
      // Restrict IPv6 to global unicast. Also deny IETF special-purpose and
      // documentation prefixes even if an older ipaddr version omits them.
      if ((bytes[0] & 0xe0) !== 0x20) return false;
      if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] < 2) return false;
      if (bytes[0] === 0x3f && bytes[1] === 0xff && (bytes[2] & 0xf0) === 0)
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

function validateTarget(url: URL): URL {
  if (!["https:", "http:"].includes(url.protocol))
    throw new Error("Use a public HTTP or HTTPS business website.");
  if (url.username || url.password)
    throw new Error("Website credentials are not permitted.");
  if (url.port && !["80", "443"].includes(url.port))
    throw new Error("Only website ports 80 and 443 are permitted.");
  const hostname = url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (!hostname || /[\s%]/.test(hostname))
    throw new Error("Invalid website hostname.");
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname))
      throw new Error(
        "Private or reserved network addresses are not permitted.",
      );
  } else {
    if (
      !hostname.includes(".") ||
      !/^[a-z\d.-]+$/.test(hostname) ||
      hostname
        .split(".")
        .some(
          (label) =>
            !label ||
            label.length > 63 ||
            label.startsWith("-") ||
            label.endsWith("-"),
        ) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion|home|lan|corp)$/.test(
        hostname,
      )
    )
      throw new Error(
        "Use a public business website, not a local or internal hostname.",
      );
    if (
      BLOCKED_DOMAINS.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      )
    )
      throw new Error(
        "Research the company's own website; account, social and map sites are not supported.",
      );
    url.hostname = hostname;
  }
  if (url.href.length > 2048) throw new Error("Website URL is too long.");
  return url;
}

/** A prospect is deduplicated by website origin; paths and tracking are removed. */
export function normalizeWebsite(input: string): string {
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.length > 2048 ||
    /[\\\u0000-\u0020\u007f]/.test(input.trim())
  )
    throw new Error("Enter a valid public business website.");
  const value = input.trim();
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`,
    );
  } catch {
    throw new Error("Enter a valid public business website.");
  }
  validateTarget(url);
  return url.origin;
}

const clean = (value: string, max: number) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
const unique = (values: string[]) => [...new Set(values)];
const validEmail = (value: string) =>
  value.length <= 254 &&
  /^[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d](?:[a-z\d.-]*[a-z\d])?\.[a-z]{2,63}$/i.test(
    value,
  ) &&
  !/\.(?:png|jpe?g|gif|svg|webp|woff2?)$/i.test(value) &&
  !/^(?:noreply|no-reply|donotreply)@/i.test(value);
const validPhone = (value: string) => {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
};

/** Extract only published text/contact details; never execute scripts or guess emails. */
export function extractPage(
  html: string,
  url: string,
): {
  title: string;
  description: string;
  text: string;
  emails: string[];
  phones: string[];
  links: string[];
} {
  const $ = load(html.slice(0, MAX_BYTES));
  const title = clean($("title").first().text(), 240);
  const description = clean(
    $("meta[name='description']").first().attr("content") ||
      $("meta[property='og:description']").first().attr("content") ||
      "",
    1000,
  );
  $(
    "script,style,noscript,template,iframe,svg,canvas,textarea,input,select,button,[hidden],[inert],[aria-hidden='true'],.hidden,.d-none,.sr-only,.visually-hidden",
  ).remove();
  $("[style]").each((_, element) => {
    if (
      /(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\s*[;!]|\s*$))/i.test(
        $(element).attr("style") || "",
      )
    )
      $(element).remove();
  });
  $("br,p,div,li,section,article,h1,h2,h3,h4,tr,td").append(" ");
  const body = clean($("body").text(), 60_000);
  const emails: string[] = [];
  const phones: string[] = [];
  const links: string[] = [];
  const origin = new URL(url).origin;
  $("a[href]").each((_, element) => {
    const href = ($(element).attr("href") || "").trim();
    if (/^mailto:/i.test(href)) {
      try {
        emails.push(
          ...decodeURIComponent(href.slice(7).split("?")[0])
            .split(/[,;]/)
            .map((email) => email.trim().toLowerCase()),
        );
      } catch {
        /* malformed published href */
      }
    } else if (/^tel:/i.test(href)) {
      try {
        phones.push(clean(decodeURIComponent(href.slice(4).split("?")[0]), 60));
      } catch {
        /* malformed published href */
      }
    } else {
      try {
        const link = validateTarget(new URL(href, url));
        if (
          link.origin === origin &&
          !/\.(?:pdf|zip|png|jpe?g|gif|svg|webp|mp[34])$/i.test(link.pathname)
        ) {
          link.hash = "";
          // Form/login/search and tracking URLs are not research pages.
          if (
            !link.search &&
            !/(?:^|\/)(?:login|signin|sign-in|account|admin|checkout|logout|search)(?:\/|$)/i.test(
              link.pathname,
            )
          )
            links.push(link.href);
        }
      } catch {
        /* ignore unsupported and unsafe links */
      }
    }
  });
  emails.push(
    ...(
      body.match(/[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d.-]+\.[a-z]{2,63}/gi) || []
    ).map((email) => email.replace(/\.$/, "").toLowerCase()),
  );
  phones.push(
    ...(body.match(
      /(?:\+\d[\d ()-]{6,24}\d|\b0\d{1,3}[ ()-]\d[\d ()-]{5,16}\d\b)/g,
    ) || []),
  );
  return {
    title,
    description,
    text: body.slice(0, 20_000),
    emails: unique(emails.filter(validEmail)).slice(0, 30),
    phones: unique(
      phones.map((phone) => clean(phone, 60)).filter(validPhone),
    ).slice(0, 20),
    links: unique(links).slice(0, 80),
  };
}

type Response = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  url: string;
};

async function vettedAddress(
  hostname: string,
): Promise<{ address: string; family: number }> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (!isPublicAddress(host))
      throw new Error(
        "Private or reserved network addresses are not permitted.",
      );
    return { address: host, family: isIP(host) };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      dns.lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Website DNS lookup timed out.")),
          TIMEOUT_MS,
        );
      }),
    ]);
    if (
      !addresses.length ||
      addresses.some(({ address }) => !isPublicAddress(address))
    )
      throw new Error(
        "Website resolves to a private or reserved network address.",
      );
    return addresses[0];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function requestOnce(
  input: string,
  maxBytes = MAX_BYTES,
): Promise<Response> {
  const url = validateTarget(new URL(input));
  const address = await vettedAddress(url.hostname);
  return new Promise((resolve, reject) => {
    // Pin DNS to the vetted address for this connection. Never allow a second
    // resolver lookup or pooled socket to bypass the network-address check.
    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) callback(null, [address]);
      else callback(null, address.address, address.family);
    };
    let settled = false;
    const finish = (error?: Error, result?: Response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result!);
    };
    const request = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: "GET",
        agent: false,
        lookup,
        family: address.family,
        headers: {
          "User-Agent": `${BOT}/1.0 (+public-business-research; no-login)`,
          Accept: "text/html,text/plain;q=0.9",
          "Accept-Encoding": "identity",
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const rejectResponse = (message: string) => {
          finish(new Error(message));
          response.destroy();
          request.destroy();
        };
        if (Number(response.headers["content-length"]) > maxBytes)
          return rejectResponse(
            "Website response exceeds the research size limit.",
          );
        if (
          response.headers["content-encoding"] &&
          response.headers["content-encoding"] !== "identity"
        )
          return rejectResponse(
            "Compressed website responses are not supported for safe research.",
          );
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes)
            return rejectResponse(
              "Website response exceeds the research size limit.",
            );
          chunks.push(Buffer.from(chunk));
        });
        response.on("error", (error) => finish(error));
        response.on("aborted", () =>
          finish(new Error("Website response was interrupted.")),
        );
        response.on("end", () =>
          finish(undefined, {
            status: response.statusCode || 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            url: url.href,
          }),
        );
      },
    );
    const timer = setTimeout(() => {
      finish(new Error("Website request timed out."));
      request.destroy();
    }, TIMEOUT_MS);
    request.on("error", (error) => finish(error));
    request.end();
  });
}

/** Fetch at most the homepage and two same-origin contact/about pages. */
export async function researchWebsite(input: string): Promise<WebsiteResearch> {
  const website = normalizeWebsite(input);
  const initialHost = new URL(website).hostname.replace(/^www\./, "");
  const policies = new Map<string, ReturnType<typeof robotsParser>>();
  const lastRequest = new Map<string, number>();
  const warnings: string[] = [];

  async function policyFor(origin: string) {
    const cached = policies.get(origin);
    if (cached) return cached;
    let robotsUrl = `${origin}/robots.txt`;
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 3; redirects++) {
      response = await requestOnce(robotsUrl, 256_000);
      if (response.status >= 300 && response.status < 400) {
        if (!response.headers.location || redirects === 3)
          throw new Error(
            "Unable to safely verify website robots.txt redirects.",
          );
        const next = validateTarget(
          new URL(response.headers.location, robotsUrl),
        );
        if (next.origin !== origin)
          throw new Error(
            "Website robots.txt redirects outside its origin; research stopped.",
          );
        robotsUrl = next.href;
      } else break;
    }
    if (!response) throw new Error("Unable to verify website robots.txt.");
    if (![200, 404, 410].includes(response.status))
      throw new Error(
        `Website robots.txt returned ${response.status}; research stopped.`,
      );
    if (
      response.status === 200 &&
      /(?:text\/html|application\/xhtml)/i.test(
        String(response.headers["content-type"] || ""),
      )
    )
      throw new Error(
        "Website robots.txt returned HTML; its research policy could not be verified.",
      );
    if (
      response.status === 200 &&
      /^\s*(?:<!doctype|<html)/i.test(response.body)
    )
      throw new Error("Website robots.txt is not a valid text policy.");
    const policy = robotsParser(
      `${origin}/robots.txt`,
      response.status === 200 ? response.body : "",
    );
    policies.set(origin, policy);
    return policy;
  }

  async function getPage(
    inputUrl: string,
    requiredOrigin?: string,
  ): Promise<Response> {
    let url = validateTarget(new URL(inputUrl));
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (requiredOrigin && url.origin !== requiredOrigin)
        throw new Error(
          "Information page redirected outside the homepage origin; research stopped.",
        );
      if (url.hostname.replace(/^www\./, "") !== initialHost)
        throw new Error(
          "Website redirected to a different business domain; research stopped.",
        );
      const policy = await policyFor(url.origin);
      if (policy.isAllowed(url.href, BOT) === false)
        throw new Error(
          "Website robots.txt does not allow this research page.",
        );
      const delay = Math.max(300, (policy.getCrawlDelay(BOT) || 0) * 1000);
      if (delay > 5000)
        throw new Error("Website crawl delay exceeds the research time limit.");
      const remaining =
        delay - (Date.now() - (lastRequest.get(url.origin) || 0));
      if (remaining > 0)
        await new Promise((resolve) => setTimeout(resolve, remaining));
      lastRequest.set(url.origin, Date.now());
      const response = await requestOnce(url.href);
      if (response.status >= 300 && response.status < 400) {
        if (!response.headers.location || redirects === 3)
          throw new Error("Website redirect limit reached.");
        url = validateTarget(new URL(response.headers.location, url));
        continue;
      }
      if (response.status !== 200)
        throw new Error(
          `Website returned ${response.status}; no restricted pages were accessed.`,
        );
      if (
        !/(?:text\/html|application\/xhtml\+xml)/i.test(
          String(response.headers["content-type"] || ""),
        )
      )
        throw new Error("Website did not return an HTML research page.");
      const $ = load(response.body);
      const directives = [
        String(response.headers["x-robots-tag"] || ""),
        $("meta[name='robots'],meta[name='OrbitResearchBot']")
          .map((_, element) => $(element).attr("content") || "")
          .get()
          .join(","),
      ].join(",");
      if (/\b(?:none|noindex|nosnippet|noai)\b/i.test(directives))
        throw new Error(
          "Website page requests exclusion from indexing or text research.",
        );
      return response;
    }
    throw new Error("Website redirect limit reached.");
  }

  const homepage = await getPage(`${website}/`);
  const home = extractPage(homepage.body, homepage.url);
  const pages = [{ page: home, response: homepage }];
  const links = home.links
    .filter((link) => {
      const path = new URL(link).pathname;
      return /(?:^|[\/_-])(?:contact(?:-us)?|about(?:-us)?|company)(?:[\/_-]|$|\.html?)/i.test(
        path,
      );
    })
    .sort((a, b) => Number(!/contact/i.test(a)) - Number(!/contact/i.test(b)))
    .slice(0, 2);
  for (const link of links) {
    try {
      const response = await getPage(link, new URL(homepage.url).origin);
      if (!pages.some((item) => item.response.url === response.url))
        pages.push({
          page: extractPage(response.body, response.url),
          response,
        });
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? error.message
          : "An information page could not be researched.",
      );
    }
  }
  const emails = unique(pages.flatMap(({ page }) => page.emails));
  const domain = new URL(homepage.url).hostname.replace(/^www\./, "");
  const emailScore = (email: string) =>
    Number(email.split("@")[1] === domain) * 10 +
    Number(
      /^(?:info|hello|contact|sales|office|enquiries|inquiries|support|admin)@/.test(
        email,
      ),
    ) *
      2;
  emails.sort((a, b) => emailScore(b) - emailScore(a));
  const evidence = pages.map(({ page, response }) => ({
    url: response.url,
    title: page.title,
    excerpt: clean(
      [
        page.title,
        page.description,
        page.emails.length ? `Published emails: ${page.emails.join(", ")}` : "",
        page.phones.length ? `Published phones: ${page.phones.join(", ")}` : "",
        page.text,
      ]
        .filter(Boolean)
        .join("\n"),
      6000,
    ),
    fetchedAt: new Date().toISOString(),
  }));
  return {
    company: clean(home.title.split(/\s+[|–—]\s+/)[0] || domain, 180),
    description: clean(home.description || home.text, 1500),
    email: emails[0] || null,
    phone: pages.flatMap(({ page }) => page.phones)[0] || null,
    evidence,
    warnings: unique(warnings).slice(0, 10),
  };
}
