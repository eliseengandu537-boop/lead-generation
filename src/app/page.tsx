import { redirect } from "next/navigation";
import { currentUser, HttpError } from "@/lib/auth";
import MonetticApp from "@/product/shell";
import ClientPortal from "@/product/client-portal";
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  try {
    const user = await currentUser();
    if (user.staffRole === "CALLER" && !user.agencyAdmin) redirect("/caller");
    if (user.agencyAdmin && !(await searchParams).client) redirect("/admin");
    if (!user.agencyAdmin) return <ClientPortal />;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) redirect("/login");
    throw error;
  }
  return <MonetticApp />;
}
