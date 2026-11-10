"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, KeyRound, MailCheck } from "lucide-react";
import { api, text } from "./data";
import { MonetticMark } from "./primitives";
import { ThemeToggle } from "./theme";
export default function AccountScreen() {
  const search = useSearchParams();
  const requested = search.get("mode") || "request-reset";
  const mode = [
    "verify",
    "reset",
    "request-reset",
    "resend-verification",
  ].includes(requested)
    ? requested
    : "request-reset";
  const token = search.get("token") || "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const titles: Record<string, string> = {
    verify: "Let's make it official.",
    reset: "A fresh start for your password.",
    "request-reset": "Let's get you back in.",
    "resend-verification": "Your next step is in your inbox.",
  };
  const details: Record<string, string> = {
    verify: "Confirm your email to activate your Monettic account.",
    reset: "Choose a unique passphrase for your account.",
    "request-reset": "We'll email you a link to reset your password.",
    "resend-verification": "Request a new email verification link.",
  };
  return (
    <div className="account-page">
      <div className="account-theme">
        <ThemeToggle />
      </div>
      <Link href="/login" className="brand">
        <MonetticMark />
        <span>MONETTIC.</span>
      </Link>
      <main className="account-card surface" id="main-content">
        <span className="feature-icon">
          {mode === "verify" || mode === "resend-verification" ? (
            <MailCheck size={27} />
          ) : (
            <KeyRound size={27} />
          )}
        </span>
        <p className="eyebrow">YOUR ACCOUNT</p>
        <h1>{titles[mode]}</h1>
        <p>{details[mode]}</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            const form = new FormData(event.currentTarget);
            try {
              const input =
                mode === "verify"
                  ? { action: mode, token }
                  : mode === "reset"
                    ? {
                        action: mode,
                        token,
                        password: String(form.get("password")),
                      }
                    : { action: mode, email: String(form.get("email")) };
              const result = await api("/api/identity", "POST", input);
              setNotice(
                text(result.message, "Your request has been processed."),
              );
            } catch (problem) {
              setError((problem as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode === "reset" ? (
            <label>
              New password
              <input
                name="password"
                type="password"
                minLength={16}
                maxLength={128}
                required
                autoComplete="new-password"
              />
              <em>
                At least 16 characters. A memorable passphrase works well.
              </em>
            </label>
          ) : mode !== "verify" ? (
            <label>
              Account email
              <input name="email" type="email" required autoComplete="email" />
            </label>
          ) : null}
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              {notice}
            </div>
          )}
          {!notice && (
            <button
              className="primary"
              disabled={
                busy || ((mode === "verify" || mode === "reset") && !token)
              }
            >
              {busy
                ? "One moment…"
                : mode === "verify"
                  ? "Verify my email"
                  : mode === "reset"
                    ? "Save new password"
                    : "Send email link"}
              <ArrowRight size={16} />
            </button>
          )}
          {(mode === "verify" || mode === "reset") && !token && (
            <p className="fine-print">
              This link is incomplete. Request a new link from the sign-in page.
            </p>
          )}
        </form>
        <Link href="/login" className="back-link">
          Return to sign in
          <ArrowRight size={15} />
        </Link>
      </main>
    </div>
  );
}
