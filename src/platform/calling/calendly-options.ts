export function normalizedCalendlyPage(input: string): string | null {
  const value = input.trim();
  if (value.length > 500) return null;
  if (!value) return "";
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "calendly.com" ||
      url.username ||
      url.password ||
      url.port ||
      !/^\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)
    )
      throw new Error("Invalid scheduling page");
    // Store the event page only; callers never inherit query data or tracking IDs.
    return url.origin + url.pathname.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function calendlyBookingUrl(
  page: string,
  contact: { name?: string; email?: string },
  embedDomain?: string,
) {
  const normalized = normalizedCalendlyPage(page);
  if (!normalized)
    throw new Error(
      "The Calendly booking link needs to be configured by your administrator.",
    );
  const url = new URL(normalized);
  if (contact.name) url.searchParams.set("name", contact.name);
  if (contact.email) url.searchParams.set("email", contact.email);
  url.searchParams.set("timezone", "Africa/Johannesburg");
  url.searchParams.set("utm_source", "monettic");
  url.searchParams.set("utm_medium", "caller");
  if (embedDomain) {
    url.searchParams.set("embed_domain", embedDomain);
    url.searchParams.set("embed_type", "Inline");
  }
  return url.toString();
}

export function calendlyScheduledMessage(origin: string, payload: unknown) {
  if (
    origin !== "https://calendly.com" ||
    !payload ||
    typeof payload !== "object"
  )
    return false;
  const message = payload as {
    event?: unknown;
    payload?: { event?: { uri?: unknown }; invitee?: { uri?: unknown } };
  };
  return (
    message.event === "calendly.event_scheduled" &&
    /^https:\/\/api\.calendly\.com\/scheduled_events\/[a-zA-Z0-9-]+$/.test(
      String(message.payload?.event?.uri || ""),
    ) &&
    /^https:\/\/api\.calendly\.com\/scheduled_events\/[a-zA-Z0-9-]+\/invitees\/[a-zA-Z0-9-]+$/.test(
      String(message.payload?.invitee?.uri || ""),
    )
  );
}
