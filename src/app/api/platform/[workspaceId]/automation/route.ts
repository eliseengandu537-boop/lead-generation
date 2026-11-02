import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { handle } from "@/lib/http";
import { organizationAccess } from "@/platform/core";
import { jobKinds, orchestrationConfig } from "@/platform/jobs";

export const dynamic = "force-dynamic";

function summary(result: Prisma.JsonValue | null) {
  if (!result || typeof result !== "object" || Array.isArray(result))
    return null;
  return typeof result.summary === "string"
    ? result.summary.slice(0, 1000)
    : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return handle(async () => {
    const { workspaceId } = await params;
    await organizationAccess(workspaceId);
    let configurationState: "CONFIGURED" | "NOT_CONFIGURED" | "INVALID";
    try {
      configurationState = orchestrationConfig()
        ? "CONFIGURED"
        : "NOT_CONFIGURED";
    } catch {
      configurationState = "INVALID";
    }
    const [jobs, totals, groups] = await Promise.all([
      db.platformJob.findMany({
        where: { workspaceId },
        select: {
          id: true,
          kind: true,
          status: true,
          attempts: true,
          dispatchAttempts: true,
          runAt: true,
          leaseUntil: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
          error: true,
          result: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
      }),
      db.platformJob.groupBy({
        by: ["status"],
        where: { workspaceId },
        _count: { _all: true },
      }),
      db.platformJob.groupBy({
        by: ["kind", "status"],
        where: { workspaceId },
        _count: { _all: true },
        _sum: { attempts: true, dispatchAttempts: true },
      }),
    ]);
    const generatedAt = new Date();
    return {
      orchestrationConfigured: configurationState === "CONFIGURED",
      configurationState,
      activationState: "UNVERIFIED",
      counts: totals.map((group) => ({
        status: group.status,
        count: group._count._all,
      })),
      workflows: jobKinds.map((kind) => {
        const matching = groups.filter((group) => group.kind === kind);
        const count = (statuses: string[]) =>
          matching.reduce(
            (sum, group) =>
              sum + (statuses.includes(group.status) ? group._count._all : 0),
            0,
          );
        return {
          kind,
          total: matching.reduce((sum, group) => sum + group._count._all, 0),
          succeeded: count(["SUCCEEDED"]),
          failed: count(["FAILED"]),
          running: count(["RUNNING"]),
          queued: count(["QUEUED", "READY"]),
          waiting: count(["WAITING_AUTOMATION"]),
          reviewRequired: count(["REVIEW_REQUIRED"]),
          executionAttempts: matching.reduce(
            (sum, group) => sum + (group._sum.attempts || 0),
            0,
          ),
          dispatchAttempts: matching.reduce(
            (sum, group) => sum + (group._sum.dispatchAttempts || 0),
            0,
          ),
        };
      }),
      jobs: jobs.map(({ result, error, ...job }) => ({
        ...job,
        error: error?.slice(0, 1000) || null,
        resultSummary: summary(result),
        durationMs:
          job.startedAt && (job.completedAt || job.status === "RUNNING")
            ? Math.max(
                0,
                (job.completedAt || generatedAt).getTime() -
                  job.startedAt.getTime(),
              )
            : null,
        executionRetries: Math.max(0, job.attempts - 1),
        dispatchRetries: Math.max(0, job.dispatchAttempts - 1),
      })),
      returnedCount: jobs.length,
      generatedAt,
    };
  });
}
