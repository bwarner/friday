import type { Brand } from "./brands";
import type { Draft } from "./types";

/**
 * Compose a publishable MDX file matching the blogs' existing convention:
 *
 *   export const metadata = { ... };
 *
 *   # Title
 *
 *   ...body...
 *
 * The metadata export is parsed (and stripped) by each repo's MDX pipeline,
 * and the H1 lives in the body — exactly like every existing post. The Draft's
 * `body` carries no H1 (see types.ts), so we add it from `title` here.
 */
export function renderMarkdown(brand: Brand, draft: Draft, isoDate: string): string {
  return `${brand.metadata(draft, isoDate)}\n\n# ${draft.title}\n\n${draft.body.trim()}\n`;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Insert (or replace) the `image:` line inside an existing
 * `export const metadata = { ... };` block. The draft is rendered before the
 * hero image exists, so `friday image` (M4) wires the field in after the asset
 * is generated. New posts get the line right after `title:` for tidy ordering.
 */
export function setImageMetadata(markdown: string, imageUrl: string): string {
  const line = `  image: ${JSON.stringify(imageUrl)},`;
  if (/^\s*image:\s*.*$/m.test(markdown)) {
    return markdown.replace(/^\s*image:\s*.*$/m, line);
  }
  return markdown.replace(/^(\s*title:\s*.*)$/m, `$1\n${line}`);
}
