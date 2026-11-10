"use client";
import { useCallback, useEffect, useState } from "react";
import { Download, Phone, Plus, RefreshCw, X } from "lucide-react";
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
  Empty,
  Loading,
  SectionHeading,
  type Dialog,
  type Field,
} from "./primitives";

export default function CallCentre() {
  const [data, setData] = useState<RecordValue>({});
  const [workspace, setWorkspace] = useState("");
  const [days, setDays] = useState("30");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [login, setLogin] = useState<RecordValue | null>(null);
  const refresh = useCallback(async () => {
    setData(
      await api(
        `/api/platform/admin/call-centre?days=${days}${workspace ? `&workspaceId=${encodeURIComponent(workspace)}` : ""}`,
      ),
    );
  }, [days, workspace]);
  useEffect(() => {
    void refresh().catch((problem) => setError(problem.message));
  }, [refresh]);
  const businesses = rows(data.businesses),
    callers = rows(data.callers),
    totals = object(data.totals);
  async function act(input: RecordValue) {
    const result = await api("/api/platform/admin/call-centre", "POST", input);
    setNotice(text(result.message));
    setError("");
    if (result.login) setLogin(object(result.login));
    await refresh();
    return result;
  }
  function callerForm(caller?: RecordValue) {
    const memberships = rows(caller?.memberships);
    const assignmentFields: Field[] = businesses.map((business, index) => ({
      name: `business${index}`,
      label: `Assign ${text(business.name)}`,
      type: "checkbox",
      value: memberships.some(
        (row) => row.workspaceId === business.workspaceId,
      ),
    }));
    setDialog({
      title: caller
        ? `Business access · ${text(caller.name)}`
        : "Create caller login",
      detail:
        "Callers get a Monettic calling queue, call outcomes and meeting bookings. Connected websites and email outreach stay in your admin dashboard.",
      fields: [
        ...(!caller
          ? [
              { name: "name", label: "Caller name", required: true },
              {
                name: "email",
                label: "Login email",
                type: "email" as const,
                required: true,
              },
            ]
          : []),
        ...assignmentFields,
      ],
      submit: (fields) =>
        act({
          action: caller ? "assign-caller" : "create-caller",
          ...(caller
            ? { userId: caller.id }
            : { name: fields.name, email: fields.email }),
          assignments: businesses.flatMap((business, index) =>
            fields[`business${index}`]
              ? [
                  {
                    workspaceId: business.workspaceId,
                    canSend: false,
                  },
                ]
              : [],
          ),
        }),
    });
  }
  function configureProspecting(business: RecordValue) {
    const config = object(business.prospecting);
    const categories = Array.isArray(config.categories)
      ? config.categories
      : ["ALL"];
    const cities = Array.isArray(config.cities)
      ? config.cities
      : ["South Africa"];
    setDialog({
      title: `Automatic leads · ${text(business.name)}`,
      detail:
        "Prepare business listings with public phone numbers in your chosen niches and areas. Include businesses with websites or limit research to those with no website listed. The local automation computer must stay online. Daily and queue limits prevent repeated imports.",
      submitLabel: "Save automatic lead settings",
      fields: [
        {
          name: "enabled",
          label: "Automatically prepare calling leads",
          type: "checkbox",
          value: Boolean(config.enabled),
        },
        {
          name: "categories",
          label: "Business types (comma-separated, or All)",
          required: true,
          value: categories.join(", "),
          placeholder: "All, or plumbers, dentists, restaurants",
        },
        {
          name: "cities",
          label: "Areas (one per line, or South Africa)",
          type: "textarea",
          required: true,
          value: cities.join("\n"),
          placeholder: "South Africa",
        },
        {
          name: "dailyLimit",
          label: "Maximum new leads per day (1–250)",
          type: "number",
          required: true,
          value: config.dailyLimit || 30,
        },
        {
          name: "dailyCallTarget",
          label: "Daily call target (1–500)",
          type: "number",
          required: true,
          value: config.dailyCallTarget || 100,
        },
        {
          name: "requireMissingWebsite",
          label: "Only collect businesses with no website listed",
          type: "checkbox",
          value: config.requireMissingWebsite !== false,
        },
        {
          name: "maxQueue",
          label: "Maximum ready leads (10–250)",
          type: "number",
          required: true,
          value: config.maxQueue || 150,
        },
        {
          name: "meetingHostId",
          label: "Meeting host",
          type: "select",
          required: true,
          value: config.meetingHostId || rows(data.meetingHosts)[0]?.id,
          options: rows(data.meetingHosts).map((host) => ({
            value: text(host.id),
            label: `${text(host.name)} · ${text(host.email)}`,
          })),
        },
        {
          name: "calendlyUrl",
          label: "Calendly booking link (optional)",
          value: text(config.calendlyUrl, ""),
          placeholder: "https://calendly.com/your-name/30min",
        },
        {
          name: "notifyAdminEmail",
          label:
            "Also email administrators when a meeting is booked or updated",
          type: "checkbox",
          value: config.notifyAdminEmail !== false,
        },
      ],
      submit: (fields) =>
        act({
          action: "configure-prospecting",
          workspaceId: business.workspaceId,
          enabled: Boolean(fields.enabled),
          categories: String(fields.categories)
            .split(/[,;\n]+/)
            .map((value) => value.trim())
            .filter(Boolean),
          cities: String(fields.cities)
            .split(/\n+/)
            .map((value) => value.trim())
            .filter(Boolean),
          dailyLimit: Number(fields.dailyLimit),
          dailyCallTarget: Number(fields.dailyCallTarget),
          requireMissingWebsite: Boolean(fields.requireMissingWebsite),
          maxQueue: Number(fields.maxQueue),
          meetingHostId: fields.meetingHostId,
          calendlyUrl: String(fields.calendlyUrl || ""),
          notifyAdminEmail: Boolean(fields.notifyAdminEmail),
        }),
    });
  }
  function connectVoice(business: RecordValue) {
    setDialog({
      title: `Browser calling · ${text(business.name)}`,
      detail: `Use an existing Twilio Voice account and authorised calling number. Set the TwiML app Voice URL to ${text(object(business.webhooks).outgoing)} using POST. This connection does not buy a number or make a call. A normal Vodacom SIM uses the phone dialler instead.`,
      fields: [
        { name: "accountSid", label: "Twilio Account SID", required: true },
        {
          name: "authToken",
          label: "Twilio Auth Token",
          type: "password",
          required: true,
        },
        { name: "apiKeySid", label: "Twilio API Key SID", required: true },
        {
          name: "apiKeySecret",
          label: "Twilio API Key Secret",
          type: "password",
          required: true,
        },
        {
          name: "applicationSid",
          label: "TwiML Application SID",
          required: true,
        },
        {
          name: "fromNumber",
          label: "Authorised caller number (+ country code)",
          required: true,
        },
        {
          name: "ownershipConfirmed",
          label:
            "I control this account and am authorised to use this calling number",
          type: "checkbox",
          required: true,
        },
      ],
      submitLabel: "Verify and connect",
      submit: (fields) =>
        act({
          ...fields,
          action: "connect-voice",
          workspaceId: business.workspaceId,
        }),
    });
  }
  function addBusiness() {
    setDialog({
      title: "Connect a business website",
      fields: [
        { name: "name", label: "Business name", required: true },
        {
          name: "websiteUrl",
          label: "Website URL",
          type: "url",
          required: true,
        },
      ],
      submit: async (fields) => {
        const result = await api("/api/platform/organizations", "POST", {
          ...fields,
          timezone: "Africa/Johannesburg",
        });
        setNotice(
          "Business connected. You can now assign it to a caller and complete its profile setup.",
        );
        await refresh();
        return result;
      },
    });
  }
  const businessName = (id: unknown) =>
    text(businesses.find((row) => row.workspaceId === id)?.name);
  const callerName = (id: unknown) =>
    text(callers.find((row) => row.id === id)?.name, "Administrator");
  function downloadLogin() {
    if (!login) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          `Monettic caller login\nLogin: ${text(login.url)}\nDashboard: ${window.location.origin}/caller\nEmail: ${text(login.email)}\nPassword: ${text(login.password)}\n\nKeep these details private.\n`,
        ],
        { type: "text/plain" },
      ),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "monettic-caller-login.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="call-centre">
      <SectionHeading
        title="Call centre"
        detail="Assign callers, manage their business access and follow real sales activity."
        action={
          <div className="caller-actions">
            <a className="button" href="/caller">
              <Phone size={15} /> Open caller dashboard
            </a>
            <button onClick={addBusiness}>
              <Plus size={15} /> Connect website
            </button>
            <button className="primary" onClick={() => callerForm()}>
              <Plus size={15} /> Create caller
            </button>
          </div>
        }
      />
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert" role="status">
          {notice}
        </div>
      )}
      <div className="caller-toolbar">
        <select
          aria-label="Call centre business filter"
          value={workspace}
          onChange={(event) => setWorkspace(event.target.value)}
        >
          <option value="">All businesses</option>
          {businesses.map((business) => (
            <option
              key={text(business.workspaceId)}
              value={text(business.workspaceId)}
            >
              {text(business.name)}
            </option>
          ))}
        </select>
        <select
          aria-label="Call centre reporting period"
          value={days}
          onChange={(event) => setDays(event.target.value)}
        >
          {[7, 30, 90, 365].map((value) => (
            <option key={value} value={value}>
              Last {value} days
            </option>
          ))}
        </select>
        <button
          className="icon-button"
          aria-label="Refresh call centre"
          onClick={() =>
            void refresh().catch((problem) => setError(problem.message))
          }
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {!data.callers ? (
        <Loading />
      ) : (
        <>
          <div className="caller-metrics">
            {[
              ["Phone calls logged", totals.phoneLogs],
              ["Browser call attempts", totals.browserAttempts],
              ["Browser calls connected", totals.browserConnected],
              ["Leads added", totals.leadsAdded],
              ["Qualified prospects", totals.qualified],
              ["Meetings booked", totals.bookings],
            ].map(([name, amount]) => (
              <div className="surface" key={String(name)}>
                <span>{String(name)}</span>
                <strong>{number(amount).toLocaleString()}</strong>
              </div>
            ))}
          </div>
          <section className="surface">
            <SectionHeading
              title="Caller performance & access"
              detail="Phone logs are self-reported. Browser attempts and connections require provider events. Counts use the selected reporting period."
            />
            {callers.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Caller</th>
                      <th>Business access</th>
                      <th>Phone logs</th>
                      <th>Browser attempts / connected</th>
                      <th>Leads / qualified</th>
                      <th>Bookings</th>
                      <th>Access</th>
                    </tr>
                  </thead>
                  <tbody>
                    {callers.map((caller) => (
                      <tr key={text(caller.id)}>
                        <td>
                          <b>{text(caller.name)}</b>
                          <small>{text(caller.email)}</small>
                          <Badge
                            value={caller.disabledAt ? "SUSPENDED" : "ACTIVE"}
                          />
                        </td>
                        <td>
                          {rows(caller.memberships).map((member) => (
                            <small key={text(member.workspaceId)}>
                              {businessName(member.workspaceId)}
                            </small>
                          ))}
                        </td>
                        <td>{number(caller.phoneLogs)}</td>
                        <td>
                          {number(caller.browserAttempts)} /{" "}
                          {number(caller.browserConnected)}
                        </td>
                        <td>
                          {number(caller.leadsAdded)} /{" "}
                          {number(caller.qualified)}
                        </td>
                        <td>{number(caller.bookings)}</td>
                        <td>
                          <div className="caller-actions">
                            <button onClick={() => callerForm(caller)}>
                              Edit access
                            </button>
                            <button
                              onClick={() =>
                                setDialog({
                                  title: caller.disabledAt
                                    ? "Enable caller access"
                                    : "Suspend caller access",
                                  detail: caller.disabledAt
                                    ? "The caller will be able to sign in again."
                                    : "Existing sessions will be invalidated and their active email campaigns paused.",
                                  fields: [],
                                  submit: () =>
                                    act({
                                      action: "caller-status",
                                      userId: caller.id,
                                      enabled: Boolean(caller.disabledAt),
                                    }),
                                })
                              }
                            >
                              {caller.disabledAt ? "Enable" : "Suspend"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="Add your first caller"
                detail="Create a separate login and choose the business websites they can work on."
              />
            )}
          </section>
          <section className="surface">
            <SectionHeading
              title="Automatic calling leads"
              detail="Any business type across South Africa or your chosen areas. Public listing evidence is saved with each prospect; the caller confirms website needs during the conversation."
            />
            {businesses.map((business) => (
              <article
                className="caller-booking"
                key={text(business.workspaceId)}
              >
                <div>
                  <h3>{text(business.name)}</h3>
                  <Badge
                    value={
                      object(business.prospecting).enabled ? "ACTIVE" : "PAUSED"
                    }
                  />
                  <p>
                    {object(business.prospecting).enabled
                      ? `Up to ${number(object(business.prospecting).dailyLimit)} new prospects per day · ${number(object(business.prospecting).maxQueue)} ready lead limit`
                      : "Automatic prospecting has not been enabled."}
                  </p>
                  {!!object(business.prospecting).lastRunAt && (
                    <small>
                      Last search:{" "}
                      {date(object(business.prospecting).lastRunAt, true)} ·{" "}
                      {label(object(business.prospecting).lastStatus)}
                    </small>
                  )}
                </div>
                <button onClick={() => configureProspecting(business)}>
                  Configure automatic leads
                </button>
              </article>
            ))}
            {rows(data.prospectSearches).length > 0 && (
              <details>
                <summary>Recent prospect searches</summary>
                {rows(data.prospectSearches).map((run) => (
                  <p key={text(run.id)}>
                    <b>{businessName(run.workspaceId)}</b> ·{" "}
                    {date(run.createdAt, true)} · {label(run.status)} ·{" "}
                    {text(run.summary || run.error, "Research queued")}
                  </p>
                ))}
              </details>
            )}
          </section>
          <section className="surface">
            <SectionHeading
              title="Calling connections"
              detail="Vodacom SIM calls use a phone handoff. To call through the browser, connect an existing voice account per business."
            />
            {businesses.map((business) => (
              <article
                key={text(business.workspaceId)}
                className="caller-booking"
              >
                <div>
                  <h3>{text(business.name)}</h3>
                  <p>{text(business.websiteUrl)}</p>
                  <Badge
                    value={
                      object(business.voice).enabled
                        ? "CONNECTED"
                        : "NOT_CONNECTED"
                    }
                  />
                  {!!object(business.voice).fromNumber && (
                    <p>{text(object(business.voice).fromNumber)}</p>
                  )}
                  <details>
                    <summary>Provider webhook URLs</summary>
                    <p className="caller-url">
                      Voice URL (POST):{" "}
                      {text(object(business.webhooks).outgoing)}
                    </p>
                    <p className="caller-url">
                      Status URL (POST):{" "}
                      {text(object(business.webhooks).status)}
                    </p>
                    <a
                      href="https://www.twilio.com/docs/voice/sdks/javascript/get-started"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Twilio browser calling setup
                    </a>
                  </details>
                </div>
                <div className="caller-actions">
                  <button onClick={() => connectVoice(business)}>
                    {business.voice
                      ? "Update connection"
                      : "Connect browser calling"}
                  </button>
                  {!!business.voice && (
                    <button
                      onClick={() =>
                        void act({
                          action: "pause-voice",
                          workspaceId: business.workspaceId,
                          enabled: !object(business.voice).enabled,
                        }).catch((problem) => setError(problem.message))
                      }
                    >
                      {object(business.voice).enabled
                        ? "Pause calling"
                        : "Enable calling"}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </section>
          <section className="surface">
            <SectionHeading
              title="Recent calls"
              detail="Up to 200 calls in the reporting period. Conversation notes are visible to administrators."
            />
            {rows(data.calls).length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Caller / business</th>
                      <th>Prospect</th>
                      <th>Call source</th>
                      <th>Status / outcome</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows(data.calls).map((call) => (
                      <tr key={text(call.id)}>
                        <td>
                          {callerName(call.callerId)}
                          <small>
                            {businessName(call.workspaceId)} ·{" "}
                            {date(call.createdAt, true)}
                          </small>
                        </td>
                        <td>
                          {text(object(call.lead).company)}
                          <small>{text(call.toNumber)}</small>
                        </td>
                        <td>
                          {call.mode === "PHONE"
                            ? "Phone · caller reported"
                            : "Browser · provider"}
                          <small>
                            {call.mode === "PHONE"
                              ? `${text(call.reportedDurationSeconds)} sec (reported)`
                              : `${text(call.durationSeconds)} sec`}
                          </small>
                        </td>
                        <td>
                          <Badge value={call.status} />
                          <small>{label(call.outcome)}</small>
                        </td>
                        <td className="caller-notes">{text(call.notes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="No calls in this period"
                detail="Real call activity appears as callers work their assigned leads."
              />
            )}
          </section>
          <section className="surface">
            <SectionHeading
              title="Bookings"
              detail="Upcoming and recent appointments. Calendar invitations are downloaded and shared separately."
            />
            {rows(data.bookings).length ? (
              rows(data.bookings).map((booking) => (
                <article key={text(booking.id)} className="caller-booking">
                  <div>
                    <h3>{text(booking.title)}</h3>
                    <p>
                      {text(object(booking.lead).company)} ·{" "}
                      {businessName(booking.workspaceId)}
                    </p>
                    <p>
                      {date(booking.startAt, true)} · Arranged by{" "}
                      {callerName(booking.bookedById)}
                    </p>
                    <Badge value={booking.status} />
                  </div>
                  <a
                    className="button"
                    href={`/api/platform/${booking.workspaceId}/caller/bookings/${booking.id}/calendar`}
                  >
                    Download calendar
                  </a>
                </article>
              ))
            ) : (
              <Empty
                title="No bookings yet"
                detail="Appointments saved by your callers appear here."
              />
            )}
          </section>
        </>
      )}
      {dialog && <ActionDialog dialog={dialog} close={() => setDialog(null)} />}
      {login && (
        <div className="dialog-backdrop">
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label="New caller login"
          >
            <header className="card-heading">
              <h2>Caller login created</h2>
              <button
                className="icon-button"
                aria-label="Close login details"
                onClick={() => setLogin(null)}
              >
                <X size={18} />
              </button>
            </header>
            <p>
              Download these details now and share them privately with your
              caller. The password cannot be retrieved later.
            </p>
            <p>
              Login: <a href={text(login.url)}>{text(login.url)}</a>
            </p>
            <p>Email: {text(login.email)}</p>
            <label>
              Generated password
              <input
                type="password"
                readOnly
                value={text(login.password)}
                onFocus={(event) => event.target.select()}
              />
            </label>
            <button className="primary" onClick={downloadLogin}>
              <Download size={16} /> Download login details
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
