export type RecordValue = Record<string, unknown>;
export type Organization = {
  workspaceId: string;
  name: string;
  role: string;
  timezone?: string;
  status?: string;
};
export type SessionView = {
  user: { id: string; name: string; email: string; superAdmin: boolean };
  organizations: Organization[];
};
export function object(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}
export function rows(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.map(object) : [];
}
export function text(value: unknown, fallback = "—"): string {
  return value === undefined || value === null || value === ""
    ? fallback
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
}
export function number(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}
export function date(value: unknown, includeTime = false): string {
  if (!value) return "—";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleString(
        "en-ZA",
        includeTime
          ? {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            }
          : { day: "numeric", month: "short", year: "numeric" },
      );
}
export function label(value: unknown): string {
  return text(value, "Unspecified")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
export async function api<T = RecordValue>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method,
    signal,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error || "We couldn't complete this request. Please try again.",
    );
  return result as T;
}
