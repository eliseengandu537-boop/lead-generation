import { handle } from "@/lib/http";
import { platformSession } from "@/platform/core";
export async function GET() {
  return handle(platformSession);
}
