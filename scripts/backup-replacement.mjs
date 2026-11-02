import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = process.cwd();
const url = new URL(process.env.DATABASE_URL || "");
if (!["127.0.0.1", "localhost"].includes(url.hostname))
  throw new Error(
    "Restore verification requires an explicitly configured local database; no production database is modified.",
  );
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = path.resolve(root, ".local", "replacement-backups", stamp);
fs.mkdirSync(backup, { recursive: true });
const source = path.join(backup, "source");
fs.mkdirSync(source);
for (const name of [
  "src",
  "prisma",
  "scripts",
  "tests",
  "docs",
  "examples",
  "n8n",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next.config.ts",
  "eslint.config.mjs",
  "Dockerfile",
  ".dockerignore",
  ".gitignore",
  ".env.example",
  "docker-compose.yml",
  "docker-compose.production.yml",
  "docker-compose.n8n.yml",
  "README.md",
]) {
  const from = path.join(root, name);
  if (fs.existsSync(from))
    fs.cpSync(from, path.join(source, name), { recursive: true });
}
const bin = "C:/Program Files/PostgreSQL/18/bin";
const env = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || "5432",
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
};
function run(program, args, database = env.PGDATABASE) {
  const result = spawnSync(path.join(bin, `${program}.exe`), args, {
    env: { ...env, PGDATABASE: database },
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(
      `${program} failed: ${String(result.stderr).replaceAll(env.PGPASSWORD, "[redacted]")}`,
    );
  return result.stdout.trim();
}
const dump = path.join(backup, "database.dump");
run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", dump]);
const restored = `replacement_restore_${Date.now()}`;
run("createdb", [restored]);
run(
  "pg_restore",
  ["--no-owner", "--no-acl", "--exit-on-error", "--dbname", restored, dump],
  restored,
);
const tables = run("psql", [
  "--tuples-only",
  "--no-align",
  "--command",
  "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
])
  .split(/\r?\n/)
  .filter(Boolean);
const verified = [];
for (const table of tables) {
  const quoted = `"${table.replaceAll('"', '""')}"`;
  const sql = `SELECT count(*)::text || ':' || md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text)), '')) FROM public.${quoted} t`;
  const original = run("psql", [
    "--tuples-only",
    "--no-align",
    "--command",
    sql,
  ]);
  const recovered = run(
    "psql",
    ["--tuples-only", "--no-align", "--command", sql],
    restored,
  );
  if (original !== recovered)
    throw new Error(
      `Restore verification failed for ${table}; preserve backup and stop changes.`,
    );
  verified.push({
    table,
    rows: Number(original.split(":")[0]),
    fingerprint: original.split(":")[1],
  });
}
const manifest = {
  createdAt: new Date().toISOString(),
  backup,
  databaseDump: "database.dump",
  dumpSha256: createHash("sha256").update(fs.readFileSync(dump)).digest("hex"),
  restoredDatabase: restored,
  verifiedTables: verified,
  credentials:
    "Existing .env is preserved in place and was not copied into the source archive",
  result: "RESTORE_VERIFIED",
};
fs.writeFileSync(
  path.join(backup, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
fs.writeFileSync(
  path.join(root, ".local", "replacement-backup.json"),
  JSON.stringify(
    { backup, restoredDatabase: restored, result: manifest.result },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    backup,
    restoredDatabase: restored,
    tablesVerified: verified.length,
    result: manifest.result,
  }),
);
