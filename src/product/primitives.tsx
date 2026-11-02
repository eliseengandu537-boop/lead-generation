"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Inbox, LoaderCircle, Plus, X } from "lucide-react";
import { label, object, rows, text, type RecordValue } from "./data";

export function OrbitMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`orbit-mark ${small ? "small" : ""}`} aria-hidden="true">
      <i />
      <i />
      <b />
    </span>
  );
}
export function Badge({ value }: { value: unknown }) {
  const raw = text(value, "DRAFT");
  return (
    <span
      className={`status status-${raw.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
    >
      {label(raw)}
    </span>
  );
}
export function Empty({
  title,
  detail,
  action,
  icon,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-orbit">
        {icon || <Inbox size={26} strokeWidth={1.5} />}
      </span>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading-state" role="status" aria-label="Loading workspace">
      <div className="skeleton skeleton-title" />
      <div className="skeleton-grid">
        {[0, 1, 2, 3].map((key) => (
          <div className="skeleton skeleton-card" key={key} />
        ))}
      </div>
      <div className="skeleton skeleton-chart" />
      <span className="sr-only">Loading your workspace</span>
    </div>
  );
}
export function SectionHeading({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow?: string;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
        {detail && <p className="section-detail">{detail}</p>}
      </div>
      {action}
    </div>
  );
}
export type Field = {
  name: string;
  label: string;
  type?:
    | "text"
    | "email"
    | "password"
    | "url"
    | "number"
    | "textarea"
    | "select"
    | "checkbox"
    | "datetime-local"
    | "sequence";
  required?: boolean;
  placeholder?: string;
  hint?: string;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  value?: unknown;
};
export type Dialog = {
  title: string;
  detail?: string;
  fields: Field[];
  submitLabel?: string;
  submit: (value: RecordValue) => Promise<unknown>;
  initial?: RecordValue;
};
export function ActionDialog({
  dialog,
  close,
}: {
  dialog: Dialog;
  close: () => void;
}) {
  const [values, setValues] = useState<RecordValue>(() =>
    Object.fromEntries(
      dialog.fields.map((field) => [
        field.name,
        (field.type === "datetime-local" &&
        (dialog.initial?.[field.name] || field.value)
          ? new Date(String(dialog.initial?.[field.name] || field.value))
              .toLocaleString("sv-SE")
              .replace(" ", "T")
              .slice(0, 16)
          : dialog.initial?.[field.name]) ??
          field.value ??
          (field.type === "checkbox"
            ? false
            : field.type === "sequence"
              ? []
              : ""),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = container.current?.querySelector<HTMLElement>(
      "input, textarea, select, button",
    );
    first?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) close();
      if (event.key === "Tab") {
        const focusable = Array.from(
          container.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
          ) || [],
        );
        if (event.shiftKey && document.activeElement === focusable[0]) {
          event.preventDefault();
          focusable.at(-1)?.focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === focusable.at(-1)
        ) {
          event.preventDefault();
          focusable[0]?.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [busy, close]);
  function update(name: string, value: unknown) {
    setValues((current) => ({ ...current, [name]: value }));
  }
  return (
    <div className="dialog-backdrop">
      <div
        className={`dialog ${dialog.fields.some((field) => field.name === "body") ? "email-composer" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={dialog.title}
        ref={container}
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">YOUR WORKSPACE</p>
            <h2>{dialog.title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            disabled={busy}
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        {dialog.detail && <p className="dialog-detail">{dialog.detail}</p>}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              await dialog.submit(values);
              close();
            } catch (problem) {
              setError((problem as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="dialog-fields">
            {dialog.fields.map((field) =>
              field.type === "sequence" ? (
                <div className="sequence-editor" key={field.name}>
                  <h3>{field.label}</h3>
                  {rows(values[field.name]).map((step, index) => (
                    <div className="sequence-block" key={index}>
                      <div className="sequence-heading">
                        <b>Follow-up {index + 1}</b>
                        <button
                          type="button"
                          className="text-button danger"
                          onClick={() =>
                            update(
                              field.name,
                              rows(values[field.name]).filter(
                                (_step, i) => i !== index,
                              ),
                            )
                          }
                        >
                          Remove
                        </button>
                      </div>
                      <label>
                        Days after previous message
                        <input
                          type="number"
                          min={1}
                          max={365}
                          required
                          value={text(step.delayDays, "3")}
                          onChange={(event) =>
                            update(
                              field.name,
                              rows(values[field.name]).map((entry, i) =>
                                i === index
                                  ? {
                                      ...entry,
                                      delayDays: Number(event.target.value),
                                    }
                                  : entry,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Subject
                        <input
                          required
                          maxLength={300}
                          value={text(step.subject, "")}
                          onChange={(event) =>
                            update(
                              field.name,
                              rows(values[field.name]).map((entry, i) =>
                                i === index
                                  ? { ...entry, subject: event.target.value }
                                  : entry,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Message
                        <textarea
                          required
                          rows={4}
                          maxLength={20000}
                          value={text(step.body, "")}
                          onChange={(event) =>
                            update(
                              field.name,
                              rows(values[field.name]).map((entry, i) =>
                                i === index
                                  ? { ...entry, body: event.target.value }
                                  : entry,
                              ),
                            )
                          }
                        />
                      </label>
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={rows(values[field.name]).length >= 10}
                    onClick={() =>
                      update(field.name, [
                        ...rows(values[field.name]),
                        { subject: "", body: "", delayDays: 3 },
                      ])
                    }
                  >
                    <Plus size={15} />
                    Add follow-up
                  </button>
                </div>
              ) : (
                <label
                  className={field.type === "checkbox" ? "checkbox-label" : ""}
                  key={field.name}
                >
                  {field.type === "checkbox" && (
                    <input
                      type="checkbox"
                      checked={!!values[field.name]}
                      required={field.required}
                      onChange={(event) =>
                        update(field.name, event.target.checked)
                      }
                    />
                  )}
                  <span>
                    {field.label}
                    {!field.required && field.type !== "checkbox" && (
                      <small>Optional</small>
                    )}
                  </span>
                  {field.type === "textarea" ? (
                    <textarea
                      rows={5}
                      required={field.required}
                      placeholder={field.placeholder}
                      value={text(values[field.name], "")}
                      onChange={(event) =>
                        update(field.name, event.target.value)
                      }
                    />
                  ) : field.type === "select" ? (
                    <select
                      required={field.required}
                      value={text(values[field.name], "")}
                      onChange={(event) =>
                        update(field.name, event.target.value)
                      }
                    >
                      <option value="">Select an option</option>
                      {field.options?.map((option) => (
                        <option value={option.value} key={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type !== "checkbox" ? (
                    <input
                      type={field.type || "text"}
                      required={field.required}
                      min={field.min}
                      max={field.max}
                      minLength={field.type === "password" ? 16 : undefined}
                      placeholder={field.placeholder}
                      value={text(values[field.name], "")}
                      onChange={(event) =>
                        update(
                          field.name,
                          field.type === "number"
                            ? event.target.value === ""
                              ? ""
                              : Number(event.target.value)
                            : event.target.value,
                        )
                      }
                    />
                  ) : null}
                  {field.hint && <em>{field.hint}</em>}
                </label>
              ),
            )}
          </div>
          {dialog.fields.some((field) => field.name === "body") && (
            <div className="composer-preview">
              <div className="email-header">
                <span className="eyebrow">LIVE MESSAGE PREVIEW</span>
                <span className="subtle">Draft · review required</span>
              </div>
              <div className="composer-subject">
                <span>Subject</span>
                <b>{text(values.subject, "Your subject line")}</b>
              </div>
              <div className="mail-body">
                {text(
                  values.body,
                  "Your message will appear here as you write.",
                )}
              </div>
              <p className="fine-print">
                {/[{][{]/.test(
                  `${text(values.subject, "")} ${text(values.body, "")}`,
                )
                  ? "Personalization is resolved for each recipient when you approve the campaign."
                  : "Preview only. Delivery requires an approved campaign or reply."}
              </p>
            </div>
          )}
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={close}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={16} /> : null}
              {busy ? "Working…" : dialog.submitLabel || "Save changes"}
              <ArrowRight size={16} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function KeyValues({ values }: { values: RecordValue }) {
  return (
    <dl className="key-values">
      {Object.entries(values).map(([key, value]) => (
        <div key={key}>
          <dt>{label(key.replace(/([a-z])([A-Z])/g, "$1 $2"))}</dt>
          <dd>
            {Array.isArray(value) ? (
              value
                .map((entry) =>
                  typeof entry === "object"
                    ? text(object(entry).name ?? object(entry).label, "")
                    : text(entry, ""),
                )
                .filter(Boolean)
                .join(", ") || "—"
            ) : typeof value === "object" && value !== null ? (
              <KeyValues values={object(value)} />
            ) : (
              text(value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function DetailPanel({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") close();
      if (event.key === "Tab") {
        const elements = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]',
          ) || [],
        );
        if (event.shiftKey && document.activeElement === elements[0]) {
          event.preventDefault();
          elements.at(-1)?.focus();
        }
        if (!event.shiftKey && document.activeElement === elements.at(-1)) {
          event.preventDefault();
          elements[0]?.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      prior?.focus();
    };
  }, [close]);
  return (
    <>
      <button
        className="detail-backdrop"
        aria-label="Close lead details"
        onClick={close}
      />
      <aside
        ref={panel}
        className="surface lead-detail detail-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {children}
      </aside>
    </>
  );
}
