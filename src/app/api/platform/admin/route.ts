import { handle, json } from "@/lib/http";
import { sameOrigin } from "@/lib/auth";
import { adminRead, adminWrite } from "@/platform/core";
export async function GET() {
  return handle(adminRead);
}
export async function POST(request: Request) {
  return handle(async () => {
    await sameOrigin();
    return adminWrite(await json(request));
  });
}
