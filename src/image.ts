import Anthropic from "@anthropic-ai/sdk";
import type { Brand } from "./brands";
import { log } from "./logger";

/**
 * The "imagery" half of the pipeline (M4) — hero-image generation.
 *
 * Friday uses Anthropic for *language* and a best-of-breed provider for
 * *pixels*. The provider is pluggable: Claude (Haiku) crafts a concrete,
 * text-free art prompt from the finished post, then the provider selected by
 * IMAGE_PROVIDER renders it. Adding a vendor = one adapter in PROVIDERS;
 * nothing downstream (render, publish, CLI) knows which backend ran.
 */
export interface GeneratedImage {
  bytes: Buffer;
  ext: "png";
}

interface ImageProvider {
  id: string;
  /** Render a single landscape hero image from a finished prompt. */
  generate(prompt: string): Promise<GeneratedImage>;
}

/** Strip an optional `data:image/...;base64,` prefix some providers prepend. */
function decodeB64(b64: string): Buffer {
  const comma = b64.indexOf(",");
  const raw = b64.startsWith("data:") && comma !== -1 ? b64.slice(comma + 1) : b64;
  return Buffer.from(raw, "base64");
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set — required for the selected image provider.`);
  return v;
}

// ---- OpenAI: gpt-image-1 -------------------------------------------------
// POST https://api.openai.com/v1/images/generations
// gpt-image-1 always returns base64 in data[0].b64_json (no response_format).
// Landscape 1536x1024 crops cleanly to the ~1200x630 OG ratio.
const openai: ImageProvider = {
  id: "openai",
  async generate(prompt) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1536x1024", n: 1 }),
    });
    if (!res.ok) throw new Error(`OpenAI image error ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { data: Array<{ b64_json: string }> };
    return { bytes: decodeB64(json.data[0].b64_json), ext: "png" };
  },
};

// ---- Google: Imagen 4 ----------------------------------------------------
// POST .../models/imagen-4.0-generate-001:predict ; key in x-goog-api-key.
// Image bytes in predictions[0].bytesBase64Encoded.
const google: ImageProvider = {
  id: "google",
  async generate(prompt) {
    const model = "imagen-4.0-generate-001";
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": requireEnv("GOOGLE_API_KEY"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { sampleCount: 1, aspectRatio: "16:9" },
        }),
      },
    );
    if (!res.ok) throw new Error(`Google Imagen error ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as {
      predictions: Array<{ bytesBase64Encoded: string }>;
    };
    return { bytes: decodeB64(json.predictions[0].bytesBase64Encoded), ext: "png" };
  },
};

// ---- xAI: grok-2-image ---------------------------------------------------
// POST https://api.x.ai/v1/images/generations ; data[0].b64_json.
// No size / aspect-ratio controls on this model.
const xai: ImageProvider = {
  id: "xai",
  async generate(prompt) {
    const res = await fetch("https://api.x.ai/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireEnv("XAI_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "grok-2-image", prompt, n: 1, response_format: "b64_json" }),
    });
    if (!res.ok) throw new Error(`xAI image error ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { data: Array<{ b64_json: string }> };
    return { bytes: decodeB64(json.data[0].b64_json), ext: "png" };
  },
};

const PROVIDERS: Record<string, ImageProvider> = { openai, google, xai };

function selectProvider(): ImageProvider {
  const id = (process.env.IMAGE_PROVIDER ?? "openai").toLowerCase();
  const provider = PROVIDERS[id];
  if (!provider) {
    throw new Error(
      `Unknown IMAGE_PROVIDER "${id}". Known: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }
  return provider;
}

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env

/**
 * Turn a finished post into a concrete, text-free art prompt. Anthropic does
 * the concept; the image provider does the pixels. Falls back to a
 * deterministic prompt if the model call fails, so image gen never blocks.
 */
async function craftImagePrompt(
  brand: Brand,
  title: string,
  description: string,
): Promise<string> {
  const base =
    `Editorial hero image for a blog post titled "${title}". ${description} ` +
    `${brand.imageStyle} ` +
    `Absolutely no text, no words, no letters, no logos, no watermarks. ` +
    `16:9 landscape composition with a clear focal subject and breathing room for cropping.`;
  try {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 320,
      system:
        "You write prompts for a text-to-image model. Output ONLY the prompt: one vivid, " +
        "concrete paragraph describing a single editorial illustration. The image must " +
        "contain no text, words, letters, or logos. No preamble, no quotes.",
      messages: [{ role: "user", content: base }],
    });
    const block = res.content.find((b) => b.type === "text");
    const crafted = block?.type === "text" ? block.text.trim() : "";
    return crafted || base;
  } catch (err) {
    log.warn("image prompt crafting failed — using deterministic prompt", {
      error: err instanceof Error ? err.message : String(err),
    });
    return base;
  }
}

/** Craft a prompt with Claude, then render the hero image via IMAGE_PROVIDER. */
export async function generateHeroImage(
  brand: Brand,
  title: string,
  description: string,
): Promise<GeneratedImage> {
  const provider = selectProvider();
  const prompt = await craftImagePrompt(brand, title, description);
  log.info("rendering hero image", { brand: brand.key, provider: provider.id });
  return provider.generate(prompt);
}
