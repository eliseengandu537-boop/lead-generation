"use client";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Plus, Send, X } from "lucide-react";
import { api, rows, text, type Organization, type RecordValue } from "./data";

type Step = { delayDays: number; subject: string; body: string };
export function CampaignComposer({
  organization,
  accounts,
  leads,
  sending,
  act,
  close,
  endpoint,
  setupPath,
}: {
  organization: Organization;
  accounts: RecordValue[];
  leads: RecordValue[];
  sending: RecordValue;
  act: (resource: string, input: RecordValue) => Promise<RecordValue>;
  close: () => void;
  endpoint?: string;
  setupPath?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const requestId = useRef(crypto.randomUUID());
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [mailboxId, setMailboxId] = useState(
    accounts.length === 1 ? text(accounts[0].id) : "",
  );
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [leadIds, setLeadIds] = useState<string[]>([]);
  const [dailyLimit, setDailyLimit] = useState(25);
  const [timing, setTiming] = useState("now");
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
  const payload = {
    name,
    subject,
    body,
    mailboxId: mailboxId || undefined,
    leadIds,
    dailyLimit,
    steps,
    target: { industry, location },
    sendStartHour: timing === "now" ? 0 : 9,
    sendEndHour: timing === "now" ? 24 : 17,
    sendWeekdays: timing === "now" ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5],
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!preview) {
        const result = await api(
          endpoint || `/api/platform/${organization.workspaceId}/campaigns`,
          "POST",
          { ...payload, action: "preview" },
        );
        setConfirmed(false);
        setPreview(result);
        dialog.current?.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        if (!confirmed || rows(preview.blockers).length) return;
        await act("campaigns", {
          ...payload,
          action: "create-and-send",
          permissionConfirmed: true,
          previewHash: preview.fingerprint,
          requestId: requestId.current,
        });
        close();
      }
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
      className="panel campaign-composer"
      aria-labelledby="campaign-compose-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <header className="card-heading">
        <div>
          <p className="eyebrow">{organization.name}</p>
          <h2 id="campaign-compose-title">
            {preview ? "Review and send campaign" : "Create and send campaign"}
          </h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close campaign composer"
          disabled={busy}
          onClick={close}
        >
          <X size={20} />
        </button>
      </header>
      <p className="muted">
        Choose real recipients and review the exact messages. Creating and
        sending launches the campaign in one step.
      </p>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={submit}>
        {!preview ? (
          <>
            {(!sending.enabled ||
              !sending.profileApproved ||
              !accounts.some(
                (account) => account.status === "LIVE_ENABLED",
              )) && (
              <div className="campaign-setup-notice" role="status">
                <b>Sending setup to complete</b>
                <ul>
                  {!sending.enabled && (
                    <li>Live sending is not enabled on the platform.</li>
                  )}
                  {!sending.profileApproved && (
                    <li>
                      <a
                        href={link("business")}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Review and approve this client’s profile and targeting
                      </a>
                      .
                    </li>
                  )}
                  {!accounts.some(
                    (account) => account.status === "LIVE_ENABLED",
                  ) && (
                    <li>
                      <a
                        href={link("mailboxes")}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Connect the client’s sending mailbox
                      </a>
                      . For Microsoft 365, your account team must complete the
                      connection setup.
                    </li>
                  )}
                </ul>
                <small>
                  You can compose and preview now. Nothing is sent until the
                  setup is ready and you select Create and send.
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
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                Sending email
                <select
                  value={mailboxId}
                  onChange={(event) => setMailboxId(event.target.value)}
                >
                  <option value="">
                    {accounts.length
                      ? "Choose a sending account"
                      : "No client mailbox connected"}
                  </option>
                  {accounts.map((account) => (
                    <option key={text(account.id)} value={text(account.id)}>
                      {text(account.email)} ·{" "}
                      {text(account.status).replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Target niche
                <input
                  value={industry}
                  onChange={(event) => setIndustry(event.target.value)}
                  placeholder="e.g. automotive repair workshops"
                />
              </label>
              <label>
                Target location
                <input
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="City or province"
                />
              </label>
            </div>
            <label>
              Subject line
              <input
                required
                maxLength={300}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            </label>
            <label>
              Message
              <textarea
                aria-label="Message"
                required
                maxLength={30000}
                rows={7}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </label>
            <small>
              Use {"{{name}}"}, {"{{company}}"} and {"{{email}}"} to personalise
              these messages. These campaign messages are used for sending.
            </small>
            <fieldset className="campaign-recipients">
              <legend>Recipients · {leadIds.length} selected</legend>
              <p className="muted">
                Niche and location describe this campaign. Only the recipients
                selected below receive it.
              </p>
              {leads.length ? (
                <div className="campaign-recipient-list">
                  {leads.map((lead) => (
                    <label
                      key={text(lead.id)}
                      className="campaign-recipient-choice"
                    >
                      <input
                        type="checkbox"
                        checked={leadIds.includes(text(lead.id))}
                        onChange={(event) =>
                          setLeadIds((current) =>
                            event.target.checked
                              ? [...current, text(lead.id)]
                              : current.filter((id) => id !== lead.id),
                          )
                        }
                      />
                      <span>
                        <b>{text(lead.company)}</b>
                        <small>
                          {text(lead.email, "No email recorded")} ·{" "}
                          {text(lead.eligibility).replaceAll("_", " ")}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p>
                  No leads are available yet.{" "}
                  <a
                    href={link("leads")}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Add or import leads
                  </a>{" "}
                  before sending.
                </p>
              )}
            </fieldset>
            <div className="campaign-compose-grid">
              <label>
                Daily sending limit
                <input
                  type="number"
                  min={1}
                  max={1000}
                  required
                  value={dailyLimit}
                  onChange={(event) =>
                    setDailyLimit(Number(event.target.value))
                  }
                />
              </label>
              <label>
                When to start
                <select
                  value={timing}
                  onChange={(event) => setTiming(event.target.value)}
                >
                  <option value="now">
                    As soon as the sending worker processes it
                  </option>
                  <option value="business">Weekdays, 09:00–17:00</option>
                </select>
              </label>
            </div>
            <p className="fine-print">
              Sending uses the workspace timezone and plan limits. Your sending
              computer must be online for queued messages to process.
            </p>
            {steps.map((step, index) => (
              <fieldset key={index} className="campaign-followup">
                <legend>Follow-up {index + 1}</legend>
                <label>
                  Days after the previous email
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
                </label>
                <label>
                  Follow-up subject
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
                  Follow-up message
                  <textarea
                    required
                    maxLength={30000}
                    rows={4}
                    value={step.body}
                    onChange={(event) =>
                      changeStep(index, { body: event.target.value })
                    }
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setSteps((current) =>
                      current.filter((_, position) => position !== index),
                    )
                  }
                >
                  Remove follow-up
                </button>
              </fieldset>
            ))}
            {steps.length < 8 && (
              <button
                type="button"
                onClick={() =>
                  setSteps((current) => [
                    ...current,
                    { delayDays: 3, subject: "", body: "" },
                  ])
                }
              >
                <Plus size={15} /> Add follow-up
              </button>
            )}
          </>
        ) : (
          <>
            <div className="campaign-review-summary">
              <b>{name}</b>
              <p>
                From: {text(preview.sender, "No sending account connected")}
                <br />
                Recipients: {rows(preview.recipients).length} · Daily limit:{" "}
                {text(preview.dailyLimit)}
                <br />
                Sending window: {text(preview.sendStartHour)}:00–
                {text(preview.sendEndHour)}:00 · {text(preview.timezone)}
              </p>
            </div>
            {rows(preview.blockers).length > 0 && (
              <div className="campaign-setup-notice" role="alert">
                <b>Complete these steps before sending</b>
                <ul>
                  {rows(preview.blockers).map((blocker, index) => (
                    <li key={index}>
                      {text(blocker.message)}{" "}
                      <a
                        href={link(text(blocker.view))}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open setup
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
                      Follow-up {stepIndex + 1} · after {text(step.delayDays)}{" "}
                      days
                    </small>
                    <b>{text(step.subject)}</b>
                    <p>{text(step.body)}</p>
                  </div>
                ))}
              </details>
            ))}
            <p className="fine-print">
              A signed unsubscribe link is added to each email. Follow-ups stop
              when a recipient replies or unsubscribes.
            </p>
            <label className="campaign-recipient-choice">
              <input
                type="checkbox"
                required
                checked={confirmed}
                disabled={rows(preview.blockers).length > 0}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                I have reviewed these messages, the sender and the recipients’
                permission. Send this campaign live.
              </span>
            </label>
          </>
        )}
        <footer className="campaign-compose-footer">
          <button
            type="button"
            disabled={busy}
            onClick={() => (preview ? setPreview(null) : close())}
          >
            {preview ? "Back to editing" : "Cancel"}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={
              busy ||
              Boolean(preview && (rows(preview.blockers).length || !confirmed))
            }
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Send size={16} />
            )}
            {preview ? "Create and send" : "Preview emails"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
