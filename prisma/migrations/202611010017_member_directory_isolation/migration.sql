-- Directory reads reveal only people who belong to the authorized organization.
-- Password and account-token columns remain inaccessible to the tenant login.
ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."User" FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_tenant_isolation ON public."User" TO crm_tenant
  USING (EXISTS (
    SELECT 1 FROM public."Membership" m
    WHERE m."userId" = "User".id
      AND m."workspaceId" = (SELECT public.crm_current_workspace())
  ));
DO $$ BEGIN
  EXECUTE format('CREATE POLICY crm_control_access ON public."User" TO crm_control, %I USING (true) WITH CHECK (true)', current_user);
END $$;
