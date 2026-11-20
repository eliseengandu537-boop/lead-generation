"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Bot,
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  CreditCard,
  ExternalLink,
  Globe2,
  KeyRound,
  LayoutDashboard,
  Menu,
  PenLine,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SquareKanban,
  TriangleAlert,
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
  MonetticMark,
  type Dialog,
} from "./primitives";
import { ThemeToggle } from "./theme";
import { TrendChart } from "./charts";
import { ClientLoginDialog } from "./client-login-dialog";
import AssistantScreen from "./assistant-screen";
import CallCentre from "./call-centre";
import SalesPipeline from "./sales-pipeline";
import ContentLibrary from "./content-library";
import { AdminBookingBell } from "./admin-booking-bell";
import {
  Funnel,
  Panel,
  Progress,
  RowMenu,
  Stat,
  Stats,
  Tabs,
  compact,
  percent,
} from "./admin-ui";

type SectionId =
  | "overview"
  | "assistant"
  | "lead-generation"
  | "outreach"
  | "pipeline"
  | "content"
  | "clients"
  | "settings";
const navigation: {
  id: SectionId;
  label: string;
  icon: typeof Bot;
  detail: string;
  group: "" | "GROW" | "MANAGE";
}[] = [
  {
    id: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    detail: "Every client, campaign and booked call in one view.",
    group: "",
  },
  {
    id: "assistant",
    label: "AI Assistant",
    icon: Bot,
    detail: "Ask the assistant to work with your clients and outreach.",
    group: "",
  },
  {
    id: "lead-generation",
    label: "Lead Generation",
    icon: Radar,
    detail: "Find, research and score the right businesses for each client.",
    group: "GROW",
  },
  {
    id: "outreach",
    label: "Email Outreach",
    icon: Send,
    detail: "Campaigns, replies and sending health for every client.",
    group: "GROW",
  },
  {
    id: "pipeline",
    label: "Sales Pipeline",
    icon: SquareKanban,
    detail:
      "Every opportunity, from first contact to a booked call and a won deal.",
    group: "GROW",
  },
  {
    id: "content",
    label: "Content",
    icon: PenLine,
    detail: "Email scripts and templates for every client.",
    group: "GROW",
  },
  {
    id: "clients",
    label: "Clients",
    icon: Users,
    detail: "Client accounts, websites, logins and plans.",
    group: "MANAGE",
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings2,
    detail: "Platform connections and controls.",
    group: "MANAGE",
  },
];
/** Old section names still work in links, such as booking emails (?section=call-centre). */
const legacySections: Record<string, SectionId> = {
  command: "overview",
  analytics: "overview",
  subscriptions: "overview",
  websites: "clients",
  leads: "lead-generation",
  automation: "lead-generation",
  inbox: "outreach",
  campaigns: "outreach",
  "call-centre": "pipeline",
};
function sectionFrom(value: string | null): SectionId | null {
  if (!value) return null;
  if (navigation.some((item) => item.id === value)) return value as SectionId;
  return legacySections[value] ?? null;
}
const periodic: SectionId[] = ["overview", "lead-generation", "outreach"];
const campaignStatuses = [
  "ALL",
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "RUNNING",
  "PAUSED",
  "COMPLETED",
  "CANCELLED",
];
const jobStatuses = [
  "ALL",
  "QUEUED",
  "WAITING_AUTOMATION",
  "READY",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "REVIEW_REQUIRED",
];
const DAY = 86400000;
const clientLink = (workspaceId: unknown, view?: string) =>
  `/?client=${encodeURIComponent(text(workspaceId, ""))}${view ? `&view=${view}` : ""}`;
type Attention = {
  tone: "bad" | "warn" | "info";
  title: string;
  detail: string;
  action?: { label: string; onClick?: () => void; href?: string };
};

