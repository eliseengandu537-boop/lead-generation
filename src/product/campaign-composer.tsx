"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  LoaderCircle,
  Plus,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { api, rows, text, type Organization, type RecordValue } from "./data";

type Step = { delayDays: number; subject: string; body: string };
// Unfilled {{fields}} block launch, so the template cannot go out unedited.
const permissionTemplate = {
  subject: "Quick question for {{company}}",
  body: "Hello {{company}} team,\n\nI'm reaching out from {{your business}}. We {{what you offer, in one sentence}}.\n\nWould you like to receive occasional emails from us about {{topic}}? Reply YES and we'll be in touch.",
};
const stages = ["Leads", "Emails", "Sending", "Review & launch"];
const tokens = ["{{name}}", "{{company}}", "{{email}}"];
const recentlyVerified = (lead: RecordValue) =>
  lead.verificationStatus === "VALID" &&
  !!lead.verifiedAt &&
  new Date(text(lead.verifiedAt)).getTime() > Date.now() - 30 * 86400000;
const replyAfterConsent = (lead: RecordValue) =>
  !!lead.repliedAt &&
  !(
    lead.consentAt &&
    new Date(text(lead.repliedAt)) <= new Date(text(lead.consentAt))
  );
/** Why a lead can't get this kind of campaign yet, or null when it can. */
function notReady(lead: RecordValue, permission: boolean) {
  if (!lead.email) return "No email";
  if (lead.unsubscribedAt) return "Opted out";
  if (!recentlyVerified(lead)) return "Email not checked";
  if (permission) {
    if (lead.repliedAt) return "Already replied";
    if (lead.eligibility === "CONSENTED") return "Already gave permission";
    if (lead.eligibility === "SUPPRESSED") return "Not eligible";
  } else {
    if (lead.eligibility !== "CONSENTED") return "No permission yet";
    if (replyAfterConsent(lead)) return "Replied, so follow-ups stopped";
  }
  return null;
}

