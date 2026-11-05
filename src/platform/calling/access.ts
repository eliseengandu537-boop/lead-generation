import { controlDb, db } from "@/lib/db";
import { currentUser, HttpError, tenant } from "@/lib/auth";

export async function callerAccess(workspaceId: string) {
  const access = await tenant(workspaceId);
  if (
    !access.user.agencyAdmin &&
    (access.user.staffRole !== "CALLER" || access.role !== "CALLER")
  )
    throw new HttpError(403, "Caller access to this business is required.");
  if (access.workspace.status !== "ACTIVE")
    throw new HttpError(403, "This business is not active.");
  const organization = await db.platformOrganization.findUnique({
    where: { workspaceId },
  });
  if (!organization || organization.onboardingStatus === "DEMO")
    throw new HttpError(403, "Choose an active real business.");
  return {
    ...access,
    organization,
    canSend: access.user.agencyAdmin,
  };
}

export async function callerSession() {
  const user = await currentUser();
  if (!user.agencyAdmin && user.staffRole !== "CALLER")
    throw new HttpError(403, "A caller account is required.");
  const businesses = await controlDb.platformOrganization.findMany({
    where: {
      onboardingStatus: { not: "DEMO" },
      workspace: {
        status: "ACTIVE",
        ...(!user.agencyAdmin
          ? { memberships: { some: { userId: user.id, role: "CALLER" } } }
          : {}),
      },
    },
    select: {
      workspaceId: true,
      websiteUrl: true,
      workspace: {
        select: {
          name: true,
          timezone: true,
          memberships: {
            where: { userId: user.id },
            select: { callerCanSend: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return {
    user,
    businesses: businesses.map((business, index) => ({
      workspaceId: business.workspaceId,
      name: user.agencyAdmin
        ? business.workspace.name
        : businesses.length > 1
          ? `Concrete queue ${index + 1}`
          : "Concrete",
      timezone: business.workspace.timezone,
      ...(user.agencyAdmin
        ? { websiteUrl: business.websiteUrl, canSend: true }
        : {}),
    })),
  };
}

export function callerLeadFilter(user: { id: string; agencyAdmin: boolean }) {
  return user.agencyAdmin
    ? {}
    : { OR: [{ ownerId: user.id }, { ownerId: null }] };
}

export async function bookingHosts(workspaceId: string) {
  return controlDb.user.findMany({
    where: {
      disabledAt: null,
      OR: [
        { agencyAdmin: true },
        {
          staffRole: "CALLER",
          memberships: { some: { workspaceId, role: "CALLER" } },
        },
      ],
    },
    select: { id: true, name: true, email: true },
    orderBy: [{ agencyAdmin: "desc" }, { name: "asc" }],
  });
}
