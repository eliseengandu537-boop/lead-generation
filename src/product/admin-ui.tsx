"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Ellipsis } from "lucide-react";
import { MetricNumber } from "./charts";
import { number } from "./data";

/** A "…" button whose menu floats above everything, so table scrolling never clips it. */
export function RowMenu({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  function place() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 200,
      height = menu.current?.offsetHeight || 250;
    setPosition({
      top:
        rect.bottom + 6 + height > window.innerHeight
          ? Math.max(8, rect.top - 6 - height)
          : rect.bottom + 6,
      left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width)),
    });
  }
  useEffect(() => {
    if (!open) return;
    place();
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event.type === "mousedown" &&
        (menu.current?.contains(event.target as Node) ||
          trigger.current?.contains(event.target as Node))
      )
        return;
      setOpen(false);
    };
    // The menu follows its button when the page or a table scrolls.
    const follow = () => place();
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open]);
  function toggle() {
    place();
    setOpen((value) => !value);
  }
  return (
    <div className="adm-menu">
      <button
        ref={trigger}
        className="adm-menu-trigger"
        aria-label={`More actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <Ellipsis size={17} />
      </button>
      {/* Rendered on <body>: the page's entry animation would otherwise offset fixed positioning. */}
      {open &&
        createPortal(
          <div
            ref={menu}
            className="adm-menu-list"
            role="menu"
            style={{ top: position.top, left: position.left }}
            onClick={() => setOpen(false)}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}

export const compact = (value: unknown) =>
  number(value).toLocaleString("en-ZA");

/** "12%" (or "1.4%" under 10%), or "—" when there is nothing to divide by. */
export function percent(part: unknown, whole: unknown) {
  const top = number(part),
    bottom = number(whole);
  if (bottom <= 0) return "—";
  const share = (top / bottom) * 100;
  return `${share < 10 ? share.toFixed(1) : Math.round(share)}%`;
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className="adm-stats">{children}</div>;
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: unknown;
  hint?: ReactNode;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <article className={`adm-stat${tone ? ` is-${tone}` : ""}`}>
      <span className="adm-stat-label">{label}</span>
      <strong className="adm-stat-value">
        {typeof value === "string" ? value : <MetricNumber value={value} />}
      </strong>
      {hint && <small className="adm-stat-hint">{hint}</small>}
    </article>
  );
}

export function Tabs({
  value,
  onChange,
  items,
  label,
}: {
  value: string;
  onChange: (id: string) => void;
  items: { id: string; label: string; count?: number }[];
  label: string;
}) {
  return (
    <div className="admin-tabs" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={value === item.id}
          className={value === item.id ? "is-active" : ""}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.count !== undefined && (
            <span className="adm-tab-count">{compact(item.count)}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Panel({
  title,
  detail,
  action,
  children,
  className = "",
  id,
}: {
  title?: string;
  detail?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`adm-panel ${className}`} id={id}>
      {(title || action) && (
        <header className="adm-panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {detail && <p>{detail}</p>}
          </div>
          {action && <div className="adm-panel-actions">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Progress({ value, max }: { value: unknown; max: unknown }) {
  const top = number(value),
    bottom = number(max);
  const width = bottom > 0 ? Math.min(100, (top / bottom) * 100) : 0;
  return (
    <span
      className="adm-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={bottom}
      aria-valuenow={top}
    >
      <i style={{ width: `${width}%` }} />
    </span>
  );
}

/** Horizontal bars, each scaled to the largest value, with the step-to-step rate.
 * A step's `rate` replaces the computed rate; `null` hides it (for example when
 * the two steps count different things, such as leads and emails). */
export function Funnel({
  steps,
  showRates = true,
}: {
  steps: { label: string; value: unknown; rate?: string | null }[];
  showRates?: boolean;
}) {
  const top = Math.max(1, ...steps.map((step) => number(step.value)));
  return (
    <ol className="adm-funnel">
      {steps.map((step, index) => {
        const value = number(step.value);
        return (
          <li key={step.label}>
            <div className="adm-funnel-label">
              <span>{step.label}</span>
              <b>{compact(value)}</b>
            </div>
            <span className="adm-funnel-track">
              <i style={{ width: `${Math.max(value ? 2 : 0, (value / top) * 100)}%` }} />
            </span>
            {showRates && index > 0 && step.rate !== null && (
              <small>
                {step.rate ??
                  `${percent(value, steps[index - 1].value)} of ${steps[index - 1].label.toLowerCase()}`}
              </small>
            )}
          </li>
        );
      })}
    </ol>
  );
}
