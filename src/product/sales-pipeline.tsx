"use client";
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Mail, Phone, RefreshCw, X } from "lucide-react";
import {
  api,
  label,
  number,
  object,
  rows,
  text,
  type RecordValue,
} from "./data";
import { Loading } from "./primitives";
import CallCentre from "./call-centre";
import { Stat, Stats, Tabs, compact, percent } from "./admin-ui";

const stages = [
  { id: "CONTACTED", label: "Contacted", empty: "Leads land here after their first email or call." },
  { id: "INTERESTED", label: "Interested", empty: "Replies and leads qualified on a call land here." },
  { id: "BOOKED", label: "Call booked", empty: "Booked calls show here with their date and time." },
  { id: "WON", label: "Won", empty: "Move a lead here when the client wins the deal." },
  { id: "LOST", label: "Lost", empty: "Leads that said no or opted out." },
];
const zone = "Africa/Johannesburg";

function when(value: unknown) {
  const at = new Date(text(value, ""));
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString("en-ZA", {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function ago(value: unknown) {
  const at = new Date(text(value, ""));
  if (Number.isNaN(at.getTime())) return "";
  const days = Math.floor((Date.now() - at.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return at.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

export default function SalesPipeline({
  businesses,
}: {
  businesses: RecordValue[];
}) {
  const [tab, setTab] = useState("pipeline");
  const [workspace, setWorkspace] = useState("");
  const [data, setData] = useState<RecordValue | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const result = await api(
        `/api/platform/admin/pipeline${workspace ? `?workspaceId=${encodeURIComponent(workspace)}` : ""}`,
        "GET",
        undefined,
        signal,
      );
      if (!signal?.aborted) setData(result);
    },
    [workspace],
  );
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    load(controller.signal).catch((problem) => {
      if (!controller.signal.aborted) setError(problem.message);
    });
    return () => controller.abort();
  }, [load]);
  async function move(card: RecordValue, stage: string) {
    if (!stage) return;
    setBusy(text(card.id));
    setError("");
    setNotice("");
    try {
      const result = await api("/api/platform/admin/pipeline", "POST", {
        action: "move",
        workspaceId: card.workspaceId,
        leadId: card.id,
        stage,
      });
      setNotice(text(result.message));
      await load();
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy("");
    }
  }
  const columns = rows(data?.stages);
  const total = (id: string) =>
    number(columns.find((column) => column.id === id)?.total);
  const bookings = object(data?.bookings);
  const open = total("CONTACTED") + total("INTERESTED") + total("BOOKED");
  const decided = total("WON") + total("LOST");

  function card(item: RecordValue, stageId: string) {
    const booked = item.bookingAt ? new Date(text(item.bookingAt)) : null;
    const overdue = booked && booked.getTime() < Date.now();
    const contact = [item.name, item.email || item.phone]
      .map((value) => text(value, ""))
      .filter(Boolean)
      .join(" · ");
    return (
      <article className="adm-deal" key={text(item.id)}>
        <header>
          <b title={text(item.company)}>{text(item.company)}</b>
        </header>
        <p className="adm-deal-client">{text(item.business)}</p>
        {booked ? (
          <p className={`adm-deal-when${overdue ? " is-overdue" : ""}`}>
            <CalendarClock size={14} />
            {when(item.bookingAt)}
            {overdue && " · needs an outcome"}
          </p>
        ) : item.lastCallAt ? (
          <p className="adm-deal-meta">
            <Phone size={13} />
            {label(item.lastCallOutcome)} · {ago(item.lastCallAt)}
          </p>
        ) : item.repliedAt ? (
          <p className="adm-deal-meta">
            <Mail size={13} />
            Replied {ago(item.repliedAt)}
          </p>
        ) : (
          <p className="adm-deal-meta">Updated {ago(item.updatedAt)}</p>
        )}
        <footer>
          <span className="adm-deal-contact" title={contact}>
            {contact || text(item.location, "No contact details")}
          </span>
          <select
            aria-label={`Move ${text(item.company)} to another stage`}
            value=""
            disabled={busy === text(item.id)}
            onChange={(event) => void move(item, event.target.value)}
          >
            <option value="">Move to…</option>
            {stages
              .filter((stage) => stage.id !== stageId)
              .map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.label}
                </option>
              ))}
          </select>
        </footer>
      </article>
    );
  }

  return (
    <div className="adm-pipeline">
      <Tabs
        label="Sales pipeline sections"
        value={tab}
        onChange={setTab}
        items={[
          { id: "pipeline", label: "Pipeline", count: data ? open : undefined },
          { id: "calls", label: "Calls & bookings" },
          { id: "team", label: "Callers & setup" },
        ]}
      />
      {tab === "pipeline" && (
        <>
          <Stats>
            <Stat
              label="Open opportunities"
              value={data ? open : null}
              hint="Contacted, interested or booked"
            />
            <Stat
              label="Interested"
              value={data ? total("INTERESTED") : null}
              hint="Replied, or qualified on a call"
            />
            <Stat
              label="Calls booked"
              value={data ? total("BOOKED") : null}
              hint={`${compact(bookings.nextSevenDays)} in the next 7 days`}
            />
            <Stat
              label="Won"
              value={data ? total("WON") : null}
              tone={total("WON") > 0 ? "good" : undefined}
              hint={`${percent(total("WON"), decided)} win rate`}
            />
            <Stat
              label="Calls held"
              value={data ? bookings.completed : null}
              hint={`${compact(bookings.noShow)} no-shows`}
            />
          </Stats>
          <div className="adm-toolbar">
            <select
              aria-label="Show the pipeline for one client"
              value={workspace}
              onChange={(event) => setWorkspace(event.target.value)}
            >
              <option value="">All clients</option>
              {businesses.map((business) => (
                <option
                  key={text(business.workspaceId)}
                  value={text(business.workspaceId)}
                >
                  {text(business.name)}
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              aria-label="Refresh pipeline"
              onClick={() =>
                void load().catch((problem) => setError(problem.message))
              }
            >
              <RefreshCw size={16} />
            </button>
            <span className="muted">
              Booking a call moves the lead to Call booked automatically.
            </span>
          </div>
          {error && (
            <div className="alert error" role="alert">
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <span>{notice}</span>
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {!data ? (
            <Loading />
          ) : (
            <>
              <div className="adm-board">
                {stages
                  .filter((stage) => stage.id !== "LOST")
                  .map((stage) => {
                    const column = object(
                      columns.find((item) => item.id === stage.id),
                    );
                    const cards = rows(column.cards);
                    return (
                      <section
                        className={`adm-column stage-${stage.id.toLowerCase()}`}
                        key={stage.id}
                        aria-label={`${stage.label}: ${compact(column.total)} leads`}
                      >
                        <header>
                          <span className="adm-dot" />
                          <h3>{stage.label}</h3>
                          <span className="adm-count">
                            {compact(column.total)}
                          </span>
                        </header>
                        <div className="adm-column-body">
                          {cards.map((item) => card(item, stage.id))}
                          {!cards.length && (
                            <p className="adm-column-empty">{stage.empty}</p>
                          )}
                        </div>
                        {number(column.total) > cards.length && (
                          <footer>
                            Showing {cards.length} of {compact(column.total)}
                          </footer>
                        )}
                      </section>
                    );
                  })}
              </div>
              {total("LOST") > 0 && (
                <details className="adm-lost">
                  <summary>
                    Lost <span className="adm-count">{compact(total("LOST"))}</span>
                  </summary>
                  <div className="adm-lost-grid">
                    {rows(
                      object(columns.find((item) => item.id === "LOST")).cards,
                    ).map((item) => card(item, "LOST"))}
                  </div>
                </details>
              )}
            </>
          )}
        </>
      )}
      {tab === "calls" && <CallCentre view="calls" />}
      {tab === "team" && <CallCentre view="team" />}
    </div>
  );
}
