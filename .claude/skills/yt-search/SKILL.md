---
name: yt-search
description: Research a topic across YouTube — describe an intent, the engine expands it into search queries, ranks results against your intent, then lazily yields ONE video at a time with a rich summary. You keep or skip each; at the end it synthesizes a comparison from everything you kept. Same transcript engine + proxy as /yt; lazy on purpose (no transcript bursts → no IP block). Summaries and prompts use the language chosen at onboarding.
argument-hint: A descriptive intent in quotes, e.g. "which terminal for coding with Claude Code". Optional --max N, --since YYYY-MM-DD, --queries 1..3.
---

## How it works

`src/yt-search.ts` is the whole engine: intent → query expansion (LLM) → `search.list` → re-rank against the intent on metadata only (no transcript) → **lazy** one-candidate-at-a-time yield with a rich summary → record keep/skip → on demand synthesize a comparison from everything kept. Matching is **descriptive, not exact-keyword** — YouTube ranks by relevance and the LLM bridges intent→query and filters noise. This skill is a thin loop: paste the summary, collect keep/skip, show the final comparison. It runs no filters and formats nothing itself.

**Lazy on purpose:** one transcript per step, never a burst — a burst looks like scraping and gets the IP blocked (same reason `/yt` is lazy). Run the engine bare — stdout is a single JSON line, stderr empty; never redirect.

## Language

Read `data/config.json` → `output_lang` once at the start. Phrase the question text and option descriptions in that language. The two button labels stay the short English words `Keep` / `Skip`. Summaries and the final comparison are already written in `output_lang` by the engine — paste them verbatim.

## Loop

```
out = JSON.parse(`bun run src/yt-search.ts "<intent from the user>" --reset`)   // first call
while true:
  out.status:
    "error"           → show out.error verbatim, stop
    "no_results"      → tell the user nothing relevant was found, stop
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
  - The script reads the pending candidate from cache; pass only `--keep` / `--skip` / `--compare`. Its JSON becomes the next `out` — back to the top of the loop.

**On `done` (step D):**

- If `out.kept > 0` → run `out = JSON.parse(\`bun run src/yt-search.ts --compare\`)`; when it returns `status:"compare"`, paste `out.comparison` **verbatim** as your chat text (it's the artifact — a decision-grade comparison in `output_lang`). Stop.
- If `out.kept == 0` → tell the user nothing was kept, so there's nothing to compare. Stop.

## Rules

- **Verbatim:** paste `summary` and `comparison` exactly as returned; never paste a raw transcript.
- **Language:** question text + option descriptions follow `output_lang`; button labels stay `Keep` / `Skip`.
- **Cost awareness:** each search runs `search.list` (100 quota units/query, up to `--queries`). Don't silently re-run `--reset` in a loop. A bare resume (no `--reset`) continues the same ranked queue without new searches.
- **Stateless triage:** this is independent of `/yt` (no channels, no ratings). For the recurring channel briefing use `/yt`; for one video use `/yt-transcribe`.
