import { Octokit } from "@octokit/rest";
import type { Brand } from "./brands";

/**
 * Voice ingestion (M1), read side.
 *
 * Pull a brand's existing posts straight from its GitHub repo and parse them
 * into a neutral shape the voice distiller can study. We read the same MDX
 * `export const metadata = {...}` format both blogs use (confirmed against
 * each repo's lib/content.ts) — no YAML frontmatter involved.
 */
export interface SourcePost {
  slug: string;
  title?: string;
  date?: string;
  tags: string[];
  /** Post body with the metadata export stripped, trimmed. */
  body: string;
  wordCount: number;
}

const METADATA_RE = /export\s+const\s+metadata\s*=\s*\{([\s\S]*?)\};/;

function stringField(obj: string, key: string): string | undefined {
  // Mirrors each repo's parser: quoted value, possibly on the next line.
  const m = obj.match(new RegExp(`${key}:\\s*["'\`]([^"'\`]*)["'\`]`, "s"));
  return m?.[1];
}

function arrayField(obj: string, key: string): string[] {
  const m = obj.match(new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`));
  if (!m) return [];
  const items = m[1].match(/["'\`]([^"'\`]*)["'\`]/g);
  return items ? items.map((s) => s.slice(1, -1)) : [];
}

/** Parse one raw .mdx file into a SourcePost. Exported for testing/reuse. */
export function parsePost(slug: string, raw: string): SourcePost {
  const meta = raw.match(METADATA_RE)?.[1] ?? "";
  const body = raw.replace(METADATA_RE, "").trim();
  return {
    slug,
    title: stringField(meta, "title"),
    date: stringField(meta, "date"),
    tags: arrayField(meta, "tags"),
    body,
    wordCount: body.split(/\s+/).filter(Boolean).length,
  };
}

/**
 * Fetch up to `limit` posts from a brand's repo, newest first by metadata date.
 * Uses the GitHub Contents API (read-only) with the same token publishing uses.
 */
export async function fetchPosts(brand: Brand, limit = 20): Promise<SourcePost[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set — needed to read existing posts.");

  const octokit = new Octokit({ auth: token });
  const [owner, repo] = brand.repo.split("/");
  const dir = brand.contentPath.replace(/\/$/, "");

  const listing = await octokit.repos.getContent({
    owner,
    repo,
    path: dir,
    ref: brand.defaultBranch,
  });
  if (!Array.isArray(listing.data)) {
    throw new Error(`${dir} is not a directory in ${brand.repo}`);
  }

  const files = listing.data.filter(
    (f) => f.type === "file" && f.name.endsWith(`.${brand.ext}`),
  );

  const posts: SourcePost[] = [];
  for (const f of files) {
    const file = await octokit.repos.getContent({
      owner,
      repo,
      path: f.path,
      ref: brand.defaultBranch,
    });
    if (Array.isArray(file.data) || file.data.type !== "file" || !("content" in file.data)) {
      continue;
    }
    const raw = Buffer.from(file.data.content, "base64").toString("utf8");
    const slug = f.name.replace(new RegExp(`\\.${brand.ext}$`), "");
    posts.push(parsePost(slug, raw));
  }

  // Newest first; undated posts sink to the bottom.
  posts.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return posts.slice(0, limit);
}
