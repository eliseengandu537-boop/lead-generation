"use client";
import { useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import {
  ArrowUpRight,
  Bell,
  Building2,
  ChevronDown,
  Inbox,
  LogOut,
  Menu,
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
  const [mobile, setMobile] = useState(false);
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
    setMobile(false);
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
    <div className="orbit-app adm-v2 ws-v2">
      {mobile && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
        <Link href="/" className="brand" aria-label="Monettic home">
          <MonetticMark />
          <span>
            MONETTIC<span className="brand-dot">.</span>
          </span>
        </Link>
        <div className="organization-picker">
          <Building2 size={17} />
          <div>
            <span>YOUR WORKSPACE</span>
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
          </div>
          <ChevronDown size={14} />
        </div>
        <nav aria-label="Main navigation">
          {[""].map((group) => (
            <div className="ws-nav-group" key={group || "main"}>
              {group && <p className="nav-label">{group}</p>}
              {sections
                .filter((entry) => entry.group === group)
                .map((entry) => (
                  <button
                    key={entry.id}
                    className={
                      entry.id === section.id ? "nav-link active" : "nav-link"
                    }
                    aria-current={entry.id === section.id ? "page" : undefined}
                    onClick={() => navigate(entry.views[0].id)}
                  >
                    <entry.icon size={18} strokeWidth={1.7} />
                    <span>{entry.label}</span>
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {!demoLogin && (
            <button className="new-workspace" onClick={createOrganization}>
              <Plus size={16} />
              New workspace
            </button>
          )}
          {session?.user.superAdmin && (
            <Link href="/admin" className="nav-link">
              <ShieldCheck size={17} />
              Platform administration
              <ArrowUpRight size={13} />
            </Link>
          )}
          <button
            className="profile-button"
            onClick={() => void signOut({ callbackUrl: "/login" })}
          >
            <span className="avatar">
              {session?.user.name?.slice(0, 1).toUpperCase() || "O"}
            </span>
            <span>
              <b>{session?.user.name || "Your account"}</b>
              <small>{session?.user.email || ""}</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="topbar-breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span>{organization?.name || "Your workspace"}</span>
            <span className="breadcrumb-divider">/</span>
            <b>{section.label}</b>
          </div>
          <div className="topbar-actions">
            <ThemeToggle compact />
            <button
              className="icon-button"
              onClick={refresh}
              aria-label="Refresh workspace"
              disabled={loading}
            >
              <RefreshCw size={17} className={loading ? "spin" : ""} />
            </button>
            <button
              className="icon-button"
              aria-label="View notifications"
              onClick={() => navigate("notifications")}
            >
              <Bell size={18} />
            </button>
            <span className="topbar-avatar">
              {session?.user.name?.slice(0, 1).toUpperCase() || "O"}
            </span>
          </div>
        </header>
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
      {dialog && <ActionDialog dialog={dialog} close={() => setDialog(null)} />}
    </div>
  );
}
