import type { PlatformCampaign, PlatformMailbox } from "@prisma/client";
import { db } from "@/lib/db";
import { domainBlockers } from "./authentication";

/** A new mailbox starts at this many campaign emails a day and adds warmupStep each day. */
export const warmupStart = 5;
export const warmupStep = 2;
/** Outbound messages that count against a day's allowance. */
export const countedStatuses = ["SENDING", "ACCEPTED", "REVIEW_REQUIRED"];

export const startOfUtcDay = (now = new Date()) => {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  return day;
};

/** Campaign emails this mailbox may send today, allowing for its warm-up ramp. */
export function dailyAllowance(
  mailbox: Pick<PlatformMailbox, "dailyLimit" | "warmupStartedAt">,
  now = new Date(),
) {
  if (!mailbox.warmupStartedAt) return mailbox.dailyLimit;
  const days = Math.max(
    0,
    Math.floor((now.getTime() - mailbox.warmupStartedAt.getTime()) / 86400000),
  );
  return Math.min(mailbox.dailyLimit, warmupStart + warmupStep * days);
}
export function warmupProgress(
  mailbox: Pick<PlatformMailbox, "dailyLimit" | "warmupStartedAt">,
  now = new Date(),
) {
  const allowance = dailyAllowance(mailbox, now);
  return {
    allowance,
    complete: allowance >= mailbox.dailyLimit,
    daysLeft: Math.max(0, Math.ceil((mailbox.dailyLimit - allowance) / warmupStep)),
  };
}

/** The campaign's main mailbox followed by the extra mailboxes it rotates through. */
export function campaignMailboxIds(
  campaign: Pick<PlatformCampaign, "mailboxId" | "extraMailboxIds">,
) {
  return [
    ...new Set(
      [campaign.mailboxId, ...campaign.extraMailboxIds].filter(
        (id): id is string => !!id,
      ),
    ),
  ];
}

type Candidate = Pick<
  PlatformMailbox,
  | "id"
  | "status"
  | "dailyLimit"
  | "warmupStartedAt"
  | "lastSentAt"
  | "lastSyncedAt"
  | "minimumIntervalSeconds"
  | "domainHealth"
>;
/** Picks the mailbox for one recipient. A recipient stays with the mailbox that first wrote to
 * them; otherwise the least-used mailbox that is synced, healthy and free to send now wins. */
export function pickSendingMailbox(
  rotation: string[],
  mailboxes: Candidate[],
  sentToday: Map<string, number>,
  pinned: string | null,
  now = new Date(),
) {
  const byId = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));
  const usable = (mailbox: Candidate | undefined): mailbox is Candidate =>
    !!mailbox &&
    mailbox.status === "LIVE_ENABLED" &&
    !domainBlockers(mailbox.domainHealth).length;
  if (pinned && rotation.includes(pinned) && usable(byId.get(pinned)))
    return pinned;
  const time = now.getTime();
  const ranked = rotation
    .map((id) => byId.get(id))
    .filter(usable)
    .map((mailbox) => {
      const readyAt = mailbox.lastSentAt
        ? mailbox.lastSentAt.getTime() + mailbox.minimumIntervalSeconds * 1000
        : 0;
      return {
        id: mailbox.id,
        sent: sentToday.get(mailbox.id) ?? 0,
        allowance: dailyAllowance(mailbox, now),
        waiting: readyAt > time,
        readyAt,
        synced: !!mailbox.lastSyncedAt && mailbox.lastSyncedAt.getTime() > time - 60000,
      };
    })
    .sort(
      (a, b) =>
        Number(b.synced) - Number(a.synced) ||
        Number(a.waiting) - Number(b.waiting) ||
        a.sent / a.allowance - b.sent / b.allowance ||
        a.readyAt - b.readyAt,
    );
  return (ranked.find((entry) => entry.sent < entry.allowance) ?? ranked[0])?.id ?? null;
}

export async function sentTodayByMailbox(workspaceId: string, mailboxIds: string[], now = new Date()) {
  const counts = await db.platformMailMessage.groupBy({
    by: ["mailboxId"],
    where: {
      workspaceId,
      mailboxId: { in: mailboxIds },
      direction: "OUTBOUND",
      status: { in: countedStatuses },
      createdAt: { gte: startOfUtcDay(now) },
    },
    _count: { _all: true },
  });
  return new Map(counts.map((entry) => [entry.mailboxId, entry._count._all]));
}

/** The mailbox that sends this campaign step. A retry always reuses the mailbox of its reserved message. */
export async function sendingMailboxFor(
  workspaceId: string,
  campaign: Pick<PlatformCampaign, "id" | "mailboxId" | "extraMailboxIds">,
  leadId: string,
  dedupeKey: string,
) {
  const rotation = campaignMailboxIds(campaign);
  const existing = await db.platformMailMessage.findUnique({
    where: { workspaceId_dedupeKey: { workspaceId, dedupeKey } },
    select: { mailboxId: true },
  });
  if (existing) return existing.mailboxId;
  if (rotation.length < 2) return rotation[0] ?? null;
  const [recipient, previous, mailboxes, sentToday] = await Promise.all([
    db.platformCampaignRecipient.findFirst({
      where: { workspaceId, campaignId: campaign.id, leadId },
      select: { mailboxId: true },
    }),
    db.platformMailMessage.findFirst({
      where: { workspaceId, campaignId: campaign.id, leadId, direction: "OUTBOUND" },
      orderBy: { createdAt: "desc" },
      select: { mailboxId: true },
    }),
    db.platformMailbox.findMany({ where: { workspaceId, id: { in: rotation } } }),
    sentTodayByMailbox(workspaceId, rotation),
  ]);
  return (
    pickSendingMailbox(
      rotation,
      mailboxes,
      sentToday,
      recipient?.mailboxId ?? previous?.mailboxId ?? null,
    ) ?? rotation[0]
  );
}
