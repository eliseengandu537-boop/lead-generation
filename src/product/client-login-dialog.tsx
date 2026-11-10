"use client";
import { useState } from "react";
import {
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  X,
} from "lucide-react";
import { api, object, text, type RecordValue } from "./data";
import { DetailPanel } from "./primitives";

export function ClientLoginDialog({
  businesses,
  workspaceId,
  close,
  created,
}: {
  businesses: RecordValue[];
  workspaceId?: string;
  close: () => void;
  created: () => void;
}) {
  const [business, setBusiness] = useState(workspaceId || "NEW");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RecordValue | null>(null);
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const login = object(result?.login);
  function loginText() {
    return [
      "MONETTIC — CLIENT LOGIN",
      "",
      `Business: ${text(object(result?.workspace).name)}`,
      `Login: ${text(login.url)}`,
      `Email: ${text(login.email)}`,
      `Password: ${text(login.password)}`,
      "",
      "Sign in to view your leads, campaigns, conversations and results.",
      "Keep these login details private. Use Forgot password on the login page whenever you need to choose a new password.",
    ].join("\n");
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(loginText());
      setCopied(true);
      setError("");
    } catch {
      setError(
        "Copy is unavailable in this browser. You can download the login details instead.",
      );
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([loginText()], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `Monettic-client-login-${text(login.email).replace(/[^a-zA-Z0-9.-]/g, "_")}.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <DetailPanel title="Create client login" close={busy ? () => {} : close}>
      <div className="client-access-panel">
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">CLIENT ACCESS</p>
            <h2>
              {result ? "Your client’s login is ready." : "Create client login"}
            </h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close client login"
            disabled={busy}
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        {result ? (
          <>
            <div className="alert success">
              <Check size={18} />
              <span>
                Access is ready for {text(object(result.workspace).name)}.
              </span>
            </div>
            <p className="dialog-detail">
              Copy or download these details before closing. The generated
              password is stored as a secure hash and cannot be displayed again.
            </p>
            <div className="client-access-fields">
              <label>
                Login page
                <input
                  aria-label="Client login page"
                  readOnly
                  value={text(login.url, "")}
                />
              </label>
              <label>
                Client email
                <input
                  aria-label="Created client email"
                  readOnly
                  value={text(login.email, "")}
                />
              </label>
              <label>
                Generated password
                <div className="client-password-field">
                  <input
                    aria-label="Generated client password"
                    type={visible ? "text" : "password"}
                    readOnly
                    value={text(login.password, "")}
                    autoComplete="off"
                  />
                  <button
                    className="icon-button"
                    aria-label={
                      visible
                        ? "Hide generated password"
                        : "Show generated password"
                    }
                    onClick={() => setVisible((value) => !value)}
                  >
                    {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>
            </div>
            <div className="client-access-actions">
              <button className="primary" onClick={() => void copy()}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? "Login details copied" : "Copy login details"}
              </button>
              <button onClick={download}>
                <Download size={16} />
                Download login details
              </button>
            </div>
            <p className="fine-print">
              The client can sign in immediately to their results portal. Share
              the details privately with them. Their login does not give access
              to platform administration or sending controls.
            </p>
            <button className="client-access-done" onClick={close}>
              Done
            </button>
          </>
        ) : (
          <>
            <p className="dialog-detail">
              Enter their email and we’ll generate a strong password. Choose
              their business or create one here.
            </p>
            <form
              className="client-access-fields"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError("");
                try {
                  const response = await api(
                    "/api/platform/admin/client-logins",
                    "POST",
                    {
                      name,
                      email,
                      ...(business === "NEW"
                        ? { businessName, websiteUrl }
                        : { workspaceId: business }),
                    },
                  );
                  setResult(response);
                  created();
                } catch (problem) {
                  setError((problem as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Client name
                <input
                  name="clientName"
                  required
                  maxLength={160}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={busy}
                  autoComplete="off"
                />
              </label>
              <label>
                Client email
                <input
                  name="clientEmail"
                  type="email"
                  required
                  maxLength={320}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={busy}
                  autoComplete="off"
                />
              </label>
              <label>
                Business workspace
                <select
                  name="clientWorkspace"
                  value={business}
                  onChange={(event) => setBusiness(event.target.value)}
                  disabled={busy}
                >
                  <option value="NEW">Create a new business workspace</option>
                  {businesses.map((item) => (
                    <option
                      key={text(item.workspaceId)}
                      value={text(item.workspaceId)}
                    >
                      {text(item.name)}
                    </option>
                  ))}
                </select>
              </label>
              {business === "NEW" && (
                <>
                  <label>
                    Business name
                    <input
                      name="clientBusiness"
                      required
                      minLength={2}
                      maxLength={160}
                      value={businessName}
                      onChange={(event) => setBusinessName(event.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <label>
                    Business website <span className="subtle">(optional)</span>
                    <input
                      name="clientWebsite"
                      type="url"
                      placeholder="https://yourclient.com"
                      maxLength={2048}
                      value={websiteUrl}
                      onChange={(event) => setWebsiteUrl(event.target.value)}
                      disabled={busy}
                    />
                  </label>
                </>
              )}
              <p className="client-access-scope">
                <KeyRound size={17} />
                Client results portal access. Your platform team manages
                settings, campaigns and sending.
              </p>
              <button className="primary" type="submit" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <KeyRound size={17} />
                )}
                {busy
                  ? "Creating login…"
                  : "Create login and generate password"}
              </button>
            </form>
          </>
        )}
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
      </div>
    </DetailPanel>
  );
}
