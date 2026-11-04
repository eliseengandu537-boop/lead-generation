"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bot,
  Check,
  Copy,
  Download,
  KeyRound,
  LoaderCircle,
  MessageSquare,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { api, date, label, object, rows, text, type RecordValue } from "./data";
import { Badge } from "./primitives";

const endpoint = "/api/platform/admin/assistant";
export default function AssistantScreen({
  clients,
  onCreateClient,
}: {
  clients: RecordValue[];
  onCreateClient: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const clientSelect = useRef<HTMLSelectElement>(null);
  const commandInput = useRef<HTMLTextAreaElement>(null);
  const availableClients = clients.filter(
    (client) =>
      client.status === "ACTIVE" && client.onboardingStatus !== "DEMO",
  );
  const selectedClient = availableClients.find(
    (client) => client.workspaceId === clientId,
  );
  const [configuration, setConfiguration] = useState<RecordValue>({});
  const [conversations, setConversations] = useState<RecordValue[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [runs, setRuns] = useState<RecordValue[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [settings, setSettings] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4.1-mini");
  const [detail, setDetail] = useState<{
    kind: "credentials" | "review";
    action: RecordValue;
    data: RecordValue;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const modal = useRef<HTMLDialogElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const connectionForm = useRef<HTMLFormElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  function showConnection() {
    setSettings(true);
    requestAnimationFrame(() => {
      connectionForm.current?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
      keyInput.current?.focus({ preventScroll: true });
    });
  }
  const loadDirectory = useCallback(async () => {
    const result = await api(endpoint);
    setConfiguration(object(result.configuration));
    setConversations(rows(result.conversations));
    setModel(text(object(result.configuration).model, "gpt-4.1-mini"));
    return result;
  }, []);
  const loadConversation = useCallback(async (id: string) => {
    const result = await api(
      `${endpoint}?conversationId=${encodeURIComponent(id)}`,
    );
    setRuns(rows(result.runs));
    setWorking(Boolean(result.working));
  }, []);
  useEffect(() => {
    void loadDirectory()
      .then((result) => {
        const stored = localStorage.getItem("concrete-assistant-conversation");
        if (
          stored &&
          rows(result.conversations).some((item) => item.id === stored)
        )
          setConversationId(stored);
      })
      .catch((cause) => setError(cause.message));
  }, [loadDirectory]);
  useEffect(() => {
    if (!conversationId) {
      setRuns([]);
      return;
    }
    localStorage.setItem("concrete-assistant-conversation", conversationId);
    void loadConversation(conversationId).catch((cause) =>
      setError(cause.message),
    );
  }, [conversationId, loadConversation]);
  useEffect(() => {
    if (!conversationId || !(busy || working)) return;
    const timer = setInterval(() => {
      void loadConversation(conversationId).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [conversationId, busy, working, loadConversation]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [runs, busy]);
  useEffect(() => {
    if (detail) {
      setConfirmed(false);
      setCopied(false);
      setShowPassword(false);
      modal.current?.showModal();
    }
  }, [detail]);
  async function newConversation() {
    const result = await api(endpoint, "POST", { action: "new_conversation" });
    setConversationId(text(result.id));
    setRuns([]);
    await loadDirectory();
    return text(result.id);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || working) return;
    if (!connected) {
      showConnection();
      return;
    }
    if (!message.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    let activeId = conversationId;
    try {
      const id = conversationId || (await newConversation());
      activeId = id;
      const command = message.trim();
      await api(endpoint, "POST", {
        action: "message",
        conversationId: id,
        requestId: crypto.randomUUID(),
        message: command,
        ...(selectedClient ? { workspaceId: selectedClient.workspaceId } : {}),
      });
      setMessage("");
      await Promise.all([loadConversation(id), loadDirectory()]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The command did not finish. Check the recorded actions before repeating it.",
      );
      if (activeId) await loadConversation(activeId).catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api(endpoint, "POST", {
        action: "configure",
        apiKey,
        model,
      });
      setApiKey("");
      setSettings(false);
      setNotice(text(result.message));
      await loadDirectory();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "OpenAI could not connect.",
      );
    } finally {
      setApiKey("");
      setBusy(false);
    }
  }
  async function openAction(
    action: RecordValue,
    kind: "credentials" | "review",
  ) {
    setError("");
    try {
      const result = await api(
        `${endpoint}/actions/${encodeURIComponent(text(action.id))}`,
        "POST",
        { action: kind },
      );
      setDetail({ kind, action, data: result });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "This action is unavailable.",
      );
    }
  }
  function credentialText() {
    const login = object(detail?.data.login);
    return `Concrete client login\nBusiness: ${text(object(detail?.data.workspace).name)}\nLogin: ${text(login.url)}\nEmail: ${text(login.email)}\nPassword: ${text(login.password)}\n\nShare these details privately with the client.\n`;
  }
  async function copyLogin() {
    try {
      await navigator.clipboard.writeText(credentialText());
      setCopied(true);
    } catch {
      setError(
        "Copy is unavailable in this browser. You can download the login details instead.",
      );
    }
  }
  function downloadLogin() {
    const url = URL.createObjectURL(
      new Blob([credentialText()], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "concrete-client-login.txt";
    link.click();
    URL.revokeObjectURL(url);
  }
  async function launch() {
    if (!detail || !confirmed) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(
        `${endpoint}/actions/${encodeURIComponent(text(detail.action.id))}`,
        "POST",
        { action: "launch" },
      );
      setNotice(text(result.message));
      setDetail(null);
      if (conversationId) await loadConversation(conversationId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The campaign did not launch. Check its actual status.",
      );
    } finally {
      setBusy(false);
    }
  }
  const connected = Boolean(configuration.connected);
  const ready = Boolean(configuration.ready);
  const review = object(detail?.data.review);
  const blockers = Array.isArray(review.blockers)
    ? review.blockers.map(String)
    : [];
  const waiting = busy || working;
  return (
    <div className="assistant-page">
      <div className="assistant-heading">
        <div>
          <p className="eyebrow">CONCRETE AI ASSISTANT</p>
          <h2>Your AI workspace.</h2>
          <p>
            Chat naturally. Manage clients, leads and campaigns from one place.
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => {
            setSettings(!settings);
            setError("");
          }}
        >
          <KeyRound size={15} />
          AI settings
        </button>
      </div>
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
      {connected && !ready && (
        <div className="alert info" role="status">
          Your OpenAI key is saved, but API credit is unavailable. Add credit to
          your OpenAI API account or update the key in AI settings. Client and
          campaign forms are available below.
        </div>
      )}
      {settings && (
        <form
          ref={connectionForm}
          className="panel assistant-connection"
          onSubmit={connect}
        >
          <div>
            <span className="assistant-icon">
              <Bot size={22} />
            </span>
            <h3>
              {connected
                ? "Update OpenAI connection"
                : "Connect your OpenAI API account"}
            </h3>
            <p>
              The key stays encrypted on the server and is never included in
              chat messages.
            </p>
          </div>
          <label>
            OpenAI API key
            <input
              ref={keyInput}
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="off"
              required
              minLength={20}
              placeholder="Your private OpenAI API key"
            />
          </label>
          <label>
            OpenAI model
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
            >
              <option value="gpt-4.1-mini">GPT-4.1 mini</option>
            </select>
          </label>
          <button className="button" disabled={busy || working}>
            {busy ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <ShieldCheck size={15} />
            )}
            Test and connect
          </button>
          <small>
            This makes a small API connection test using your OpenAI API credit.
            You can close AI settings and keep writing your message.
          </small>
          <button type="button" onClick={() => setSettings(false)}>
            Close AI settings
          </button>
        </form>
      )}
      <div className="assistant-layout">
        <aside className="panel assistant-sidebar">
          <button
            className="button secondary"
            disabled={waiting}
            onClick={() => {
              void newConversation().catch((cause) => setError(cause.message));
            }}
          >
            <Plus size={15} />
            New chat
          </button>
          <button
            className="button secondary"
            disabled={waiting}
            onClick={onCreateClient}
          >
            <Plus size={15} />
            Add client
          </button>
          <p className="eyebrow">YOUR CONVERSATIONS</p>
          <div className="assistant-conversations">
            {conversations.length ? (
              conversations.map((item) => (
                <button
                  key={text(item.id)}
                  aria-current={conversationId === item.id ? "page" : undefined}
                  disabled={waiting}
                  onClick={() => setConversationId(text(item.id))}
                >
                  <MessageSquare size={14} />
                  <span>{text(item.title)}</span>
                </button>
              ))
            ) : (
              <p>Your conversations will appear here.</p>
            )}
          </div>
          <div className="assistant-scope">
            <ShieldCheck size={17} />
            <b>You stay in control</b>
            <p>
              Add clients, manage leads and prepare outreach for every business.
              Review the emails and recipients before sending.
            </p>
            <small>Only platform administrators can use this assistant.</small>
          </div>
        </aside>
        <section
          className="panel assistant-chat"
          aria-label="OpenAI operations assistant"
        >
          <header>
            <div>
              <span className="assistant-icon">
                <Sparkles size={19} />
              </span>
              <div>
                <b>Concrete Assistant</b>
                <small>Powered by OpenAI</small>
              </div>
            </div>
            <span
              className={`assistant-connection-state ${ready ? "connected" : ""}`}
            >
              <i />
              {ready
                ? "Ready"
                : connected
                  ? "API credit needed"
                  : "Connect OpenAI"}
            </span>
          </header>
          <div className="assistant-client-toolbar">
            <label>
              Working with
              <select
                ref={clientSelect}
                aria-label="Choose assistant client"
                value={selectedClient ? clientId : ""}
                disabled={waiting}
                onChange={(event) => setClientId(event.target.value)}
              >
                <option value="">All clients</option>
                {availableClients.map((client) => (
                  <option
                    key={text(client.workspaceId)}
                    value={text(client.workspaceId)}
                  >
                    {text(client.name)}
                  </option>
                ))}
              </select>
            </label>
            {selectedClient ? (
              <Link
                className="button secondary"
                href={`/?client=${encodeURIComponent(clientId)}&view=campaigns`}
              >
                Create and send campaign
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => clientSelect.current?.focus()}
              >
                Choose a client for a campaign
              </button>
            )}
          </div>
          <div
            className="assistant-messages"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {!runs.length && (
              <div className="assistant-welcome">
                <span className="assistant-icon">
                  <Bot size={28} />
                </span>
                <h3>How can I help?</h3>
                <p>
                  Add a client, plan outreach or check progress. Choose a client
                  above when you want to work on one business.
                </p>
                <div className="assistant-prompts">
                  {[
                    selectedClient
                      ? "Check this client's leads, campaigns and what needs attention."
                      : "Show my clients and what needs attention.",
                    "Help me add a new client and create their login.",
                    selectedClient
                      ? "Help me create an outreach campaign for this client."
                      : "Help me choose a client and create an outreach campaign.",
                  ].map((prompt) => (
                    <button
                      key={prompt}
                      disabled={waiting}
                      onClick={() => {
                        setMessage(prompt);
                        commandInput.current?.focus();
                      }}
                    >
                      {prompt}
                      <span>↗</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {runs.map((run) => (
              <div className="assistant-turn" key={text(run.id)}>
                <div className="assistant-message human">
                  <small>You</small>
                  <small>
                    {text(
                      availableClients.find(
                        (client) => client.workspaceId === run.workspaceId,
                      )?.name,
                      run.workspaceId ? "Selected client" : "All clients",
                    )}
                  </small>
                  <p>{text(run.message)}</p>
                </div>
                {Boolean(run.reply || run.error) && (
                  <div className="assistant-message claude">
                    <small>
                      <Sparkles size={12} />
                      Concrete Assistant
                    </small>
                    <p>{text(run.reply, text(run.error))}</p>
                  </div>
                )}
                {rows(run.actions).map((action) => (
                  <div className="assistant-action" key={text(action.id)}>
                    <div>
                      <div className="assistant-action-title">
                        <b>{text(action.summary)}</b>
                        <Badge value={action.status} />
                      </div>
                      <small>{date(action.createdAt)}</small>
                      {Boolean(action.error) && (
                        <p className="assistant-action-error">
                          {text(action.error)}
                        </p>
                      )}
                    </div>
                    <div className="assistant-action-buttons">
                      {action.type === "create_client" &&
                        action.status === "SUCCEEDED" && (
                          <button
                            className="button secondary"
                            onClick={() => {
                              void openAction(action, "credentials");
                            }}
                          >
                            <KeyRound size={14} />
                            View client login
                          </button>
                        )}
                      {action.type === "prepare_campaign_launch" && (
                        <button
                          className="button secondary"
                          onClick={() => {
                            void openAction(action, "review");
                          }}
                        >
                          Review emails
                        </button>
                      )}
                      {Boolean(action.targetBusinessId) && (
                        <a
                          className="assistant-workspace-link"
                          href={`/?client=${encodeURIComponent(text(action.targetBusinessId))}`}
                        >
                          Open business ↗
                        </a>
                      )}
                    </div>
                  </div>
                ))}
                {run.status === "RUNNING" && (
                  <p className="assistant-working" role="status">
                    <LoaderCircle className="spin" size={14} />
                    Working with your business records…
                  </p>
                )}
              </div>
            ))}
            {busy && !runs.some((run) => run.status === "RUNNING") && (
              <p className="assistant-working" role="status">
                <LoaderCircle className="spin" size={14} />
                Working…
              </p>
            )}
            <div ref={bottom} />
          </div>
          <form className="assistant-composer" onSubmit={submit}>
            {!connected && (
              <p className="assistant-connection-notice" role="status">
                You can write and edit your command here. Connect your OpenAI
                API key to run it.
                <Link href="/?client=1&view=campaigns">
                  {" "}
                  Create a campaign directly
                </Link>
              </p>
            )}
            <label className="sr-only" htmlFor="assistant-command">
              Your message
            </label>
            <textarea
              ref={commandInput}
              id="assistant-command"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={6000}
              disabled={waiting}
              placeholder={
                connected
                  ? "Message your assistant…"
                  : "Write your message here. Connect OpenAI when you are ready."
              }
              rows={3}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div>
              <small>Never paste passwords or API keys into chat.</small>
              <button
                className="button"
                disabled={waiting || (connected && !message.trim())}
              >
                {waiting ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Send size={15} />
                )}
                {connected ? "Send message" : "Connect OpenAI to chat"}
              </button>
            </div>
          </form>
        </section>
      </div>
      {detail && (
        <dialog
          className="assistant-detail panel"
          ref={modal}
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) setDetail(null);
          }}
          aria-labelledby="assistant-detail-title"
        >
          <div className="assistant-detail-heading">
            <div>
              <p className="eyebrow">
                {detail.kind === "credentials"
                  ? "PRIVATE CLIENT ACCESS"
                  : "REVIEW BEFORE SENDING"}
              </p>
              <h2 id="assistant-detail-title">
                {detail.kind === "credentials"
                  ? "Your client's login"
                  : text(review.name, "Campaign review")}
              </h2>
            </div>
            <button
              className="icon-button"
              aria-label="Close action details"
              disabled={busy}
              onClick={() => setDetail(null)}
            >
              <X size={19} />
            </button>
          </div>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {detail.kind === "credentials" ? (
            <div className="assistant-private-login">
              <p>
                Share these details privately with the client. They are
                available in this action for 30 minutes and are never sent to
                the AI.
              </p>
              <label>
                Business
                <input
                  readOnly
                  value={text(object(detail.data.workspace).name)}
                />
              </label>
              <label>
                Login URL
                <input readOnly value={text(object(detail.data.login).url)} />
              </label>
              <label>
                Email
                <input readOnly value={text(object(detail.data.login).email)} />
              </label>
              <label>
                Password
                <div>
                  <input
                    readOnly
                    aria-label="Client password"
                    type={showPassword ? "text" : "password"}
                    value={text(object(detail.data.login).password)}
                    autoComplete="off"
                  />
                  <button
                    className="button secondary"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </label>
              <div className="dialog-actions">
                <button className="button secondary" onClick={downloadLogin}>
                  <Download size={15} />
                  Download login
                </button>
                <button
                  className="button"
                  onClick={() => {
                    void copyLogin();
                  }}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? "Copied" : "Copy login"}
                </button>
              </div>
            </div>
          ) : (
            <div className="assistant-review">
              <p>
                <b>{text(review.businessName)}</b> ·{" "}
                {rows(review.recipients).length} recipients ·{" "}
                {text(review.timezone)}
              </p>
              <p>
                Sender:{" "}
                <b>
                  {text(
                    object(review.mailbox).email,
                    "No client mailbox connected",
                  )}
                </b>
              </p>
              <p>
                Daily limit: {String(review.dailyLimit || 0)} · Campaign status:{" "}
                {label(review.status)}
              </p>
              {blockers.length > 0 && (
                <div className="alert error">
                  <div>
                    <b>These items need attention before sending:</b>
                    <ul>
                      {blockers.map((blocker, index) => (
                        <li key={index}>{blocker}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              <h3>Initial emails and recipients</h3>
              <div className="assistant-email-list">
                {rows(review.recipients).map((recipient) => (
                  <article key={text(recipient.id)}>
                    <h4>
                      {text(recipient.company)} ·{" "}
                      {text(recipient.email, "Missing email address")}
                    </h4>
                    <b>{text(recipient.subject)}</b>
                    <p>{text(recipient.body)}</p>
                  </article>
                ))}
                {!rows(review.recipients).length && (
                  <p>No recipients have been selected for this campaign.</p>
                )}
              </div>
              {rows(review.steps).length > 0 && (
                <>
                  <h3>Follow-ups</h3>
                  {rows(review.steps).map((step, index) => (
                    <article className="assistant-followup" key={index}>
                      <h4>
                        Follow-up {index + 1} · after {String(step.delayDays)}{" "}
                        days
                      </h4>
                      <b>{text(step.subject)}</b>
                      <p>{text(step.body)}</p>
                    </article>
                  ))}
                </>
              )}
              <p className="assistant-review-footer">{text(review.footer)}</p>
              <p>
                Messages run through the existing eligibility checks and the
                automation worker. Starting a campaign does not mean its emails
                have been delivered.
              </p>
              {!blockers.length &&
                detail.action.status === "REVIEW_REQUIRED" && (
                  <label className="assistant-confirm">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    I reviewed the sender, every recipient, the emails and
                    follow-ups.
                  </label>
                )}
              <div className="dialog-actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setDetail(null)}
                >
                  Close review
                </button>
                <button
                  className="button"
                  disabled={
                    busy ||
                    !confirmed ||
                    blockers.length > 0 ||
                    detail.action.status !== "REVIEW_REQUIRED"
                  }
                  onClick={() => {
                    void launch();
                  }}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Send size={15} />
                  )}
                  Approve and launch campaign
                </button>
              </div>
            </div>
          )}
        </dialog>
      )}
    </div>
  );
}
