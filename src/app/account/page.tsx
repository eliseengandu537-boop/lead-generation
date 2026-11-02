import { Suspense } from "react";
import AccountScreen from "@/product/account-screen";
export default function AccountPage() {
  return (
    <Suspense
      fallback={<div className="loading-state">Opening your account…</div>}
    >
      <AccountScreen />
    </Suspense>
  );
}
