import { handle, json } from "@/lib/http";
import { currentUser, sameOrigin, rateLimit, HttpError } from "@/lib/auth";
import { controlDb } from "@/lib/db";
import {
  createOrganizationInTransaction,
  organizationInput,
  platformSession,
} from "@/platform/core";
export async function GET() {
  return handle(platformSession);
}
export async function POST(request: Request) {
  return handle(async () => {
    await sameOrigin();
    const user = await currentUser();
    if (
      !user.agencyAdmin &&
      (await controlDb.membership.findFirst({
        where: { userId: user.id, role: "DEMO_VIEWER" },
        select: { workspaceId: true },
      }))
    )
      throw new HttpError(
        403,
        "The shared demo login can only view its sample workspace.",
      );
    await rateLimit(`organization-create:${user.id}`, 5, 60);
    const input = organizationInput.parse(await json(request));
    return controlDb.$transaction((transaction) =>
      createOrganizationInTransaction(transaction, user, input),
    );
  });
}
