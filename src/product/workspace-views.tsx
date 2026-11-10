"use client";
import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  CreditCard,
  Globe2,
  KeyRound,
  Link2,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { date, label, object, rows, text, type RecordValue } from "./data";
import { Badge, Empty, KeyValues, SectionHeading } from "./primitives";
import { Jobs, type ViewProps } from "./views";

export function BusinessView({ data, act, canManage, openDialog }: ViewProps) {
  const [website, setWebsite] = useState(text(data.websiteUrl, ""));
  const [criteria, setCriteria] = useState(text(data.targetCriteria, ""));
  const [minimumScore, setMinimumScore] = useState(
    Number(object(data.qualificationCriteria).minimumScore ?? 70),
  );
  const [profile, setProfile] = useState<RecordValue>(object(data.profile));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const connections = object(data.connections);
  async function save(approve: boolean) {
    setBusy(true);
    setError("");
    try {
      await act("business", {
        action: "save",
        websiteUrl: website,
        targetCriteria: criteria,
        qualificationCriteria: { minimumScore },
        ...(Object.keys(profile).length ? { profile } : {}),
        approve,
      });
      setNotice(
        approve
          ? "Business profile approved. Your research now has a clear direction."
          : "Business details saved.",
      );
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <SectionHeading
        eyebrow="CONTEXT THAT CONNECTS"
        title="Your business, understood."
        detail="Connect your website so Monettic can understand what you do, who you serve and where your next customers might be."
      />
      <div className="business-layout">
        <div className="surface business-connection">
          <div className="card-heading">
            <span className="feature-icon">
              <Globe2 size={25} />
            </span>
            <Badge
              value={
                data.approved
                  ? "APPROVED"
                  : data.profile
                    ? "NEEDS_REVIEW"
                    : "NOT_CONNECTED"
              }
            />
          </div>
          <h3>Business context</h3>
          <p>
            Your website gives AI a grounded view of your products, services and
            audience. Review the result before using it for prospecting.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save(false);
            }}
          >
            <label>
              Company website
              <input
                required
                type="url"
                placeholder="https://yourbusiness.com"
                value={website}
                disabled={!canManage || busy}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </label>
            <label>
              Who would you like to reach?
              <textarea
                rows={3}
                placeholder="Describe your ideal customer and the areas you serve."
                value={criteria}
                disabled={!canManage || busy}
                onChange={(event) => setCriteria(event.target.value)}
              />
            </label>
            {canManage && (
              <div className="inline-actions">
                <button className="primary" disabled={busy || !website}>
                  Save business details
                  <ArrowRight size={16} />
                </button>
                <button
                  type="button"
                  disabled={busy || !data.websiteUrl}
                  onClick={() =>
                    openDialog({
                      title: "Understand your business website",
                      detail:
                        "Research runs in the background using your connected AI provider. Your review is required before the profile is used for outreach.",
                      fields: [
                        {
                          name: "permissionConfirmed",
                          label:
                            "I am authorized to connect and research this company website.",
                          type: "checkbox",
                          required: true,
                        },
                      ],
                      submitLabel: "Analyze website",
                      submit: (input) =>
                        act("business", { action: "analyze", ...input }),
                    })
                  }
                >
                  <Sparkles size={16} />
                  Analyze website
                </button>
              </div>
            )}
            <label>
              Minimum outreach fit score
              <input
                type="number"
                min={0}
                max={100}
                required
                value={minimumScore}
                disabled={!canManage || busy}
                onChange={(event) =>
                  setMinimumScore(Number(event.target.value))
                }
              />
              <em>
                Leads must meet this score before approved outreach can start.
              </em>
            </label>
          </form>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              {notice}
            </div>
          )}
        </div>
        <aside className="note-card business-context">
          <Sparkles size={27} />
          <h3>
            A little context.
            <br />A lot more relevance.
          </h3>
          <p>
            The better Monettic understands your business, the more specific
            your research and outreach can be.
          </p>
          <ul className="check-list">
            <li>
              <Check size={15} />
              Your actual products and services
            </li>
            <li>
              <Check size={15} />
              Your target customers and markets
            </li>
            <li>
              <Check size={15} />
              Your business evidence and sources
            </li>
            <li>
              <Check size={15} />
              Your approval before activation
            </li>
          </ul>
        </aside>
      </div>
      {Object.keys(profile).length ? (
        <div className="surface section-space">
          <div className="card-heading">
            <div>
              <p className="eyebrow">YOUR BUSINESS, UNDERSTOOD</p>
              <h3>Review your business profile</h3>
            </div>
            <Badge value={data.approved ? "APPROVED" : "NEEDS_REVIEW"} />
          </div>
          <p className="section-detail">
            Check these details against your website. Keep claims specific and
            supported.
          </p>
          <div className="form-grid business-profile">
            {[
              { key: "companyName", title: "Company name" },
              { key: "industry", title: "Industry" },
              { key: "niche", title: "Business niche" },
              { key: "location", title: "Business location" },
              { key: "products", title: "Products", list: true },
              { key: "services", title: "Services", list: true },
              { key: "targetCustomers", title: "Ideal customers", list: true },
              { key: "serviceAreas", title: "Service areas", list: true },
              {
                key: "uniqueSellingPoints",
                title: "What makes you different",
                list: true,
              },
            ].map((field) => (
              <label key={field.key}>
                {field.title}
                <textarea
                  rows={field.list ? 3 : field.key === "description" ? 3 : 1}
                  value={
                    Array.isArray(profile[field.key])
                      ? (profile[field.key] as string[]).join("\n")
                      : text(profile[field.key], "")
                  }
                  disabled={!canManage || busy}
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      [field.key]: field.list
                        ? event.target.value
                            .split("\n")
                            .map((entry) => entry.trim())
                            .filter(Boolean)
                        : event.target.value,
                    })
                  }
                />
                {field.list && <em>One item per line</em>}
              </label>
            ))}
          </div>
          {canManage && (
            <div className="inline-actions">
              <button disabled={busy} onClick={() => void save(false)}>
                Save changes
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void save(true)}
              >
                <ShieldCheck size={16} />
                Save and approve profile
              </button>
            </div>
          )}
        </div>
      ) : null}
      <div className="surface section-space">
        <div className="card-heading">
          <div>
            <p className="eyebrow">RESEARCH CONNECTIONS</p>
            <h3>Power your research and outreach with your own providers.</h3>
          </div>
          <span className="mini-icon">
            <KeyRound size={18} />
          </span>
        </div>
        <div className="provider-status-grid">
          <div>
            <b>Business search</b>
            <p>Brave Search API</p>
            <Badge
              value={
                connections.searchConfigured ? "CONNECTED" : "NOT_CONNECTED"
              }
            />
          </div>
          <div>
            <b>Research & email writing</b>
            <p>{text(connections.aiProvider, "OpenAI")} · {text(connections.aiModel)}</p>
            <Badge
              value={connections.aiConfigured ? "CONNECTED" : "NOT_CONNECTED"}
            />
          </div>
        </div>
        {canManage && (
          <button
            onClick={() =>
              openDialog({
                title: "Connect your research providers",
                detail:
                  "Provider keys are encrypted and remain private to this business workspace. Leave a field blank to keep its existing connection.",
                fields: [
                  {
                    name: "searchApiKey",
                    label: "Brave Search API key",
                    type: "password",
                  },
                  {
                    name: "aiApiKey",
                    label: "Claude / Anthropic or OpenAI API key",
                    type: "password",
                  },
                  {
                    name: "aiModel",
                    label: "AI model (Claude: claude-sonnet-5-5)",
                    value: text(connections.aiModel, "gpt-4.1-mini"),
                  },
                ],
                submitLabel: "Save connections",
                submit: (input) =>
                  act("business", {
                    action: "connection",
                    ...Object.fromEntries(
                      Object.entries(input).filter(([, value]) => value !== ""),
                    ),
                  }),
              })
            }
          >
            <Link2 size={16} />
            Manage research connections
          </button>
        )}
      </div>
      <Jobs items={rows(data.jobs)} />
    </>
  );
}

