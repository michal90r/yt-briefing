# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.14.0] - 2026-08-04

### Added
- **Summary gate — the rating popup can no longer appear for a summary you never saw.**
  Step B of the loop (paste the summary, *then* ask) is the one step an agent can drop with no
  visible symptom: the popup still appears, you still answer, and the rating is recorded against
  text nobody read — teaching the title filter from noise. Observed failure mode: the paste is
  reliable while the sweep also returns a `skipped` list (there is other prose to write), and
  gets dropped in iterations that return none, where the turn can open straight with the tool
  call. `yt-summary-gate` runs as a Claude Code `PreToolUse` hook, blocks the popup when the
  pending video's id is missing from the agent's own chat text, and tells it to paste first.
  `init` and `install-skill` wire it into the project's `.claude/settings.json`, merging with
  existing hooks and updating in place on reinstall; an unparseable settings file is left
  untouched with a note to add the entry by hand (README → Rating gate). Other agents expose no
  equivalent hook, so there the `SKILL.md` instruction — now explicit that step B is
  unconditional — is what holds.

## [0.13.1] - 2026-07-31

### Fixed
- **A same-day channel with multiple sweeps could silently orphan backlog videos.**
  `yt-channel-pending` fetched a channel's videos with `--since` set to state.md's
  `updated` column — the date state.md was last *written*, stamped to today on every
  pointer bump. After the first bump of the day, a later `/yt` run on the same channel
  would only fetch videos published *today*, permanently skipping anything published
  between the true pointer and today whenever the channel wasn't fully drained in one
  sitting (e.g. a `--reset` between two `/yt` invocations). Fixed by fetching with a
  fixed 45-day lookback instead — the existing pointer-cutoff logic still does the real
  filtering, it just needs a window wide enough to always re-find the pointer video.

## [0.13.0] - 2026-06-17

### Fixed
- **`tooling_error` surfaces proxy/yt-dlp failures distinctly from IP blocks.**
  `yt-transcript` exit 3 (503, tunnel down, missing yt-dlp) is now emitted as
  `status:"tooling_error"` instead of falling through to an opaque `no_transcript` skip.
  `rate_limited` (exit 2) remains the YouTube/IP-block case. The `/yt` skill tells the user
  to check proxy health and points to README → Proxy.

### Added
- **Channel directives are now executed, not just consulted.**
  The title and content filters both honor the full channel profile — `## Notes`,
  `## Channel policy`, and `## Skip titles`. A directive that is judgeable from the title
  alone is enforced at the title stage (fast, no transcript cost); a directive that needs
  the transcript is enforced at the content stage. Both stages return a reason string that
  travels through the system.
- **Fact-check / scrutiny directives trigger a from-memory assessment.**
  When a `## Notes` or `## Channel policy` directive asks to verify or scrutinize claims,
  the content filter assesses them against its own background knowledge. The assessment lands
  in its own clearly-labelled section: what can be corroborated, what looks overstated or
  misattributed, what falls outside the model's knowledge — always marked with confidence and
  flagged as from-memory, not live verification.
- **Skip registry: every filtered video is now reported to the user.**
  `yt-sweep` accumulates all skips from both stages (title filter + content filter) in a
  per-invocation ledger and emits them as `skipped` + `skips[]` on every response. The `/yt`
  skill surfaces a one-line "Skipped N: …" digest before each rating, so the user can see at
  a glance what was dropped and why — without needing to dig into logs.

## [0.12.3] - 2026-06-16

### Fixed
- **Already-rated videos can no longer re-appear after a `--fill` pointer regression.**
  When `yt-sweep --fill` ran in the background and re-bumped a stale state pointer to an older
  video, the pointer-only check (`pointer === videoId`) could transiently clear, making the
  sweep re-emit a video the user had already rated. The new `isResolved(pointer, id, seen)`
  helper checks both the pointer *and* the run-queue's `seen` array (written by `yt-rating`
  immediately after each rating). `seen` is pointer-independent, so a regression can never
  un-resolve a video that was explicitly rated in this session.

## [0.12.2] - 2026-06-15

