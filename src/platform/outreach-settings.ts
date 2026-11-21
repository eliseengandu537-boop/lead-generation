import { z } from "zod";

/** One niche to search: what kind of business, and where ("Gauteng", "Cape Town", "South Africa"). */
export const nicheSchema = z.object({
  niche: z.string().trim().min(2).max(120),
  area: z.string().trim().min(2).max(120),
});

export const PROVINCES = [
  "Gauteng",
  "Western Cape",
  "KwaZulu-Natal",
  "Eastern Cape",
  "Free State",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
] as const;

/**
 * One outreach campaign inside the autopilot: which businesses (niches) in which provinces, sent
 * from which inboxes, with its own email and its own sales reps for replies. Lets one client run,
 * say, a Western Cape campaign from its Cape reps and a national one from head office.
 */
export const laneSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(80),
  niches: z.array(z.string().trim().min(2).max(80)).max(6).default([]),
  areas: z.array(z.string().trim().min(2).max(80)).max(12).default([]),
  mailboxIds: z.array(z.string().min(1).max(60)).max(20).default([]),
  replyTo: z.array(z.email()).max(5).default([]),
  subject: z.string().max(200).default(""),
  body: z.string().max(5000).default(""),
  campaignId: z.string().nullable().default(null),
});
export type OutreachLane = z.infer<typeof laneSchema>;

/** A client's outreach autopilot, stored on PlatformOrganization.outreach. */
export const outreachSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  lanes: z.array(laneSchema).max(8).default([]),
  /** Businesses whose name or listing contains one of these words are skipped. */
  exclude: z.array(z.string().trim().min(2).max(40)).max(30).default([]),
  sendStartHour: z.number().int().min(0).max(23).default(8),
  sendEndHour: z.number().int().min(1).max(24).default(17),
  // Older single-campaign settings; read through lanesOf().
  niches: z.array(nicheSchema).max(10).default([]),
  replyTo: z.array(z.email()).max(5).default([]),
  subject: z.string().max(200).default(""),
  body: z.string().max(5000).default(""),
  /** Emails per sending inbox per day. */
  dailyLimit: z.number().int().min(1).max(200).default(20),
  campaignId: z.string().nullable().default(null),
  approvedBy: z.string().nullable().default(null),
  approvedAt: z.string().nullable().default(null),
  nicheCursor: z.number().int().min(0).default(0),
  nextFindAt: z.string().nullable().default(null),
  lastFind: z
    .object({
      at: z.string(),
      niche: z.string(),
      area: z.string(),
      found: z.number().int(),
      added: z.number().int(),
      skipped: z.number().int().optional(),
      error: z.string().optional(),
    })
    .nullable()
    .default(null),
});
export type OutreachSettings = z.infer<typeof outreachSettingsSchema>;

/** Stored settings, or safe defaults when nothing (or something unreadable) is stored. */
export function outreachSettings(raw: unknown): OutreachSettings {
  const parsed = outreachSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : outreachSettingsSchema.parse({});
}

