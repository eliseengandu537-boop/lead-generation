"use client";
import { useMemo, useState } from "react";
import {
  CircleAlert,
  Mail,
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
import type { ViewProps } from "./views";

const areas = [
  "South Africa",
  "Gauteng",
  "Western Cape",
  "KwaZulu-Natal",
  "Eastern Cape",
  "Free State",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
  "Johannesburg",
  "Pretoria",
  "Cape Town",
  "Durban",
  "Gqeberha",
  "Bloemfontein",
  "East London",
  "Polokwane",
  "Mbombela",
  "Rustenburg",
  "George",
  "Kimberley",
];
type Niche = { niche: string; area: string };

export function OutreachView({ data, organization, canManage, act, navigate }: ViewProps) {
  const settings = object(data.settings),
    stats = object(data.stats),
    readiness = object(data.readiness),
    business = object(data.business);
  const businessName = text(business.name, organization.name);
  const [niches, setNiches] = useState<Niche[]>(() => {
    const saved = rows(settings.niches).map((item) => ({
      niche: text(item.niche, ""),
      area: text(item.area, ""),
    }));
    return saved.length ? saved : [{ niche: "", area: "Gauteng" }];
  });
  const [subject, setSubject] = useState(
    text(settings.subject, "") || "Quick question for {{company}}",
  );
  const [body, setBody] = useState(
    text(settings.body, "") ||
      `Hi {{company}} team,\n\nI'm {{your name}} from ${businessName}. We {{what you offer, in one sentence}}.\n\nWould it help if I sent you more details? Just reply YES.`,
  );
  const [reps, setReps] = useState(
    Array.isArray(settings.replyTo) ? settings.replyTo.map(String).join("\n") : "",
  );
  const [dailyLimit, setDailyLimit] = useState(number(settings.dailyLimit) || 20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = settings.enabled === true;
  const mailboxes = rows(readiness.mailboxes);
  const lastFind = settings.lastFind ? object(settings.lastFind) : null;
  const repList = reps
    .split(/[\s,;]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const preview = useMemo(
    () =>
      `${body.replace(/\{\{\s*company\s*\}\}/g, "Example Workshop").trimEnd()}\n\n${permissionNotice(businessName)}`,
    [body, businessName],
  );
  const placeholders = [
    ...new Set(
      [...`${subject} ${body}`.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
        .map((match) => match[1].trim())
        .filter((field) => !["company", "name", "email", "industry"].includes(field)),
    ),
  ];
  const payload = () => ({
    niches: niches
      .map((item) => ({ niche: item.niche.trim(), area: item.area.trim() }))
      .filter((item) => item.niche.length >= 2 && item.area.length >= 2),
    replyTo: repList,
    subject: subject.trim(),
    body,
    dailyLimit,
  });
  async function send(action: "save" | "start" | "pause") {
    setBusy(true);
    setError("");
    try {
      if (action === "pause") await act("outreach", { action });
      else {
        const bad = repList.find((value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
        if (bad) throw new Error(`"${bad}" isn't a valid email address.`);
        await act("outreach", { action, ...payload() });
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
      text: "Email checking isn't set up for your agency yet. Found emails wait here until it is, so the client's domain isn't hurt by bounces.",
    });
  if (!readiness.liveSending)
    warnings.push({ text: "Live sending is switched off on the platform, so emails queue but don't go out." });

  const repsSection = (
    <section>
      <h3>
        <span>3</span> Replies go to
      </h3>
      <p className="muted">
        Your client&apos;s sales reps. Every reply lands in their inbox, and it&apos;s counted here.
      </p>
      <textarea
        aria-label="Sales rep emails"
        rows={3}
        placeholder={"sales@client.co.za\nrep@client.co.za"}
        value={reps}
        disabled={!canManage}
        onChange={(event) => setReps(event.target.value)}
      />
      <p className="ow-note">One email per line, up to 5.</p>
    </section>
  );
  const sendSection = (
    <section>
      <h3>
        <span>4</span> Send from
      </h3>
      <p className="muted">The client&apos;s own inbox that the emails come from.</p>
      {mailboxes.length ? (
        <ul className="ow-inboxes">
          {mailboxes.map((box) => (
            <li key={text(box.id)}>
              <Mail size={15} />
              {text(box.email)}
              <Badge value={box.status} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="ow-note is-warn">No inbox connected yet.</p>
      )}
      <button className="ow-add" onClick={() => navigate("mailboxes")}>
        <Plus size={15} /> {mailboxes.length ? "Manage inboxes" : "Connect an inbox"}
      </button>
      <label className="ow-limit">
        Emails per day
        <input
          type="number"
          min={1}
          max={200}
          value={dailyLimit}
          disabled={!canManage}
          onChange={(event) => setDailyLimit(Number(event.target.value))}
        />
        <em>About 20–25 per inbox keeps it out of spam.</em>
      </label>
    </section>
  );

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
                {compact(dailyLimit)} a day, weekdays 08:00–17:00 · {compact(stats.queued)} queued
              </span>
            </li>
            <li>
              <b>Replies go to your sales reps</b>
              <span>{repList.length ? repList.join(", ") : "No sales reps added yet"}</span>
            </li>
          </ol>
        </Panel>
      </div>

      <Panel
        title="Set up"
        detail={running ? "Changes apply to emails that haven't gone out yet." : "Fill this in once, then start outreach."}
        action={
          canManage && (
            <button disabled={busy} onClick={() => void send("save")}>
              <Save size={15} /> Save
            </button>
          )
        }
      >
        <div className="ow-setup">
          <div className="ow-col">
          <section>
            <h3>
              <span>1</span> Who to email
            </h3>
            <p className="muted">The kind of business and where. Add up to 10.</p>
            {niches.map((item, index) => (
              <div className="ow-niche" key={index}>
                <input
                  aria-label={`Niche ${index + 1}`}
                  placeholder="e.g. forklift repair"
                  value={item.niche}
                  disabled={!canManage}
                  onChange={(event) =>
                    setNiches((current) =>
                      current.map((row, position) =>
                        position === index ? { ...row, niche: event.target.value } : row,
                      ),
                    )
                  }
                />
                <span className="ow-in">in</span>
                <input
                  aria-label={`Area for niche ${index + 1}`}
                  list="ow-areas"
                  placeholder="e.g. Gauteng"
                  value={item.area}
                  disabled={!canManage}
                  onChange={(event) =>
                    setNiches((current) =>
                      current.map((row, position) =>
                        position === index ? { ...row, area: event.target.value } : row,
                      ),
                    )
                  }
                />
                {canManage && niches.length > 1 && (
                  <button
                    className="icon-button"
                    aria-label={`Remove niche ${index + 1}`}
                    onClick={() => setNiches((current) => current.filter((_, position) => position !== index))}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
            <datalist id="ow-areas">
              {areas.map((area) => (
                <option key={area} value={area} />
              ))}
            </datalist>
            {canManage && niches.length < 10 && (
              <button
                className="ow-add"
                onClick={() => setNiches((current) => [...current, { niche: "", area: current.at(-1)?.area || "Gauteng" }])}
              >
                <Plus size={15} /> Add another niche
              </button>
            )}
          </section>
          {repsSection}
          {sendSection}
          </div>

          <section className="ow-col">
            <h3>
              <span>2</span> The email
            </h3>
            <p className="muted">
              Each business gets this once. Use {"{{company}}"} for their name.
            </p>
            <label>
              Subject
              <input value={subject} disabled={!canManage} maxLength={200} onChange={(event) => setSubject(event.target.value)} />
            </label>
            <label>
              Message
              <textarea rows={8} value={body} disabled={!canManage} maxLength={5000} onChange={(event) => setBody(event.target.value)} />
            </label>
            {placeholders.length > 0 && (
              <p className="ow-note is-warn">
                Replace {placeholders.map((field) => `{{${field}}}`).join(", ")} with real words before starting.
              </p>
            )}
            <div className="ow-preview">
              <span>What a business receives</span>
              <b>{subject.replace(/\{\{\s*company\s*\}\}/g, "Example Workshop")}</b>
              <pre>{preview}</pre>
            </div>
            <p className="ow-note">
              The last paragraph is added by law (POPIA): it&apos;s a one-time email, and a YES reply
              records that the business agreed to hear more.
            </p>
          </section>
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
