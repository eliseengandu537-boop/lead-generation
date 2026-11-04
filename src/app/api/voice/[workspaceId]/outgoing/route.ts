import { NextResponse } from "next/server";
import { handle } from "@/lib/http";
import { outgoingCall } from "@/platform/calling/voice";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  let xml = "";
  const response = await handle(async () => {
    xml = await outgoingCall((await params).workspaceId, request);
    return { ready: true };
  });
  if (!response.ok) return response;
  return new NextResponse(xml, {
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
