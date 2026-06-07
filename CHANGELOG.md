# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.6.0]: https://github.com/michal90r/yt-briefing/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/michal90r/yt-briefing/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/michal90r/yt-briefing/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/michal90r/yt-briefing/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/michal90r/yt-briefing/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/michal90r/yt-briefing/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/michal90r/yt-briefing/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/michal90r/yt-briefing/releases/tag/v0.1.0
