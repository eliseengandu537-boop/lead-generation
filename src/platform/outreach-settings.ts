import { z } from "zod";

/** One niche to search: what kind of business, and where ("Gauteng", "Cape Town", "South Africa"). */
export const nicheSchema = z.object({
  niche: z.string().trim().min(2).max(120),
  area: z.string().trim().min(2).max(120),
});

/** A client's outreach autopilot, stored on PlatformOrganization.outreach. */
export const outreachSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  niches: z.array(nicheSchema).max(10).default([]),
  replyTo: z.array(z.email()).max(5).default([]),
  subject: z.string().max(200).default(""),
  body: z.string().max(5000).default(""),
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

/** The client's sales reps who should receive replies to campaign emails. */
export function outreachReplyTo(raw: unknown) {
  return outreachSettings(raw).replyTo;
}

/** {{fields}} other than the lead's own details, which must be replaced before launch. */
export function placeholdersLeft(...content: string[]) {
  return [
    ...new Set(
      content.flatMap((value) =>
        [...value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
          .map((match) => match[1].trim())
          .filter((field) => !["name", "company", "email", "industry"].includes(field)),
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