export default function AdminScreen() {
  const [data, setData] = useState<RecordValue>({});
  const [insights, setInsights] = useState<RecordValue>({});
  const [pipeline, setPipeline] = useState<RecordValue>({});
  const [setup, setSetup] = useState<RecordValue>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [clientLogin, setClientLogin] = useState<{
    workspaceId?: string;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<SectionId>("overview");
  const [outreachTab, setOutreachTab] = useState("campaigns");
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
  const [campaignClient, setCampaignClient] = useState("ALL");
  const [campaignSearch, setCampaignSearch] = useState("");
  const [operationBusiness, setOperationBusiness] = useState("");
  const inspector = useRef<HTMLElement>(null);
  const period = range || `days=${days}`;
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get(
      "section",
    );
    const section = sectionFrom(requested);
    if (section) setTab(section);
    if (requested === "inbox") setOutreachTab("inbox");
  }, []);
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
    // The pipeline summary feeds the overview, the attention list and the sidebar count.
    const controller = new AbortController();
    api("/api/platform/admin/pipeline", "GET", undefined, controller.signal)
      .then((result) => !controller.signal.aborted && setPipeline(result))
      .catch(() => {
        /* The overview still works without pipeline figures. */
      });
    api("/api/platform/admin/setup", "GET", undefined, controller.signal)
      .then((result) => !controller.signal.aborted && setSetup(object(result.clients)))
      .catch(() => {
        /* Setup progress is optional on the client list. */
      });
    return () => controller.abort();
  }, [revision]);
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
  function navigate(id: string, sub?: string) {
    const next = sectionFrom(id) ?? "overview";
    setTab(next);
    if (next === "outreach")
      setOutreachTab(sub ?? (id === "inbox" ? "inbox" : "campaigns"));
    setMobile(false);
    setSearch("");
    setStatus("ALL");
    setSelected("");
    const address = new URL(window.location.href);
    address.searchParams.set("section", next);
    window.history.replaceState(null, "", address);
    if (id === "subscriptions")
      window.setTimeout(
        () =>
          document
            .getElementById("plans")
            ?.scrollIntoView({ behavior: "smooth" }),
        200,
      );
    else window.scrollTo({ top: 0 });
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
    configuration = object(insights.configuration),
    campaigns = rows(insights.campaigns),
    stages = rows(pipeline.stages),
    bookings = object(pipeline.bookings);
  const stageTotal = (id: string) =>
    number(stages.find((stage) => stage.id === id)?.total);
  const orgById = new Map(
    organizations.map((item) => [text(item.workspaceId), item]),
  );
  const lookup = new Map(
    directory.map((item) => [text(item.workspaceId), item]),
  );
  const businessName = (id: unknown) =>
    text(
      lookup.get(text(id))?.name ?? orgById.get(text(id))?.name,
      "Client",
    );
  const periodSum = (key: string) =>
    series.reduce((sum, day) => sum + number(day[key]), 0);
  const rangeLabel = range
    ? `${text(object(insights.range).from)} to ${text(object(insights.range).to)}`
    : `last ${days} days`;
  const activeClients = organizations.filter(
    (item) => item.status === "ACTIVE" && item.onboardingStatus !== "DEMO",
  );

  function workspaceTools(view: string, title: string) {
    const available = activeClients.length
      ? activeClients
      : organizations.filter((item) => item.status === "ACTIVE");
    const chosen = available.some(
      (item) => item.workspaceId === operationBusiness,
    )
      ? operationBusiness
      : text(available[0]?.workspaceId, "");
    if (!chosen) return null;
    return (
      <div className="adm-client-jump">
        <select
          aria-label="Choose a client"
          value={chosen}
          onChange={(event) => setOperationBusiness(event.target.value)}
        >
          {available.map((item) => (
            <option key={text(item.workspaceId)} value={text(item.workspaceId)}>
              {text(item.name)}
            </option>
          ))}
        </select>
        <Link className="button primary" href={clientLink(chosen, view)}>
          {title}
          <ArrowUpRight size={15} />
        </Link>
      </div>
    );
  }
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
              organization.analysisStatus === status ||
              organization.subscriptionStatus === status),
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
  function addBusiness() {
    setDialog({
      title: "Add a client business",
      detail:
        "Creates the client's workspace. You can then create their login and connect their website.",
      fields: [
        { name: "name", label: "Business name", required: true },
        {
          name: "websiteUrl",
          label: "Website",
          type: "url",
          placeholder: "https://clientbusiness.co.za",
        },
      ],
      submitLabel: "Add business",
      submit: async (input) => {
        const result = await api("/api/platform/organizations", "POST", {
          ...input,
          timezone: "Africa/Johannesburg",
        });
        setNotice("Client business added.");
        setRevision((value) => value + 1);
        return result;
      },
    });
  }

  const attention = useMemo<Attention[]>(() => {
    const now = Date.now();
    const items: Attention[] = [];
    for (const organization of organizations) {
      if (organization.onboardingStatus === "DEMO") continue;
      const name = text(organization.name);
      const subscription = object(organization.subscription);
      const end = subscription.periodEnd
        ? new Date(text(subscription.periodEnd)).getTime()
        : null;
      const plan = text(subscription.status, "");
      if (!plan)
        items.push({
          tone: "warn",
          title: `${name} has no plan`,
          detail: "Assign a plan so research and sending can run.",
          action: { label: "Assign", onClick: () => subscriptionEditor(organization) },
        });
      else if (["SUSPENDED", "EXPIRED", "CANCELLED"].includes(plan))
        items.push({
          tone: "bad",
          title: `${name}: plan ${label(plan).toLowerCase()}`,
          detail: "Sending and lead research are blocked.",
          action: { label: "Manage", onClick: () => subscriptionEditor(organization) },
        });
      else if (end && end < now)
        items.push({
          tone: "bad",
          title: `${name}: ${plan === "TRIAL" ? "trial" : "plan"} ended ${date(end)}`,
          detail: "Sending and lead research are blocked until it is renewed.",
          action: { label: "Renew", onClick: () => subscriptionEditor(organization) },
        });
      else if (end && end - now < 7 * DAY)
        items.push({
          tone: "warn",
          title: `${name}: ${plan === "TRIAL" ? "trial" : "plan"} ends ${date(end)}`,
          detail: `${Math.max(1, Math.ceil((end - now) / DAY))} days left.`,
          action: { label: "Manage", onClick: () => subscriptionEditor(organization) },
        });
    }
    for (const row of directory)
      if (
        row.analysisStatus === "AWAITING_REVIEW" &&
        row.onboardingStatus !== "DEMO"
      )
        items.push({
          tone: "warn",
          title: `${text(row.name)}: business profile waiting for approval`,
          detail: "Lead scoring and campaigns need an approved profile.",
          action: { label: "Review", href: clientLink(row.workspaceId, "business") },
        });
    for (const campaign of campaigns)
      if (campaign.safetyPauseReason)
        items.push({
          tone: "bad",
          title: `Paused for safety: ${text(campaign.name)}`,
          detail: `${businessName(campaign.workspaceId)} · ${label(campaign.safetyPauseReason)}`,
          action: { label: "Open", onClick: () => navigate("outreach") },
        });
    if (number(totals.failed) > 0)
      items.push({
        tone: "warn",
        title: `${compact(totals.failed)} automation run${number(totals.failed) === 1 ? "" : "s"} to review`,
        detail: "Failed or held research and sending jobs.",
        action: { label: "View", onClick: () => navigate("lead-generation") },
      });
    const booked = rows(
      object(stages.find((stage) => stage.id === "BOOKED")).cards,
    );
    for (const call of booked) {
      const at = new Date(text(call.bookingAt, "")).getTime();
      if (at >= now && at < now + 2 * DAY)
        items.push({
          tone: "info",
          title: `Call with ${text(call.company)}`,
          detail: `${text(call.business)} · ${date(call.bookingAt, true)}`,
          action: { label: "Pipeline", onClick: () => navigate("pipeline") },
        });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, insights, pipeline]);

  function campaignTable(list: RecordValue[]) {
    return list.length ? (
      <div className="table-scroll">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Status</th>
              <th>Sent</th>
              <th>Replies</th>
              <th>Positive</th>
            </tr>
          </thead>
          <tbody>
            {list.map((campaign) => (
              <tr key={text(campaign.id)}>
                <td>
                  <b>{text(campaign.name)}</b>
                  {!!campaign.safetyPauseReason && (
                    <small className="adm-text-bad">
                      {label(campaign.safetyPauseReason)}
                    </small>
                  )}
                </td>
                <td>
                  <Badge value={campaign.status} />
                </td>
                <td>
                  {compact(campaign.sent)}
                  <small>of {compact(campaign.recipients)}</small>
                </td>
                <td>{compact(campaign.replies)}</td>
                <td>{compact(campaign.positive)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty
        title="No campaigns yet."
        detail="Campaigns and their results will appear here."
      />
    );
  }
  function executionTable(jobs: RecordValue[]) {
    return jobs.length ? (
      <div className="table-scroll">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Client</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Started</th>
              <th>Next / finished</th>
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
                    {businessName(job.workspaceId)}
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
        title="No runs in this period."
        detail="Choose a longer period to see earlier activity."
      />
    );
  }
  function clientMenu(row: RecordValue) {
    const organization = orgById.get(text(row.workspaceId)) ?? row;
    const id = text(row.workspaceId);
    return (
      <RowMenu name={text(row.name)}>
        <button role="menuitem" onClick={() => inspect(id)}>
          View details
        </button>
        <Link role="menuitem" href={clientLink(id, "business")}>
          Website & targeting
        </Link>
        <Link role="menuitem" href={clientLink(id, "settings")}>
          Edit client
        </Link>
        {organization.status === "ACTIVE" &&
          organization.onboardingStatus !== "DEMO" && (
            <button
              role="menuitem"
              onClick={() => setClientLogin({ workspaceId: id })}
            >
              Create login
            </button>
          )}
        <button role="menuitem" onClick={() => subscriptionEditor(organization)}>
          Change plan
        </button>
        <button
          role="menuitem"
          className="adm-text-bad"
          onClick={() => changeAccess(organization)}
        >
          {organization.status === "ACTIVE" ? "Suspend" : "Activate"}
        </button>
      </RowMenu>
    );
  }
  function planCell(row: RecordValue) {
    const subscription = object(orgById.get(text(row.workspaceId))?.subscription);
    const end = subscription.periodEnd
      ? new Date(text(subscription.periodEnd))
      : null;
    const lapsed = end && end.getTime() < Date.now();
    return (
      <>
        <span className="adm-cell-line">
          {text(
            object(subscription.plan).name ?? row.planName,
            "No plan",
          )}
          <Badge value={subscription.status || row.subscriptionStatus || "UNASSIGNED"} />
        </span>
        {end && (
          <small className={lapsed ? "adm-text-bad" : undefined}>
            {lapsed ? "Ended" : "Ends"} {date(end)}
          </small>
        )}
      </>
    );
  }
  function clientIdentity(row: RecordValue, onClick?: () => void) {
    const website = text(row.websiteUrl, "");
    return (
      <div className="adm-client">
        <span className="site-monogram">{text(row.name).slice(0, 1)}</span>
        <span>
          <button className="adm-client-name" onClick={onClick}>
            {text(row.name)}
          </button>
          {website ? (
            <a
              href={website}
              target="_blank"
              rel="noopener noreferrer"
              className="adm-client-site"
            >
              {website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
              <ExternalLink size={11} />
            </a>
          ) : (
            <small>No website yet</small>
          )}
        </span>
      </div>
    );
  }

  function renderOverview() {
    return (
      <>
        <Stats>
          <Stat
            label="Active clients"
            value={totals.activeClients}
            hint={`${compact(totals.clients)} registered`}
          />
          <Stat
            label="Leads found"
            value={totals.discovered}
            hint={`${compact(totals.qualified)} qualified`}
          />
          <Stat
            label="Emails sent"
            value={totals.sent}
            hint={`${compact(periodSum("sent"))} in the ${rangeLabel}`}
          />
          <Stat
            label="Replies"
            value={totals.replies}
            hint={`${percent(totals.replies, totals.sent)} reply rate`}
          />
          <Stat
            label="Positive replies"
            value={totals.positive}
            hint={`${percent(totals.positive, totals.replies)} of replies`}
          />
          <Stat
            label="Calls booked"
            value={pipeline.stages ? stageTotal("BOOKED") : null}
            hint={`${compact(bookings.nextSevenDays)} in the next 7 days`}
          />
        </Stats>
        <div className="adm-grid adm-grid-main">
          <Panel className="adm-chart-panel">
            <TrendChart
              values={series}
              title="Activity"
              description={`Daily totals, ${rangeLabel}.`}
              metrics={[
                { key: "sent", label: "Emails sent" },
                { key: "replies", label: "Replies" },
                { key: "positive", label: "Positive replies" },
                { key: "leads", label: "Leads found" },
                { key: "bounces", label: "Bounces" },
                { key: "clients", label: "New clients" },
                { key: "executions", label: "Automation runs" },
                { key: "usage", label: "Usage units" },
              ]}
            />
          </Panel>
          <Panel
            title="Needs attention"
            detail={
              attention.length
                ? `${attention.length} item${attention.length === 1 ? "" : "s"}`
                : undefined
            }
            className="adm-attention-panel"
          >
            {attention.length ? (
              <ul className="adm-attention">
                {attention.slice(0, 8).map((item, index) => (
                  <li key={`${item.title}-${index}`} className={`is-${item.tone}`}>
                    <span className="adm-attention-icon">
                      {item.tone === "info" ? (
                        <CalendarClock size={15} />
                      ) : item.tone === "bad" ? (
                        <CircleAlert size={15} />
                      ) : (
                        <TriangleAlert size={15} />
                      )}
                    </span>
                    <div>
                      <b>{item.title}</b>
                      <small>{item.detail}</small>
                    </div>
                    {item.action?.href ? (
                      <Link className="adm-attention-action" href={item.action.href}>
                        {item.action.label}
                      </Link>
                    ) : item.action ? (
                      <button
                        className="adm-attention-action"
                        onClick={item.action.onClick}
                      >
                        {item.action.label}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="adm-all-clear">
                <Check size={18} />
                <b>All clear</b>
                <small>No expired plans, paused campaigns or failed runs.</small>
              </div>
            )}
          </Panel>
        </div>
        <div className="adm-grid adm-grid-side">
          <Panel title="Client journey" detail="Lifetime totals across every client.">
            <Funnel
              steps={[
                { label: "Leads found", value: totals.discovered },
                { label: "Qualified", value: totals.qualified },
                { label: "Emails sent", value: totals.sent, rate: null },
                {
                  label: "Replies",
                  value: totals.replies,
                  rate: `${percent(totals.replies, totals.sent)} reply rate`,
                },
                { label: "Positive replies", value: totals.positive },
                { label: "Calls booked", value: stageTotal("BOOKED") },
                { label: "Won", value: stageTotal("WON") },
              ]}
            />
          </Panel>
          <Panel
            title="Clients"
            detail="Most recently active."
            action={
              <button className="text-button" onClick={() => navigate("clients")}>
                All clients <ChevronRight size={15} />
              </button>
            }
          >
            {directory.length ? (
              <div className="table-scroll">
                <table className="adm-table adm-clients-table">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Plan</th>
                      <th>Leads</th>
                      <th>Replies</th>
                      <th>Last active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...directory]
                      .sort(
                        (a, b) =>
                          new Date(text(b.lastActivity)).getTime() -
                          new Date(text(a.lastActivity)).getTime(),
                      )
                      .slice(0, 6)
                      .map((row) => (
                        <tr key={text(row.workspaceId)}>
                          <td>
                            {clientIdentity(row, () => inspect(text(row.workspaceId)))}
                          </td>
                          <td>{planCell(row)}</td>
                          <td>{compact(row.discovered)}</td>
                          <td>
                            {compact(row.replies)}
                            <small>
                              {percent(row.replies, row.sent)} of{" "}
                              {compact(row.sent)} sent
                            </small>
                          </td>
                          <td>{date(row.lastActivity)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="No clients yet."
                detail="Add a client business to get started."
                action={
                  <button className="primary" onClick={addBusiness}>
                    <Plus size={16} /> Add business
                  </button>
                }
              />
            )}
          </Panel>
        </div>
        <Panel
          id="plans"
          title="Plans and billing"
          detail="Subscription plans, plus what clients used in the selected period."
          action={
            <button className="primary" onClick={() => planEditor()}>
              <Plus size={16} />
              Create plan
            </button>
          }
        >
          <div className="adm-plans-layout">
            <div className="adm-plans">
              {plans.map((plan) => {
                const subscribed = organizations.filter(
                  (item) => object(item.subscription).planId === plan.id,
                ).length;
                return (
                  <article className="adm-plan" key={text(plan.id)}>
                    <header>
                      <h3>{text(plan.name)}</h3>
                      <Badge value={plan.available ? "AVAILABLE" : "PRIVATE"} />
                    </header>
                    <p className="adm-plan-price">
                      {plan.priceMinor === null
                        ? "Arranged pricing"
                        : `${text(plan.currency)} ${(number(plan.priceMinor) / 100).toLocaleString("en-ZA", { minimumFractionDigits: 0 })}`}
                      {plan.priceMinor !== null && <small> / month</small>}
                    </p>
                    <dl>
                      <div>
                        <dt>Emails a day</dt>
                        <dd>{compact(plan.dailyEmails)}</dd>
                      </div>
                      <div>
                        <dt>Leads a month</dt>
                        <dd>{compact(plan.monthlyProspects)}</dd>
                      </div>
                      <div>
                        <dt>Clients on plan</dt>
                        <dd>{compact(subscribed)}</dd>
                      </div>
                    </dl>
                    <button className="text-button" onClick={() => planEditor(plan)}>
                      Edit plan <ChevronRight size={14} />
                    </button>
                  </article>
                );
              })}
              {!plans.length && (
                <Empty
                  title="No plans yet."
                  detail="Create a plan, then assign it to a client."
                />
              )}
            </div>
            <div className="adm-usage">
              <h3>Usage, {rangeLabel}</h3>
              {rows(insights.usage).length ? (
                <Funnel
                  showRates={false}
                  steps={rows(insights.usage).map((item) => ({
                    label: label(item.kind),
                    value: item.quantity,
                  }))}
                />
              ) : (
                <p className="muted">No usage recorded in this period.</p>
              )}
            </div>
          </div>
        </Panel>
      </>
    );
  }

  function renderClients() {
    return (
      <>
        <Stats>
          <Stat
            label="Clients"
            value={totals.clients}
            hint={`${compact(totals.activeClients)} active`}
          />
          <Stat
            label="Websites connected"
            value={totals.websites}
            hint={`${compact(directory.filter((row) => row.analysisStatus === "APPROVED").length)} profiles approved`}
          />
          <Stat
            label="Client logins"
            value={organizations.reduce(
              (sum, item) => sum + rows(item.clientLogins).length,
              0,
            )}
            hint="People who can sign in"
          />
          <Stat
            label="Plans to fix"
            value={
              attention.filter(
                (item) => item.tone !== "info" && /plan|trial/.test(item.title),
              ).length
            }
            tone={
              attention.some(
                (item) => item.tone === "bad" && /plan|trial/.test(item.title),
              )
                ? "bad"
                : undefined
            }
            hint="Ended, ending soon or missing"
          />
        </Stats>
        <Panel>
          <div className="adm-toolbar">
            <div className="search-field">
              <Search size={16} />
              <input
                aria-label="Search clients"
                placeholder="Search clients, websites or industries…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <select
              aria-label="Filter clients"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="ALL">All clients</option>
              <option value="CONNECTED">Website connected</option>
              <option value="NOT_CONNECTED">No website</option>
              <option value="AWAITING_REVIEW">Profile waiting for approval</option>
              <option value="APPROVED">Profile approved</option>
              <option value="TRIAL">On trial</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
            <select
              aria-label="Sort clients"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="activity">Recently active</option>
              <option value="name">Name</option>
              <option value="leads">Most leads</option>
              <option value="sent">Most emails</option>
            </select>
            <span className="muted adm-toolbar-count">
              {filtered.length} of {directory.length}
            </span>
          </div>
          {filtered.length ? (
            <div className="table-scroll">
              <table className="adm-table adm-clients-table">
                <thead>
                  <tr>
                    <th>Client and website</th>
                    <th>Setup</th>
                    <th>Plan</th>
                    <th>Leads</th>
                    <th>Outreach</th>
                    <th>Last active</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const organization = orgById.get(text(row.workspaceId));
                    const logins = rows(organization?.clientLogins);
                    const progress = object(setup[text(row.workspaceId)]);
                    const complete =
                      number(progress.total) > 0 &&
                      number(progress.done) >= number(progress.total);
                    return (
                      <tr key={text(row.workspaceId)}>
                        <td>
                          {clientIdentity(row, () => inspect(text(row.workspaceId)))}
                          <small className="truncate-text">
                            {(organization?.status ?? row.status) !== "ACTIVE"
                              ? `${label(organization?.status ?? row.status)} · `
                              : ""}
                            {logins.length
                              ? `${logins.length} login${logins.length === 1 ? "" : "s"}`
                              : "No client login yet"}
                          </small>
                        </td>
                        <td>
                          {progress.total ? (
                            <>
                              <span className="adm-rate">
                                <Progress value={progress.done} max={progress.total} />
                                {compact(progress.done)} of {compact(progress.total)}
                              </span>
                              <small>
                                {complete ? (
                                  "Sending"
                                ) : (
                                  <Link href={clientLink(row.workspaceId, "outreach")}>
                                    Next: {text(progress.next)}
                                  </Link>
                                )}
                              </small>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{planCell(row)}</td>
                        <td>
                          {compact(row.discovered)}
                          <small>{compact(row.qualified)} qualified</small>
                        </td>
                        <td>
                          {compact(row.sent)} sent
                          <small>
                            {compact(row.replies)} replies ·{" "}
                            {compact(row.activeCampaigns)} running
                          </small>
                        </td>
                        <td>{date(row.lastActivity)}</td>
                        <td>
                          <div className="adm-row-actions">
                            <Link
                              className={`button${complete ? "" : " primary"}`}
                              href={clientLink(row.workspaceId, "outreach")}
                            >
                              {complete ? "Open" : "Continue setup"}{" "}
                              <ArrowUpRight size={14} />
                            </Link>
                            {clientMenu(row)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title={
                directory.length ? "No clients match." : "No clients yet."
              }
              detail={
                directory.length
                  ? "Try another name or filter."
                  : "Add a client business to get started."
              }
            />
          )}
        </Panel>
      </>
    );
  }

  function renderLeadGeneration() {
    const rank = ["HOT", "WARM", "COLD"];
    const categories = rows(insights.leadCategories).sort(
      (a, b) =>
        (rank.indexOf(text(a.category)) + 1 || 99) -
        (rank.indexOf(text(b.category)) + 1 || 99),
    );
    return (
      <>
        <Stats>
          <Stat
            label="Leads found"
            value={totals.discovered}
            hint={`${compact(periodSum("leads"))} in the ${rangeLabel}`}
          />
          <Stat
            label="Qualified"
            value={totals.qualified}
            hint={`${percent(totals.qualified, totals.discovered)} of leads found`}
          />
          <Stat
            label="Automation runs"
            value={totals.executions}
            hint={`${compact(totals.pending)} queued or running`}
          />
          <Stat
            label="Runs to review"
            value={totals.failed}
            tone={number(totals.failed) > 0 ? "warn" : undefined}
            hint="Failed or held"
          />
        </Stats>
        <div className="adm-grid adm-grid-main">
          <Panel className="adm-chart-panel">
            <TrendChart
              values={series}
              title="Leads found"
              description={`New businesses added to client lead lists, ${rangeLabel}.`}
              metrics={[
                { key: "leads", label: "Leads found" },
                { key: "executions", label: "Automation runs" },
                { key: "failed", label: "Runs to review" },
              ]}
            />
          </Panel>
          <Panel title="Lead quality" detail="Score against each client's criteria.">
            {categories.length ? (
              <Funnel
                showRates={false}
                steps={categories.map((item) => ({
                  label: label(item.category),
                  value: item.count,
                }))}
              />
            ) : (
              <p className="muted">Scores appear once leads are researched.</p>
            )}
          </Panel>
        </div>
        <Panel
          title="Leads by client"
          detail="Open a client to find more leads or work their list."
        >
          {directory.length ? (
            <div className="table-scroll">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Leads found</th>
                    <th>Qualified</th>
                    <th>Qualified rate</th>
                    <th>Runs to review</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...directory]
                    .sort((a, b) => number(b.discovered) - number(a.discovered))
                    .map((row) => (
                      <tr key={text(row.workspaceId)}>
                        <td>{clientIdentity(row, () => inspect(text(row.workspaceId)))}</td>
                        <td>{compact(row.discovered)}</td>
                        <td>{compact(row.qualified)}</td>
                        <td>
                          <span className="adm-rate">
                            <Progress value={row.qualified} max={row.discovered} />
                            {percent(row.qualified, row.discovered)}
                          </span>
                        </td>
                        <td>
                          {number(row.failedJobs) ? (
                            <span className="adm-text-warn">{compact(row.failedJobs)}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          <div className="adm-row-actions">
                            <Link className="button" href={clientLink(row.workspaceId, "discovery")}>
                              Find leads
                            </Link>
                            <Link className="button" href={clientLink(row.workspaceId, "leads")}>
                              Lead list
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No clients yet." detail="Add a client business to start finding leads." />
          )}
        </Panel>
        <CallCentre view="sources" />
        <Panel
          title="Automation runs"
          detail={
            <>
              <span
                className={`connection-indicator ${configuration.n8n ? "ready" : ""}`}
              />{" "}
              {configuration.n8n
                ? "n8n is connected. These are the research and sending jobs it ran."
                : "n8n is not connected, so queued jobs wait until it is."}
            </>
          }
          action={
            <select
              aria-label="Filter runs by status"
              value={jobStatus}
              onChange={(event) => setJobStatus(event.target.value)}
            >
              {jobStatuses.map((value) => (
                <option key={value} value={value}>
                  {value === "ALL" ? "All statuses" : label(value)}
                </option>
              ))}
            </select>
          }
        >
          {executionTable(
            rows(insights.jobs).filter(
              (job) => jobStatus === "ALL" || job.status === jobStatus,
            ),
          )}
        </Panel>
      </>
    );
  }

  function renderCampaigns() {
    const visible = campaigns.filter(
      (campaign) =>
        (campaignStatus === "ALL" || campaign.status === campaignStatus) &&
        (campaignClient === "ALL" || campaign.workspaceId === campaignClient) &&
        text(campaign.name, "")
          .toLowerCase()
          .includes(campaignSearch.trim().toLowerCase()),
    );
    const groups = new Map<string, RecordValue[]>();
    for (const campaign of visible) {
      const key = text(campaign.workspaceId);
      groups.set(key, [...(groups.get(key) ?? []), campaign]);
    }
    const bounceRate =
      number(totals.sent) > 0 ? number(totals.bounces) / number(totals.sent) : 0;
    return (
      <>
        <Stats>
          <Stat
            label="Emails sent"
            value={totals.sent}
            hint={`${compact(periodSum("sent"))} in the ${rangeLabel}`}
          />
          <Stat
            label="Reply rate"
            value={percent(totals.replies, totals.sent)}
            hint={`${compact(totals.replies)} replies`}
          />
          <Stat
            label="Positive replies"
            value={totals.positive}
            hint={`${percent(totals.positive, totals.replies)} of replies`}
          />
          <Stat
            label="Bounce rate"
            value={percent(totals.bounces, totals.sent)}
            tone={bounceRate > 0.03 ? "bad" : bounceRate > 0.02 ? "warn" : undefined}
            hint={`${compact(totals.bounces)} hard bounces · pause at 3%`}
          />
          <Stat
            label="Running campaigns"
            value={totals.activeCampaigns}
            hint={`${compact(totals.campaigns)} campaigns in total`}
          />
        </Stats>
        <Panel>
          <div className="adm-toolbar">
            <div className="search-field">
              <Search size={16} />
              <input
                aria-label="Search campaigns"
                placeholder="Search campaigns…"
                value={campaignSearch}
                onChange={(event) => setCampaignSearch(event.target.value)}
              />
            </div>
            <select
              aria-label="Show one client's campaigns"
              value={campaignClient}
              onChange={(event) => setCampaignClient(event.target.value)}
            >
              <option value="ALL">All clients</option>
              {organizations.map((item) => (
                <option key={text(item.workspaceId)} value={text(item.workspaceId)}>
                  {text(item.name)}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter campaigns by status"
              value={campaignStatus}
              onChange={(event) => setCampaignStatus(event.target.value)}
            >
              {campaignStatuses.map((value) => (
                <option key={value} value={value}>
                  {value === "ALL" ? "All statuses" : label(value)}
                </option>
              ))}
            </select>
          </div>
          {visible.length ? (
            <div className="table-scroll">
              <table className="adm-table adm-campaign-table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Status</th>
                    <th>Progress</th>
                    <th>Sent</th>
                    <th>Replies</th>
                    <th>Positive</th>
                    <th>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                {[...groups.entries()].map(([workspaceId, list]) => (
                  <tbody key={workspaceId}>
                    <tr className="adm-group-row">
                      <th colSpan={7}>
                        <span>{businessName(workspaceId)}</span>
                        <small>
                          {list.length} campaign{list.length === 1 ? "" : "s"} ·{" "}
                          {list.filter((item) => item.status === "RUNNING").length} running
                        </small>
                        <Link href={clientLink(workspaceId, "campaigns")}>
                          Open campaigns <ArrowUpRight size={13} />
                        </Link>
                      </th>
                    </tr>
                    {list.map((campaign) => (
                      <tr key={text(campaign.id)}>
                        <td>
                          <b>{text(campaign.name)}</b>
                          {campaign.safetyPauseReason ? (
                            <small className="adm-text-bad">
                              Paused: {label(campaign.safetyPauseReason)}
                            </small>
                          ) : (
                            <small>Updated {date(campaign.updatedAt)}</small>
                          )}
                        </td>
                        <td>
                          <Badge value={campaign.status} />
                        </td>
                        <td>
                          <span className="adm-rate">
                            <Progress value={campaign.sent} max={campaign.recipients} />
                            {compact(campaign.sent)} / {compact(campaign.recipients)}
                          </span>
                        </td>
                        <td>{compact(campaign.sent)}</td>
                        <td>
                          {compact(campaign.replies)}
                          <small>{percent(campaign.replies, campaign.sent)}</small>
                        </td>
                        <td>{compact(campaign.positive)}</td>
                        <td>
                          <Link
                            className="icon-button"
                            aria-label={`Open ${text(campaign.name)}`}
                            href={clientLink(workspaceId, "campaigns")}
                          >
                            <ArrowUpRight size={16} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          ) : (
            <Empty
              title={campaigns.length ? "No campaigns match." : "No campaigns yet."}
              detail={
                campaigns.length
                  ? "Try another client, status or search."
                  : "Create a campaign in a client's workspace and it will show here."
              }
            />
          )}
          <p className="table-caption">
            Sent means the email provider accepted the message. Up to 100 recently
            updated campaigns.
          </p>
        </Panel>
      </>
    );
  }
  function renderInbox() {
    return (
      <>
        <Stats>
          <Stat
            label="Replies"
            value={totals.replies}
            hint={`${compact(periodSum("replies"))} in the ${rangeLabel}`}
          />
          <Stat
            label="Positive replies"
            value={totals.positive}
            hint={`${percent(totals.positive, totals.replies)} of replies`}
          />
          <Stat
            label="Meeting requests"
            value={totals.meetings}
            hint="Asked for a call in their reply"
          />
          <Stat
            label="Reply rate"
            value={percent(totals.replies, totals.sent)}
            hint={`${compact(totals.sent)} emails sent`}
          />
        </Stats>
        <div className="adm-grid adm-grid-main">
          <Panel className="adm-chart-panel">
            <TrendChart
              values={series}
              title="Replies"
              description={`Replies arriving in client inboxes, ${rangeLabel}.`}
              metrics={[
                { key: "replies", label: "Replies" },
                { key: "positive", label: "Positive replies" },
              ]}
            />
          </Panel>
          <Panel title="Where replies go" detail="Each client's replies stay in their own inbox.">
            <p className="muted adm-panel-copy">
              Open a client&apos;s inbox to read and answer replies. Positive replies
              and meeting requests also move the lead into the sales pipeline.
            </p>
            <button className="text-button" onClick={() => navigate("pipeline")}>
              Open sales pipeline <ChevronRight size={15} />
            </button>
          </Panel>
        </div>
        <Panel title="Replies by client">
          {directory.length ? (
            <div className="table-scroll">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Sent</th>
                    <th>Replies</th>
                    <th>Reply rate</th>
                    <th>Positive</th>
                    <th>
                      <span className="sr-only">Open inbox</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...directory]
                    .sort((a, b) => number(b.replies) - number(a.replies))
                    .map((row) => (
                      <tr key={text(row.workspaceId)}>
                        <td>{clientIdentity(row, () => inspect(text(row.workspaceId)))}</td>
                        <td>{compact(row.sent)}</td>
                        <td>{compact(row.replies)}</td>
                        <td>{percent(row.replies, row.sent)}</td>
                        <td>{compact(row.positive)}</td>
                        <td>
                          <Link className="button" href={clientLink(row.workspaceId, "inbox")}>
                            Open inbox <ArrowUpRight size={14} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No replies yet." detail="Replies appear once campaigns are sending." />
          )}
        </Panel>
      </>
    );
  }
  function renderAccounts() {
    const mailboxes = rows(insights.mailboxStatuses);
    return (
      <>
        <Stats>
          <Stat label="Emails sent" value={totals.sent} hint="Accepted by the email provider" />
          <Stat
            label="Confirmed deliveries"
            value={totals.delivered}
            hint="Only where the provider reports delivery"
          />
          <Stat
            label="Hard bounces"
            value={totals.bounces}
            tone={number(totals.sent) && number(totals.bounces) / number(totals.sent) > 0.03 ? "bad" : undefined}
            hint={`${percent(totals.bounces, totals.sent)} of sent`}
          />
          <Stat
            label="Spam complaints"
            value={totals.complaints}
            tone={number(totals.complaints) > 0 ? "bad" : undefined}
            hint="Pause the inbox on any complaint"
          />
        </Stats>
        <div className="adm-grid adm-grid-main">
          <Panel className="adm-chart-panel">
            <TrendChart
              values={series}
              title="Sending health"
              description={`Sent, delivered and bounced, ${rangeLabel}.`}
              metrics={[
                { key: "sent", label: "Sent" },
                { key: "delivered", label: "Delivered" },
                { key: "bounces", label: "Bounced" },
              ]}
            />
          </Panel>
          <Panel title="Sending inboxes" detail="Every connected client mailbox.">
            {mailboxes.length ? (
              <ul className="adm-status-list">
                {mailboxes.map((item) => (
                  <li key={text(item.status)}>
                    <Badge value={item.status} />
                    <b>{compact(item.count)}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted adm-panel-copy">
                No inboxes connected yet. Each client connects their own sending
                inbox from Email Connections.
              </p>
            )}
            <p className="table-caption">
              Gmail confirms an email was accepted, not that it reached the
              inbox, and gives no open tracking.
            </p>
          </Panel>
        </div>
      </>
    );
  }
  function renderOutreach() {
    return (
      <>
        <Tabs
          label="Email outreach sections"
          value={outreachTab}
          onChange={setOutreachTab}
          items={[
            { id: "campaigns", label: "Campaigns", count: campaigns.length },
            { id: "inbox", label: "Inbox", count: number(totals.replies) },
            { id: "accounts", label: "Sending accounts" },
          ]}
        />
        {outreachTab === "campaigns" && renderCampaigns()}
        {outreachTab === "inbox" && renderInbox()}
        {outreachTab === "accounts" && renderAccounts()}
      </>
    );
  }

  function renderSettings() {
    return (
      <>
        <div className="adm-config-grid">
          {[
            {
              key: "google",
              name: "Google sign-in",
              detail: "Lets a client connect their own Gmail or Google Workspace inbox.",
            },
            {
              key: "microsoft",
              name: "Microsoft 365 sign-in",
              detail: "Lets a client connect their own Outlook or Microsoft 365 inbox.",
            },
            {
              key: "liveEmail",
              name: "Live email sending",
              detail: "Server permission for real sending. Each client inbox is switched on separately.",
            },
            {
              key: "n8n",
              name: "n8n automation",
              detail: "The workflow engine that runs research and sending jobs.",
            },
            {
              key: "encryption",
              name: "Credential encryption",
              detail: "Key that protects stored provider passwords and tokens.",
            },
            {
              key: "tenantDatabase",
              name: "Client data separation",
              detail: "Restricted database login that keeps each client's data apart.",
            },
          ].map((item) => (
            <article className="adm-config-card" key={item.key}>
              <span className={`connection-indicator ${configuration[item.key] ? "ready" : ""}`} />
              <div>
                <h3>{item.name}</h3>
                <p>{item.detail}</p>
              </div>
              <Badge value={configuration[item.key] ? "CONFIGURED" : "NOT_CONFIGURED"} />
            </article>
          ))}
        </div>
        <Panel title="Shortcuts">
          <div className="adm-shortcuts">
            <button onClick={() => navigate("clients")}>
              <Users size={17} />
              Manage clients
              <ChevronRight size={15} />
            </button>
            <button onClick={() => navigate("subscriptions")}>
              <CreditCard size={17} />
              Plans and billing
              <ChevronRight size={15} />
            </button>
            <Link href="/account" className="button">
              <ShieldCheck size={17} />
              Your account
              <ChevronRight size={15} />
            </Link>
          </div>
          <p className="table-caption">
            Provider keys live on the server. This page shows whether each one is
            set, not whether the provider is working right now.
          </p>
        </Panel>
      </>
    );
  }

  const active = navigation.find((item) => item.id === tab)!;
  const inspected = rows(detail?.directory)[0];
  const navCount = (id: SectionId) =>
    id === "lead-generation" && number(totals.failed) > 0 ? (
      <span className="nav-count is-warn">{compact(totals.failed)}</span>
    ) : id === "pipeline" && number(bookings.nextSevenDays) > 0 ? (
      <span className="nav-count">{compact(bookings.nextSevenDays)}</span>
    ) : null;
  return (
    <div className={`app-shell admin-shell adm-v2 ${mobile ? "nav-open" : ""}`}>
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
            <MonetticMark />
            <span>
              MONETTIC<span className="brand-dot">.</span>
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
          <ShieldCheck size={15} />
          <span>Agency admin</span>
        </div>
        <nav aria-label="Admin sections">
          {(["", "GROW", "MANAGE"] as const).map((group) => (
            <div className="adm-nav-group" key={group || "main"}>
              {group && <p className="nav-label">{group}</p>}
              {navigation
                .filter((item) => item.group === group)
                .map(({ id, label: title, icon: Icon }) => (
                  <button
                    key={id}
                    className={`nav-item ${tab === id ? "active" : ""}`}
                    aria-current={tab === id ? "page" : undefined}
                    onClick={() => navigate(id)}
                  >
                    <Icon size={18} />
                    <span>{title}</span>
                    {navCount(id)}
                  </button>
                ))}
            </div>
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
            <span>Admin</span>
            <span className="breadcrumb-divider">/</span>
            <b>{active.label}</b>
          </div>
          <div className="topbar-actions">
            <ThemeToggle compact />
            <AdminBookingBell openMeetings={() => navigate("pipeline")} />
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
          {tab !== "assistant" && (
            <div className="adm-head">
              <div>
                <h1>{active.label}</h1>
                <p>{active.detail}</p>
              </div>
              <div className="adm-head-actions">
                {periodic.includes(tab) && (
                  <div className="adm-period" role="group" aria-label="Reporting period">
                    {["7", "30", "90"].map((value) => (
                      <button
                        key={value}
                        className={!range && days === value ? "is-on" : ""}
                        aria-pressed={!range && days === value}
                        onClick={() => {
                          setDays(value);
                          setRange("");
                        }}
                      >
                        {value} days
                      </button>
                    ))}
                    <details className="adm-range">
                      <summary className={range ? "is-on" : ""}>
                        {range ? rangeLabel : "Custom"}
                      </summary>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (from && to) {
                            setRange(
                              `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
                            );
                            (event.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
                          }
                        }}
                      >
                        <label>
                          From
                          <input
                            type="date"
                            value={from}
                            required
                            onChange={(event) => setFrom(event.target.value)}
                          />
                        </label>
                        <label>
                          To
                          <input
                            type="date"
                            value={to}
                            min={from || undefined}
                            required
                            onChange={(event) => setTo(event.target.value)}
                          />
                        </label>
                        <button type="submit" className="primary">
                          Apply
                        </button>
                      </form>
                    </details>
                  </div>
                )}
                {tab === "overview" && (
                  <button className="primary" onClick={() => setClientLogin({})}>
                    <KeyRound size={16} />
                    Add client
                  </button>
                )}
                {tab === "clients" && (
                  <>
                    <button onClick={addBusiness}>
                      <Plus size={16} />
                      Add business
                    </button>
                    <button className="primary" onClick={() => setClientLogin({})}>
                      <KeyRound size={16} />
                      Add client
                    </button>
                  </>
                )}
                {tab === "lead-generation" && workspaceTools("discovery", "Find leads")}
                {tab === "outreach" &&
                  (outreachTab === "accounts"
                    ? workspaceTools("mailboxes", "Manage inboxes")
                    : outreachTab === "inbox"
                      ? workspaceTools("inbox", "Open inbox")
                      : workspaceTools("campaigns", "New campaign"))}
              </div>
            </div>
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
              {tab === "overview" && renderOverview()}
              {tab === "clients" && renderClients()}
              {tab === "lead-generation" && renderLeadGeneration()}
              {tab === "outreach" && renderOutreach()}
              {tab === "pipeline" && <SalesPipeline businesses={organizations} />}
              {tab === "content" && <ContentLibrary />}
              {tab === "settings" && renderSettings()}
            </div>
          )}
          <footer className="admin-data-footer">
            <span>
              <ShieldCheck size={13} />
              Client email content stays in each client&apos;s workspace
            </span>
            <span>Updated {date(insights.generatedAt, true)}</span>
          </footer>
        </main>
      </div>
      {selected && (
        <div className="admin-inspector-backdrop">
          <button
            className="admin-inspector-scrim"
            aria-label="Close client details"
            onClick={() => setSelected("")}
          />
          <section
            ref={inspector}
            className="admin-inspector"
            role="dialog"
            aria-modal="true"
            aria-label="Client details"
            tabIndex={-1}
          >
            <div className="admin-inspector-header">
              <div>
                <p className="eyebrow">CLIENT</p>
                <h2>{text(inspected?.name, "Client")}</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close client details"
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
                      {text(inspected?.websiteUrl, "No website yet")}
                    </strong>
                    <small>
                      {text(inspected?.accountEmail, "No client login yet")}
                    </small>
                  </div>
                  {typeof inspected?.websiteUrl === "string" &&
                    /^https?:\/\//i.test(inspected.websiteUrl) && (
                      <a
                        href={inspected.websiteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="icon-button"
                        aria-label="Open the client's website"
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
                <div className="inline-actions">
                  <Link href={clientLink(selected)} className="button primary">
                    Open workspace <ArrowUpRight size={15} />
                  </Link>
                  <Link className="button" href={clientLink(selected, "business")}>
                    Website & targeting
                  </Link>
                  <Link className="button" href={clientLink(selected, "leads")}>
                    Leads
                  </Link>
                  <Link className="button" href={clientLink(selected, "campaigns")}>
                    Campaigns
                  </Link>
                </div>
                <Stats>
                  <Stat label="Leads found" value={inspected?.discovered} />
                  <Stat label="Qualified" value={inspected?.qualified} />
                  <Stat label="Emails sent" value={inspected?.sent} />
                  <Stat
                    label="Replies"
                    value={inspected?.replies}
                    hint={`${percent(inspected?.replies, inspected?.sent)} reply rate`}
                  />
                </Stats>
                <Panel
                  title="Website and business"
                  detail={text(
                    inspected?.targetMarket,
                    "Target customers not reviewed yet.",
                  )}
                >
                  <p className="adm-panel-copy">
                    {text(
                      object(inspected?.analysis).summary,
                      "The website hasn't been analysed yet. Open Website & targeting to run it.",
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
                </Panel>
                <Panel className="adm-chart-panel">
                  <TrendChart
                    values={rows(detail.series)}
                    title="Outreach"
                    description={`This client's results, ${rangeLabel}.`}
                    metrics={[
                      { key: "sent", label: "Sent" },
                      { key: "replies", label: "Replies" },
                      { key: "positive", label: "Positive replies" },
                    ]}
                  />
                </Panel>
                <Panel title="Campaigns">{campaignTable(rows(detail.campaigns))}</Panel>
                <Panel title="Automation runs">{executionTable(rows(detail.jobs))}</Panel>
                <Panel title="Recent activity">
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
                    <p className="muted">No activity recorded.</p>
                  )}
                </Panel>
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
