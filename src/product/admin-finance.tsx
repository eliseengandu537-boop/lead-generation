"use client";
import { ChevronRight, Plus } from "lucide-react";
import { date, label, number, object, text, type RecordValue } from "./data";
import { Badge, Empty } from "./primitives";
import { Funnel, Panel, Stat, Stats, compact } from "./admin-ui";

const DAY = 86400000;
function money(minor: number, currency = "ZAR") {
  try {
    return new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(minor / 100);
  } catch {
    return `${currency} ${Math.round(minor / 100).toLocaleString("en-ZA")}`;
  }
}

/** What clients pay: monthly revenue from active plans, trials, renewals and the plan list. */
export default function AdminFinance({
  organizations,
  plans,
  usage,
  rangeLabel,
  onManage,
  onEditPlan,
}: {
  organizations: RecordValue[];
  plans: RecordValue[];
  usage: RecordValue[];
  rangeLabel: string;
  onManage: (organization: RecordValue) => void;
  onEditPlan: (plan?: RecordValue) => void;
}) {
  const now = Date.now();
  const billing = organizations
    .filter((item) => item.onboardingStatus !== "DEMO")
    .map((organization) => {
      const subscription = object(organization.subscription);
      const plan = object(subscription.plan);
      const end = subscription.periodEnd ? new Date(text(subscription.periodEnd)).getTime() : null;
      const status = text(subscription.status, "UNASSIGNED");
      const lapsed = !!end && end < now;
      const paying = status === "ACTIVE" && !lapsed && plan.priceMinor !== null && plan.priceMinor !== undefined;
      return {
        organization,
        plan,
        status,
        end,
        lapsed,
        price: paying ? number(plan.priceMinor) : 0,
        currency: text(plan.currency, "ZAR"),
        soon: !!end && !lapsed && end - now < 14 * DAY,
      };
    });
  const currency = billing.find((item) => item.price)?.currency ?? "ZAR";
  const monthly = billing.reduce((sum, item) => sum + item.price, 0);
  const paying = billing.filter((item) => item.price > 0);
  const trials = billing.filter((item) => item.status === "TRIAL" && !item.lapsed);
  const renew = billing
    .filter((item) => item.lapsed || item.soon || item.status === "UNASSIGNED" || ["EXPIRED", "SUSPENDED"].includes(item.status))
    .sort((a, b) => (a.end ?? 0) - (b.end ?? 0));
  const byPlan = plans
    .map((plan) => {
      const on = billing.filter((item) => text(item.plan.id) === text(plan.id) && !item.lapsed);
      return {
        plan,
        clients: on.length,
        revenue: on.reduce((sum, item) => sum + item.price, 0),
      };
    })
    .filter((row) => row.clients > 0);
  const topRevenue = Math.max(1, ...byPlan.map((row) => row.revenue));

  return (
    <div className="adm-finance">
      <Stats>
        <Stat
          label="Monthly revenue"
          value={money(monthly, currency)}
          tone={monthly > 0 ? "good" : undefined}
          hint={`${compact(paying.length)} paying client${paying.length === 1 ? "" : "s"}`}
        />
        <Stat
          label="Yearly run rate"
          value={money(monthly * 12, currency)}
          hint="Monthly revenue × 12"
        />
        <Stat
          label="On trial"
          value={trials.length}
          hint={trials.length ? "Convert them before the trial ends" : "No open trials"}
        />
        <Stat
          label="Need renewing"
          value={renew.length}
          tone={renew.some((item) => item.lapsed) ? "bad" : renew.length ? "warn" : undefined}
          hint="Ended, ending in 14 days or no plan"
        />
      </Stats>
      <div className="adm-grid adm-grid-main">
        <Panel title="Revenue by plan" detail="Active clients on each plan and what they bring in a month.">
          {byPlan.length ? (
            <ul className="adm-revenue">
              {byPlan.map((row, index) => (
                <li key={text(row.plan.id)} style={{ animationDelay: `${index * 60}ms` }}>
                  <div>
                    <b>{text(row.plan.name)}</b>
                    <small>
                      {compact(row.clients)} client{row.clients === 1 ? "" : "s"}
                    </small>
                  </div>
                  <span className="adm-revenue-track">
                    <i style={{ width: `${Math.max(row.revenue ? 4 : 0, (row.revenue / topRevenue) * 100)}%` }} />
                  </span>
                  <strong>{row.revenue ? money(row.revenue, currency) : "Trial"}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="adm-panel-copy">No client is on a plan yet. Assign one from the list below.</p>
          )}
        </Panel>
        <Panel title="Renewals" detail={renew.length ? "Sorted by end date." : undefined}>
          {renew.length ? (
            <ul className="adm-attention">
              {renew.slice(0, 8).map((item) => (
                <li key={text(item.organization.workspaceId)} className={item.lapsed || item.status === "UNASSIGNED" ? "is-bad" : "is-warn"}>
                  <span className="adm-attention-icon">{text(item.organization.name).slice(0, 1)}</span>
                  <div>
                    <b>{text(item.organization.name)}</b>
                    <small>
                      {item.status === "UNASSIGNED"
                        ? "No plan assigned"
                        : item.lapsed
                          ? `${text(item.plan.name)} ended ${date(new Date(item.end!))}`
                          : item.end
                            ? `${text(item.plan.name)} ends ${date(new Date(item.end))}`
                            : `${text(item.plan.name)} is ${label(item.status).toLowerCase()}`}
                    </small>
                  </div>
                  <button className="adm-attention-action" onClick={() => onManage(item.organization)}>
                    Renew
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="adm-all-clear">
              <b>Nothing to renew</b>
              <small>Every client has an active plan.</small>
            </div>
          )}
        </Panel>
      </div>
      <Panel title="Client billing" detail="Every client's plan, status and monthly amount.">
        {billing.length ? (
          <div className="table-scroll">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Monthly</th>
                  <th>Ends</th>
                  <th>
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {billing.map((item) => (
                  <tr key={text(item.organization.workspaceId)}>
                    <td>
                      <b>{text(item.organization.name)}</b>
                    </td>
                    <td>{text(item.plan.name, "No plan")}</td>
                    <td>
                      <Badge value={item.lapsed ? "EXPIRED" : item.status} />
                    </td>
                    <td>{item.price ? money(item.price, item.currency) : "—"}</td>
                    <td className={item.lapsed ? "adm-text-bad" : undefined}>
                      {item.end ? date(new Date(item.end)) : "—"}
                    </td>
                    <td>
                      <div className="adm-row-actions">
                        <button className="button" onClick={() => onManage(item.organization)}>
                          Manage plan
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No clients yet." detail="Clients and their plans show here." />
        )}
      </Panel>
      <Panel
        id="plans"
        title="Plans"
        detail="Your price list, plus what clients used in the selected period."
        action={
          <button className="button" onClick={() => onEditPlan()}>
            <Plus size={16} />
            Create plan
          </button>
        }
      >
        <div className="adm-plans-layout">
          <div className="adm-plans">
            {plans.map((plan) => (
              <article className="adm-plan" key={text(plan.id)}>
                <header>
                  <h3>{text(plan.name)}</h3>
                  <Badge value={plan.available ? "AVAILABLE" : "PRIVATE"} />
                </header>
                <p className="adm-plan-price">
                  {plan.priceMinor === null || plan.priceMinor === undefined
                    ? "Arranged pricing"
                    : money(number(plan.priceMinor), text(plan.currency, "ZAR"))}
                  {plan.priceMinor !== null && plan.priceMinor !== undefined && <small> / month</small>}
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
                    <dd>{compact(billing.filter((item) => text(item.plan.id) === text(plan.id)).length)}</dd>
                  </div>
                </dl>
                <button className="text-button" onClick={() => onEditPlan(plan)}>
                  Edit plan <ChevronRight size={14} />
                </button>
              </article>
            ))}
            {!plans.length && <Empty title="No plans yet." detail="Create a plan, then assign it to a client." />}
          </div>
          <div className="adm-usage">
            <h3>Usage, {rangeLabel}</h3>
            {usage.length ? (
              <Funnel
                showRates={false}
                steps={usage.map((item) => ({ label: label(item.kind), value: item.quantity }))}
              />
            ) : (
              <p className="muted">No usage recorded in this period.</p>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
