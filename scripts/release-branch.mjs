#!/usr/bin/env node
/**
 * Build `three-plume` and commit the result to the `release` branch, laid out as a
 * standalone package at the branch root. Projects install it straight from git:
 *
 *   "three-plume": "git+https://github.com/thegameband/plume.git#release"
 *
 * npm can only install a git repo from its root and never builds dependencies, so the
 * monorepo's `main` can't be installed directly — `release` is that root, prebuilt.
 *
 *   pnpm release:branch            build + commit locally
 *   pnpm release:branch --push     ...and push `release` to origin
 *
 * Runs in CI on every push to main (.github/workflows/release-branch.yml).
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BRANCH = "release";
const root = fileURLToPath(new URL("..", import.meta.url));
const pkgDir = join(root, "packages", "plume");
const push = process.argv.includes("--push");

// A shell is only needed to resolve `pnpm.cmd` on Windows; anything else would have its
// arguments re-split by it.
const run = (cmd, args, cwd = root) =>
  execFileSync(cmd, args, {
    cwd,
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    shell: cmd === "pnpm" && process.platform === "win32",
  }).trim();
const git = (args, cwd = root) => run("git", args, cwd);

const sourceSha = git(["rev-parse", "--short", "HEAD"]);
if (git(["status", "--porcelain", "--", "packages/plume"]) !== "") {
  console.warn("warning: packages/plume has uncommitted changes; they will be in this release build.");
}

console.log("Building three-plume…");
// Reuse the pnpm that launched this script; it may only exist through corepack.
const pnpmCli = process.env["npm_execpath"];
if (pnpmCli && /pnpm/i.test(pnpmCli)) {
  execFileSync(process.execPath, [pnpmCli, "--filter", "three-plume", "build"], { cwd: root, stdio: "inherit" });
} else {
  run("pnpm", ["--filter", "three-plume", "build"]);
}

const work = mkdtempSync(join(tmpdir(), "plume-release-"));
try {
  const hasLocal = git(["branch", "--list", BRANCH]) !== "";
  const hasRemote = git(["ls-remote", "--heads", "origin", BRANCH]) !== "";
  if (hasLocal) {
    git(["worktree", "add", work, BRANCH]);
  } else if (hasRemote) {
    git(["fetch", "origin", `${BRANCH}:${BRANCH}`]);
    git(["worktree", "add", work, BRANCH]);
  } else {
    git(["worktree", "add", "--detach", work]);
    git(["checkout", "--orphan", BRANCH], work);
  }

  for (const entry of readdirSync(work)) {
    if (entry !== ".git") rmSync(join(work, entry), { recursive: true, force: true });
  }

  // Install-time only: no scripts (npm would try to run them) and no devDependencies.
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  delete pkg.scripts;
  delete pkg.devDependencies;
  pkg.plumeSourceCommit = sourceSha;
  writeFileSync(join(work, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  for (const file of ["README.md", "CHANGELOG.md", "LICENSE"]) {
    if (existsSync(join(pkgDir, file))) cpSync(join(pkgDir, file), join(work, file));
  }
  cpSync(join(pkgDir, "dist"), join(work, "dist"), { recursive: true });

  git(["add", "-A"], work);
  if (git(["status", "--porcelain"], work) === "") {
    console.log(`release is already up to date with main ${sourceSha}.`);
  } else {
    git(["commit", "-q", "-m", `Release build of main ${sourceSha}`], work);
    console.log(`Committed ${BRANCH}: ${git(["log", "--oneline", "-1"], work)}`);
  }
  if (push) git(["push", "origin", BRANCH], work);
} finally {
  git(["worktree", "remove", "--force", work]);
}
