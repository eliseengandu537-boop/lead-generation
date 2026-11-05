"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Bot,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  CreditCard,
  ExternalLink,
  Globe2,
  Inbox,
  KeyRound,
  Phone,
  LayoutDashboard,
  Menu,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
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
  Empty,
  Loading,
  ConcreteMark,
  SectionHeading,
  type Dialog,
} from "./primitives";
import { ThemeToggle } from "./theme";
import { MetricNumber, TrendChart } from "./charts";
import { ClientLoginDialog } from "./client-login-dialog";
import AssistantScreen from "./assistant-screen";
import CallCentre from "./call-centre";
import { AdminBookingBell } from "./admin-booking-bell";

const navigation = [
  {
    id: "assistant",
    label: "AI Assistant",
    icon: Bot,
    detail: "Ask your OpenAI assistant to work with your clients and outreach.",
  },
  {
    id: "command",
    label: "Command Centre",
    icon: LayoutDashboard,
    detail: "Every business. One clear perspective.",
  },
  {
    id: "clients",
    label: "Clients",
    icon: Users,
    detail: "The businesses building their next chapter.",
  },
  {
    id: "websites",
    label: "Websites",
    icon: Globe2,
    detail: "A closer look at every connected business.",
  },
  {
    id: "leads",
    label: "Lead Intelligence",
    icon: Radar,
    detail: "From discovery to meaningful opportunity.",
  },
  {
    id: "outreach",
    label: "Email Outreach",
    icon: Send,
    detail: "Understand the health of every conversation.",
  },
  {
    id: "call-centre",
    label: "Call Centre",
    icon: Phone,
    detail: "Caller access, conversations, qualified prospects and bookings.",
  },
  {
    id: "inbox",
    label: "Inbox Monitoring",
    icon: Inbox,
    detail: "Response signals without private email content.",
  },
  {
    id: "automation",
    label: "Automation Centre",
    icon: Bot,
    detail: "The operations behind every outcome.",
  },
  {
    id: "analytics",
    label: "Analytics",
    icon: ChartNoAxesCombined,
    detail: "A precise view of platform performance.",
  },
  {
    id: "subscriptions",
    label: "Subscriptions",
    icon: CreditCard,
    detail: "Plans, allowances and client subscriptions.",
  },
  {
    id: "settings",
    label: "Platform Settings",
    icon: Settings2,
    detail: "A clear picture of platform readiness.",
  },
];
const compact = (value: unknown) => number(value).toLocaleString("en-ZA");
const positiveMetrics = [
  { key: "replies", label: "Replies" },
  { key: "positive", label: "Positive replies" },
];

