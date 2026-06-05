# yt-briefing

A briefing tool for the YouTube channels you follow. It sweeps each channel, filters videos
in **two stages** (title first, then the transcript), summarizes what's left **in your
language**, and hands you one video at a time to rate. Ratings are written back into
per-channel profiles, so the next sweep filters tighter.

Provider-agnostic (any OpenAI-compatible LLM endpoint), runtime-agnostic (**Node ≥ 18 or
Bun**, any package manager), and no hard dependency on a coding agent — a CLI and a reference
skill drive the same engine.

```
channel uploads ──► title filter ──► transcript ──► content filter ──► summary ──► you rate
   (YT Data API)     (cheap LLM,       (yt-dlp,       (LLM, substance      (your lang)   │
                      keep-by-default)   proxy-aware)   check + summary)                  │
        ▲                                                                                 │
        └───────────────  profile learns from rating=0 / comments  ◄─────────────────────┘
```

## Why two filters

The title filter is cheap and runs *before* fetching anything — it only learns **what to
skip** (it keeps by default), from the `## Skip titles` examples your `0` ratings produce.
The content filter reads the real transcript, checks it actually delivers what the title
promised (drops clickbait as `OFFTOPIC`), and writes the summary. Most channels post a mix
of signal and filler; this is how you read the signal without watching the filler.

## How the learning works

There is **no positive rating** — keeping a channel subscribed *is* the positive signal.
You only ever push down or steer:

| You answer | What happens |
|---|---|
| **OK** (`1`) | Neutral. Bumps the cursor, writes nothing. |
| **Weak** (`0`) | The title is appended to that channel's `## Skip titles` — the title filter learns to skip its kind next time. |
| a **comment** | Distilled into a durable rule in `## Notes`, which both filters read. |

Writes are **immediate and durable** — no batching or "consolidation" step. The profile is
plain Markdown you can also edit by hand.

## Requirements