export function CampaignComposer({
  organization,
  accounts,
  leads,
  sending,
  act,
  close,
  endpoint,
  setupPath,
  initialLeadIds = [],
}: {
  organization: Organization;
  accounts: RecordValue[];
  leads: RecordValue[];
  sending: RecordValue;
  act: (resource: string, input: RecordValue) => Promise<RecordValue>;
  close: () => void;
  endpoint?: string;
  setupPath?: string;
  initialLeadIds?: string[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const requestId = useRef(crypto.randomUUID());
  const focused = useRef<{ field: "subject" | "body"; at: number } | null>(null);
  const permissionReady = leads.filter((lead) => !notReady(lead, true)).length;
  const outreachReady = leads.filter((lead) => !notReady(lead, false)).length;
  const [stage, setStage] = useState(0);
  const [purpose, setPurpose] = useState(() => {
    // Leads picked in My leads decide the type; otherwise use whichever has ready leads.
    const readySelected = (askPermission: boolean) =>
      initialLeadIds.filter((id) => {
        const lead = leads.find((item) => text(item.id) === id);
        return lead && !notReady(lead, askPermission);
      }).length;
    if (initialLeadIds.length)
      return readySelected(true) > readySelected(false)
        ? "PERMISSION_REQUEST"
        : "OUTREACH";
    return outreachReady === 0 && permissionReady > 0
      ? "PERMISSION_REQUEST"
      : "OUTREACH";
  });
  const permission = purpose === "PERMISSION_REQUEST";
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [mailboxId, setMailboxId] = useState(
    accounts.length === 1 ? text(accounts[0].id) : "",
  );
  const [extraMailboxIds, setExtraMailboxIds] = useState<string[]>([]);
  const [subject, setSubject] = useState(
    permission ? permissionTemplate.subject : "",
  );
  const [body, setBody] = useState(permission ? permissionTemplate.body : "");
  const [leadIds, setLeadIds] = useState<string[]>(initialLeadIds);
  const [search, setSearch] = useState("");
  const [readyOnly, setReadyOnly] = useState(initialLeadIds.length === 0);
  const [dailyLimit, setDailyLimit] = useState(25);
  const [timing, setTiming] = useState("business");
  const [steps, setSteps] = useState<Step[]>([]);
  const [preview, setPreview] = useState<RecordValue | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const link = (view: string) =>
    setupPath ||
    `/?client=${encodeURIComponent(organization.workspaceId)}&view=${view}`;
  const ready = useMemo(
    () => leads.filter((lead) => !notReady(lead, permission)),
    [leads, permission],
  );
  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    return leads.filter(
      (lead) =>
        (!readyOnly ||
          !notReady(lead, permission) ||
          leadIds.includes(text(lead.id))) &&
        `${text(lead.company, "")} ${text(lead.email, "")} ${text(lead.industry, "")} ${text(lead.location, "")}`
          .toLowerCase()
          .includes(query),
    );
  }, [leads, readyOnly, permission, search, leadIds]);
  const blockedLeads = [
    ...new Set(
      rows(preview?.blockers)
        .map((blocker) => text(blocker.leadId, ""))
        .filter(Boolean),
    ),
  ];
  const liveInbox = accounts.some((account) => account.status === "LIVE_ENABLED");
  function choosePurpose(value: string) {
    if (value === purpose) return;
    setPurpose(value);
    setLeadIds([]);
    setPreview(null);
    if (value === "PERMISSION_REQUEST") {
      setSteps([]);
      if (!subject.trim() && !body.trim()) {
        setSubject(permissionTemplate.subject);
        setBody(permissionTemplate.body);
      }
    } else if (
      subject === permissionTemplate.subject &&
      body === permissionTemplate.body
    ) {
      setSubject("");
      setBody("");
    }
  }
  function insertToken(token: string) {
    const target = focused.current?.field ?? "body";
    const value = target === "subject" ? subject : body;
    const at = Math.min(focused.current?.at ?? value.length, value.length);
    const next = value.slice(0, at) + token + value.slice(at);
    if (target === "subject") setSubject(next);
    else setBody(next);
    focused.current = { field: target, at: at + token.length };
  }
  const payload = {
    name,
    purpose,
    subject,
    body,
    mailboxId: mailboxId || undefined,
    extraMailboxIds: mailboxId
      ? extraMailboxIds.filter((id) => id !== mailboxId)
      : [],
    leadIds,
    dailyLimit,
    steps: permission ? [] : steps,
    target: { industry, location },
    sendStartHour: timing === "now" ? 0 : 9,
    sendEndHour: timing === "now" ? 24 : 17,
    sendWeekdays: timing === "now" ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5],
  };
  /** What still stops the current stage from moving on, or "" when it can. */
  function stageProblem(index: number) {
    if (index === 0 && !leadIds.length) return "Choose at least one lead.";
    if (index === 1) {
      if (!subject.trim() || !body.trim())
        return "Write a subject line and a message.";
      if (steps.some((step) => !step.subject.trim() || !step.body.trim()))
        return "Every follow-up needs a subject and a message.";
    }
    if (index === 2 && name.trim().length < 2)
      return "Give the campaign a name.";
    return "";
  }
  async function goTo(next: number) {
    if (busy) return;
    setError("");
    if (next > stage) {
      for (let index = stage; index < next; index++) {
        const problem = stageProblem(index);
        if (problem) {
          setStage(index);
          setError(problem);
          return;
        }
      }
    }
    if (next < 3) {
      setPreview(null);
      setConfirmed(false);
      setStage(next);
      return;
    }
    // Entering the review stage builds the exact emails on the server.
    setBusy(true);
    try {
      const result = await api(
        endpoint || `/api/platform/${organization.workspaceId}/campaigns`,
        "POST",
        { ...payload, action: "preview" },
      );
      setConfirmed(false);
      setPreview(result);
      setStage(3);
      dialog.current?.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The emails couldn't be prepared.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function launch() {
    if (busy || !preview || !confirmed || rows(preview.blockers).length) return;
    setBusy(true);
    setError("");
    try {
      await act("campaigns", {
        ...payload,
        action: "create-and-send",
        permissionConfirmed: true,
        previewHash: preview.fingerprint,
        requestId: requestId.current,
      });
      close();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The campaign could not launch. Check the campaign list before trying again.",
      );
    } finally {
      setBusy(false);
    }
  }
  function changeStep(index: number, changes: Partial<Step>) {
    setSteps((current) =>
      current.map((step, position) =>
        position === index ? { ...step, ...changes } : step,
      ),
    );
  }
  return (
    <dialog
      ref={dialog}
      className="panel campaign-composer cw"
      aria-labelledby="campaign-compose-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <header className="cw-head">
        <div>
          <p className="cw-client">{organization.name}</p>
          <h2 id="campaign-compose-title">New campaign</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close campaign builder"
          disabled={busy}
          onClick={close}
        >
          <X size={20} />
        </button>
      </header>
      <ol className="cw-stages" aria-label="Campaign steps">
        {stages.map((label, index) => (
          <li
            key={label}
            className={
              index === stage ? "is-current" : index < stage ? "is-done" : ""
            }
          >
            <button
              type="button"
              disabled={busy}
              aria-current={index === stage ? "step" : undefined}
              onClick={() => void goTo(index)}
            >
              <span className="cw-stage-mark">
                {index < stage ? <Check size={13} /> : index + 1}
              </span>
              {label}
            </button>
          </li>
        ))}
      </ol>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      {stage === 0 && (
        <section className="cw-body" aria-label="Choose leads">
          <div className="cw-types" role="radiogroup" aria-label="Campaign type">
            {[
              {
                value: "PERMISSION_REQUEST",
                title: "Ask for permission",
                detail:
                  "One email asking if they'd like to hear from you. Needed before any marketing under POPIA. No follow-ups.",
                count: permissionReady,
              },
              {
                value: "OUTREACH",
                title: "Outreach",
                detail:
                  "Your sales email plus follow-ups, only to leads who already said yes.",
                count: outreachReady,
              },
            ].map((option) => (
              <button
                type="button"
                role="radio"
                aria-checked={purpose === option.value}
                key={option.value}
                className={`cw-type${purpose === option.value ? " is-on" : ""}`}
                onClick={() => choosePurpose(option.value)}
              >
                <b>{option.title}</b>
                <span>{option.detail}</span>
                <small>
                  {option.count.toLocaleString("en-ZA")} lead
                  {option.count === 1 ? "" : "s"} ready
                </small>
              </button>
            ))}
          </div>
          <div className="cw-picker-bar">
            <div className="search-input">
              <Search size={16} />
              <input
                aria-label="Search leads"
                placeholder="Search by business, email, industry or town…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <label className="cw-toggle">
              <input
                type="checkbox"
                checked={readyOnly}
                onChange={(event) => setReadyOnly(event.target.checked)}
              />
              Only show ready leads
            </label>
          </div>
          <div className="cw-picker-summary">
            <b>{leadIds.length.toLocaleString("en-ZA")} selected</b>
            {ready.length > 0 && (
              <button
                type="button"
                className="text-button"
                onClick={() => setLeadIds(ready.map((lead) => text(lead.id)))}
              >
                Select all {ready.length.toLocaleString("en-ZA")} ready
              </button>
            )}
            {leadIds.length > 0 && (
              <button
                type="button"
                className="text-button"
                onClick={() => setLeadIds([])}
              >
                Clear
              </button>
            )}
          </div>
          {leads.length ? (
            <div className="cw-leads" role="list">
              {shown.slice(0, 300).map((lead) => {
                const id = text(lead.id);
                const reason = notReady(lead, permission);
                return (
                  <label key={id} className="cw-lead" role="listitem">
                    <input
                      type="checkbox"
                      checked={leadIds.includes(id)}
                      onChange={(event) =>
                        setLeadIds((current) =>
                          event.target.checked
                            ? [...current, id]
                            : current.filter((item) => item !== id),
                        )
                      }
                    />
                    <span className="cw-lead-main">
                      <b>{text(lead.company)}</b>
                      <small>
                        {text(lead.email, "No email")}
                        {lead.location ? ` · ${text(lead.location)}` : ""}
                      </small>
                    </span>
                    {lead.qualificationScore !== null &&
                      lead.qualificationScore !== undefined && (
                        <span className="cw-score" title="Fit score">
                          {text(lead.qualificationScore)}
                        </span>
                      )}
                    <span className={`cw-ready${reason ? " is-blocked" : ""}`}>
                      {reason ?? "Ready"}
                    </span>
                  </label>
                );
              })}
              {!shown.length && (
                <p className="cw-empty">
                  {readyOnly
                    ? "No ready leads match. Untick “Only show ready leads” to see the rest and why they're not ready."
                    : "No leads match this search."}
                </p>
              )}
              {shown.length > 300 && (
                <p className="cw-empty">
                  Showing 300 of {shown.length.toLocaleString("en-ZA")}. Search to
                  narrow the list, or use “Select all ready”.
                </p>
              )}
            </div>
          ) : (
            <p className="cw-empty">
              This client has no leads yet.{" "}
              <a href={link("discovery")} target="_blank" rel="noopener noreferrer">
                Find leads
              </a>{" "}
              or{" "}
              <a href={link("leads")} target="_blank" rel="noopener noreferrer">
                import a CSV
              </a>{" "}
              first.
            </p>
          )}
          {!ready.length && leads.length > 0 && (
            <p className="cw-hint">
              Leads become ready once their email is checked as valid
              {permission ? "" : " and they've given permission"}. Do that from{" "}
              <a href={link("leads")} target="_blank" rel="noopener noreferrer">
                My leads
              </a>
              .
            </p>
          )}
        </section>
      )}

      {stage === 1 && (
        <section className="cw-body" aria-label="Write the emails">
          {permission && (
            <div className="campaign-setup-notice" role="note">
              <b>One email, no follow-ups</b>
              <ul>
                <li>POPIA allows asking each business only once.</li>
                <li>
                  Monettic adds a short notice explaining the request. A clear
                  YES reply records permission automatically, with the reply
                  kept as proof.
                </li>
                <li>Replace every {"{{…}}"} placeholder before launching.</li>
              </ul>
            </div>
          )}
          <div className="cw-email">
            <span className="cw-email-label">Email 1 · sent first</span>
            <label>
              Subject line
              <input
                required
                maxLength={300}
                value={subject}
                onFocus={(event) =>
                  (focused.current = {
                    field: "subject",
                    at: event.target.selectionStart ?? subject.length,
                  })
                }
                onSelect={(event) =>
                  (focused.current = {
                    field: "subject",
                    at: event.currentTarget.selectionStart ?? subject.length,
                  })
                }
                onChange={(event) => setSubject(event.target.value)}
              />
            </label>
            <label>
              Message
              <textarea
                aria-label="Message"
                required
                maxLength={30000}
                rows={9}
                value={body}
                onFocus={(event) =>
                  (focused.current = {
                    field: "body",
                    at: event.target.selectionStart ?? body.length,
                  })
                }
                onSelect={(event) =>
                  (focused.current = {
                    field: "body",
                    at: event.currentTarget.selectionStart ?? body.length,
                  })
                }
                onChange={(event) => setBody(event.target.value)}
              />
            </label>
            <div className="cw-tokens">
              <span>Insert:</span>
              {tokens.map((token) => (
                <button
                  type="button"
                  key={token}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertToken(token)}
                >
                  {token}
                </button>
              ))}
              <small>Each lead&apos;s own details fill these in.</small>
            </div>
          </div>
          {!permission &&
            steps.map((step, index) => (
              <div className="cw-email" key={index}>
                <div className="cw-email-top">
                  <span className="cw-email-label">
                    Email {index + 2} · follow-up
                  </span>
                  <label className="cw-delay">
                    Send
                    <input
                      type="number"
                      min={1}
                      max={365}
                      required
                      value={step.delayDays}
                      onChange={(event) =>
                        changeStep(index, {
                          delayDays: Number(event.target.value),
                        })
                      }
                    />
                    days after the last email
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove follow-up ${index + 1}`}
                    onClick={() =>
                      setSteps((current) =>
                        current.filter((_, position) => position !== index),
                      )
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <label>
                  Subject line
                  <input
                    required
                    maxLength={300}
                    value={step.subject}
                    onChange={(event) =>
                      changeStep(index, { subject: event.target.value })
                    }
                  />
                </label>
                <label>
                  Message
                  <textarea
                    required
                    maxLength={30000}
                    rows={5}
                    value={step.body}
                    onChange={(event) =>
                      changeStep(index, { body: event.target.value })
                    }
                  />
                </label>
              </div>
            ))}
          {!permission && steps.length < 8 && (
            <button
              type="button"
              className="cw-add"
              onClick={() =>
                setSteps((current) => [
                  ...current,
                  { delayDays: 3, subject: `Re: ${subject}`.slice(0, 300), body: "" },
                ])
              }
            >
              <Plus size={15} /> Add a follow-up
            </button>
          )}
          {!permission && (
            <p className="cw-hint">
              Follow-ups stop by themselves when the lead replies or
              unsubscribes.
            </p>
          )}
        </section>
      )}

      {stage === 2 && (
        <section className="cw-body" aria-label="Sending settings">
          {(!sending.enabled || !sending.profileApproved || !liveInbox) && (
            <div className="campaign-setup-notice" role="status">
              <b>Still to do before anything can send</b>
              <ul>
                {!sending.enabled && (
                  <li>Live sending isn&apos;t switched on for the platform yet.</li>
                )}
                {!sending.profileApproved && (
                  <li>
                    <a href={link("business")} target="_blank" rel="noopener noreferrer">
                      Approve this client&apos;s business profile
                    </a>
                    .
                  </li>
                )}
                {!liveInbox && (
                  <li>
                    <a href={link("mailboxes")} target="_blank" rel="noopener noreferrer">
                      Connect and switch on a sending inbox
                    </a>
                    .
                  </li>
                )}
              </ul>
              <small>
                You can finish and review the campaign now. Nothing sends until
                these are done.
              </small>
            </div>
          )}
          <div className="campaign-compose-grid">
            <label>
              Campaign name
              <input
                required
                minLength={2}
                maxLength={160}
                placeholder={
                  permission
                    ? "e.g. Permission request · Gauteng workshops"
                    : "e.g. Starter motors · workshops"
                }
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Send from
              <select
                value={mailboxId}
                onChange={(event) => setMailboxId(event.target.value)}
              >
                <option value="">
                  {accounts.length
                    ? "Choose a sending inbox"
                    : "No inbox connected yet"}
                </option>
                {accounts.map((account) => (
                  <option key={text(account.id)} value={text(account.id)}>
                    {text(account.email)} ·{" "}
                    {text(account.status).replaceAll("_", " ").toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {mailboxId && accounts.length > 1 && (
            <fieldset className="campaign-rotation">
              <legend>Also send from (spreads the load)</legend>
              {accounts
                .filter((account) => text(account.id) !== mailboxId)
                .map((account) => {
                  const id = text(account.id);
                  return (
                    <label className="campaign-recipient-choice" key={id}>
                      <input
                        type="checkbox"
                        checked={extraMailboxIds.includes(id)}
                        onChange={(event) =>
                          setExtraMailboxIds((current) =>
                            event.target.checked
                              ? [...current, id]
                              : current.filter((item) => item !== id),
                          )
                        }
                      />
                      <span>{text(account.email)}</span>
                    </label>
                  );
                })}
            </fieldset>
          )}
          <div className="campaign-compose-grid">
            <label>
              Emails per day (whole campaign)
              <input
                type="number"
                min={1}
                max={1000}
                required
                value={dailyLimit}
                onChange={(event) => setDailyLimit(Number(event.target.value))}
              />
              <em>Keep it to about 25 a day per inbox.</em>
            </label>
            <label>
              When to send
              <select value={timing} onChange={(event) => setTiming(event.target.value)}>
                <option value="business">Weekdays, 09:00–17:00 (recommended)</option>
                <option value="now">Any time, every day</option>
              </select>
            </label>
            <label>
              Target niche (for your records)
              <input
                value={industry}
                onChange={(event) => setIndustry(event.target.value)}
                placeholder="e.g. forklift workshops"
              />
            </label>
            <label>
              Target area (for your records)
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="e.g. Gauteng"
              />
            </label>
          </div>
          <p className="cw-hint">
            Times follow the client&apos;s timezone. The sending computer must be
            on for emails to go out.
          </p>
        </section>
      )}

      {stage === 3 && preview && (
        <section className="cw-body" aria-label="Review and launch">
          <div className="cw-summary">
            <div>
              <span>Campaign</span>
              <b>{name}</b>
            </div>
            <div>
              <span>Leads</span>
              <b>{rows(preview.recipients).length.toLocaleString("en-ZA")}</b>
            </div>
            <div>
              <span>Emails each</span>
              <b>{permission ? 1 : steps.length + 1}</b>
            </div>
            <div>
              <span>Per day</span>
              <b>{text(preview.dailyLimit)}</b>
            </div>
            <div>
              <span>From</span>
              <b>
                {Array.isArray(preview.senders) && preview.senders.length
                  ? preview.senders.map(String).join(", ")
                  : text(preview.sender, "No inbox yet")}
              </b>
            </div>
            <div>
              <span>Sends</span>
              <b>
                {text(preview.sendStartHour)}:00–{text(preview.sendEndHour)}:00 ·{" "}
                {text(preview.timezone)}
              </b>
            </div>
          </div>
          {rows(preview.blockers).length > 0 && (
            <div className="campaign-setup-notice" role="alert">
              <b>Fix these before it can send</b>
              <ul>
                {rows(preview.blockers).map((blocker, index) => (
                  <li key={index}>
                    {text(blocker.message)}{" "}
                    <a
                      href={link(text(blocker.view))}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Fix it
                    </a>
                  </li>
                ))}
              </ul>
              {blockedLeads.length > 0 && blockedLeads.length < leadIds.length && (
                <button
                  type="button"
                  onClick={() => {
                    setLeadIds((current) =>
                      current.filter((id) => !blockedLeads.includes(id)),
                    );
                    void goTo(0);
                  }}
                >
                  Remove the {blockedLeads.length} blocked leads
                </button>
              )}
            </div>
          )}
          {Array.isArray(preview.warnings) && preview.warnings.length > 0 && (
            <div className="campaign-setup-notice campaign-warnings">
              <b>Worth fixing for better delivery</b>
              <ul>
                {preview.warnings.map((warning, index) => (
                  <li key={index}>{String(warning)}</li>
                ))}
              </ul>
            </div>
          )}
          <h3 className="cw-subhead">The exact emails each lead gets</h3>
          {rows(preview.recipients).map((recipient, index) => (
            <details
              key={text(recipient.leadId)}
              className="campaign-message-review"
              open={index === 0}
            >
              <summary>
                {text(recipient.company)} · {text(recipient.email)}
              </summary>
              <div className="email-preview">
                <b>{text(recipient.subject)}</b>
                <p>{text(recipient.body)}</p>
              </div>
              {rows(recipient.steps).map((step, stepIndex) => (
                <div className="email-preview" key={stepIndex}>
                  <small>
                    Follow-up {stepIndex + 1} · after {text(step.delayDays)} days
                  </small>
                  <b>{text(step.subject)}</b>
                  <p>{text(step.body)}</p>
                </div>
              ))}
            </details>
          ))}
          <p className="cw-hint">
            Every email gets an unsubscribe link. Follow-ups stop when a lead
            replies or unsubscribes.
          </p>
          <label className="campaign-recipient-choice cw-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={rows(preview.blockers).length > 0}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I&apos;ve checked these emails, the sender and that every lead may
              receive them. Send this campaign.
            </span>
          </label>
        </section>
      )}

      <footer className="cw-foot">
        <button
          type="button"
          disabled={busy}
          onClick={() => (stage === 0 ? close() : void goTo(stage - 1))}
        >
          {stage === 0 ? (
            "Cancel"
          ) : (
            <>
              <ArrowLeft size={15} /> Back
            </>
          )}
        </button>
        <span className="cw-foot-note">
          Step {stage + 1} of {stages.length}
        </span>
        {stage < 3 ? (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void goTo(stage + 1)}
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : null}
            {stage === 2 ? "Review emails" : "Next"}
            {!busy && <ArrowRight size={15} />}
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={
              busy ||
              !preview ||
              rows(preview.blockers).length > 0 ||
              !confirmed
            }
            onClick={() => void launch()}
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
            Launch campaign
          </button>
        )}
      </footer>
    </dialog>
  );
}
