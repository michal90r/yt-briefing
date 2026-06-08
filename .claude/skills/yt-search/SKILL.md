---
name: yt-search
description: Search WITHIN one YouTube channel by intent — name a channel and what you're after; the engine lists that channel's uploads, ranks them against your intent (metadata only, no transcript yet), then lazily yields ONE matching video at a time with a rich summary. You keep or skip each; at the end it synthesizes a comparison from everything you kept. Channel-scoped, not whole-YouTube. Same transcript engine + proxy as /yt; lazy on purpose (no transcript bursts → no IP block). Summaries and prompts use the language chosen at onboarding.
argument-hint: A channel (@handle or URL) and a descriptive intent, e.g. "@t3dotgg which terminal for AI coding". Optional --top N (default 10), --scan N, --since YYYY-MM-DD.
---

## How it works

`src/yt-search.ts` is the whole engine: list one channel's uploads (cheap — `playlistItems`, ~1 quota unit/page; NOT `search.list`) → re-rank them against your intent on metadata only (title/description, no transcript) → **lazy** one-candidate-at-a-time yield with a rich summary → record keep/skip → on demand synthesize a comparison from everything kept. **Channel-scoped on purpose** — you choose where to look; it does NOT search all of YouTube. Matching is descriptive: the LLM filters the channel's videos by intent. This skill is a thin loop — paste the summary, collect keep/skip, show the final comparison.

**Lazy on purpose:** one transcript per step, never a burst — a burst looks like scraping and gets the IP blocked (same reason `/yt` is lazy). Run the engine bare — stdout is a single JSON line, stderr empty; never redirect.

## Inputs

The user gives a **channel** (`@handle` or a channel URL) and an **intent** (what to look for). Pass the channel via `--channel` and the intent as the quoted positional. If the user names a channel but no clear intent (or vice versa), ask for the missing half before running.

## Language

Read `data/config.json` → `output_lang` once at the start. Phrase the question text and option descriptions in that language. The two button labels stay the short English words `Keep` / `Skip`. Summaries and the final comparison are already written in `output_lang` by the engine — paste them verbatim.

## Loop

```
out = JSON.parse(`bun run src/yt-search.ts "<intent>" --channel <@handle|url> --reset`)   // first call
while true:
  out.status:
    "error"           → show out.error verbatim, stop
    "no_results"      → tell the user nothing in that channel matched, stop
    "rate_limited"    → transcript fetch blocked (datacenter IP) — tell the user, stop; recovery in README.md → Running on a VPS
    "decision_needed" → steps A–C
    "done"            → step D
```

**On `decision_needed`:**

- **A.** Take `out.summary` (markdown) and `out.pending` (`{videoId,title,channelTitle,publishedAt,position,total}`).
- **B.** In the SAME turn, as your chat text (NOT command output — the UI doesn't show it), paste `summary` **verbatim** — no paraphrase, no shortening. Optionally prefix one line like `Wynik {position}/{total}`. The user must see it before the popup.
- **C.** In the same message call `AskUserQuestion` — 1 call, 1 question, phrased in `output_lang`:
  - Question e.g. "Brać pod uwagę w porównaniu?" with two options: **Keep** = include this video in the final comparison; **Skip** = drop it.
  - **Other** is the stop channel: if the user types `stop` (case-insensitive, trimmed) or dismisses the popup (✕) → **end the loop early** and go to step D (compare what's kept so far).
  - Then act:
    - Keep → `bun run src/yt-search.ts --keep`
    - Skip → `bun run src/yt-search.ts --skip`
    - stop/dismissed → `bun run src/yt-search.ts --compare` (skip straight to D)
  - The script reads the pending candidate from cache; pass only `--keep` / `--skip` / `--compare` (no channel/intent again). Its JSON becomes the next `out` — back to the top of the loop.

**On `done` (step D):**

- If `out.kept > 0` → run `out = JSON.parse(\`bun run src/yt-search.ts --compare\`)`; when it returns `status:"compare"`, paste `out.comparison` **verbatim** as your chat text (the artifact — a decision-grade comparison in `output_lang`). Stop.
- If `out.kept == 0` → tell the user nothing was kept, so there's nothing to compare. Stop.

## Rules

- **Verbatim:** paste `summary` and `comparison` exactly as returned; never paste a raw transcript.
- **Language:** question text + option descriptions follow `output_lang`; button labels stay `Keep` / `Skip`.
- **Scope:** one channel per search. Listing is cheap; the cost is the lazy transcript fetches, so let the user keep/skip rather than pulling everything. A bare resume (no `--reset`) continues the same ranked queue. `--scan N` (default 50) caps how many recent uploads are considered; `--since` widens by date.
- **Stateless triage:** independent of `/yt` (no channel profiles, no ratings written). For the recurring multi-channel briefing use `/yt`; for one known video use `/yt-transcribe`.
