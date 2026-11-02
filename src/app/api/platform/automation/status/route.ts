import { handle } from "@/lib/http";
import { authenticateJob } from "@/platform/jobs";
export async function GET(request: Request) {
  return handle(async () => {
    const query = new URL(request.url).searchParams;
    const job = await authenticateJob(
      query.get("jobId") || "",
      query.get("workspaceId") || "",
      request.headers.get("authorization")?.replace(/^Bearer /, "") || "",
    );
    return {
      jobId: job.id,
      status: job.status,
      terminal: ["SUCCEEDED", "FAILED", "REVIEW_REQUIRED"].includes(job.status),
      result: job.result,
      error: job.error,
    };
  });
}
