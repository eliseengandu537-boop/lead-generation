"use client";
import { useState } from "react";
import {
  ChevronDown,
  CircleAlert,
  Copy,
  Pause,
  Play,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { date, number, object, rows, text } from "./data";
import { Badge, SectionHeading } from "./primitives";
import { TrendChart } from "./charts";
import { Panel, Stat, Stats, compact, percent } from "./admin-ui";
import { permissionNotice } from "@/platform/mail/permission";
import { PROVINCES, senderFirstName } from "@/platform/outreach-settings";
import type { ViewProps } from "./views";

type Lane = {
  id: string;
  name: string;
  niches: string;
  areas: string[];
  extraAreas: string;
  mailboxIds: string[];
  replyTo: string;
  subject: string;
  body: string;
  stats: { sent: number; replies: number; queued: number };
};

const split = (value: string) =>
  value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
const newId = () => `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const hours = Array.from({ length: 25 }, (_, hour) => hour);
const isProvince = (area: string) => PROVINCES.some((item) => item.toLowerCase() === area.toLowerCase());

function blankLane(businessName: string, index: number): Lane {
  return {
    id: newId(),
    name: `Campaign ${index + 1}`,
    niches: "",
    areas: [],
    extraAreas: "",
    mailboxIds: [],
    replyTo: "",
    subject: "Quick question for {{company}}",
    body: `Hi {{company}} team,\n\nI'm {{sender}} from ${businessName}. We {{what you offer, in one sentence}}.\n\nWould it help if I sent you more details? Just reply YES.`,
    stats: { sent: 0, replies: 0, queued: 0 },
  };
}

function fromSaved(item: Record<string, unknown>): Lane {
  const areas = Array.isArray(item.areas) ? item.areas.map(String) : [];
  const stats = object(item.stats);
  return {
    id: text(item.id, newId()),
    name: text(item.name, "Campaign"),
    niches: Array.isArray(item.niches) ? item.niches.map(String).join("\n") : "",
    areas: areas.filter(isProvince),
    extraAreas: areas.filter((area) => !isProvince(area)).join(", "),
    mailboxIds: Array.isArray(item.mailboxIds) ? item.mailboxIds.map(String) : [],
    replyTo: Array.isArray(item.replyTo) ? item.replyTo.map(String).join("\n") : "",
    subject: text(item.subject, ""),
    body: text(item.body, ""),
    stats: { sent: number(stats.sent), replies: number(stats.replies), queued: number(stats.queued) },
  };
}

