"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import type { Device, Call } from "@twilio/voice-sdk";
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock3,
  LayoutDashboard,
  LogOut,
  Menu,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Plus,
  Radar,
  RefreshCw,
  X,
} from "lucide-react";
import {
  api,
  date,
  label,
  number,
  object,
  rows,
  text,
  type RecordValue,
} from "./data";
import {
  ActionDialog,
  Badge,
  ConcreteMark,
  Empty,
  Loading,
  SectionHeading,
  type Dialog,
} from "./primitives";
import { ThemeToggle } from "./theme";
import { CallerMeeting } from "./caller-meeting";
import {
  areaSuggestions,
  businessSuggestions,
  matchesProspectingScope,
} from "@/platform/calling/prospect-search";

const tabs = [
  ["overview", "My day", LayoutDashboard],
  ["leads", "Find leads", Radar],
  ["calls", "My calls", Phone],
  ["bookings", "My meetings", CalendarDays],
] as const;
const terminal = [
  "COMPLETED",
  "BUSY",
  "NO_ANSWER",
  "FAILED",
  "CANCELED",
  "EXPIRED",
];
const allowedPhone = (lead: RecordValue) =>
  Boolean(lead.phone) &&
  !lead.doNotCall &&
  !lead.unsubscribedAt &&
  !["ARCHIVED", "UNSUBSCRIBED"].includes(text(lead.status));
const readyLead = (lead: RecordValue) =>
  allowedPhone(lead) &&
  ["NO_WEBSITE_LISTED", "WEBSITE_LISTED"].includes(
    text(lead.websitePresence),
  ) &&
  lead.salesQualification === "UNREVIEWED";
const timestamp = (value: unknown) =>
  value ? new Date(String(value)).getTime() : 0;
const sastDate = (value: unknown) =>
  new Date(String(value)).toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

