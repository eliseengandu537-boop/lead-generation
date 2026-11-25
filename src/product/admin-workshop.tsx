"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, CircleDot, ExternalLink, Wrench } from "lucide-react";
import { number, object, rows, text, type RecordValue } from "./data";
import { Empty } from "./primitives";
import { Stat, Stats, compact } from "./admin-ui";

const clientLink = (workspaceId: unknown, view?: string) =>
  `/?client=${encodeURIComponent(text(workspaceId, ""))}${view ? `&view=${view}` : ""}`;

/** A ring of `total` dots, `done` of them lit: a client's setup progress at a glance. */
export function SetupRing({ done, total, size = 44 }: { done: number; total: number; size?: number }) {
  const count = Math.max(1, total);
  const radius = size / 2 - 6;
  return (
    <span className="adm-ring" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={radius} className="adm-ring-track" />
        {Array.from({ length: count }, (_, index) => {
          const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
          return (
            <circle
              key={index}
              cx={size / 2 + Math.cos(angle) * radius}
              cy={size / 2 + Math.sin(angle) * radius}
              r={size > 50 ? 5.5 : 3.6}
              className={index < done ? "is-done" : ""}
            />
          );
        })}
      </svg>
      <b>{done}</b>
    </span>
  );
}

/** Every active client as a job on the floor: where their outreach setup stands and what is next. */
export default function AdminWorkshop({
  clients,
  setup,
  onPlan,
}: {
  clients: RecordValue[];
  setup: RecordValue;
  onPlan: (workspaceId: string) => void;
}) {
  const jobs = clients
    .map((row) => {
      const progress = object(setup[text(row.workspaceId)]);
      return { row, progress, done: number(progress.done), total: number(progress.total) || 6 };
    })
    .filter((job) => job.progress.total !== undefined)
    .sort((a, b) => {
      const aComplete = a.done >= a.total ? 1 : 0;
      const bComplete = b.done >= b.total ? 1 : 0;
      return aComplete - bComplete || b.done - a.done || text(a.row.name).localeCompare(text(b.row.name));
    });
  const [chosen, setChosen] = useState("");
  const job = jobs.find((item) => text(item.row.workspaceId) === chosen) ?? jobs[0];
  const open = jobs.filter((item) => item.done < item.total);
  const stepMissing = (id: string) =>
    jobs.filter((item) => rows(item.progress.steps).some((step) => step.id === id && !step.done)).length;

  if (!jobs.length)
    return (
      <Empty
        title="No clients on the floor."
        detail="Add a client and their setup steps show here until their outreach is sending."
        icon={<Wrench size={22} />}
      />
    );

  const steps = rows(job.progress.steps);
  const nextStep = steps.find((step) => !step.done);
  const stepAction = (step: RecordValue, primary = false) =>
    step.view === "admin" ? (
      <button className={primary ? "primary" : "button"} onClick={() => onPlan(text(job.row.workspaceId))}>
        {primary ? `Do it: ${text(step.label).toLowerCase()}` : "Open"}
      </button>
    ) : (
      <Link className={`button${primary ? " primary" : ""}`} href={clientLink(job.row.workspaceId, text(step.view))}>
        {primary ? `Do it: ${text(step.label).toLowerCase()}` : "Open"} <ArrowUpRight size={14} />
      </Link>
    );

  return (
    <div className="adm-workshop">
      <Stats>
        <Stat label="Clients on the floor" value={open.length} hint={`${compact(jobs.length)} clients in total`} />
        <Stat
          label="Sending"
          value={jobs.length - open.length}
          tone={jobs.length - open.length ? "good" : undefined}
          hint="Setup finished, outreach running"
        />
        <Stat
          label="Waiting on a plan"
          value={stepMissing("plan")}
          tone={stepMissing("plan") ? "bad" : undefined}
          hint="Nothing sends until it is active"
        />
        <Stat
          label="Need an inbox"
          value={stepMissing("inbox")}
          tone={stepMissing("inbox") ? "warn" : undefined}
          hint="Sending inbox not switched on"
        />
      </Stats>
      <div className="adm-workshop-layout">
        <ul className="adm-jobs" aria-label="Clients">
          {jobs.map((item, index) => {
            const id = text(item.row.workspaceId);
            const complete = item.done >= item.total;
            return (
              <li key={id} style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}>
                <button
                  className={`adm-job${id === text(job.row.workspaceId) ? " is-on" : ""}${complete ? " is-complete" : ""}`}
                  aria-pressed={id === text(job.row.workspaceId)}
                  onClick={() => setChosen(id)}
                >
                  <span className="adm-job-tile">{text(item.row.name).slice(0, 1).toUpperCase()}</span>
                  <span className="adm-job-text">
                    <small>
                      {complete ? "Sending" : `Step ${Math.min(item.done + 1, item.total)} of ${item.total}`}
                    </small>
                    <b>{text(item.row.name)}</b>
                    <span>{complete ? "Outreach is running" : `Next: ${text(item.progress.next)}`}</span>
                  </span>
                  <SetupRing done={item.done} total={item.total} />
                </button>
              </li>
            );
          })}
        </ul>
        <section className="adm-panel adm-job-detail" key={text(job.row.workspaceId)}>
          <header className="adm-job-head">
            <SetupRing done={job.done} total={job.total} size={64} />
            <div>
              <p>
                {job.done >= job.total
                  ? "All steps done, outreach is sending"
                  : `Step ${Math.min(job.done + 1, job.total)} of ${job.total}: ${text(nextStep?.label)}`}
              </p>
              <h2>{text(job.row.name)}</h2>
              {text(job.row.websiteUrl, "") ? (
                <a href={text(job.row.websiteUrl)} target="_blank" rel="noopener noreferrer">
                  {text(job.row.websiteUrl).replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                  <ExternalLink size={12} />
                </a>
              ) : (
                <span className="muted">No website yet</span>
              )}
            </div>
            <div className="adm-job-actions">
              <Link className="button" href={clientLink(job.row.workspaceId, "outreach")}>
                Open workspace <ArrowUpRight size={14} />
              </Link>
              {nextStep && stepAction(nextStep, true)}
            </div>
          </header>
          <ol className="adm-track" aria-label="Setup steps">
            {steps.map((step, index) => (
              <li
                key={text(step.id)}
                className={step.done ? "is-done" : step === nextStep ? "is-next" : ""}
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <i />
                <span>{text(step.label)}</span>
              </li>
            ))}
          </ol>
          <table className="adm-table adm-steps">
            <thead>
              <tr>
                <th>Step</th>
                <th>Where it stands</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step, index) => (
                <tr key={text(step.id)} className={step.done ? "is-done" : ""}>
                  <td>
                    <span className="adm-step-name">
                      <em>{String(index + 1).padStart(2, "0")}</em>
                      {text(step.label)}
                    </span>
                  </td>
                  <td>{text(step.detail)}</td>
                  <td>
                    {step.done ? (
                      <span className="adm-step-state is-done">
                        <Check size={14} /> Done
                      </span>
                    ) : (
                      <span className={`adm-step-state${step === nextStep ? " is-next" : ""}`}>
                        <CircleDot size={14} /> {step === nextStep ? "Next" : "To do"}
                      </span>
                    )}
                  </td>
                  <td>{stepAction(step)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
