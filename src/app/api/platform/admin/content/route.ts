import { handle } from "@/lib/http";
import { contentRead } from "@/platform/admin-workbench";
export async function GET() {
  const response = await handle(() => contentRead());
  response.headers.set("Cache-Control", "no-store");
  return response;
}
