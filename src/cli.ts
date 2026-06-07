import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { Command } from "commander";
import { getBrand } from "./brands";
import { draftPost } from "./agent";
import { renderMarkdown, today } from "./render";
import { publishDraft } from "./github";
import { buildVoiceProfile } from "./voice";
import { log } from "./logger";

const program = new Command();
program.name("friday").description("Personal content/persona agent").version("0.1.0");

/**
 * friday voice <brand> [--limit <n>]
 * Auto step (M1): pull existing posts from the brand's repo, distill a voice
 * profile, and cache it to voice/<brand>.json for the draft step to use.
 */
program
  .command("voice")
  .argument("<brand>", "Brand key (scansafeguard | warnerware)")
  .option("-n, --limit <n>", "Max posts to learn from", "20")
  .action(async (brandKey: string, opts: { limit: string }) => {
    const brand = getBrand(brandKey);
    const limit = Number.parseInt(opts.limit, 10);
    log.info("learning voice", { brand: brand.key, limit });

    const cache = await buildVoiceProfile(brand, limit);
    log.info("voice profile saved", {
      brand: brand.key,
      file: `voice/${brand.key}.json`,
      samples: cache.sampleSlugs.length,
    });
    console.log(
      `\n  Learned ${brand.name}'s voice from ${cache.sampleSlugs.length} posts\n` +
        `  → voice/${brand.key}.json\n\n  ${cache.profile.summary}\n`,
    );
  });

/**
 * friday draft "<topic>" --brand <key>
 * Auto step: generates a post in the brand's voice and writes it to drafts/.
 */
program
  .command("draft")
  .argument("<topic>", "What the post should be about")
  .requiredOption("-b, --brand <key>", "Brand key (scansafeguard | warnerware)")
  .action(async (topic: string, opts: { brand: string }) => {
    const brand = getBrand(opts.brand);
    log.info("drafting", { brand: brand.key, topic });

    const draft = await draftPost(brand, topic);
    const markdown = renderMarkdown(brand, draft, today());

    await mkdir("drafts", { recursive: true });
    const file = `drafts/${brand.key}-${draft.slug}.${brand.ext}`;
    await writeFile(file, markdown, "utf8");

    log.info("draft ready", { file, title: draft.title });
    console.log(`\n  ${draft.title}\n  → ${file}\n\n  Review it, then: pnpm friday publish ${file} --brand ${brand.key}\n`);
  });

/**
 * friday publish <file> --brand <key>
 * Gated step: opens a PR against the blog repo. You merge to publish.
 */
program
  .command("publish")
  .argument("<file>", "Path to a drafted post file")
  .requiredOption("-b, --brand <key>", "Brand key (scansafeguard | warnerware)")
  .action(async (file: string, opts: { brand: string }) => {
    const brand = getBrand(opts.brand);
    const markdown = await readFile(file, "utf8");

    // slug = filename without the "<brand>-" prefix and extension.
    const slug = basename(file, `.${brand.ext}`).replace(new RegExp(`^${brand.key}-`), "");
    // Title lives in the MDX `export const metadata = {...}` block, e.g. `  title: "...",`.
    const titleMatch = markdown.match(/title:\s*["'`]([^"'`]+)["'`]/);
    const title = titleMatch?.[1] ?? slug;

    log.info("publishing", { brand: brand.key, slug });
    const result = await publishDraft(brand, slug, markdown, title);

    log.info("PR opened", { prUrl: result.prUrl });
    console.log(`\n  PR opened → ${result.prUrl}\n  Merge it to publish.\n`);
  });

program.parseAsync().catch((err) => {
  log.error("command failed", { error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