export default function CallerDashboard() {
  const [session, setSession] = useState<RecordValue>({}),
    [workspace, setWorkspace] = useState("");
  const [data, setData] = useState<RecordValue>({}),
    [tab, setTab] = useState("overview");
  const [mobile, setMobile] = useState(false),
    [busy, setBusy] = useState(false),
    [searching, setSearching] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("READY"),
    [query, setQuery] = useState(""),
    [industry, setIndustry] = useState(""),
    [city, setCity] = useState("South Africa");
  const [dialog, setDialog] = useState<Dialog | null>(null),
    [meeting, setMeeting] = useState<{
      lead: RecordValue;
      callId?: string;
    } | null>(null);
  const [active, setActive] = useState<RecordValue | null>(null),
    [callState, setCallState] = useState("");
  const [notes, setNotes] = useState(""),
    [muted, setMuted] = useState(false);
  const device = useRef<Device | null>(null),
    connection = useRef<Call | null>(null),
    currentWorkspace = useRef("");
  const autoRequested = useRef(new Set<string>());
  const refresh = useCallback(async () => {
    if (!workspace) return;
    const result = await api(`/api/platform/${workspace}/caller`);
    if (currentWorkspace.current === workspace) setData(result);
  }, [workspace]);
  useEffect(() => {
    const controller = new AbortController();
    void api(
      "/api/platform/caller/session",
      "GET",
      undefined,
      controller.signal,
    )
      .then((result) => {
        setSession(result);
        setWorkspace(text(rows(result.businesses)[0]?.workspaceId, ""));
      })
      .catch((problem) => {
        if (!controller.signal.aborted) setError(problem.message);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    currentWorkspace.current = workspace;
    setData({});
    setError("");
    setActive(null);
    setNotes("");
    void refresh().catch((problem) => setError(problem.message));
  }, [workspace, refresh]);
  useEffect(() => {
    if (!workspace) return;
    const interval = setInterval(
      () => {
        if (document.visibilityState === "visible")
          void refresh().catch((problem) => setError(problem.message));
      },
      active ||
        rows(object(data.prospecting).searches).some((run) =>
          ["QUEUED", "RUNNING"].includes(text(run.status)),
        )
        ? 5000
        : 30000,
    );
    return () => clearInterval(interval);
  }, [workspace, active, data.prospecting, refresh]);
  useEffect(() => {
    if (
      !data.business ||
      !object(data.prospecting).enabled ||
      number(object(data.totals).ready) >= 5 ||
      autoRequested.current.has(workspace)
    )
      return;
    autoRequested.current.add(workspace);
    void api(`/api/platform/${workspace}/caller/prospects`, "POST", {
      industry: "ALL",
      city: "South Africa",
      requestId: crypto.randomUUID(),
    })
      .then(() => refresh())
      .catch((problem) => setError(problem.message));
  }, [data, workspace, refresh]);
  useEffect(
    () => () => {
      connection.current?.disconnect();
      device.current?.destroy();
    },
    [],
  );
  useEffect(() => {
    if (
      !active ||
      active.mode !== "BROWSER" ||
      ["Disconnected", "Failed"].includes(callState)
    )
      return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active, callState]);
  const user = object(session.user),
    totals = object(data.totals),
    prospecting = object(data.prospecting);
  const leads = rows(data.leads),
    calls = rows(data.calls),
    bookings = rows(data.bookings);
  const activeRecord = calls.find((call) => call.id === active?.callId),
    activeLead = leads.find((lead) => lead.id === activeRecord?.leadId);
  const ready = useMemo(
    () =>
      rows(data.leads).filter(
        (lead) =>
          readyLead(lead) &&
          matchesProspectingScope(lead, object(data.prospecting)),
      ),
    [data.leads, data.prospecting],
  );
  const readyIds = new Set(ready.map((lead) => lead.id));
  const callbacks = leads.filter(
    (lead) => allowedPhone(lead) && lead.salesQualification === "CALLBACK",
  );
  const next = [
    ...callbacks
      .filter((lead) => timestamp(lead.callbackAt) <= Date.now())
      .sort((a, b) => timestamp(a.callbackAt) - timestamp(b.callbackAt)),
    ...ready,
  ][0];
  const shown = leads
    .filter(
      (lead) =>
        filter === "ALL" ||
        (filter === "CALLBACK"
          ? lead.salesQualification === "CALLBACK"
          : readyIds.has(lead.id)),
    )
    .filter((lead) =>
      [lead.company, lead.name, lead.phone, lead.location]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .filter((lead) =>
      matchesProspectingScope(lead, {
        categories: [industry],
        cities: [city],
        requireMissingWebsite: false,
      }),
    );
  const searches = rows(prospecting.searches),
    running = searches.find((run) =>
      ["QUEUED", "RUNNING"].includes(text(run.status)),
    );
  async function act(input: RecordValue) {
    const result = await api(`/api/platform/${workspace}/caller`, "POST", {
      ...input,
      requestId: input.requestId || crypto.randomUUID(),
    });
    setNotice(text(result.message, "Saved."));
    await refresh();
    return result;
  }
  async function findMore() {
    if (searching) return;
    setSearching(true);
    setError("");
    try {
      const result = await api(
        `/api/platform/${workspace}/caller/prospects`,
        "POST",
        { industry, city, requestId: crypto.randomUUID() },
      );
      setNotice(text(result.message));
      await refresh();
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setSearching(false);
    }
  }
  function addLead(lead?: RecordValue) {
    const requestId = crypto.randomUUID();
    setDialog({
      title: lead ? "Edit prospect" : "Add a prospect",
      initial: lead,
      fields: [
        { name: "company", label: "Business name", required: true },
        { name: "name", label: "Contact person" },
        {
          name: "phone",
          label: "Business phone",
          required: true,
          placeholder: "+27 82 123 4567",
        },
        { name: "location", label: "City / area" },
        {
          name: "industry",
          label: "Business type",
          placeholder: "For example, plumber, dentist or restaurant",
        },
        { name: "notes", label: "Notes", type: "textarea" },
      ],
      submit: (fields) =>
        act({
          ...fields,
          action: lead ? "edit-lead" : "add-lead",
          ...(lead ? { id: lead.id } : {}),
          requestId,
        }),
    });
  }
  async function dial(lead: RecordValue) {
    if (active || busy) return;
    setBusy(true);
    setError("");
    setNotes("");
    let prepared: RecordValue | null = null;
    try {
      const mode = object(data.voice).ready ? "BROWSER" : "PHONE";
      prepared = await act({ action: "prepare-call", leadId: lead.id, mode });
      setActive(prepared);
      if (mode === "PHONE") {
        setTab("calls");
        return;
      }
      setCallState("Connecting microphone…");
      const { Device } = await import("@twilio/voice-sdk");
      device.current?.destroy();
      const nextDevice = new Device(text(prepared.token), {
        closeProtection: true,
      });
      device.current = nextDevice;
      nextDevice.on("error", (problem) => {
        setError(problem.message || "Calling connection failed.");
        setCallState("Failed");
      });
      const call = await nextDevice.connect({
        params: {
          CallRecordId: text(prepared.callId),
          CallNonce: text(prepared.nonce),
        },
      });
      connection.current = call;
      call.on("ringing", () => setCallState("Ringing"));
      call.on("accept", () => setCallState("Browser audio ready"));
      call.on("disconnect", () => {
        setCallState("Disconnected");
        connection.current = null;
        void refresh();
      });
      call.on("error", (problem) => {
        setError(problem.message || "Call failed.");
        setCallState("Failed");
        void refresh();
      });
      setCallState("Dialling");
      setTab("calls");
    } catch (problem) {
      setError((problem as Error).message);
      setCallState("Failed");
      device.current?.destroy();
      device.current = null;
      if (prepared?.callId)
        await act({ action: "abandon-call", id: prepared.callId }).catch(
          () => undefined,
        );
      setActive(null);
    } finally {
      setBusy(false);
    }
  }
  function closeCall() {
    connection.current?.disconnect();
    device.current?.destroy();
    connection.current = null;
    device.current = null;
    setActive(null);
    setNotes("");
    setMuted(false);
  }
  async function saveOutcome(
    call: RecordValue,
    lead: RecordValue | undefined,
    outcome: string,
    memo = notes,
    callbackAt?: string,
  ) {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await act({
        action: "call-outcome",
        id: call.id,
        outcome,
        notes: memo,
        ...(callbackAt ? { callbackAt } : {}),
      });
      closeCall();
      if (outcome === "QUALIFIED" && lead)
        setMeeting({ lead, callId: text(call.id) });
      else
        setNotice(
          outcome === "NO_ANSWER"
            ? "No answer recorded. A follow-up reminder is set for tomorrow."
            : "Outcome saved. Your next prospect is ready.",
        );
      return true;
    } catch (problem) {
      setError((problem as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function callback(call: RecordValue, lead: RecordValue | undefined) {
    setDialog({
      title: "Schedule a callback",
      detail:
        "Choose the time agreed with the prospect. It will appear in your callback list.",
      fields: [
        {
          name: "callbackAt",
          label: "Callback time (your local time)",
          type: "datetime-local",
          required: true,
        },
        {
          name: "notes",
          label: "Callback notes",
          type: "textarea",
          value: notes,
        },
      ],
      submit: async (fields) => {
        const saved = await saveOutcome(
          call,
          lead,
          "CALLBACK",
          text(fields.notes, "Callback requested by prospect."),
          new Date(String(fields.callbackAt)).toISOString(),
        );
        if (!saved)
          throw new Error(
            "The callback could not be saved. Check the time and try again.",
          );
      },
    });
  }
  function updateBooking(booking: RecordValue) {
    setDialog({
      title: "Update meeting",
      initial: booking,
      fields: [
        {
          name: "status",
          label: "Meeting status",
          type: "select",
          required: true,
          options: ["SCHEDULED", "COMPLETED", "CANCELED", "NO_SHOW"].map(
            (value) => ({ value, label: label(value) }),
          ),
        },
      ],
      submit: (fields) =>
        act({
          action: "update-booking",
          id: booking.id,
          version: booking.version,
          status: fields.status,
        }),
    });
  }
  const callAction = (lead: RecordValue, prominent = false) => (
    <button
      className={prominent ? "primary" : ""}
      disabled={busy || !!active || !allowedPhone(lead)}
      onClick={() => void dial(lead)}
    >
      <Phone size={16} />
      Call {prominent ? "this business" : "now"}
    </button>
  );
  const leadCard = (lead: RecordValue) => (
    <article className="surface caller-prospect-card" key={text(lead.id)}>
      <div className="caller-prospect-heading">
        <span className="caller-business-icon">
          {text(lead.company).slice(0, 1)}
        </span>
        <div>
          <p className="eyebrow">{text(lead.industry, "Local business")}</p>
          <h3>{text(lead.company)}</h3>
          <p>{text(lead.location, "South Africa")}</p>
        </div>
        <Badge
          value={
            lead.websitePresence === "NO_WEBSITE_LISTED"
              ? "NO_WEBSITE_LISTED"
              : lead.websitePresence === "WEBSITE_LISTED"
                ? "WEBSITE_LISTED"
                : lead.salesQualification
          }
        />
      </div>
      <div className="caller-prospect-contact">
        <Phone size={16} />
        <b>{text(lead.phone, "Add a phone number")}</b>
        {!!lead.name && <span>{text(lead.name)}</span>}
      </div>
      {lead.salesQualification === "CALLBACK" && (
        <p className="caller-followup">
          <Clock3 size={15} />
          Callback: {sastDate(lead.callbackAt)} SAST
        </p>
      )}
      <div className="caller-actions">
        {callAction(lead, true)}
        <button onClick={() => setMeeting({ lead })}>
          <CalendarDays size={16} />
          Book meeting
        </button>
        <button onClick={() => addLead(lead)}>Edit details</button>
      </div>
      <details className="caller-research-details">
        <summary>Research notes & call prompts</summary>
        <p>
          {text(
            lead.notes,
            "Introduce yourself, ask who handles the business’s online enquiries, and check whether a website consultation would be useful.",
          )}
        </p>
        <ul>
          <li>Do you already have a business website?</li>
          <li>How do customers book or enquire at the moment?</li>
          <li>Would a short website consultation with Concrete help?</li>
        </ul>
        {["NO_WEBSITE_LISTED", "WEBSITE_LISTED"].includes(
          text(lead.websitePresence),
        ) && (
          <small>
            Source: Overture Maps places ·{" "}
            {text(object(lead.websiteEvidence).release)}.{" "}
            {lead.websitePresence === "NO_WEBSITE_LISTED"
              ? "No website was listed; confirm with the owner."
              : "A website is listed in the source."}{" "}
            Contact details and buying interest need confirmation on the call.
          </small>
        )}
      </details>
    </article>
  );
  return (
    <div className="caller-app">
      <aside className={`caller-sidebar ${mobile ? "is-open" : ""}`}>
        <a className="caller-brand" href="/caller">
          <ConcreteMark small />
          CONCRETE.
        </a>
        <p className="eyebrow">CALLING WORKSPACE</p>
        <nav aria-label="Caller navigation">
          {tabs.map(([id, title, Icon]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              aria-label={title}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => {
                setTab(id);
                setMobile(false);
              }}
            >
              <Icon size={18} />
              {title}
              {id === "leads" && ready.length > 0 && (
                <span className="caller-nav-count">{ready.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="caller-sidebar-bottom">
          <p>{text(user.name, "Concrete caller")}</p>
          <small>{text(user.email, "")}</small>
          {Boolean(user.agencyAdmin) && (
            <a href="/admin">Back to administration</a>
          )}
          <button onClick={() => void signOut({ callbackUrl: "/login" })}>
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>
      {mobile && (
        <button
          className="caller-shade"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="caller-main">
        <header className="caller-topbar">
          <button
            className="caller-menu icon-button"
            aria-label="Open navigation"
            onClick={() => setMobile(!mobile)}
          >
            {mobile ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div>
            <b>
              Concrete <span className="muted">/ Sales desk</span>
            </b>
            <small className="caller-topbar-caption">
              Prospects, conversations and meetings.
            </small>
          </div>
          {Boolean(user.agencyAdmin) && (
            <select
              aria-label="Preview calling queue"
              value={workspace}
              disabled={!!active || busy}
              onChange={(event) => setWorkspace(event.target.value)}
            >
              {rows(session.businesses).map((business) => (
                <option
                  key={text(business.workspaceId)}
                  value={text(business.workspaceId)}
                >
                  {text(business.name)}
                </option>
              ))}
            </select>
          )}
          <div className="caller-actions">
            <ThemeToggle compact />
            <button
              className="icon-button"
              aria-label="Refresh dashboard"
              onClick={() =>
                void refresh().catch((problem) => setError(problem.message))
              }
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
        <main id="main-content" className="caller-content">
          <SectionHeading
            eyebrow="CONCRETE SALES"
            title={
              tab === "overview"
                ? `Your next meeting starts here.`
                : tabs.find(([id]) => id === tab)?.[1] || "My day"
            }
            detail={
              tab === "overview"
                ? `Welcome, ${text(user.name, "there")}. Find a business, have a conversation and book an agreed meeting.`
                : "Your calling work, in one place."
            }
          />
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert" role="status">
              {notice}
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {active && (
            <section
              className="surface caller-live-call"
              aria-label="Current call"
            >
              <div className="caller-live-heading">
                <span className="caller-business-icon">
                  <Phone size={23} />
                </span>
                <div>
                  <p className="eyebrow">YOUR CONVERSATION</p>
                  <h3>{text(activeLead?.company, "Current prospect")}</h3>
                  <p>
                    {text(active.toNumber)} ·{" "}
                    {active.mode === "PHONE"
                      ? "Phone dialler handoff"
                      : `${callState} · ${label(activeRecord?.status || "PREPARED")}`}
                  </p>
                </div>
              </div>
              <div className="caller-actions">
                {active.mode === "PHONE" ? (
                  <a
                    className="button primary"
                    href={`tel:${text(active.toNumber)}`}
                  >
                    <Phone size={16} />
                    Open phone dialler
                  </a>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        const value = !muted;
                        connection.current?.mute(value);
                        setMuted(value);
                      }}
                    >
                      {muted ? <MicOff size={16} /> : <Mic size={16} />}
                      {muted ? "Unmute" : "Mute"}
                    </button>
                    <button onClick={() => connection.current?.disconnect()}>
                      <PhoneOff size={16} />
                      Hang up
                    </button>
                  </>
                )}
                {(active.mode === "PHONE" ||
                  ["Disconnected", "Failed"].includes(callState)) && (
                  <button
                    onClick={async () => {
                      if (active.mode === "BROWSER")
                        await act({
                          action: "abandon-call",
                          id: active.callId,
                        }).catch(() => undefined);
                      closeCall();
                    }}
                  >
                    Close call panel
                  </button>
                )}
              </div>
              <p className="muted">
                {active.mode === "PHONE"
                  ? "Use your linked phone to speak to the prospect, then record the actual outcome below. Phone activity is caller-reported."
                  : "Wait for the provider’s final status before saving your conversation outcome."}
              </p>
              <label className="caller-call-notes">
                Conversation notes
                <textarea
                  aria-label="Conversation notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  maxLength={5000}
                  placeholder="Their needs, current website, decision maker and interest in a meeting…"
                />
              </label>
              <div className="caller-outcomes">
                {activeRecord &&
                  (active.mode === "PHONE" ||
                    terminal.includes(text(activeRecord.status))) && (
                    <>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          void saveOutcome(
                            activeRecord,
                            activeLead,
                            "QUALIFIED",
                          )
                        }
                      >
                        <CalendarDays size={17} />
                        Interested — book a meeting
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => callback(activeRecord, activeLead)}
                      >
                        <Clock3 size={16} />
                        Call later
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void saveOutcome(
                            activeRecord,
                            activeLead,
                            "NOT_QUALIFIED",
                          )
                        }
                      >
                        Not interested
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void saveOutcome(
                            activeRecord,
                            activeLead,
                            "NO_ANSWER",
                          )
                        }
                      >
                        No answer
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void saveOutcome(
                            activeRecord,
                            activeLead,
                            "DO_NOT_CALL",
                          )
                        }
                      >
                        Do not call
                      </button>
                    </>
                  )}
              </div>
            </section>
          )}
          {!workspace ? (
            Object.keys(session).length ? (
              <Empty
                title="Your calling queue is being assigned"
                detail="Your administrator will assign the prospect queue. You’ll then see leads, calls and meetings here."
              />
            ) : (
              !error && <Loading />
            )
          ) : !data.business ? (
            !error && <Loading />
          ) : (
            <>
              {tab === "overview" && (
                <>
                  <div className="caller-metrics">
                    {[
                      ["Ready to call", totals.ready],
                      ["Call outcomes logged", totals.callsLogged],
                      ["Qualified prospects", totals.qualified],
                      ["Meetings booked", totals.bookings],
                    ].map(([title, amount]) => (
                      <div className="surface" key={String(title)}>
                        <span>{String(title)}</span>
                        <strong>{number(amount).toLocaleString()}</strong>
                      </div>
                    ))}
                  </div>
                  <section
                    className="surface caller-daily-targets"
                    aria-label="Daily sales targets"
                  >
                    <div>
                      <h3>Today’s sales targets</h3>
                      <p>
                        South African time · Work towards your goals using
                        actual saved activity.
                      </p>
                    </div>
                    <div className="caller-target-grid">
                      {[
                        [
                          "New prospects collected",
                          number(object(prospecting.today).newLeads),
                          number(prospecting.dailyLimit) || 30,
                        ],
                        [
                          "Call outcomes logged",
                          number(object(prospecting.today).callsLogged),
                          number(prospecting.dailyCallTarget) || 100,
                        ],
                      ].map(([name, count, target]) => (
                        <div key={String(name)}>
                          <span>{String(name)}</span>
                          <strong>
                            {Number(count)} <small>/ {Number(target)}</small>
                          </strong>
                          <progress
                            aria-label={`${name} daily progress`}
                            value={Math.min(Number(count), Number(target))}
                            max={Number(target)}
                          />
                        </div>
                      ))}
                    </div>
                    <small>
                      Phone outcomes are caller-reported. A listed number does
                      not establish buying interest or a qualified lead.
                    </small>
                  </section>
                  <div className="caller-journey">
                    <span>
                      <b>1</b>Find ready leads
                    </span>
                    <ChevronRight size={15} />
                    <span>
                      <b>2</b>Call & qualify
                    </span>
                    <ChevronRight size={15} />
                    <span>
                      <b>3</b>Book a meeting
                    </span>
                  </div>
                  <SectionHeading
                    title="Your next prospect"
                    action={
                      <button onClick={() => setTab("leads")}>
                        View calling queue <ArrowRight size={16} />
                      </button>
                    }
                  />
                  {next ? (
                    leadCard(next)
                  ) : (
                    <section className="surface">
                      <Empty
                        title={
                          running
                            ? "Preparing your next conversations"
                            : "Let’s find your next conversation"
                        }
                        detail={
                          running
                            ? "Public business research is in progress. Ready leads appear automatically when it finishes."
                            : `Find businesses across South Africa with public phone numbers${prospecting.requireMissingWebsite === false ? ", with or without websites" : " and no website listed"}.`
                        }
                        action={
                          <div className="caller-actions">
                            <button
                              className="primary"
                              disabled={
                                searching || !!running || !prospecting.enabled
                              }
                              onClick={() => void findMore()}
                            >
                              <Radar size={16} />
                              {searching || running
                                ? "Finding prospects…"
                                : "Prepare my leads"}
                            </button>
                            <button onClick={() => addLead()}>
                              <Plus size={15} />
                              Add a prospect
                            </button>
                          </div>
                        }
                      />
                    </section>
                  )}
                  <section className="surface caller-how-it-works">
                    <h3>What happens after a good call?</h3>
                    <p>
                      Select <b>Interested — book a meeting</b>. Choose a time
                      the prospect agreed to, add the contact’s name, and save.
                      Concrete reserves the slot and notifies your administrator
                      automatically.
                    </p>
                    <p className="muted">
                      No website listed means it is missing from the research
                      source. Ask the business whether it already has one before
                      you pitch.
                    </p>
                  </section>
                  {callbacks.length > 0 && (
                    <section className="surface">
                      <SectionHeading
                        title="Your callbacks"
                        action={
                          <button
                            onClick={() => {
                              setFilter("CALLBACK");
                              setTab("leads");
                            }}
                          >
                            View callbacks
                          </button>
                        }
                      />
                      {callbacks.slice(0, 4).map((lead) => (
                        <div className="caller-booking" key={text(lead.id)}>
                          <div>
                            <b>{text(lead.company)}</b>
                            <p>{sastDate(lead.callbackAt)} SAST</p>
                          </div>
                          {callAction(lead)}
                        </div>
                      ))}
                    </section>
                  )}
                </>
              )}
              {tab === "leads" && (
                <>
                  <section className="surface">
                    <SectionHeading
                      title="Find your next website opportunity"
                      detail={`Type a business category and a South African town, suburb or province. Leave the type blank to use your sales niches; South Africa searches nationwide. ${prospecting.requireMissingWebsite === false ? "Businesses with and without websites are included." : "Listings need a phone number and no website listed."}`}
                    />
                    <form
                      className="caller-research-toolbar"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!running && prospecting.enabled) void findMore();
                      }}
                    >
                      <label>
                        Business type
                        <span className="caller-suggested-input">
                          <input
                            aria-label="Business type filter"
                            list="caller-business-suggestions"
                            placeholder="Type any business, e.g. plumbers"
                            maxLength={120}
                            value={industry}
                            onChange={(event) =>
                              setIndustry(event.target.value)
                            }
                          />
                          <ChevronDown
                            size={16}
                            aria-hidden="true"
                            focusable="false"
                          />
                        </span>
                        <datalist id="caller-business-suggestions">
                          {businessSuggestions.map((option) => (
                            <option key={option} value={option} />
                          ))}
                        </datalist>
                      </label>
                      <label>
                        Area
                        <span className="caller-suggested-input">
                          <input
                            aria-label="Prospect area"
                            list="caller-area-suggestions"
                            placeholder="South Africa, province, town or suburb"
                            maxLength={160}
                            value={city}
                            onChange={(event) => setCity(event.target.value)}
                          />
                          <ChevronDown
                            size={16}
                            aria-hidden="true"
                            focusable="false"
                          />
                        </span>
                        <datalist id="caller-area-suggestions">
                          {areaSuggestions.map((option) => (
                            <option key={option} value={option} />
                          ))}
                        </datalist>
                      </label>
                      <button
                        className="primary"
                        type="submit"
                        disabled={
                          searching || !!running || !prospecting.enabled
                        }
                      >
                        <Radar size={16} />
                        {searching || running
                          ? "Finding prospects…"
                          : "Find more leads"}
                      </button>
                    </form>
                    {running && (
                      <p className="caller-research-status" role="status">
                        <span className="caller-status-dot" />
                        {running.status === "RUNNING"
                          ? "Checking public business listings. New prospects will appear here automatically."
                          : "Your search is queued. Research starts when the automation worker is online."}
                      </p>
                    )}
                    {!running && searches[0]?.status === "COMPLETED" && (
                      <p className="muted">{text(searches[0].summary)}</p>
                    )}
                    {!running && searches[0]?.status === "FAILED" && (
                      <p className="muted">{text(searches[0].error)}</p>
                    )}
                    {!prospecting.enabled && (
                      <p className="muted">
                        Your administrator is setting up automatic research.
                        Existing prospects can still be worked here.
                      </p>
                    )}
                  </section>
                  <div className="caller-toolbar">
                    <div className="caller-filter-tabs">
                      {[
                        ["READY", "Ready leads"],
                        ["CALLBACK", "Callbacks"],
                        ["ALL", "All my leads"],
                      ].map(([value, title]) => (
                        <button
                          key={value}
                          className={filter === value ? "selected" : ""}
                          aria-pressed={filter === value}
                          onClick={() => setFilter(value)}
                        >
                          {title}
                        </button>
                      ))}
                    </div>
                    <input
                      type="search"
                      aria-label="Search my prospects"
                      placeholder="Search business, phone or area…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    <button onClick={() => addLead()}>
                      <Plus size={15} />
                      Add prospect
                    </button>
                  </div>
                  <p className="muted">
                    {shown.length} prospects ·{" "}
                    {filter === "READY"
                      ? "A phone number is listed. Confirm the current details when you call."
                      : "Only your assigned leads and the available queue are shown."}
                  </p>
                  <div className="caller-prospect-grid">
                    {shown.map(leadCard)}
                  </div>
                  {!shown.length && (
                    <Empty
                      title={
                        filter === "CALLBACK"
                          ? "No callbacks scheduled"
                          : "No matching prospects yet"
                      }
                      detail={
                        filter === "CALLBACK"
                          ? "Choose Call later after a conversation to set a reminder."
                          : "Find more leads, change your filters, or add a prospect you already know."
                      }
                    />
                  )}
                </>
              )}
              {tab === "calls" && (
                <section className="surface">
                  <SectionHeading
                    title="Your conversations"
                    detail="Record the actual call outcome. An interested prospect can move straight to meeting booking."
                    action={
                      <button onClick={() => setTab("leads")}>
                        Find a business to call <ArrowRight size={15} />
                      </button>
                    }
                  />
                  {calls.length ? (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Business</th>
                            <th>Phone</th>
                            <th>Call / outcome</th>
                            <th>Next step</th>
                          </tr>
                        </thead>
                        <tbody>
                          {calls.map((call) => {
                            const lead = leads.find(
                              (item) => item.id === call.leadId,
                            );
                            return (
                              <tr key={text(call.id)}>
                                <td>
                                  <b>{text(object(call.lead).company)}</b>
                                  <small>{date(call.createdAt, true)}</small>
                                </td>
                                <td>
                                  {text(call.toNumber)}
                                  <small>
                                    {call.mode === "PHONE"
                                      ? "Phone · caller reported"
                                      : "Browser · provider status"}
                                  </small>
                                </td>
                                <td>
                                  <Badge value={call.status} />
                                  <small>
                                    {call.outcome === "UNRECORDED"
                                      ? "Outcome pending"
                                      : label(call.outcome)}
                                  </small>
                                </td>
                                <td>
                                  {call.outcome === "QUALIFIED" && lead ? (
                                    <button
                                      onClick={() =>
                                        setMeeting({
                                          lead,
                                          callId: text(call.id),
                                        })
                                      }
                                    >
                                      <CalendarDays size={15} />
                                      Book meeting
                                    </button>
                                  ) : call.outcome === "UNRECORDED" &&
                                    (call.mode === "PHONE" ||
                                      terminal.includes(text(call.status))) ? (
                                    <button
                                      disabled={!!active}
                                      onClick={() => {
                                        setActive({
                                          callId: call.id,
                                          toNumber: call.toNumber,
                                          mode: call.mode,
                                        });
                                        setNotes(text(call.notes, ""));
                                        setCallState("Disconnected");
                                      }}
                                    >
                                      Record outcome
                                    </button>
                                  ) : (
                                    <span className="muted">
                                      {call.outcome === "CALLBACK" ||
                                      call.outcome === "NO_ANSWER"
                                        ? "Follow up from your callback list"
                                        : "Saved"}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      title="Your first conversation starts with a lead"
                      detail="Open Find leads and select Call now. After the call, choose what happened and book a meeting if they’re interested."
                      action={
                        <button
                          className="primary"
                          onClick={() => setTab("leads")}
                        >
                          <Phone size={16} />
                          Find a lead to call
                        </button>
                      }
                    />
                  )}
                </section>
              )}
              {tab === "bookings" && (
                <section className="surface">
                  <SectionHeading
                    title="Meetings you arranged"
                    detail="Your administrator is notified automatically when you book or update a meeting. All times below are South African time (SAST)."
                  />
                  {bookings.length ? (
                    bookings.map((booking) => (
                      <article
                        className="caller-booking"
                        key={text(booking.id)}
                      >
                        <div>
                          <p className="eyebrow">CONCRETE CONSULTATION</p>
                          <h3>{text(object(booking.lead).company)}</h3>
                          <p>
                            <CalendarDays size={15} />{" "}
                            {sastDate(booking.startAt)} SAST
                          </p>
                          <p>
                            {text(
                              object(booking.lead).name,
                              "Business contact",
                            )}{" "}
                            · 30 minutes
                          </p>
                          <Badge value={booking.status} />
                        </div>
                        <div className="caller-actions">
                          <a
                            className="button"
                            href={`/api/platform/${workspace}/caller/bookings/${booking.id}/calendar`}
                          >
                            Download invitation
                          </a>
                          {(booking.bookedById === user.id ||
                            Boolean(user.agencyAdmin)) && (
                            <button onClick={() => updateBooking(booking)}>
                              Update meeting
                            </button>
                          )}
                        </div>
                      </article>
                    ))
                  ) : (
                    <Empty
                      title="Your booked meetings will appear here"
                      detail="After an interested call, choose Interested — book a meeting, select an agreed time and save. Concrete takes care of the admin notification."
                      action={
                        <button onClick={() => setTab("leads")}>
                          Open my calling queue
                        </button>
                      }
                    />
                  )}
                </section>
              )}
            </>
          )}
        </main>
      </div>
      {dialog && <ActionDialog dialog={dialog} close={() => setDialog(null)} />}
      {meeting && (
        <CallerMeeting
          workspaceId={workspace}
          lead={meeting.lead}
          callId={meeting.callId}
          act={act}
          close={() => setMeeting(null)}
        />
      )}
    </div>
  );
}
