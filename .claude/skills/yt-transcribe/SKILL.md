---
name: yt-transcribe
description: Fetch a single YouTube video's transcript and summarize it. One-shot — paste a URL or video ID, get a journalist-grade summary. Same transcript engine (and WARP proxy support) as the /yt briefing loop; no channels, no state, no rating.
argument-hint: URL or VIDEO_ID. Optional --lang pl|en|auto (defaults to auto).
---

## Step 1 — Fetch the transcript

```bash
bun run src/yt-transcript.ts <VIDEO_ID_OR_URL> --lang <lang>
```

- First argument: URL or VIDEO_ID straight from the user — the script parses both formats (`youtube.com/watch?v=…`, `youtu.be/…`, or a bare 11-char ID).
- `--lang` selects which **caption track to fetch** (the input), not the summary language. `auto`
  by default (best available track); pass `pl` / `en` only if the user wants a specific track.
- The transcript goes to **stdout**; stderr carries diagnostics. Run it bare — no redirects.

Exit codes — the message you show the user must match the real cause. Never report a
tooling failure as "no subtitles". When the code is non-zero, read the script's stderr
and surface that actual reason; do not paraphrase it away.
- `0` — transcript on stdout → continue to Step 2.
- `1` → the video genuinely has no subtitles. Tell the user exactly that and stop.
- `2` → YouTube rate-limit / IP block (common on datacenter/VPS IPs). Tell the user and
        stop; it's transient. Recovery: route fetches through a proxy — see
        `docs/warp-proxy.md` (set `YT_BRIEFING_PROXY`).
- `3` → tooling/integration failure (yt-dlp missing, fetch error, unavailable or private
        video, empty/unparseable track, bad input). This is NOT a missing-captions case.
        Show the stderr line verbatim so the user sees the real problem, and stop.

---

## Step 2 — Summary

Read the transcript from the tool result and respond as a narrative.

- **Header:** title, author, date
- One introductory sentence
- One paragraph per significant thread — a bold label + continuous prose, concrete facts. Preserve the logic and rhetoric of the original.
- Verdict: what's strong, what's weak, whether it was worth it

Style:
- an intelligent journalist — not like an AI assistant summarizing an article
- no generalities, always specifics: what was the thesis, what was the argument
- if the material has a clear host and guests, show that in the text

**Language:** Read `data/config.json` → `output_lang` once and write the summary in that
language — the same language chosen at onboarding that `/yt` uses. Order of precedence:
(1) a language the user explicitly asks for in this request wins; (2) otherwise `output_lang`
from config; (3) only if config is missing, match the language of the video. This is the
**output** language and is independent of `--lang` (which only picks the caption track to
fetch). Don't mix languages: write fully in the target language and insert foreign words only
when they are (a) a proper name of a technology/product, or (b) an established technical term
with no natural equivalent (API, REST, JSON, webhook, endpoint). Translate everything else.

---

## Rules

- **Transcripts:** never paste the raw transcript into chat — the summary is the artifact.
- **One-shot, stateless:** this skill reads no channels, writes no state, asks for no rating.
  It is independent of the `/yt` briefing loop, though it shares the same transcript engine
  and proxy. For the recurring channel briefing, use `/yt` instead.
