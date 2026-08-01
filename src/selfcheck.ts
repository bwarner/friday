import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import type { Brand } from "./brands";
import { log } from "./logger";

/**
 * The M2 safety gate — an automated review that runs BEFORE content can leave
 * the laptop.
 *
 * Placement matters: `publish` commits the file to the blog repo and opens a
 * PR, which puts the content into remote git history *before* human review of
 * the PR. A leaked secret at that point is exposed even if the PR is never
 * merged. So the authoritative check runs at publish, on the exact markdown
 * bytes about to be committed — not on the in-memory Draft object — which also
 * covers files edited by `revise`, `image`, or by hand after drafting.
 * Draft/revise run the same check purely as early feedback.
 */
export const CheckSchema = z.object({
  ok: z.boolean().describe("true only if there are no block-severity issues"),
  issues: z
    .array(
      z.object({
        severity: z
          .enum(["block", "warn"])
          .describe("block = must not be committed/published; warn = human should glance"),
        note: z.string().describe("Short, specific description of the problem"),
      }),
    )
    .describe("Empty if the content is clean"),
});

export type Check = z.infer<typeof CheckSchema>;

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

/**
 * Review the full markdown (metadata block included) for publish-blocking
 * problems. Fails closed: if the check errors or returns nothing, the result
 * is a blocking issue, never a silent pass.
 */
export async function selfCheck(brand: Brand, markdown: string): Promise<Check> {
  try {
    const response = await client.messages.parse({
      model: "claude-haiku-4-5",
      max_tokens: 2000,
      system:
        `You review a blog post for ${brand.name} immediately before it is committed to a ` +
        `public git repository. The commit is irreversible exposure, so be strict.\n\n` +
        `Flag as "block":\n` +
        `- Anything that looks like a REAL credential: API keys, tokens, private keys, ` +
        `passwords, connection strings (e.g. sk-..., ghp_..., AKIA..., -----BEGIN ... KEY-----).\n` +
        `- Real personal data: non-public names, emails, phone numbers, addresses, internal ` +
        `hostnames or IPs.\n` +
        `- Defamatory, legally risky, or unverifiable accusatory claims about real people or ` +
        `companies.\n` +
        `- Content clearly wrong for this brand's audience or voice.\n\n` +
        `Do NOT block clearly fictional examples: placeholder keys (sk-..., xxx, <YOUR_KEY>), ` +
        `invented companies/people, example.com-style domains, or illustrative attack payloads ` +
        `— this brand writes security content and such examples are expected. When a value is ` +
        `plausibly real (correct format, high entropy, no placeholder markers), block it.\n\n` +
        `Flag as "warn" sparingly: genuine quality problems a human should glance at ` +
        `(an unsupported factual claim, a broken metadata field). Not style nits.\n\n` +
        `Brand voice for reference: ${brand.voice}`,
      messages: [{ role: "user", content: markdown }],
      output_config: { format: zodOutputFormat(CheckSchema) },
    });

    if (!response.parsed_output) {
      return {
        ok: false,
        issues: [{ severity: "block", note: "self-check returned no result — failing closed" }],
      };
    }
    // Never trust ok=true alongside block issues; recompute from the issues.
    const hasBlock = response.parsed_output.issues.some((i) => i.severity === "block");
    return { ...response.parsed_output, ok: !hasBlock };
  } catch (err) {
    log.error("self-check errored — failing closed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      issues: [{ severity: "block", note: "self-check errored — failing closed" }],
    };
  }
}

/** Print check issues to the console; returns true if publishing may proceed. */
export function reportCheck(check: Check, context: string): boolean {
  for (const issue of check.issues) {
    const line = `[self-check] ${issue.severity}: ${issue.note}`;
    if (issue.severity === "block") console.error(`  ✗ ${line}`);
    else console.warn(`  ⚠ ${line}`);
  }
  if (!check.ok) {
    console.error(`\n  ✗ Self-check blocked ${context}.\n`);
  }
  return check.ok;
}
