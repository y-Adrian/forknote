/**
 * DNS-aware policy for user-configured API upstreams.
 *
 * Public HTTP(S) endpoints are allowed. Local model servers are allowed when
 * the URL explicitly names localhost, a loopback IP, or a private LAN IP
 * literal (RFC1918 / IPv6 ULA) for home-lab hosts. Hostnames that resolve to
 * private, special, metadata, or DNS-rebound addresses are never handed to the
 * HTTP client — except VPN/proxy fake-IP answers in 198.18.0.0/15, which map
 * public API hostnames and must stay reachable (same carve-out as sidecar
 * /net/*).
 */
const dns = require("node:dns/promises");
const net = require("node:net");
const { URL } = require("node:url");

const BLOCKED_V4 = new net.BlockList();
[
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  // Note: do NOT block 198.18.0.0/15. VPN/proxy fake-IP modes (Clash, Surge, …)
  // map public API hostnames there; treating them as special-use breaks the
  // desktop /openai proxy while sidecar /net/* already allows the same range.
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
].forEach(([network, prefix]) => BLOCKED_V4.addSubnet(network, prefix, "ipv4"));

const BLOCKED_V6 = new net.BlockList();
[
  ["::", 128],
  ["::ffff:0:0", 96],
  ["100::", 64],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
].forEach(([network, prefix]) => BLOCKED_V6.addSubnet(network, prefix, "ipv6"));

/** Home-lab model servers: RFC1918 (+ IPv6 ULA). Not link-local / metadata. */
const PRIVATE_LAN_V4 = new net.BlockList();
[
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
].forEach(([network, prefix]) => PRIVATE_LAN_V4.addSubnet(network, prefix, "ipv4"));

const PRIVATE_LAN_V6 = new net.BlockList();
PRIVATE_LAN_V6.addSubnet("fc00::", 7, "ipv6");

const METADATA_HOSTS = new Set([
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "instance-data.ec2.internal",
]);

function withoutIpv6Brackets(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function isLoopbackIp(address) {
  const ip = withoutIpv6Brackets(String(address || "").toLowerCase());
  if (net.isIP(ip) === 4) return ip.startsWith("127.");
  if (net.isIP(ip) === 6) return ip === "::1" || ip === "0:0:0:0:0:0:0:1";
  return false;
}

/**
 * True for RFC1918 / IPv6 ULA addresses only. IPv4-mapped forms are rejected so
 * callers must use a canonical dotted IPv4 or real ULA literal.
 */
function isPrivateLanIp(address) {
  const ip = withoutIpv6Brackets(String(address || "").toLowerCase());
  const family = net.isIP(ip);
  if (family === 4) return PRIVATE_LAN_V4.check(ip, "ipv4");
  if (family === 6) {
    if (/^::ffff:/i.test(ip)) return false;
    return PRIVATE_LAN_V6.check(ip, "ipv6");
  }
  return false;
}

function isBlockedIp(address) {
  const ip = withoutIpv6Brackets(String(address || "").toLowerCase());
  const family = net.isIP(ip);
  if (family === 4) return BLOCKED_V4.check(ip, "ipv4");
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return isLoopbackIp(mapped[1]) || isBlockedIp(mapped[1]);
    return BLOCKED_V6.check(ip, "ipv6");
  }
  return true;
}

function policyError(message) {
  return Object.assign(new Error(message), {
    code: "ERR_UNSAFE_API_TARGET",
    status: 403,
  });
}

