import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { HttpError } from "./auth";
import { withDatabaseRequest } from "./tenancy";
export async function handle(fn: () => Promise<unknown>) {
  try {
    return NextResponse.json(await withDatabaseRequest(fn));
  } catch (error) {
    if (error instanceof HttpError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    if (error instanceof ZodError)
      return NextResponse.json(
        {
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
        { status: 400 },
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return NextResponse.json(
        { error: "This record already exists" },
        { status: 409 },
      );
    console.error(error instanceof Error ? error.message : "Request failed");
    return NextResponse.json(
      {
        error:
          "Unable to complete request. Check database and server configuration.",
      },
      { status: 500 },
    );
  }
}
export async function json(request: Request) {
  const text = await request.text();
  if (text.length > 1_000_000) throw new HttpError(413, "Request too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}
