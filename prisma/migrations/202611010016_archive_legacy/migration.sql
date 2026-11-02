-- No legacy rows or tables are dropped. The replacement runtime cannot access them.
CREATE OR REPLACE FUNCTION public.crm_install_tenant_rls() RETURNS void
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
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO crm_control', tenant_table.relname);
    IF tenant_table.relname LIKE 'Platform%' OR tenant_table.relname IN ('Workspace','Membership') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO crm_tenant', tenant_table.relname);
    ELSE
      EXECUTE format('REVOKE ALL ON public.%I FROM crm_tenant', tenant_table.relname);
    END IF;
  END LOOP;
END;
$$;

SELECT public.crm_install_tenant_rls();
REVOKE ALL ON public."SubscriptionPlan" FROM crm_tenant;
GRANT SELECT ON public."PlatformPlan" TO crm_tenant;
GRANT SELECT,INSERT,UPDATE,DELETE ON public."PlatformPlan" TO crm_control;