function rawAuthorityHostname(rawUrl) {
  const schemeEnd = rawUrl.indexOf("://");
  if (schemeEnd < 0) return "";
  const authority = rawUrl.slice(schemeEnd + 3).split(/[/?#]/, 1)[0];
  if (!authority || authority.includes("@") || authority.includes("\\")) return "";
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    return end >= 0 ? authority.slice(0, end + 1) : "";
  }
  return authority.split(":", 1)[0];
}

function parseApiTarget(rawUrl) {
  const raw = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!raw) throw policyError("API target is missing");
  if (raw.includes("\\")) {
    throw policyError("Backslashes are not allowed in API targets");
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw policyError("API target is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw policyError("Only HTTP(S) API targets are allowed");
  }
  if (parsed.username || parsed.password) {
    throw policyError("Credentials are not allowed in API target URLs");
  }
  if (parsed.search || parsed.hash) {
    throw policyError("API target URLs cannot contain a query or fragment");
  }

  const rawHost = rawAuthorityHostname(raw);
  const host = withoutIpv6Brackets(parsed.hostname).toLowerCase();
  if (!rawHost || !host || /[%\s]/.test(rawHost) || /[^\x21-\x7e]/.test(rawHost)) {
    throw policyError("API target has an invalid host");
  }
  if (rawHost.startsWith(".") || rawHost.endsWith(".") || rawHost.includes("..")) {
    throw policyError("API target has a deceptive host form");
  }

  // WHATWG URL accepts legacy decimal/octal/hex IPv4 forms. Require the text
  // supplied by the user to be the canonical dotted form before allowing it.
  if (net.isIP(host) === 4 && rawHost.toLowerCase() !== host) {
    throw policyError("Non-canonical IP address forms are not allowed");
  }

  const explicitLoopback =
    rawHost.toLowerCase() === "localhost" || isLoopbackIp(host);
  // Only canonical IP literals — never hostnames that happen to resolve private.
  const explicitPrivateLan = !explicitLoopback && isPrivateLanIp(host);
  if (
    METADATA_HOSTS.has(host) ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    (host !== "localhost" && !net.isIP(host) && !host.includes("."))
  ) {
    throw policyError("Metadata, local, and single-label API hosts are blocked");
  }

  return { parsed, host, explicitLoopback, explicitPrivateLan };
}

function normalizeRecords(records) {
  return records
    .map((record) => {
      const address = String(record?.address || "");
      const family = Number(record?.family) || net.isIP(address);
      return { address, family };
    })
    .filter((record) => (record.family === 4 || record.family === 6) && net.isIP(record.address));
}

function createPinnedLookup(records) {
  const approved = normalizeRecords(records);
  return (_hostname, options, callback) => {
    const opts = typeof options === "object" && options ? options : {};
    const requestedFamily = Number(opts.family) || 0;
    const matches = requestedFamily
      ? approved.filter((record) => record.family === requestedFamily)
      : approved;
    if (!matches.length) {
      const err = Object.assign(new Error("No approved address for requested family"), {
        code: "ENOTFOUND",
      });
      callback(err);
      return;
    }
    if (opts.all) {
      callback(null, matches.map(({ address, family }) => ({ address, family })));
      return;
    }
    callback(null, matches[0].address, matches[0].family);
  };
}

/**
 * Validate and resolve an API root. The returned lookup function pins the
 * actual socket connection to the approved DNS answers.
 *
 * @param {string} rawUrl
 * @param {{ lookup?: typeof dns.lookup }} [options]
 */
async function assertSafeApiTarget(rawUrl, options = {}) {
  const { parsed, host, explicitLoopback, explicitPrivateLan } =
    parseApiTarget(rawUrl);
  let records;

  if (net.isIP(host)) {
    records = [{ address: host, family: net.isIP(host) }];
  } else {
    try {
      records = await (options.lookup || dns.lookup)(host, {
        all: true,
        verbatim: true,
      });
    } catch {
      throw policyError(`Could not resolve API host: ${host}`);
    }
  }

  const resolved = normalizeRecords(Array.isArray(records) ? records : [records]);
  const approved = resolved.filter((record) => {
    if (explicitLoopback) return isLoopbackIp(record.address);
    if (explicitPrivateLan) return isPrivateLanIp(record.address);
    return !isLoopbackIp(record.address) && !isBlockedIp(record.address);
  });
  if (!resolved.length || !approved.length) {
    throw policyError(
      explicitLoopback
        ? "Local API target did not resolve to loopback"
        : explicitPrivateLan
          ? "Private LAN API target is not a usable private address"
          : "API target resolves only to private or special-use addresses",
    );
  }

  return {
    url: parsed,
    addresses: approved,
    lookup: createPinnedLookup(approved),
    isLoopback: explicitLoopback,
    isPrivateLan: explicitPrivateLan,
  };
}

module.exports = {
  assertSafeApiTarget,
  createPinnedLookup,
  isBlockedIp,
  isLoopbackIp,
  isPrivateLanIp,
  parseApiTarget,
};
