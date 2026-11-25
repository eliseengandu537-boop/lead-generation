"use client";
import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { api, date, label, number, object, rows, text, type RecordValue } from "./data";
import { Badge, Empty, Loading } from "./primitives";
import { TrendChart } from "./charts";
import { Funnel, Panel, Stat, Stats, compact, percent } from "./admin-ui";

function download(name: string, header: string[], lines: (string | number)[][]) {
  const cell = (value: string | number) => {
    const raw = String(value ?? "");
    // Quote every cell; a leading = + - @ would run as a formula in a spreadsheet.
    const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csv = [header, ...lines].map((line) => line.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** One report per client (or all clients together) for the chosen period, ready to export. */
export default function AdminReports({
  directory,
  period,
  rangeLabel,
}: {
  directory: RecordValue[];
  period: string;
  rangeLabel: string;
}) {
  const [client, setClient] = useState("");
  const [view, setView] = useState<RecordValue | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setView(null);
    setError("");
    api(
      `/api/platform/admin/insights?${period}${client ? `&workspaceId=${encodeURIComponent(client)}` : ""}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((result) => !controller.signal.aborted && setView(result))
      .catch((problem) => !controller.signal.aborted && setError(problem.message));
    return () => controller.abort();
  }, [client, period]);

  const series = rows(view?.series);
  const sum = (key: string) => series.reduce((total, day) => total + number(day[key]), 0);
  const scope = client ? directory.filter((row) => text(row.workspaceId) === client) : directory;
  const lifetime = (key: string) => scope.reduce((total, row) => total + number(row[key]), 0);
  const chosen = directory.find((row) => text(row.workspaceId) === client);
  const campaigns = rows(view?.campaigns).filter(
    (row) => !client || text(row.workspaceId) === client,
  );
  const ranked = useMemo(
    () => [...directory].sort((a, b) => number(b.sent) - number(a.sent) || number(b.leads) - number(a.leads)),
    [directory],
  );
  const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "client";

  function exportReport() {
    if (chosen) {
      download(
        `${slug(text(chosen.name))}-report-${text(object(view?.range).from)}-to-${text(object(view?.range).to)}.csv`,
        ["Day", "Emails sent", "Delivered", "Replies", "Positive replies", "Bounces", "Leads found"],
        series.map((day) => [
          text(day.day),
          number(day.sent),
          number(day.delivered),
          number(day.replies),
          number(day.positive),
          number(day.bounces),
          number(day.leads),
        ]),
      );
      return;
    }
    download(
      `client-reports-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Client", "Website", "Plan", "Leads found", "Qualified", "Emails sent", "Replies", "Reply rate", "Positive replies", "Running campaigns", "Last active"],
      ranked.map((row) => [
        text(row.name),
        text(row.websiteUrl, ""),
        text(row.planName, ""),
        number(row.discovered),
        number(row.qualified),
        number(row.sent),
        number(row.replies),
        percent(row.replies, row.sent),
        number(row.positive),
        number(row.activeCampaigns),
        text(row.lastActivity, "").slice(0, 10),
      ]),
    );
  }

  return (
    <div className="adm-reports">
      <div className="adm-toolbar adm-report-bar">
        <div className="adm-chips" role="group" aria-label="Choose a client">
          <button className={`adm-chip${client ? "" : " is-on"}`} aria-pressed={!client} onClick={() => setClient("")}>
            All clients
          </button>
          {directory.map((row) => (
            <button
              key={text(row.workspaceId)}
              className={`adm-chip${client === text(row.workspaceId) ? " is-on" : ""}`}
              aria-pressed={client === text(row.workspaceId)}
              onClick={() => setClient(text(row.workspaceId))}
            >
              {text(row.name)}
            </button>
          ))}
        </div>
        <button className="primary" onClick={exportReport} disabled={!view}>
          <Download size={16} />
          Export CSV
        </button>
      </div>
      {error && <div className="alert error" role="alert">{error}</div>}
      {!view ? (
        <Loading />
      ) : (
        <>
          <Stats>
            <Stat label="Emails sent" value={sum("sent")} hint={rangeLabel} />
            <Stat label="Replies" value={sum("replies")} hint={`${percent(sum("replies"), sum("sent"))} reply rate`} />
            <Stat
              label="Positive replies"
              value={sum("positive")}
              tone={sum("positive") ? "good" : undefined}
              hint={`${percent(sum("positive"), sum("replies"))} of replies`}
            />
            <Stat label="Leads found" value={sum("leads")} hint={rangeLabel} />
            <Stat
              label="Bounces"
              value={sum("bounces")}
              tone={sum("sent") && sum("bounces") / sum("sent") >= 0.03 ? "bad" : undefined}
              hint={`${percent(sum("bounces"), sum("sent"))} of sent · pauses at 3%`}
            />
          </Stats>
          <div className="adm-grid adm-grid-main">
            <Panel className="adm-chart-panel">
              <TrendChart
                values={series}
                title={chosen ? `${text(chosen.name)}, day by day` : "All clients, day by day"}
                description={`Daily totals, ${rangeLabel}.`}
                metrics={[
                  { key: "sent", label: "Emails sent" },
                  { key: "replies", label: "Replies" },
                  { key: "positive", label: "Positive replies" },
                  { key: "leads", label: "Leads found" },
                  { key: "bounces", label: "Bounces" },
                ]}
              />
            </Panel>
            <Panel title="Results so far" detail={chosen ? "Lifetime totals for this client." : "Lifetime totals across every client."}>
              <Funnel
                steps={[
                  { label: "Leads found", value: lifetime("discovered") },
                  { label: "Qualified", value: lifetime("qualified") },
                  { label: "Emails sent", value: lifetime("sent"), rate: null },
                  {
                    label: "Replies",
                    value: lifetime("replies"),
                    rate: `${percent(lifetime("replies"), lifetime("sent"))} reply rate`,
                  },
                  { label: "Positive replies", value: lifetime("positive") },
                ]}
              />
            </Panel>
          </div>
          {chosen && (
            <Panel title="Campaigns" detail={`${compact(campaigns.length)} campaign${campaigns.length === 1 ? "" : "s"} for ${text(chosen.name)}.`}>
              {campaigns.length ? (
                <div className="table-scroll">
                  <table className="adm-table">
                    <thead>
                      <tr>
                        <th>Campaign</th>
                        <th>Status</th>
                        <th>Sent</th>
                        <th>Replies</th>
                        <th>Positive</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaigns.map((row) => (
                        <tr key={text(row.id)}>
                          <td>
                            <b>{text(row.name)}</b>
                          </td>
                          <td>
                            <Badge value={row.status} />
                          </td>
                          <td>{compact(row.sent)}</td>
                          <td>
                            {compact(row.replies)}
                            <small>{percent(row.replies, row.sent)}</small>
                          </td>
                          <td>{compact(row.positive)}</td>
                          <td>{date(row.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="adm-panel-copy">No campaigns yet for this client.</p>
              )}
            </Panel>
          )}
          <Panel title="Client comparison" detail="Lifetime results per client. Pick a client to open their report.">
            {ranked.length ? (
              <div className="table-scroll">
                <table className="adm-table adm-compare">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Leads</th>
                      <th>Qualified</th>
                      <th>Sent</th>
                      <th>Replies</th>
                      <th>Reply rate</th>
                      <th>Positive</th>
                      <th>Running</th>
                      <th>Last active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map((row) => (
                      <tr
                        key={text(row.workspaceId)}
                        className={client === text(row.workspaceId) ? "is-picked" : undefined}
                      >
                        <td>
                          <button className="adm-client-name" onClick={() => setClient(text(row.workspaceId))}>
                            {text(row.name)}
                          </button>
                          <small>{text(row.planName, label(row.subscriptionStatus || "NO_PLAN"))}</small>
                        </td>
                        <td>{compact(row.discovered)}</td>
                        <td>{compact(row.qualified)}</td>
                        <td>{compact(row.sent)}</td>
                        <td>{compact(row.replies)}</td>
                        <td>{percent(row.replies, row.sent)}</td>
                        <td>{compact(row.positive)}</td>
                        <td>{compact(row.activeCampaigns)}</td>
                        <td>{date(row.lastActivity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No clients yet." detail="Client results show here once they are added." />
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
