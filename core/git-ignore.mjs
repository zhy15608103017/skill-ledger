import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const BLOCK_HEADER = "# Skill Ledger audit output";

export async function ensureAuditGitIgnored({ auditHome, cwd }) {
  if (isDisabled()) return { skipped: true, reason: "disabled" };

  try {
    const home = path.resolve(auditHome);
    const repoRoot = gitRepoRoot(cwd);
    if (!repoRoot) return { skipped: true, reason: "not_a_git_repo" };

    const relative = path.relative(repoRoot, home);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
      return { skipped: true, reason: "outside_repo" };
    }

    const posixRelative = relative.replace(/\\/g, "/");
    const pattern = `${posixRelative}/`;

    const ignoreUpdated = await ensureGitignoreEntry(repoRoot, pattern);
    const untracked = untrackTrackedFiles(repoRoot, posixRelative);

    return { skipped: false, repoRoot, pattern, ignoreUpdated, untracked };
  } catch (error) {
    return { skipped: true, reason: "error", message: error?.message || String(error) };
  }
}

function isDisabled() {
  const value = String(process.env.SKILL_LEDGER_AUTO_GITIGNORE ?? "").toLowerCase();
  return value === "0" || value === "false" || value === "no" || value === "off";
}

function gitRepoRoot(cwd) {
  let result;
  try {
    result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: path.resolve(cwd),
      encoding: "utf8",
      shell: false,
    });
  } catch {
    return null;
  }
  if (result.error || result.status !== 0) return null;
  const root = String(result.stdout || "").trim();
  return root || null;
}

async function ensureGitignoreEntry(repoRoot, pattern) {
  const gitignorePath = path.join(repoRoot, ".gitignore");
  let content = "";
  try {
    content = await readFile(gitignorePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const lines = content.split(/\r?\n/);
  const barePattern = pattern.replace(/\/$/, "");
  const alreadyPresent = lines.some((line) => {
    const trimmed = line.trim();
    return trimmed === pattern || trimmed === barePattern;
  });
  if (alreadyPresent) return false;

  const block = `${BLOCK_HEADER}\n${pattern}\n`;
  const next = content.length === 0 ? block : `${content.replace(/\s+$/, "")}\n\n${block}`;
  await writeFile(gitignorePath, next, "utf8");
  return true;
}

function untrackTrackedFiles(repoRoot, relativePath) {
  let listed;
  try {
    listed = spawnSync("git", ["ls-files", "--", relativePath], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: false,
    });
  } catch {
    return false;
  }
  if (listed.error || listed.status !== 0) return false;
  const tracked = String(listed.stdout || "").trim();
  if (!tracked) return false;

  let removed;
  try {
    removed = spawnSync("git", ["rm", "--cached", "-r", "--quiet", "--", relativePath], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: false,
    });
  } catch {
    return false;
  }
  return removed.status === 0;
}
