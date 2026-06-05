# yt-briefing

A self-learning briefing for the YouTube channels you follow. It sweeps each channel,
drops the noise in **two stages** (title first, then the actual transcript), summarizes
what's left **in your language**, and hands you one video at a time to rate. Your ratings
are written straight back into per-channel profiles, so the next sweep filters more like
you would. No feed, no algorithm — a queue that gets quieter the more you use it.

It is **provider-agnostic** (any OpenAI-compatible LLM endpoint) and has **no hard
dependency on any coding agent** — there's a CLI and a reference skill, and the core is
just a handful of Bun scripts.

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

- [**Bun**](https://bun.sh) ≥ 1.0
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

#### Prefer a project-local copy? (no global install)

If you'd rather not touch your global `PATH`, drop a standalone yt-dlp binary into this
package's `bin/` (gitignored) — the tool checks there before `PATH`. Pick the build for
your OS from the [latest release](https://github.com/yt-dlp/yt-dlp/releases/latest):

| OS / arch | Asset | Save as |
|-----------|-------|---------|
| macOS | `yt-dlp_macos` | `bin/yt-dlp` (`chmod +x`) |
| Linux x64 | `yt-dlp_linux` | `bin/yt-dlp` (`chmod +x`) |
| Linux arm64 | `yt-dlp_linux_aarch64` | `bin/yt-dlp` (`chmod +x`) |
| Windows | `yt-dlp.exe` | `bin\yt-dlp.exe` |

These are self-contained (no Python needed). Or point `YT_DLP_PATH` at an existing binary
anywhere — the lookup order is `YT_DLP_PATH` → `bin/yt-dlp` → `PATH`.

## Setup

```bash
bun install
bun run init     # interactive onboarding
```

`bun run init` asks for, and writes:

1. **Output language** for summaries and ratings → `data/config.json`.
2. **LLM + YouTube keys** (and optional proxy) → `.env`.
3. **The channels you follow** — each one's `@handle`, a **category**, and **what to pay
   attention to** in it → `data/channels.md`, `data/state.md`, and a profile per channel.

Everything it writes is plain Markdown / JSON under `data/` — see
[`data.example/`](./data.example/) for the layout and the profile template. Add or tune
channels later by editing those files; the filters pick up changes on the next sweep.

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
yt-briefing sweep --reset      # advance one step → prints a JSON status line
yt-briefing rate --rating 0    # record a rating for the pending video
# (or: bun run sweep --reset / bun run rate --rating 0)
```

`sweep` prints one of:
- `{"status":"rating_needed","summary":"<markdown>","pending":{…}}` — show the summary, decide a rating, call `rate`, then `sweep` again.
- `{"status":"done"}` — nothing left.
- `{"status":"rate_limited"}` — transcript fetch blocked (usually a datacenter IP — see [the proxy guide](./docs/warp-proxy.md)).

### As a reference skill (Claude Code & co.)

Copy [`skill/SKILL.md`](./skill/SKILL.md) into your agent's skills directory as
`yt-briefing/SKILL.md`, open this package as the working directory, and run `/yt-briefing`.
The skill is a thin loop around the same scripts: it pastes each summary, collects your
rating in one popup (in your configured language), and writes it back. This is the primary,
most pleasant way to use the tool.

## Architecture notes

- **One engine, lazy.** `src/yt-sweep.ts` does the whole sweep — filters, transcript,
  summary, skips — and yields **one** ratable video per invocation. The frontend has zero
  loop logic. For fast first paint it expands channels in **parallel waves** until it has
  the first ratable video (a detached child expands the rest in the background), and warms
  the *next* summary while you rate the current one.
- **No heavy SDK.** The YouTube Data API is reached over plain `fetch` (`src/lib/yt-api.ts`),
  not the monolithic `googleapis` package whose cold import dominated per-process startup.
- **Quiet by default.** `src/yt-sweep.ts` prints a pure JSON line on stdout (nothing on
  stderr), so callers never redirect to a temp file. Set `YT_DEBUG=1` for per-stage timings
  in the gitignored `<data>/.cache/sweep.log`.
- **Crash-safe cursor.** `data/state.md` is the only durable cursor; it's bumped per video.
  A crash before you rate just re-surfaces that one video next run. `data/.cache/` is
  throwaway session state.
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
