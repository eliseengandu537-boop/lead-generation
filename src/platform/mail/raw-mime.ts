import type { GmailPart } from "./mime";

/**
 * Turns a raw RFC 5322 message (as read over IMAP) into the same part tree the Gmail API returns,
 * so replies and delivery reports are read by the same code for every kind of inbox.
 * Bodies are decoded (base64, quoted-printable) and text is converted to UTF-8.
 */
const MAX_DEPTH = 8;
const MAX_PARTS = 64;

function splitHead(raw: string) {
  const match = /\r?\n\r?\n/.exec(raw);
  return match
    ? [raw.slice(0, match.index), raw.slice(match.index + match[0].length)]
    : [raw, ""];
}

/** RFC 2047 encoded words, such as =?UTF-8?B?...?= in a subject or sender name. */
export function decodeWords(value: string) {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (whole, charset: string, kind: string, text: string) => {
      try {
        const bytes =
          kind.toUpperCase() === "B"
            ? Buffer.from(text, "base64")
            : quotedPrintable(text.replace(/_/g, " "));
        return transcode(bytes, charset);
      } catch {
        return whole;
      }
    });
}

function headers(head: string) {
  return head
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]+/g, " ")
    .split("\n")
    .map((line) => /^([^:\s]+):\s*(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => !!match)
    .map((match) => ({ name: match[1], value: decodeWords(match[2].trim()) }));
}
function header(list: { name: string; value: string }[], name: string) {
  return list.find((item) => item.name.toLowerCase() === name)?.value ?? "";
}
function parameter(value: string, name: string) {
  const match = new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]*))`, "i").exec(value);
  return match ? (match[1] ?? match[2] ?? "") : "";
}
function quotedPrintable(text: string) {
  const bytes: number[] = [];
  const clean = text.replace(/=\r?\n/g, "");
  for (let index = 0; index < clean.length; index++) {
    const char = clean[index];
    if (char === "=" && /^[0-9A-Fa-f]{2}$/.test(clean.slice(index + 1, index + 3))) {
      bytes.push(parseInt(clean.slice(index + 1, index + 3), 16));
      index += 2;
    } else bytes.push(clean.charCodeAt(index) & 0xff);
  }
  return Buffer.from(bytes);
}
function transcode(bytes: Buffer, charset: string) {
  const label = (charset || "utf-8").trim().toLowerCase();
  try {
    return new TextDecoder(label === "us-ascii" ? "utf-8" : label).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

function parsePart(raw: string, depth: number, budget: { parts: number }): GmailPart {
  const [head, body] = splitHead(raw);
  const list = headers(head);
  const contentType = header(list, "content-type") || "text/plain";
  const mimeType = contentType.split(";")[0].trim().toLowerCase() || "text/plain";
  const part: GmailPart = { mimeType, headers: list };
  if (mimeType.startsWith("multipart/") && depth < MAX_DEPTH) {
    const boundary = parameter(contentType, "boundary");
    if (boundary) {
      const children: GmailPart[] = [];
      for (const section of body.split(`--${boundary}`).slice(1)) {
        if (section.startsWith("--") || ++budget.parts > MAX_PARTS) break;
        children.push(parsePart(section.replace(/^\r?\n/, "").replace(/\r?\n$/, ""), depth + 1, budget));
      }
      part.parts = children;
      return part;
    }
  }
  // Bodies were read as latin1, so each character is one original byte.
  const encoding = header(list, "content-transfer-encoding").toLowerCase();
  let bytes =
    encoding === "base64"
      ? Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64")
      : encoding === "quoted-printable"
        ? quotedPrintable(body)
        : Buffer.from(body, "latin1");
  if (mimeType.startsWith("text/"))
    bytes = Buffer.from(transcode(bytes, parameter(contentType, "charset")), "utf8");
  part.body = { data: bytes.toString("base64url"), size: bytes.length };
  return part;
}

/** The message as a part tree; header values are decoded, bodies are base64url like the Gmail API. */
export function parseRawMessage(raw: Buffer | string): GmailPart {
  const text = typeof raw === "string" ? raw : raw.toString("latin1");
  return parsePart(text.slice(0, 3_000_000), 0, { parts: 0 });
}

function leaves(part: GmailPart): GmailPart[] {
  return [part, ...(part.parts || []).flatMap(leaves)];
}
/** The readable text of a message: its plain-text parts, or its HTML with the tags removed. */
export function rawText(part: GmailPart) {
  const decode = (item: GmailPart) =>
    item.body?.data ? Buffer.from(item.body.data, "base64url").toString("utf8") : "";
  const all = leaves(part);
  const plain = all.filter((item) => item.mimeType === "text/plain").map(decode).join("\n").trim();
  if (plain) return plain.slice(0, 20000);
  return all
    .filter((item) => item.mimeType === "text/html")
    .map(decode)
    .join("\n")
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim()
    .slice(0, 20000);
}
