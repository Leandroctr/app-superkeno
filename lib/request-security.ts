import { createHmac } from "node:crypto";
import { isIP } from "node:net";

const ONE_SIGNAL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeIpv6Prefix(address: string) {
  const embeddedIpv4 = address.slice(address.lastIndexOf(":") + 1);

  if (isIP(embeddedIpv4) === 4) {
    return embeddedIpv4;
  }

  const halves = address.toLowerCase().split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const omittedCount = 8 - left.length - right.length;
  const groups = [
    ...left,
    ...Array.from({ length: Math.max(0, omittedCount) }, () => "0"),
    ...right,
  ].map((group) => Number.parseInt(group || "0", 16));

  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16).padStart(4, "0"))
    .join(":")}::/64`;
}

export function extractClientIp(headers: Pick<Headers, "get">) {
  const candidates = [
    headers.get("x-vercel-forwarded-for"),
    headers.get("x-forwarded-for"),
    headers.get("x-real-ip"),
  ];

  for (const candidate of candidates) {
    const firstAddress = candidate?.split(",", 1)[0]?.trim().split("%", 1)[0];
    const ipVersion = firstAddress ? isIP(firstAddress) : 0;

    if (firstAddress && ipVersion === 4) {
      return firstAddress;
    }

    if (firstAddress && ipVersion === 6) {
      return normalizeIpv6Prefix(firstAddress);
    }
  }

  return "unknown";
}

export function normalizeAccountIdentifier(value: string) {
  return value.trim().toLowerCase().slice(0, 320) || "unknown";
}

export function hashRateLimitKey(
  scope: string,
  identifier: string,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update(scope)
    .update("\0")
    .update(identifier)
    .digest("hex");
}

export function normalizeOneSignalId(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return ONE_SIGNAL_ID_PATTERN.test(normalized) ? normalized : null;
}
