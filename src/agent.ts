import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Brand } from "./brands";
import { DraftSchema, type Draft } from "./types";
import { loadVoiceProfile, renderVoiceProfile } from "./voice";
import { log } from "./logger";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

/**
 * Build the draft system prompt: the brand's base voice, plus the distilled
 * voice profile (M1) when one has been ingested. Falling back to the base
 * voice keeps drafting usable before `friday voice <brand>` has ever run.
 */
async function draftSystemPrompt(brand: Brand): Promise<string> {
  const cache = await loadVoiceProfile(brand);
  if (!cache) {
    log.warn("no voice profile cached — drafting from base voice only", {
      brand: brand.key,
      hint: `run: friday voice ${brand.key}`,
    });
    return brand.voice;
  }

  log.info("voice profile loaded", {
    brand: brand.key,
    generatedAt: cache.generatedAt,
    samples: cache.sampleSlugs.length,
  });
  return (
    `${brand.voice}\n\n` +
    `The following voice profile was distilled from ${brand.name}'s existing posts. ` +
    `Match it closely — the goal is a post indistinguishable from the author's own:\n\n` +
    renderVoiceProfile(cache.profile)
  );
}

/**
 * The "draft" half of the content pipeline (M2):
 *   ideate -> draft in the brand's voice -> return structured post.
 *
 * Structured outputs guarantee we get clean {title, slug, description, tags, body}
 * back, so rendering and publishing never have to parse free-form text.
 *
 * This is a low-risk, fully-auto step — nothing is published here.
 */
export async function draftPost(brand: Brand, topic: string): Promise<Draft> {
  const system = await draftSystemPrompt(brand);

  const response = await client.messages.parse({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system,
    messages: [
      {
        role: "user",
        content:
          `Write a complete blog post for ${brand.name} on this topic:\n\n${topic}\n\n` +
          `Make it genuinely useful and specific. Return it via the required schema.`,
      },
    ],
    output_config: {
      format: zodOutputFormat(DraftSchema),
      effort: "high",
    },
  });

  if (!response.parsed_output) {
    throw new Error(`Draft failed (stop_reason: ${response.stop_reason})`);
  }
  return response.parsed_output;
}

/** Drop a ```mdx fenced wrapper if the model returns one. */
function stripFence(text: string): string {
  const fenced = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1].trim() : text;
}

/**
 * Revise an existing draft in place (M5). Unlike draft, this edits the whole
 * MDX file as text — metadata block included — so it preserves fields Friday
 * doesn't model (image, published, date) and the existing slug. The brand voice
 * still applies, so revisions stay in character. Returns the full updated MDX.
 */
export async function revisePost(
  brand: Brand,
  currentMarkdown: string,
  feedback: string,
): Promise<string> {
  const system =
    (await draftSystemPrompt(brand)) +
    "\n\nYou are REVISING an existing post, not writing a new one. Return the COMPLETE " +
    "updated MDX file and nothing else — no preamble, no code fences. Preserve the " +
    "`export const metadata = {...}` block's shape and keep keys like image, published, " +
    "and date unless the feedback explicitly asks to change them. Keep the single H1 in " +
    "the body. Apply exactly what the feedback asks and leave everything else untouched.";

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system,
    messages: [
      {
        role: "user",
        content:
          `Current post:\n\n${currentMarkdown}\n\n---\n` +
          `Revise it per this feedback:\n\n${feedback}`,
      },
    ],
  });

  const block = response.content.find((b) => b.type === "text");
  const revised = block?.type === "text" ? stripFence(block.text.trim()) : "";
  if (!revised) {
    throw new Error(`Revise failed (stop_reason: ${response.stop_reason})`);
  }
  return revised;
}
