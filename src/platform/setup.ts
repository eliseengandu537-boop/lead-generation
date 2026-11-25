import { controlDb, db } from "@/lib/db";
import { lanesOf, outreachSettings, placeholdersLeft } from "./outreach-settings";

export type SetupStep = {
  id: "plan" | "niches" | "email" | "reps" | "inbox" | "started";
  label: string;
  done: boolean;
  detail: string;
  /** The client-workspace view where this step is done, or "admin" for platform settings. */
  view: string;
};

const dayMonth = (value: Date) =>
  value.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    timeZone: "Africa/Johannesburg",
  });

/** Where a client stands on getting the outreach autopilot sending. Read from recorded data. */
export async function setupStatus(
  workspaceId: string,
  client: typeof controlDb = db,
): Promise<{ steps: SetupStep[]; done: number; total: number }> {
  const [organization, subscription, mailboxes] = await Promise.all([
    client.platformOrganization.findUnique({
      where: { workspaceId },
      select: { outreach: true },
    }),
    client.platformSubscription.findUnique({
      where: { workspaceId },
      select: { status: true, periodEnd: true },
    }),
    client.platformMailbox.findMany({
      where: { workspaceId },
      select: { status: true },
    }),
  ]);
  const settings = outreachSettings(organization?.outreach);
  const now = new Date();
  const planLive =
    !!subscription &&
    ["TRIAL", "ACTIVE"].includes(subscription.status) &&
    (!subscription.periodEnd || subscription.periodEnd > now);
  const live = mailboxes.filter((box) => box.status === "LIVE_ENABLED").length;
  const lanes = lanesOf(settings);
  const emailReady =
    lanes.length > 0 &&
    lanes.every(
      (lane) =>
        !!lane.subject.trim() &&
        !!lane.body.trim() &&
        !placeholdersLeft(lane.subject, lane.body).length,
    );
  const reps = [...new Set(lanes.flatMap((lane) => (lane.replyTo.length ? lane.replyTo : settings.replyTo)))];
  const lanesWithoutReps = lanes.filter((lane) => !lane.replyTo.length && !settings.replyTo.length);
  const steps: SetupStep[] = [
    {
      id: "plan",
      label: "Plan active",
      done: planLive,
      detail: !subscription
        ? "No plan assigned."
        : planLive
          ? subscription.periodEnd
            ? `Runs until ${dayMonth(subscription.periodEnd)}.`
            : "Active."
          : subscription.periodEnd && subscription.periodEnd <= now
            ? `Ended ${dayMonth(subscription.periodEnd)}. Sending is blocked until renewed.`
            : `Plan is ${subscription.status.toLowerCase()}.`,
      view: "admin",
    },
    {
      id: "niches",
      label: "Choose who to email",
      done: lanes.some((lane) => lane.niches.length > 0),
      detail: lanes.length
        ? lanes
            .map((lane) => `${lane.niches.join(", ") || "no niche"} · ${lane.areas.length ? lane.areas.join(", ") : "all of South Africa"}`)
            .join("; ")
        : "Add the kinds of businesses and areas to email.",
      view: "outreach",
    },
    {
      id: "email",
      label: "Write the email",
      done: emailReady,
      detail: emailReady
        ? lanes.map((lane) => lane.subject).join(" · ")
        : "Write the subject and message for each campaign.",
      view: "outreach",
    },
    {
      id: "reps",
      label: "Add the sales reps",
      done: lanes.length > 0 && !lanesWithoutReps.length,
      detail: reps.length
        ? `Replies go to ${reps.join(", ")}.`
        : "Add who should get the replies.",
      view: "outreach",
    },
    {
      id: "inbox",
      label: "Connect the sending inbox",
      done: live > 0,
      detail: mailboxes.length
        ? `${mailboxes.length} connected, ${live} switched on for sending.`
        : "Connect the client's Google Workspace or Microsoft 365 inbox.",
      view: "mailboxes",
    },
    {
      id: "started",
      label: "Start outreach",
      done: settings.enabled,
      detail: settings.enabled ? "Running." : "Not started yet.",
      view: "outreach",
    },
  ];
  return {
    steps,
    done: steps.filter((step) => step.done).length,
    total: steps.length,
  };
}

/** Setup progress for every client, for the admin Clients list and the Workshop board. */
export async function setupForAll() {
  const organizations = await controlDb.platformOrganization.findMany({
    // The agency's own calling desk is not a client and has nothing to set up.
    where: { workspace: { status: "ACTIVE" }, onboardingStatus: { not: "AGENCY" } },
    select: { workspaceId: true },
  });
  const entries = await Promise.all(
    organizations.map(async ({ workspaceId }) => {
      const status = await setupStatus(workspaceId, controlDb);
      const next = status.steps.find((step) => !step.done);
      return [
        workspaceId,
        {
          done: status.done,
          total: status.total,
          next: next?.label ?? null,
          steps: status.steps,
        },
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
}
