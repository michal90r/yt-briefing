---
name: yt
description: Briefing from the YouTube channels you follow — the engine sweeps each channel, filters videos in two stages (title, then transcript+content), and lazily yields one video to rate per call. This skill is a thin loop that shows the summary and collects the rating (via AskUserQuestion), which writes durable signal straight into the channel profile. A third option, Research, breaks the loop to dig into the current video's content with the user (full transcript + their question). Summaries and the rating question use the language chosen at onboarding.
---

## How it works

`src/yt-sweep.ts` is **the whole engine**: channel sweep, filters (title filter, then content filter on the transcript via the LLM API), and skip handling — all inside, lazy. The only state it does **not** write is the rating itself — that's `yt-rating.ts` in step D. This skill **does not run filters, read profiles, or format summaries** — it runs the script, pastes the summary, collects the rating. The one exception is **Research mode** (below): an explicit user pick that ends the loop and opens the current video's content for discussion.

`data/state.md` is the only persistent cursor. Session state — queue, pending, prefetch, background fill — lives in `data/.cache/` (rebuilt each run, never important to keep). Internals — lazy queue build, filters, summary format, LLM model, transcript fetching, prefetch, proxy — are in `README.md`, not here. No manual pre-flight: the engine self-invalidates a stale queue (new day or `--reset`).

**Run the engine bare — no redirects.** Its stdout is a pure JSON line and stderr is empty, so `JSON.parse` of the raw output just works; **never** redirect stderr to `/tmp` or any OS temp dir. For timing diagnostics ("why is the sweep slow") run it once with `YT_BRIEFING_DEBUG=1` — it appends per-stage timings to the gitignored `data/.cache/sweep.log`.

For fast first paint, the engine expands channels in parallel waves until it has the first ratable video, while a detached background process expands the rest in parallel. And while the user rates a video, it warms the **next** video's summary in another background process, so the following step usually emits instantly. All fully internal — the loop below is unchanged.

## Rating language

Read `data/config.json` → `output_lang` once at the start of the loop. Phrase the rating **question text** and **option descriptions** in that language. The two button **labels** stay the short English words `OK` / `Weak` (deliberately universal). Summaries are already written in `output_lang` by the engine — paste them verbatim.

## Rating loop

```
out = JSON.parse(`bun run src/yt-sweep.ts --reset`)   // Bash — first call: --reset rebuilds the queue fresh
while true:
  if out.skipped: FIRST, in output_lang, tell the user one line — "Skipped {out.skipped}:" + a `; `-joined list of `{channel} «{title}» — {reason}` from out.skips (videos the title/content filter dropped on the way here, including your channel directives). Then handle out.status below.
  out.status:
    "done"          → sweep finished — tell the user, stop
    "error"         → setup/config problem (e.g. missing API key) — show `out.error` to the user verbatim, stop
    "rate_limited"  → YouTube is blocking the egress IP (429 / captcha) — tell the user, stop; recovery in README.md → Proxy
    "tooling_error" → transcript toolchain failed (proxy down / yt-dlp / network) — tell the user, stop; check proxy health, then README.md → Proxy
    "rating_needed" → steps A–E
```

**On `rating_needed` — literally:**

- **A.** Take `out.summary` (markdown) and `out.pending` (metadata).
- **B.** In the same turn, as **your chat text** (NOT command output — the UI does not show it), paste `summary` **verbatim**: no paraphrase, no shortening, no comment, no "see above". The user must see it before the popup. _(If the user says "I don't see the summary" — you skipped B.)_
- **C.** In the same message call `AskUserQuestion` — **1 call, 1 question** (everything in one step), phrased in `output_lang`:
  - The question (e.g. "Rating?") with three options whose descriptions explain: **OK** = neutral (no effect on the filter), **Weak** = worthless (teach the filter to skip such titles), **Research** = break the loop and dig into this video's content together. The digits never appear in the popup — internally map to `--rating`: **OK → 1, Weak → 0**; Research maps to no digit, it exits the loop (see Research mode). There is **no positive rating** — keeping the channel is the implicit positive; you only down-rate noise (`0`) or steer with a comment.
  - **Other** is the comment / stop / research channel (no second question): the user types free text. If it equals `stop` (case-insensitive, trimmed) — or the popup is dismissed (✕) — **end the loop**. If it **starts with `?`**, the text after the `?` is a **research question** → Research mode. Otherwise it is a **comment**: **distill** the user's raw text into a clean, generalizable rule, and infer the rating — clearly negative → `0`, otherwise → `1`.
