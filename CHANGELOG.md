# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
