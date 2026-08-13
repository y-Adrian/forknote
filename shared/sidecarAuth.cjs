const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TOKEN_BYTES = 32;
const TOKEN_DIR = path.join(os.homedir(), ".forknote");
const TOKEN_PATH = path.join(TOKEN_DIR, "sidecar-token");

function validToken(value) {
  const token = String(value || "").trim();
  return /^[a-f0-9]{64}$/i.test(token) ? token : null;
}

function loadOrCreateSidecarToken() {
  const fromEnv = validToken(process.env.SIDECAR_AUTH_TOKEN);
  if (fromEnv) return fromEnv;

  try {
    const existing = validToken(fs.readFileSync(TOKEN_PATH, "utf8"));
    if (existing) return existing;
  } catch {
    // First launch or an unreadable stale file; create a replacement below.
  }

  const token = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  fs.mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(TOKEN_PATH, `${token}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(TOKEN_DIR, 0o700);
    fs.chmodSync(TOKEN_PATH, 0o600);
  } catch {
    // Best effort on platforms without POSIX permission semantics.
  }
  return token;
}

module.exports = {
  loadOrCreateSidecarToken,
  TOKEN_PATH,
};
