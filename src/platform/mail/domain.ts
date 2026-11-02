import { domainToASCII } from "node:url";
function normalizeDomain(value: string) {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (
      url.username ||
      url.password ||
      url.port ||
      !["https:", "http:"].includes(url.protocol)
    )
      return null;
    return (
      domainToASCII(
        url.hostname
          .toLowerCase()
          .replace(/^www\./, "")
          .replace(/\.$/, ""),
      ) || null
    );
  } catch {
    return null;
  }
}
export function senderMatchesWebsite(email: string, websiteDomains: string[]) {
  const pieces = email.toLowerCase().split("@");
  if (pieces.length !== 2) return false;
  const sender = normalizeDomain(pieces[1]);
  return (
    !!sender &&
    websiteDomains.some((domain) => normalizeDomain(domain) === sender)
  );
}