/** The campaigns, reading older single-campaign settings as one campaign called "Main". */
export function lanesOf(settings: OutreachSettings): OutreachLane[] {
  if (settings.lanes.length) return settings.lanes;
  if (!settings.niches.length && !settings.subject && !settings.body) return [];
  const unique = (values: string[]) => [...new Set(values)];
  return [
    {
      id: "main",
      name: "Main",
      niches: unique(settings.niches.map((item) => item.niche)).slice(0, 6),
      areas: unique(settings.niches.map((item) => item.area))
        .filter((area) => area.toLowerCase() !== "south africa")
        .slice(0, 12),
      mailboxIds: [],
      replyTo: settings.replyTo,
      subject: settings.subject,
      body: settings.body,
      campaignId: settings.campaignId,
    },
  ];
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Every niche-and-area search the autopilot runs, in order; each belongs to its campaign. */
export function searchTargets(lanes: OutreachLane[]) {
  const targets: { niche: string; area: string; lane: string }[] = [];
  for (const lane of lanes)
    for (const niche of lane.niches)
      for (const area of lane.areas.length ? lane.areas : ["South Africa"])
        if (!targets.some((item) => same(item.niche, niche) && same(item.area, area)))
          targets.push({ niche, area, lane: lane.id });
  return targets;
}

/** The campaign a found business belongs to: where it was found, else by its niche and area. */
export function laneFor(
  lanes: OutreachLane[],
  found: { lane?: unknown; niche?: unknown; area?: unknown } | null | undefined,
) {
  if (!lanes.length) return null;
  const byId = lanes.find((lane) => lane.id === found?.lane);
  if (byId) return byId;
  const niche = typeof found?.niche === "string" ? found.niche : "";
  const area = typeof found?.area === "string" ? found.area : "";
  const inArea = (lane: OutreachLane) =>
    !lane.areas.length || lane.areas.some((item) => same(item, area));
  return (
    lanes.find((lane) => lane.niches.some((item) => same(item, niche)) && inArea(lane)) ??
    (lanes.length === 1 ? lanes[0] : null)
  );
}

/** The sales reps who receive replies: the campaign's own, else the client's general list. */
export function outreachReplyTo(raw: unknown, laneId?: unknown) {
  const settings = outreachSettings(raw);
  const lane = lanesOf(settings).find((item) => item.id === laneId);
  return lane?.replyTo.length ? lane.replyTo : settings.replyTo;
}

/** True when a business name or listing matches one of the client's skip words. */
export function excluded(words: string[], ...text: (string | null | undefined)[]) {
  const haystack = text.filter(Boolean).join(" ").toLowerCase();
  return words.some((word) => word.trim() && haystack.includes(word.trim().toLowerCase()));
}

/** "warren@x.com" → "Warren", "gary.basel@x.com" → "Gary": the name in "I'm {{sender}}". */
export function senderFirstName(email: string) {
  const first = email.split("@")[0].split(/[._+-]/)[0] ?? "";
  return first ? first[0].toUpperCase() + first.slice(1).toLowerCase() : "";
}

/** Fills {{sender}} with the first name of the inbox the email goes out from. */
export function withSender(text: string, mailboxEmail: string) {
  return text.replace(/\{\{\s*sender\s*\}\}/g, senderFirstName(mailboxEmail));
}

/** {{fields}} other than the lead's own details, which must be replaced before launch. */
export function placeholdersLeft(...content: string[]) {
  return [
    ...new Set(
      content.flatMap((value) =>
        [...value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
          .map((match) => match[1].trim())
          .filter((field) => !["name", "company", "email", "industry", "sender"].includes(field)),
      ),
    ),
  ];
}

/** A stored business profile as a plain object (empty when missing or unreadable). */
export function profileOf(profile: unknown): Record<string, unknown> {
  return profile && typeof profile === "object" && !Array.isArray(profile)
    ? (profile as Record<string, unknown>)
    : {};
}

/** The name businesses see in the email and the POPIA notice: the profile's company name, else the workspace name. */
export function senderBusinessName(profile: unknown, workspaceName: string) {
  const name = profileOf(profile).companyName;
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 200) : workspaceName;
}

const FIND_EVERY = 2 * 3600000;
const RETRY_FIND = 30 * 60000;
type FindResult = { niche: string; area: string; error?: string };
/**
 * Which niche to search next and when. A failed search (e.g. a slow connection) is retried once
 * after 30 minutes instead of skipping that area for a whole cycle; a second failure moves on.
 */
export function nextSearch(
  cursor: number,
  previous: FindResult | null | undefined,
  result: FindResult,
  now = Date.now(),
) {
  const failedAgain =
    !!previous?.error && previous.niche === result.niche && previous.area === result.area;
  const retry = !!result.error && !failedAgain;
  return {
    nicheCursor: retry ? cursor : cursor + 1,
    nextFindAt: new Date(now + (retry ? RETRY_FIND : FIND_EVERY)).toISOString(),
  };
}
