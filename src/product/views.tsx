"use client";
import { useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleCheck,
  FileText,
  Inbox,
  Mail,
  Pause,
  Pencil,
  Play,
  Plus,
  Radar,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Users,
} from "lucide-react";
import {
  api,
  date,
  label,
  number,
  object,
  rows,
  text,
  type Organization,
  type RecordValue,
} from "./data";
import {
  Badge,
  Empty,
  KeyValues,
  DetailPanel,
  SectionHeading,
  type Dialog,
  type Field,
} from "./primitives";
import {
  BusinessView,
  MailboxesView,
  BillingView,
  TeamView,
  SettingsView,
} from "./workspace-views";
import { OverviewView } from "./overview-view";
import { AutomationView } from "./automation-view";
import { MetricNumber, TrendChart } from "./charts";
import { CampaignComposer } from "./campaign-composer";

export type ViewProps = {
  tab: string;
  data: RecordValue;
  organization: Organization;
  canManage: boolean;
  act: (resource: string, input: RecordValue) => Promise<RecordValue>;
  openDialog: (dialog: Dialog | null) => void;
  navigate: (tab: string) => void;
  refresh: () => void;
};
const count = (value: unknown) =>
  value === undefined || value === null
    ? "—"
    : new Intl.NumberFormat("en-ZA").format(number(value));
function valueAt(data: RecordValue, ...keys: string[]) {
  for (const key of keys) if (data[key] !== undefined) return data[key];
  return undefined;
}
export function ResourceView(props: ViewProps) {
  switch (props.tab) {
    case "overview":
      return <OverviewView {...props} />;
    case "automation":
      return <AutomationView {...props} />;
    case "discovery":
      return <Discovery {...props} />;
    case "leads":
      return <Leads {...props} />;
    case "campaigns":
      return <Campaigns {...props} />;
    case "templates":
      return <Templates {...props} />;
    case "inbox":
      return <InboxView {...props} />;
    case "reports":
      return <Reports {...props} />;
    case "business":
      return <BusinessView {...props} />;
    case "mailboxes":
      return <MailboxesView {...props} />;
    case "notifications":
      return <Notifications {...props} />;
    case "team":
      return <TeamView {...props} />;
    case "billing":
      return <BillingView {...props} />;
    case "settings":
      return <SettingsView {...props} />;
    default:
      return null;
  }
}