- **D.** Act on the answer:
  - `stop` / dismissed → **end the loop** (state already on disk).
  - A rating option → `bun run src/yt-rating.ts --rating <1|0>`.
  - A comment (Other, not `stop`, not `?…`) → `bun run src/yt-rating.ts --rating <inferred 1|0> --comment "<distilled rule>"`.
  - **Research** (the option, or a `?…` text) → **break the loop** and switch to **Research mode** below. Skip step E — no more sweep calls this session.

  In every non-stop case **pass only the rating (+ comment)**; the script reads channel/id/title/type from `data/.cache/pending.json`. The write is **immediate and durable — no consolidation**: `rating=0` appends to `## Skip titles` (title filter learns to skip such titles from the next run) and a comment appends the rule to `## Notes` (seen by both filters). A neutral `1` writes nothing — it only bumps the state cursor.
- **E.** Re-run `bun run src/yt-sweep.ts` **bare** (no `--reset` — resumes the same queue; only the loop's first call uses `--reset`). Its JSON becomes the next iteration's `out` — back to the top of the loop.

## Research mode (break the loop and dig in)

The "don't shelve it" path: instead of the briefing landing on a to-do list, the user pulls it apart with you right now — e.g. the channel announces a new tool and the question is whether it beats what their project uses today. Entry: the **Research** option, or an Other text starting with `?`.

1. **Commit first:** `bun run src/yt-rating.ts --rating 1` — engaging with a video is at least neutral, and the bump keeps it from reappearing on the next run. The rating loop is over: no step E, no further sweep calls.
2. **Get the question.** A `?…` text (or any free text attached to the Research selection) IS the question. If Research was picked bare, ask in `output_lang` what they want to dig into.
3. **Pull the full transcript** — the summary is too lossy to research from: `bun run src/yt-transcript.ts <videoId> --lang auto`, videoId from `out.pending` (or `data/.cache/pending.json`). The transcript arrives as the tool result — work from it there, never paste it into chat. Non-zero exit (`1` no subtitles / `2` IP-blocked / `3` tooling, reason on stderr) → tell the user and work from the summary instead.
4. **Work the question with the user, grounded.** The transcript is the source for what the video *claims*; keep "the video claims X" separate from what you verify yourself. Use whatever tools the question needs — read the user's project when they ask "would this fit project xyz", search the web for docs / changelogs / pricing. It is a conversation, not a one-shot report: answer, then iterate until the user is done.
5. **Closing.** `data/.cache/pending.json` is still on disk, so a verdict can still be recorded: turned out to be hype → `bun run src/yt-rating.ts --rating 0`; a durable channel preference surfaced → `--rating 1 --comment "<distilled rule>"` (the re-bump is a no-op). Mention that `/yt` resumes the queue where it left off — re-enter the rating loop (re-run the engine **bare**) only if the user asks.

## No consolidation

There is no post-loop step. Each rating is **durable immediately**: `yt-rating.ts` writes `rating=0` straight to `## Skip titles` and a comment straight to `## Notes` (FIFO-capped, de-duplicated). `rating=1` only bumps the cursor. The title filter reads those sections live, so the signal takes effect on the very next sweep — nothing to flush, batch, or trigger.

## Rules

- **Language:** question text, option descriptions, and loop messages follow `output_lang`; the three option **labels** are `OK` / `Weak` / `Research`. Summaries are written in `output_lang` by the content-filter prompt in the engine — not here. Research mode converses in `output_lang` unless the user switches.
- **Transcripts:** never paste a raw transcript into chat; the summary is the artifact. In research mode, quote only the short passages you need.
- **Resuming:** the skill can be re-run any time — `data/state.md` is the source of truth, so a re-run always skips what's already rated. A queue from a previous day self-invalidates; the loop's first call passes `--reset` to also force a **same-day** rebuild, catching videos published since that morning's queue.
