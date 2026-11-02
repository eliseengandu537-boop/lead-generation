import { z } from "zod";
import { handle, json } from "@/lib/http";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { authenticateJob } from "@/platform/jobs";
export async function POST(request: Request) {
  return handle(async () => {
    const input = z
      .object({ jobId: z.string().max(100), workspaceId: z.string().max(100) })
      .strict()
      .parse(await json(request));
    const job = await authenticateJob(
      input.jobId,
      input.workspaceId,
      request.headers.get("authorization")?.replace(/^Bearer /, "") || "",
    );
    if (
      ![
        "WAITING_AUTOMATION",
        "READY",
        "RUNNING",
        "SUCCEEDED",
        "FAILED",
        "REVIEW_REQUIRED",
      ].includes(job.status)
    )
      throw new HttpError(409, "Job has not been dispatched");
    await db.platformJob.updateMany({
      where: { id: job.id, status: "WAITING_AUTOMATION" },
      data: { status: "READY", leaseUntil: null },
    });
    return { accepted: true, jobId: job.id };
  });
}
