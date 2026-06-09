# Friday

Personal AI agent platform. First capability: a **content/persona agent** that drafts
blog posts in your voice and publishes them by opening a pull request against the
GitHub-backed blog repos — so *you* stay the approval gate.

> Local-first. Runs from your laptop; the only external services are the Anthropic API
> and GitHub. Built to grow into travel/spend agents later (SellAvant stays separate).

## How it works

```
learn voice (from existing posts) ─────────────────┐           ← AUTO (M1)
                                                    ▼
ideate → draft in brand voice → (self-check) → drafts/*.mdx    ← all AUTO
                          generate hero image  → drafts/*.png   ← AUTO (M4)
                                              you review
        open PR to blog repo  →  you merge  →  live            ← GATE (you)
```

The PR *is* the draft queue: preview, history, and one-click rollback come free.

## Setup

```bash
corepack enable          # pnpm via package.json
pnpm install
cp .env.example .env      # fill in ANTHROPIC_API_KEY and GITHUB_TOKEN
```

`GITHUB_TOKEN` needs write access (Contents + Pull requests) on `scansafeguard-blog`
and `warnerware`.

## Use

```bash
# Learn a brand's voice from its existing posts (writes voice/<brand>.json)
pnpm friday voice scansafeguard

# Draft a post (writes to drafts/, publishes nothing). Uses the cached voice.
pnpm friday draft "why FBA sellers should pentest their stack" --brand scansafeguard

# Generate a hero image for the draft (writes drafts/<slug>.png, wires image: metadata)
pnpm friday image drafts/scansafeguard-<slug>.mdx --brand scansafeguard

# Review drafts/scansafeguard-*.mdx, then open a PR (the sibling .png rides along)
pnpm friday publish drafts/scansafeguard-<slug>.mdx --brand scansafeguard
```

`voice` is optional but recommended — without it, `draft` falls back to the brand's
base voice and logs a hint. Re-run `voice` whenever the blog gains new posts.

`image` is optional and opt-in (you only spend on art you want). It picks the provider
from `IMAGE_PROVIDER` (`openai` · `google` · `xai`) — Claude crafts a text-free art
prompt from the post, the provider renders a 16:9 hero, and it's committed into the same
PR as the post. Set the matching key in `.env` (`OPENAI_API_KEY` / `GOOGLE_API_KEY` /
`XAI_API_KEY`). Skip it and `publish` just opens the PR without an image.

Brands live in `src/brands.ts` — repo, content path, metadata shape, and voice.

## Post format — confirmed against both repos

Both blogs are **Next.js + MDX** (not Astro, no YAML frontmatter). Posts live in
`content/posts/*.mdx` and start with a JS metadata export parsed by regex in each
repo's `lib/content.ts`, followed by the H1 in the body:

```mdx
export const metadata = {
  title: "Post Title",
  description: "One-line summary",
  date: "YYYY-MM-DD",
  tags: ["tag-one", "tag-two"],
  published: true,
};

# Post Title

Body…
```

Required keys: `title`, `description`, `date`, `published`. Friday emits exactly this
shape (`src/render.ts` + `src/brands.ts`); `author` is left out by default, and `image`
is added by `friday image` when you generate a hero (otherwise omitted).

## Layout

```
src/
  cli.ts       voice · draft · image · publish commands
  agent.ts     content agent — drafts a post (Anthropic SDK, structured output)
  ingest.ts    pull + parse existing posts from a blog repo (Octokit, read-only)
  voice.ts     distill a per-brand voice profile, cache it, feed it to the draft step
  image.ts     pluggable hero-image generation (openai · google · xai)  ← M4
  brands.ts    brand registry (repo, path, metadata shape, voice, image style)
  github.ts    publish = open a PR (Octokit)  ← the approval gate
  render.ts    metadata export + H1 + body → MDX
  types.ts     Draft schema
  logger.ts    redacting logger (no secrets in logs)
```

Voice profiles are cached in `voice/<brand>.json` (gitignored — a local, regenerable
artifact).

## Roadmap

- **M0** scaffold + brand registry + redacting logger ✅ (this)
- **M1** voice ingestion: learn each blog's voice from existing posts ✅ (`friday voice`)
- **M2** draft pipeline ✅ (basic) → add a self-check pass (brand safety, no-secrets)
- **M3** PR publish ✅ (basic) → engagement pull-back
- **M4** hero imagery ✅ (`friday image`) — pluggable providers (OpenAI · Google · xAI)
- **M5** scheduling + idea backlog (node-cron locally; Upstash QStash when off-laptop)
- **M6** analytics loop, then fan out to travel / spend agents
