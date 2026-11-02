import { redirect } from "next/navigation";
import { currentUser, HttpError } from "@/lib/auth";
import AdminScreen from "@/product/admin-screen";
export default async function AdminPage() {
  let user;
  try {
    user = await currentUser();
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) redirect("/login");
    throw error;
  }
  if (!user.agencyAdmin) redirect("/");
  return <AdminScreen />;
}
