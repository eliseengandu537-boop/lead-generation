import { redirect } from "next/navigation";
import { currentUser, HttpError } from "@/lib/auth";
import { controlDb } from "@/lib/db";
import MonetticApp from "@/product/shell";
import ClientPortal from "@/product/client-portal";

/** A read-only demo administrator sees the operator screens of demo businesses only. */
async function demoAdministrator(userId: string) {
  return Boolean(
    await controlDb.membership.findFirst({
      where: {
        userId,
        role: "DEMO_ADMIN",
        workspace: { platformOrganization: { onboardingStatus: "DEMO" } },
      },
      select: { userId: true },
    }),
  );
}
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  try {
    const user = await currentUser();
    if (user.staffRole === "CALLER" && !user.agencyAdmin) redirect("/caller");
    if (user.agencyAdmin && !(await searchParams).client) redirect("/admin");
    if (!user.agencyAdmin && !(await demoAdministrator(user.id)))
      return <ClientPortal />;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) redirect("/login");
    throw error;
  }
  return <MonetticApp />;
}
