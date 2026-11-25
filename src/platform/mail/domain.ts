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
/** A sender is allowed when it matches the client's website, a sending domain an administrator
 * added for them (professional outreach uses separate domains to protect the main one), or one
 * exact inbox an administrator approved, such as the client's own Gmail address. Approving
 * dcbspares@gmail.com never approves the rest of gmail.com. */
export function senderAllowed(
  email: string,
  organization: { websiteUrl: string; sendingDomains: string[] },
) {
  const address = email.trim().toLowerCase();
  return (
    organization.sendingDomains.some(
      (entry) => entry.includes("@") && entry.trim().toLowerCase() === address,
    ) ||
    senderMatchesWebsite(email, [
      organization.websiteUrl,
      ...organization.sendingDomains.filter((entry) => !entry.includes("@")),
    ])
  );
}
/** One exact inbox address an administrator can approve for a client, or null when invalid. */
export function sendingAddress(value: string) {
  const address = value.trim().toLowerCase();
  return address.length <= 254 &&
    /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(address)
    ? address
    : null;
}
const freeMail = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "ymail.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
  "gmx.com", "mail.com", "zoho.com", "yandex.com", "webmail.co.za", "mweb.co.za",
  "telkomsa.net", "vodamail.co.za", "absamail.co.za", "lantic.net", "iafrica.com",
]);
/** A business domain an administrator can add for sending, or null when it is not one. */
export function sendingDomain(value: string) {
  const domain = normalizeDomain(value.trim());
  if (!domain || !/^(?=.{4,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(domain)) return null;
  return freeMail.has(domain) ? null : domain;
}
