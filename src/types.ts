// Zod v4 API (shipped under the zod/v4 subpath) — required by the Anthropic
// SDK's zodOutputFormat helper, which expects v4 schema internals.
import { z } from "zod/v4";

/**
 * The structured shape the content agent returns for a single post.
 * Frontmatter is rendered per-brand from these fields (see brands.ts),
 * so the agent never has to know each blog's frontmatter dialect.
 */
export const DraftSchema = z.object({
  title: z.string().describe("Post title — no markdown, no surrounding quotes"),
  slug: z.string().describe("URL-safe kebab-case slug, e.g. why-fba-sellers-need-pentests"),
  description: z.string().describe("1–2 sentence summary for frontmatter / meta description"),
  tags: z.array(z.string()).describe("3–6 lowercase topical tags"),
  body: z
    .string()
    .describe("Full post body in Markdown. No frontmatter block, and no H1 title (the title field covers that)."),
});

export type Draft = z.infer<typeof DraftSchema>;
