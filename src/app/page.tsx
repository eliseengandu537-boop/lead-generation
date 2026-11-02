import { redirect } from "next/navigation";
import { currentUser, HttpError } from "@/lib/auth";
import OrbitApp from "@/product/shell";
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  try {
    const user = await currentUser();
    if (user.agencyAdmin && !(await searchParams).client) redirect("/admin");
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) redirect("/login");
    throw error;
  }
  return <OrbitApp />;
}
