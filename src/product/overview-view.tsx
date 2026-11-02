"use client";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  Globe2,
  Mail,
  Plus,
  Radar,
  Send,
  Sparkles,
  Target,
} from "lucide-react";
import { date, label, number, object, rows, text } from "./data";
import { Badge, Empty } from "./primitives";
import { MetricNumber, TrendChart } from "./charts";
import type { ViewProps } from "./views";

export function OverviewView({ data, organization, navigate }: ViewProps) {
  const metrics = object(data.metrics),
    campaigns = rows(data.campaigns),
    activity = rows(data.activity),
    leads = rows(data.recentLeads);
  const kpis = [
    {
      key: "businessesDiscovered",
      title: "Discovered businesses",
      icon: Radar,
      detail: "Source-tracked prospects",
    },
    {
      key: "qualifiedLeads",
      title: "Qualified leads",
      icon: Target,
      detail: "Matched to your criteria",
    },
    {
      key: "emailsSent",
      title: "Emails sent",
      icon: Send,
      detail: "Provider accepted",
    },
    {
      key: "emailsDelivered",
      title: "Confirmed delivery",
      icon: Check,
      detail: "Supported provider events",
    },
    {
      key: "replies",
      title: "Replies received",
      icon: Mail,
      detail: "Matched conversations",
    },
    {
      key: "positiveReplies",
      title: "Positive responses",
      icon: Sparkles,
      detail: "Recorded reply intent",
    },
    {
      key: "meetingsRequested",
      title: "Meeting requests",
      icon: ArrowUpRight,
      detail: "Requested by prospects",
    },
    {
      key: "emailsScheduled",
      title: "Scheduled recipients",
      icon: Clock3,
      detail: "Queued in active campaigns",
    },
  ];
  return (
    <div className="workspace-overview">
      <div className="overview-intro">
        <div>
          <p className="eyebrow">WORKSPACE INTELLIGENCE</p>
          <h1>
            {organization.name}
            <span className="title-period">.</span>
          </h1>
          <p className="section-detail">
            A clear view of your pipeline, outreach and next opportunities.
          </p>
        </div>
        <div className="inline-actions">
          <span className="overview-period">LAST 30 DAYS</span>
          <button className="primary" onClick={() => navigate("discovery")}>
            <Plus size={16} />
            Find new prospects
          </button>
        </div>
      </div>
      <div className="overview-kpis">
        {kpis.map((item) => (
          <article className="stat-tile" key={item.key}>
            <div className="stat-title">
              <span>{item.title}</span>
              <item.icon size={16} />
            </div>
            <strong className="stat-number">
              <MetricNumber value={metrics[item.key]} />
            </strong>
            <span className="stat-detail">{item.detail}</span>
          </article>
        ))}
      </div>
      <div className="overview-layout">
        <section className="surface">
          <TrendChart
            values={rows(data.series)}
            description="Research and outreach activity · last 30 days"
          />
        </section>
        <aside className="surface readiness-panel">
          <div className="card-heading">
            <div>
              <p className="eyebrow">YOUR OPERATING SYSTEM</p>
              <h3>From context to conversation</h3>
            </div>
            <span className="mini-icon">
              <ArrowDownRight size={18} />
            </span>
          </div>
          <p className="readiness-intro">
            Connect the right signals. Keep every next step in your control.
          </p>
          {[
            {
              id: "business",
              title: "Business intelligence",
              detail: "Website context and target market",
              icon: Globe2,
            },
            {
              id: "discovery",
              title: "Lead intelligence",
              detail: "Evidence, qualification and fit",
              icon: Radar,
            },
            {
              id: "mailboxes",
              title: "Your business email",
              detail: "Authorized sender and reply sync",
              icon: Mail,
            },
            {
              id: "automation",
              title: "Automation monitoring",
              detail: "Live job history and exceptions",
              icon: Sparkles,
            },
          ].map((step) => (
            <button
              className="readiness-row"
              key={step.id}
              onClick={() => navigate(step.id)}
            >
              <span className="readiness-icon">
                <step.icon size={17} />
              </span>
              <span>
                <b>{step.title}</b>
                <small>{step.detail}</small>
              </span>
              <ArrowUpRight size={15} />
            </button>
          ))}
        </aside>
      </div>
      <section className="surface overview-campaigns">
        <div className="card-heading">
          <div>
            <p className="eyebrow">OUTREACH OPERATIONS</p>
            <h3>Campaign performance</h3>
          </div>
          <button className="text-button" onClick={() => navigate("campaigns")}>
            Manage campaigns
            <ArrowRight size={14} />
          </button>
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
                {campaigns.slice(0, 5).map((campaign) => (
                  <tr key={text(campaign.id)}>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => navigate("campaigns")}
                      >
                        {text(campaign.name)}
                      </button>
                    </td>
                    <td>
                      <Badge value={campaign.status} />
                    </td>
                    <td>{number(campaign.sent).toLocaleString()}</td>
                    <td>{number(campaign.replies).toLocaleString()}</td>
                    <td>{number(campaign.positiveReplies).toLocaleString()}</td>
                    <td>{number(campaign.bounces).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Your first campaign starts with a clear objective."
            detail="Select qualified leads, review your message and choose your sending schedule."
            action={
              <button onClick={() => navigate("campaigns")}>
                <Plus size={15} />
                Create a campaign
              </button>
            }
          />
        )}
      </section>
      <div className="overview-layout lower">
        <section className="surface">
          <div className="card-heading">
            <div>
              <p className="eyebrow">LEAD INTELLIGENCE</p>
              <h3>Recent opportunities</h3>
            </div>
            <button className="text-button" onClick={() => navigate("leads")}>
              All leads
              <ArrowUpRight size={14} />
            </button>
          </div>
          {leads.length ? (
            <div className="mini-table">
              {leads.map((lead) => (
                <div key={text(lead.id)}>
                  <span className="company-avatar">
                    {text(lead.company).slice(0, 1)}
                  </span>
                  <span>
                    <b>{text(lead.company)}</b>
                    <small>{text(lead.industry, "Industry unrecorded")}</small>
                  </span>
                  <Badge value={lead.status} />
                  <span className="score-inline">
                    {lead.qualificationScore === null
                      ? "—"
                      : number(lead.qualificationScore)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="Build your intelligence advantage."
              detail="Research businesses that fit your offer, with evidence behind every lead."
              action={
                <button onClick={() => navigate("discovery")}>
                  Open AI Lead Finder
                  <ArrowRight size={14} />
                </button>
              }
            />
          )}
        </section>
        <section className="surface">
          <div className="card-heading">
            <div>
              <p className="eyebrow">WORKSPACE SIGNALS</p>
              <h3>Activity timeline</h3>
            </div>
            <span className="subtle">Latest recorded events</span>
          </div>
          {activity.length ? (
            <div className="activity-list">
              {activity.slice(0, 6).map((entry) => (
                <div key={text(entry.id)}>
                  <i />
                  <span>
                    <b>{label(entry.kind)}</b>
                    <p>{text(entry.detail)}</p>
                    <small>{date(entry.createdAt, true)}</small>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="Every action, in context."
              detail="Research, approvals and conversations will be recorded here as your workspace becomes active."
            />
          )}
        </section>
      </div>
    </div>
  );
}
