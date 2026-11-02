"use client";
import { useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import {
  ArrowUpRight,
  Bell,
  Building2,
  ChartNoAxesCombined,
  ChevronDown,
  CircleHelp,
  CreditCard,
  FileText,
  Globe2,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Radar,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Users,
  Workflow,
  X,
} from "lucide-react";
import {
  api,
  object,
  type Organization,
  type RecordValue,
  type SessionView,
} from "./data";
import { ActionDialog, type Dialog, Loading, ConcreteMark } from "./primitives";
import { ResourceView } from "./views";
import { ThemeToggle } from "./theme";

const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "discovery", label: "AI Lead Finder", icon: Radar },
  { id: "leads", label: "My Leads", icon: Users },
  { id: "campaigns", label: "Campaigns", icon: Send },
  { id: "inbox", label: "Email Inbox", icon: Inbox },
  { id: "templates", label: "Email Templates", icon: FileText },
  { id: "reports", label: "Analytics", icon: ChartNoAxesCombined },
  { id: "business", label: "My Website", icon: Globe2 },
  { id: "mailboxes", label: "Email Connections", icon: Building2 },
  { id: "automation", label: "Automation", icon: Workflow },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "team", label: "Team", icon: Users },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "settings", label: "Settings", icon: Settings2 },
];
const groups = ["INTELLIGENCE", "WORKSPACE"];

export default function ConcreteApp() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [tab, setTab] = useState("overview");
  const [value, setValue] = useState<RecordValue>({});
  const [loading, setLoading] = useState(true);
  const [mobile, setMobile] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((current) => current + 1), []);
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
    !!session?.user.superAdmin ||
    ["CLIENT_ADMIN", "OWNER", "ADMIN"].includes(organization?.role || "");
  const active = navigation.find((entry) => entry.id === tab)!;
  function navigate(next: string) {
    setTab(next);
    setMobile(false);
    setNotice("");
    setDialog(null);
  }
  async function act(resource: string, body: RecordValue) {
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
      title: "Bring your business into Concrete",
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
        setTab("overview");
        refresh();
        setNotice("Your business workspace is ready.");
      },
    });
  }
  return (
    <div className="orbit-app">
      {mobile && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
        <Link href="/" className="brand" aria-label="Concrete home">
          <ConcreteMark />
          <span>
            CONCRETE<span className="brand-dot">.</span>
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
                setTab("overview");
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
          {navigation.map((entry, index) => (
            <div key={entry.id}>
              {(index === 0 || index === 7) && (
                <p className="nav-label">{groups[index === 0 ? 0 : 1]}</p>
              )}
              <button
                className={entry.id === tab ? "nav-link active" : "nav-link"}
                onClick={() => navigate(entry.id)}
              >
                <entry.icon size={18} strokeWidth={1.7} />
                <span>{entry.label}</span>
                {entry.id === tab && <span className="nav-indicator" />}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="new-workspace" onClick={createOrganization}>
            <Plus size={16} />
            New workspace
          </button>
          {session?.user.superAdmin && (
            <Link href="/admin" className="nav-link">
              <ShieldCheck size={17} />
              Platform administration
              <ArrowUpRight size={13} />
            </Link>
          )}
          <div className="sidebar-help">
            <CircleHelp size={17} />
            <div>
              <b>Built for your business.</b>
              <p>Your data. Your email. Your voice.</p>
            </div>
          </div>
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
            <b>{active.label}</b>
          </div>
          <div className="topbar-actions">
            <ThemeToggle />
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
              <ConcreteMark />
              <p className="eyebrow">WELCOME TO CONCRETE</p>
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
        <footer className="workspace-footer">
          <span>
            <ConcreteMark small />
            CONCRETE
          </span>
          <p>Business intelligence. Deliberate outreach.</p>
          <span>Private to your organization</span>
        </footer>
      </div>
      {dialog && <ActionDialog dialog={dialog} close={() => setDialog(null)} />}
    </div>
  );
}
