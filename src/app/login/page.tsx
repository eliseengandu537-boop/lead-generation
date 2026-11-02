import { Suspense } from "react";
import AuthScreen from "@/product/auth-screen";
export default function LoginPage() {
  return (
    <Suspense
      fallback={<div className="loading-state">Opening your workspace…</div>}
    >
      <AuthScreen />
    </Suspense>
  );
}
