import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { Command } from "commander";
import { getBrand } from "./brands";
import { draftPost, revisePost } from "./agent";
import { renderMarkdown, setImageMetadata, today } from "./render";
import { publishDraft, type PublishAsset } from "./github";
import { generateHeroImage } from "./image";
import { buildVoiceProfile } from "./voice";
import { log } from "./logger";

/** Pull the first `key: "value"` out of a post's metadata block. */
function metaField(markdown: string, key: string): string {
  return markdown.match(new RegExp(`${key}:\\s*["'\`]([^"'\`]+)["'\`]`))?.[1] ?? "";
}

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
 * friday revise <file> "<feedback>" --brand <key>
 * Auto step (M5): rewrite an existing draft in place per feedback, in the
 * brand's voice. Edits the whole MDX as text, so metadata (image, published,
 * date) and the slug survive. Re-run image/publish afterward as needed.
 */
program
  .command("revise")
  .argument("<file>", "Path to a drafted post file")
  .argument("<feedback>", "What to change, in plain English")
  .requiredOption("-b, --brand <key>", "Brand key (scansafeguard | warnerware)")
  .action(async (file: string, feedback: string, opts: { brand: string }) => {
    const brand = getBrand(opts.brand);
    const current = await readFile(file, "utf8");

    log.info("revising", { brand: brand.key, file });
    const revised = await revisePost(brand, current, feedback);

    // Guard against a malformed rewrite — never clobber a good draft with junk.
    if (!/export const metadata\s*=/.test(revised) || !/^#\s+/m.test(revised)) {
      throw new Error("Revision wasn't well-formed MDX — leaving the file unchanged.");
    }
    await writeFile(file, revised, "utf8");

    const title = metaField(revised, "title");
    log.info("revision ready", { file, title });
    console.log(
      `\n  Revised: ${title}\n  → ${file}\n\n` +
        `  Review it, then: pnpm friday publish ${file} --brand ${brand.key}\n`,
    );
  });

/**
 * friday image <file> --brand <key>
 * Auto step (M4): generate a hero image for a finished draft via the configured
 * provider (IMAGE_PROVIDER), save it next to the draft, and wire the `image:`
 * metadata field. Explicit and opt-in, so you only spend on art you want.
 */
program
  .command("image")
  .argument("<file>", "Path to a drafted post file")
  .requiredOption("-b, --brand <key>", "Brand key (scansafeguard | warnerware)")
  .action(async (file: string, opts: { brand: string }) => {
    const brand = getBrand(opts.brand);
    const markdown = await readFile(file, "utf8");
    const title = metaField(markdown, "title");
    const description = metaField(markdown, "description");
    const slug = basename(file, `.${brand.ext}`).replace(new RegExp(`^${brand.key}-`), "");

    log.info("generating image", {
      brand: brand.key,
      slug,
      provider: process.env.IMAGE_PROVIDER ?? "openai",
    });
    const image = await generateHeroImage(brand, title, description);

    // Save the asset next to the draft (gitignored, like the draft itself).
    const imgFile = file.replace(new RegExp(`\\.${brand.ext}$`), `.${image.ext}`);
    await writeFile(imgFile, image.bytes);

    // Wire the public URL into the post's metadata.
    const url = `${brand.imageUrlBase}/${slug}.${image.ext}`;
    await writeFile(file, setImageMetadata(markdown, url), "utf8");

    log.info("image ready", { file: imgFile, url });
    console.log(
      `\n  Hero image generated\n  → ${imgFile}\n  metadata image: ${url}\n\n` +
        `  Review it, then: pnpm friday publish ${file} --brand ${brand.key}\n`,
    );
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

    // Attach a sibling hero image if `friday image` generated one.
    let asset: PublishAsset | undefined;
    const imgFile = file.replace(new RegExp(`\\.${brand.ext}$`), ".png");
    try {
      const bytes = await readFile(imgFile);
      asset = { path: `${brand.imagePath.replace(/\/$/, "")}/${slug}.png`, bytes };
      log.info("attaching hero image", { imgFile, path: asset.path });
    } catch {
      log.warn("no hero image found — publishing without one", {
        expected: imgFile,
        hint: `run: pnpm friday image ${file} --brand ${brand.key}`,
      });
    }

    log.info("publishing", { brand: brand.key, slug });
    const result = await publishDraft(brand, slug, markdown, title, asset);

    log.info("PR opened", { prUrl: result.prUrl });
    console.log(`\n  PR opened → ${result.prUrl}\n  Merge it to publish.\n`);
  });

program.parseAsync().catch((err) => {
  log.error("command failed", { error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
