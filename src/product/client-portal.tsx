"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  Globe2,
  LayoutDashboard,
  LogOut,
  Mail,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  Target,
  Users,
} from "lucide-react";
import {
  api,
  date,
  number,
  object,
  rows,
  text,
  type RecordValue,
  type SessionView,
} from "./data";
import { Badge, ConcreteMark, DetailPanel, Empty, Loading } from "./primitives";
import { MetricNumber, TrendChart } from "./charts";
import { ThemeToggle } from "./theme";

const tabs = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "leads", label: "Your leads", icon: Users },
  { id: "campaigns", label: "Your campaigns", icon: Send },
  { id: "conversations", label: "Conversations", icon: MessageCircle },
  { id: "results", label: "Results", icon: ChartNoAxesCombined },
  { id: "website", label: "Your website", icon: Globe2 },
  { id: "updates", label: "Updates", icon: Mail },
];
const amount = (value: unknown) => number(value).toLocaleString("en-ZA");
const statuses: Record<string, string> = {
  DEMO: "Demo preview",
  SETUP_PENDING: "Preparing your outreach",
  LIVE: "Campaign active",
  READY: "Ready for a campaign",
};

export default function ClientPortal() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [tab, setTab] = useState("dashboard");
  const [data, setData] = useState<RecordValue>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void api<SessionView>(
      "/api/platform/session",
      "GET",
      undefined,
      controller.signal,
    )
      .then((result) => {
        setSession(result);
        const saved = window.localStorage.getItem("concrete-client-workspace");
        setWorkspaceId(
          result.organizations.find((item) => item.workspaceId === saved)
            ?.workspaceId ||
            result.organizations[0]?.workspaceId ||
            "",
        );
        if (!result.organizations.length) setLoading(false);
      })
      .catch((problem) => {
        if (!controller.signal.aborted) {
          setError(problem.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData({});
    window.localStorage.setItem("concrete-client-workspace", workspaceId);
    void api(
      `/api/platform/${workspaceId}/portal?view=${tab}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(object(result));
          setUpdatedAt(new Date());
        }
      })
      .catch((problem) => {
        if (!controller.signal.aborted) setError(problem.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [workspaceId, tab, revision]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible")
        setRevision((value) => value + 1);
    }, 60000);
    return () => window.clearInterval(timer);
  }, []);
  const organization = session?.organizations.find(
    (item) => item.workspaceId === workspaceId,
  );
  const active = tabs.find((item) => item.id === tab)!;
  const navigate = (next: string) => {
    setTab(next);
    setError("");
  };
  return (
    <div className="client-portal">
      <header className="portal-header">
        <div className="portal-header-inner">
          <Link
            href="/"
            className="portal-brand"
            aria-label="Concrete client portal"
          >
            <ConcreteMark />
            <strong>
              CONCRETE<span>.</span>
            </strong>
            <small>CLIENT PORTAL</small>
          </Link>
          <div className="portal-account">
            <ThemeToggle />
            <span className="portal-user">
              <b>{session?.user.name || "Your account"}</b>
              <small>{session?.user.email || ""}</small>
            </span>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={() => void signOut({ callbackUrl: "/login" })}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </header>
      <div className="portal-workspace-bar">
        <div>
          <Building2 size={17} />
          <span>{organization?.name || "Your business"}</span>
          {(session?.organizations.length || 0) > 1 && (
            <label className="portal-workspace-select">
              <span className="sr-only">Choose your business</span>
              <select
                value={workspaceId}
                onChange={(event) => {
                  setWorkspaceId(event.target.value);
                  navigate("dashboard");
                }}
              >
                {session?.organizations.map((item) => (
                  <option key={item.workspaceId} value={item.workspaceId}>
                    {item.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </label>
          )}
        </div>
        <span className="portal-private">
          <Check size={14} />
          Private to your business
        </span>
      </div>
      <nav className="portal-tabs" aria-label="Client navigation">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => navigate(item.id)}
            className={tab === item.id ? "active" : ""}
            aria-current={tab === item.id ? "page" : undefined}
          >
            <item.icon size={17} />
            {item.label}
          </button>
        ))}
      </nav>
      <main className="portal-content" id="main-content">
        {organization?.isDemo && (
          <div className="portal-demo" role="note">
            <span>DEMO WORKSPACE</span>
            <p>
              Explore the client experience with fictional leads, campaigns and
              conversations. These sample results do not represent live
              outreach.
            </p>
          </div>
        )}
        <div className="portal-page-tools">
          <span>{active.label}</span>
          <div>
            {updatedAt && (
              <small>
                Updated{" "}
                {updatedAt.toLocaleTimeString("en-ZA", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </small>
            )}
            <button
              className="icon-button"
              aria-label="Refresh results"
              disabled={loading}
              onClick={() => setRevision((value) => value + 1)}
            >
              <RefreshCw size={15} className={loading ? "spin" : ""} />
            </button>
          </div>
        </div>
        {error && (
          <div className="alert error" role="alert">
            <span>{error}</span>
            <button onClick={() => setRevision((value) => value + 1)}>
              Try again
            </button>
          </div>
        )}
        {loading ? (
          <Loading />
        ) : !organization ? (
          <Empty
            title="Your client portal is being prepared."
            detail="Your account team will connect your business workspace. Your leads and campaign results will appear here."
          />
        ) : error ? null : (
          <PortalView
            key={`${workspaceId}:${tab}`}
            tab={tab}
            data={data}
            name={organization.name}
            navigate={navigate}
          />
        )}
      </main>
      <footer className="portal-footer">
        <span>
          <ConcreteMark small />
          Concrete client portal
        </span>
        <p>
          Your account team manages your outreach. This is your place to follow
          the results.
        </p>
      </footer>
    </div>
  );
}

function Heading({
  title,
  detail,
  eyebrow = "YOUR BUSINESS, IN FOCUS",
}: {
  title: string;
  detail: string;
  eyebrow?: string;
}) {
  return (
    <div className="portal-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{detail}</p>
    </div>
  );
}
function StatCards({
  metrics,
  full = false,
}: {
  metrics: RecordValue;
  full?: boolean;
}) {
  const entries = [
    {
      key: "qualifiedLeads",
      title: "Qualified leads",
      detail: "Businesses matched to your offer",
      icon: Target,
    },
    {
      key: "emailsSent",
      title: "Emails sent",
      detail: "Accepted by the sending provider",
      icon: Send,
    },
    {
      key: "replies",
      title: "Conversations started",
      detail: "Replies recorded from prospects",
      icon: MessageCircle,
    },
    {
      key: "meetingsRequested",
      title: "Meeting requests",
      detail: "Prospects asking to speak",
      icon: Users,
    },
    ...(full
      ? [
          {
            key: "businessesDiscovered",
            title: "Businesses discovered",
            detail: "Prospects found through research",
            icon: Search,
          },
          {
            key: "positiveReplies",
            title: "Positive responses",
            detail: "Interest, pricing and meeting requests",
            icon: Mail,
          },
          {
            key: "emailsDelivered",
            title: "Confirmed deliveries",
            detail: "Supported delivery confirmations only",
            icon: Check,
          },
          {
            key: "bounces",
            title: "Bounced emails",
            detail: "Recorded delivery failures",
            icon: Send,
          },
        ]
      : []),
  ];
  return (
    <div className="portal-stats">
      {entries.map((item) => (
        <article key={item.key}>
          <span>
            <item.icon size={17} />
            {item.title}
          </span>
          <strong>
            <MetricNumber value={metrics[item.key]} />
          </strong>
          <small>{item.detail}</small>
        </article>
      ))}
    </div>
  );
}
function PortalView({
  tab,
  data,
  name,
  navigate,
}: {
  tab: string;
  data: RecordValue;
  name: string;
  navigate: (value: string) => void;
}) {
  if (tab === "leads") return <ClientLeads data={data} />;
  if (tab === "campaigns") return <ClientCampaigns data={data} />;
  if (tab === "conversations") return <ClientConversations data={data} />;
  if (tab === "website") return <ClientWebsite data={data} />;
  if (tab === "updates")
    return (
      <>
        <Heading
          title="Your latest updates."
          detail="Milestones and results shared by your account team."
        />
        {rows(data.items).length ? (
          <div className="portal-updates">
            {rows(data.items).map((item) => (
              <article className="surface" key={text(item.id)}>
                <small>{date(item.createdAt, true)}</small>
                <h3>{text(item.title)}</h3>
                <p>{text(item.message)}</p>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="You’re up to date."
            detail="New campaign milestones and reports will appear here."
          />
        )}
      </>
    );
  if (tab === "results")
    return (
      <>
        <Heading
          title="See what’s moving forward."
          detail="Your recorded lead and outreach results over the last 30 days."
        />
        <StatCards metrics={object(data.metrics)} full />
        <section className="surface portal-chart">
          <TrendChart
            values={rows(data.series)}
            title="Your outreach over time"
            description="Recorded activity · last 30 days"
          />
        </section>
        <CampaignSummary campaigns={rows(data.campaigns)} navigate={navigate} />
        <p className="portal-footnote">
          Sent means accepted by the email provider. Delivery is shown only when
          a supported provider confirms it. Open tracking is unavailable.
          Replies can relate to emails sent in an earlier period.
        </p>
      </>
    );
  const outreach = object(data.outreach);
  return (
    <>
      <Heading
        title="Your growth, at a glance."
        detail={`${name} · Your leads, conversations and campaign progress in one place.`}
      />
      <section
        className={`portal-outreach ${text(outreach.state).toLowerCase()}`}
      >
        <div>
          <span className="portal-state-dot" />
          <b>{statuses[text(outreach.state)] || "Your outreach"}</b>
          <p>
            {text(
              outreach.description,
              "Your account team is preparing your results.",
            )}
          </p>
        </div>
        <span className="portal-period">LAST 30 DAYS</span>
      </section>
      {Array.isArray(outreach.blockers) && outreach.blockers.length > 0 && (
        <div className="portal-next-steps">
          <strong>Next steps with your account team</strong>
          <ul>
            {outreach.blockers.map((item, index) => (
              <li key={index}>{String(item)}</li>
            ))}
          </ul>
        </div>
      )}
      <StatCards metrics={object(data.metrics)} />
      <div className="portal-dashboard-grid">
        <section className="surface portal-chart">
          <TrendChart
            values={rows(data.series)}
            title="Your outreach over time"
            description="Recorded activity · last 30 days"
          />
        </section>
        <section className="surface portal-momentum">
          <p className="eyebrow">FROM INTEREST TO OPPORTUNITY</p>
          <h3>Every conversation has a next step.</h3>
          <div>
            <span>Positive responses</span>
            <strong>{amount(object(data.metrics).positiveReplies)}</strong>
          </div>
          <div>
            <span>Meeting requests</span>
            <strong>{amount(object(data.metrics).meetingsRequested)}</strong>
          </div>
          <div>
            <span>Reply rate</span>
            <strong>{amount(object(data.metrics).replyRate)}%</strong>
          </div>
          <button
            className="portal-link"
            onClick={() => navigate("conversations")}
          >
            Read your conversations
            <ArrowRight size={16} />
          </button>
        </section>
      </div>
      <CampaignSummary campaigns={rows(data.campaigns)} navigate={navigate} />
      <section className="surface portal-recent">
        <div className="portal-card-title">
          <h3>Recent opportunities</h3>
          <button className="portal-link" onClick={() => navigate("leads")}>
            All leads
            <ArrowUpRight size={15} />
          </button>
        </div>
        {rows(data.recentLeads).length ? (
          rows(data.recentLeads).map((lead) => (
            <div className="portal-recent-row" key={text(lead.id)}>
              <span className="portal-company-letter">
                {text(lead.company).slice(0, 1)}
              </span>
              <span>
                <b>{text(lead.company)}</b>
                <small>{text(lead.industry, "Business prospect")}</small>
              </span>
              <Badge value={lead.status} />
            </div>
          ))
        ) : (
          <Empty
            title="Your next opportunities will appear here."
            detail="Your account team will share prospects as research and qualification progress."
          />
        )}
      </section>
    </>
  );
}
function CampaignSummary({
  campaigns,
  navigate,
}: {
  campaigns: RecordValue[];
  navigate: (value: string) => void;
}) {
  return (
    <section className="surface portal-campaign-summary">
      <div className="portal-card-title">
        <h3>Campaign progress</h3>
        <button className="portal-link" onClick={() => navigate("campaigns")}>
          View campaigns
          <ArrowUpRight size={15} />
        </button>
      </div>
      {campaigns.length ? (
        <div className="table-scroll">
          <table>
            <caption className="sr-only">
              Campaign results in the last 30 days
            </caption>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Status</th>
                <th>Emails sent</th>
                <th>Replies</th>
                <th>Positive responses</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={text(campaign.id)}>
                  <td>
                    <b>{text(campaign.name)}</b>
                  </td>
                  <td>
                    <Badge value={campaign.status} />
                  </td>
                  <td>{amount(campaign.sent)}</td>
                  <td>{amount(campaign.replies)}</td>
                  <td>{amount(campaign.positiveReplies)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="Your first campaign is being prepared."
          detail="Your account team handles targeting, message approval and sending. Follow its progress here once it is ready."
        />
      )}
    </section>
  );
}
function ClientLeads({ data }: { data: RecordValue }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<RecordValue | null>(null);
  const items = rows(data.items).filter((item) =>
    [item.company, item.name, item.industry, item.location, item.status]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <Heading
        title="The right businesses. In your pipeline."
        detail="Explore the prospects your account team has found for your business."
      />
      <div className="portal-list-tools">
        <label className="portal-search">
          <Search size={17} />
          <input
            aria-label="Search your leads"
            placeholder="Search companies, industries or cities…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span>
          {amount(query ? items.length : (data.total ?? items.length))}{" "}
          businesses
        </span>
      </div>
      <section className="surface">
        {items.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Location</th>
                  <th>Fit score</th>
                  <th>Progress</th>
                  <th>
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={text(item.id)}>
                    <td>
                      <b>{text(item.company)}</b>
                      <small className="portal-table-sub">
                        {text(item.industry, "Business prospect")}
                      </small>
                    </td>
                    <td>{text(item.location)}</td>
                    <td>
                      {item.qualificationScore === null
                        ? "Under review"
                        : `${amount(item.qualificationScore)}/100`}
                    </td>
                    <td>
                      <Badge value={item.status} />
                    </td>
                    <td>
                      <button
                        className="portal-link"
                        onClick={() => setSelected(item)}
                        aria-label={`View ${text(item.company)}`}
                      >
                        View
                        <ArrowUpRight size={14} />
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
              query
                ? "No matching prospects."
                : "Your lead pipeline starts here."
            }
            detail={
              query
                ? "Try another company, industry or location."
                : "Qualified opportunities will appear as your account team researches your market."
            }
          />
        )}
      </section>
      {selected && (
        <DetailPanel title="Lead details" close={() => setSelected(null)}>
          <div className="portal-detail">
            <button className="portal-link" onClick={() => setSelected(null)}>
              Close details
            </button>
            <h2>{text(selected.company)}</h2>
            <Badge value={selected.status} />
            <dl>
              {[
                ["Industry", selected.industry],
                ["Location", selected.location],
                ["Contact", selected.name],
                ["Email", selected.email],
                ["Website", selected.website],
                ["Why this business fits", selected.qualificationExplanation],
              ].map(([key, value]) => (
                <div key={text(key)}>
                  <dt>{text(key)}</dt>
                  <dd>{text(value, "Not recorded")}</dd>
                </div>
              ))}
            </dl>
          </div>
        </DetailPanel>
      )}
    </>
  );
}
function ClientCampaigns({ data }: { data: RecordValue }) {
  const [selected, setSelected] = useState("");
  const items = rows(data.items);
  return (
    <>
      <Heading
        title="Your outreach, in motion."
        detail="Follow each campaign from preparation to conversations. Your account team manages sending."
      />
      {items.length ? (
        <div className="portal-campaign-grid">
          {items.map((campaign) => (
            <article
              className="surface portal-campaign"
              key={text(campaign.id)}
            >
              <div className="portal-card-title">
                <span className="portal-campaign-icon">
                  <Send size={20} />
                </span>
                <Badge value={campaign.status} />
              </div>
              <h3>{text(campaign.name)}</h3>
              <p>
                {campaign.status === "RUNNING"
                  ? "Active campaign · emails follow the approved sending schedule."
                  : campaign.status === "PAUSED"
                    ? "Sending is paused. Your account team will manage the next step."
                    : campaign.status === "COMPLETED"
                      ? "This campaign has finished its current outreach."
                      : "Your account team is preparing this campaign."}
              </p>
              <div className="portal-campaign-numbers">
                <span>
                  <b>{amount(campaign.recipients)}</b>Recipients
                </span>
                <span>
                  <b>{amount(campaign.sent)}</b>Sent · 30 days
                </span>
                <span>
                  <b>{amount(campaign.replies)}</b>Replies · 30 days
                </span>
              </div>
              <button
                className="portal-link"
                aria-expanded={selected === campaign.id}
                onClick={() =>
                  setSelected(selected === campaign.id ? "" : text(campaign.id))
                }
              >
                {selected === campaign.id
                  ? "Hide campaign message"
                  : "View campaign message"}
                <ChevronDown size={15} />
              </button>
              {selected === campaign.id && (
                <div className="portal-message-preview">
                  <span>
                    {campaign.approvedAt
                      ? "Reviewed campaign message"
                      : "Message preview · awaiting approval"}
                  </span>
                  <b>{text(campaign.subject)}</b>
                  <p>{text(campaign.body)}</p>
                  {!!campaign.scheduledAt && (
                    <small>Scheduled {date(campaign.scheduledAt, true)}</small>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title="Your campaign story starts here."
          detail="Once your account team prepares a campaign, you can see its status, message and results here."
        />
      )}
    </>
  );
}
function ClientConversations({ data }: { data: RecordValue }) {
  const [direction, setDirection] = useState("INBOUND");
  const [selected, setSelected] = useState("");
  const items = rows(data.items).filter((item) => item.direction === direction);
  const current = items.find((item) => item.id === selected) || items[0];
  return (
    <>
      <Heading
        title="Where opportunities reply."
        detail="Read prospect responses, pricing questions and meeting requests from your campaigns."
      />
      <div className="portal-conversation-tabs">
        <button
          className={direction === "INBOUND" ? "active" : ""}
          onClick={() => {
            setDirection("INBOUND");
            setSelected("");
          }}
        >
          Prospect replies (
          {amount(
            object(data.totals).replies ??
              rows(data.items).filter((item) => item.direction === "INBOUND")
                .length,
          )}
          )
        </button>
        <button
          className={direction === "OUTBOUND" ? "active" : ""}
          onClick={() => {
            setDirection("OUTBOUND");
            setSelected("");
          }}
        >
          Sent messages (
          {amount(
            object(data.totals).sent ??
              rows(data.items).filter((item) => item.direction === "OUTBOUND")
                .length,
          )}
          )
        </button>
      </div>
      {items.length ? (
        <section className="surface portal-conversations">
          <div className="portal-conversation-list">
            {items.map((item) => (
              <button
                key={text(item.id)}
                onClick={() => setSelected(text(item.id))}
                className={current?.id === item.id ? "active" : ""}
              >
                <span>
                  {text(
                    direction === "INBOUND" ? item.fromEmail : item.toEmail,
                  )}
                </span>
                <b>{text(item.subject)}</b>
                <small>{date(item.createdAt, true)}</small>
              </button>
            ))}
          </div>
          {current && (
            <article className="portal-conversation-body">
              <div>
                <Badge value={current.classification || current.status} />
                <small>{date(current.createdAt, true)}</small>
              </div>
              <h2>{text(current.subject)}</h2>
              <p className="portal-email-address">
                From {text(current.fromEmail)}
                <br />
                To {text(current.toEmail)}
              </p>
              <div className="portal-email-content">{text(current.body)}</div>
            </article>
          )}
        </section>
      ) : (
        <Empty
          title={
            direction === "INBOUND"
              ? "Your conversations will arrive here."
              : "Sent messages will appear here."
          }
          detail="Messages are shown once they have been recorded for your business. Your account team handles the outreach."
        />
      )}
    </>
  );
}
function ClientWebsite({ data }: { data: RecordValue }) {
  return (
    <>
      <Heading
        title="Your business is the starting point."
        detail="See the business profile and target market guiding your outreach."
      />
      <section className="surface portal-website">
        <div className="portal-card-title">
          <Globe2 size={27} />
          <Badge
            value={
              data.isDemo
                ? "SAMPLE_PROFILE"
                : data.reviewed
                  ? "REVIEWED"
                  : "UNDER_REVIEW"
            }
          />
        </div>
        <h2>{text(data.companyName, "Your business profile")}</h2>
        <p className="portal-website-url">
          {text(data.websiteUrl, "Your account team will add your website.")}
        </p>
        <div className="portal-profile-facts">
          <div>
            <small>Industry</small>
            <b>{text(data.industry, "Being prepared")}</b>
          </div>
          <div>
            <small>Primary location</small>
            <b>{text(data.location, "Being prepared")}</b>
          </div>
          <div>
            <small>Your niche</small>
            <b>
              {text(
                data.niche,
                "Your account team is reviewing your ideal customer.",
              )}
            </b>
          </div>
        </div>
      </section>
      <div className="portal-profile-grid">
        {[
          ["Products", data.products],
          ["Services", data.services],
          ["Ideal customers", data.targetCustomers],
          ["Service areas", data.serviceAreas],
        ].map(([title, values]) => (
          <section className="surface" key={String(title)}>
            <h3>{String(title)}</h3>
            {Array.isArray(values) && values.length ? (
              <ul>
                {values.map((value, index) => (
                  <li key={index}>{String(value)}</li>
                ))}
              </ul>
            ) : (
              <p>
                Your account team will complete this with your business context.
              </p>
            )}
          </section>
        ))}
      </div>
      <section className="surface portal-targeting">
        <p className="eyebrow">WHO YOUR OUTREACH IS FOR</p>
        <h3>Your target market</h3>
        <p>
          {text(
            data.targetCriteria,
            "Your account team will confirm your niche, service areas and campaign audience.",
          )}
        </p>
      </section>
      <div className="portal-tracking-note">
        <Globe2 size={21} />
        <div>
          <b>Website visitor analytics</b>
          <p>{text(object(data.tracking).description)}</p>
        </div>
      </div>
    </>
  );
}