function Metrics({
  data,
  compact = false,
}: {
  data: RecordValue;
  compact?: boolean;
}) {
  const metrics = [
    {
      label: "Businesses discovered",
      value: valueAt(
        data,
        "businessesDiscovered",
        "totalBusinessesDiscovered",
        "discovered",
        "prospects",
      ),
      icon: Radar,
      detail: "Businesses found through research",
    },
    {
      label: "Qualified leads",
      value: valueAt(data, "qualifiedLeads", "qualified"),
      icon: Target,
      detail: "Matched to your business criteria",
    },
    {
      label: "Emails sent",
      value: valueAt(data, "emailsSent", "sent"),
      icon: Send,
      detail: "Accepted by your email provider",
    },
    {
      label: "Positive replies",
      value: valueAt(data, "positiveReplies", "positive"),
      icon: Mail,
      detail: "Conversations with potential",
    },
  ];
  return (
    <div className={`metric-grid ${compact ? "compact" : ""}`}>
      {metrics.map((metric) => (
        <article className="metric-card" key={metric.label}>
          <div className="metric-label">
            <span>{metric.label}</span>
            <metric.icon size={17} />
          </div>
          <strong>
            <MetricNumber value={metric.value} />
          </strong>
          <p>{metric.detail}</p>
        </article>
      ))}
    </div>
  );
}
function SeriesChart({
  values,
  title = "Outreach performance",
}: {
  values: RecordValue[];
  title?: string;
}) {
  return <TrendChart values={values} title={title} />;
}
function Discovery({ data, act, canManage, navigate }: ViewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  return (
    <>
      <SectionHeading
        eyebrow="A BETTER WAY TO PROSPECT"
        title="Find the businesses that fit."
        detail="Start with your business. Discover the companies most likely to need what you do."
      />
      <div className="discovery-layout">
        <div className="surface discovery-form">
          <span className="feature-icon">
            <Radar size={27} strokeWidth={1.5} />
          </span>
          <h3>Who would you like to reach?</h3>
          <p>
            Your approved business profile helps AI find relevant companies and
            explain the fit.
          </p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              setResult("");
              const form = new FormData(event.currentTarget);
              try {
                const queued = await act("discovery", {
                  action: "discover",
                  industry: String(form.get("industry")),
                  location: String(form.get("location")),
                  category: String(form.get("category")),
                  maxResults: Number(form.get("maxResults")),
                  permissionConfirmed: form.get("permissionConfirmed") === "on",
                });
                setResult(
                  text(
                    queued.message,
                    "Research queued. Your worker will add discovered businesses to Leads as it processes the search.",
                  ),
                );
              } catch (problem) {
                setError((problem as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <label>
                Target industry
                <input
                  name="industry"
                  required
                  placeholder="For example: property management"
                  maxLength={100}
                />
              </label>
              <label>
                Target location
                <input
                  name="location"
                  required
                  placeholder="City, region or country"
                  maxLength={200}
                />
              </label>
              <label>
                Business category
                <input
                  name="category"
                  placeholder="For example: commercial property owners"
                  maxLength={100}
                />
              </label>
              <label>
                Businesses to discover
                <select name="maxResults" defaultValue="10">
                  <option value="5">Up to 5 businesses</option>
                  <option value="10">Up to 10 businesses</option>
                </select>
              </label>
            </div>
            <label className="checkbox-label">
              <input name="permissionConfirmed" type="checkbox" required />
              <span>
                I have permission to research public business information for
                this purpose.
              </span>
            </label>
            <div className="form-footer">
              <p>
                <ShieldCheck size={15} />
                Public business sources. Recorded evidence.
              </p>
              <button className="primary" disabled={busy || !canManage}>
                <Sparkles size={16} />
                {busy ? "Starting your search…" : "Discover businesses"}
                <ArrowRight size={16} />
              </button>
            </div>
          </form>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {result && (
            <div className="alert success" role="status">
              {result}
            </div>
          )}
        </div>
        <aside className="discovery-notes">
          <div className="note-card lime">
            <Sparkles size={25} />
            <h3>
              Better context.
              <br />
              Better connections.
            </h3>
            <p>
              Monettic uses your website and approved business profile to
              understand what you offer and who would benefit.
            </p>
            <button
              className="text-button"
              onClick={() => navigate("business")}
            >
              Review your business profile
              <ArrowUpRight size={15} />
            </button>
          </div>
          <div className="note-card">
            <h3>Thoughtful by design.</h3>
            <ul className="check-list">
              <li>
                <Check size={15} />
                Source evidence for discovered businesses
              </li>
              <li>
                <Check size={15} />
                Relevance scores with an explanation
              </li>
              <li>
                <Check size={15} />
                Duplicate detection within your workspace
              </li>
              <li>
                <Check size={15} />
                Your approval before outreach
              </li>
            </ul>
            <p className="fine-print">
              Public contact information does not automatically give permission
              for marketing. Review eligibility before adding leads to outreach.
            </p>
          </div>
        </aside>
      </div>
      <Jobs items={rows(data.jobs ?? data.items)} />
    </>
  );
}
export function Jobs({ items }: { items: RecordValue[] }) {
  if (!items.length) return null;
  return (
    <div className="surface section-space">
      <div className="card-heading">
        <h3>Background activity</h3>
        <span className="subtle">Refresh to see progress</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Operation</th>
              <th>Status</th>
              <th>Started</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {items.map((job, index) => (
              <tr key={text(job.id, String(index))}>
                <td>{label(job.kind ?? job.type)}</td>
                <td>
                  <Badge value={job.status} />
                </td>
                <td>{date(job.createdAt, true)}</td>
                <td>
                  {text(
                    job.error ?? job.message ?? job.lastError,
                    "Processing details appear here.",
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const leadFields: Field[] = [
  { name: "company", label: "Business name", required: true },
  { name: "name", label: "Contact name" },
  { name: "email", label: "Business email", type: "email" },
  { name: "website", label: "Business website", type: "url" },
  { name: "industry", label: "Industry" },
  { name: "location", label: "Location" },
  { name: "phone", label: "Business phone" },
  { name: "sourceUrl", label: "Source URL", type: "url" },
  { name: "sourceKind", label: "Source", value: "MANUAL" },
  { name: "contactRole", label: "Contact position" },
  {
    name: "status",
    label: "Pipeline stage",
    type: "select",
    value: "NEW",
    required: true,
    options: [
      "NEW",
      "QUALIFIED",
      "OUTREACH_SCHEDULED",
      "CONTACTED",
      "REPLIED",
      "INTERESTED",
      "MEETING_BOOKED",
      "CONVERTED",
      "NOT_INTERESTED",
      "UNQUALIFIED",
      "UNSUBSCRIBED",
    ].map((value) => ({ value, label: label(value) })),
  },
  {
    name: "eligibility",
    label: "Marketing permission",
    type: "select",
    value: "UNKNOWN",
    required: true,
    options: [
      { value: "UNKNOWN", label: "Not yet established" },
      { value: "CONSENTED", label: "Consent recorded" },
      { value: "SUPPRESSED", label: "Not eligible" },
    ],
  },
  {
    name: "consentSource",
    label: "Evidence of permission",
    hint: "Record the specific opt-in or other evidence. A public email address alone is not permission.",
  },
  {
    name: "consentAt",
    label: "Permission recorded at",
    type: "datetime-local",
  },
  { name: "notes", label: "Notes", type: "textarea" },
];
function cleanLead(input: RecordValue) {
  return {
    ...input,
    consentAt: input.consentAt
      ? new Date(String(input.consentAt)).toISOString()
      : undefined,
    ...Object.fromEntries(
      [
        "email",
        "website",
        "sourceUrl",
        "phone",
        "industry",
        "location",
        "sourceKind",
        "contactRole",
        "consentSource",
      ]
        .filter((key) => !input[key])
        .map((key) => [key, undefined]),
    ),
  };
}
function Leads({ data, act, openDialog, canManage, organization }: ViewProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [selected, setSelected] = useState<RecordValue | null>(null);
  const [importNotice, setImportNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [sort, setSort] = useState("newest");
  const items = rows(data.items);
  const visible = items
    .filter(
      (lead) =>
        `${text(lead.company, "")} ${text(lead.name, "")} ${text(lead.email, "")} ${text(lead.industry, "")}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (filter === "ALL" || lead.status === filter),
    )
    .sort((a, b) =>
      sort === "score"
        ? number(b.qualificationScore) - number(a.qualificationScore)
        : sort === "company"
          ? text(a.company).localeCompare(text(b.company))
          : new Date(text(b.createdAt)).getTime() -
            new Date(text(a.createdAt)).getTime(),
    );
  function edit(lead?: RecordValue) {
    setSelected(null);
    openDialog({
      title: lead ? "Edit business lead" : "Add a business lead",
      detail:
        "Keep the source and marketing permission clear. Every conversation starts with a real business.",
      fields: [
        ...leadFields,
        {
          name: "ownerId",
          label: "Assigned team member",
          type: "select",
          options: rows(data.members).map((member) => ({
            value: text(member.userId),
            label: text(object(member.user).name),
          })),
        },
      ],
      initial: lead,
      submitLabel: lead ? "Update lead" : "Add lead",
      submit: (input) =>
        act("leads", {
          ...cleanLead(input),
          ownerId: input.ownerId || null,
          action: lead ? "update" : "create",
          ...(lead ? { id: lead.id } : {}),
        }),
    });
  }
  function operate(action: string, lead: RecordValue) {
    setSelected(null);
    openDialog({
      title:
        action === "delete"
          ? "Remove this lead?"
          : `${label(action)} ${text(lead.company)}`,
      detail:
        action === "delete"
          ? "This removes the lead from your business workspace."
          : "This operation uses your business context and runs in the background. Review the result before outreach.",
      fields:
        action === "delete"
          ? [
              {
                name: "confirm",
                label: "I want to remove this lead.",
                type: "checkbox",
                required: true,
              },
            ]
          : [],
      submitLabel:
        action === "delete"
          ? "Remove lead"
          : `Start ${action === "draft" ? "email draft" : action === "verify" ? "verification" : "qualification"}`,
      submit: () => act("leads", { action, id: lead.id }),
    });
  }
  const staleBefore = Date.now() - 30 * 86400000;
  const unverified = items.filter(
    (lead) =>
      lead.email &&
      !["ARCHIVED", "UNSUBSCRIBED"].includes(text(lead.status)) &&
      (!lead.verifiedAt ||
        new Date(text(lead.verifiedAt)).getTime() < staleBefore),
  ).length;
  function verifyAll() {
    openDialog({
      title: `Verify ${unverified} email addresses`,
      detail:
        "Every address first gets a free check that its domain can receive email. Addresses on working domains are then checked by your email verification service, which uses its credits. Results update in the background.",
      fields: [],
      submitLabel: "Start verification",
      submit: () => act("leads", { action: "verify-all" }),
    });
  }
  return (
    <>
      <SectionHeading
        eyebrow="PEOPLE BEHIND THE OPPORTUNITIES"
        title="Lead intelligence"
        detail="A clear view of every business, every fit and every next step."
        action={
          canManage && (
            <button className="primary" onClick={() => edit()}>
              <Plus size={17} />
              Add lead
            </button>
          )
        }
      />
      {canManage && (
        <div className="inline-actions">
          <button onClick={() => fileInput.current?.click()}>Import CSV</button>
          <button onClick={verifyAll} disabled={!unverified}>
            Verify {unverified} emails
          </button>
          <span className="subtle">
            Columns: company, email, name, website, industry, location, phone.
            Up to 100 rows.
          </span>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              event.target.value = "";
              if (file.size > 500000) {
                setImportNotice("Choose a CSV smaller than 500 KB.");
                return;
              }
              const parsed = Papa.parse<Record<string, string>>(
                await file.text(),
                {
                  header: true,
                  skipEmptyLines: true,
                  transformHeader: (header) => header.trim().toLowerCase(),
                },
              );
              if (
                parsed.errors.length ||
                !parsed.meta.fields?.includes("company") ||
                parsed.data.length > 100
              ) {
                setImportNotice(
                  "Use a valid CSV with a company column and up to 100 business rows.",
                );
                return;
              }
              try {
                await act("leads", {
                  action: "import",
                  items: parsed.data.map((row) => ({
                    company: row.company,
                    ...Object.fromEntries(
                      [
                        "email",
                        "name",
                        "website",
                        "industry",
                        "location",
                        "phone",
                      ]
                        .filter((key) => row[key]?.trim())
                        .map((key) => [key, row[key].trim()]),
                    ),
                  })),
                });
              } catch (error) {
                setImportNotice((error as Error).message);
              }
            }}
          />
        </div>
      )}
      {importNotice && (
        <div className="alert info" role="status">
          {importNotice}
        </div>
      )}
      <div className="lead-summary">
        <span>
          <b>{items.length}</b> businesses in your workspace
        </span>
        <span>
          <i className="dot lime-dot" />
          {
            items.filter(
              (lead) =>
                lead.qualificationCategory === "HOT" ||
                number(lead.qualificationScore) >= 80,
            ).length
          }{" "}
          hot leads
        </span>
        <span>
          <i className="dot" />
          {items.filter((lead) => lead.status === "MEETING_BOOKED").length}{" "}
          meetings booked
        </span>
      </div>
      <div className="surface">
        <div className="table-toolbar">
          <div className="search-input">
            <Search size={17} />
            <input
              aria-label="Search leads"
              placeholder="Search businesses, people or email…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select
            aria-label="Filter lead status"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="ALL">All stages</option>
            {[...new Set(items.map((lead) => text(lead.status)))].map(
              (status) => (
                <option value={status} key={status}>
                  {label(status)}
                </option>
              ),
            )}
          </select>
          <button
            onClick={() => downloadCsv("monettic-leads.csv", visible)}
            disabled={!visible.length}
          >
            <ArrowDownToLine size={15} />
            Export
          </button>
          <select
            aria-label="Sort leads"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="newest">Newest first</option>
            <option value="company">Business name</option>
            <option value="score">Highest fit score</option>
          </select>
        </div>
        {visible.length ? (
          <div className="table-scroll">
            <table className="lead-table">
              <thead>
                <tr>
                  <th>Business / contact</th>
                  <th>Industry / location</th>
                  <th>Fit score</th>
                  <th>Pipeline</th>
                  <th>Permission</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((lead) => (
                  <tr key={text(lead.id)}>
                    <td>
                      <button
                        className="business-cell"
                        onClick={() => setSelected(lead)}
                      >
                        <span className="company-avatar">
                          {text(lead.company, "B").slice(0, 1)}
                        </span>
                        <span>
                          <b>{text(lead.company)}</b>
                          <small>
                            {text(lead.name)} ·{" "}
                            {text(lead.email, "Email not recorded")}
                          </small>
                        </span>
                      </button>
                    </td>
                    <td>
                      <b className="table-primary">
                        {text(lead.industry, "Unspecified")}
                      </b>
                      <small>
                        {text(lead.location, "Location not recorded")}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`fit-score ${number(lead.qualificationScore) >= 80 ? "hot" : ""}`}
                      >
                        {count(lead.qualificationScore)}
                      </span>
                      <small>
                        {lead.qualificationCategory
                          ? label(lead.qualificationCategory)
                          : "Not yet qualified"}
                      </small>
                    </td>
                    <td>
                      <Badge value={lead.status} />
                    </td>
                    <td>
                      <Badge value={lead.eligibility ?? "UNKNOWN"} />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="icon-button"
                          aria-label={`View ${text(lead.company)}`}
                          onClick={() => setSelected(lead)}
                        >
                          <ArrowUpRight size={16} />
                        </button>
                        {canManage && (
                          <button
                            className="icon-button"
                            aria-label={`Edit ${text(lead.company)}`}
                            onClick={() => edit(lead)}
                          >
                            <Pencil size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={
              search || filter !== "ALL"
                ? "No leads match that view."
                : "Your next great customer starts here."
            }
            detail={
              search || filter !== "ALL"
                ? "Try a different search or pipeline stage."
                : "Discover relevant businesses with Lead finder, or add a lead you've already connected with."
            }
            action={
              canManage && (
                <button onClick={() => edit()}>
                  <Plus size={16} />
                  Add your first lead
                </button>
              )
            }
          />
        )}
      </div>
      {selected && (
        <DetailPanel
          title={text(selected.company)}
          close={() => setSelected(null)}
        >
          <div className="card-heading">
            <div>
              <p className="eyebrow">BUSINESS PROFILE</p>
              <h3>{text(selected.company)}</h3>
            </div>
            <button onClick={() => setSelected(null)}>Close</button>
          </div>
          <div className="lead-insight-summary">
            <div>
              <p className="eyebrow">QUALIFICATION SCORE</p>
              <strong>
                <MetricNumber value={selected.qualificationScore} />
                <small>/100</small>
              </strong>
            </div>
            <div>
              <Badge value={selected.qualificationCategory || "NOT_SCORED"} />
              <Badge value={selected.status} />
            </div>
          </div>
          <KeyValues
            values={{
              contact: selected.name,
              email: selected.email,
              website: selected.website,
              industry: selected.industry,
              location: selected.location,
              source: selected.sourceUrl || selected.sourceKind,
              qualificationScore: selected.qualificationScore,
              qualificationReason: selected.qualificationExplanation,
              permission: selected.eligibility,
              notes: selected.notes,
            }}
          />
          {canManage && (
            <div className="inline-actions">
              <button onClick={() => operate("qualify", selected)}>
                <Target size={15} />
                Qualify lead
              </button>
              <button onClick={() => operate("verify", selected)}>
                <ShieldCheck size={15} />
                Verify email
              </button>
              <button onClick={() => operate("draft", selected)}>
                <Sparkles size={15} />
                Draft outreach
              </button>
              <button onClick={() => edit(selected)}>
                <Pencil size={15} />
                Edit details
              </button>
              <button
                className="text-button danger"
                onClick={() => operate("delete", selected)}
              >
                <Trash2 size={15} />
                Remove
              </button>
            </div>
          )}
          {selected.draftBody ? (
            <div className="email-preview">
              <b>{text(selected.draftSubject)}</b>
              <p>{text(selected.draftBody)}</p>
            </div>
          ) : null}
          {!!rows(selected.evidence).length && (
            <details className="evidence-details">
              <summary>
                Source evidence · {rows(selected.evidence).length} records
              </summary>
              {rows(selected.evidence).map((source, index) => (
                <article key={index}>
                  <b>{text(source.title)}</b>
                  <p>{text(source.excerpt)}</p>
                  {/^https?:\/\//.test(text(source.url, "")) && (
                    <a href={text(source.url)} target="_blank" rel="noreferrer">
                      View source
                      <ArrowUpRight size={13} />
                    </a>
                  )}
                </article>
              ))}
            </details>
          )}
          <LeadHistory
            organizationId={organization.workspaceId}
            leadId={text(selected.id)}
          />
        </DetailPanel>
      )}
    </>
  );
}

function LeadHistory({
  organizationId,
  leadId,
}: {
  organizationId: string;
  leadId: string;
}) {
  const [data, setData] = useState<RecordValue>({});
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void api(
      `/api/platform/${organizationId}/leads/${leadId}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then(setData)
      .catch((problem) => {
        if (!controller.signal.aborted) setError(problem.message);
      });
    return () => controller.abort();
  }, [organizationId, leadId]);
  return (
    <div className="lead-history">
      <h3>Campaigns and communication history</h3>
      {error && <p role="alert">{error}</p>}
      {rows(data.recipients).map((recipient) => (
        <p key={text(recipient.id)}>
          {text(object(recipient.campaign).name)} · {label(recipient.status)} ·
          Next follow-up:{" "}
          {recipient.status === "QUEUED"
            ? date(recipient.nextAt, true)
            : "Stopped or completed"}
        </p>
      ))}
      {rows(data.messages).map((message) => (
        <article className="email-preview" key={text(message.id)}>
          <span className="subtle">
            {label(message.direction)} · {label(message.status)} ·{" "}
            {date(message.createdAt, true)}
          </span>
          <b>{text(message.subject)}</b>
          <p>{text(message.body)}</p>
        </article>
      ))}
      {!rows(data.messages).length && (
        <p className="subtle">No recorded emails for this lead.</p>
      )}
    </div>
  );
}

export const messageFields: Field[] = [
  { name: "name", label: "Name", required: true },
  {
    name: "subject",
    label: "Subject line",
    required: true,
    hint: "Personalize with {{name}}, {{company}} and {{email}}.",
  },
  { name: "body", label: "Message", type: "textarea", required: true },
  { name: "steps", label: "Follow-up sequence", type: "sequence" },
];
function Campaigns({
  data,
  act,
  openDialog,
  canManage,
  organization,
}: ViewProps) {
  const [search, setSearch] = useState("");
  const [composing, setComposing] = useState(false);
  const [selected, setSelected] = useState<RecordValue | null>(null);
  const items = rows(data.items);
  const [accounts, setAccounts] = useState<RecordValue[]>([]);
  const [leads, setLeads] = useState<RecordValue[]>([]);
  const [performance, setPerformance] = useState<RecordValue[]>([]);
  const [connectionError, setConnectionError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api(
        `/api/platform/${organization.workspaceId}/mailboxes`,
        "GET",
        undefined,
        controller.signal,
      ),
      api(
        `/api/platform/${organization.workspaceId}/leads`,
        "GET",
        undefined,
        controller.signal,
      ),
      api(
        `/api/platform/${organization.workspaceId}/reports?days=30`,
        "GET",
        undefined,
        controller.signal,
      ),
    ])
      .then(([mailboxes, prospects, reports]) => {
        setAccounts(rows(mailboxes.items));
        setLeads(rows(prospects.items));
        setPerformance(rows(reports.campaigns));
      })
      .catch((error) => {
        if (!controller.signal.aborted) setConnectionError(error.message);
      });
    return () => controller.abort();
  }, [organization.workspaceId]);
  function edit(campaign?: RecordValue) {
    if (!campaign) {
      setComposing(true);
      return;
    }
    openDialog({
      title: campaign ? "Refine your campaign" : "Start a new conversation",
      detail:
        "Build your message, choose your own business email and set a thoughtful pace. Campaigns need your approval before they can send.",
      fields: [
        ...messageFields,
        { name: "industry", label: "Target industry" },
        { name: "location", label: "Target location" },
        { name: "category", label: "Business category" },
        {
          name: "mailboxId",
          label: "Business email account",
          type: "select",
          options: accounts.map((account) => ({
            value: text(account.id),
            label: text(account.email ?? account.fromEmail),
          })),
        },
        {
          name: "dailyLimit",
          label: "Daily sending limit",
          type: "number",
          min: 1,
          max: 1000,
          required: true,
          value: 25,
        },
        {
          name: "sendStartHour",
          label: "Daily start hour (workspace timezone)",
          type: "number",
          min: 0,
          max: 23,
          value: 9,
          required: true,
        },
        {
          name: "sendEndHour",
          label: "Daily end hour (workspace timezone)",
          type: "number",
          min: 1,
          max: 24,
          value: 17,
          required: true,
        },
        {
          name: "scheduledAt",
          label: "Start date and time",
          type: "datetime-local",
        },
      ],
      initial: campaign
        ? { ...campaign, ...object(campaign.target) }
        : undefined,
      submitLabel: "Save campaign draft",
      submit: (input) =>
        act("campaigns", {
          ...input,
          action: campaign ? "update" : "create",
          ...(campaign ? { id: campaign.id } : {}),
          scheduledAt: input.scheduledAt
            ? new Date(String(input.scheduledAt)).toISOString()
            : undefined,
          mailboxId: input.mailboxId || undefined,
          target: {
            industry: input.industry || "",
            location: input.location || "",
            category: input.category || "",
          },
          ...(!campaign ? { leadIds: [] } : {}),
        }),
    });
  }
  function operation(action: string, campaign: RecordValue) {
    openDialog({
      title: `${label(action)} campaign`,
      detail: `${text(campaign.name)}${action === "start" || action === "resume" ? ". Messages will be processed on your configured sending schedule through your connected email account." : action === "approve" ? ". Review the message, the recipients' permission and the sending account before approval." : ". This updates this campaign in your workspace."}`,
      fields: [
        {
          name: "confirmed",
          label:
            action === "approve" || action === "start" || action === "resume"
              ? "I have reviewed the content, sender identity and recipients' permission for this campaign."
              : `I want to ${action} this campaign.`,
          type: "checkbox",
          required: true,
        },
      ],
      submitLabel: `${label(action)} campaign`,
      submit: () =>
        act("campaigns", {
          action,
          id: campaign.id,
          permissionConfirmed: true,
        }),
    });
  }
  function addRecipients(campaign: RecordValue) {
    const permission = campaign.purpose === "PERMISSION_REQUEST";
    // The reply that granted permission (repliedAt <= consentAt) does not stop outreach.
    const eligible = leads.filter(
      (lead) =>
        lead.email &&
        !lead.unsubscribedAt &&
        (permission
          ? !lead.repliedAt &&
            !["CONSENTED", "SUPPRESSED"].includes(text(lead.eligibility))
          : lead.eligibility === "CONSENTED" &&
            (!lead.repliedAt ||
              (!!lead.consentAt &&
                new Date(text(lead.repliedAt)) <=
                  new Date(text(lead.consentAt))))),
    );
    openDialog({
      title: "Add eligible recipients",
      detail: permission
        ? "Only leads with an email address, no recorded permission and no reply appear here. Leads already asked once are blocked when the campaign is approved."
        : "Only leads with recorded permission, an email address and no later reply appear here. Delivery performs further eligibility and suppression checks.",
      fields: [
        {
          name: "leadId",
          label: "Business lead",
          type: "select",
          required: true,
          options: eligible.map((lead) => ({
            value: text(lead.id),
            label: `${text(lead.company)} · ${text(lead.email)}`,
          })),
        },
      ],
      submitLabel: "Add recipient",
      submit: (input) =>
        act("campaigns", {
          action: "update",
          id: campaign.id,
          leadIds: [
            ...new Set([
              ...rows(campaign.recipients).map((recipient) =>
                text(recipient.leadId),
              ),
              String(input.leadId),
            ]),
          ],
        }),
    });
  }
  const visible = items.filter((campaign) =>
    text(campaign.name, "").toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <SectionHeading
        eyebrow="OUTREACH WITH INTENTION"
        title="Outreach campaigns"
        detail="Personalized messages, a thoughtful pace and a clear view of every campaign."
        action={
          canManage && (
            <button className="primary" onClick={() => edit()}>
              <Plus size={17} />
              Create and send
            </button>
          )
        }
      />
      {composing && (
        <CampaignComposer
          organization={organization}
          accounts={accounts}
          leads={leads}
          sending={object(data.sending)}
          act={act}
          close={() => setComposing(false)}
        />
      )}
      {connectionError && (
        <div className="alert error" role="alert">
          {connectionError}
        </div>
      )}
      <div className="table-toolbar surface campaign-toolbar">
        <div className="search-input">
          <Search size={17} />
          <input
            aria-label="Search campaigns"
            placeholder="Find a campaign…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <span className="subtle">
          {items.length} campaigns in your workspace
        </span>
        {canManage && (
          <button
            onClick={() =>
              openDialog({
                title: "AI writing assistant",
                detail:
                  "Prepare a personalized draft from a researched lead and your approved business profile. The AI job runs in the background; review its result in My Leads before campaign approval.",
                fields: [
                  {
                    name: "leadId",
                    label: "Business lead",
                    type: "select",
                    required: true,
                    options: leads.map((lead) => ({
                      value: text(lead.id),
                      label: text(lead.company),
                    })),
                  },
                ],
                submitLabel: "Prepare AI draft",
                submit: (input) =>
                  act("leads", { action: "draft", id: input.leadId }),
              })
            }
          >
            <Sparkles size={15} />
            AI writing assistant
          </button>
        )}
      </div>
      {visible.length ? (
        <div className="campaign-grid">
          {visible.map((campaign) => (
            <article className="surface campaign-card" key={text(campaign.id)}>
              <div className="card-heading">
                <span className="feature-icon small">
                  <Send size={20} />
                </span>
                <span className="inline-actions">
                  {campaign.purpose === "PERMISSION_REQUEST" && (
                    <Badge value="PERMISSION_REQUEST" />
                  )}
                  <Badge value={campaign.status} />
                </span>
              </div>
              <h3>{text(campaign.name)}</h3>
              <p className="campaign-subject">{text(campaign.subject)}</p>
              <p className="campaign-audience">
                {[
                  object(campaign.target).industry,
                  object(campaign.target).location,
                  object(campaign.target).category,
                ]
                  .filter(Boolean)
                  .map((value) => text(value))
                  .join(" · ") || "Selected business audience"}
              </p>
              <div className="campaign-performance">
                {[
                  { key: "sent", title: "Sent" },
                  { key: "replies", title: "Replies" },
                  { key: "positiveReplies", title: "Positive" },
                ].map((metric) => (
                  <div key={metric.key}>
                    <strong>
                      {performance.some((item) => item.id === campaign.id)
                        ? number(
                            performance.find(
                              (item) => item.id === campaign.id,
                            )?.[metric.key],
                          )
                        : "—"}
                    </strong>
                    <span>{metric.title}</span>
                  </div>
                ))}
                <div>
                  <strong>
                    {
                      leads.filter(
                        (lead) =>
                          rows(campaign.recipients).some(
                            (recipient) => recipient.leadId === lead.id,
                          ) && number(lead.qualificationScore) >= 50,
                      ).length
                    }
                  </strong>
                  <span>Qualified</span>
                </div>
              </div>
              <div className="campaign-facts">
                <span>
                  <b>
                    {count(
                      campaign.recipientCount ??
                        object(campaign._count).recipients ??
                        rows(campaign.recipients).length,
                    )}
                  </b>
                  Recipients
                </span>
                <span>
                  <b>{count(campaign.dailyLimit)}</b>Daily limit
                </span>
                <span>
                  <b>
                    {text(campaign.sendStartHour, "9")}–
                    {text(campaign.sendEndHour, "17")}
                  </b>
                  Sending hours
                </span>
              </div>
              <p className="fine-print">
                Performance · last 30 days
                <br />
                {rows(campaign.steps).length} follow-ups · Created{" "}
                {date(campaign.createdAt)}
              </p>
              <div className="campaign-actions">
                <button
                  onClick={() =>
                    setSelected(selected?.id === campaign.id ? null : campaign)
                  }
                >
                  View campaign
                  <ArrowUpRight size={15} />
                </button>
                {canManage && (
                  <div className="row-actions">
                    {["DRAFT", "PENDING_APPROVAL"].includes(
                      text(campaign.status),
                    ) && (
                      <button
                        className="icon-button"
                        aria-label="Edit campaign"
                        onClick={() => edit(campaign)}
                      >
                        <Pencil size={15} />
                      </button>
                    )}
                    {campaign.status === "RUNNING" && (
                      <button
                        className="icon-button"
                        aria-label="Pause campaign"
                        onClick={() => operation("pause", campaign)}
                      >
                        <Pause size={16} />
                      </button>
                    )}
                    {campaign.status === "PAUSED" && (
                      <button
                        className="icon-button"
                        aria-label="Resume campaign"
                        onClick={() => operation("resume", campaign)}
                      >
                        <Play size={16} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="surface">
          <Empty
            title="Your first campaign has a lot of potential."
            detail="Introduce your business with a relevant message, choose your recipients and let the right conversations begin."
            icon={<Send size={27} strokeWidth={1.5} />}
            action={
              canManage && (
                <button className="primary" onClick={() => edit()}>
                  Create and send campaign
                  <Plus size={16} />
                </button>
              )
            }
          />
        </div>
      )}
      {selected && (
        <div className="surface section-space">
          <div className="card-heading">
            <div>
              <p className="eyebrow">CAMPAIGN DETAILS</p>
              <h3>{text(selected.name)}</h3>
            </div>
            <button onClick={() => setSelected(null)}>Close</button>
          </div>
          <div className="email-preview">
            <b>{text(selected.subject)}</b>
            <p>{text(selected.body)}</p>
          </div>
          {rows(selected.steps).map((step, index) => (
            <div className="email-preview" key={index}>
              <span className="eyebrow">
                FOLLOW-UP {index + 1} · {text(step.delayDays)} DAYS
              </span>
              <b>{text(step.subject)}</b>
              <p>{text(step.body)}</p>
            </div>
          ))}
          {canManage && (
            <div className="inline-actions">
              {["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(
                text(selected.status),
              ) && (
                <>
                  <button onClick={() => edit(selected)}>
                    <Pencil size={15} />
                    Edit
                  </button>
                  <button onClick={() => addRecipients(selected)}>
                    <Users size={15} />
                    Add recipient
                  </button>
                  <button onClick={() => operation("approve", selected)}>
                    <ShieldCheck size={15} />
                    Approve
                  </button>
                  <button
                    className="primary"
                    onClick={() => operation("start", selected)}
                  >
                    <Play size={15} />
                    Start campaign
                  </button>
                </>
              )}
              {["RUNNING", "PAUSED"].includes(text(selected.status)) && (
                <button
                  onClick={() =>
                    operation(
                      selected.status === "RUNNING" ? "pause" : "resume",
                      selected,
                    )
                  }
                >
                  {selected.status === "RUNNING" ? "Pause" : "Resume"} campaign
                </button>
              )}
              {!["CANCELLED", "COMPLETED"].includes(text(selected.status)) && (
                <button
                  className="text-button danger"
                  onClick={() => operation("cancel", selected)}
                >
                  Cancel campaign
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Templates({ data, act, openDialog, canManage }: ViewProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<RecordValue | null>(null);
  const items = rows(data.items);
  function edit(template?: RecordValue) {
    openDialog({
      title: template ? "Refine your template" : "Save your business voice",
      detail:
        "A reusable starting point for relevant conversations. Personalize with {{name}}, {{company}} and {{email}}.",
      fields: [
        ...messageFields.filter((field) => field.name !== "steps"),
        {
          name: "category",
          label: "Template category",
          type: "select",
          required: true,
          value: "OUTREACH",
          options: [
            { value: "OUTREACH", label: "Outreach introduction" },
            { value: "FOLLOW_UP", label: "Follow-up" },
            { value: "REPLY", label: "Reply" },
          ],
        },
      ],
      initial: template,
      submitLabel: "Save template",
      submit: (input) =>
        act("templates", {
          ...input,
          action: template ? "update" : "create",
          ...(template ? { id: template.id } : {}),
        }),
    });
  }
  return (
    <>
      <SectionHeading
        eyebrow="A VOICE THAT'S YOURS"
        title="Your message library"
        detail="Keep your best messages together. Refine, review and reuse them with care."
        action={
          canManage && (
            <button className="primary" onClick={() => edit()}>
              <Plus size={17} />
              Create template
            </button>
          )
        }
      />
      <div className="search-input standalone-search">
        <Search size={17} />
        <input
          aria-label="Search templates"
          placeholder="Find a message by name or subject…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {items.length ? (
        <div className="template-grid">
          {items
            .filter((template) =>
              `${text(template.name)} ${text(template.subject)}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((template) => (
              <article
                className="surface template-card"
                key={text(template.id)}
              >
                <div className="card-heading">
                  <span className="template-category">
                    {label(template.category)}
                  </span>
                  <Badge value={template.approvalStatus ?? "DRAFT"} />
                </div>
                <h3>{text(template.name)}</h3>
                <p className="template-subject">{text(template.subject)}</p>
                <p className="template-excerpt">{text(template.body)}</p>
                <div className="campaign-actions">
                  <button onClick={() => setSelected(template)}>
                    Read message
                    <ArrowUpRight size={15} />
                  </button>
                  {canManage && (
                    <button
                      className="icon-button"
                      aria-label={`Edit ${text(template.name)}`}
                      onClick={() => edit(template)}
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                </div>
              </article>
            ))}
        </div>
      ) : (
        <div className="surface">
          <Empty
            title="Your voice belongs here."
            detail="Save your introductions, follow-ups and replies, then give each prospect the personal attention they deserve."
            icon={<FileText size={27} strokeWidth={1.5} />}
            action={
              canManage && (
                <button onClick={() => edit()}>
                  <Plus size={16} />
                  Write your first template
                </button>
              )
            }
          />
        </div>
      )}
      {selected && (
        <div className="surface section-space">
          <div className="card-heading">
            <div>
              <p className="eyebrow">MESSAGE PREVIEW</p>
              <h3>{text(selected.name)}</h3>
            </div>
            <button onClick={() => setSelected(null)}>Close</button>
          </div>
          <div className="email-preview">
            <b>{text(selected.subject)}</b>
            <p>{text(selected.body)}</p>
          </div>
          {canManage && (
            <div className="inline-actions">
              <button onClick={() => edit(selected)}>
                <Pencil size={15} />
                Edit message
              </button>
              <button
                onClick={() =>
                  openDialog({
                    title: "Approve this template",
                    detail:
                      "Confirm that the content accurately represents your business. Later changes require a new review.",
                    fields: [
                      {
                        name: "confirm",
                        label:
                          "I have reviewed this template and approve its content.",
                        type: "checkbox",
                        required: true,
                      },
                    ],
                    submitLabel: "Approve template",
                    submit: async () => {
                      await act("templates", {
                        action: "approve",
                        id: selected.id,
                      });
                      setSelected(null);
                    },
                  })
                }
              >
                <Check size={15} />
                Approve template
              </button>
              <button
                className="text-button danger"
                onClick={() =>
                  openDialog({
                    title: "Delete this template?",
                    detail:
                      "Your existing campaigns keep their own message content.",
                    fields: [
                      {
                        name: "confirm",
                        label: "Delete this saved template.",
                        type: "checkbox",
                        required: true,
                      },
                    ],
                    submitLabel: "Delete template",
                    submit: async () => {
                      await act("templates", {
                        action: "delete",
                        id: selected.id,
                      });
                      setSelected(null);
                    },
                  })
                }
              >
                <Trash2 size={15} />
                Delete
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function InboxView({ data, act, openDialog, canManage }: ViewProps) {
  const items = rows(data.items);
  const [selection, setSelected] = useState<RecordValue | null>(null);
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState("INBOUND");
  const visible = items.filter(
    (message) =>
      (folder === "DRAFT"
        ? message.status === "DRAFT"
        : message.direction === folder) &&
      `${text(message.fromEmail)} ${text(message.toEmail)} ${text(message.subject)} ${text(message.body)}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selected =
    visible.find((message) => message.id === selection?.id) ||
    visible[0] ||
    null;
  return (
    <>
      <SectionHeading
        eyebrow="WHERE OPPORTUNITY REPLIES"
        title="Conversations"
        detail="Incoming replies, clear intent and a thoughtful next step."
      />
      <div className="inbox-folders" role="group" aria-label="Message folders">
        {[
          { id: "INBOUND", title: "Received" },
          { id: "OUTBOUND", title: "Sent & queued" },
          { id: "DRAFT", title: "Drafts" },
        ].map((item) => (
          <button
            key={item.id}
            className={folder === item.id ? "active" : ""}
            aria-pressed={folder === item.id}
            onClick={() => {
              setFolder(item.id);
              setSelected(null);
            }}
          >
            {item.title}
            <span>
              {
                items.filter((message) =>
                  item.id === "DRAFT"
                    ? message.status === "DRAFT"
                    : message.direction === item.id,
                ).length
              }
            </span>
          </button>
        ))}
      </div>
      <div className="surface inbox-layout">
        <div className="inbox-list">
          <div className="search-input">
            <Search size={16} />
            <input
              aria-label="Search inbox"
              placeholder="Search conversations…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {visible.map((message) => (
            <button
              key={text(message.id)}
              className={`inbox-item ${message.id === selected?.id ? "selected" : ""}`}
              onClick={() => setSelected(message)}
            >
              <span className="inbox-item-heading">
                <b>
                  {text(
                    message.fromName ??
                      object(message.lead).company ??
                      message.fromEmail,
                  )}
                </b>
                <small>{date(message.receivedAt ?? message.createdAt)}</small>
              </span>
              <strong>{text(message.subject)}</strong>
              <p>{text(message.body ?? message.snippet)}</p>
              <Badge
                value={
                  message.direction === "INBOUND"
                    ? (message.classification ?? "UNCLASSIFIED")
                    : message.status
                }
              />
            </button>
          ))}
        </div>
        <div className="inbox-message">
          {selected ? (
            <>
              <div className="card-heading">
                <div>
                  <p className="eyebrow">
                    {label(selected.classification ?? "Incoming reply")}
                  </p>
                  <h3>{text(selected.subject)}</h3>
                </div>
                <Badge value={selected.status ?? "RECEIVED"} />
              </div>
              <div className="message-sender">
                <span className="company-avatar">
                  <Mail size={19} />
                </span>
                <span>
                  <b>{text(selected.fromName ?? selected.fromEmail)}</b>
                  <small>
                    {text(selected.fromEmail)} ·{" "}
                    {date(selected.receivedAt ?? selected.createdAt, true)}
                  </small>
                </span>
              </div>
              <div className="message-text">
                {text(selected.body ?? selected.text ?? selected.snippet)}
              </div>
              {selected.classificationExplanation ||
              selected.classificationReason ? (
                <div className="ai-note">
                  <Sparkles size={18} />
                  <div>
                    <b>Why this classification</b>
                    <p>
                      {text(
                        selected.classificationExplanation ??
                          selected.classificationReason,
                      )}
                    </p>
                  </div>
                </div>
              ) : null}
              {selected.suggestedReply || selected.suggestedResponse ? (
                <div className="email-preview">
                  <span className="eyebrow">
                    SUGGESTED REPLY · REVIEW REQUIRED
                  </span>
                  <p>
                    {text(
                      selected.suggestedReply ?? selected.suggestedResponse,
                    )}
                  </p>
                </div>
              ) : null}
              {canManage && selected.direction === "INBOUND" && (
                <div className="inline-actions">
                  <button
                    className="primary"
                    onClick={() =>
                      openDialog({
                        title: "Reply to this conversation",
                        detail:
                          "Review your reply before sending. This will send from your connected business email account.",
                        fields: [
                          {
                            name: "subject",
                            label: "Subject line",
                            required: true,
                            value: `Re: ${text(selected.subject, "").replace(/^Re:\s*/i, "")}`,
                          },
                          {
                            name: "body",
                            label: "Your reply",
                            type: "textarea",
                            required: true,
                            value:
                              selected.suggestedReply ??
                              selected.suggestedResponse ??
                              "",
                          },
                          {
                            name: "approved",
                            label:
                              "I have reviewed this reply and approve sending it.",
                            type: "checkbox",
                            required: true,
                          },
                        ],
                        submitLabel: "Send reply",
                        submit: async (input) => {
                          const draft = await act("inbox", {
                            action: "draftReply",
                            messageId: selected.id,
                            body: input.body,
                            subject: input.subject,
                          });
                          return act("inbox", {
                            action: "approveReply",
                            messageId: object(draft.item).id,
                          });
                        },
                      })
                    }
                  >
                    <Send size={15} />
                    Write a reply
                  </button>
                </div>
              )}
              {canManage &&
              selected.status === "DRAFT" &&
              selected.replyToMessageId ? (
                <button
                  className="primary"
                  onClick={() =>
                    openDialog({
                      title: "Review your reply draft",
                      detail:
                        "Review the exact subject and message before approving delivery from your business mailbox.",
                      initial: selected,
                      fields: [
                        {
                          name: "subject",
                          label: "Subject line",
                          required: true,
                        },
                        {
                          name: "body",
                          label: "Message",
                          type: "textarea",
                          required: true,
                        },
                        {
                          name: "approved",
                          label: "I approve sending this exact reply.",
                          type: "checkbox",
                          required: true,
                        },
                      ],
                      submitLabel: "Approve reply",
                      submit: async (input) => {
                        await act("inbox", {
                          action: "editDraft",
                          messageId: selected.id,
                          subject: input.subject,
                          body: input.body,
                        });
                        return act("inbox", {
                          action: "approveReply",
                          messageId: selected.id,
                        });
                      },
                    })
                  }
                >
                  <ShieldCheck size={15} />
                  Review draft
                </button>
              ) : null}
              {canManage &&
              ["REVIEW_REQUIRED", "SENDING"].includes(text(selected.status)) &&
              selected.direction === "OUTBOUND" ? (
                <div className="alert info">
                  <span>
                    This send needs reconciliation. An uncertain outcome cannot
                    authorize resending.
                  </span>
                  <button
                    onClick={() =>
                      openDialog({
                        title: "Reconcile with Gmail",
                        detail:
                          "Check the connected mailbox's Sent folder using this message's stable ID. This operation does not send another email.",
                        fields: [],
                        submitLabel: "Check provider acceptance",
                        submit: () =>
                          act("mailboxes", {
                            action: "reconcile",
                            id: selected.mailboxId,
                            messageId: selected.id,
                          }),
                      })
                    }
                  >
                    Reconcile with Gmail
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <Empty
              title="The start of something good."
              detail="Replies from your connected email account will appear here, matched to the right business and campaign."
              icon={<Inbox size={31} strokeWidth={1.4} />}
            />
          )}
        </div>
      </div>
    </>
  );
}

function Notifications({ data, act }: ViewProps) {
  const items = rows(data.items);
  return (
    <>
      <SectionHeading
        eyebrow="YOU'RE IN THE LOOP"
        title="Workspace signals"
        detail="New opportunities, campaign updates and conversations that need your attention."
        action={
          <button
            disabled={!items.some((item) => !item.readAt)}
            onClick={() =>
              void act("notifications", { action: "read-all" }).catch(() => {})
            }
          >
            <CircleCheck size={16} />
            Mark all as read
          </button>
        }
      />
      <div className="surface notification-list">
        {items.length ? (
          items.map((notification) => (
            <button
              className={`notification-item ${notification.readAt ? "" : "unread"}`}
              key={text(notification.id)}
              onClick={() =>
                void act("notifications", {
                  action: "read",
                  id: notification.id,
                }).catch(() => {})
              }
            >
              <span className="notification-icon">
                <Mail size={18} />
              </span>
              <span>
                <b>{text(notification.title ?? notification.kind)}</b>
                <p>{text(notification.body ?? notification.message)}</p>
                <small>{date(notification.createdAt, true)}</small>
              </span>
              {!notification.readAt && <i className="unread-dot" />}
            </button>
          ))
        ) : (
          <Empty
            title="You're all caught up."
            detail="When a new lead, reply or campaign update needs your attention, you'll find it here."
          />
        )}
      </div>
    </>
  );
}

function downloadCsv(filename: string, values: RecordValue[]) {
  if (!values.length) return;
  const keys = [
    ...new Set(values.flatMap((value) => Object.keys(value))),
  ].filter(
    (key) =>
      !values.some(
        (value) => typeof value[key] === "object" && value[key] !== null,
      ),
  );
  const escape = (value: unknown) => {
    let result = text(value, "");
    if (/^[=+@\-\t\r]/.test(result)) result = "'" + result;
    return '"' + result.replace(/"/g, '""') + '"';
  };
  const csv = [
    keys.map(escape).join(","),
    ...values.map((value) => keys.map((key) => escape(value[key])).join(",")),
  ].join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
function Reports({ data, organization }: ViewProps) {
  const [range, setRange] = useState("30");
  const [report, setReport] = useState(data);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const metrics = object(report.metrics);
  const series = rows(report.series);
  const campaigns = rows(report.campaigns);
  async function changeRange(value: string) {
    setRange(value);
    setLoading(true);
    setError("");
    try {
      setReport(
        await api(
          `/api/platform/${organization.workspaceId}/reports?${value === "custom" ? new URLSearchParams({ start: new Date(`${start}T00:00:00`).toISOString(), end: new Date(new Date(`${end}T00:00:00`).getTime() + 86400000).toISOString() }) : ["today", "yesterday"].includes(value) ? `period=${value}` : `days=${value}`}`,
        ),
      );
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <SectionHeading
        eyebrow="PROGRESS, WITH PERSPECTIVE"
        title="Performance intelligence"
        detail="A clear view of your outreach, built from recorded business and provider events."
        action={
          <div className="inline-actions">
            <button
              onClick={() =>
                downloadCsv(
                  "monettic-performance.csv",
                  series.length ? series : [metrics],
                )
              }
            >
              <ArrowDownToLine size={15} />
              Export CSV
            </button>
            <button onClick={() => window.print()}>
              <FileText size={15} />
              Print / PDF
            </button>
          </div>
        }
      />
      <div className="report-controls">
        <div className="segmented-control">
          {[
            { value: "today", label: "Today" },
            { value: "yesterday", label: "Yesterday" },
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
          ].map((option) => (
            <button
              className={range === option.value ? "active" : ""}
              key={option.value}
              disabled={loading}
              onClick={() => void changeRange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p>{loading ? "Updating your report…" : "Recorded activity only"}</p>
      </div>
      <form
        className="report-dates"
        onSubmit={(event) => {
          event.preventDefault();
          void changeRange("custom");
        }}
      >
        <label>
          From
          <input
            type="date"
            required
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        <label>
          Through
          <input
            type="date"
            required
            min={start}
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </label>
        <button disabled={loading}>Apply custom range</button>
      </form>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <Metrics data={metrics} />
      <div className="surface">
        <SeriesChart values={series} />
      </div>
      <div className="metric-grid secondary-metrics">
        {[
          { label: "Leads collected", key: "totalLeads" },
          { label: "Hot leads", key: "hotLeads" },
          { label: "Emails delivered", key: "emailsDelivered" },
          { label: "Replies received", key: "replies" },
          { label: "Meetings requested", key: "meetingsRequested" },
          { label: "Bounced emails", key: "bounces" },
          { label: "Unsubscribed", key: "unsubscribes" },
          { label: "Emails scheduled", key: "emailsScheduled" },
        ].map((metric) => (
          <div className="metric-card" key={metric.key}>
            <span className="subtle">{metric.label}</span>
            <strong>{count(metrics[metric.key])}</strong>
          </div>
        ))}
      </div>
      <div className="surface section-space">
        <div className="card-heading">
          <h3>Campaign performance</h3>
          <span className="subtle">Your recorded results</span>
        </div>
        {campaigns.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th>Sent</th>
                  <th>Replies</th>
                  <th>Positive replies</th>
                  <th>Bounces</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign, index) => (
                  <tr key={text(campaign.id, String(index))}>
                    <td>
                      <b>{text(campaign.name)}</b>
                    </td>
                    <td>
                      <Badge value={campaign.status} />
                    </td>
                    <td>{count(campaign.sent ?? campaign.emailsSent)}</td>
                    <td>{count(campaign.replies)}</td>
                    <td>{count(campaign.positiveReplies)}</td>
                    <td>{count(campaign.bounces)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Results need a little momentum."
            detail="Your campaign performance will appear after recorded outreach begins."
          />
        )}
        <p className="fine-print report-note">
          Provider acceptance is distinct from confirmed delivery. Open tracking
          is shown only when reliable provider events are available.
        </p>
      </div>
    </>
  );
}
