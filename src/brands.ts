import type { Draft } from "./types";

/**
 * A brand maps a publishing target (a GitHub-backed blog) to:
 *  - where posts live in the repo (path + file extension),
 *  - how that repo's post metadata is shaped,
 *  - the voice the agent should write in.
 *
 * Adding a new blog = adding an entry here. Nothing else changes.
 */
export interface Brand {
  key: string;
  name: string;
  /** owner/repo on GitHub */
  repo: string;
  /** Directory for posts, relative to repo root. Confirmed against each repo. */
  contentPath: string;
  /** Post file extension (no dot). Both blogs are MDX. */
  ext: string;
  defaultBranch: string;
  /** Repo-relative dir for post images, e.g. "public/images/posts". */
  imagePath: string;
  /** Public URL prefix for the metadata `image:` field, e.g. "/images/posts". */
  imageUrlBase: string;
  /** Appended to the hero-image prompt (M4) to keep generated art on-brand. */
  imageStyle: string;
  /** System prompt: voice, audience, and guardrails. */
  voice: string;
  /**
   * Render the post's metadata header.
   *
   * Both blogs are Next.js + MDX and parse a JS `export const metadata = {...}`
   * object via regex (see each repo's lib/content.ts) — NOT YAML frontmatter.
   * The H1 title is rendered separately in the body (see render.ts).
   */
  metadata: (d: Draft, isoDate: string) => string;
}

/**
 * Emit a `export const metadata = {...};` block in the exact shape both blogs'
 * regex parser expects: one `key: value,` per line, strings JSON-quoted,
 * arrays inline, booleans bare.
 */
function metadataBlock(
  fields: Array<[string, string | string[] | boolean]>,
): string {
  const lines = fields.map(([k, v]) => {
    if (Array.isArray(v)) {
      return `  ${k}: [${v.map((t) => JSON.stringify(t)).join(", ")}],`;
    }
    if (typeof v === "boolean") return `  ${k}: ${v},`;
    return `  ${k}: ${JSON.stringify(v)},`;
  });
  return `export const metadata = {\n${lines.join("\n")}\n};`;
}

const NO_SECRETS =
  "Never include real customer names, internal hostnames, credentials, API keys, " +
  "or any non-public business data. If you need an example, invent a clearly fictional one.";

export const brands: Record<string, Brand> = {
  scansafeguard: {
    key: "scansafeguard",
    name: "ScanSafeguard",
    repo: "bwarner/scansafeguard-blog",
    // Confirmed against content/posts/understanding-port-scanning.mdx.
    contentPath: "content/posts",
    ext: "mdx",
    defaultBranch: "main",
    imagePath: "public/images/posts",
    imageUrlBase: "/images/posts",
    imageStyle:
      "Clean, modern technical editorial illustration. Muted, credible palette anchored on " +
      "security blue and slate gray. Abstract networks, shields, packets, or circuitry — " +
      "calm and authoritative, never cartoonish, alarmist, or stock-photo cliché.",
    voice: [
      "You write for the ScanSafeguard blog: security insights, vulnerability research,",
      "and network-defense strategy for technical security and IT audiences.",
      "Tone: precise, credible, no hype, no fearmongering. Lead with the practical takeaway.",
      "Prefer concrete examples and defensible claims over marketing language.",
      NO_SECRETS,
    ].join(" "),
    // Required by lib/content.ts: title, description, date, published.
    // Optional (omitted): image, author, updated.
    metadata: (d, date) =>
      metadataBlock([
        ["title", d.title],
        ["description", d.description],
        ["date", date],
        ["tags", d.tags],
        ["published", true],
      ]),
  },

  warnerware: {
    key: "warnerware",
    name: "WarnerWare",
    repo: "bwarner/warnerware",
    // Confirmed against content/posts/hello-world.mdx — same MDX format as
    // scansafeguard (NOT the Astro src/content/blog layout the scaffold guessed).
    contentPath: "content/posts",
    ext: "mdx",
    defaultBranch: "main",
    imagePath: "public/images/posts",
    imageUrlBase: "/images/posts",
    imageStyle:
      "Warm, approachable editorial illustration with a builder/maker feel. Friendly modern " +
      "palette with WarnerWare blue (#277CEA) accents. Conceptual and human, not corporate stock.",
    voice: [
      "You write for WarnerWare, Byron Warner's personal site: a builder/entrepreneur voice",
      "covering software, AI, and running small businesses.",
      "Tone: first-person, candid, opinionated but grounded. Short paragraphs.",
      "Share real reasoning and tradeoffs, not generic advice.",
      NO_SECRETS,
    ].join(" "),
    metadata: (d, date) =>
      metadataBlock([
        ["title", d.title],
        ["description", d.description],
        ["date", date],
        ["tags", d.tags],
        ["published", true],
      ]),
  },
};

export function getBrand(key: string): Brand {
  const brand = brands[key];
  if (!brand) {
    throw new Error(
      `Unknown brand "${key}". Known brands: ${Object.keys(brands).join(", ")}`,
    );
  }
  return brand;
}
