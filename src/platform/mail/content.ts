import type { PlatformLead } from "@prisma/client";

export function personalizeFollowup(
  template: string,
  lead: Pick<PlatformLead, "name" | "company" | "email" | "industry">,
) {
  return template.replace(
    /\{\{\s*(name|company|email|industry)\s*\}\}/g,
    (_, field: "name" | "company" | "email" | "industry") => lead[field] || "",
  );
}