export function MailboxesView({ data, act, canManage, openDialog }: ViewProps) {
  const items = rows(data.items);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function connect() {
    setBusy(true);
    setError("");
    try {
      const result = await act("mailboxes", { action: "connect" });
      if (typeof result.url === "string") window.location.assign(result.url);
      else
        throw new Error("The email provider did not return a connection link.");
    } catch (problem) {
      setError((problem as Error).message);
      setBusy(false);
    }
  }
  return (
    <>
      <SectionHeading
        eyebrow="YOUR EMAIL. YOUR IDENTITY."
        title="Your sending identity"
        detail="Connect the business email address your customers know. Each business authorizes its own account."
        action={
          canManage && (
            <button
              className="primary"
              disabled={busy || !data.configured}
              onClick={() => void connect()}
            >
              <Plus size={17} />
              {busy ? "Connecting…" : "Connect business email"}
            </button>
          )
        }
      />
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {!data.configured && (
        <div className="alert info">
          <ShieldCheck size={18} />
          <span>
            Business email connection is awaiting the platform’s Google OAuth
            configuration. Your administrator can complete it before accounts
            are connected.
          </span>
        </div>
      )}
      <div className="email-hero surface">
        <div className="email-envelope">
          <Mail size={35} strokeWidth={1.2} />
        </div>
        <div>
          <p className="eyebrow">BUSINESS EMAIL, CONNECTED</p>
          <h3>Your website. Your sender. One business identity.</h3>
          <p>
            Connect Gmail or Google Workspace through secure authorization. Your
            email password is never requested.
          </p>
        </div>
        <span className="secure-badge">
          <ShieldCheck size={15} />
          Secure OAuth
        </span>
      </div>
      {items.length ? (
        <div className="mailbox-grid">
          {items.map((mailbox) => (
            <article className="surface mailbox-card" key={text(mailbox.id)}>
              <div className="card-heading">
                <span className="provider-logo">
                  <Mail size={23} />
                </span>
                <Badge value={mailbox.status} />
              </div>
              <h3>{text(mailbox.email ?? mailbox.fromEmail)}</h3>
              <p>{label(mailbox.provider)} · Your connected business account</p>
              <div className="mailbox-facts">
                <span>
                  Daily sending limit<b>{text(mailbox.dailyLimit)}</b>
                </span>
                <span>
                  Last synchronized<b>{date(mailbox.lastSyncedAt, true)}</b>
                </span>
              </div>
              {canManage && (
                <div className="inline-actions">
                  <button
                    onClick={() =>
                      openDialog({
                        title:
                          mailbox.status === "LIVE_ENABLED"
                            ? "Pause live sending"
                            : "Enable live sending",
                        detail:
                          mailbox.status === "LIVE_ENABLED"
                            ? "This account will stop sending campaign email until you enable it again."
                            : "Approved campaigns can send through this business email account. Confirm your sender identity and domain email configuration are ready.",
                        fields: [
                          {
                            name: "confirmed",
                            label:
                              "I am authorized to use this business account and have reviewed its sending configuration.",
                            type: "checkbox",
                            required: true,
                          },
                        ],
                        submitLabel:
                          mailbox.status === "LIVE_ENABLED"
                            ? "Pause sending"
                            : "Enable sending",
                        submit: () =>
                          act("mailboxes", {
                            action:
                              mailbox.status === "LIVE_ENABLED"
                                ? "disable"
                                : "enable",
                            id: mailbox.id,
                          }),
                      })
                    }
                  >
                    {mailbox.status === "LIVE_ENABLED"
                      ? "Pause sending"
                      : "Enable live sending"}
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Synchronize ${text(mailbox.email)}`}
                    onClick={() =>
                      openDialog({
                        title: "Check for new email",
                        detail:
                          "Mailbox synchronization runs in the background and records replies and delivery feedback.",
                        fields: [],
                        submitLabel: "Synchronize mailbox",
                        submit: () =>
                          act("mailboxes", { action: "sync", id: mailbox.id }),
                      })
                    }
                  >
                    <RefreshCw size={16} />
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="surface section-space">
          <Empty
            title="Bring your own business email."
            detail="Once connected, your outreach comes from the account you authorize for this business. Replies return to the same inbox."
            icon={<Mail size={29} strokeWidth={1.4} />}
            action={
              canManage && (
                <button
                  disabled={!data.configured || busy}
                  onClick={() => void connect()}
                >
                  Connect Gmail / Google Workspace
                  <ArrowRight size={16} />
                </button>
              )
            }
          />
        </div>
      )}
      <div className="trust-strip">
        <span>
          <ShieldCheck size={18} />
          Credentials stay encrypted
        </span>
        <span>
          <Globe2 size={18} />
          Sender matches your business website
        </span>
        <span>
          <CheckCircle2 size={18} />
          Separate campaign approval before outreach
        </span>
      </div>
    </>
  );
}

export function TeamView({ data, act, canManage, openDialog }: ViewProps) {
  const items = rows(data.items);
  const roles = [{ value: "CLIENT_VIEWER", label: "Client portal access" }];
  return (
    <>
      <SectionHeading
        eyebrow="BUILD SOMETHING TOGETHER"
        title="One business. A well-connected team."
        detail="Give clients and their team access to their results portal. Platform administrators manage business operations."
        action={
          canManage && (
            <button
              className="primary"
              onClick={() =>
                openDialog({
                  title: "Add a teammate",
                  detail:
                    "Add someone with an existing verified Monettic account. They will only gain access to this business workspace.",
                  fields: [
                    {
                      name: "email",
                      label: "Team member's email",
                      type: "email",
                      required: true,
                    },
                    {
                      name: "role",
                      label: "Workspace role",
                      type: "select",
                      required: true,
                      value: "CLIENT_VIEWER",
                      options: roles,
                    },
                  ],
                  submitLabel: "Add team member",
                  submit: (input) => act("team", { action: "add", ...input }),
                })
              }
            >
              <Plus size={17} />
              Add teammate
            </button>
          )
        }
      />
      <div className="surface">
        <div className="card-heading">
          <h3>Your team</h3>
          <span className="subtle">{items.length} members</span>
        </div>
        {items.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Team member</th>
                  <th>Email address</th>
                  <th>Role</th>
                  {canManage && <th>Access</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((member, index) => {
                  const user = object(member.user ?? member);
                  return (
                    <tr key={text(member.userId ?? user.id, String(index))}>
                      <td>
                        <div className="business-cell">
                          <span className="company-avatar">
                            {text(user.name, "T").slice(0, 1)}
                          </span>
                          <b>{text(user.name)}</b>
                        </div>
                      </td>
                      <td>{text(user.email)}</td>
                      <td>
                        <Badge value={member.role} />
                      </td>
                      {canManage && (
                        <td>
                          <div className="row-actions">
                            <button
                              className="icon-button"
                              aria-label={`Change role for ${text(user.name)}`}
                              onClick={() =>
                                openDialog({
                                  title: "Update workspace role",
                                  detail: `Change the access ${text(user.name)} has to this business workspace.`,
                                  fields: [
                                    {
                                      name: "role",
                                      label: "Role",
                                      type: "select",
                                      required: true,
                                      value: member.role,
                                      options: roles,
                                    },
                                  ],
                                  submitLabel: "Update role",
                                  submit: (input) =>
                                    act("team", {
                                      action: "update",
                                      userId: member.userId ?? user.id,
                                      ...input,
                                    }),
                                })
                              }
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              className="icon-button danger"
                              aria-label={`Remove ${text(user.name)}`}
                              onClick={() =>
                                openDialog({
                                  title: "Remove workspace access",
                                  detail: `${text(user.name)} will lose access to this business workspace. Their Monettic account remains available.`,
                                  fields: [
                                    {
                                      name: "confirmed",
                                      label:
                                        "Remove this team member's workspace access.",
                                      type: "checkbox",
                                      required: true,
                                    },
                                  ],
                                  submitLabel: "Remove access",
                                  submit: () =>
                                    act("team", {
                                      action: "remove",
                                      userId: member.userId ?? user.id,
                                    }),
                                })
                              }
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="A place for your people."
            detail="Add team members to share leads and manage your business conversations together."
            icon={<Users size={27} />}
          />
        )}
      </div>
      <div className="role-guide">
        <div>
          <ShieldCheck size={21} />
          <h3>Platform administrators</h3>
          <p>
            Manage the business profile, providers, campaigns, team and
            workspace settings.
          </p>
        </div>
        <div>
          <Users size={21} />
          <h3>Client portal members</h3>
          <p>
            View their business leads, campaign progress, conversations and
            results. Setup and sending controls stay with the platform team.
          </p>
        </div>
      </div>
    </>
  );
}

export function BillingView({ data }: ViewProps) {
  const subscription = object(data.subscription);
  const currentPlan = object(subscription.plan);
  const plans = rows(data.plans);
  const usage = Object.fromEntries(
    rows(data.usage).map((entry) => [
      text(entry.kind),
      object(entry._sum).quantity,
    ]),
  );
  return (
    <>
      <SectionHeading
        eyebrow="ROOM FOR YOUR NEXT CHAPTER"
        title="A plan that grows with your business."
        detail="Keep your business allowances and subscription in view."
      />
      <div className="billing-summary surface">
        <span className="feature-icon">
          <CreditCard size={26} />
        </span>
        <div>
          <p className="eyebrow">YOUR CURRENT PLAN</p>
          <h3>
            {text(
              currentPlan.name ?? subscription.planName,
              "No plan assigned",
            )}
          </h3>
          <p>
            {subscription.status
              ? `${label(subscription.status)}${subscription.periodEnd ? ` · Current period ends ${date(subscription.periodEnd)}` : ""}`
              : "Your platform administrator can help you choose a plan."}
          </p>
        </div>
        {subscription.status ? <Badge value={subscription.status} /> : null}
      </div>
      {Object.keys(usage).length > 0 && (
        <div className="usage-grid">
          {Object.entries(usage).map(([key, value]) => (
            <div className="surface" key={key}>
              <span>{label(key.replace(/([a-z])([A-Z])/g, "$1 $2"))}</span>
              <strong>
                {typeof value === "object"
                  ? text(object(value).used ?? object(value).quantity, "0")
                  : text(value, "0")}
              </strong>
              {typeof value === "object" && object(value).limit ? (
                <small>of {text(object(value).limit)} in this period</small>
              ) : (
                <small>Recorded usage</small>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="pricing-grid">
        {plans.map((plan) => (
          <article
            className={`surface plan-card ${plan.id === subscription.planId ? "current" : ""}`}
            key={text(plan.id)}
          >
            <div className="card-heading">
              <p className="eyebrow">{text(plan.name)}</p>
              {plan.id === subscription.planId && <Badge value="CURRENT" />}
            </div>
            <h3>
              {plan.priceMinor === null || plan.priceMinor === undefined
                ? "Let's talk."
                : new Intl.NumberFormat("en-ZA", {
                    style: "currency",
                    currency: text(plan.currency, "ZAR"),
                    maximumFractionDigits: 0,
                  }).format(Number(plan.priceMinor) / 100)}
            </h3>
            <p>
              {plan.priceMinor === null || plan.priceMinor === undefined
                ? "Contact your administrator for pricing."
                : "Per month, for your business."}
            </p>
            <ul className="check-list">
              <li>
                <Check size={15} />
                {text(plan.monthlyProspects)} monthly discoveries
              </li>
              <li>
                <Check size={15} />
                {text(plan.dailyEmails)} daily emails
              </li>
              <li>
                <Check size={15} />
                {text(plan.teamMembers)} team members
              </li>
              {Array.isArray(plan.features) &&
                plan.features.map((feature, index) => (
                  <li key={index}>
                    <Check size={15} />
                    {label(feature)}
                  </li>
                ))}
            </ul>
            <span className="plan-contact">
              Managed by your platform administrator
              <ArrowUpRight size={14} />
            </span>
          </article>
        ))}
      </div>
      {!plans.length && (
        <div className="surface">
          <Empty
            title="Plans are being prepared."
            detail="Your platform administrator can configure subscription tiers and allowances for your business."
            icon={<CreditCard size={28} />}
          />
        </div>
      )}
      <p className="fine-print billing-note">
        Subscription changes are managed by your platform administrator. Payment
        collection is available when a payment gateway is connected.
      </p>
    </>
  );
}

export function SettingsView({
  data,
  organization,
  act,
  canManage,
  openDialog,
}: ViewProps) {
  const [name, setName] = useState(text(data.name, organization.name));
  const [timezone, setTimezone] = useState(
    text(data.timezone, organization.timezone || "Africa/Johannesburg"),
  );
  const [busy, setBusy] = useState(false);
  const [retentionDays, setRetentionDays] = useState(
    Number(data.retentionDays ?? 365),
  );
  const [error, setError] = useState("");
  return (
    <>
      <SectionHeading
        eyebrow="THE DETAILS MATTER"
        title="Workspace settings"
        detail="Set your business name and the timezone your outreach follows."
      />
      <div className="settings-layout">
        <div className="surface">
          <div className="card-heading">
            <h3>Business workspace</h3>
            <Settings2 size={20} />
          </div>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              try {
                await act("settings", { name, timezone, retentionDays });
              } catch (problem) {
                setError((problem as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Business name
              <input
                required
                maxLength={160}
                value={name}
                disabled={!canManage || busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Business timezone
              <input
                required
                value={timezone}
                disabled={!canManage || busy}
                onChange={(event) => setTimezone(event.target.value)}
                list="orbit-timezones"
              />
              <datalist id="orbit-timezones">
                <option value="Africa/Johannesburg" />
                <option value="Europe/London" />
                <option value="Europe/Paris" />
                <option value="America/New_York" />
                <option value="America/Los_Angeles" />
                <option value="Australia/Sydney" />
              </datalist>
              <em>Campaign sending windows use this timezone.</em>
            </label>
            <label>
              Archived content retention (days)
              <input
                type="number"
                min={30}
                max={3650}
                required
                value={retentionDays}
                disabled={!canManage || busy}
                onChange={(event) =>
                  setRetentionDays(Number(event.target.value))
                }
              />
              <em>
                Redaction applies to lead profiles archived longer than this
                period and their old message bodies. Delivery identifiers and
                suppression records remain for email safety.
              </em>
            </label>
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            {canManage && (
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : "Save workspace settings"}
                <ArrowRight size={16} />
              </button>
            )}
            {canManage && (
              <button
                type="button"
                className="text-button danger"
                onClick={() =>
                  openDialog({
                    title: "Apply archived content retention",
                    detail: `This permanently clears private profile details and old message bodies for leads archived longer than the saved ${data.retentionDays ?? 365}-day retention period. Take a database backup before applying. Delivery identifiers and suppression records are retained.`,
                    fields: [
                      {
                        name: "confirmed",
                        label:
                          "I have a current backup and approve this redaction.",
                        type: "checkbox",
                        required: true,
                      },
                    ],
                    submitLabel: "Redact eligible archived content",
                    submit: (input) =>
                      act("settings", { action: "redact-archived", ...input }),
                  })
                }
              >
                Apply saved retention policy
              </button>
            )}
          </form>
        </div>
        <div className="surface">
          <div className="card-heading">
            <h3>Workspace access</h3>
            <ShieldCheck size={20} />
          </div>
          <KeyValues
            values={{
              business: organization.name,
              status: data.status ?? organization.status,
              role: data.role ?? organization.role,
              website: data.websiteUrl,
            }}
          />
          <p className="fine-print">
            This workspace has its own business records, authorized email
            accounts and team access.
          </p>
        </div>
      </div>
    </>
  );
}