export default function AdminScreen() {
  const [data, setData] = useState<RecordValue>({});
  const [insights, setInsights] = useState<RecordValue>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [clientLogin, setClientLogin] = useState<{
    workspaceId?: string;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState("assistant");
  const [mobile, setMobile] = useState(false);
  const [days, setDays] = useState("30");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [range, setRange] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [sort, setSort] = useState("activity");
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<RecordValue | null>(null);
  const [detailError, setDetailError] = useState("");
  const [jobStatus, setJobStatus] = useState("ALL");
  const [campaignStatus, setCampaignStatus] = useState("ALL");
  const inspector = useRef<HTMLElement>(null);
  const period = range || `days=${days}`;
  useEffect(() => { if (new URLSearchParams(window.location.search).get("section") === "call-centre") setTab("call-centre"); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void Promise.all([
      api("/api/platform/admin", "GET", undefined, controller.signal),
      api(
        `/api/platform/admin/insights?${period}`,
        "GET",
        undefined,
        controller.signal,
      ),
    ])
      .then(([base, view]) => {
        if (!controller.signal.aborted) {
          setData(base);
          setInsights(view);
        }
      })
      .catch((problem) => {
        if (!controller.signal.aborted) setError(problem.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision, period]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    void api(
      `/api/platform/admin/insights?${period}&workspaceId=${encodeURIComponent(selected)}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setDetail(result);
          setDetailError("");
        }
      })
      .catch((problem) => {
        if (!controller.signal.aborted) setDetailError(problem.message);
      });
    return () => controller.abort();
  }, [selected, revision, period]);
  useEffect(() => {
    if (!selected && !mobile) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelected("");
        setMobile(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, mobile]);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inspector.current?.focus();
    function trap(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const elements = Array.from(
        inspector.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], select, input, [tabindex='0']",
        ) || [],
      );
      const first = elements[0],
        last = elements.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === inspector.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", trap);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [selected]);
  async function act(input: RecordValue) {
    const result = await api("/api/platform/admin", "POST", input);
    setNotice(text(result.message, "Platform settings updated."));
    setRevision((value) => value + 1);
    return result;
  }
  function navigate(id: string) {
    setTab(id === "campaigns" ? "outreach" : id);
    setMobile(false);
    setSearch("");
    setStatus("ALL");
    setSelected("");
  }
  function inspect(id: string) {
    if (id === selected) return;
    setDetail(null);
    setDetailError("");
    setSelected(id);
  }
  const organizations = rows(data.organizations),
    plans = rows(data.plans),
    totals = object(insights.totals),
    directory = rows(insights.directory),
    series = rows(insights.series),
    configuration = object(insights.configuration);
  const [operationBusiness, setOperationBusiness] = useState("");
  function workspaceTools(view: string, title: string) {
    const available = organizations.filter(
      (item) => item.status === "ACTIVE" && item.onboardingStatus !== "DEMO",
    );
    const chosen = available.some(
      (item) => item.workspaceId === operationBusiness,
    )
      ? operationBusiness
      : text(available[0]?.workspaceId, "");
    if (!chosen) return null;
    return (
      <div className="surface admin-workspace-tools">
        <label>
          Client business
          <select
            value={chosen}
            onChange={(event) => setOperationBusiness(event.target.value)}
          >
            {available.map((item) => (
              <option
                key={text(item.workspaceId)}
                value={text(item.workspaceId)}
              >
                {text(item.name)}
              </option>
            ))}
          </select>
        </label>
        <Link
          className="button primary"
          href={`/?client=${encodeURIComponent(chosen)}&view=${view}`}
        >
          {title}
          <ArrowUpRight size={16} />
        </Link>
      </div>
    );
  }
  const active = navigation.find((item) => item.id === tab)!;
  const lookup = new Map(
    directory.map((organization) => [
      text(organization.workspaceId),
      organization,
    ]),
  );
  const filtered = useMemo(
    () =>
      rows(insights.directory)
        .filter(
          (organization) =>
            `${text(organization.name, "")} ${text(organization.websiteUrl, "")} ${text(organization.accountEmail, "")} ${text(organization.industry, "")}`
              .toLowerCase()
              .includes(search.toLowerCase()) &&
            (status === "ALL" ||
              organization.connectionStatus === status ||
              organization.analysisStatus === status),
        )
        .sort((a, b) =>
          sort === "name"
            ? text(a.name).localeCompare(text(b.name))
            : sort === "leads"
              ? number(b.leads) - number(a.leads)
              : sort === "sent"
                ? number(b.sent) - number(a.sent)
                : new Date(text(b.lastActivity)).getTime() -
                  new Date(text(a.lastActivity)).getTime(),
        ),
    [insights.directory, search, status, sort],
  );

  function planEditor(plan?: RecordValue) {
    setDialog({
      title: plan ? "Configure subscription plan" : "Create subscription plan",
      detail:
        "Set the pricing, capabilities and allowances for this platform plan.",
      initial: plan
        ? {
            ...plan,
            features: Array.isArray(plan.features)
              ? plan.features.join("\n")
              : "",
          }
        : undefined,
      fields: [
        { name: "id", label: "Plan identifier", required: true },
        { name: "name", label: "Plan name", required: true },
        {
          name: "priceMinor",
          label: "Monthly price in currency minor units",
          type: "number",
          min: 0,
          hint: "10000 means 100.00 in a currency with 100 minor units. Leave blank for arranged pricing.",
        },
        {
          name: "currency",
          label: "Currency code",
          required: true,
          value: "ZAR",
        },
        {
          name: "monthlyProspects",
          label: "Monthly business discoveries",
          type: "number",
          required: true,
          min: 0,
        },
        {
          name: "dailyEmails",
          label: "Daily email allowance",
          type: "number",
          required: true,
          min: 0,
        },
        {
          name: "dailyAi",
          label: "Daily AI operations",
          type: "number",
          required: true,
          min: 0,
        },
        {
          name: "teamMembers",
          label: "Team members",
          type: "number",
          required: true,
          min: 1,
        },
        {
          name: "features",
          label: "Plan features",
          type: "textarea",
          hint: "One feature per line.",
        },
        {
          name: "available",
          label: "Make this plan available to clients",
          type: "checkbox",
          value: false,
        },
      ],
      submitLabel: "Save plan",
      submit: (input) =>
        act({
          ...input,
          action: "plan",
          priceMinor: input.priceMinor === "" ? null : input.priceMinor,
          features: String(input.features || "")
            .split("\n")
            .map((value) => value.trim())
            .filter(Boolean),
        }),
    });
  }
  function subscriptionEditor(organization: RecordValue) {
    const subscription = object(organization.subscription);
    setDialog({
      title: "Manage business subscription",
      detail: `Assign a configured plan to ${text(organization.name)}. Paid activation requires a verified billing reference.`,
      fields: [
        {
          name: "planId",
          label: "Subscription plan",
          type: "select",
          required: true,
          options: plans.map((plan) => ({
            value: text(plan.id),
            label: text(plan.name),
          })),
          value: subscription.planId,
        },
        {
          name: "status",
          label: "Subscription status",
          type: "select",
          required: true,
          value: subscription.status || "ACTIVE",
          options: ["TRIAL", "ACTIVE", "SUSPENDED", "EXPIRED", "CANCELLED"].map(
            (value) => ({ value, label: label(value) }),
          ),
        },
        {
          name: "providerReference",
          label: "Verified payment or billing reference",
          value: subscription.providerReference || "",
          hint: "Required when activating a paid subscription.",
        },
        {
          name: "periodEnd",
          label: "Subscription ends at",
          type: "datetime-local",
          value: subscription.periodEnd || "",
        },
      ],
      submitLabel: "Assign subscription",
      submit: (input) =>
        act({
          action: "subscription",
          workspaceId: organization.workspaceId,
          ...input,
          periodEnd: input.periodEnd
            ? new Date(String(input.periodEnd)).toISOString()
            : null,
        }),
    });
  }
  function changeAccess(organization: RecordValue) {
    setDialog({
      title:
        organization.status === "ACTIVE"
          ? "Suspend business access"
          : "Activate business access",
      detail: `Update workspace access for ${text(organization.name)}. Suspended accounts cannot use protected business resources.`,
      fields: [
        {
          name: "confirmed",
          label: "Apply this account status change.",
          type: "checkbox",
          required: true,
        },
      ],
      submitLabel: "Update access",
      submit: () =>
        act({
          action: "organization-status",
          workspaceId: organization.workspaceId,
          status: organization.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
        }),
    });
  }
  function metrics(
    items: { key: string; name: string; detail?: string }[],
    source = totals,
  ) {
    return (
      <div className="metric-grid admin-metrics">
        {items.map((item, index) => (
          <article className="metric-card" key={item.key}>
            <div className="metric-topline">
              <span>{item.name}</span>
              <span className="metric-index">
                {String(index + 1).padStart(2, "0")}
              </span>
            </div>
            <strong>
              <MetricNumber value={source[item.key]} />
            </strong>
            <small>{item.detail || "Recorded across the platform"}</small>
          </article>
        ))}
      </div>
    );
  }
  function chart(
    title: string,
    description: string,
    metricsList: { key: string; label: string }[],
    values = series,
  ) {
    return (
      <div className="surface admin-chart">
        <TrendChart
          values={values}
          title={title}
          description={description}
          metrics={metricsList}
        />
      </div>
    );
  }
  function campaignTable(campaigns: RecordValue[]) {
    return campaigns.length ? (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Client</th>
              <th>Status</th>
              <th>Audience</th>
              <th>Emails</th>
              <th>Replies</th>
              <th>Positive</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((campaign) => (
              <tr key={text(campaign.id)}>
                <td>
                  <b>{text(campaign.name)}</b>
                  {!!campaign.safetyPauseReason && (
                    <small>{label(campaign.safetyPauseReason)}</small>
                  )}
                </td>
                <td>
                  <button
                    className="text-button"
                    onClick={() => inspect(text(campaign.workspaceId))}
                  >
                    {text(
                      lookup.get(text(campaign.workspaceId))?.name,
                      "View business",
                    )}
                  </button>
                </td>
                <td>
                  <Badge value={campaign.status} />
                </td>
                <td>{compact(campaign.recipients)}</td>
                <td>{compact(campaign.sent)}</td>
                <td>{compact(campaign.replies)}</td>
                <td>{compact(campaign.positive)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty
        title="The next campaign starts with a business."
        detail="Client campaigns and their recorded outcomes will appear here."
      />
    );
  }
  function executionTable(jobs: RecordValue[]) {
    return jobs.length ? (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Workflow</th>
              <th>Client</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Created</th>
              <th>Next / completed</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={text(job.id)}>
                <td>
                  <b>{label(job.kind)}</b>
                  <small>{text(job.id).slice(0, 12)}</small>
                </td>
                <td>
                  <button
                    className="text-button"
                    onClick={() => inspect(text(job.workspaceId))}
                  >
                    {text(
                      lookup.get(text(job.workspaceId))?.name,
                      "View business",
                    )}
                  </button>
                </td>
                <td>
                  <Badge value={job.status} />
                </td>
                <td>
                  {compact(job.attempts)}
                  <small>{compact(job.dispatchAttempts)} dispatches</small>
                </td>
                <td>{date(job.createdAt, true)}</td>
                <td>{date(job.completedAt || job.runAt, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty
        title="No executions in this date range."
        detail="Widen the date range to inspect earlier workflow activity."
      />
    );
  }
  function directoryView() {
    return (
      <div className="surface admin-directory">
        <div className="card-heading">
          <div>
            <p className="eyebrow">CONNECTED BUSINESSES</p>
            <h3>Website directory</h3>
          </div>
          <span className="muted">
            {filtered.length} of {directory.length} businesses
          </span>
        </div>
        <div className="admin-filterbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Search websites"
              placeholder="Search websites, clients or industries…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select
            aria-label="Filter websites"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {[
              "ALL",
              "CONNECTED",
              "NOT_CONNECTED",
              "SUSPENDED",
              "APPROVED",
              "AWAITING_REVIEW",
              "NOT_ANALYZED",
            ].map((value) => (
              <option key={value} value={value}>
                {value === "ALL" ? "All statuses" : label(value)}
              </option>
            ))}
          </select>
          <select
            aria-label="Sort websites"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="activity">Recent activity</option>
            <option value="name">Business name</option>
            <option value="leads">Most leads</option>
            <option value="sent">Most emails</option>
          </select>
        </div>
        {filtered.length ? (
          <div className="table-scroll">
            <table className="website-table">
              <thead>
                <tr>
                  <th>Website / business</th>
                  <th>Client account</th>
                  <th>Connection / analysis</th>
                  <th>Industry / target market</th>
                  <th>Discovered / qualified</th>
                  <th>Emails / replies</th>
                  <th>Active campaigns</th>
                  <th>Last activity</th>
                  <th>
                    <span className="sr-only">Inspect website</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((organization) => (
                  <tr key={text(organization.workspaceId)}>
                    <td>
                      <button
                        className="directory-name"
                        onClick={() => inspect(text(organization.workspaceId))}
                      >
                        <span className="site-monogram">
                          {text(organization.name).slice(0, 1)}
                        </span>
                        <span>
                          <b>{text(organization.name)}</b>
                          <small>
                            {text(
                              organization.websiteUrl,
                              "Website not connected",
                            )}
                          </small>
                        </span>
                      </button>
                    </td>
                    <td>
                      {text(
                        organization.accountEmail,
                        "No client administrator",
                      )}
                      <small>
                        {text(organization.planName, "Unassigned plan")}
                      </small>
                    </td>
                    <td>
                      <Badge value={organization.connectionStatus} />
                      <small>
                        <Badge value={organization.analysisStatus} />
                      </small>
                    </td>
                    <td>
                      {text(organization.industry, "Not analyzed")}
                      <small className="truncate-text">
                        {text(
                          organization.targetMarket,
                          "Target market not reviewed",
                        )}
                      </small>
                    </td>
                    <td>
                      <b>{compact(organization.discovered)}</b>
                      <small>{compact(organization.qualified)} qualified</small>
                    </td>
                    <td>
                      <b>{compact(organization.sent)}</b>
                      <small>{compact(organization.replies)} replies</small>
                    </td>
                    <td>{compact(organization.activeCampaigns)}</td>
                    <td>{date(organization.lastActivity, true)}</td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Inspect ${text(organization.name)}`}
                        onClick={() => inspect(text(organization.workspaceId))}
                      >
                        <ArrowUpRight size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={
              directory.length
                ? "No websites match these filters."
                : "Your website directory starts here."
            }
            detail={
              directory.length
                ? "Try another business name, industry or connection status."
                : "Every connected client website will appear here with real performance data."
            }
          />
        )}
        <p className="table-caption">
          Lifetime business metrics · Directory shows up to{" "}
          {compact(insights.directoryLimit)} recently registered clients.
        </p>
      </div>
    );
  }
  const inspected = rows(detail?.directory)[0];
  return (
    <div className={`app-shell admin-shell ${mobile ? "nav-open" : ""}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {mobile && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className="sidebar admin-sidebar" aria-label="Platform navigation">
        <div className="sidebar-brand">
          <Link href="/admin" className="brand">
            <ConcreteMark />
            <span>
              CONCRETE<span className="brand-dot">.</span>
            </span>
          </Link>
          <button
            className="icon-button mobile-menu"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X size={19} />
          </button>
        </div>
        <div className="admin-scope">
          <ShieldCheck size={16} />
          <span>PLATFORM ADMINISTRATION</span>
        </div>
        <nav>
          <p className="nav-label">COMMAND & CONTROL</p>
          {navigation.map(({ id, label: title, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${tab === id ? "active" : ""}`}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={18} />
              <span>{title}</span>
              {id === "automation" && number(totals.failed) > 0 && (
                <span className="nav-count">{compact(totals.failed)}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Link href="/?client=1" className="nav-item">
            <ArrowLeft size={18} />
            <span>Client workspace</span>
          </Link>
          <div className="sidebar-profile">
            <span className="avatar">A</span>
            <div>
              <b>Platform administrator</b>
              <small>Super admin access</small>
            </div>
            <ShieldCheck size={16} />
          </div>
        </div>
      </aside>
      <div className="workspace-main admin-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span>Platform</span>
            <span className="breadcrumb-divider">/</span>
            <b>{active.label}</b>
          </div>
          <div className="topbar-actions">
            <span className="admin-recorded">
              <span />
              Recorded platform data
            </span>
            <ThemeToggle compact />
            <AdminBookingBell openMeetings={() => navigate("call-centre")} />
            <button
              className="icon-button"
              aria-label="Refresh platform data"
              disabled={loading}
              onClick={() => setRevision((value) => value + 1)}
            >
              <RefreshCw size={17} className={loading ? "spin" : ""} />
            </button>
            <span className="topbar-avatar">A</span>
          </div>
        </header>
        <main className="page-content admin-content" id="main-content">
          {!["assistant", "call-centre"].includes(tab) && (
            <>
              <SectionHeading
                eyebrow="THE PLATFORM PERSPECTIVE"
                title={active.label}
                detail={active.detail}
                action={
                  <div className="admin-period">
                    <span className="muted">Chart period</span>
                    {["7", "30", "90"].map((value) => (
                      <button
                        key={value}
                        className={!range && days === value ? "selected" : ""}
                        aria-pressed={!range && days === value}
                        onClick={() => {
                          setDays(value);
                          setRange("");
                        }}
                      >
                        {value} days
                      </button>
                    ))}
                  </div>
                }
              />
              <div className="admin-datebar">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (from && to) {
                      setRange(
                        `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
                      );
                    }
                  }}
                >
                  <label>
                    From
                    <input
                      type="date"
                      aria-label="Start date"
                      value={from}
                      required
                      onChange={(event) => setFrom(event.target.value)}
                    />
                  </label>
                  <label>
                    To
                    <input
                      type="date"
                      aria-label="End date"
                      value={to}
                      min={from || undefined}
                      required
                      onChange={(event) => setTo(event.target.value)}
                    />
                  </label>
                  <button type="submit">Apply range</button>
                </form>
                <span>
                  Charts: {text(object(insights.range).from, "—")} —{" "}
                  {text(object(insights.range).to, "—")} · SAST
                </span>
              </div>
            </>
          )}
          {error && (
            <div className="alert error" role="alert">
              <span>{error}</span>
              <button onClick={() => setRevision((value) => value + 1)}>
                Try again
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
          {loading ? (
            <Loading />
          ) : (
            <div className="admin-view" key={tab}>
              {tab === "assistant" && (
                <AssistantScreen
                  clients={organizations}
                  onCreateClient={() => setClientLogin({})}
                />
              )}
              {tab === "call-centre" && <CallCentre />}
              {tab === "command" && (
                <>
                  <div className="admin-intro">
                    <div>
                      <p className="eyebrow">BUSINESS, IN FULL VIEW</p>
                      <h2>
                        Your platform.
                        <br />
                        <span>Every possibility.</span>
                      </h2>
                      <p>
                        A precise perspective on the clients, conversations and
                        opportunities moving through CONCRETE.
                      </p>
                    </div>
                    <div className="admin-intro-stat">
                      <span>Connected business websites</span>
                      <strong>
                        <MetricNumber value={totals.websites} />
                      </strong>
                      <button
                        className="text-button"
                        onClick={() => navigate("websites")}
                      >
                        Open website directory <ArrowUpRight size={16} />
                      </button>
                    </div>
                  </div>
                  {metrics([
                    { key: "clients", name: "Registered clients" },
                    { key: "activeClients", name: "Active clients" },
                    {
                      key: "sent",
                      name: "Outreach emails",
                      detail: "Accepted by the sending provider",
                    },
                    { key: "qualified", name: "Qualified leads" },
                    { key: "positive", name: "Positive replies" },
                    { key: "activeCampaigns", name: "Active campaigns" },
                    { key: "executions", name: "Automation executions" },
                    { key: "failed", name: "Executions to review" },
                  ])}
                  <div className="admin-analytics-grid">
                    {chart(
                      "Conversations in motion",
                      "Accepted emails and prospect responses in the selected period.",
                      [
                        { key: "sent", label: "Emails sent" },
                        ...positiveMetrics,
                      ],
                    )}
                    <div className="surface admin-signal">
                      <div className="card-heading">
                        <div>
                          <p className="eyebrow">OPERATIONS SIGNAL</p>
                          <h3>At a glance</h3>
                        </div>
                        <Activity size={19} />
                      </div>
                      {[
                        {
                          name: "Active campaigns",
                          value: totals.activeCampaigns,
                          id: "campaigns",
                        },
                        {
                          name: "Workflow queue",
                          value: totals.pending,
                          id: "automation",
                        },
                        {
                          name: "Recorded usage units",
                          value: totals.usage,
                          id: "analytics",
                        },
                        {
                          name: "Workflows to review",
                          value: totals.failed,
                          id: "automation",
                        },
                      ].map((item) => (
                        <button
                          className="admin-signal-row"
                          key={item.name}
                          onClick={() => navigate(item.id)}
                        >
                          <span>{item.name}</span>
                          <b>{compact(item.value)}</b>
                          <ChevronRight size={15} />
                        </button>
                      ))}
                      <p className="muted">
                        Lifetime totals. Open each area for detailed recorded
                        activity.
                      </p>
                    </div>
                  </div>
                  {directoryView()}
                </>
              )}
              {tab === "clients" && (
                <>
                  {metrics([
                    { key: "clients", name: "Registered clients" },
                    { key: "activeClients", name: "Active accounts" },
                    { key: "websites", name: "Connected websites" },
                  ])}
                  <div className="surface">
                    <div className="card-heading">
                      <div>
                        <h3>Client accounts</h3>
                        <span className="subtle">
                          {organizations.length} businesses
                        </span>
                      </div>
                      <button
                        className="primary"
                        onClick={() => setClientLogin({})}
                      >
                        <KeyRound size={16} />
                        Create client login
                      </button>
                    </div>
                    {organizations.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Business / website</th>
                              <th>Status</th>
                              <th>Leads</th>
                              <th>Campaigns</th>
                              <th>Team</th>
                              <th>Client logins</th>
                              <th>Subscription</th>
                              <th>Manage</th>
                            </tr>
                          </thead>
                          <tbody>
                            {organizations.map((organization) => (
                              <tr key={text(organization.workspaceId)}>
                                <td>
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      inspect(text(organization.workspaceId))
                                    }
                                  >
                                    <b>{text(organization.name)}</b>
                                  </button>
                                  <small>
                                    {text(
                                      organization.websiteUrl,
                                      "Website not connected",
                                    )}
                                  </small>
                                </td>
                                <td>
                                  <Badge value={organization.status} />
                                </td>
                                <td>
                                  {compact(object(organization.counts).leads)}
                                </td>
                                <td>
                                  {compact(
                                    object(organization.counts).campaigns,
                                  )}
                                </td>
                                <td>
                                  {compact(object(organization.counts).members)}
                                </td>
                                <td>
                                  {rows(organization.clientLogins).length ? (
                                    rows(organization.clientLogins).map(
                                      (client) => (
                                        <small key={text(client.id)}>
                                          {text(client.email)}
                                        </small>
                                      ),
                                    )
                                  ) : (
                                    <small>No client login yet</small>
                                  )}
                                </td>
                                <td>
                                  {text(
                                    object(
                                      object(organization.subscription).plan,
                                    ).name ??
                                      object(organization.subscription).planId,
                                    "Unassigned",
                                  )}
                                  <small>
                                    <Badge
                                      value={
                                        object(organization.subscription)
                                          .status || "UNASSIGNED"
                                      }
                                    />
                                  </small>
                                </td>
                                <td>
                                  <div className="row-actions">
                                    <Link
                                      href={`/?client=${encodeURIComponent(text(organization.workspaceId))}&view=settings`}
                                    >
                                      Edit client
                                    </Link>
                                    <Link
                                      href={`/?client=${encodeURIComponent(text(organization.workspaceId))}&view=campaigns`}
                                    >
                                      Create and send
                                    </Link>
                                    {organization.status === "ACTIVE" &&
                                      organization.onboardingStatus !==
                                        "DEMO" && (
                                        <button
                                          aria-label={`Create login for ${text(organization.name)}`}
                                          onClick={() =>
                                            setClientLogin({
                                              workspaceId: text(
                                                organization.workspaceId,
                                              ),
                                            })
                                          }
                                        >
                                          <KeyRound size={14} />
                                          Create login
                                        </button>
                                      )}
                                    <button
                                      onClick={() => changeAccess(organization)}
                                    >
                                      {organization.status === "ACTIVE"
                                        ? "Suspend"
                                        : "Activate"}
                                    </button>
                                    <button
                                      onClick={() =>
                                        subscriptionEditor(organization)
                                      }
                                    >
                                      <CreditCard size={14} />
                                      Plan
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
                        title="Your platform is ready for its first business."
                        detail="Registered businesses appear here with their access and subscriptions."
                      />
                    )}
                  </div>
                </>
              )}
              {tab === "websites" && (
                <>
                  {metrics([
                    { key: "websites", name: "Connected websites" },
                    { key: "discovered", name: "Businesses discovered" },
                    { key: "qualified", name: "Qualified opportunities" },
                  ])}
                  {directoryView()}
                </>
              )}
              {tab === "leads" && (
                <>
                  {workspaceTools("leads", "Add or edit leads")}
                  {metrics([
                    { key: "discovered", name: "Businesses discovered" },
                    { key: "qualified", name: "Qualified leads" },
                    { key: "meetings", name: "Meeting requests" },
                  ])}
                  <div className="admin-analytics-grid">
                    {chart(
                      "Opportunity, over time",
                      "Businesses added to client lead directories.",
                      [{ key: "leads", label: "Businesses discovered" }],
                    )}
                    <div className="surface">
                      <div className="card-heading">
                        <h3>Qualification mix</h3>
                        <Radar size={19} />
                      </div>
                      <div className="admin-usage-list">
                        {rows(insights.leadCategories).map((category) => (
                          <div key={text(category.category)}>
                            <span>{label(category.category)}</span>
                            <b>{compact(category.count)}</b>
                          </div>
                        ))}
                      </div>
                      {!rows(insights.leadCategories).length && (
                        <Empty
                          title="Intelligence begins with discovery."
                          detail="Lead qualification categories appear after research is recorded."
                        />
                      )}
                    </div>
                  </div>
                  {directoryView()}
                </>
              )}
              {tab === "outreach" && (
                <>
                  {workspaceTools("mailboxes", "Manage sending mailbox")}
                  {metrics([
                    {
                      key: "sent",
                      name: "Emails sent",
                      detail: "Provider acceptance, not confirmed delivery",
                    },
                    {
                      key: "delivered",
                      name: "Confirmed deliveries",
                      detail: "Recorded delivery events only",
                    },
                    { key: "bounces", name: "Hard bounces" },
                    { key: "complaints", name: "Complaints" },
                  ])}
                  {chart(
                    "Outreach performance",
                    "Only actual provider events contribute to delivery and bounce figures.",
                    [
                      { key: "sent", label: "Sent" },
                      { key: "delivered", label: "Delivered" },
                      { key: "bounces", label: "Bounced" },
                    ],
                  )}
                  <div className="surface section-space">
                    <SectionHeading
                      title="Sending account status"
                      detail="Mailbox readiness across all client businesses."
                    />
                    <div className="admin-status-list">
                      {rows(insights.mailboxStatuses).map((item) => (
                        <div key={text(item.status)}>
                          <Badge value={item.status} />
                          <strong>{compact(item.count)}</strong>
                        </div>
                      ))}
                    </div>
                    {!rows(insights.mailboxStatuses).length && (
                      <Empty
                        title="No client mailboxes connected yet."
                        detail="Clients authorize their own business email account from Email Connections."
                      />
                    )}
                    <p className="table-caption">
                      Gmail confirms acceptance for sending. It does not provide
                      confirmed message delivery or reliable open tracking.
                    </p>
                  </div>
                </>
              )}
              {tab === "outreach" && (
                <>
                  {workspaceTools("campaigns", "Create and send campaign")}
                  {metrics([
                    { key: "campaigns", name: "Total campaigns" },
                    { key: "activeCampaigns", name: "Active campaigns" },
                    { key: "positive", name: "Positive responses" },
                  ])}
                  <div className="surface">
                    <div className="card-heading">
                      <h3>Campaign performance</h3>
                      <select
                        aria-label="Filter campaigns"
                        value={campaignStatus}
                        onChange={(event) =>
                          setCampaignStatus(event.target.value)
                        }
                      >
                        {[
                          "ALL",
                          "DRAFT",
                          "PENDING_APPROVAL",
                          "APPROVED",
                          "RUNNING",
                          "PAUSED",
                          "COMPLETED",
                          "CANCELLED",
                        ].map((value) => (
                          <option key={value} value={value}>
                            {value === "ALL"
                              ? "All campaign statuses"
                              : label(value)}
                          </option>
                        ))}
                      </select>
                    </div>
                    {campaignTable(
                      rows(insights.campaigns).filter(
                        (campaign) =>
                          campaignStatus === "ALL" ||
                          campaign.status === campaignStatus,
                      ),
                    )}
                    <p className="table-caption">
                      Up to 100 recently updated campaigns · Lifetime outcomes
                    </p>
                  </div>
                </>
              )}
              {tab === "inbox" && (
                <>
                  {metrics([
                    { key: "replies", name: "Replies received" },
                    { key: "positive", name: "Positive responses" },
                    { key: "meetings", name: "Meeting requests" },
                  ])}
                  {chart(
                    "Signals of interest",
                    "Response counts from client inboxes. Message contents remain in their workspace.",
                    positiveMetrics,
                  )}
                  <div className="surface section-space">
                    <SectionHeading
                      title="Conversations by business"
                      detail="Aggregate inbox outcomes for platform monitoring."
                    />
                    {directory.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Business</th>
                              <th>Emails sent</th>
                              <th>Replies</th>
                              <th>Positive replies</th>
                              <th>Inspect</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...directory]
                              .sort(
                                (a, b) => number(b.replies) - number(a.replies),
                              )
                              .map((organization) => (
                                <tr key={text(organization.workspaceId)}>
                                  <td>
                                    <b>{text(organization.name)}</b>
                                    <small>
                                      {text(organization.websiteUrl)}
                                    </small>
                                  </td>
                                  <td>{compact(organization.sent)}</td>
                                  <td>{compact(organization.replies)}</td>
                                  <td>{compact(organization.positive)}</td>
                                  <td>
                                    <button
                                      onClick={() =>
                                        inspect(text(organization.workspaceId))
                                      }
                                    >
                                      View business <ArrowUpRight size={14} />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title="Conversations will appear as businesses connect."
                        detail="This view shows response counts without exposing clients' private email content."
                      />
                    )}
                  </div>
                </>
              )}
              {tab === "automation" && (
                <>
                  {metrics([
                    { key: "executions", name: "All executions" },
                    { key: "succeeded", name: "Successful executions" },
                    { key: "failed", name: "Needs attention" },
                    { key: "pending", name: "Queued or in progress" },
                  ])}
                  <div className="admin-connection-banner">
                    <span
                      className={`connection-indicator ${configuration.n8n ? "ready" : ""}`}
                    />
                    <div>
                      <b>n8n orchestration</b>
                      <p>
                        {configuration.n8n
                          ? "Connection configuration is present. Execution outcomes below show actual workflow activity."
                          : "Configure n8n to orchestrate background workflows. No connection is currently configured."}
                      </p>
                    </div>
                    <Badge
                      value={
                        configuration.n8n ? "CONFIGURED" : "NOT_CONFIGURED"
                      }
                    />
                  </div>
                  {chart(
                    "Workflow activity",
                    "Executions created and workflows requiring review in this period.",
                    [
                      { key: "executions", label: "Executions" },
                      { key: "failed", label: "Needs attention" },
                    ],
                  )}
                  <div className="surface section-space">
                    <div className="card-heading">
                      <h3>Execution history</h3>
                      <select
                        aria-label="Filter workflow status"
                        value={jobStatus}
                        onChange={(event) => setJobStatus(event.target.value)}
                      >
                        {[
                          "ALL",
                          "QUEUED",
                          "WAITING_AUTOMATION",
                          "READY",
                          "RUNNING",
                          "SUCCEEDED",
                          "FAILED",
                          "REVIEW_REQUIRED",
                        ].map((value) => (
                          <option key={value} value={value}>
                            {value === "ALL"
                              ? "All execution statuses"
                              : label(value)}
                          </option>
                        ))}
                      </select>
                    </div>
                    {executionTable(
                      rows(insights.jobs).filter(
                        (job) =>
                          jobStatus === "ALL" || job.status === jobStatus,
                      ),
                    )}
                    <p className="table-caption">
                      Up to 100 recent executions in the selected period ·
                      Attempts and dispatches are recorded independently.
                    </p>
                  </div>
                </>
              )}
              {tab === "analytics" && (
                <>
                  <div className="admin-analytics-grid">
                    {chart(
                      "Outreach performance",
                      "Accepted email and response events.",
                      [
                        { key: "sent", label: "Emails sent" },
                        ...positiveMetrics,
                      ],
                    )}
                    {chart(
                      "Client growth",
                      "Newly registered businesses in this period.",
                      [{ key: "clients", label: "New clients" }],
                    )}
                    {chart("Lead generation", "Recorded business discovery.", [
                      { key: "leads", label: "Discovered businesses" },
                    ])}
                    {chart(
                      "Website activity",
                      "Completed website analyses recorded in the selected period.",
                      [{ key: "websites", label: "Website analyses" }],
                    )}
                    {chart(
                      "Automation activity",
                      "Workflow creation and reviews.",
                      [
                        { key: "executions", label: "Executions" },
                        { key: "failed", label: "To review" },
                      ],
                    )}
                    {chart(
                      "Platform usage",
                      "Recorded billable usage units, not estimated provider cost.",
                      [{ key: "usage", label: "Usage units" }],
                    )}
                  </div>
                  <div className="surface section-space">
                    <SectionHeading
                      title="Usage by capability"
                      detail="Actual recorded quantities in your selected date range."
                    />
                    <div className="admin-usage-list">
                      {rows(insights.usage).map((item) => (
                        <div key={text(item.kind)}>
                          <span>{label(item.kind)}</span>
                          <b>{compact(item.quantity)}</b>
                        </div>
                      ))}
                    </div>
                    {!rows(insights.usage).length && (
                      <Empty
                        title="No usage recorded in this period."
                        detail="Operations appear here as clients use connected platform capabilities."
                      />
                    )}
                  </div>
                </>
              )}
              {tab === "subscriptions" && (
                <>
                  <SectionHeading
                    title="Plans built for your businesses"
                    detail="Configure pricing, features and allowances without hardcoded tiers."
                    action={
                      <button className="primary" onClick={() => planEditor()}>
                        <Plus size={16} />
                        Create plan
                      </button>
                    }
                  />
                  <div className="pricing-grid admin-plan-grid">
                    {plans.map((plan) => (
                      <article
                        className="surface plan-card"
                        key={text(plan.id)}
                      >
                        <div className="card-heading">
                          <h3>{text(plan.name)}</h3>
                          <Badge
                            value={plan.available ? "AVAILABLE" : "UNAVAILABLE"}
                          />
                        </div>
                        <p className="plan-price">
                          {plan.priceMinor === null
                            ? "Arranged pricing"
                            : `${text(plan.currency)} ${(number(plan.priceMinor) / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`}
                          <small>/ month</small>
                        </p>
                        <dl className="plan-limits">
                          {[
                            {
                              key: "monthlyProspects",
                              title: "Monthly discoveries",
                            },
                            { key: "dailyEmails", title: "Daily emails" },
                            { key: "dailyAi", title: "Daily AI operations" },
                            { key: "teamMembers", title: "Team members" },
                          ].map((item) => (
                            <div key={item.key}>
                              <dt>{item.title}</dt>
                              <dd>{compact(plan[item.key])}</dd>
                            </div>
                          ))}
                        </dl>
                        {Array.isArray(plan.features) && (
                          <ul className="plan-features">
                            {plan.features.map((feature) => (
                              <li key={text(feature)}>
                                <Check size={14} />
                                {text(feature)}
                              </li>
                            ))}
                          </ul>
                        )}
                        <button onClick={() => planEditor(plan)}>
                          Configure plan <ChevronRight size={14} />
                        </button>
                      </article>
                    ))}
                  </div>
                  {!plans.length && (
                    <Empty
                      title="Design your first subscription plan."
                      detail="Define a price and allowances, then assign the plan to a business."
                    />
                  )}
                  <div className="surface section-space">
                    <SectionHeading
                      title="Business subscriptions"
                      detail="Verified billing references remain required for paid activation."
                    />
                    {organizations.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Business</th>
                              <th>Plan</th>
                              <th>Status</th>
                              <th>Period end</th>
                              <th>Manage</th>
                            </tr>
                          </thead>
                          <tbody>
                            {organizations.map((organization) => (
                              <tr key={text(organization.workspaceId)}>
                                <td>
                                  <b>{text(organization.name)}</b>
                                </td>
                                <td>
                                  {text(
                                    object(
                                      object(organization.subscription).plan,
                                    ).name,
                                    "Unassigned",
                                  )}
                                </td>
                                <td>
                                  <Badge
                                    value={
                                      object(organization.subscription)
                                        .status || "UNASSIGNED"
                                    }
                                  />
                                </td>
                                <td>
                                  {date(
                                    object(organization.subscription).periodEnd,
                                  )}
                                </td>
                                <td>
                                  <button
                                    onClick={() =>
                                      subscriptionEditor(organization)
                                    }
                                  >
                                    Manage subscription
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title="No subscriptions to manage yet."
                        detail="Business subscriptions will appear after registration."
                      />
                    )}
                  </div>
                </>
              )}
              {tab === "settings" && (
                <>
                  <div className="admin-config-grid">
                    {[
                      {
                        key: "google",
                        name: "Business email authorization",
                        detail:
                          "Google OAuth configuration for each client's own Gmail or Workspace account.",
                      },
                      {
                        key: "liveEmail",
                        name: "Live email delivery",
                        detail:
                          "Server permission for real delivery. Client mailbox activation remains separate.",
                      },
                      {
                        key: "n8n",
                        name: "n8n orchestration",
                        detail:
                          "Trusted workflow endpoint and shared authentication are configured.",
                      },
                      {
                        key: "encryption",
                        name: "Credential encryption",
                        detail:
                          "Server encryption key for stored provider credentials.",
                      },
                      {
                        key: "tenantDatabase",
                        name: "Tenant database isolation",
                        detail:
                          "Restricted database connection used for authorized tenant operations.",
                      },
                    ].map((item) => (
                      <article
                        className="surface admin-config-card"
                        key={item.key}
                      >
                        <span className="mini-icon">
                          <ShieldCheck size={20} />
                        </span>
                        <Badge
                          value={
                            configuration[item.key]
                              ? "CONFIGURED"
                              : "NOT_CONFIGURED"
                          }
                        />
                        <h3>{item.name}</h3>
                        <p>{item.detail}</p>
                      </article>
                    ))}
                  </div>
                  <div className="surface section-space">
                    <SectionHeading
                      title="Platform controls"
                      detail="Manage client access and commercial plans through authenticated administration."
                    />
                    <div className="admin-control-actions">
                      <button onClick={() => navigate("clients")}>
                        <Users size={17} />
                        Manage client access
                        <ArrowUpRight size={16} />
                      </button>
                      <button onClick={() => navigate("subscriptions")}>
                        <CreditCard size={17} />
                        Configure subscription plans
                        <ArrowUpRight size={16} />
                      </button>
                      <Link href="/account" className="button">
                        <ShieldCheck size={17} />
                        Your account settings
                        <ArrowUpRight size={16} />
                      </Link>
                    </div>
                    <p className="table-caption">
                      Provider secrets and deployment configuration are managed
                      on the server. This screen reports configuration presence;
                      it does not claim to perform live provider health checks.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
          <footer className="admin-data-footer">
            <span>
              <ShieldCheck size={13} />
              Platform oversight · Client content stays private
            </span>
            <span>Updated {date(insights.generatedAt, true)}</span>
          </footer>
        </main>
      </div>
      {selected && (
        <div className="admin-inspector-backdrop">
          <button
            className="admin-inspector-scrim"
            aria-label="Close website inspector"
            onClick={() => setSelected("")}
          />
          <section
            ref={inspector}
            className="admin-inspector"
            role="dialog"
            aria-modal="true"
            aria-label="Website management details"
            tabIndex={-1}
          >
            <div className="admin-inspector-header">
              <div>
                <p className="eyebrow">WEBSITE INTELLIGENCE</p>
                <h2>{text(inspected?.name, "Business overview")}</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close website inspector"
                onClick={() => setSelected("")}
              >
                <X size={21} />
              </button>
            </div>
            {detailError ? (
              <div className="alert error" role="alert">
                {detailError}
              </div>
            ) : !detail ? (
              <Loading />
            ) : (
              <>
                <div className="admin-site-identity">
                  <Globe2 size={22} />
                  <div>
                    <strong>
                      {text(inspected?.websiteUrl, "Website not connected")}
                    </strong>
                    <small>
                      {text(inspected?.accountEmail, "No client administrator")}
                    </small>
                  </div>
                  {typeof inspected?.websiteUrl === "string" &&
                    /^https?:\/\//i.test(inspected.websiteUrl) && (
                      <a
                        href={inspected.websiteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="icon-button"
                        aria-label="Open business website"
                      >
                        <ExternalLink size={17} />
                      </a>
                    )}
                </div>
                <div className="admin-inspector-badges">
                  <Badge value={inspected?.connectionStatus} />
                  <Badge value={inspected?.analysisStatus} />
                  <Badge
                    value={inspected?.subscriptionStatus || "UNASSIGNED"}
                  />
                </div>
                <Link
                  href={`/?client=${encodeURIComponent(selected)}`}
                  className="button"
                >
                  Open client workspace <ArrowUpRight size={15} />
                </Link>
                <div className="inline-actions">
                  <Link
                    className="button"
                    href={`/?client=${encodeURIComponent(selected)}&view=business`}
                  >
                    Edit website and targeting
                  </Link>
                  <Link
                    className="button"
                    href={`/?client=${encodeURIComponent(selected)}&view=leads`}
                  >
                    Manage leads
                  </Link>
                  <Link
                    className="button"
                    href={`/?client=${encodeURIComponent(selected)}&view=campaigns`}
                  >
                    Create and send campaign
                  </Link>
                </div>
                {metrics(
                  [
                    { key: "discovered", name: "Discovered" },
                    { key: "qualified", name: "Qualified" },
                    { key: "sent", name: "Emails sent" },
                    { key: "replies", name: "Replies" },
                  ],
                  inspected,
                )}
                <div className="surface">
                  <SectionHeading
                    title="Website analysis"
                    detail={text(
                      inspected?.targetMarket,
                      "Client target market has not been reviewed.",
                    )}
                  />
                  <p>
                    {text(
                      object(inspected?.analysis).summary,
                      "Website analysis has not been recorded. The client can connect and analyze their website from My Website.",
                    )}
                  </p>
                  <dl className="admin-detail-grid">
                    {[
                      "industry",
                      "products",
                      "services",
                      "geography",
                      "targetAudience",
                    ].map((key) => (
                      <div key={key}>
                        <dt>
                          {label(key.replace(/([a-z])([A-Z])/g, "$1 $2"))}
                        </dt>
                        <dd>
                          {text(
                            object(inspected?.analysis)[key],
                            "Not recorded",
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
                {chart(
                  "Business outreach",
                  "Recorded outcomes for this client in the selected period.",
                  [{ key: "sent", label: "Sent" }, ...positiveMetrics],
                  rows(detail.series),
                )}
                <div className="surface">
                  <SectionHeading
                    title="Campaign performance"
                    detail="Client campaign status and lifetime outcomes."
                  />
                  {campaignTable(rows(detail.campaigns))}
                </div>
                <div className="surface">
                  <SectionHeading
                    title="Automation status"
                    detail="Recorded executions in the selected period."
                  />
                  {executionTable(rows(detail.jobs))}
                </div>
                <div className="surface">
                  <SectionHeading
                    title="Recent business activity"
                    detail="Operational events without private lead or email content."
                  />
                  {rows(detail.activity).length ? (
                    <div className="activity-list">
                      {rows(detail.activity).map((item) => (
                        <div className="activity-item" key={text(item.id)}>
                          <span className="activity-dot" />
                          <div>
                            <b>{label(item.kind)}</b>
                            <small>{date(item.createdAt, true)}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No business activity recorded.</p>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {dialog && <ActionDialog dialog={dialog} close={() => setDialog(null)} />}
      {clientLogin && (
        <ClientLoginDialog
          businesses={organizations.filter(
            (item) =>
              item.status === "ACTIVE" && item.onboardingStatus !== "DEMO",
          )}
          workspaceId={clientLogin.workspaceId}
          close={() => setClientLogin(null)}
          created={() => {
            setNotice(
              "Client login created. Copy or download the generated details before closing.",
            );
            setRevision((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}
