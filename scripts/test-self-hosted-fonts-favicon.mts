/**
 * Probe #381: desktop/web startup must use self-hosted fonts and ship favicon assets.
 *
 * Usage: npx tsx scripts/test-self-hosted-fonts-favicon.mts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const results: Array<{ name: string; pass: boolean }> = [];
function ok(name: string, pass: boolean, detail = "") {
  results.push({ name, pass });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
ok(
  "index.html has no Google Fonts / gstatic links",
  !/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(indexHtml),
);
ok(
  "index.html references shipped favicon.png and favicon.svg",
  /href="\/favicon\.png"/.test(indexHtml) &&
    /href="\/favicon\.svg"/.test(indexHtml),
);

ok(
  "public/favicon.png exists",
  fs.existsSync(path.join(ROOT, "public/favicon.png")),
);
ok(
  "public/favicon.svg exists",
  fs.existsSync(path.join(ROOT, "public/favicon.svg")),
);

const fontsCss = fs.readFileSync(path.join(ROOT, "src/fonts.css"), "utf8");
ok(
  "src/fonts.css self-hosts Dela / IBM Plex / JetBrains",
  fontsCss.includes("@fontsource/dela-gothic-one") &&
    fontsCss.includes("@fontsource/ibm-plex-sans") &&
    fontsCss.includes("@fontsource/jetbrains-mono"),
);

const mainTsx = fs.readFileSync(path.join(ROOT, "src/main.tsx"), "utf8");
ok("main.tsx imports local fonts.css", /import\s+["']\.\/fonts\.css["']/.test(mainTsx));

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const dev = pkg.devDependencies ?? {};
ok(
  "fontsource packages are installed (devDependencies)",
  Boolean(dev["@fontsource/dela-gothic-one"]) &&
    Boolean(dev["@fontsource/ibm-plex-sans"]) &&
    Boolean(dev["@fontsource/jetbrains-mono"]),
);

// Prove the prior failure mode: CDN links would have been present.
ok(
  "prior Google Fonts stylesheet pattern is absent",
  !/family=Dela\+Gothic\+One|family=IBM\+Plex\+Sans|family=JetBrains\+Mono/.test(
    indexHtml,
  ),
);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
assert.ok(failed.length === 0);
