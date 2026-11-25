"use client";
import { useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import {
  Bell,
  Building2,
  ChevronDown,
  Inbox,
  LogOut,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { Tabs } from "./admin-ui";
import {
  api,
  object,
  type Organization,
  type RecordValue,
  type SessionView,
} from "./data";
import { ActionDialog, type Dialog, Loading, MonetticMark } from "./primitives";
import { ResourceView } from "./views";
import { ThemeToggle } from "./theme";
import { GlassBackdrop, GlassBrand, PillNav, RailButton } from "./glass-nav";

/** The client workspace is built around one job: email outreach. Each menu section can hold
 * several views shown as tabs; `extra` views stay reachable by link but are not in the menu. */
const sections: {
  id: string;
  label: string;
  icon: typeof Send;
  group: string;
  views: { id: string; label: string }[];
  extra?: string[];
}[] = [
  {
    id: "outreach",
    label: "Email Outreach",
    icon: Send,
    group: "",
    views: [{ id: "outreach", label: "Email outreach" }],
    extra: [
      "overview",
      "reports",
      "campaigns",
      "templates",
      "discovery",
      "business",
      "automation",
    ],
  },
  {
    id: "leads",
    label: "Leads",
    icon: Users,
    group: "",
    views: [{ id: "leads", label: "Leads" }],
  },
  {
    id: "replies",
    label: "Replies",
    icon: Inbox,
    group: "",
    views: [{ id: "inbox", label: "Replies" }],
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings2,
    group: "",
    views: [
      { id: "mailboxes", label: "Sending inbox" },
      { id: "settings", label: "Workspace" },
      { id: "team", label: "Team" },
      { id: "billing", label: "Billing" },
      { id: "notifications", label: "Notifications" },
    ],
  },
];
const navigation = sections.flatMap((section) => [
  ...section.views,
  ...(section.extra ?? []).map((id) => ({ id, label: id })),
]);

export default function MonetticApp() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [tab, setTab] = useState("outreach");
  const [value, setValue] = useState<RecordValue>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("view");
    if (navigation.some((entry) => entry.id === requested)) setTab(requested!);
  }, []);
  useEffect(() => {
    if (!["overview", "notifications"].includes(tab) || dialog) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [tab, dialog, refresh]);
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
        const selected =
          new URLSearchParams(window.location.search).get("client") ||
          window.localStorage.getItem("orbit-organization");
        setOrganizationId((current) =>
          result.organizations.some((entry) => entry.workspaceId === current)
            ? current
            : result.organizations.some(
                  (entry) => entry.workspaceId === selected,
                )
              ? selected!
              : result.organizations[0]?.workspaceId || "",
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
  }, [revision]);
  useEffect(() => {
    if (!organizationId) return;
    window.localStorage.setItem("orbit-organization", organizationId);
    setLoading(true);
    setValue({});
    setError("");
    const controller = new AbortController();
    void api(
      `/api/platform/${organizationId}/${tab}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setValue(object(result));
      })
      .catch((problem) => {
        if (!controller.signal.aborted) setError(problem.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [organizationId, tab, revision]);
  const organization = session?.organizations.find(
    (entry) => entry.workspaceId === organizationId,
  );
  const canManage =
    !organization?.isDemo &&
    (!!session?.user.superAdmin ||
      ["CLIENT_ADMIN", "OWNER", "ADMIN"].includes(organization?.role || ""));
  const demoLogin = session?.organizations.some((entry) =>
    ["DEMO_VIEWER", "DEMO_ADMIN"].includes(entry.role),
  );
  const section = sections.find(
    (entry) =>
      entry.views.some((view) => view.id === tab) || entry.extra?.includes(tab),
  )!;
  function navigate(next: string) {
    const address = new URL(window.location.href);
    address.searchParams.set("client", organizationId);
    address.searchParams.set("view", next);
    window.history.replaceState(null, "", address);
    setTab(next);
    setNotice("");
    setDialog(null);
  }
  async function act(resource: string, body: RecordValue) {
    if (organization?.isDemo) {
      setNotice(
        "This is a read-only demo. Sample records stay unchanged and no emails are sent.",
      );
      return {};
    }
    const result = await api(
      `/api/platform/${organizationId}/${resource}`,
      "POST",
      body,
    );
    setNotice(
      typeof result.message === "string"
        ? result.message
        : "Your workspace has been updated.",
    );
    refresh();
    return result;
  }
  function createOrganization() {
    setDialog({
      title: "Bring your business into Monettic",
      detail:
        "Your business gets its own leads, campaigns, email accounts and team.",
      fields: [
        { name: "name", label: "Business name", required: true },
        {
          name: "websiteUrl",
          label: "Company website",
          type: "url",
          placeholder: "https://yourbusiness.com",
        },
      ],
      submitLabel: "Create workspace",
      submit: async (input) => {
        const result = await api("/api/platform/organizations", "POST", input);
        const created = object(result.organization ?? result);
        setOrganizationId(String(created.workspaceId || created.id || ""));
        setTab("outreach");
        refresh();
        setNotice("Your business workspace is ready.");
      },
    });
  }
  return (
    <div className="orbit-app adm-v2 ws-v2 glass">
      <GlassBackdrop />
      <header className="g-top">
        <div className="g-brand-group">
          <GlassBrand href="/" />
          <label className="g-workspace">
            <Building2 size={15} />
            <select
              aria-label="Choose business workspace"
              value={organizationId}
              onChange={(event) => {
                setOrganizationId(event.target.value);
                setTab("outreach");
                setNotice("");
                setDialog(null);
              }}
            >
              {session?.organizations.map((entry) => (
                <option key={entry.workspaceId} value={entry.workspaceId}>
                  {entry.name}
                </option>
              ))}
              {!session?.organizations.length && (
                <option value="">Choose a workspace</option>
              )}
            </select>
            <ChevronDown size={14} />
          </label>
        </div>
        <PillNav
          label="Main navigation"
          active={section.id}
          onSelect={(id) => {
            const entry = sections.find((item) => item.id === id);
            if (entry) navigate(entry.views[0].id);
          }}
          items={sections.map((entry) => ({ id: entry.id, label: entry.label }))}
        />
        <div className="g-actions">
          <button
            className="g-round"
            onClick={refresh}
            aria-label="Refresh workspace"
            title="Refresh"
            disabled={loading}
          >
            <RefreshCw size={17} className={loading ? "spin" : ""} />
          </button>
          <button
            className="g-round"
            aria-label="View notifications"
            title="Notifications"
            onClick={() => navigate("notifications")}
          >
            <Bell size={18} />
          </button>
          <span className="g-avatar" title={session?.user.email || "Your account"}>
            {session?.user.name?.slice(0, 1).toUpperCase() || "O"}
          </span>
        </div>
      </header>
      <div className="g-body">
        <aside className="g-rail" aria-label="Quick actions">
          {sections.map((entry) => (
            <RailButton
              key={entry.id}
              label={entry.label}
              icon={<entry.icon size={18} strokeWidth={1.7} />}
              active={entry.id === section.id}
              onClick={() => navigate(entry.views[0].id)}
            />
          ))}
          <span className="g-rail-divider" aria-hidden="true" />
          {!demoLogin && (
            <RailButton label="New workspace" icon={<Plus size={18} />} onClick={createOrganization} />
          )}
          {session?.user.superAdmin && (
            <RailButton label="Platform administration" icon={<ShieldCheck size={18} />} href="/admin" />
          )}
          <RailButton
            label="Sign out"
            icon={<LogOut size={18} />}
            onClick={() => void signOut({ callbackUrl: "/login" })}
          />
          <ThemeToggle compact />
        </aside>
        <div className="g-main">
        <main className="page-content" id="main-content">
          {organization?.isDemo && (
            <div className="alert ws-demo-note" role="note">
              <span>
                <b>Demo workspace, read-only.</b> The companies and results are
                made up, and nothing here sends email or runs searches.
              </span>
            </div>
          )}
          {organization && section.views.length > 1 && !section.extra?.includes(tab) && (
            <Tabs
              label={`${section.label} sections`}
              value={tab}
              onChange={navigate}
              items={section.views}
            />
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
          {error && (
            <div className="alert error" role="alert">
              <span>{error}</span>
              <button onClick={refresh}>Try again</button>
            </div>
          )}
          {loading ? (
            <Loading />
          ) : !organization ? (
            <div className="welcome-empty">
              <MonetticMark />
              <p className="eyebrow">WELCOME TO MONETTIC</p>
              <h1>Your intelligence workspace.</h1>
              <p>
                Create a business workspace to discover the right prospects and
                build better conversations.
              </p>
              <button className="primary" onClick={createOrganization}>
                Create your workspace
                <Plus size={17} />
              </button>
            </div>
          ) : (
            <ResourceView
              key={`${organizationId}:${tab}`}
              tab={tab}
              data={value}
              organization={organization as Organization}
              canManage={canManage}
              act={act}
              openDialog={setDialog}
              navigate={navigate}
              refresh={refresh}
            />
          )}
        </main>
        </div>
      </div>
      {dialog && <ActionDialog dialog={dialog} close={() => setDialog(null)} />}
    </div>
  );
}
