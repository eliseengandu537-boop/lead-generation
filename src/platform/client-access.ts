import { randomBytes } from "node:crypto";
import { hash as passwordHash } from "bcryptjs";
import { z } from "zod";
import { currentUser, HttpError, rateLimit } from "@/lib/auth";
import { controlDb } from "@/lib/db";
import { createOrganizationInTransaction } from "./core";

export const clientLoginInput = z
  .object({
    name: z.string().trim().min(1).max(160),
    email: z.string().trim().max(320).toLowerCase().pipe(z.email()),
    workspaceId: z.string().min(1).max(100).optional(),
    businessName: z.string().trim().min(2).max(160).optional(),
    websiteUrl: z.union([z.url().max(2048), z.literal("")]).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (Boolean(input.workspaceId) === Boolean(input.businessName))
      context.addIssue({
        code: "custom",
        message: "Choose an existing business or enter a new business name.",
      });
    if (input.workspaceId && input.websiteUrl)
      context.addIssue({
        code: "custom",
        message: "Manage the existing business website from its workspace.",
      });
  });

export async function createClientLogin(input: unknown) {
  const admin = await currentUser();
  if (!admin.agencyAdmin)
    throw new HttpError(403, "Platform administrator required");
  await rateLimit(`client-login-create:${admin.id}`, 30, 60);
  const values = clientLoginInput.parse(input);
  const password = randomBytes(24).toString("base64url") + "!9";
  const digest = await passwordHash(password, 12);
  const loginUrl = new URL(
    "/login",
    process.env.NEXTAUTH_URL || "http://localhost:3100",
  ).href;
  const result = await controlDb.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${values.email}))`;
      if (
        await tx.user.findUnique({
          where: { email: values.email },
          select: { id: true },
        })
      )
        throw new HttpError(
          409,
          "This email already has an account. Its password was not changed. You can add the existing account from the business workspace’s Team page.",
        );
      let workspace: { id: string; name: string };
      if (values.workspaceId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${values.workspaceId}))`;
        const existing = await tx.workspace.findUnique({
          where: { id: values.workspaceId },
          select: {
            id: true,
            name: true,
            status: true,
            _count: { select: { memberships: true } },
            platformOrganization: {
              select: {
                onboardingStatus: true,
                subscription: {
                  select: { plan: { select: { teamMembers: true } } },
                },
              },
            },
          },
        });
        if (!existing?.platformOrganization)
          throw new HttpError(404, "Business workspace not found");
        if (
          existing.status !== "ACTIVE" ||
          existing.platformOrganization.onboardingStatus === "DEMO"
        )
          throw new HttpError(
            400,
            "Choose an active client business workspace.",
          );
        const limit =
          existing.platformOrganization.subscription?.plan.teamMembers;
        if (!limit || existing._count.memberships >= limit)
          throw new HttpError(
            403,
            "This business has reached its team member limit. Update its plan before adding another login.",
          );
        workspace = { id: existing.id, name: existing.name };
      } else workspace = { id: "", name: values.businessName! };
      const client = await tx.user.create({
        data: {
          email: values.email,
          name: values.name,
          passwordHash: digest,
          agencyAdmin: false,
          requiresVerification: false,
        },
        select: { id: true, name: true, email: true },
      });
      if (values.workspaceId) {
        await tx.membership.create({
          data: {
            userId: client.id,
            workspaceId: workspace.id,
            role: "CLIENT_VIEWER",
          },
        });
      } else {
        const organization = await createOrganizationInTransaction(
          tx,
          client,
          { name: values.businessName!, websiteUrl: values.websiteUrl || "" },
          admin.id,
        );
        workspace = { id: organization.workspaceId, name: organization.name };
      }
      await tx.platformActivity.create({
        data: {
          workspaceId: workspace.id,
          actorId: admin.id,
          kind: "CLIENT_LOGIN_CREATED",
          detail: `Platform administrator created client portal access for ${client.email}.`,
        },
      });
      return { client, workspace };
    },
    { maxWait: 10000, timeout: 30000 },
  );
  return {
    ...result,
    login: { url: loginUrl, email: values.email, password },
    message:
      "Client login created. Copy the generated password now and share it privately with the client.",
  };
}
