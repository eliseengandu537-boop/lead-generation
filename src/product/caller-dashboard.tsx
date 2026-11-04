"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import type { Device, Call } from "@twilio/voice-sdk";
import {
  CalendarDays,
  CheckCheck,
  Globe2,
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
  Send,
  Users,
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
import { CampaignComposer } from "./campaign-composer";
import { ThemeToggle } from "./theme";

const tabs = [
  ["overview", "My dashboard", LayoutDashboard],
  ["discover", "Find leads", Radar],
  ["leads", "My leads", Users],
  ["calls", "Calls", Phone],
  ["bookings", "Bookings", CalendarDays],
  ["outreach", "Email outreach", Send],
  ["website", "Business website", Globe2],
] as const;
const outcomes = [
  "CONNECTED",
  "NO_ANSWER",
  "VOICEMAIL",
  "WRONG_NUMBER",
  "CALLBACK",
  "QUALIFIED",
  "NOT_QUALIFIED",
  "DO_NOT_CALL",
];
const finalStates = [
  "COMPLETED",
  "BUSY",
  "NO_ANSWER",
  "FAILED",
  "CANCELED",
  "EXPIRED",
];
const values = (options: string[]) =>
  options.map((value) => ({ value, label: label(value) }));

export default function CallerDashboard() {
  const [session, setSession] = useState<RecordValue>({});
  const [workspace, setWorkspace] = useState("");
  const [data, setData] = useState<RecordValue>({});
  const [tab, setTab] = useState("overview");
  const [mobile, setMobile] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [directory, setDirectory] = useState<RecordValue | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [compose, setCompose] = useState(false);
  const [active, setActive] = useState<RecordValue | null>(null);
  const [callState, setCallState] = useState("");
  const [muted, setMuted] = useState(false);
  const device = useRef<Device | null>(null);
  const connection = useRef<Call | null>(null);
  const loadingWorkspace = useRef("");
  const refresh = useCallback(async () => {
    if (!workspace) return;
    const result = await api(`/api/platform/${workspace}/caller`);
    if (loadingWorkspace.current === workspace) setData(result);
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
    loadingWorkspace.current = workspace;
    setDirectory(null);
    setData({});
    setError("");
    setActive(null);
    void refresh().catch((problem) => setError(problem.message));
  }, [workspace, refresh]);
  useEffect(() => {
    if (!workspace) return;
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible")
          void refresh().catch((problem) => setError(problem.message));
      },
      active ? 5000 : 30000,
    );
    return () => clearInterval(timer);
  }, [workspace, active, refresh]);
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
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active, callState]);
  const business = object(data.business),
    user = object(session.user),
    totals = object(data.totals);
  const leads = rows(data.leads),
    calls = rows(data.calls),
    bookings = rows(data.bookings);
  const activeRecord = calls.find((call) => call.id === active?.callId);
  const matching = leads.filter((lead) =>
    [lead.company, lead.name, lead.email, lead.phone, lead.salesQualification]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  async function action(input: RecordValue) {
    const result = await api(`/api/platform/${workspace}/caller`, "POST", {
      ...input,
      requestId: input.requestId || crypto.randomUUID(),
    });
    setNotice(text(result.message, "Saved."));
    await refresh();
    return result;
  }
  async function run(input: RecordValue) {
    setBusy(true);
    setError("");
    try {
      return await action(input);
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function editLead(lead?: RecordValue) {
    setDialog({
      title: lead ? "Edit lead" : "Add a lead",
      initial: lead,
      fields: [
        { name: "company", label: "Business name", required: true },
        { name: "name", label: "Contact name" },
        {
          name: "phone",
          label: "Phone number",
          placeholder: "+27 82 123 4567",
        },
        { name: "email", label: "Email address", type: "email" },
        { name: "website", label: "Website", type: "url" },
        { name: "industry", label: "Industry / niche" },
        { name: "location", label: "City / province" },
        { name: "sourceUrl", label: "Source URL", type: "url" },
        { name: "notes", label: "Notes", type: "textarea" },
      ],
      submit: (fields) =>
        action({
          ...fields,
          action: lead ? "edit-lead" : "add-lead",
          ...(lead ? { id: lead.id } : {}),
        }),
    });
  }
  function qualify(lead: RecordValue) {
    setDialog({
      title: `Qualify ${text(lead.company)}`,
      detail:
        "Record what you learned from the conversation. Sales qualification does not grant email permission.",
      initial: {
        qualification: lead.salesQualification,
        notes: lead.salesQualificationNotes,
      },
      fields: [
        {
          name: "qualification",
          label: "Sales qualification",
          type: "select",
          options: values([
            "QUALIFIED",
            "NOT_QUALIFIED",
            "CALLBACK",
            "UNREVIEWED",
          ]),
          required: true,
        },
        {
          name: "notes",
          label: "Qualification notes",
          type: "textarea",
          required: true,
        },
      ],
      submit: (fields) => action({ ...fields, action: "qualify", id: lead.id }),
    });
  }
  function outcome(call: RecordValue) {
    setDialog({
      title: "Record call outcome",
      detail:
        call.mode === "PHONE"
          ? "Vodacom activity is reported by you. Concrete cannot verify a SIM call or measure its duration."
          : "The phone provider supplies call status and duration. Add your conversation notes here.",
      initial: {
        outcome: call.outcome === "UNRECORDED" ? "CONNECTED" : call.outcome,
        notes: call.notes,
        reportedDurationSeconds: call.reportedDurationSeconds ?? "",
      },
      fields: [
        {
          name: "outcome",
          label: "Outcome",
          type: "select",
          options: values(outcomes),
          required: true,
        },
        { name: "notes", label: "Conversation notes", type: "textarea" },
        ...(call.mode === "PHONE"
          ? [
              {
                name: "reportedDurationSeconds",
                label: "Duration in seconds (optional, reported by you)",
                type: "number" as const,
                min: 0,
                max: 21600,
              },
            ]
          : []),
      ],
      submit: async (fields) => {
        const duration = fields.reportedDurationSeconds;
        await action({
          action: "call-outcome",
          id: call.id,
          outcome: fields.outcome,
          notes: fields.notes,
          ...(call.mode === "PHONE" && duration !== ""
            ? { reportedDurationSeconds: Number(duration) }
            : {}),
        });
        if (active?.callId === call.id) {
          setActive(null);
          device.current?.destroy();
          device.current = null;
        }
      },
    });
  }
  function book(lead: RecordValue) {
    const hosts = rows(data.hosts);
    setDialog({
      title: `Book a meeting · ${text(lead.company)}`,
      detail:
        "Choose the appointment in your computer’s local timezone. The calendar download contains the exact appointment time. No email is sent automatically.",
      fields: [
        {
          name: "title",
          label: "Meeting title",
          required: true,
          value: `Discovery meeting · ${text(lead.company)}`,
        },
        {
          name: "hostId",
          label: "Meeting host",
          type: "select",
          required: true,
          options: hosts.map((host) => ({
            value: text(host.id),
            label: text(host.name),
          })),
          value: hosts[0]?.id,
        },
        {
          name: "startAt",
          label: "Start time (your local time)",
          type: "datetime-local",
          required: true,
        },
        {
          name: "minutes",
          label: "Duration in minutes",
          type: "number",
          min: 1,
          max: 480,
          value: 30,
          required: true,
        },
        { name: "location", label: "Location / phone meeting" },
        { name: "meetingUrl", label: "Meeting link (HTTPS)", type: "url" },
        { name: "notes", label: "Internal notes", type: "textarea" },
        {
          name: "customerAgreed",
          label: "The prospect agreed to this appointment",
          type: "checkbox",
          required: true,
        },
      ],
      submit: (fields) => {
        const start = new Date(String(fields.startAt));
        return action({
          action: "book",
          leadId: lead.id,
          title: fields.title,
          hostId: fields.hostId,
          startAt: start.toISOString(),
          endAt: new Date(
            start.getTime() + Number(fields.minutes) * 60000,
          ).toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          location: fields.location,
          meetingUrl: fields.meetingUrl,
          notes: fields.notes,
          customerAgreed: fields.customerAgreed,
        });
      },
    });
  }
  function updateBooking(booking: RecordValue) {
    setDialog({
      title: "Update booking",
      initial: booking,
      fields: [
        {
          name: "status",
          label: "Booking status",
          type: "select",
          options: values(["SCHEDULED", "COMPLETED", "CANCELED", "NO_SHOW"]),
          required: true,
        },
        {
          name: "startAt",
          label: "Start time (your local time)",
          type: "datetime-local",
          required: true,
        },
        {
          name: "endAt",
          label: "End time (your local time)",
          type: "datetime-local",
          required: true,
        },
      ],
      submit: (fields) =>
        action({
          action: "update-booking",
          id: booking.id,
          version: booking.version,
          status: fields.status,
          startAt: new Date(String(fields.startAt)).toISOString(),
          endAt: new Date(String(fields.endAt)).toISOString(),
        }),
    });
  }
  async function dial(lead: RecordValue, mode: "PHONE" | "BROWSER") {
    if (active || busy) return;
    setBusy(true);
    setError("");
    let prepared: RecordValue | null = null;
    try {
      prepared = await action({
        action: "prepare-call",
        leadId: lead.id,
        mode,
      });
      setActive(prepared);
      if (mode === "PHONE") {
        setTab("calls");
        return;
      }
      setCallState("Connecting microphone…");
      const { Device } = await import("@twilio/voice-sdk");
      device.current?.destroy();
      const next = new Device(text(prepared.token), { closeProtection: true });
      device.current = next;
      next.on("error", (problem) => {
        setError(problem.message || "Voice connection failed.");
        setCallState("Failed");
      });
      const call = await next.connect({
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
        await action({ action: "abandon-call", id: prepared.callId }).catch(
          () => undefined,
        );
      setActive(null);
    } finally {
      setBusy(false);
    }
  }
  const leadList = (
    <div className="caller-lead-list">
      {matching.length ? (
        matching.map((lead) => (
          <article className="surface caller-lead" key={text(lead.id)}>
            <div>
              <h3>{text(lead.company)}</h3>
              <p>
                {text(lead.name, "Contact name not recorded")} ·{" "}
                {text(lead.location, "Location not recorded")}
              </p>
              <p>
                {text(lead.phone, "No phone")} · {text(lead.email, "No email")}
              </p>
              <Badge value={lead.salesQualification} />{" "}
              {Boolean(lead.doNotCall) && <Badge value="DO_NOT_CALL" />}
              <small>
                {lead.ownerId
                  ? "Assigned to you"
                  : "Available · claimed when you work on it"}
              </small>
            </div>
            <div className="caller-actions">
              <button
                disabled={busy || !!active || !lead.phone || !!lead.doNotCall}
                onClick={() => void dial(lead, "PHONE")}
              >
                <Phone size={15} /> Vodacom phone
              </button>
              <button
                disabled={
                  busy ||
                  !!active ||
                  !lead.phone ||
                  !!lead.doNotCall ||
                  !object(data.voice).ready
                }
                onClick={() => void dial(lead, "BROWSER")}
              >
                Call in browser
              </button>
              <button onClick={() => editLead(lead)}>Edit</button>
              <button onClick={() => qualify(lead)}>
                <CheckCheck size={15} /> Qualify
              </button>
              <button onClick={() => book(lead)}>
                <CalendarDays size={15} /> Book meeting
              </button>
            </div>
          </article>
        ))
      ) : (
        <Empty
          title="Your lead list is ready"
          detail="Add a real prospect or search for businesses to begin."
          action={
            <button onClick={() => editLead()}>
              <Plus size={16} /> Add lead
            </button>
          }
        />
      )}
    </div>
  );
  return (
    <div className="caller-app">
      <aside className={`caller-sidebar ${mobile ? "is-open" : ""}`}>
        <a className="caller-brand" href="/caller">
          <ConcreteMark small /> CONCRETE.
        </a>
        <p className="eyebrow">CALLER WORKSPACE</p>
        <nav aria-label="Caller navigation">
          {tabs.map(([id, title, Icon]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => {
                setTab(id);
                setMobile(false);
              }}
            >
              <Icon size={18} />
              {title}
            </button>
          ))}
        </nav>
        <div className="caller-sidebar-bottom">
          <p>{text(user.name, "Caller")}</p>
          <small>{text(user.email, "")}</small>
          {Boolean(user.agencyAdmin) && (
            <a href="/admin">Back to administration</a>
          )}
          <button onClick={() => void signOut({ callbackUrl: "/login" })}>
            <LogOut size={16} /> Sign out
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
          <label>
            Business
            <select
              aria-label="Assigned business"
              value={workspace}
              disabled={!!active || busy}
              onChange={(event) => {
                setWorkspace(event.target.value);
                setSearch("");
                setNotice("");
              }}
            >
              {rows(session.businesses).map((entry) => (
                <option
                  key={text(entry.workspaceId)}
                  value={text(entry.workspaceId)}
                >
                  {text(entry.name)}
                </option>
              ))}
            </select>
          </label>
          <div className="caller-actions">
            <ThemeToggle />
            <button
              className="icon-button"
              aria-label="Refresh dashboard"
              onClick={() =>
                void refresh().catch((problem) => setError(problem.message))
              }
            >
              <RefreshCw size={18} />
            </button>
          </div>
        </header>
        <main id="main-content" className="caller-content">
          <SectionHeading
            eyebrow={text(business.name, "Concrete sales workspace")}
            title={tabs.find(([id]) => id === tab)?.[1] || "My dashboard"}
            detail="Find a prospect. Have a conversation. Create an opportunity."
          />
          {error && (
            <div className="alert error" role="alert">
              {error}
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
              className="surface caller-active-call"
              aria-label="Current call"
            >
              <div>
                <b>
                  {active.mode === "PHONE"
                    ? "Vodacom phone handoff"
                    : "Browser call"}{" "}
                  · {text(active.toNumber)}
                </b>
                <p>
                  {active.mode === "PHONE"
                    ? "Open the dialler on a device connected to your phone. Then record what actually happened."
                    : `${callState} · Recorded status: ${label(activeRecord?.status || "PREPARED")}`}
                </p>
              </div>
              <div className="caller-actions">
                {active.mode === "PHONE" ? (
                  <a
                    className="button primary"
                    href={`tel:${text(active.toNumber)}`}
                  >
                    <Phone size={16} /> Open phone dialler
                  </a>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        const next = !muted;
                        connection.current?.mute(next);
                        setMuted(next);
                      }}
                    >
                      {muted ? <MicOff size={16} /> : <Mic size={16} />}
                      {muted ? "Unmute" : "Mute"}
                    </button>
                    <button onClick={() => connection.current?.disconnect()}>
                      <PhoneOff size={16} /> Hang up
                    </button>
                  </>
                )}
                {activeRecord &&
                  (active.mode === "PHONE" ||
                    finalStates.includes(text(activeRecord.status))) && (
                    <button
                      className="primary"
                      onClick={() => outcome(activeRecord)}
                    >
                      Record outcome
                    </button>
                  )}
                {active.mode === "BROWSER" &&
                  ["Disconnected", "Failed"].includes(callState) && (
                    <button
                      onClick={() => {
                        void run({ action: "abandon-call", id: active.callId });
                        setActive(null);
                        device.current?.destroy();
                      }}
                    >
                      Close call panel
                    </button>
                  )}
              </div>
            </section>
          )}
          {!workspace ? (
            Object.keys(session).length ? (
              <Empty
                title="No business assigned yet"
                detail="Your administrator can assign a website from Call centre → Caller access."
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
                      ["My leads", totals.leads],
                      ["Qualified prospects", totals.qualified],
                      ["Call outcomes logged", totals.callsLogged],
                      ["Scheduled bookings", totals.bookings],
                    ].map(([title, amount]) => (
                      <div className="surface" key={String(title)}>
                        <span>{String(title)}</span>
                        <strong>{number(amount).toLocaleString()}</strong>
                      </div>
                    ))}
                  </div>
                  <section className="surface">
                    <SectionHeading
                      title="Your next conversation starts here"
                      detail="All figures reflect saved activity in this business."
                    />
                    <div className="caller-actions">
                      <button
                        className="primary"
                        onClick={() => setTab("leads")}
                      >
                        <Phone size={16} /> Work my leads
                      </button>
                      <button onClick={() => editLead()}>
                        <Plus size={16} /> Add lead
                      </button>
                      <button onClick={() => setTab("discover")}>
                        Find prospects
                      </button>
                    </div>
                    <p className="muted">
                      Vodacom SIM calls open your phone dialler. Browser calling{" "}
                      {object(data.voice).ready
                        ? "is connected"
                        : "needs a connected voice provider"}
                      . Phone logs are recorded separately from
                      provider-confirmed calls.
                    </p>
                  </section>
                  <SectionHeading title="Recent leads" />
                  {leadList}
                </>
              )}
              {tab === "leads" && (
                <>
                  <div className="caller-toolbar">
                    <input
                      type="search"
                      aria-label="Search my leads"
                      placeholder="Search company, contact or phone…"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                    <button className="primary" onClick={() => editLead()}>
                      <Plus size={16} /> Add lead
                    </button>
                  </div>
                  {leadList}
                </>
              )}
              {tab === "discover" && (
                <>
                  <section className="surface">
                    <SectionHeading
                      title="Find local prospects"
                      detail="Search public business listings near a South African city centre. No AI credit or search API key is needed. Results are limited to 10 listings within 8 km."
                    />
                    <form
                      className="caller-form"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const fields = new FormData(event.currentTarget);
                        setBusy(true);
                        setError("");
                        setDirectory(null);
                        try {
                          setDirectory(
                            await api(
                              `/api/platform/${workspace}/caller/directory`,
                              "POST",
                              {
                                city: fields.get("city"),
                                category: fields.get("category"),
                              },
                            ),
                          );
                        } catch (problem) {
                          setError((problem as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <label>
                        Business category
                        <select name="category">
                          {[
                            "Vehicle repair",
                            "Restaurants",
                            "Cafes",
                            "Dentists",
                            "Clinics",
                            "Hairdressers",
                            "Hotels",
                            "Estate agents",
                            "Car dealers",
                            "Hardware stores",
                          ].map((option) => (
                            <option key={option}>{option}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Search city
                        <select name="city">
                          {[
                            "Johannesburg",
                            "Sandton",
                            "Pretoria",
                            "Centurion",
                            "Cape Town",
                            "Durban",
                            "Gqeberha",
                            "Bloemfontein",
                          ].map((option) => (
                            <option key={option}>{option}</option>
                          ))}
                        </select>
                      </label>
                      <button className="primary" disabled={busy}>
                        <Radar size={16} />
                        {busy ? "Searching…" : "Search public directory"}
                      </button>
                    </form>
                    <p className="muted">
                      Public listings can be incomplete or outdated. Review each
                      prospect before adding it. Listed contact details do not
                      establish permission for outreach.{" "}
                      <a
                        href="https://www.openstreetmap.org/copyright"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        © OpenStreetMap contributors · ODbL
                      </a>
                      {" · "}
                      <a
                        href="https://overpass.private.coffee/#privacy-policy"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Directory provider & privacy
                      </a>
                    </p>
                    {directory && (
                      <>
                        <p>
                          {rows(directory.results).length} listings ·{" "}
                          {text(directory.city)} ·{" "}
                          {date(directory.fetchedAt, true)}
                        </p>
                        {rows(directory.results).length ? (
                          rows(directory.results).map((lead) => (
                            <article
                              className="caller-booking"
                              key={text(lead.sourceUrl)}
                            >
                              <div>
                                <h3>{text(lead.company)}</h3>
                                <p>
                                  {text(lead.phone, "No phone listed")} ·{" "}
                                  {text(lead.location)}
                                </p>
                                <a
                                  href={text(lead.sourceUrl)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  View source listing
                                </a>
                              </div>
                              <button
                                disabled={
                                  busy ||
                                  leads.some(
                                    (existing) =>
                                      existing.sourceUrl === lead.sourceUrl,
                                  )
                                }
                                onClick={() => {
                                  setDialog({
                                    title: "Review prospect before adding",
                                    detail:
                                      "Check that these public details describe the business you want to contact. Saving this lead does not grant email permission.",
                                    fields: [
                                      {
                                        name: "company",
                                        label: "Business name",
                                        required: true,
                                      },
                                      { name: "phone", label: "Phone number" },
                                      {
                                        name: "email",
                                        label: "Email address",
                                        type: "email",
                                      },
                                      {
                                        name: "website",
                                        label: "Website",
                                        type: "url",
                                      },
                                    ],
                                    initial: lead,
                                    submit: (fields) =>
                                      action({
                                        ...lead,
                                        ...fields,
                                        action: "add-lead",
                                      }),
                                  });
                                }}
                              >
                                {" "}
                                {leads.some(
                                  (existing) =>
                                    existing.sourceUrl === lead.sourceUrl,
                                )
                                  ? "Already added"
                                  : "Review & add lead"}
                              </button>
                            </article>
                          ))
                        ) : (
                          <p className="muted">
                            No matching listings were returned in this area. Try
                            another city/category, use website search below, or
                            add a lead manually.
                          </p>
                        )}
                      </>
                    )}
                  </section>
                  <section className="surface">
                    <SectionHeading
                      title="Website research search"
                      detail="Choose your target niche and city. Research results are saved as real prospects; contact permission is checked separately."
                    />
                    <form
                      className="caller-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const fields = new FormData(event.currentTarget);
                        void run({
                          action: "discover",
                          industry: fields.get("industry"),
                          location: fields.get("location"),
                          maxResults: Number(fields.get("maxResults")),
                          permissionConfirmed: true,
                        });
                      }}
                    >
                      <label>
                        Target niche
                        <input
                          name="industry"
                          required
                          minLength={2}
                          placeholder="e.g. vehicle repair workshops"
                        />
                      </label>
                      <label>
                        City / province
                        <input
                          name="location"
                          required
                          minLength={2}
                          placeholder="e.g. Johannesburg, South Africa"
                        />
                      </label>
                      <label>
                        Maximum results
                        <input
                          name="maxResults"
                          type="number"
                          min={1}
                          max={10}
                          defaultValue={5}
                          required
                        />
                      </label>
                      {!data.discoveryConfigured && (
                        <p className="alert">
                          Your administrator needs to approve this website’s
                          business profile and connect its search provider
                          before discovery can run. You can add and work real
                          leads manually now.
                        </p>
                      )}
                      <button
                        className="primary"
                        disabled={busy || !data.discoveryConfigured}
                      >
                        <Radar size={16} />
                        {busy ? "Queuing search…" : "Search for leads"}
                      </button>
                    </form>
                  </section>
                  <section className="surface">
                    <h3>My search jobs</h3>
                    {rows(data.jobs).length ? (
                      rows(data.jobs).map((job) => (
                        <div className="caller-history" key={text(job.id)}>
                          <Badge value={job.status} />
                          <span>{date(job.createdAt, true)}</span>
                          {!!job.error && (
                            <p className="error">{text(job.error)}</p>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="muted">
                        Your searches will appear here. The automation computer
                        must be online for queued research.
                      </p>
                    )}
                  </section>
                </>
              )}
              {tab === "calls" && (
                <section className="surface">
                  <SectionHeading
                    title="My call history"
                    detail="Phone activity is self-reported. Browser statuses and durations come from signed provider callbacks."
                    action={
                      <button onClick={() => setTab("leads")}>
                        Choose a lead
                      </button>
                    }
                  />
                  {calls.length ? (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Prospect</th>
                            <th>Call source</th>
                            <th>Status / outcome</th>
                            <th>Duration</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {calls.map((call) => (
                            <tr key={text(call.id)}>
                              <td>
                                <b>{text(object(call.lead).company)}</b>
                                <small>
                                  {text(call.toNumber)} ·{" "}
                                  {date(call.createdAt, true)}
                                </small>
                              </td>
                              <td>
                                {call.mode === "PHONE"
                                  ? "Phone · caller reported"
                                  : "Browser · provider"}
                              </td>
                              <td>
                                <Badge value={call.status} />
                                <small>{label(call.outcome)}</small>
                              </td>
                              <td>
                                {call.mode === "PHONE"
                                  ? `${text(call.reportedDurationSeconds, "—")} sec (reported)`
                                  : `${text(call.durationSeconds, "—")} sec`}
                              </td>
                              <td>
                                <button
                                  disabled={
                                    call.mode === "BROWSER" &&
                                    !finalStates.includes(text(call.status))
                                  }
                                  onClick={() => outcome(call)}
                                >
                                  Record outcome
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      title="No calls logged yet"
                      detail="Choose a real prospect from My leads to start a phone handoff or browser call."
                    />
                  )}
                </section>
              )}
              {tab === "bookings" && (
                <section className="surface">
                  <SectionHeading
                    title="Meetings you arranged"
                    detail="Download a calendar invitation to share the meeting. Booking a slot does not send an email automatically."
                    action={
                      <button onClick={() => setTab("leads")}>
                        Book from a lead
                      </button>
                    }
                  />
                  {bookings.length ? (
                    bookings.map((booking) => (
                      <article
                        className="caller-booking"
                        key={text(booking.id)}
                      >
                        <div>
                          <h3>{text(booking.title)}</h3>
                          <p>
                            {date(booking.startAt, true)} –{" "}
                            {date(booking.endAt, true)} ·{" "}
                            {text(booking.timezone)}
                          </p>
                          <p>
                            {text(object(booking.lead).company)} · Host:{" "}
                            {text(
                              rows(data.hosts).find(
                                (host) => host.id === booking.hostId,
                              )?.name,
                            )}
                          </p>
                          <Badge value={booking.status} />
                        </div>
                        <div className="caller-actions">
                          <a
                            className="button"
                            href={`/api/platform/${workspace}/caller/bookings/${booking.id}/calendar`}
                          >
                            Download calendar
                          </a>
                          {(booking.bookedById === user.id ||
                            Boolean(user.agencyAdmin)) && (
                            <button onClick={() => updateBooking(booking)}>
                              Update / reschedule
                            </button>
                          )}
                        </div>
                      </article>
                    ))
                  ) : (
                    <Empty
                      title="Your bookings will appear here"
                      detail="After qualifying a lead, select Book meeting and choose a host and a time."
                    />
                  )}
                </section>
              )}
              {tab === "outreach" && (
                <section className="surface">
                  <SectionHeading
                    title="Email outreach"
                    detail="Campaigns and email sending are managed together here."
                    action={
                      <button
                        className="primary"
                        disabled={!data.canSend}
                        onClick={() => setCompose(true)}
                      >
                        <Send size={16} /> Create and send
                      </button>
                    }
                  />
                  {!data.canSend && (
                    <p className="alert">
                      Your administrator has not enabled email sending for this
                      business.
                    </p>
                  )}
                  {Boolean(data.canSend) &&
                    (!object(data.sending).enabled ||
                      !object(data.sending).profileApproved ||
                      !rows(data.mailboxes).some(
                        (account) => account.status === "LIVE_ENABLED",
                      )) && (
                      <p className="alert">
                        Email sending needs an approved website profile, the
                        business’s authorised sending mailbox, verified
                        recipients and enabled sending. You can compose and
                        preview while your administrator completes setup.
                      </p>
                    )}
                  {rows(data.campaigns).map((campaign) => (
                    <article className="caller-history" key={text(campaign.id)}>
                      <b>{text(campaign.name)}</b>
                      <Badge value={campaign.status} />
                      <span>
                        {number(object(campaign._count).recipients)} recipients
                      </span>
                      {["RUNNING", "APPROVED"].includes(
                        text(campaign.status),
                      ) && (
                        <button
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await api(
                                `/api/platform/${workspace}/caller/campaigns`,
                                "POST",
                                {
                                  action: "pause",
                                  id: campaign.id,
                                  requestId: crypto.randomUUID(),
                                },
                              );
                              await refresh();
                            } catch (problem) {
                              setError((problem as Error).message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Pause
                        </button>
                      )}
                    </article>
                  ))}
                  {!rows(data.campaigns).length && (
                    <Empty
                      title="No outreach campaigns yet"
                      detail="Create a campaign, review the sender, recipients and messages, then send when setup is ready."
                    />
                  )}
                </section>
              )}
              {tab === "website" && (
                <section className="surface">
                  <SectionHeading
                    title={text(business.name)}
                    detail="The business assigned to you. Website analysis and provider connections are managed by your administrator."
                  />
                  <a
                    href={text(business.websiteUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {text(business.websiteUrl)}
                  </a>
                  <p>
                    Business profile:{" "}
                    <Badge
                      value={
                        business.profileApproved ? "APPROVED" : "SETUP_REQUIRED"
                      }
                    />
                  </p>
                  <p>
                    {text(
                      business.targetCriteria,
                      "Your administrator has not set the target customer profile yet.",
                    )}
                  </p>
                  <p className="muted">
                    Connecting a website records its business context. Visitor
                    tracking requires a separate website installation; this
                    dashboard does not invent visitor activity.
                  </p>
                </section>
              )}
            </>
          )}
        </main>
      </div>
      {dialog && <ActionDialog dialog={dialog} close={() => setDialog(null)} />}
      {compose && (
        <CampaignComposer
          organization={{
            workspaceId: workspace,
            name: text(business.name),
            role: "CALLER",
          }}
          accounts={rows(data.mailboxes)}
          leads={leads}
          sending={object(data.sending)}
          endpoint={`/api/platform/${workspace}/caller/campaigns`}
          setupPath="/caller"
          act={async (_resource, input) => {
            const result = await api(
              `/api/platform/${workspace}/caller/campaigns`,
              "POST",
              input,
            );
            setNotice(text(result.message, "Campaign launched."));
            await refresh();
            return result;
          }}
          close={() => setCompose(false)}
        />
      )}
    </div>
  );
}
