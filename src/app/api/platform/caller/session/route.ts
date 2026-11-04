import { handle } from "@/lib/http";
import { callerSession } from "@/platform/calling/access";
export async function GET() {
  const response = await handle(callerSession);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
