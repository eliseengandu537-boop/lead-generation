import type { PlatformLead } from "@prisma/client";

export function unfilledEmailFields(...content: string[]) {
  return [...new Set(content.flatMap((value) =>
    [...value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1].trim()),
  ))];
}

export function personalizeFollowup(
  template: string,
  lead: Pick<PlatformLead, "name" | "company" | "email" | "industry">,
) {
  return template.replace(
    /\{\{\s*(name|company|email|industry)\s*\}\}/g,
    (_, field: "name" | "company" | "email" | "industry") => lead[field] || "",
  );
}
