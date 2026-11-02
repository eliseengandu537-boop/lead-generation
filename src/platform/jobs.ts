import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { sign, safeEqual } from "@/lib/security";
export const jobKinds = [
  "ANALYZE_WEBSITE",
  "DISCOVER",
  "RESEARCH_LEAD",
  "QUALIFY",
  "VERIFY_EMAIL",
  "DRAFT_EMAIL",
  "SYNC_MAILBOX",
  "SEND_CAMPAIGN",
  "SEND_REPLY",
  "RECONCILE_MAIL",
  "CLASSIFY_REPLY",
  "REPORT",
] as const;
export const jobKindSchema = z.enum(jobKinds);
export async function enqueueJob(
  workspaceId: string,
  actorId: string | null,
  kind: string,
  payload: Prisma.InputJsonObject,
  dedupeKey: string = randomUUID(),
  tx: Prisma.TransactionClient = db,
) {
  jobKindSchema.parse(kind);
  return tx.platformJob.upsert({
    where: { workspaceId_dedupeKey: { workspaceId, dedupeKey } },
    create: { workspaceId, actorId, kind, payload, dedupeKey },
    update: {},
  });
}
export function orchestrationConfig() {
  const location =
    process.env.ORBIT_AUTOMATION_LOCATION === "local" ? "local" : "hosted";
  if (
    !process.env.N8N_WEBHOOK_SECRET ||
    process.env.N8N_WEBHOOK_SECRET.length < 32
  )
    return null;
  if (!process.env.N8N_BASE_URL) {
    if (location === "local")
      return { url: null, secret: process.env.N8N_WEBHOOK_SECRET, location };
    return null;
  }
  const url = new URL(process.env.N8N_BASE_URL);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        (process.env.NODE_ENV !== "production" || location === "local") &&
        url.protocol === "http:" &&
        [
          "localhost",
          "127.0.0.1",
          ...(location === "local" ? [] : ["n8n"]),
        ].includes(url.hostname)
      ))
  )
    throw new Error("Configure a trusted HTTPS n8n origin");
  return {
    url: url.href.replace(/\/$/, ""),
    secret: process.env.N8N_WEBHOOK_SECRET,
    location,
  };
}
export function jobToken(
  job: {
    id: string;
    workspaceId: string;
    kind: string;
    dispatchAttempts: number;
  },
  key: string,
) {
  return sign(
    `orbit:${job.workspaceId}:${job.id}:${job.kind}:${job.dispatchAttempts}`,
    key,
  );
}
export async function authenticateJob(
  id: string,
  workspaceId: string,
  token: string,
) {
  const config = orchestrationConfig();
  if (!config) throw new HttpError(503, "Automation is not configured");
  const job = await db.platformJob.findFirst({ where: { id, workspaceId } });
  if (!job || !safeEqual(token, jobToken(job, config.secret)))
    throw new HttpError(401, "Invalid job capability");
  return job;
}
export async function dispatchOneJob(
  workspaceId?: string,
  request: typeof fetch = fetch,
) {
  const config = orchestrationConfig();
  if (!config?.url) return false;
  const job = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT j.id FROM "PlatformJob" j JOIN "Workspace" w ON w.id=j."workspaceId" WHERE j.status='QUEUED' AND j."runAt"<=CURRENT_TIMESTAMP AND w.status='ACTIVE' AND (${workspaceId ?? null}::text IS NULL OR j."workspaceId"=${workspaceId ?? null}) ORDER BY j."createdAt" FOR UPDATE OF j SKIP LOCKED LIMIT 1`;
    if (!rows[0]) return null;
    return tx.platformJob.update({
      where: { id: rows[0].id },
      data: {
        status: "WAITING_AUTOMATION",
        dispatchAttempts: { increment: 1 },
        leaseUntil: new Date(Date.now() + 15 * 60000),
      },
    });
  });
  if (!job) return false;
  try {
    const response = await request(
      `${config.url}/webhook/orbit-${job.kind.toLowerCase().replaceAll("_", "-")}`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "X-Orbit-Secret": config.secret,
          "Idempotency-Key": job.id,
        },
        body: JSON.stringify({
          jobId: job.id,
          workspaceId: job.workspaceId,
          kind: job.kind,
          token: jobToken(job, config.secret),
          runUrl: `${process.env.NEXTAUTH_URL}/api/platform/automation/run`,
          statusUrl: `${process.env.NEXTAUTH_URL}/api/platform/automation/status?jobId=${job.id}&workspaceId=${job.workspaceId}`,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok)
      await db.platformJob.updateMany({
        where: { id: job.id, status: "WAITING_AUTOMATION" },
        data: {
          status:
            response.status === 429 && job.dispatchAttempts < 5
              ? "QUEUED"
              : "REVIEW_REQUIRED",
          runAt: new Date(Date.now() + 2 ** job.dispatchAttempts * 60000),
          error: `n8n rejected admission (HTTP ${response.status})`,
        },
      });
  } catch {
    await db.platformJob.updateMany({
      where: { id: job.id, status: "WAITING_AUTOMATION" },
      data: {
        status: "REVIEW_REQUIRED",
        error:
          "n8n admission outcome is uncertain. Review its execution before retrying.",
      },
    });
  }
  return true;
}
