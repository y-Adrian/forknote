/**
 * P0/P1 sidecar + client probes for glob, grep, read slice, delete/rename,
 * write diffs, Office read/patch, git tools, and read-only tool classification.
 *
 * Usage: node scripts/test-fs-agent-tools.mjs
 * Spawns its own sidecar on SIDECAR_PORT (default 18787).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROJECT = path.join(os.tmpdir(), `forknote-fs-agent-tools-${process.pid}`);

const results = [];

function ok(name, pass, detail = "") {
  results.push({ name, pass, detail });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on("error", reject);
  });
}

async function json(base, method, pathname, body) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

function waitHealth(base, timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await json(base, "GET", "/health");
        if (r.status === 200 && r.data?.ok) {
          resolve(r);
          return;
        }
      } catch {
        // retry
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`sidecar health timeout at ${base}`));
        return;
      }
      setTimeout(tick, 80);
    };
    void tick();
  });
}

async function testClientLogic() {
  console.log("\n=== Client isReadOnlyAgentTool ===\n");
  const tmp = path.join(os.tmpdir(), `forknote-readonly-${process.pid}.mts`);
  await fs.writeFile(
    tmp,
    `
import { isReadOnlyAgentTool, isWriteTool } from ${JSON.stringify(
      path.join(ROOT, "src/lib/agentTools.ts"),
    )};
const out = {
  glob: isReadOnlyAgentTool("glob_files"),
  read: isReadOnlyAgentTool("read_file"),
  search: isReadOnlyAgentTool("search_files"),
  gitStatus: isReadOnlyAgentTool("git_status"),
  gitDiff: isReadOnlyAgentTool("git_diff"),
  diag: isReadOnlyAgentTool("run_diagnostics"),
  docx: isReadOnlyAgentTool("read_docx"),
  xlsx: isReadOnlyAgentTool("read_xlsx"),
  write: isReadOnlyAgentTool("write_file"),
  del: isReadOnlyAgentTool("delete_file"),
  rename: isReadOnlyAgentTool("rename_file"),
  patchXlsx: isReadOnlyAgentTool("patch_xlsx"),
  commit: isReadOnlyAgentTool("git_commit"),
  ls: isReadOnlyAgentTool("run_terminal", "ls"),
  rm: isReadOnlyAgentTool("run_terminal", "rm -rf dist"),
  writeTool: isWriteTool("write_file"),
};
process.stdout.write(JSON.stringify(out));
`,
    "utf8",
  );
  try {
    const { stdout } = await execFileAsync(
      path.join(ROOT, "node_modules", ".bin", "tsx"),
      [tmp],
      { cwd: ROOT, env: process.env },
    );
    const data = JSON.parse(stdout.trim());
    ok("readonly glob/read/search/git/diag/office", data.glob && data.read && data.search && data.gitStatus && data.gitDiff && data.diag && data.docx && data.xlsx);
    ok("mutating write/delete/rename/patch_xlsx/commit", !data.write && !data.del && !data.rename && !data.patchXlsx && !data.commit && data.writeTool === true);
    ok("readonly terminal ls, mutating rm", data.ls === true && data.rm === false);
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}

async function testSidecar(base) {
  console.log("\n=== Sidecar FS / git / office ===\n");
  await fs.rm(PROJECT, { recursive: true, force: true });
  await fs.mkdir(path.join(PROJECT, "src"), { recursive: true });
  await fs.writeFile(path.join(PROJECT, "src", "a.ts"), "export const alpha = 1;\n");
  await fs.writeFile(path.join(PROJECT, "src", "b.ts"), "export const beta = 2;\n");
  await fs.writeFile(path.join(PROJECT, "notes.md"), "hello world\nfoo bar\n");
  const big = Array.from({ length: 5000 }, (_, i) => `line-${i + 1} ${"x".repeat(60)}`).join("\n");
  await fs.writeFile(path.join(PROJECT, "big.txt"), `${big}\n`);

  const opened = await json(base, "POST", "/project/open", { path: PROJECT });
  ok("open project", opened.status === 200, `status=${opened.status}`);

  {
    const r = await json(base, "POST", "/fs/glob", { pattern: "**/*.ts" });
    const matches = r.data?.matches ?? [];
    ok(
      "glob **/*.ts",
      r.status === 200 && matches.includes("src/a.ts") && matches.includes("src/b.ts"),
      JSON.stringify(matches),
    );
  }

  {
    const r = await json(base, "POST", "/fs/search", {
      query: "export const a",
      regex: false,
    });
    const hits = r.data?.hits ?? [];
    ok(
      "search substring",
      r.status === 200 &&
        hits.length >= 1 &&
        hits.some((h) => String(h.path).includes("a.ts") || /alpha/.test(String(h.text ?? ""))),
      JSON.stringify(hits.slice(0, 3)),
    );
  }

  {
    const r = await json(base, "POST", "/fs/search", {
      query: "export const (alpha|beta)",
      regex: true,
      glob: "**/*.ts",
    });
    const hits = r.data?.hits ?? [];
    ok(
      "search regex + glob",
      r.status === 200 && hits.length >= 2,
      `hits=${hits.length} err=${r.data?.error ?? ""}`,
    );
  }

  {
    const r = await json(base, "GET", "/fs/read?path=big.txt&offset=10&limit=3");
    const content = String(r.data?.content ?? "");
    ok(
      "read offset/limit",
      r.status === 200 &&
        content.includes("line-10") &&
        content.includes("line-12") &&
        !content.includes("line-13") &&
        r.data?.truncated === true,
      `status=${r.status} start=${r.data?.startLine} end=${r.data?.endLine} truncated=${r.data?.truncated}`,
    );
  }

  {
    const r = await json(base, "GET", "/fs/read?path=big.txt");
    ok(
      "large file does not 413",
      r.status === 200 && r.data?.truncated === true && typeof r.data?.content === "string",
      `status=${r.status} truncated=${r.data?.truncated} size=${r.data?.size} totalLines=${r.data?.totalLines}`,
    );
  }

  {
    const r = await json(base, "POST", "/fs/write", {
      path: "notes.md",
      content: "hello world\nchanged\n",
    });
    ok(
      "write returns diff",
      r.status === 200 &&
        typeof r.data?.diff === "string" &&
        r.data.diff.includes("-foo bar") &&
        r.data.diff.includes("+changed"),
      `diff=${JSON.stringify(r.data?.diff)?.slice(0, 180)}`,
    );
  }

  {
    const r = await json(base, "POST", "/fs/rename", {
      from: "src/b.ts",
      to: "src/beta.ts",
    });
    const glob = await json(base, "POST", "/fs/glob", { pattern: "src/*" });
    ok(
      "rename file",
      r.status === 200 &&
        r.data?.renamed === true &&
        (glob.data?.matches ?? []).includes("src/beta.ts") &&
        !(glob.data?.matches ?? []).includes("src/b.ts"),
      JSON.stringify({ rename: r.data, glob: glob.data?.matches }),
    );
  }

  {
    await json(base, "POST", "/fs/write", { path: "tmp-del.txt", content: "x\n" });
    const r = await json(base, "POST", "/fs/delete", { path: "tmp-del.txt" });
    const glob = await json(base, "POST", "/fs/glob", { pattern: "tmp-del.txt" });
    ok(
      "delete file",
      r.status === 200 && r.data?.deleted === true && (glob.data?.matches ?? []).length === 0,
      JSON.stringify(r.data),
    );
  }

  {
    const created = await json(base, "POST", "/fs/write_xlsx", {
      path: "sheet.xlsx",
      sheet_name: "Data",
      rows: [
        ["name", "n"],
        ["alpha", 1],
      ],
    });
    ok("write_xlsx", created.status === 200, `status=${created.status}`);
    const read = await json(base, "POST", "/fs/read_xlsx", { path: "sheet.xlsx" });
    const first = read.data?.sheets?.[0];
    ok(
      "read_xlsx",
      read.status === 200 && first?.name === "Data" && first?.rows?.[0]?.cells?.[0] === "name",
      JSON.stringify(read.data?.sheets?.[0]),
    );
    const patched = await json(base, "POST", "/fs/patch_xlsx", {
      path: "sheet.xlsx",
      sheet_name: "Data",
      cells: [{ row: 2, col: 2, value: 99 }],
    });
    ok(
      "patch_xlsx",
      patched.status === 200 && patched.data?.patched >= 1,
      JSON.stringify(patched.data),
    );
    const read2 = await json(base, "POST", "/fs/read_xlsx", { path: "sheet.xlsx" });
    const row2 = read2.data?.sheets?.[0]?.rows?.find((row) => row.row === 2);
    ok(
      "patch_xlsx cell value",
      String(row2?.cells?.[1] ?? "") === "99",
      JSON.stringify(row2),
    );
  }

  {
    const created = await json(base, "POST", "/fs/write_docx", {
      path: "doc.docx",
      title: "Hello",
      paragraphs: ["Paragraph one"],
    });
    ok("write_docx", created.status === 200, `status=${created.status}`);
    const read = await json(base, "POST", "/fs/read_docx", { path: "doc.docx" });
    ok(
      "read_docx",
      read.status === 200 && String(read.data?.text ?? "").includes("Paragraph one"),
      `text=${JSON.stringify(read.data?.text)?.slice(0, 120)}`,
    );
  }

  {
    await execFileAsync("git", ["init"], { cwd: PROJECT });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: PROJECT,
    });
    await execFileAsync("git", ["config", "commit.gpgsign", "false"], {
      cwd: PROJECT,
    });
    const status = await json(base, "POST", "/git/status", {});
    ok(
      "git status porcelain",
      status.status === 200 && String(status.data?.output ?? "").includes("notes.md"),
      `output=${JSON.stringify(status.data?.output)?.slice(0, 160)}`,
    );
    const missing = await json(base, "POST", "/git/commit", {
      message: "should fail",
    });
    ok(
      "git commit requires paths",
      missing.status === 400,
      `status=${missing.status} error=${missing.data?.error}`,
    );
    await fs.writeFile(path.join(PROJECT, "keep-dirty.txt"), "dirty\n");
    const commit = await json(base, "POST", "/git/commit", {
      message: "add notes",
      paths: ["notes.md"],
    });
    ok(
      "git commit staged paths only",
      commit.status === 200 && commit.data?.ok === true,
      `status=${commit.status} output=${JSON.stringify(commit.data?.output)?.slice(0, 160)}`,
    );
    const after = await json(base, "POST", "/git/status", {});
    const out = String(after.data?.output ?? "");
    ok(
      "git commit did not add -A",
      after.status === 200 && out.includes("keep-dirty.txt") && !/notes\.md/.test(out.split("\n").slice(1).join("\n")),
      `output=${JSON.stringify(out).slice(0, 200)}`,
    );
    const diff = await json(base, "POST", "/git/diff", {});
    ok("git diff endpoint", diff.status === 200, `status=${diff.status}`);
  }

  {
    const r = await json(base, "POST", "/fs/diagnostics", {});
    ok(
      "diagnostics skips without tsconfig",
      r.status === 200 && r.data?.skipped === true,
      JSON.stringify(r.data),
    );
  }

  await json(base, "POST", "/project/close", {});
}

async function main() {
  const port = Number(process.env.SIDECAR_PORT) || (await freePort());
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, "sidecar/index.js")], {
    cwd: ROOT,
    env: { ...process.env, SIDECAR_PORT: String(port), SIDECAR_HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout?.on("data", (c) => {
    logs += String(c);
  });
  child.stderr?.on("data", (c) => {
    logs += String(c);
  });
  try {
    await waitHealth(base);
    console.log("Sidecar OK:", base);
    await testSidecar(base);
    await testClientLogic();
  } catch (e) {
    console.error(e);
    console.error("sidecar logs:\n", logs);
    process.exitCode = 1;
  } finally {
    child.kill("SIGTERM");
    await fs.rm(PROJECT, { recursive: true, force: true }).catch(() => {});
  }

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n=== Summary: ${results.length - failed.length}/${results.length} passed ===`,
  );
  if (failed.length) {
    for (const f of failed) console.error("FAIL", f.name, f.detail);
    process.exit(1);
  }
}

await main();
