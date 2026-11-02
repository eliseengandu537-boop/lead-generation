import { z } from "zod";

export type GmailPart = {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
};
export const gmailPartSchema: z.ZodType<GmailPart> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    headers: z
      .array(z.object({ name: z.string(), value: z.string() }))
      .optional(),
    body: z
      .object({
        data: z.string().optional(),
        attachmentId: z.string().optional(),
        size: z.number().optional(),
      })
      .optional(),
    parts: z.array(gmailPartSchema).optional(),
  }),
);
export const gmailMessageSchema = z.object({
  id: z.string(),
  threadId: z.string().optional(),
  internalDate: z.string(),
  labelIds: z.array(z.string()).optional(),
  payload: gmailPartSchema.optional(),
});
export type GmailMessage = z.infer<typeof gmailMessageSchema>;

export function gmailHeader(part: GmailPart, name: string) {
  return (
    part.headers?.find(
      (header) => header.name.toLowerCase() === name.toLowerCase(),
    )?.value || ""
  );
}
export function gmailText(part: GmailPart): string {
  const own =
    part.mimeType === "text/plain" && part.body?.data
      ? Buffer.from(part.body.data, "base64url").toString("utf8")
      : "";
  return [own, ...(part.parts || []).map(gmailText)].join("\n").slice(0, 20000);
}
export function senderAddress(header: string) {
  const matches = header.match(
    /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  );
  return matches?.length === 1 ? matches[0].toLowerCase() : null;
}
function leaves(part: GmailPart): GmailPart[] {
  return [part, ...(part.parts || []).flatMap(leaves)];
}
function fields(value: string) {
  const output = new Map<string, string>();
  for (const line of value
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]+/g, " ")
    .split("\n")) {
    const match = /^([a-z0-9-]+):\s*(.*)$/i.exec(line);
    if (match) output.set(match[1].toLowerCase(), match[2]);
  }
  return output;
}
const messageIds = (value: string) => value.match(/<[^<>\s]+@[^<>\s]+>/g) || [];

// RFC 3464: permanent failures require both Action: failed and Status: 5.x.x.
// A scary subject or human-readable body is deliberately insufficient evidence.
export function parseGmailDeliveryStatus(part: GmailPart) {
  const all = leaves(part);
  const statusParts = all.filter((item) =>
    ["message/delivery-status", "message/global-delivery-status"].includes(
      item.mimeType?.toLowerCase() || "",
    ),
  );
  if (!statusParts.length) return null;
  const originalIds = new Set<string>();
  for (const item of all) {
    const mime = item.mimeType?.toLowerCase();
    if (
      ["message/rfc822", "message/global", "text/rfc822-headers"].includes(
        mime || "",
      )
    ) {
      for (const id of messageIds(gmailHeader(item, "Message-ID")))
        originalIds.add(id);
      if (item.body?.data) {
        const headers = Buffer.from(item.body.data, "base64url")
          .toString("utf8")
          .slice(0, 100000)
          .split(/\r?\n\r?\n/, 1)[0];
        for (const id of messageIds(fields(headers).get("message-id") || ""))
          originalIds.add(id);
      }
      for (const child of item.parts || []) {
        for (const id of messageIds(gmailHeader(child, "Message-ID")))
          originalIds.add(id);
      }
    }
  }
  for (const id of messageIds(gmailHeader(part, "In-Reply-To")))
    originalIds.add(id);
  const recipients: {
    email: string;
    type: "BOUNCE" | "SOFT_BOUNCE";
    status: string;
    diagnostic: string;
  }[] = [];
  for (const statusPart of statusParts) {
    const data = Buffer.from(statusPart.body?.data || "", "base64url")
      .toString("utf8")
      .slice(0, 100000);
    for (const block of data.split(/\r?\n\r?\n/)) {
      const item = fields(block);
      const email = senderAddress(
        (item.get("final-recipient") || "").replace(/^[^;]+;/, ""),
      );
      const action = item.get("action")?.trim().toLowerCase();
      const status = item
        .get("status")
        ?.trim()
        .match(/^[245]\.\d{1,3}\.\d{1,3}(?=\s|$)/)?.[0];
      if (!email || !status) continue;
      const type =
        action === "failed" && status.startsWith("5.")
          ? "BOUNCE"
          : action === "delayed" && status.startsWith("4.")
            ? "SOFT_BOUNCE"
            : null;
      if (type)
        recipients.push({
          email,
          type,
          status,
          diagnostic: (item.get("diagnostic-code") || "").slice(0, 1000),
        });
    }
  }
  return { originalMessageIds: [...originalIds], recipients };
}

// Gmail can put MIME parts into separately retrievable attachments. Retrieve only
// DSN/original-header parts, with limits, and never download arbitrary attachments.
export async function hydrateGmailFeedbackParts(
  part: GmailPart,
  load: (id: string) => Promise<string>,
) {
  const relevant = new Set([
    "message/delivery-status",
    "message/global-delivery-status",
    "message/rfc822",
    "message/global",
    "text/rfc822-headers",
  ]);
  let loaded = 0;
  for (const item of leaves(part)) {
    if (
      !relevant.has(item.mimeType?.toLowerCase() || "") ||
      !item.body?.attachmentId ||
      item.body.data
    )
      continue;
    if ((item.body.size || 0) > 100000 || ++loaded > 8)
      throw new Error(
        "Gmail delivery notification exceeds safe parsing limits",
      );
    item.body.data = await load(item.body.attachmentId);
    if (item.body.data.length > 140000)
      throw new Error(
        "Gmail delivery notification exceeds safe parsing limits",
      );
  }
}