### Fixed
- **`transcribe` now accepts path-based YouTube URLs** — `youtube.com/shorts/ID` (and
  `/embed/`, `/live/`, `/v/`) parsed correctly. Previously only `watch?v=`, `youtu.be/`, and
  bare IDs were recognized, so Shorts links failed with "Invalid VIDEO_ID or YouTube URL".

## [0.12.1] - 2026-06-14

### Fixed
- **Missing-key error now points to a section that exists.** The fail-fast message (and the
  YouTube-key check) pointed to "README → Providers → Where the keys live", which was never a
  heading; both now point to **README → Setup**, where the keys block actually lives.
- **`init` surfaces unset keys at the end of onboarding**, instead of letting them fail only at
  the first `/yt`. After writing your data it checks the required keys (`YT_BRIEFING_LLM_*`,
  `YT_BRIEFING_YOUTUBE_API_KEY`) in your project root `.env`; if any are missing it lists them with
  the exact `.env` path and points to README → Setup. Silent when everything is already set.

## [0.12.0] - 2026-06-11

### Added
- **Research mode in `/yt`** — a third rating option, **Research** (or type `? <question>`
  straight into the comment box): rates the video neutral so it won't reappear, breaks the
  rating loop, re-fetches the full transcript, and digs into the video's content with you —
  against your own project or the web (e.g. "this new tool the channel hypes — worth swapping
  into project xyz?"). State stays durable: a later `/yt` resumes the queue where you broke off,
  and a post-research verdict can still be recorded (`--rating 0` if it turned out to be hype,
  `--comment` for a durable channel rule). Skill-layer only — the engine is unchanged.

## [0.11.1] - 2026-06-08

### Fixed
- **A cold sweep no longer returns `rate_limited` on the first call.** The first transcript
  fetch through a freshly-warmed WARP/shared egress IP intermittently trips YouTube's "Sign in
  to confirm you're not a bot" check; the next request seconds later succeeds. That transient
  flake exited `2`, which the sweep treats as fatal (`emit` → exit) — so a cold `/yt` needed two
  calls to get going. `yt-transcript` now retries up to 3 times with a 2s/4s backoff, but **only**
  on rate-limit-with-no-subtitles: a genuine IP block still exhausts the attempts and exits `2`,
  and real tooling errors / captionless videos fall straight through untouched. Also passes
  `--extractor-retries 3` so yt-dlp retries the bot-check at the extractor level first.

## [0.11.0] - 2026-06-08

### Changed (BREAKING)
- **`/yt-search` now ranks the channel's whole upload history** — not just a recent window. The
  `--scan` (recent-uploads cap, default 50) and `--since` (date window) flags are **removed**;
  **`--top N` (default 10) is the only flag**, capping how many of the top re-ranked matches get
  triaged. Searching a busy channel (e.g. ~3 uploads/day) used to miss everything older than ~18
  days; a query for "which terminal for AI coding" now surfaces the relevant videos from across
  years, not just the last fortnight.

### Fixed
- **Re-rank is chunked, so the full history can't overflow the LLM.** A years-old channel is 1000+
  uploads (~300 KB of titles+descriptions); sending that as one prompt silently overflowed context
  → the parse failed → the keep-all fallback walked every transcript newest-first. The pool is now
  ranked in chunks and merged by score, and a failed chunk is dropped (not dumped unranked).

## [0.10.0] - 2026-06-08

### Fixed
- **Installed skill is now machine-portable.** The consumed (`dist`) skill rewrite baked the
  install machine's absolute paths — `process.execPath`, the absolute `dist/` script path and the
  absolute `DATA_DIR` — into each `SKILL.md`. A skill committed to git on one machine then broke
  when run on another (e.g. authored on macOS, run on a Linux VPS: *"config.json does not exist"*).
  The rewrite now emits a bare runtime name (`node`/`bun`, resolved from `PATH`) and paths relative
  to the project root, resting on the same `cwd = project` invariant `paths.ts` already uses. A
  reinstall on any machine yields the same portable skill. Added `tests/skill-install.test.ts` to
  lock the class out (no absolute path in an engine command or state-file read, no baked execPath).

## [0.9.2] - 2026-06-08

### Changed
- README: list Claude/Anthropic as a provider (OpenRouter `anthropic/claude-...` or Anthropic's
  OpenAI-compatible endpoint `https://api.anthropic.com/v1/`); the `/yt-transcribe` and `/yt-search`
  examples now show the skill invocation in a code block instead of the plain-CLI command; trimmed
  the Setup prose. Docs only.

## [0.9.1] - 2026-06-08

### Changed
- README: scaled back the 0.9.0 reword. Only the lead avoids "summary" now (it reads "a short
  briefing"); the `/yt-transcribe` and "Why an API" sections keep "summary" as before. Docs only.

## [0.9.0] - 2026-06-08

### Changed
- README wording: the output is framed as a **briefing** (the essence — every point that matters,
  only the filler cut), not a "summary". No behavior change.

## [0.8.0] - 2026-06-08

### Changed
- **`init` no longer asks for keys or touches `.env`.** The wizard now sets only your output
  language, the channels to follow, and which agent runs `/yt`. Put `YT_BRIEFING_*` (the LLM vars
  and the YouTube key) in your project root `.env` yourself — see README → Setup — and the engine
  reads them at run time, failing fast naming any that are missing.

## [0.7.0] - 2026-06-08

### Changed (BREAKING)
- `/yt-search`'s `--max` flag is renamed **`--top`** (how many of the top re-ranked matches to
  triage, default 10).
- **Env var location moved: `.yt-briefing/.env` → project root `.env`.** Secrets are now read from
  your project's root `.env`. The old per-tool `.yt-briefing/.env` is no longer read — move any keys
  you kept there to the root `.env`.
- **No fallback file — root `.env` is the single source.** A single loader (`lib/env.ts`) reads the
  root `.env` and nothing else; anything already exported in the environment still wins. There is no
  secondary location to fall back to.
- **All provider variables are required — no silent defaults.** `YT_BRIEFING_LLM_BASE_URL`,
  `YT_BRIEFING_LLM_API_KEY`, `YT_BRIEFING_LLM_MODEL`, and `YT_BRIEFING_YOUTUBE_API_KEY` must be set.
  The former OpenRouter/Gemini defaults for base URL and model were removed — they silently masked a
  half-configured provider (e.g. a Gemini key fired at the default OpenRouter URL → confusing 401).
  `YT_BRIEFING_PROXY` and `YT_BRIEFING_DLP_PATH` stay optional.

### Added
- **Fail-fast preflight that names the missing variable(s).** A missing key used to fail silently —
  the YouTube error collapsed to a misleading "no new videos", and a missing LLM key was swallowed
  by the title-filter's keep-all fallback. Now `yt-sweep` / `yt-search` check up front and emit
  `status:"error"` listing exactly which variables are missing. Scope is per command: `--compare` /
  `--keep` / `--skip` need only the LLM vars (they run off cache), not the YouTube key.

### Migration
- Put `YT_BRIEFING_*` in your project root `.env` — `yt-briefing init` now writes/merges them there
  without clobbering your other variables — or export them. `.yt-briefing/.env` is no longer read.

## [0.6.0] - 2026-06-07

### Changed
- `/yt-search` is now **channel-scoped**: you name a channel (`--channel <@handle|url>`) and an
  intent, and it searches within that channel instead of all of YouTube. Candidates come from the
  channel's uploads (cheap `playlistItems`, ~1 quota unit/page) re-ranked against the intent, not
  from `search.list`. The lazy triage + comparison flow is unchanged. New flags: `--channel`
  (required), `--scan N` (recent uploads to consider, default 50); dropped `--queries`.
  _(0.5.0's whole-YouTube search shipped minutes earlier with no consumers — replaced cleanly.)_

### Removed
- `searchVideos()` / whole-YouTube `search.list` path (superseded by channel-scoped search).

## [0.5.0] - 2026-06-07

### Added
- `/yt-search` skill + `yt-briefing search "<intent>"` CLI: research a topic across YouTube.
  Describe an intent (descriptive, not exact-keyword) → LLM expands it into search queries →
  `search.list` → LLM re-ranks results against the intent on metadata only (no transcripts) →
  **lazy** one-video-at-a-time triage with a rich summary (Keep/Skip) → synthesizes a comparison
  from everything kept. Lazy by design — one transcript per step, never a burst (avoids IP blocks).
- `searchVideos()` in the YouTube API client (`search.list`, relevance-ranked, `publishedAfter`).

### Changed
- `init` / `install-skill` now install three skills (`/yt`, `/yt-transcribe`, `/yt-search`).
- Agent picker now offers **Codex** (`.codex/skills`) alongside Claude Code and Cursor. The
  shipped `SKILL.md` is the cross-agent Agent Skills standard, so it runs unmodified in 30+
  compatible agents; the "custom folder" option (default `.agents/skills/`) covers the rest.

## [0.4.0] - 2026-06-07

### Added
- `/yt-transcribe` skill: one-shot single-video transcript → summary. Paste a URL or
  video ID, get a journalist-grade summary. No channels, no queue, no rating — reuses the
  same transcript engine and WARP proxy as the `/yt` briefing loop.
- `yt-briefing transcribe <url|id>` CLI subcommand (prints the transcript to stdout).

### Changed
- Onboarding (`init`) and `install-skill` now install **both** skills (`/yt` and
  `/yt-transcribe`) in one step, under the agent's skills root.
- `/yt-transcribe` summary language defaults to `output_lang` from `config.json` (the same
  language `/yt` uses), overridable per request; `--lang` stays the caption-track selector.

## [0.3.2] - 2026-06-07

### Fixed
- Missing `YT_BRIEFING_YOUTUBE_API_KEY` now fails fast with `status:"error"` and a clear
  message, instead of a misleading `status:"done"` ("no new videos"). Previously every
  channel expansion threw the same error and the per-channel `catch` collapsed it to zero
  items. Added an `error` branch to the skill loop.

## [0.3.1] - 2026-06-07

### Fixed
- When consumed as a dependency, the installed `SKILL.md` now bakes the absolute `DATA_DIR`,
  so the agent reads `.yt-briefing/data/*` instead of the dev-relative `data/*` (fixes
  "`data/config.json` does not exist").

## [0.3.0] - 2026-06-07

### Added
- `add` / `remove` / `list` channel commands (handle or URL; `remove` also deletes the
  channel's learned profile).

### Fixed
- Unicode-safe handle and slug handling (fixes truncation of non-ASCII handles such as
  `@DziałZagraniczny`).

### Changed
- Channel serializers are shared between `init` and the channel commands, so the on-disk
  format is written from a single source.

## [0.2.0] - 2026-06-06

### Changed
- Namespaced all environment variables as `YT_BRIEFING_*` to avoid clashes with ambient vars.

### Added
- Consume-time install writes a secret-safe `.yt-briefing/.gitignore` (keeps `.env` and the
  throwaway cache out of git).
- README: documented first-run baseline behavior.

## [0.1.0] - 2026-06-06

### Added
- Initial public release. Cross-runtime engine (Node 18+ and Bun, any package manager),
  the consume-as-a-dependency model, and the `/yt` skill with its installer.

[0.14.0]: https://github.com/michal90r/yt-briefing/compare/v0.13.1...v0.14.0
[0.13.1]: https://github.com/michal90r/yt-briefing/compare/v0.13.0...v0.13.1
[0.13.0]: https://github.com/michal90r/yt-briefing/compare/v0.12.3...v0.13.0
[0.12.3]: https://github.com/michal90r/yt-briefing/compare/v0.12.2...v0.12.3
[0.12.2]: https://github.com/michal90r/yt-briefing/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/michal90r/yt-briefing/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/michal90r/yt-briefing/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/michal90r/yt-briefing/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/michal90r/yt-briefing/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/michal90r/yt-briefing/compare/v0.9.2...v0.10.0
[0.9.2]: https://github.com/michal90r/yt-briefing/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/michal90r/yt-briefing/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/michal90r/yt-briefing/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/michal90r/yt-briefing/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/michal90r/yt-briefing/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/michal90r/yt-briefing/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/michal90r/yt-briefing/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/michal90r/yt-briefing/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/michal90r/yt-briefing/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/michal90r/yt-briefing/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/michal90r/yt-briefing/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/michal90r/yt-briefing/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/michal90r/yt-briefing/releases/tag/v0.1.0
