import { handle } from "@/lib/http";
import { currentUser, HttpError } from "@/lib/auth";
import { setupForAll } from "@/platform/setup";
export async function GET() {
  const response = await handle(async () => {
    const user = await currentUser();
    if (!user.agencyAdmin)
      throw new HttpError(403, "Platform administrator required.");
    return { clients: await setupForAll() };
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
