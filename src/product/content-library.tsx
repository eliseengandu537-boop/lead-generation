"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Copy, PenLine, Plus, Search } from "lucide-react";
import { api, date, label, number, rows, text, type RecordValue } from "./data";
import { Badge, Empty, Loading } from "./primitives";
import { Stat, Stats, Tabs, compact } from "./admin-ui";

export default function ContentLibrary() {
  const [data, setData] = useState<RecordValue | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("campaigns");
  const [client, setClient] = useState("");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    const controller = new AbortController();
    api("/api/platform/admin/content", "GET", undefined, controller.signal)
      .then((result) => !controller.signal.aborted && setData(result))
      .catch((problem) => {
        if (!controller.signal.aborted) setError(problem.message);
      });
    return () => controller.abort();
  }, []);
  const businesses = rows(data?.businesses);
  const businessName = (id: unknown) =>
    text(businesses.find((item) => item.workspaceId === id)?.name, "Client");
  const matches = (item: RecordValue) =>
    (!client || item.workspaceId === client) &&
    `${text(item.name, "")} ${text(item.subject, "")} ${text(item.body, "")} ${businessName(item.workspaceId)}`
      .toLowerCase()
      .includes(search.trim().toLowerCase());
  const templates = useMemo(
    () => rows(data?.templates).filter(matches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, client, search],
  );
  const campaigns = useMemo(
    () => rows(data?.campaigns).filter(matches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, client, search],
  );
  const items = kind === "templates" ? templates : campaigns;
  const writer = client || text(businesses.find((item) => !item.demo)?.workspaceId ?? businesses[0]?.workspaceId, "");
  async function copy(item: RecordValue) {
    try {
      await navigator.clipboard.writeText(
        `Subject: ${text(item.subject, "")}\n\n${text(item.body, "")}`,
      );
      setCopied(text(item.id));
      window.setTimeout(() => setCopied(""), 1800);
    } catch {
      setError("Your browser blocked copying. Select the text and copy it instead.");
    }
  }
  if (error && !data)
    return (
      <div className="alert error" role="alert">
        {error}
      </div>
    );
  if (!data) return <Loading />;
  const allTemplates = rows(data.templates),
    allCampaigns = rows(data.campaigns);
  return (
    <div className="adm-content">
      <Stats>
        <Stat
          label="Campaign emails"
          value={allCampaigns.length}
          hint={(() => {
            const followUps = allCampaigns.reduce(
              (sum, item) => sum + number(item.followUps),
              0,
            );
            return `${compact(followUps)} follow-up${followUps === 1 ? "" : "s"} written`;
          })()}
        />
        <Stat
          label="Templates"
          value={allTemplates.length}
          hint={`${compact(allTemplates.filter((item) => item.approvalStatus === "APPROVED").length)} approved`}
        />
        <Stat
          label="Clients with content"
          value={
            new Set(
              [...allTemplates, ...allCampaigns].map((item) => item.workspaceId),
            ).size
          }
          hint={`of ${compact(businesses.length)} clients`}
        />
      </Stats>
      <Tabs
        label="Content type"
        value={kind}
        onChange={setKind}
        items={[
          { id: "campaigns", label: "Campaign emails", count: campaigns.length },
          { id: "templates", label: "Templates", count: templates.length },
        ]}
      />
      <div className="adm-toolbar">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Search content"
            placeholder="Search subject lines, wording or clients…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select
          aria-label="Show content for one client"
          value={client}
          onChange={(event) => setClient(event.target.value)}
        >
          <option value="">All clients</option>
          {businesses.map((business) => (
            <option
              key={text(business.workspaceId)}
              value={text(business.workspaceId)}
            >
              {text(business.name)}
            </option>
          ))}
        </select>
        {writer && (
          <Link
            className="button primary"
            href={`/?client=${encodeURIComponent(writer)}&view=${kind === "templates" ? "templates" : "campaigns"}`}
          >
            <Plus size={16} />
            {kind === "templates" ? "New template" : "New campaign email"}
          </Link>
        )}
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {items.length ? (
        <div className="adm-content-grid">
          {items.map((item) => {
            const id = text(item.id);
            const expanded = open.has(id);
            const long = text(item.body, "").split("\n").length > 9 || text(item.body, "").length > 520;
            return (
              <article className="adm-content-card" key={id}>
                <header>
                  <div>
                    <h3>{text(item.name)}</h3>
                    <p>{businessName(item.workspaceId)}</p>
                  </div>
                  <Badge value={kind === "templates" ? item.approvalStatus : item.status} />
                </header>
                <p className="adm-content-subject">
                  <span>Subject</span>
                  {text(item.subject)}
                </p>
                <pre
                  className={`adm-content-body${long ? " is-long" : ""}${expanded ? " is-open" : ""}`}
                >
                  {text(item.body, "")}
                </pre>
                {long && (
                  <button
                    className="text-button adm-content-more"
                    onClick={() =>
                      setOpen((current) => {
                        const next = new Set(current);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                  >
                    {expanded ? "Show less" : "Show the full email"}
                  </button>
                )}
                <footer>
                  <span className="muted">
                    {kind === "templates"
                      ? `${label(item.category)} · used in ${compact(item.campaigns)} campaign${number(item.campaigns) === 1 ? "" : "s"}`
                      : `${label(item.purpose)} · ${number(item.followUps) ? `${compact(item.followUps)} follow-up${number(item.followUps) === 1 ? "" : "s"}` : "single email"}`}{" "}
                    · {date(item.updatedAt)}
                  </span>
                  <div className="adm-content-actions">
                    <button onClick={() => void copy(item)}>
                      {copied === id ? <Check size={14} /> : <Copy size={14} />}
                      {copied === id ? "Copied" : "Copy"}
                    </button>
                    <Link
                      className="button"
                      href={`/?client=${encodeURIComponent(text(item.workspaceId, ""))}&view=${kind === "templates" ? "templates" : "campaigns"}`}
                    >
                      <PenLine size={14} />
                      Edit
                    </Link>
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          title={
            search || client
              ? "Nothing matches this search."
              : kind === "templates"
                ? "No templates yet."
                : "No campaign emails yet."
          }
          detail={
            search || client
              ? "Try another word or show all clients."
              : "Write the first one in a client's workspace and it will show here."
          }
        />
      )}
    </div>
  );
}