function placeholdersIn(...content: string[]) {
  return [
    ...new Set(
      [...content.join(" ").matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
        .map((match) => match[1].trim())
        .filter((field) => !["company", "name", "email", "industry", "sender"].includes(field)),
    ),
  ];
}

export function OutreachView({ data, organization, canManage, act, navigate }: ViewProps) {
  const settings = object(data.settings),
    stats = object(data.stats),
    readiness = object(data.readiness),
    business = object(data.business);
  const businessName = text(business.name, organization.name);
  const mailboxes = rows(readiness.mailboxes);
  const [lanes, setLanes] = useState<Lane[]>(() => {
    const saved = rows(settings.lanes).map(fromSaved);
    return saved.length ? saved : [blankLane(businessName, 0)];
  });
  const [open, setOpen] = useState<string[]>(() => (lanes.length === 1 ? [lanes[0].id] : []));
  const [exclude, setExclude] = useState(
    Array.isArray(settings.exclude) ? settings.exclude.map(String).join(", ") : "",
  );
  const [dailyLimit, setDailyLimit] = useState(number(settings.dailyLimit) || 20);
  const [startHour, setStartHour] = useState(
    settings.sendStartHour === undefined ? 8 : number(settings.sendStartHour),
  );
  const [endHour, setEndHour] = useState(number(settings.sendEndHour) || 17);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = settings.enabled === true;
  const lastFind = settings.lastFind ? object(settings.lastFind) : null;
  const liveBoxes = mailboxes.filter((box) => box.status === "LIVE_ENABLED");

  const change = (id: string, patch: Partial<Lane>) =>
    setLanes((current) => current.map((lane) => (lane.id === id ? { ...lane, ...patch } : lane)));
  const toggleOpen = (id: string) =>
    setOpen((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const addLane = (copy?: Lane) => {
    const lane = copy
      ? { ...copy, id: newId(), name: `${copy.name} (copy)`, stats: { sent: 0, replies: 0, queued: 0 } }
      : blankLane(businessName, lanes.length);
    setLanes((current) => [...current, lane]);
    setOpen((current) => [...current, lane.id]);
  };

  const payload = () => ({
    lanes: lanes.map((lane, index) => ({
      id: lane.id,
      name: lane.name.trim() || `Campaign ${index + 1}`,
      niches: split(lane.niches).filter((item) => item.length >= 2),
      areas: [...lane.areas, ...split(lane.extraAreas)].filter((item) => item.length >= 2),
      mailboxIds: lane.mailboxIds.filter((id) => mailboxes.some((box) => text(box.id) === id)),
      replyTo: split(lane.replyTo).map((value) => value.toLowerCase()),
      subject: lane.subject.trim(),
      body: lane.body,
    })),
    exclude: split(exclude).filter((item) => item.length >= 2),
    dailyLimit,
    sendStartHour: startHour,
    sendEndHour: endHour,
  });
  async function send(action: "save" | "start" | "pause") {
    setBusy(true);
    setError("");
    try {
      if (action === "pause") await act("outreach", { action });
      else {
        const body = payload();
        for (const lane of body.lanes) {
          const bad = lane.replyTo.find((value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
          if (bad) throw new Error(`In "${lane.name}": "${bad}" isn't a valid email address.`);
        }
        if (startHour >= endHour) throw new Error("Sending must start before it ends.");
        await act("outreach", { action, ...body });
      }
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const warnings: { text: string; action?: { label: string; onClick?: () => void; href?: string } }[] = [];
  if (!readiness.plan)
    warnings.push({
      text: `The client's plan isn't active (${text(readiness.planDetail)}). Nothing sends until it's renewed.`,
      action: { label: "Manage plan", href: "/admin?section=clients" },
    });
  if (!readiness.inbox)
    warnings.push({
      text: "No sending inbox is switched on yet. Businesses are still found, but nothing sends until one is connected.",
      action: { label: "Connect inbox", onClick: () => navigate("mailboxes") },
    });
  if (!readiness.emailChecker)
    warnings.push({
      text: "Email checking isn't set up for your agency yet. Found emails wait here until it is, so the sending domain isn't hurt by bounces.",
    });
  if (!readiness.liveSending)
    warnings.push({ text: "Live sending is switched off on the platform, so emails queue but don't go out." });

  const pad = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
  const perDay = Math.max(1, liveBoxes.length) * dailyLimit;

  return (
    <div className="ow">
      <SectionHeading
        title="Email outreach"
        detail={`Finds businesses in your niches, emails them about ${businessName} and sends every reply to your sales reps.`}
        action={
          <div className="ow-head-actions">
            <span className={`ow-state${running ? " is-on" : ""}`}>
              <i />
              {running ? "Running" : settings.approvedAt ? "Paused" : "Not started"}
            </span>
            {canManage &&
              (running ? (
                <button disabled={busy} onClick={() => void send("pause")}>
                  <Pause size={15} /> Pause
                </button>
              ) : (
                <button className="primary" disabled={busy} onClick={() => void send("start")}>
                  <Play size={15} /> Start outreach
                </button>
              ))}
          </div>
        }
      />
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="ow-warnings">
          {warnings.map((warning) => (
            <li key={warning.text}>
              <CircleAlert size={16} />
              <span>{warning.text}</span>
              {warning.action?.href ? (
                <a className="button" href={warning.action.href}>
                  {warning.action.label}
                </a>
              ) : warning.action ? (
                <button onClick={warning.action.onClick}>{warning.action.label}</button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Stats>
        <Stat label="Businesses found" value={stats.found} hint={`${compact(stats.waitingEmail)} websites still to read`} />
        <Stat label="Emails found" value={stats.withEmail} hint={`${compact(stats.checked)} checked and ready`} />
        <Stat label="Emails sent" value={stats.sent} hint={`${compact(stats.queued)} waiting to go out`} />
        <Stat label="Replies" value={stats.replies} hint={`${percent(stats.replies, stats.sent)} reply rate`} />
        <Stat
          label="Said yes"
          value={stats.saidYes}
          tone={number(stats.saidYes) > 0 ? "good" : undefined}
          hint="Replied YES and can get more emails"
        />
        <Stat
          label="Bounced"
          value={stats.bounced}
          tone={number(stats.sent) > 20 && number(stats.bounced) / number(stats.sent) > 0.03 ? "bad" : undefined}
          hint={`${percent(stats.bounced, stats.sent)} of sent · pauses at 3%`}
        />
      </Stats>

      <div className="adm-grid adm-grid-main">
        <Panel className="adm-chart-panel">
          <TrendChart
            values={rows(data.series)}
            title="Sent and replies"
            description="Each day, the last 30 days."
            metrics={[
              { key: "sent", label: "Emails sent" },
              { key: "replies", label: "Replies" },
            ]}
          />
        </Panel>
        <Panel title="What's happening">
          <ol className="ow-flow">
            <li>
              <b>Find businesses</b>
              <span>
                {lastFind
                  ? `${lastFind.error ? "Last search hit a problem. " : ""}Last search: ${compact(lastFind.added)} new ${text(lastFind.niche).toLowerCase()} businesses in ${text(lastFind.area)} (${date(lastFind.at, true)}).`
                  : running
                    ? "The first search runs within a few minutes."
                    : "Starts when you start outreach."}
                {running && settings.nextFindAt ? ` Next search ${date(settings.nextFindAt, true)}.` : ""}
              </span>
            </li>
            <li>
              <b>Read their websites for an email</b>
              <span>{compact(stats.waitingEmail)} websites waiting · {compact(stats.withEmail)} emails found so far</span>
            </li>
            <li>
              <b>Check each email</b>
              <span>
                {compact(stats.waitingCheck)} waiting
                {!readiness.emailChecker ? " (needs email checking set up)" : ""} · {compact(stats.checked)} ready
              </span>
            </li>
            <li>
              <b>Send</b>
              <span>
                Up to {compact(perDay)} a day ({compact(dailyLimit)} per inbox), weekdays {pad(startHour)}–{pad(endHour)} ·{" "}
                {compact(stats.queued)} queued
              </span>
            </li>
            <li>
              <b>Replies go to your sales reps</b>
              <span>
                {lanes.some((lane) => split(lane.replyTo).length)
                  ? lanes
                      .filter((lane) => split(lane.replyTo).length)
                      .map((lane) => `${lanes.length > 1 ? `${lane.name}: ` : ""}${split(lane.replyTo).join(", ")}`)
                      .join(" · ")
                  : "No sales reps added yet"}
              </span>
            </li>
          </ol>
        </Panel>
      </div>

      <Panel
        title="Campaigns"
        detail={
          running
            ? "Changes apply to emails that haven't gone out yet."
            : "Each campaign emails one kind of business in the provinces you pick, from the inboxes you pick, and sends replies to its own reps."
        }
        action={
          canManage && (
            <button disabled={busy} onClick={() => void send("save")}>
              <Save size={15} /> Save
            </button>
          )
        }
      >
        <div className="ow-lanes">
          {lanes.map((lane, index) => {
            const isOpen = open.includes(lane.id);
            const n = index + 1;
            const where = [...lane.areas, ...split(lane.extraAreas)];
            const reps = split(lane.replyTo);
            const placeholders = placeholdersIn(lane.subject, lane.body);
            const senderBox = mailboxes.find((box) => lane.mailboxIds.includes(text(box.id))) ?? liveBoxes[0] ?? mailboxes[0];
            const sample = senderBox ? senderFirstName(text(senderBox.email)) : "Gary";
            const fill = (value: string) =>
              value.replace(/\{\{\s*company\s*\}\}/g, "Example Workshop").replace(/\{\{\s*sender\s*\}\}/g, sample);
            return (
              <section className={`ow-lane${isOpen ? " is-open" : ""}`} key={lane.id}>
                <header>
                  <button
                    className="ow-lane-toggle"
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? "Close" : "Open"} ${lane.name || `campaign ${n}`}`}
                    onClick={() => toggleOpen(lane.id)}
                  >
                    <ChevronDown size={16} />
                    <span>
                      <b>{lane.name || `Campaign ${n}`}</b>
                      <small>
                        {split(lane.niches).join(", ") || "No niche yet"} ·{" "}
                        {where.length ? where.join(", ") : "All of South Africa"} ·{" "}
                        {reps.length ? `replies to ${reps.join(", ")}` : "no reps yet"}
                      </small>
                    </span>
                  </button>
                  <span className="ow-lane-stats">
                    {compact(lane.stats.sent)} sent · {compact(lane.stats.replies)} replies
                  </span>
                  {canManage && (
                    <span className="ow-lane-tools">
                      <button className="icon-button" aria-label={`Copy campaign ${n}`} title="Copy" onClick={() => addLane(lane)}>
                        <Copy size={15} />
                      </button>
                      {lanes.length > 1 && (
                        <button
                          className="icon-button"
                          aria-label={`Remove campaign ${n}`}
                          title="Remove"
                          onClick={() => setLanes((current) => current.filter((item) => item.id !== lane.id))}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </span>
                  )}
                </header>
                {isOpen && (
                  <div className="ow-setup">
                    <div className="ow-col">
                      <label>
                        Campaign name
                        <input
                          aria-label={`Campaign ${n} name`}
                          value={lane.name}
                          maxLength={80}
                          disabled={!canManage}
                          onChange={(event) => change(lane.id, { name: event.target.value })}
                        />
                      </label>
                      <label>
                        Who to email
                        <textarea
                          aria-label={`Campaign ${n} niches`}
                          rows={2}
                          placeholder={"forklift repair\nforklift hire"}
                          value={lane.niches}
                          disabled={!canManage}
                          onChange={(event) => change(lane.id, { niches: event.target.value })}
                        />
                        <em>One kind of business per line, up to 6.</em>
                      </label>
                      <fieldset className="ow-provinces">
                        <legend>Where</legend>
                        {PROVINCES.map((province) => (
                          <label key={province} className="ow-check">
                            <input
                              type="checkbox"
                              aria-label={`Campaign ${n} ${province}`}
                              checked={lane.areas.includes(province)}
                              disabled={!canManage}
                              onChange={(event) =>
                                change(lane.id, {
                                  areas: event.target.checked
                                    ? [...lane.areas, province]
                                    : lane.areas.filter((item) => item !== province),
                                })
                              }
                            />
                            {province}
                          </label>
                        ))}
                        <input
                          aria-label={`Campaign ${n} other areas`}
                          placeholder="Other towns, e.g. George, Durban"
                          value={lane.extraAreas}
                          disabled={!canManage}
                          onChange={(event) => change(lane.id, { extraAreas: event.target.value })}
                        />
                        <em>Tick none for all of South Africa. The province comes from each branch&apos;s own address.</em>
                      </fieldset>
                      <fieldset className="ow-provinces">
                        <legend>Send from</legend>
                        {mailboxes.length ? (
                          mailboxes.map((box) => (
                            <label key={text(box.id)} className="ow-check ow-check-wide">
                              <input
                                type="checkbox"
                                aria-label={`Campaign ${n} inbox ${text(box.email)}`}
                                checked={lane.mailboxIds.includes(text(box.id))}
                                disabled={!canManage}
                                onChange={(event) =>
                                  change(lane.id, {
                                    mailboxIds: event.target.checked
                                      ? [...lane.mailboxIds, text(box.id)]
                                      : lane.mailboxIds.filter((item) => item !== text(box.id)),
                                  })
                                }
                              />
                              {text(box.email)}
                              <Badge value={box.status} />
                            </label>
                          ))
                        ) : (
                          <p className="ow-note is-warn">No inbox connected yet.</p>
                        )}
                        <button className="ow-add" onClick={() => navigate("mailboxes")}>
                          <Plus size={15} /> {mailboxes.length ? "Manage inboxes" : "Connect an inbox"}
                        </button>
                        <em>Tick none to use every live inbox. {"{{sender}}"} becomes the inbox&apos;s first name.</em>
                      </fieldset>
                      <label>
                        Replies go to
                        <textarea
                          aria-label={`Campaign ${n} sales rep emails`}
                          rows={2}
                          placeholder={"sales@client.co.za\nrep@client.co.za"}
                          value={lane.replyTo}
                          disabled={!canManage}
                          onChange={(event) => change(lane.id, { replyTo: event.target.value })}
                        />
                        <em>The client&apos;s sales reps, one per line, up to 5. Every reply lands in their inbox and is counted here.</em>
                      </label>
                    </div>
                    <div className="ow-col ow-col-tight">
                      <label>
                        Subject
                        <input
                          aria-label={`Campaign ${n} subject`}
                          value={lane.subject}
                          disabled={!canManage}
                          maxLength={200}
                          onChange={(event) => change(lane.id, { subject: event.target.value })}
                        />
                      </label>
                      <label>
                        Message
                        <textarea
                          aria-label={`Campaign ${n} message`}
                          rows={10}
                          value={lane.body}
                          disabled={!canManage}
                          maxLength={5000}
                          onChange={(event) => change(lane.id, { body: event.target.value })}
                        />
                        <em>Use {"{{company}}"} for their name and {"{{sender}}"} for the sending person&apos;s first name.</em>
                      </label>
                      {placeholders.length > 0 && (
                        <p className="ow-note is-warn">
                          Replace {placeholders.map((field) => `{{${field}}}`).join(", ")} with real words before starting.
                        </p>
                      )}
                      <div className="ow-preview">
                        <span>What a business receives</span>
                        <b>{fill(lane.subject)}</b>
                        <pre>{`${fill(lane.body).trimEnd()}\n\n${permissionNotice(businessName)}`}</pre>
                      </div>
                      <p className="ow-note">
                        The last paragraph is added by law (POPIA): it&apos;s a one-time email, and a YES reply records
                        that the business agreed to hear more.
                      </p>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
          {canManage && lanes.length < 8 && (
            <button className="ow-add" onClick={() => addLane()}>
              <Plus size={15} /> Add campaign
            </button>
          )}
        </div>
        <div className="ow-general">
          <label>
            Skip businesses whose name includes
            <input
              aria-label="Skip words"
              placeholder="training, battery, racking"
              value={exclude}
              disabled={!canManage}
              onChange={(event) => setExclude(event.target.value)}
            />
            <em>Comma-separated. Use it for businesses that never fit, like training schools.</em>
          </label>
          <label>
            Emails per inbox per day
            <input
              type="number"
              aria-label="Emails per inbox per day"
              min={1}
              max={50}
              value={dailyLimit}
              disabled={!canManage}
              onChange={(event) => setDailyLimit(Number(event.target.value))}
            />
            <em>20 or fewer keeps each inbox out of spam. New inboxes start lower and build up.</em>
          </label>
          <label>
            Sending hours (weekdays)
            <span className="ow-hours">
              <select aria-label="Start sending at" value={startHour} disabled={!canManage} onChange={(event) => setStartHour(Number(event.target.value))}>
                {hours.slice(0, 24).map((hour) => (
                  <option key={hour} value={hour}>
                    {pad(hour)}
                  </option>
                ))}
              </select>
              to
              <select aria-label="Stop sending at" value={endHour} disabled={!canManage} onChange={(event) => setEndHour(Number(event.target.value))}>
                {hours.slice(1).map((hour) => (
                  <option key={hour} value={hour}>
                    {pad(hour)}
                  </option>
                ))}
              </select>
            </span>
            <em>South African time.</em>
          </label>
        </div>
        {canManage && (
          <div className="ow-actions">
            <button disabled={busy} onClick={() => void send("save")}>
              <Save size={15} /> Save
            </button>
            {!running && (
              <button className="primary" disabled={busy} onClick={() => void send("start")}>
                <Play size={15} /> Save and start outreach
              </button>
            )}
          </div>
        )}
      </Panel>

      <Panel
        title="Latest replies"
        detail="Each of these also went straight to your sales reps."
        action={
          <button className="text-button" onClick={() => navigate("inbox")}>
            All replies
          </button>
        }
      >
        {rows(data.replies).length ? (
          <ul className="ow-replies">
            {rows(data.replies).map((reply) => (
              <li key={text(reply.id)}>
                <div>
                  <b>{text(reply.company, text(reply.from))}</b>
                  {reply.saidYes === true && <span className="ow-yes">Said yes</span>}
                  <small>{date(reply.at, true)}</small>
                </div>
                <p>{text(reply.preview, "")}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted adm-panel-copy">No replies yet. They show up here as soon as they arrive.</p>
        )}
      </Panel>
    </div>
  );
}

