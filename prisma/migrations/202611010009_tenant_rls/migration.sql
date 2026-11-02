-- Additive migration; initial setup requires a migration login with CREATEROLE.
-- These are NOLOGIN groups. Provision a distinct tenant login as documented.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_tenant') THEN
    CREATE ROLE crm_tenant NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_control') THEN
    CREATE ROLE crm_control NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO crm_tenant, crm_control;

-- Only the control connection can mint opaque, short-lived capabilities.
-- Keeping tenantId (not workspaceId) deliberately excludes this internal
-- authorization table from the tenant-data grants in the installer below.
CREATE TABLE public."TenantDatabaseCapability" (
  "tokenHash" text PRIMARY KEY,
  "tenantId" text NOT NULL REFERENCES public."Workspace"(id) ON DELETE CASCADE,
  "expiresAt" timestamptz NOT NULL
);
CREATE INDEX "TenantDatabaseCapability_expiry" ON public."TenantDatabaseCapability" ("expiresAt");
REVOKE ALL ON public."TenantDatabaseCapability" FROM PUBLIC, crm_tenant;
GRANT SELECT, INSERT, DELETE ON public."TenantDatabaseCapability" TO crm_control;

-- A caller can change a PostgreSQL GUC, but cannot invent a valid capability
-- for another workspace or read this function's underlying secret table.
CREATE FUNCTION public.crm_current_workspace() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT "tenantId" FROM public."TenantDatabaseCapability"
  WHERE "tokenHash" = encode(sha256(convert_to(nullif(current_setting('app.tenant_token', true), ''), 'UTF8')), 'hex')
    AND "expiresAt" > now()
$$;
REVOKE ALL ON FUNCTION public.crm_current_workspace() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_current_workspace() TO crm_tenant;

-- SECURITY INVOKER: runtime cannot use this function to change policies.
-- Call it after every migration adding a workspace-owned table.
CREATE FUNCTION public.crm_install_tenant_rls() RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  tenant_table record;
  tenant_column text;
BEGIN
  FOR tenant_table IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND (c.relname = 'Workspace' OR EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attname = 'workspaceId' AND NOT a.attisdropped
      ))
  LOOP
    tenant_column := CASE WHEN tenant_table.relname = 'Workspace' THEN 'id' ELSE 'workspaceId' END;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tenant_table.relname);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tenant_table.relname);
    EXECUTE format('DROP POLICY IF EXISTS crm_tenant_isolation ON public.%I', tenant_table.relname);
    EXECUTE format(
      'CREATE POLICY crm_tenant_isolation ON public.%I TO crm_tenant USING (%I = (SELECT public.crm_current_workspace())) WITH CHECK (%I = (SELECT public.crm_current_workspace()))',
      tenant_table.relname, tenant_column, tenant_column
    );
    EXECUTE format('DROP POLICY IF EXISTS crm_control_access ON public.%I', tenant_table.relname);
    EXECUTE format(
      'CREATE POLICY crm_control_access ON public.%I TO crm_control, %I USING (true) WITH CHECK (true)',
      tenant_table.relname, current_user
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO crm_tenant, crm_control', tenant_table.relname);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_install_tenant_rls() FROM PUBLIC;
SELECT public.crm_install_tenant_rls();

-- Credential/token/outbox tables stay inaccessible to the tenant login.
-- Managers may look up existing members' public directory fields only.
GRANT SELECT (id, name, email) ON public."User" TO crm_tenant;
GRANT SELECT ON public."SubscriptionPlan" TO crm_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."User", public."IdentityToken", public."IdentityEmail", public."RateBucket", public."SubscriptionPlan" TO crm_control;
