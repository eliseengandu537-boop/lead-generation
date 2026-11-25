"use client";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  MapPin,
  Video,
} from "lucide-react";
import { api, label, rows, text, type RecordValue } from "./data";
import { Empty, Loading } from "./primitives";
import { Stat, Stats } from "./admin-ui";

/** South Africa has no daylight saving, so local time is always UTC+2. */
const OFFSET = 2 * 3600000;
const DAY = 86400000;
const local = (value: unknown) => {
  const at = new Date(text(value, ""));
  return Number.isNaN(at.getTime()) ? null : new Date(at.getTime() + OFFSET);
};
const dayKey = (shifted: Date) => shifted.toISOString().slice(0, 10);
const clock = (shifted: Date) =>
  `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOUR = 46;
const tones: Record<string, string> = {
  SCHEDULED: "booked",
  CONFIRMED: "booked",
  COMPLETED: "held",
  HELD: "held",
  NO_SHOW: "missed",
  CANCELLED: "cancelled",
  CANCELED: "cancelled",
};

/** Monday 00:00 (local, stored as a shifted Date) of the week `offset` weeks from this one. */
function weekStart(offset: number) {
  const now = new Date(Date.now() + OFFSET);
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) + offset * 7);
  return monday;
}

export default function AdminSchedule({ businesses }: { businesses: RecordValue[] }) {
  const [data, setData] = useState<RecordValue | null>(null);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [fullDay, setFullDay] = useState(false);
  const [picked, setPicked] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    // Bookings from up to a year back, plus every future one.
    api("/api/platform/admin/call-centre?days=366", "GET", undefined, controller.signal)
      .then((result) => !controller.signal.aborted && setData(result))
      .catch((problem) => !controller.signal.aborted && setError(problem.message));
    return () => controller.abort();
  }, []);

  const names = useMemo(
    () => new Map(businesses.map((item) => [text(item.workspaceId), text(item.name)])),
    [businesses],
  );
  const callers = useMemo(
    () => new Map(rows(data?.callers).map((item) => [text(item.id), text(item.name, text(item.email, ""))])),
    [data],
  );
  const bookings = useMemo(
    () =>
      rows(data?.bookings)
        .map((item) => {
          const start = local(item.startAt);
          const end = local(item.endAt) ?? (start ? new Date(start.getTime() + 1800000) : null);
          return start && end ? { item, start, end } : null;
        })
        .filter((entry): entry is { item: RecordValue; start: Date; end: Date } => !!entry)
        .sort((a, b) => a.start.getTime() - b.start.getTime()),
    [data],
  );

  const monday = weekStart(offset);
  const days = Array.from({ length: 7 }, (_, index) => new Date(monday.getTime() + index * DAY));
  const todayKey = dayKey(new Date(Date.now() + OFFSET));
  const weekEnd = new Date(monday.getTime() + 7 * DAY);
  const inWeek = bookings.filter((entry) => entry.start >= monday && entry.start < weekEnd);
  const from = fullDay ? 0 : 7;
  const to = fullDay ? 24 : 20;
  const nowShifted = new Date(Date.now() + OFFSET);
  const nowHours = nowShifted.getUTCHours() + nowShifted.getUTCMinutes() / 60;
  const company = (item: RecordValue) => {
    const lead = (item.lead ?? {}) as RecordValue;
    return text(lead.company, text(lead.name, "Lead"));
  };
  const client = (item: RecordValue) => names.get(text(item.workspaceId)) || "Your calling desk";
  const today = bookings.filter((entry) => dayKey(entry.start) === todayKey);
  const coming = bookings.filter((entry) => entry.start.getTime() > Date.now() + OFFSET && dayKey(entry.start) !== todayKey).slice(0, 6);
  const selected = bookings.find((entry) => text(entry.item.id) === picked);
  const status = (item: RecordValue) => tones[text(item.status, "SCHEDULED").toUpperCase()] ?? "booked";
  const range = `${days[0].getUTCDate()} ${MONTHS[days[0].getUTCMonth()]} to ${days[6].getUTCDate()} ${MONTHS[days[6].getUTCMonth()]}`;
  const upcomingWeek = bookings.filter(
    (entry) => entry.start.getTime() > Date.now() + OFFSET && entry.start.getTime() < Date.now() + OFFSET + 7 * DAY,
  ).length;

  if (error) return <div className="alert error" role="alert">{error}</div>;
  if (!data) return <Loading />;

  function detail(entry: { item: RecordValue; start: Date; end: Date }) {
    const item = entry.item;
    return (
      <>
        <b>{text(item.title, company(item))}</b>
        <span>
          {company(item)} · {client(item)}
        </span>
        <small>
          {WEEKDAYS[(entry.start.getUTCDay() + 6) % 7]} {entry.start.getUTCDate()} {MONTHS[entry.start.getUTCMonth()]},{" "}
          {clock(entry.start)} to {clock(entry.end)}
          {callers.get(text(item.bookedById)) ? ` · booked by ${callers.get(text(item.bookedById))}` : ""}
        </small>
      </>
    );
  }

  return (
    <div className="adm-schedule">
      <Stats>
        <Stat label="Booked this week" value={inWeek.length} hint={range} />
        <Stat label="Next 7 days" value={upcomingWeek} hint="Calls still to happen" />
        <Stat
          label="Held this week"
          value={inWeek.filter((entry) => status(entry.item) === "held").length}
          tone={inWeek.some((entry) => status(entry.item) === "held") ? "good" : undefined}
          hint="Marked as held"
        />
        <Stat
          label="No-shows this week"
          value={inWeek.filter((entry) => status(entry.item) === "missed").length}
          tone={inWeek.some((entry) => status(entry.item) === "missed") ? "warn" : undefined}
          hint="Follow these up"
        />
      </Stats>
      <div className="adm-sched-bar">
        <div className="adm-sched-nav">
          <button className="g-round" aria-label="Previous week" onClick={() => setOffset(offset - 1)}>
            <ChevronLeft size={17} />
          </button>
          <button className={`adm-chip${offset === 0 ? " is-on" : ""}`} onClick={() => setOffset(0)}>
            This week
          </button>
          <button className="g-round" aria-label="Next week" onClick={() => setOffset(offset + 1)}>
            <ChevronRight size={17} />
          </button>
          <b>{range}</b>
        </div>
        <div className="adm-sched-legend" aria-label="Colours">
          <span className="tone-booked">Booked</span>
          <span className="tone-held">Held</span>
          <span className="tone-missed">No-show</span>
          <span className="tone-cancelled">Cancelled</span>
        </div>
        <div className="adm-period" role="group" aria-label="Hours shown">
          <button className={!fullDay ? "is-on" : ""} aria-pressed={!fullDay} onClick={() => setFullDay(false)}>
            07 to 20
          </button>
          <button className={fullDay ? "is-on" : ""} aria-pressed={fullDay} onClick={() => setFullDay(true)}>
            24 h
          </button>
        </div>
      </div>
      <div className="adm-sched-layout">
        <section className="adm-panel adm-week" aria-label={`Calls for the week of ${range}`}>
          <div className="adm-week-head">
            <span />
            {days.map((day) => (
              <div key={dayKey(day)} className={dayKey(day) === todayKey ? "is-today" : ""}>
                <b>{day.getUTCDate()}</b> {WEEKDAYS[(day.getUTCDay() + 6) % 7]}
              </div>
            ))}
          </div>
          <div className="adm-week-body" style={{ height: (to - from) * HOUR + 12 }}>
            <div className="adm-week-hours">
              {Array.from({ length: to - from }, (_, index) => (
                <span key={index} style={{ top: index * HOUR }}>
                  {String(from + index).padStart(2, "0")}:00
                </span>
              ))}
            </div>
            {days.map((day) => {
              const key = dayKey(day);
              const entries = inWeek.filter((entry) => dayKey(entry.start) === key);
              return (
                <div key={key} className={`adm-week-day${key === todayKey ? " is-today" : ""}`}>
                  {Array.from({ length: to - from }, (_, index) => (
                    <i key={index} style={{ top: index * HOUR }} />
                  ))}
                  {key === todayKey && nowHours >= from && nowHours <= to && (
                    <span className="adm-now" style={{ top: (nowHours - from) * HOUR }} />
                  )}
                  {entries.map((entry, index) => {
                    const startHours = entry.start.getUTCHours() + entry.start.getUTCMinutes() / 60;
                    const hours = Math.max(0.5, (entry.end.getTime() - entry.start.getTime()) / 3600000);
                    const top = Math.min(Math.max(0, startHours - from), to - from - 0.6) * HOUR;
                    const id = text(entry.item.id);
                    return (
                      <button
                        key={id}
                        className={`adm-event tone-${status(entry.item)}${picked === id ? " is-picked" : ""}`}
                        style={{ top, height: Math.max(30, hours * HOUR - 4), animationDelay: `${index * 40}ms` }}
                        onClick={() => setPicked(picked === id ? "" : id)}
                        aria-label={`${text(entry.item.title, company(entry.item))}, ${clock(entry.start)}, ${client(entry.item)}`}
                      >
                        <b>{company(entry.item)}</b>
                        <small>
                          {clock(entry.start)}, {client(entry.item)}
                        </small>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {!inWeek.length && (
            <p className="adm-week-empty">
              <CalendarDays size={16} /> No calls booked this week.
            </p>
          )}
        </section>
        <aside className="adm-panel adm-today">
          {selected && (
            <div className="adm-today-picked">
              <p className="adm-today-title">Selected call</p>
              <div className={`adm-agenda tone-${status(selected.item)}`}>
                {detail(selected)}
                <span className="adm-agenda-status">{label(selected.item.status)}</span>
                <div className="adm-agenda-actions">
                  {text(selected.item.meetingUrl, "") && (
                    <a className="button" href={text(selected.item.meetingUrl)} target="_blank" rel="noopener noreferrer">
                      <Video size={15} /> Join
                    </a>
                  )}
                  <a
                    className="button"
                    href={`/api/platform/${encodeURIComponent(text(selected.item.workspaceId))}/caller/bookings/${encodeURIComponent(text(selected.item.id))}/calendar`}
                  >
                    <Download size={15} /> Calendar
                  </a>
                </div>
                {text(selected.item.location, "") && (
                  <small className="adm-agenda-where">
                    <MapPin size={13} /> {text(selected.item.location)}
                  </small>
                )}
              </div>
            </div>
          )}
          <header>
            <h2>Today</h2>
            <span>
              {WEEKDAYS[(new Date(Date.now() + OFFSET).getUTCDay() + 6) % 7]} {new Date(Date.now() + OFFSET).getUTCDate()}{" "}
              {MONTHS[new Date(Date.now() + OFFSET).getUTCMonth()]}
            </span>
          </header>
          {today.length ? (
            today.map((entry) => (
              <button
                key={text(entry.item.id)}
                className={`adm-agenda tone-${status(entry.item)}`}
                onClick={() => setPicked(text(entry.item.id))}
              >
                {detail(entry)}
              </button>
            ))
          ) : (
            <p className="muted">No calls today.</p>
          )}
          <h3>Coming up</h3>
          {coming.length ? (
            <ul className="adm-coming">
              {coming.map((entry) => (
                <li key={text(entry.item.id)}>
                  <button onClick={() => {
                    const target = Math.floor((entry.start.getTime() - weekStart(0).getTime()) / (7 * DAY));
                    setOffset(target);
                    setPicked(text(entry.item.id));
                  }}>
                    <i className={`tone-${status(entry.item)}`} />
                    <span>
                      <b>{company(entry.item)}</b>
                      <small>{client(entry.item)}</small>
                    </span>
                    <time>
                      {entry.start.getUTCDate()} {MONTHS[entry.start.getUTCMonth()]}
                    </time>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Nothing booked ahead." detail="Calls your callers book show here." />
          )}
        </aside>
      </div>
    </div>
  );
}
