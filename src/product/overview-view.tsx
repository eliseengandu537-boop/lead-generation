"use client";
import { ArrowRight, Check, Plus } from "lucide-react";
import { date, label, number, object, rows, text, type Organization, type RecordValue } from "./data";
import { Badge, Empty, SectionHeading } from "./primitives";
import { TrendChart } from "./charts";
import { Funnel, Panel, Progress, Stat, Stats, compact, percent } from "./admin-ui";
import type { ViewProps } from "./views";

/** The road from a new client to emails going out, with one button per step. */
export function SetupChecklist({
  setup,
  organization,
  navigate,
}: {
  setup: RecordValue;
  organization: Organization;
  navigate: (view: string) => void;
}) {
  const steps = rows(setup.steps);
  if (!steps.length) return null;
  const done = number(setup.done),
    total = number(setup.total);
  const next = steps.find((step) => !step.done);
  if (!next)
    return (
      <div className="ws-setup-done" role="status">
        <Check size={16} />
        <b>{organization.name} is set up and sending.</b>
      </div>
    );
  return (
    <Panel
      className="ws-setup"
      title={`Get ${organization.name} sending`}
      detail={`${done} of ${total} done. Work down the list; each button takes you to the right place.`}
      action={
        <span className="ws-setup-progress">
          <Progress value={done} max={total} />
          {Math.round((done / Math.max(1, total)) * 100)}%
        </span>
      }
    >
      <ol className="ws-steps">
        {steps.map((step, index) => {
          const isNext = step === next;
          return (
            <li
              key={text(step.id)}
              className={step.done ? "is-done" : isNext ? "is-next" : ""}
            >
              <span className="ws-step-mark" aria-hidden="true">
                {step.done ? <Check size={14} /> : index + 1}
              </span>
              <div className="ws-step-text">
                <b>
                  {text(step.label)}
                  {step.done === true && <span className="sr-only"> (done)</span>}
                </b>
                <small>{text(step.detail)}</small>
              </div>
              {!step.done &&
                (step.view === "admin" ? (
                  <a
                    className={`button${isNext ? " primary" : ""}`}
                    href="/admin?section=clients"
                  >
                    {text(step.action)}
                  </a>
                ) : (
                  <button
                    className={isNext ? "primary" : undefined}
                    onClick={() => navigate(text(step.view))}
                  >
                    {text(step.action)}
                    {isNext && <ArrowRight size={14} />}
                  </button>
                ))}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

export function OverviewView({ data, organization, navigate }: ViewProps) {
  const metrics = object(data.metrics),
    campaigns = rows(data.campaigns),
    activity = rows(data.activity),
    leads = rows(data.recentLeads);
  return (
    <div className="workspace-overview">
      <SectionHeading
        title="Overview"
        detail={`${organization.name} · the last 30 days`}
        action={
          <button className="primary" onClick={() => navigate("campaigns")}>
            <Plus size={16} />
            New campaign
          </button>
        }
      />
      <Stats>
        <Stat
          label="Leads found"
          value={metrics.businessesDiscovered}
          hint={`${compact(metrics.hotLeads)} hot leads`}
        />
        <Stat
          label="Qualified"
          value={metrics.qualifiedLeads}
          hint="Scored as a good fit"
        />
        <Stat
          label="Emails sent"
          value={metrics.emailsSent}
          hint={`${compact(metrics.activeCampaigns)} campaign${number(metrics.activeCampaigns) === 1 ? "" : "s"} running`}
        />
        <Stat
          label="Replies"
          value={metrics.replies}
          hint={`${percent(metrics.replies, metrics.emailsSent)} reply rate`}
        />
        <Stat
          label="Positive replies"
          value={metrics.positiveReplies}
          hint={`${percent(metrics.positiveReplies, metrics.replies)} of replies`}
        />
        <Stat
          label="Meeting requests"
          value={metrics.meetingsRequested}
          hint="Asked for a call"
        />
      </Stats>
      <div className="adm-grid adm-grid-main">
        <Panel className="adm-chart-panel">
          <TrendChart
            values={rows(data.series)}
            title="Activity"
            description="Daily totals, the last 30 days."
            metrics={[
              { key: "sent", label: "Emails sent" },
              { key: "replies", label: "Replies" },
              { key: "discovered", label: "Leads found" },
              { key: "qualified", label: "Qualified leads" },
            ]}
          />
        </Panel>
        <Panel title="From lead to customer" detail="The last 30 days.">
          <Funnel
            steps={[
              { label: "Leads found", value: metrics.businessesDiscovered },
              { label: "Qualified", value: metrics.qualifiedLeads },
              { label: "Emails sent", value: metrics.emailsSent, rate: null },
              {
                label: "Replies",
                value: metrics.replies,
                rate: `${percent(metrics.replies, metrics.emailsSent)} reply rate`,
              },
              { label: "Positive replies", value: metrics.positiveReplies },
              { label: "Meeting requests", value: metrics.meetingsRequested },
              { label: "Won", value: metrics.converted },
            ]}
          />
        </Panel>
      </div>
      <Panel
        title="Campaigns"
        action={
          <button className="text-button" onClick={() => navigate("campaigns")}>
            All campaigns <ArrowRight size={14} />
          </button>
        }
      >
        {campaigns.length ? (
          <div className="table-scroll">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Replies</th>
                  <th>Positive</th>
                  <th>Bounces</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.slice(0, 5).map((campaign) => {
                  const audience = object(campaign._count).recipients;
                  return (
                    <tr key={text(campaign.id)}>
                      <td>
                        <button
                          className="adm-client-name"
                          onClick={() => navigate("campaigns")}
                        >
                          {text(campaign.name)}
                        </button>
                      </td>
                      <td>
                        <Badge value={campaign.status} />
                      </td>
                      <td>
                        <span className="adm-rate">
                          <Progress value={campaign.sent} max={audience} />
                          {compact(campaign.sent)} / {compact(audience)}
                        </span>
                      </td>
                      <td>
                        {compact(campaign.replies)}
                        {number(campaign.sent) > 0 && (
                          <small>{percent(campaign.replies, campaign.sent)}</small>
                        )}
                      </td>
                      <td>{compact(campaign.positiveReplies)}</td>
                      <td>{compact(campaign.bounces)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No campaigns yet."
            detail="Pick qualified leads, write the email and choose when it sends."
            action={
              <button onClick={() => navigate("campaigns")}>
                <Plus size={15} />
                Create a campaign
              </button>
            }
          />
        )}
      </Panel>
      <div className="adm-grid adm-grid-even">
        <Panel
          title="Newest leads"
          action={
            <button className="text-button" onClick={() => navigate("leads")}>
              All leads <ArrowRight size={14} />
            </button>
          }
        >
          {leads.length ? (
            <ul className="ws-list">
              {leads.map((lead) => (
                <li key={text(lead.id)}>
                  <span className="site-monogram">
                    {text(lead.company).slice(0, 1)}
                  </span>
                  <span className="ws-list-main">
                    <b>{text(lead.company)}</b>
                    <small>{text(lead.industry, "Industry not recorded")}</small>
                  </span>
                  <Badge value={lead.status} />
                  <span
                    className={`ws-score${number(lead.qualificationScore) >= 80 ? " is-hot" : ""}`}
                    title="Fit score"
                  >
                    {lead.qualificationScore === null ||
                    lead.qualificationScore === undefined
                      ? "—"
                      : number(lead.qualificationScore)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              title="No leads yet."
              detail="Use Find leads to research businesses that fit."
              action={
                <button onClick={() => navigate("discovery")}>
                  Find leads <ArrowRight size={14} />
                </button>
              }
            />
          )}
        </Panel>
        <Panel title="Recent activity">
          {activity.length ? (
            <ul className="ws-timeline">
              {activity.slice(0, 7).map((entry) => (
                <li key={text(entry.id)}>
                  <i />
                  <span>
                    <b>{label(entry.kind)}</b>
                    {!!entry.detail && <p>{text(entry.detail)}</p>}
                    <small>{date(entry.createdAt, true)}</small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted adm-panel-copy">
              Research, approvals and replies show up here as they happen.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
