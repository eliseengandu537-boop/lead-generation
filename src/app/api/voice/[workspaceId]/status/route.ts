import { handle } from "@/lib/http";
import { voiceStatus } from "@/platform/calling/voice";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const response = await handle(async () =>
    voiceStatus((await params).workspaceId, request),
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
