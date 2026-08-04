# yt-briefing

[![npm](https://img.shields.io/npm/v/yt-briefing)](https://www.npmjs.com/package/yt-briefing)
[![license](https://img.shields.io/npm/l/yt-briefing)](./LICENSE)
[![node](https://img.shields.io/node/v/yt-briefing)](https://www.npmjs.com/package/yt-briefing)
[![mac](https://github.com/michal90r/yt-briefing/actions/workflows/ci-mac.yml/badge.svg)](https://github.com/michal90r/yt-briefing/actions/workflows/ci-mac.yml)
[![ubuntu](https://github.com/michal90r/yt-briefing/actions/workflows/ci-ubuntu.yml/badge.svg)](https://github.com/michal90r/yt-briefing/actions/workflows/ci-ubuntu.yml)
[![windows](https://github.com/michal90r/yt-briefing/actions/workflows/ci-windows.yml/badge.svg)](https://github.com/michal90r/yt-briefing/actions/workflows/ci-windows.yml)

Save hours on YouTube. yt-briefing watches the channels you follow so you don't have to. For
each new video it gives you a short briefing in your own language — every point that matters, with
only the filler cut, so nothing important is lost. Reading it takes a fraction of the time the
video would, so you stay on top of everything and only watch what's actually worth it.

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

3. Put your keys in a `.env` at your project root — all four are required:

```ini
YT_BRIEFING_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
YT_BRIEFING_LLM_API_KEY=<key>        # free at https://aistudio.google.com/apikey
YT_BRIEFING_LLM_MODEL=gemini-2.5-flash
YT_BRIEFING_YOUTUBE_API_KEY=<key>    # console.cloud.google.com → enable "YouTube Data API v3"
```

Any OpenAI-compatible endpoint works — see [Providers](#providers) to use OpenRouter, OpenAI,
Anthropic, or a local Ollama instead of Gemini. `YT_BRIEFING_PROXY` (datacenter/VPS IPs) is the
only optional extra.

4. Onboard:

```bash
npx yt-briefing init      # or: bunx yt-briefing init
```

`init` asks for your language, the channels to follow, and which tool runs `/yt`.

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

For example:

```
/yt-transcribe https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

## Search within a channel

Mine one channel's videos for a topic and get a comparison. Run `/yt-search` with a channel and
an intent — for example:

```
/yt-search @betterstack which terminal for AI coding
```

It covers the channel's **whole history** (not just recent uploads), re-ranks every upload against
your intent, then lazily yields one matching video at a time to keep or skip — and synthesizes a
comparison from everything you kept.

The one flag is `--top N` — how many of the top re-ranked matches to triage (**default 10**). Raise
it to go deeper, lower it for a quicker pass:

```
/yt-search @betterstack which terminal
/yt-search @betterstack which terminal --top 5
```

## Don't shelve it — research it

Tech channels announce something new every week, and the usual fate is "looks interesting" →
to-do list → never. So the rating popup has a third option next to OK/Weak: **Research**. Pick
it — or type `? your question` straight into the comment box — and the loop ends there: the
agent pulls that video's full transcript and works your question with you. Against your own
codebase if you ask "would this fit my project", against the web if the claims need checking —
a quick feedback loop instead of a shelf. The video is marked as seen, and the next `/yt`
resumes the queue right where you broke off.

## Run it

Open your project in Claude Code or Cursor and run `/yt`. If it's not listed, start a fresh
session. To install the skills again for another tool or project, run
`npx yt-briefing install-skill` (it installs `/yt`, `/yt-transcribe`, and `/yt-search`).

## Rating gate

The loop only works if you see the summary *before* you rate it, and that is the one step an
agent can silently drop — the popup still appears, you still answer, and the rating is recorded
against a summary nobody read. On Claude Code the installer wires a `PreToolUse` hook into your
project's `.claude/settings.json` that refuses the rating popup unless the video's summary is in
the chat. It merges with your existing hooks and updates itself on reinstall. If that file isn't
valid JSON the installer leaves it alone and says so — add the entry yourself:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "AskUserQuestion",
        "hooks": [ { "type": "command", "command": "node \"node_modules/yt-briefing/dist/yt-summary-gate.js\"" } ] }
    ]
  }
}
```

Other agents have no equivalent hook, so there the instruction in `SKILL.md` is what holds.

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
OpenAI (`https://api.openai.com/v1`), Anthropic (`https://api.anthropic.com/v1/`,
e.g. `claude-sonnet-5`), or a local Ollama (`http://localhost:11434/v1`). Set
`YT_BRIEFING_LLM_BASE_URL`, `_API_KEY`, and `_MODEL` in your root `.env` (see [Setup](#setup)).

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
