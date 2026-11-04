import { redirect } from "next/navigation";
import { currentUser, HttpError } from "@/lib/auth";
import CallerDashboard from "@/product/caller-dashboard";

export default async function CallerPage() {
  try {
    const user = await currentUser();
    if (!user.agencyAdmin && user.staffRole !== "CALLER") redirect("/");
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) redirect("/login");
    throw error;
  }
  return <CallerDashboard />;
}
