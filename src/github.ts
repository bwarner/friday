import { Octokit } from "@octokit/rest";
import type { Brand } from "./brands";

/**
 * The "publish" half of the pipeline (M3) — and the human-in-the-loop gate.
 *
 * Publishing == opening a PR that adds one Markdown file to the blog repo.
 * You review and merge the PR; merging is what goes live. That makes GitHub
 * itself the approval queue, with preview, history, and one-click rollback.
 */
export interface PublishResult {
  prUrl: string;
  branch: string;
  path: string;
}

export async function publishDraft(
  brand: Brand,
  slug: string,
  markdown: string,
  title: string,
): Promise<PublishResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set — needed to open the PR.");

  const octokit = new Octokit({ auth: token });
  const [owner, repo] = brand.repo.split("/");
  const branch = `friday/${slug}-${Date.now()}`;
  const path = `${brand.contentPath.replace(/\/$/, "")}/${slug}.${brand.ext}`;

  // Branch off the blog's default branch.
  const base = await octokit.git.getRef({ owner, repo, ref: `heads/${brand.defaultBranch}` });
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: base.data.object.sha,
  });

  // Commit the new post.
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    branch,
    message: `post: ${title}`,
    content: Buffer.from(markdown, "utf8").toString("base64"),
  });

  // Open the PR — this is the approval gate.
  const pr = await octokit.pulls.create({
    owner,
    repo,
    base: brand.defaultBranch,
    head: branch,
    title: `post: ${title}`,
    body: `Drafted by Friday for **${brand.name}**.\n\nReview the rendered preview, then merge to publish.`,
  });

  return { prUrl: pr.data.html_url, branch, path };
}
