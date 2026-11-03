import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const secret = () => randomBytes(32).toString("hex");
function encryptionKey() {
  const key = process.env.ENCRYPTION_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw new Error("ENCRYPTION_KEY must be 32 bytes in hex");
  return Buffer.from(key, "hex");
}
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((b) => b.toString("hex"))
    .join(".");
}
export function decrypt(value: string) {
  const [iv, tag, data] = value.split(".").map((s) => Buffer.from(s, "hex"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}
export function sign(value: string, key: string) {
  return createHmac("sha256", key).update(value).digest("hex");
}
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function canManage(role: string) {
  return role === "AGENCY_ADMIN";
}
export function eligible(
  contact: {
    eligibility: string;
    consentSource: string | null;
    consentAt: Date | null;
    repliedAt: Date | null;
  },
  suppressed: boolean,
) {
  return (
    !suppressed &&
    !contact.repliedAt &&
    contact.eligibility === "CONSENTED" &&
    !!contact.consentSource &&
    !!contact.consentAt &&
    contact.consentAt <= new Date()
  );
}
export function personalize(
  template: string,
  contact: { name: string; company: string; email: string },
) {
  return template.replace(
    /\{\{\s*(name|company|email)\s*\}\}/g,
    (_, key: "name" | "company" | "email") => contact[key],
  );
}
