import { handle } from "@/lib/http";
import { adminInsights } from "@/platform/admin-view";
export async function GET(request: Request) {
  return handle(() => adminInsights(new URL(request.url).searchParams));
}
