---
name: yt
description: Briefing from the YouTube channels you follow. The engine `src/yt-sweep.ts` sweeps the channels, filters videos in two stages (title → transcript+content), and lazily yields one video to rate per call. This skill is a thin loop: it shows the summary and collects the rating (AskUserQuestion → `yt-rating.ts`), which writes durable signal straight into the channel profile (no consolidation step). Summaries and the rating question are in the language set at onboarding (`data/config.json` → `output_lang`).
---

## Prerequisites (first run)

This skill drives the loop; it does not configure anything. Before the first run the user must onboard once, from the package directory:

```
bun run init
```

That wizard asks for the **output language**, the **LLM + YouTube keys** (`.env`), and the **channels** to follow with **what to pay attention to** in each. If `data/channels.md` or `.env` is missing, stop and tell the user to run `bun run init` — do not invent config.

Run this skill from the package root (so `bun run …` resolves the scripts and `.env`).

## How it works

`src/yt-sweep.ts` is **the whole engine**: channel sweep, filters (title filter, then content filter on the transcript via the LLM API), and skip handling — all inside, lazy. The only state it does **not** write is the rating itself — that's `yt-rating.ts` in step D. This skill **does not run filters, read profiles, or format summaries** — it runs the script, pastes the summary, collects the rating.

`data/state.md` is the only persistent cursor. Session state — queue, pending, prefetch, background fill — lives in `data/.cache/` (rebuilt each run, never important to keep). Internals — lazy queue build, filters, summary format, LLM model, transcript fetching, prefetch, proxy — are in `README.md`, not here. No manual pre-flight: the engine self-invalidates a stale queue (new day or `--reset`).

**Run the engine bare — no redirects.** Its stdout is a pure JSON line and stderr is empty, so `JSON.parse` of the raw output just works; **never** redirect stderr to `/tmp` or any OS temp dir. For timing diagnostics ("why is the sweep slow") run it once with `YT_DEBUG=1` — it appends per-stage timings to the gitignored `data/.cache/sweep.log`.

For fast first paint, the engine expands channels in parallel waves until it has the first ratable video, while a detached background process expands the rest in parallel. And while the user rates a video, it warms the **next** video's summary in another background process, so the following step usually emits instantly. All fully internal — the loop below is unchanged.

## Rating language

Read `data/config.json` → `output_lang` once at the start of the loop. Phrase the rating **question text** and **option descriptions** in that language. The two button **labels** stay the short English words `OK` / `Weak` (deliberately universal). Summaries are already written in `output_lang` by the engine — paste them verbatim.

## Rating loop

```
out = JSON.parse(`bun run src/yt-sweep.ts --reset`)   // Bash — first call: --reset rebuilds the queue fresh
while true:
  out.status:
    "done"          → sweep finished — tell the user, stop
    "rate_limited"  → transcript fetch blocked (usually a blocked egress IP) — tell the user, stop; recovery in README.md → Proxy
    "rating_needed" → steps A–E
```

**On `rating_needed` — literally:**

- **A.** Take `out.summary` (markdown) and `out.pending` (metadata).
- **B.** In the same turn, as **your chat text** (NOT command output — the UI does not show it), paste `summary` **verbatim**: no paraphrase, no shortening, no comment, no "see above". The user must see it before the popup. _(If the user says "I don't see the summary" — you skipped B.)_
- **C.** In the same message call `AskUserQuestion` — **1 call, 1 question** (everything in one step), phrased in `output_lang`:
  - The question (e.g. "Rating?") with two options whose descriptions explain: **OK** = neutral (no effect on the filter), **Weak** = worthless (teach the filter to skip such titles). The digits never appear in the popup — internally map to `--rating`: **OK → 1, Weak → 0**. There is **no positive rating** — keeping the channel is the implicit positive; you only down-rate noise (`0`) or steer with a comment.
  - **Other** is the comment / stop channel (no second question): the user types free text. If it equals `stop` (case-insensitive, trimmed) — or the popup is dismissed (✕) — **end the loop**. Otherwise it is a **comment**: **distill** the user's raw text into a clean, generalizable rule, and infer the rating — clearly negative → `0`, otherwise → `1`.
- **D.** Act on the answer:
  - `stop` / dismissed → **end the loop** (state already on disk).
  - A rating option → `bun run src/yt-rating.ts --rating <1|0>`.
  - A comment (Other, not `stop`) → `bun run src/yt-rating.ts --rating <inferred 1|0> --comment "<distilled rule>"`.

  In every non-stop case **pass only the rating (+ comment)**; the script reads channel/id/title/type from `data/.cache/pending.json`. The write is **immediate and durable — no consolidation**: `rating=0` appends to `## Skip titles` (title filter learns to skip such titles from the next run) and a comment appends the rule to `## Notes` (seen by both filters). A neutral `1` writes nothing — it only bumps the state cursor.
- **E.** Re-run `bun run src/yt-sweep.ts` **bare** (no `--reset` — resumes the same queue; only the loop's first call uses `--reset`). Its JSON becomes the next iteration's `out` — back to the top of the loop.

## No consolidation

There is no post-loop step. Each rating is **durable immediately**: `yt-rating.ts` writes `rating=0` straight to `## Skip titles` and a comment straight to `## Notes` (FIFO-capped, de-duplicated). `rating=1` only bumps the cursor. The title filter reads those sections live, so the signal takes effect on the very next sweep — nothing to flush, batch, or trigger.

## Rules

- **Language:** question text, option descriptions, and loop messages follow `output_lang`; the two rating **labels** are `OK` / `Weak`. Summaries are written in `output_lang` by the content-filter prompt in the engine — not here.
- **Transcripts:** never paste a raw transcript into chat; the summary is the artifact.
- **Resuming:** the skill can be re-run any time — `data/state.md` is the source of truth, so a re-run always skips what's already rated. A queue from a previous day self-invalidates; the loop's first call passes `--reset` to also force a **same-day** rebuild, catching videos published since that morning's queue.
