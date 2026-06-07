import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod/v4"; // v4 API — see types.ts
import type { Brand } from "./brands";
import { fetchPosts, type SourcePost } from "./ingest";
import { log } from "./logger";

/**
 * Voice ingestion (M1), distill side.
 *
 * Turn a brand's existing posts into a concrete, reusable voice profile that
 * the draft step injects into its system prompt. We cache the profile on disk
 * so drafting stays fast and local — re-run `friday voice <brand>` to refresh.
 */
export const VoiceProfileSchema = z.object({
  summary: z
    .string()
    .describe("One-paragraph characterization of the author's voice, grounded in the samples."),
  tone: z.array(z.string()).describe("3–6 tonal adjectives evidenced by the samples."),
  pointOfView: z
    .string()
    .describe("Narrative person and stance (e.g. first-person and direct, second-person address)."),
  sentenceStyle: z.string().describe("Sentence length, rhythm, and structural habits."),
  vocabulary: z
    .string()
    .describe("Diction and jargon level; signature words, phrasings, or metaphors actually used."),
  structure: z
    .string()
    .describe("How posts are organized: openings, heading patterns, pacing, and closings."),
  formatting: z
    .array(z.string())
    .describe("Recurring Markdown conventions (lists, bold, inline code, code blocks, headings)."),
  signatureMoves: z
    .array(z.string())
    .describe("Distinctive rhetorical habits a writer should reproduce to sound like this author."),
  avoid: z
    .array(z.string())
    .describe("Anti-patterns this author never does — things that would break the voice."),
});
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;

export interface VoiceCache {
  brand: string;
  generatedAt: string;
  model: string;
  sampleSlugs: string[];
  profile: VoiceProfile;
}

const MODEL = "claude-opus-4-8";
const VOICE_DIR = "voice";
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const cachePath = (brand: Brand): string => `${VOICE_DIR}/${brand.key}.json`;

/** Cap per-post length so a few long posts can't blow the context budget. */
function buildCorpus(posts: SourcePost[], maxCharsPerPost = 6000): string {
  return posts
    .map((p, i) => {
      const head = `--- SAMPLE ${i + 1}${p.title ? `: ${p.title}` : ""} (${p.wordCount} words) ---`;
      return `${head}\n${p.body.slice(0, maxCharsPerPost)}`;
    })
    .join("\n\n");
}

/** Distill a voice profile from already-fetched posts. */
export async function distillVoice(brand: Brand, posts: SourcePost[]): Promise<VoiceProfile> {
  if (posts.length === 0) {
    throw new Error(`No source posts found for ${brand.key} — nothing to learn a voice from.`);
  }

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system:
      "You are a writing analyst. Study the provided blog posts, all by a single author, " +
      "and produce a precise, reusable voice profile another writer could follow to write " +
      "indistinguishably in this author's style. Be concrete and evidence-based: capture " +
      "habits actually present in the samples, not generic writing advice. Describe only " +
      "what the samples support.",
    messages: [
      {
        role: "user",
        content:
          `Author/brand: ${brand.name}\n` +
          `Editorial context: ${brand.voice}\n\n` +
          `Here are ${posts.length} existing posts. Distill the voice via the required schema.\n\n` +
          buildCorpus(posts),
      },
    ],
    output_config: {
      format: zodOutputFormat(VoiceProfileSchema),
      effort: "high",
    },
  });

  if (!response.parsed_output) {
    throw new Error(`Voice distillation failed (stop_reason: ${response.stop_reason})`);
  }
  return response.parsed_output;
}

/** Fetch posts, distill, write the cache, and return it. */
export async function buildVoiceProfile(brand: Brand, limit = 20): Promise<VoiceCache> {
  const posts = await fetchPosts(brand, limit);
  log.info("voice: posts fetched", {
    brand: brand.key,
    count: posts.length,
    slugs: posts.map((p) => p.slug),
  });

  const profile = await distillVoice(brand, posts);
  const cache: VoiceCache = {
    brand: brand.key,
    generatedAt: new Date().toISOString(),
    model: MODEL,
    sampleSlugs: posts.map((p) => p.slug),
    profile,
  };

  await mkdir(VOICE_DIR, { recursive: true });
  await writeFile(cachePath(brand), JSON.stringify(cache, null, 2) + "\n", "utf8");
  return cache;
}

/** Load a cached profile, or null if the brand hasn't been ingested yet. */
export async function loadVoiceProfile(brand: Brand): Promise<VoiceCache | null> {
  try {
    const raw = await readFile(cachePath(brand), "utf8");
    return JSON.parse(raw) as VoiceCache;
  } catch {
    return null;
  }
}

/** Flatten a profile into prompt-ready text for the draft step. */
export function renderVoiceProfile(p: VoiceProfile): string {
  const bullets = (items: string[]) => items.map((s) => `  - ${s}`).join("\n");
  return [
    `Voice summary: ${p.summary}`,
    `Tone: ${p.tone.join(", ")}`,
    `Point of view: ${p.pointOfView}`,
    `Sentence style: ${p.sentenceStyle}`,
    `Vocabulary: ${p.vocabulary}`,
    `Structure: ${p.structure}`,
    `Formatting conventions:\n${bullets(p.formatting)}`,
    `Signature moves:\n${bullets(p.signatureMoves)}`,
    `Avoid:\n${bullets(p.avoid)}`,
  ].join("\n");
}
