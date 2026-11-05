import type { NextConfig } from "next";
import path from "node:path";
const config: NextConfig = {
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  outputFileTracingRoot: path.resolve("."),
  poweredByHeader: false,
  serverExternalPackages: [
    "@prisma/client",
    "bcryptjs",
    "@duckdb/node-api",
    "@duckdb/node-bindings",
  ],
};
export default config;
