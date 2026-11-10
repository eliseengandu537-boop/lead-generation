"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Check, LoaderCircle, Sparkles } from "lucide-react";
import { api, text } from "./data";
import { MonetticMark } from "./primitives";
import { ThemeToggle } from "./theme";
export default function AuthScreen() {
  const search = useSearchParams();
  const [mode, setMode] = useState(
    search.get("mode") === "register" ? "register" : "login",
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="auth-page">
      <aside className="auth-story">
        <Link href="/login" className="brand">
          <MonetticMark />
          <span>
            MONETTIC<span className="brand-dot">.</span>
          </span>
        </Link>
        <div className="auth-story-content">
          <p className="eyebrow">BUSINESS GROWTH. WITH PURPOSE.</p>
          <h1>
            Intelligence
            <br />
            meets
            <br />
            <em>opportunity.</em>
          </h1>
          <p>
            Know your market. Qualify the right businesses. Build your next
            conversation with confidence.
          </p>
          <div className="auth-proof">
            <span>
              <Check size={16} />
              Your business context
            </span>
            <span>
              <Check size={16} />
              Your own email
            </span>
            <span>
              <Check size={16} />
              Your approval
            </span>
          </div>
        </div>
        <div className="auth-orbit-art" aria-hidden="true">
          <i />
          <i />
          <b>
            <Sparkles size={28} />
          </b>
        </div>
        <p className="auth-story-footer">
          Good businesses deserve better conversations.
        </p>
      </aside>
      <main className="auth-main" id="main-content">
        <Link href="/login" className="brand auth-mobile-brand">
          <MonetticMark />
          <span>MONETTIC.</span>
        </Link>
        <div className="auth-topline">
          <ThemeToggle />
          <span>
            {mode === "login" ? "New to Monettic?" : "Already part of Monettic?"}
          </span>
          <button
            className="text-button"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
              setNotice("");
            }}
          >
            {mode === "login" ? "Create an account" : "Sign in"}
            <ArrowRight size={14} />
          </button>
        </div>
        <div className="auth-form-wrap">
          <span className="auth-kicker">
            <i />
            YOUR NEXT CHAPTER STARTS HERE
          </span>
          <h2>
            {mode === "login" ? "Welcome back." : "Make space for growth."}
          </h2>
          <p>
            {mode === "login"
              ? "Sign in to keep your business moving forward."
              : "Give your business a workspace built for better connections."}
          </p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              setNotice("");
              const form = new FormData(event.currentTarget);
              try {
                if (mode === "login") {
                  const result = await signIn("credentials", {
                    email: form.get("email"),
                    password: form.get("password"),
                    redirect: false,
                  });
                  if (result?.error)
                    throw new Error(
                      "We couldn't sign you in. Check your email and password, and confirm your email is verified.",
                    );
                  window.location.assign("/");
                } else {
                  const result = await api("/api/identity", "POST", {
                    action: "register",
                    name: String(form.get("name")),
                    business: String(form.get("business")),
                    email: String(form.get("email")),
                    password: String(form.get("password")),
                  });
                  setNotice(
                    text(
                      result.message,
                      "Check your email to verify your account before signing in.",
                    ),
                  );
                }
              } catch (problem) {
                setError((problem as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {mode === "register" && (
              <>
                <label>
                  Your name
                  <input
                    name="name"
                    required
                    autoComplete="name"
                    maxLength={160}
                    placeholder="What should we call you?"
                  />
                </label>
                <label>
                  Business name
                  <input
                    name="business"
                    required
                    autoComplete="organization"
                    minLength={2}
                    maxLength={160}
                    placeholder="Your business"
                  />
                </label>
              </>
            )}
            <label>
              Business email
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@yourbusiness.com"
              />
            </label>
            <label>
              <span className="password-label">
                Password
                {mode === "login" && (
                  <Link href="/account?mode=request-reset">
                    Forgot password?
                  </Link>
                )}
              </span>
              <input
                name="password"
                type="password"
                required
                minLength={mode === "register" ? 16 : undefined}
                maxLength={128}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                placeholder={
                  mode === "register"
                    ? "At least 16 characters"
                    : "Your password"
                }
              />
              {mode === "register" && (
                <em>Use a unique passphrase with at least 16 characters.</em>
              )}
            </label>
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
            <button className="primary auth-submit" disabled={busy}>
              {busy && <LoaderCircle className="spin" size={17} />}
              {busy
                ? "One moment…"
                : mode === "login"
                  ? "Sign in to your workspace"
                  : "Create your business account"}
              <ArrowRight size={17} />
            </button>
          </form>
          <div className="auth-footnote">
            <span className="secure-dot" />
            {mode === "login"
              ? "Your business data stays in your business workspace."
              : "A verification email will confirm your account."}
          </div>
          <Link
            className="auth-secondary"
            href="/account?mode=resend-verification"
          >
            Need a new verification email?
          </Link>
        </div>
        <footer>MONETTIC · Better business conversations.</footer>
      </main>
    </div>
  );
}
