# yt-briefing

Save hours on YouTube. yt-briefing watches the channels you follow so you don't have to. It
turns each new video into a short summary in your own language that keeps what matters and
skips the filler. Reading it takes a fraction of the time the video would, so you stay on top
of everything and only watch what's actually worth it.

It also gets better the more you use it. You give each summary a quick rating, worth my time
or not, and from that it learns what to keep showing you and what to drop. Over time the queue
becomes yours: less noise, more of what you care about.

## Setup

You'll need Node 18+ or Bun, a YouTube Data API v3 key, an LLM key (a
[free Gemini key](https://aistudio.google.com/apikey) works, see [Providers](#providers)), and
a tool that runs skills: [Claude Code](https://claude.com/claude-code),
[Cursor](https://cursor.com), or anything else that loads `SKILL.md`.

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

## Run it

Open your project in Claude Code or Cursor and run `/yt`. If it's not listed, start a fresh
session. To install the skill again for another tool or project, run
`npx yt-briefing install-skill`.

## Providers

Any OpenAI-compatible endpoint works. Gemini 2.5 Flash is the easy default. It's fast, cheap,
and free to start at [Google AI Studio](https://aistudio.google.com/apikey):

```ini
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_API_KEY=<gemini-key>
LLM_MODEL=gemini-2.5-flash
```

> On the free tier Gemini sometimes returns a "model is overloaded / high demand" error. Retry,
> or switch to a paid key (enable billing, same model) to avoid it.

Want something else? Change those three lines for OpenRouter (`https://openrouter.ai/api/v1`),
OpenAI (`https://api.openai.com/v1`), or a local Ollama (`http://localhost:11434/v1`).

## Why an API, not the agent's native model

The filtering and the summaries go through a plain OpenAI-compatible API call from the engine,
not through the coding agent's own model. Two reasons.

Speed. The engine works ahead in the background. It expands channels in parallel and starts
summarizing the next video while you rate the current one, so the following step is usually
ready with no wait. An agent's turn-by-turn loop cannot prefetch like that, and every step pays
its own cold start, which adds up across a whole queue.

Compatibility. A standard API plus a small skill means one engine runs everywhere: Claude Code,
Cursor, any other tool that loads a skill, or the plain CLI. A tool-native approach would tie it
to that one tool and one model.

## Why one transcript at a time

yt-briefing pulls transcripts lazily. It fetches the one you are about to read, warms the next
one in the background while you rate, and stops there. It never grabs the whole queue up front.

That pacing is deliberate. Pulling many transcripts in a quick burst looks like scraping to
YouTube and gets your IP rate-limited or blocked, which is easy to hit on a server. Fetching
them at the speed you actually work through the queue keeps you under the radar and the queue
flowing.

## Sync across machines

Your state is plain files in `.yt-briefing/data/`. Version that folder (or point `YT_DATA_DIR`
at a separate private repo) and commit after each rating. Recipe:
[docs/sync-across-machines.md](./docs/sync-across-machines.md).

## Running on a VPS

YouTube blocks datacenter IPs, so transcript fetches fail on most servers. Route them through a
free Cloudflare WARP proxy. See [docs/warp-proxy.md](./docs/warp-proxy.md).

## License

MIT, see [LICENSE](./LICENSE).
