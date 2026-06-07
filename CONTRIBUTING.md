# Contributing to yt-briefing

The [README](./README.md) is for people who *use* yt-briefing. This file is for hacking on it.

## Dev setup

Clone the repo, then:

```bash
bun install          # installs deps; the `prepare` hook compiles src/ → dist/
bun run init         # onboarding — in a clone this writes .env + data/ at the repo root
```

In a clone you run the TypeScript in `src/` directly with Bun — no build needed to iterate.
The compiled `dist/` is only what ships to consumers (built by `prepare` / on publish).

## Scripts

| Command | What |
|---|---|
| `bun run sweep --reset` | advance one step; prints a JSON status line |
| `bun run rate --rating 0` | record a rating (`0` = drop its kind, `1` = neutral) |
| `bun run transcribe <url\|id>` | print one video's transcript |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run build` | compile `src/` → `dist/` |

## Engine protocol

`yt-sweep` is the whole engine — it sweeps channels, runs the two filters (title first, then
transcript + content via the LLM), and yields **one** ratable video per call as a single JSON
line on stdout (stderr stays empty, so callers never redirect to a temp file):

- `{"status":"rating_needed","summary":"<md>","pending":{…}}` — show the summary, decide a
  rating, call `rate`, then `sweep` again.
- `{"status":"done"}` — nothing left.
- `{"status":"rate_limited"}` — transcript fetch blocked (usually a datacenter IP — see
  [docs/warp-proxy.md](./docs/warp-proxy.md)).
- `{"status":"error","error":"…"}` — setup/config problem (e.g. missing
  `YT_BRIEFING_YOUTUBE_API_KEY`); the skill surfaces `error` verbatim and stops.

The `/yt` skill (`.claude/skills/yt/SKILL.md`) is a thin loop over exactly this: paste the
summary, collect the rating, repeat. `yt-rating` is the only thing that writes a rating;
everything else lives inside `yt-sweep`.

## How it's built

- **Runtime-agnostic.** TypeScript compiled to ESM JS (`tsc -p tsconfig.build.json`); runs on
  Node ≥ 18 or Bun. The bin is `dist/cli.js` (node shebang); child processes spawn with the
  parent runtime via `process.execPath`.
- **State location.** In a dev clone, `.env` + `data/` sit at the repo root. When the package
  is a dependency (it lives under `node_modules`), they move to
  `<consumer project>/.yt-briefing/` so a reinstall can't wipe them. Both are resolved in
  `src/lib/paths.ts` and pinned into the env so child processes agree.
- **No heavy SDK.** The YouTube Data API is reached over plain `fetch` (`src/lib/yt-api.ts`).
- **Crash-safe cursor.** `state.md` is the only durable cursor, bumped per video; `.cache/` is
  throwaway. A crash before you rate just re-surfaces that one video.
- **Learning.** `rating=0` appends the title to the channel's `## Skip titles`; a comment
  becomes a durable rule in `## Notes`; `rating=1` only bumps the cursor. Both filters read
  those sections live on the next sweep — no consolidation step.

## Releasing

Releases are **tag-driven**. Pushing a `vX.Y.Z` tag triggers
[`.github/workflows/publish.yml`](.github/workflows/publish.yml), which publishes to npm via
**OIDC Trusted Publishing** — no token, no OTP — with a provenance attestation, and creates a
**GitHub Release** with auto-generated notes for that tag.

```bash
# 1. Land your changes + add a CHANGELOG.md entry, then verify
npm run typecheck && npm run build      # must be green
git add <changed files> CHANGELOG.md
git commit -m "describe the change"

# 2. Bump the version → creates the commit + matching vX.Y.Z tag
npm version patch                        # or minor / major

# 3. Push commit + tag → CI publishes
git push --follow-tags
```

Watch it: `gh run watch` (or the Actions tab). Confirm: `npm view yt-briefing version`.

**Choosing the bump (SemVer):** `patch` = bug fix, no behavior change · `minor` = new
backward-compatible feature · `major` = breaking change (renamed env vars, data format, …).

Notes:
- **CHANGELOG before the bump.** `npm version` only commits `package.json`, so the
  `CHANGELOG.md` entry must be in your step-1 commit. Add the compare link at the bottom, e.g.
  `[0.4.1]: https://github.com/michal90r/yt-briefing/compare/v0.4.0...v0.4.1`.
- **Clean tree** required (`npm version` refuses on a dirty tree). **`v` prefix** is what the
  workflow listens for — don't retag to bare `X.Y.Z`.
- Failure modes: red **403** in Actions → Trusted Publisher misconfigured on npmjs.com;
  **"cannot publish over existing version"** → you bumped onto a published version.

## Changelog policy

`CHANGELOG.md` is **hand-curated** ([Keep a Changelog](https://keepachangelog.com/) format):
short, human, grouped by Added / Changed / Fixed — the source of truth for "what changed". The
**GitHub Release notes are auto-generated** from commits per tag, so the Releases tab needs no
manual work. To fully automate `CHANGELOG.md` too you'd adopt
[Conventional Commits](https://www.conventionalcommits.org/) + a generator like
[git-cliff](https://git-cliff.org/) — only worth it once commit messages follow the convention.

## Security

Transcripts are untrusted input — they reach the LLM as plain content, and that call has no
tool access, so a prompt-injection attempt can at worst produce a bad summary, never run
anything. Secrets live in `.env` (gitignored); nothing is logged.
