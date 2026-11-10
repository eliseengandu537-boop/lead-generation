import { NextResponse } from "next/server";
import { db, assertTenantDatabase } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    await assertTenantDatabase();
    return NextResponse.json({ status: "ok", product: "Monettic" });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
