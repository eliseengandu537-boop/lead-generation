"use client";

import { Fragment, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Clock3,
  GitBranch,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import { label, number, rows, text, type RecordValue } from "./data";
import { Badge, Empty, SectionHeading } from "./primitives";
import type { ViewProps } from "./views";

const workflowNames: Record<string, { name: string; detail: string }> = {
  ANALYZE_WEBSITE: {
    name: "Website intelligence",
    detail: "Build an evidence-based business profile.",
  },
  DISCOVER: {
    name: "Business discovery",
    detail: "Find businesses that match your target audience.",
  },
  RESEARCH_LEAD: {
    name: "Lead research",
    detail: "Collect public business information and sources.",
  },
  QUALIFY: {
    name: "Lead qualification",
    detail: "Evaluate fit against your business criteria.",
  },
  VERIFY_EMAIL: {
    name: "Email verification",
    detail: "Check recipient addresses before outreach.",
  },
  DRAFT_EMAIL: {
    name: "Outreach drafting",
    detail: "Prepare an individual message for review.",
  },
  SYNC_MAILBOX: {
    name: "Inbox synchronization",
    detail: "Import conversations from your connected mailbox.",
  },
  SEND_CAMPAIGN: {
    name: "Campaign outreach",
    detail: "Process approved messages within sending safeguards.",
  },
  SEND_REPLY: {
    name: "Approved replies",
    detail: "Send a response after explicit client approval.",
  },
  RECONCILE_MAIL: {
    name: "Send reconciliation",
    detail: "Review uncertain provider acceptance outcomes.",
  },
  CLASSIFY_REPLY: {
    name: "Reply intelligence",
    detail: "Identify intent and suggest the next response.",
  },
  REPORT: {
    name: "Performance reporting",
    detail: "Prepare reporting from recorded activity.",
  },
};
const statusDescriptions: Record<string, string> = {
  QUEUED:
    "Waiting for the next eligible dispatch. Provider rate limits and sending windows can defer this operation.",
  WAITING_AUTOMATION:
    "Dispatched to the configured n8n endpoint; waiting for an authenticated workflow admission.",
  READY: "Admitted by automation and ready for a worker to claim.",
  RUNNING:
    "A worker has claimed this operation. Its current lease is shown below.",
  SUCCEEDED:
    "The worker recorded a successful completion. Email acceptance is not proof of delivery.",
  FAILED:
    "Execution failed. Review the recorded error before creating another operation.",
  REVIEW_REQUIRED:
    "The outcome needs review. Repeating a send before reconciliation can create duplicate messages.",
  CANCELLED: "This operation was cancelled.",
};
function workflowName(value: unknown) {
  return workflowNames[text(value)]?.name || label(value);
}
function formatted(value: unknown) {
  return new Intl.NumberFormat("en-ZA").format(number(value));
}
function duration(value: unknown) {
  if (value === null || value === undefined) return "—";
  const milliseconds = number(value);
  if (milliseconds < 1000) return "< 1s";
  if (milliseconds < 60_000) return `${Math.floor(milliseconds / 1000)}s`;
  if (milliseconds < 3_600_000)
    return `${Math.floor(milliseconds / 60_000)}m ${Math.floor((milliseconds % 60_000) / 1000)}s`;
  return `${Math.floor(milliseconds / 3_600_000)}h ${Math.floor((milliseconds % 3_600_000) / 60_000)}m`;
}
function timestamp(value: unknown, timezone: string) {
  if (!value) return "—";
  const instant = new Date(String(value));
  if (Number.isNaN(instant.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-ZA", {
      timeZone: timezone,
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(instant);
  } catch {
    return instant.toISOString();
  }
}

export function AutomationView({ data, organization, refresh }: ViewProps) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const counts = rows(data.counts);
  const workflows = rows(data.workflows);
  const jobs = rows(data.jobs);
  const timezone = organization.timezone || "Africa/Johannesburg";
  const count = (...states: string[]) =>
    counts.reduce(
      (sum, group) =>
        sum + (states.includes(text(group.status)) ? number(group.count) : 0),
      0,
    );
  const total = counts.reduce((sum, group) => sum + number(group.count), 0);
  const configured = data.configurationState === "CONFIGURED";
  const invalid = data.configurationState === "INVALID";
  const visible = jobs.filter(
    (job) =>
      (!status || job.status === status) &&
      (!kind || job.kind === kind) &&
      (!search.trim() ||
        [
          job.id,
          job.kind,
          workflowName(job.kind),
          job.error,
          job.resultSummary,
        ].some((value) =>
          text(value, "").toLowerCase().includes(search.trim().toLowerCase()),
        )),
  );
  const recentErrors = jobs
    .filter(
      (job) =>
        job.error && ["FAILED", "REVIEW_REQUIRED"].includes(text(job.status)),
    )
    .slice(0, 3);
  const metrics = [
    {
      name: "Successful executions",
      value: count("SUCCEEDED"),
      detail: "Recorded successful completions",
      icon: CheckCircle2,
    },
    {
      name: "In progress",
      value: count("RUNNING", "READY", "WAITING_AUTOMATION"),
      detail: `${formatted(count("RUNNING"))} running · ${formatted(count("WAITING_AUTOMATION"))} awaiting automation`,
      icon: Activity,
    },
    {
      name: "Queued operations",
      value: count("QUEUED"),
      detail: "Waiting for an eligible dispatch",
      icon: Clock3,
    },
    {
      name: "Needs attention",
      value: count("FAILED", "REVIEW_REQUIRED"),
      detail: `${formatted(count("FAILED"))} failed · ${formatted(count("REVIEW_REQUIRED"))} require review`,
      icon: TriangleAlert,
    },
  ];

  function openError(job: RecordValue) {
    setSearch("");
    setStatus("");
    setKind("");
    setExpanded(text(job.id));
    window.setTimeout(
      () =>
        document
          .getElementById(`execution-${text(job.id)}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      0,
    );
  }

  return (
    <>
      <SectionHeading
        eyebrow="OPERATIONS / AUTOMATION"
        title="Every operation, in view."
        detail="Follow research, outreach and inbox processing across your business. Every count comes from your recorded operations."
        action={
          <button onClick={refresh}>
            <RefreshCw size={15} /> Refresh activity
          </button>
        }
      />

      <div className="surface automation-summary">
        <div className="card-heading">
          <div className="business-cell">
            <span className="feature-icon">
              <Workflow size={24} strokeWidth={1.5} />
            </span>
            <div>
              <p className="eyebrow">N8N ORCHESTRATION</p>
              <h3>
                {configured
                  ? "Configuration in place"
                  : invalid
                    ? "Configuration needs attention"
                    : "Awaiting connection"}
              </h3>
              <p className="subtle">
                {configured
                  ? "The server has an orchestration endpoint and authentication secret configured."
                  : invalid
                    ? "The configured automation endpoint is invalid. Ask your platform administrator to review it."
                    : "Your platform administrator needs to configure the n8n endpoint and authentication secret."}
              </p>
            </div>
          </div>
          <Badge
            value={
              configured
                ? "CONFIGURED"
                : invalid
                  ? "NEEDS_REVIEW"
                  : "NOT_CONFIGURED"
            }
          />
        </div>
        <div className="automation-meta">
          <span>
            <ShieldCheck size={14} /> Workflow activation has not been verified
          </span>
          <span>{formatted(workflows.length)} supported workflow types</span>
          <span>Updated {timestamp(data.generatedAt, timezone)}</span>
        </div>
      </div>

      <div className="metric-grid">
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.name}>
            <div className="metric-label">
              <span>{metric.name}</span>
              <metric.icon size={17} />
            </div>
            <strong>{formatted(metric.value)}</strong>
            <p>{metric.detail}</p>
          </article>
        ))}
      </div>

      <div className="automation-layout">
        <section className="surface">
          <div className="card-heading">
            <div>
              <p className="eyebrow">SUPPORTED OPERATIONS</p>
              <h3>Workflow performance</h3>
            </div>
            <GitBranch size={18} />
          </div>
          <p className="section-detail">
            Available workflow types and their recorded outcomes. Availability
            does not confirm activation in n8n.
          </p>
          <div className="table-scroll">
            <table aria-label="Supported automation workflows and recorded outcomes">
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Executions</th>
                  <th>Successful</th>
                  <th>Failed</th>
                  <th>Running</th>
                </tr>
              </thead>
              <tbody>
                {workflows.map((workflow) => (
                  <tr key={text(workflow.kind)}>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => {
                          setKind(text(workflow.kind));
                          setStatus("");
                        }}
                      >
                        <b>{workflowName(workflow.kind)}</b>
                        <ArrowDown size={12} />
                      </button>
                      <small>
                        {workflowNames[text(workflow.kind)]?.detail}
                      </small>
                    </td>
                    <td>{formatted(workflow.total)}</td>
                    <td>{formatted(workflow.succeeded)}</td>
                    <td>{formatted(workflow.failed)}</td>
                    <td>{formatted(workflow.running)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="surface">
          <div className="card-heading">
            <div>
              <p className="eyebrow">OPERATIONS HEALTH</p>
              <h3>Where things stand</h3>
            </div>
            <Activity size={18} />
          </div>
          <div className="workflow-list">
            {[
              ["QUEUED", "Queued"],
              ["WAITING_AUTOMATION", "Awaiting automation"],
              ["READY", "Ready for processing"],
              ["RUNNING", "Running"],
              ["SUCCEEDED", "Succeeded"],
              ["FAILED", "Failed"],
              ["REVIEW_REQUIRED", "Requires review"],
            ].map(([value, name]) => (
              <button
                className="workflow-row"
                key={value}
                onClick={() => setStatus(status === value ? "" : value)}
                aria-pressed={status === value}
              >
                <span>{name}</span>
                <b>{formatted(count(value))}</b>
              </button>
            ))}
          </div>
          <div className="execution-detail">
            <p className="eyebrow">RECENT ERRORS</p>
            {recentErrors.length ? (
              recentErrors.map((job) => (
                <button
                  className="workflow-row"
                  key={text(job.id)}
                  onClick={() => openError(job)}
                >
                  <span>
                    <b>{workflowName(job.kind)}</b>
                    <small>{text(job.error).slice(0, 110)}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))
            ) : (
              <p className="subtle">
                No failed or review-required operations in the latest{" "}
                {jobs.length} records.
              </p>
            )}
          </div>
        </section>
      </div>

      <section className="surface section-space">
        <div className="card-heading">
          <div>
            <p className="eyebrow">EXECUTION HISTORY</p>
            <h3>The complete operational trail.</h3>
          </div>
          <span className="subtle">
            Latest {jobs.length} of {formatted(total)} operations
          </span>
        </div>
        <div className="table-toolbar">
          <label className="search-input">
            <Search size={16} />
            <input
              aria-label="Search automation history"
              placeholder="Search workflow, ID or error…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select
            aria-label="Filter execution status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            {[
              ...new Set([
                ...counts.map((group) => text(group.status)),
                ...jobs.map((job) => text(job.status)),
              ]),
            ]
              .sort()
              .map((value) => (
                <option value={value} key={value}>
                  {label(value)}
                </option>
              ))}
          </select>
          <select
            aria-label="Filter workflow type"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="">All workflows</option>
            {workflows.map((workflow) => (
              <option value={text(workflow.kind)} key={text(workflow.kind)}>
                {workflowName(workflow.kind)}
              </option>
            ))}
          </select>
          {(search || status || kind) && (
            <button
              className="text-button"
              onClick={() => {
                setSearch("");
                setStatus("");
                setKind("");
              }}
            >
              Clear filters
            </button>
          )}
        </div>
        {!jobs.length ? (
          <Empty
            icon={<Workflow size={26} />}
            title="Your operational trail starts here."
            detail="Website research, lead generation and outreach operations will appear here when you start them in your workspace."
          />
        ) : !visible.length ? (
          <Empty
            title="No matching operations."
            detail="Filters apply to the most recent 100 operations. Adjust your search or select another status."
            action={
              <button
                onClick={() => {
                  setSearch("");
                  setStatus("");
                  setKind("");
                }}
              >
                Clear filters
              </button>
            }
          />
        ) : (
          <div className="table-scroll">
            <table aria-label="Recent automation executions">
              <thead>
                <tr>
                  <th>Workflow / execution</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Attempts</th>
                  <th>
                    <span className="sr-only">Execution details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((job) => {
                  const id = text(job.id);
                  const selected = expanded === id;
                  const retries =
                    number(job.executionRetries) + number(job.dispatchRetries);
                  return (
                    <Fragment key={id}>
                      <tr id={`execution-${id}`}>
                        <td>
                          <b>{workflowName(job.kind)}</b>
                          <small title={id}>{id.slice(0, 16)}…</small>
                        </td>
                        <td>
                          <Badge value={job.status} />
                          {job.status === "QUEUED" && (
                            <small>
                              Next eligible: {timestamp(job.runAt, timezone)}
                            </small>
                          )}
                        </td>
                        <td>
                          {timestamp(job.startedAt || job.createdAt, timezone)}
                          <small>
                            {job.startedAt
                              ? "Worker started"
                              : "Created · not started"}
                          </small>
                        </td>
                        <td>
                          {duration(job.durationMs)}
                          {job.status === "RUNNING" && (
                            <small>In progress</small>
                          )}
                        </td>
                        <td>
                          {formatted(job.attempts)} executions
                          <small>
                            {formatted(job.dispatchAttempts)} dispatches
                            {retries ? ` · ${formatted(retries)} repeats` : ""}
                          </small>
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`${selected ? "Close" : "Open"} execution ${id}`}
                            aria-expanded={selected}
                            aria-controls={`detail-${id}`}
                            onClick={() => setExpanded(selected ? null : id)}
                          >
                            <ChevronDown
                              size={16}
                              style={{
                                transform: selected
                                  ? "rotate(180deg)"
                                  : undefined,
                              }}
                            />
                          </button>
                        </td>
                      </tr>
                      {selected && (
                        <tr>
                          <td colSpan={6}>
                            <div
                              className="execution-detail"
                              id={`detail-${id}`}
                            >
                              <div className="card-heading">
                                <div>
                                  <p className="eyebrow">EXECUTION DETAILS</p>
                                  <h3>{workflowName(job.kind)}</h3>
                                </div>
                                <Badge value={job.status} />
                              </div>
                              <p>
                                {statusDescriptions[text(job.status)] ||
                                  "Current status recorded by the background worker."}
                              </p>
                              <dl className="key-values">
                                {Object.entries({
                                  "Execution ID": id,
                                  Created: timestamp(job.createdAt, timezone),
                                  Started: timestamp(job.startedAt, timezone),
                                  Completed: timestamp(
                                    job.completedAt,
                                    timezone,
                                  ),
                                  "Next eligible dispatch": timestamp(
                                    job.runAt,
                                    timezone,
                                  ),
                                  "Worker lease ends": timestamp(
                                    job.leaseUntil,
                                    timezone,
                                  ),
                                  "Execution attempts": text(job.attempts, "0"),
                                  "Dispatch attempts": text(
                                    job.dispatchAttempts,
                                    "0",
                                  ),
                                  "Repeated execution attempts": text(
                                    job.executionRetries,
                                    "0",
                                  ),
                                  "Repeated dispatch attempts": text(
                                    job.dispatchRetries,
                                    "0",
                                  ),
                                }).map(([name, value]) => (
                                  <div key={name}>
                                    <dt>{name}</dt>
                                    <dd>{value}</dd>
                                  </div>
                                ))}
                              </dl>
                              {job.resultSummary ? (
                                <div className="alert">
                                  <CheckCircle2 size={15} />
                                  <span>{text(job.resultSummary)}</span>
                                </div>
                              ) : null}
                              {job.error ? (
                                <div
                                  className="alert error automation-error"
                                  role="note"
                                >
                                  <TriangleAlert size={16} />
                                  <span>{text(job.error)}</span>
                                </div>
                              ) : null}
                              <p className="subtle">
                                Repeated attempt counters describe actual
                                attempts, including deferred work. They do not
                                confirm duplicate provider requests. Manual
                                retries are unavailable here because uncertain
                                sending outcomes require reconciliation first.
                              </p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="section-detail automation-meta">
          All-time totals cover this organization only. History and filters show
          up to 100 recent operations. Times use {timezone}.
        </p>
      </section>
    </>
  );
}
