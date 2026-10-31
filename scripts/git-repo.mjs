import { execSync } from "node:child_process";

/** Slug `owner/name` from GITHUB_REPOSITORY or the origin remote (for forks and local runs). */
export function githubRepositorySlug(root) {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const url = execSync("git remote get-url origin", { cwd: root, encoding: "utf8" }).trim();
    const match = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

export function githubPagesOrigin(slug) {
  if (!slug) return "";
  const [owner, name] = slug.split("/", 2);
  return owner && name ? `https://${owner}.github.io/${name}` : "";
}
