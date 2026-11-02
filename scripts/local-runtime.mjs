import { renderRuntimeEnvironment } from "./render-runtime.mjs";

/** Keep the hosted worker independent of the original local application's .env.
 * @param {Record<string, string>} stored
 * @param {Record<string, string | undefined>} inherited
 */
export function localAutomationEnvironment(stored, inherited = process.env) {
  const input = { ...inherited };
  // Prisma reads the original project's .env when its client initializes.
  // Explicit empty values prevent unrelated local credentials being imported.
  for (const key of [
    "DATABASE_URL",
    "CONTROL_DATABASE_URL",
    "TENANT_DATABASE_URL",
    "NEXTAUTH_URL",
    "NEXTAUTH_SECRET",
    "ENCRYPTION_KEY",
    "PLATFORM_ENCRYPTION_SEED",
    "TENANT_DATABASE_PASSWORD",
    "N8N_BASE_URL",
    "N8N_WEBHOOK_SECRET",
    "N8N_API_KEY",
    "N8N_ENCRYPTION_KEY",
    "BOOTSTRAP_ADMIN_EMAIL",
    "BOOTSTRAP_ADMIN_PASSWORD",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "RESEND_API_KEY",
    "BREVO_API_KEY",
    "IDENTITY_EMAIL_PROVIDER",
    "IDENTITY_SMTP_READY",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "IDENTITY_FROM_EMAIL",
    "EMAIL_VERIFICATION_URL",
    "EMAIL_VERIFICATION_API_KEY",
    "EMAIL_FEEDBACK_SECRET",
  ])
    input[key] = "";
  const env = renderRuntimeEnvironment({
    ...input,
    ...stored,
    NODE_ENV: "production",
    ORBIT_AUTOMATION_LOCATION: "local",
    WORKER_POLL_MS: stored.WORKER_POLL_MS || "60000",
    LIVE_EMAIL_ENABLED: stored.LIVE_EMAIL_ENABLED || "false",
  });
  // The web migration URL stays direct. Only the local worker uses pooling.
  const database = new URL(env.DATABASE_URL);
  if (
    database.hostname.endsWith(".neon.tech") &&
    !database.hostname.split(".")[0].endsWith("-pooler")
  ) {
    const directHostname = database.hostname;
    database.hostname = database.hostname.replace(
      /^([^.]+)(\.)/,
      "$1-pooler$2",
    );
    env.DATABASE_URL = database.toString();
    const tenant = new URL(env.TENANT_DATABASE_URL);
    if (tenant.hostname === directHostname) tenant.hostname = database.hostname;
    env.TENANT_DATABASE_URL = tenant.toString();
  }
  env.CONTROL_DATABASE_URL = stored.CONTROL_DATABASE_URL || env.DATABASE_URL;
  env.BOOTSTRAP_ADMIN_EMAIL = "";
  env.BOOTSTRAP_ADMIN_PASSWORD = "";
  return env;
}
