# yt-briefing

Save hours on YouTube. yt-briefing watches the channels you follow so you don't have to. It
turns each new video into a short summary in your own language that keeps what matters and
skips the filler. Reading it takes a fraction of the time the video would, so you stay on top
of everything and only watch what's actually worth it.

It also gets better the more you use it. You give each summary a quick rating, worth my time
or not, and from that it learns what to keep showing you and what to drop. Over time the queue
becomes yours: less noise, more of what you care about.

## First run vs later

On a channel's first sweep there is no history, so yt-briefing takes the latest video of each
kind: the newest long-form, the newest short, and the newest live. That gives you a baseline
without pulling the whole back catalog.

After that it works from history. Each rating moves a per-type cursor forward, so later runs
only surface videos newer than the ones you already handled, and a session just continues where
the last one left off.

## Setup

You'll need Node 18+ or Bun, a YouTube Data API v3 key, an LLM key (a
[free Gemini key](https://aistudio.google.com/apikey) works, see [Providers](#providers)), and
a tool that runs skills: [Claude Code](https://claude.com/claude-code),
[Cursor](https://cursor.com), [Codex](https://developers.openai.com/codex), or anything else
that loads the standard `SKILL.md` (Agent Skills — 30+ agents).

1. Install yt-dlp (it pulls the subtitles):

| OS | Command |
|----|---------|
| macOS | `brew install yt-dlp` |
| Windows | `winget install yt-dlp` |
| Linux / any Python | `pipx install yt-dlp` |

Keep it current with `yt-dlp -U`. YouTube changes often.

2. Add the package with any package manager:

```bash
npm  i   yt-briefing
pnpm add yt-briefing
yarn add yt-briefing
bun  add yt-briefing
```

3. Onboard:

```bash
npx yt-briefing init      # or: bunx yt-briefing init
```

`init` asks for your language, your keys, the channels to follow, and which tool runs `/yt`.

Add or remove channels anytime:

```bash
npx yt-briefing add @handle https://youtube.com/@another   # one or more, handle or URL
npx yt-briefing remove @handle                              # also deletes its learned profile
npx yt-briefing list                                        # show the current list
```

## One-off: transcribe a single video

Just want one video summarized — no channels, no queue, no rating? Run `/yt-transcribe` and
paste a URL or video ID. It pulls that video's transcript and writes a journalist-grade
summary in the language you chose at setup (the same `output_lang` as `/yt`). Want a one-off in
another language? Just say so when you run it (e.g. `/yt-transcribe <url> in German`) — it
won't change your setup. `--lang pl|en` is separate — it picks which caption track to fetch,
not the summary language.

The skill is installed alongside `/yt` by `init` / `install-skill`. From the plain CLI:

```bash
npx yt-briefing transcribe <url-or-id> --lang auto   # prints the transcript to stdout
```

## Search within a channel

Mine one channel's videos for a topic and get a comparison. Run `/yt-search` with a channel and
an intent — e.g. `/yt-search @betterstack which terminal for AI coding`.

It covers the channel's **whole history** (not just recent uploads), re-ranks every upload against
your intent, then lazily yields one matching video at a time to keep or skip — and synthesizes a
comparison from everything you kept.

The one flag is `--top N` — how many of the top re-ranked matches to triage (**default 10**). Raise
it to go deeper, lower it for a quicker pass: `/yt-search @betterstack which terminal --top 20`.

## Run it

Open your project in Claude Code or Cursor and run `/yt`. If it's not listed, start a fresh
session. To install the skills again for another tool or project, run
`npx yt-briefing install-skill` (it installs `/yt`, `/yt-transcribe`, and `/yt-search`).

## Providers

Any OpenAI-compatible endpoint works. Gemini 2.5 Flash is the easy default. It's fast, cheap,
and free to start at [Google AI Studio](https://aistudio.google.com/apikey):

```ini
YT_BRIEFING_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
YT_BRIEFING_LLM_API_KEY=<gemini-key>
YT_BRIEFING_LLM_MODEL=gemini-2.5-flash
```

> On the free tier Gemini sometimes returns a "model is overloaded / high demand" error. Retry,
> or switch to a paid key (enable billing, same model) to avoid it.

Want something else? Change those three lines for OpenRouter (`https://openrouter.ai/api/v1`),
OpenAI (`https://api.openai.com/v1`), or a local Ollama (`http://localhost:11434/v1`).

### Where the keys live

The contract is the environment — every `YT_BRIEFING_*` variable is read from `process.env`,
so put them wherever you keep secrets:

- **Your project's root `.env`** (recommended) — the conventional, single home for a project's
  secrets. yt-briefing only ever *reads* it, so it can't clobber your other variables.
- **Exported in the shell / CI** — anything already in the environment wins.
- **`bun run init`** — the wizard writes a self-contained `.yt-briefing/.env` (gitignored) for you.

Precedence: **exported env → root `.env` → `.yt-briefing/.env`**. Set a variable in more than one
place and the higher-precedence one wins, so a key in your root `.env` overrides the wizard's copy.

## Why an API, not the agent's native model

The filtering and the summaries go through a plain OpenAI-compatible API call from the engine,
not through the coding agent's own model. Two reasons.

Speed. The engine works ahead in the background. It expands channels in parallel and starts
summarizing the next video while you rate the current one, so the following step is usually
ready with no wait. An agent's turn-by-turn loop cannot prefetch like that, and every step pays
its own cold start, which adds up across a whole queue.

Compatibility. A standard API plus a standard `SKILL.md` means one engine runs everywhere: Claude
Code, Cursor, Codex, any other Agent-Skills-compatible tool, or the plain CLI. A tool-native
approach would tie it to that one tool and one model.

## Why one transcript at a time

yt-briefing pulls transcripts lazily. It fetches the one you are about to read, warms the next
one in the background while you rate, and stops there. It never grabs the whole queue up front.

That pacing is deliberate. Pulling many transcripts in a quick burst looks like scraping to
YouTube and gets your IP rate-limited or blocked, which is easy to hit on a server. Fetching
them at the speed you actually work through the queue keeps you under the radar and the queue
flowing.

## Sync across machines

Your state is plain files in `.yt-briefing/data/`. Version that folder (or point `YT_BRIEFING_DATA_DIR`
at a separate private repo) and commit after each rating. Recipe:
[docs/sync-across-machines.md](./docs/sync-across-machines.md).

## Running on a VPS

YouTube blocks datacenter IPs, so transcript fetches fail on most servers. Route them through a
free Cloudflare WARP proxy. See [docs/warp-proxy.md](./docs/warp-proxy.md).

## License

MIT, see [LICENSE](./LICENSE).
