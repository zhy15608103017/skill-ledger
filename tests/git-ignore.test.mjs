import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { ensureAuditGitIgnored } from "../core/git-ignore.mjs";

test("ensureAuditGitIgnored appends the audit dir to .gitignore in a git repo", async () => {
  await withTempRepo(async (repo) => {
    const auditHome = path.join(repo, ".skill-ledger");
    await mkdir(auditHome, { recursive: true });
    const result = await ensureAuditGitIgnored({ auditHome, cwd: repo });

    assert.equal(result.skipped, false);
    assert.equal(result.pattern, ".skill-ledger/");
    assert.equal(result.ignoreUpdated, true);

    const gitignore = await readFile(path.join(repo, ".gitignore"), "utf8");
    assert.match(gitignore, /\.skill-ledger\//);
    assert.ok(isGitIgnored(repo, ".skill-ledger"));
  });
});

test("ensureAuditGitIgnored is idempotent and does not duplicate the gitignore entry", async () => {
  await withTempRepo(async (repo) => {
    await writeFile(path.join(repo, ".gitignore"), "node_modules/\n.skill-ledger/\n", "utf8");

    const auditHome = path.join(repo, ".skill-ledger");
    const result = await ensureAuditGitIgnored({ auditHome, cwd: repo });

    assert.equal(result.ignoreUpdated, false);

    const gitignore = await readFile(path.join(repo, ".gitignore"), "utf8");
    const matches = gitignore.match(/\.skill-ledger\/?\n/g) || [];
    assert.equal(matches.length, 1);
  });
});

test("ensureAuditGitIgnored untracks already-tracked audit files without deleting them", async () => {
  await withTempRepo(async (repo) => {
    const auditHome = path.join(repo, ".skill-ledger", "runs");
    await mkdir(auditHome, { recursive: true });
    const trackedFile = path.join(auditHome, "run-1.jsonl");
    await writeFile(trackedFile, "{}\n", "utf8");
    git(repo, ["add", ".skill-ledger/runs/run-1.jsonl"]);
    git(repo, ["commit", "-m", "track audit file"]);

    assert.equal(git(repo, ["ls-files", "--", ".skill-ledger"]).stdout.trim(), ".skill-ledger/runs/run-1.jsonl");

    const result = await ensureAuditGitIgnored({ auditHome: path.join(repo, ".skill-ledger"), cwd: repo });

    assert.equal(result.untracked, true);
    assert.equal(git(repo, ["ls-files", "--", ".skill-ledger"]).stdout.trim(), "");
    assert.ok(await fileExists(trackedFile), "local file must be preserved after untracking");
  });
});

test("ensureAuditGitIgnored skips gracefully when cwd is not a git repo", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-gitignore-nogit-"));
  try {
    const auditHome = path.join(cwd, ".skill-ledger");

    const result = await ensureAuditGitIgnored({ auditHome, cwd });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, "not_a_git_repo");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("ensureAuditGitIgnored skips when SKILL_LEDGER_AUTO_GITIGNORE is disabled", async () => {
  await withTempRepo(async (repo) => {
    const previous = process.env.SKILL_LEDGER_AUTO_GITIGNORE;
    process.env.SKILL_LEDGER_AUTO_GITIGNORE = "0";
    try {
      const result = await ensureAuditGitIgnored({ auditHome: path.join(repo, ".skill-ledger"), cwd: repo });
      assert.equal(result.skipped, true);
      assert.equal(result.reason, "disabled");
      assert.ok(!(await fileExists(path.join(repo, ".gitignore"))));
    } finally {
      if (previous === undefined) delete process.env.SKILL_LEDGER_AUTO_GITIGNORE;
      else process.env.SKILL_LEDGER_AUTO_GITIGNORE = previous;
    }
  });
});

test("ensureAuditGitIgnored handles audit home nested under a subdirectory of the repo", async () => {
  await withTempRepo(async (repo) => {
    const nestedCwd = path.join(repo, "packages", "app");
    await mkdir(nestedCwd, { recursive: true });

    const auditHome = path.join(nestedCwd, ".skill-ledger");
    await mkdir(auditHome, { recursive: true });
    const result = await ensureAuditGitIgnored({ auditHome, cwd: nestedCwd });

    assert.equal(result.skipped, false);
    assert.equal(result.pattern, "packages/app/.skill-ledger/");

    const gitignore = await readFile(path.join(repo, ".gitignore"), "utf8");
    assert.match(gitignore, /packages\/app\/\.skill-ledger\//);
    assert.ok(isGitIgnored(repo, "packages/app/.skill-ledger"));
  });
});

async function withTempRepo(fn) {
  const repo = await mkdtemp(path.join(tmpdir(), "skill-ledger-gitignore-"));
  initGitRepo(repo);
  try {
    await fn(repo);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

function initGitRepo(repo) {
  git(repo, ["init", "--quiet"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, `${result.stderr || result.stdout || `git ${args.join(" ")}`}`);
  return result;
}

function isGitIgnored(repo, relativePath) {
  const result = spawnSync("git", ["check-ignore", "--quiet", relativePath], { cwd: repo, encoding: "utf8", shell: false });
  return result.status === 0;
}

async function fileExists(filePath) {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
