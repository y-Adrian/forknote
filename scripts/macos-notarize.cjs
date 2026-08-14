/**
 * electron-builder afterSign hook for macOS notarization.
 *
 * Secret-dependent: skips (no-op) unless APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD,
 * and APPLE_TEAM_ID are all set. Signing itself is driven by CSC_LINK /
 * CSC_KEY_PASSWORD in CI — this hook only submits a signed app to Apple.
 *
 * Usage: referenced from package.json build.afterSign
 */
"use strict";

const path = require("node:path");
const { notarize } = require("@electron/notarize");

exports.default = async function macosNotarize(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appleId = process.env.APPLE_ID || "";
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD || "";
  const teamId = process.env.APPLE_TEAM_ID || "";

  if (!appleId || !appleIdPassword || !teamId) {
    console.log(
      "[macos-notarize] Skipping notarization — APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not fully configured.",
    );
    return;
  }

  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === "false" && !process.env.CSC_LINK) {
    console.log(
      "[macos-notarize] Skipping notarization — unsigned build (no CSC_LINK; CSC_IDENTITY_AUTO_DISCOVERY=false).",
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  console.log(`[macos-notarize] Notarizing ${appPath}`);

  await notarize({
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });

  console.log("[macos-notarize] Notarization complete.");
};