- A JavaScript runtime: **[Node.js](https://nodejs.org) ≥ 18** *or* **[Bun](https://bun.sh) ≥ 1.0**
  (install the package with any manager — npm, pnpm, yarn, or bun).
- [**yt-dlp**](https://github.com/yt-dlp/yt-dlp) — extracts the subtitles. See the install
  table below.
- An **OpenAI-compatible LLM key** — a [free Gemini key](https://aistudio.google.com/apikey)
  is enough to start; OpenRouter, OpenAI, or a local Ollama also work. See
  [Choosing a provider](#choosing-a-provider).
- A **YouTube Data API v3 key** (to list channel uploads).

### Installing yt-dlp

yt-dlp is a standalone program (not an npm package), so it's installed separately — once,
system-wide:

| OS | Command |
|----|---------|
| **macOS** | `brew install yt-dlp` |
| **Windows** | `winget install yt-dlp` &nbsp;(or `scoop install yt-dlp`, or `choco install yt-dlp`) |
| **Linux** | `pipx install yt-dlp` &nbsp;(or your distro's package, e.g. `sudo pacman -S yt-dlp`) |
| **Any OS with Python** | `pipx install yt-dlp` — works everywhere |

Verify it's reachable:

```bash
yt-dlp --version
```

Keep it current — YouTube changes often and yt-dlp ships fixes fast:

```bash
yt-dlp -U
```

## Setup

```bash
bun add yt-briefing        # or:  npm i yt-briefing  ·  pnpm add yt-briefing  ·  yarn add yt-briefing
bunx yt-briefing init      # interactive onboarding   (npm: npx yt-briefing init)
```

**No build step** — the package ships ready to run; `init` works under whatever runtime you
have (Node or Bun). Run it **from your project's root**: your keys and state go to
**`<your project>/.yt-briefing/`**, *not* into `node_modules` — so they survive `bun update` /
`npm update`.

`init` walks you through, and writes into `.yt-briefing/`:

1. **Output language** for summaries and ratings → `.yt-briefing/data/config.json`.
2. **LLM + YouTube keys** (and optional proxy) → `.yt-briefing/.env`.
3. **The channels you follow** — just a **list**. Paste each in whatever form you have —
   `@betterstack`, `betterstack`, or the full URL `https://www.youtube.com/@betterstack`
   (the URL works as-is — it reads the handle for you); empty line to finish. **No rules to
   define up front** — each channel's profile *learns* what to skip from your ratings as you
   watch (`## Skip titles` / `## Notes`).
4. **Which agent runs `/yt`** — pick Claude Code or Cursor and it installs the skill **into
   your project** (`.claude/skills/yt` or `.cursor/skills/yt`), or **Custom folder** for any
   other agent. No machine-wide global install.

Everything it writes is plain Markdown / JSON under `.yt-briefing/data/`. Add or remove
channels later by editing `.yt-briefing/data/channels.md` (a flat list); the filters pick up
changes on the next sweep.

## Choosing a provider

The LLM call is plain OpenAI-compatible Chat Completions, so the same code runs against
any provider that speaks it — you only change three lines in `.env`. **One model handles
both stages** (title filtering + summaries); no separate summary model to configure.

**Recommended: Gemini 2.5 Flash for everything** — cheap and fast enough for the batch
title filter, capable enough for the summaries. Typical personal usage is a few cents a
month, and there's a **free path** (see below) — so the only real setup cost is grabbing
one key.

> **Cheapest start — free, no credit card.** Get a free Gemini key from
> [Google AI Studio](https://aistudio.google.com/apikey) and use the *Gemini, direct*
> block below. The free tier is rate-limited but comfortably covers a personal daily
> sweep. No OpenRouter account, no card.
>
> **Heads-up — the free tier shares capacity.** On a free Gemini key you may occasionally
> get a *"the model is overloaded / high demand"* error (HTTP 429/503) when Google's shared
> free pool is busy. Just retry in a moment. If it keeps happening, switch to a **paid** key
> (enable billing in Google AI Studio, same `LLM_MODEL`) — paid requests don't hit that pool,
> so the error goes away.

```ini
# Gemini, direct (Google's OpenAI-compatible endpoint) — works with a FREE AI Studio key
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_API_KEY=<gemini-key>                  # free: https://aistudio.google.com/apikey
LLM_MODEL=gemini-2.5-flash
```

```ini
# OpenRouter (one key for Gemini *and* GPT *and* others — needs an account)
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-...
LLM_MODEL=google/gemini-2.5-flash        # or openai/gpt-4o, anthropic/claude-..., etc.
```

```ini
# OpenAI, direct (GPT)
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o
```

Local models work too — point `LLM_BASE_URL` at a running Ollama
(`http://localhost:11434/v1`). To switch models, just change `LLM_MODEL`.

## Run it

### As a CLI

```bash
bunx yt-briefing sweep --reset      # advance one step → prints a JSON status line
bunx yt-briefing rate --rating 0    # record a rating for the pending video
# npm:  npx yt-briefing sweep --reset   ·   npx yt-briefing rate --rating 0
```

`sweep` prints one of:
- `{"status":"rating_needed","summary":"<markdown>","pending":{…}}` — show the summary, decide a rating, call `rate`, then `sweep` again.
- `{"status":"done"}` — nothing left.
- `{"status":"rate_limited"}` — transcript fetch blocked (usually a datacenter IP — see [the proxy guide](./docs/warp-proxy.md)).

### As a skill (Claude Code & Cursor)

The skill is **not a program** — it's a Markdown instruction file your **coding agent reads
and follows**, driving the same CLI under the hood. `init` (step 4) installs it into your
project for the agent you pick. Both **[Claude Code](https://claude.com/claude-code)** and
**[Cursor](https://cursor.com)** (2.4+) load `SKILL.md` skills and invoke them as `/yt`.

1. Open **your project** (where you ran `init`) in Claude Code or Cursor.
2. Make sure onboarding is done (`init`) and [Requirements](#requirements) are met
   (Node or Bun, yt-dlp, an LLM key, a YouTube key).
3. Start a session and run **`/yt`**. (Short by design; `yt-briefing` is only the CLI name.)

Skills are scanned at session start, so if `/yt` isn't listed, **start a fresh session**. To
(re)install it — for Cursor's `.cursor/skills/`, another project, or a second agent — run
**`yt-briefing install-skill`**: pick the agent and the project. It's always **project-scoped
— no machine-wide global install**. The skill shows each summary and takes your rating in one
step (a popup in Claude Code, a chat question in Cursor), then writes it back.

> Other agents without a skill system: use the **CLI** — `yt-briefing sweep` / `rate` drive
> the exact same engine and ratings. Nothing about the tool *requires* an agent.

## Sync across machines (multi-device)

All your state is plain files in the data dir (`channels.md`, `state.md`, and the per-channel
profiles where ratings accumulate). The engine never touches git, so syncing two machines
(e.g. a laptop + a VPS / remote session) is just *"version the data dir and commit after each
rating."* Point `YT_DATA_DIR` at a **private git repo**, add a `.gitattributes` so profiles
**union-merge** (both machines' ratings kept), and wire a small hook that commits → pushes →
and on a rejected push **rebases and retries** instead of silently dropping a rating.

Full recipe — repo setup, the ready-to-copy `yt-sync.sh` hook (agent `PostToolUse` *or* CLI),
and the multi-writer safety rules — is in **[docs/sync-across-machines.md](./docs/sync-across-machines.md)**.
(`.env` never syncs — secrets stay per machine; the throwaway `.cache/` is ignored too.)

## Architecture notes

- **One engine, lazy.** A single sweep does the whole thing — filters, transcript, summary,
  skips — and yields **one** ratable video per invocation. For fast first paint it expands
  channels in **parallel waves** until it has the first ratable video (a detached child
  expands the rest in the background), and warms the *next* summary while you rate the current.
- **No heavy SDK.** The YouTube Data API is reached over plain `fetch`, not the monolithic
  `googleapis` package whose cold import dominated per-process startup.
- **Quiet by default.** The sweep prints a pure JSON line on stdout (nothing on stderr), so
  callers never redirect to a temp file. Set `YT_DEBUG=1` for per-stage timings in the
  gitignored `.yt-briefing/data/.cache/sweep.log`.
- **Crash-safe cursor.** `state.md` is the only durable cursor; it's bumped per video. A crash
  before you rate just re-surfaces that one video next run. `.cache/` is throwaway session state.
- **One model, both stages.** The same `LLM_MODEL` classifies titles (a cheap batch call)
  and writes summaries. Gemini 2.5 Flash by default; swap it for anything via `.env`.
- **Your data is yours.** The engine never touches git or any network beyond the LLM and
  YouTube APIs. Want versioned briefing state? Point `YT_DATA_DIR` at a folder you commit.

## Reliability & security

- **yt-dlp breaks when YouTube changes.** It's the most fragile link; keep it updated
  (`yt-dlp -U`). The engine distinguishes *no captions* (skip) from *fetch failure* (surfaced
  loudly) from *rate-limited* (retry later) so a broken fetch is never silently mislabeled.
- **Transcripts are untrusted input.** They go to the LLM as plain content, and the LLM call
  has **no tool access** — it can only return text. A prompt-injection attempt in a
  transcript can at worst produce a bad summary, never run anything.
- **Secrets live in `.env`** (gitignored). The wizard writes them there; nothing is logged.

## License

MIT — see [LICENSE](./LICENSE).
