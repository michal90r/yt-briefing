# Sync across machines (multi-device)

yt-briefing keeps **all your state as plain files** under the data dir — `channels.md`,
`state.md` (the per-video cursor), and one Markdown `channels/<slug>.md` profile per
channel (where your ratings accumulate). The engine itself **never touches git** — it just
reads and writes these files. So syncing across machines (laptop + a VPS / remote session,
say) is entirely up to you, and it's just *"version the data dir and commit after each
rating."*

This guide gives you a **sync-safe** wiring — one where a rating made on machine A can't be
silently lost when machine B pushed first.

> **Secrets never sync.** `.env` (your API keys) is git-ignored and stays per-machine. Only
> the data dir is versioned. The throwaway `.cache/` inside it is ignored too.

---

## 1. Version your state

Your state already lives in plain files at **`<your project>/.yt-briefing/data/`** — right
inside the project you ran `init` from. So the simplest sync is to **version that folder** in
your project's own git: push from machine A, pull on machine B. Keep `.yt-briefing/.env`
git-ignored — secrets stay per machine.

Want briefing state in **its own** repo instead (e.g. a laptop and a headless VPS that share
nothing else)? Point `YT_BRIEFING_DATA_DIR` at a folder you control and version that:

```bash
# .env  (per machine — secrets never sync)
YT_BRIEFING_DATA_DIR=/home/you/yt-briefing-data
```

```bash
cd /home/you/yt-briefing-data
git init && git remote add origin git@github.com:you/yt-briefing-data.git   # a PRIVATE repo
printf '.cache/\n' > .gitignore          # never commit the throwaway session cache
npx yt-briefing init                     # onboard into this folder (or move existing data here)
git add -A && git commit -m "initial" && git push -u origin main
```

On the second machine: clone that repo, set the same `YT_BRIEFING_DATA_DIR`, drop in your `.env`.

---

## 2. Make profiles merge instead of conflict

Ratings **append** to a profile's `## Skip titles` / `## Notes`. If two machines rate
different videos before syncing, a normal merge would conflict on the same section. A
**union merge** keeps both sides' lines instead. Drop this in your data repo as
`.gitattributes`:

```gitattributes
# Profiles are append-only logs — keep both machines' additions on merge.
channels/*.md merge=union
```

`state.md` is deliberately **left out** (it's a table, one row per channel — union would
duplicate/garble rows). A genuine same-channel collision should surface as a conflict, not
merge wrong (see the hook below — it aborts and tells you).

---

## 3. Commit + push after every rating (sync-safe)

Wire this so each rating lands on `origin`. It commits the cursor + profiles, and — if the
other machine pushed first — **rebases and retries** instead of silently dropping your work.

Save as `yt-sync.sh` (anywhere), `chmod +x`:

```bash
#!/usr/bin/env bash
# Persist yt-briefing state to git, sync-safe across machines. Best-effort, never blocks.
set -uo pipefail
DATA="${YT_BRIEFING_DATA_DIR:-$PWD/.yt-briefing/data}"   # the folder you version (default: in-project)
cd "$DATA" || exit 0

git add channels.md state.md channels/ config.json 2>/dev/null || exit 0
git diff --cached --quiet 2>/dev/null && exit 0        # nothing changed → no commit
git commit -q -m "yt-briefing: rating $(date '+%Y-%m-%d %H:%M %Z')" 2>/dev/null || exit 0

git push -q 2>/dev/null && exit 0                       # landed → done
# origin moved (the other machine pushed) → integrate + retry, never swallow:
if git pull --rebase -q 2>/dev/null; then
  git push -q 2>/dev/null && exit 0
else
  git rebase --abort 2>/dev/null || true               # same-channel collision → leave it for you
fi
echo "yt-briefing: state NOT pushed — resolve: cd \"$DATA\" && git pull --rebase && git push" >&2
exit 0
```

Then trigger it after each rating. Two ways, depending on how you run yt-briefing:

**A) Via a coding agent (Claude Code / Cursor)** — add a `PostToolUse` hook that fires after
the engine runs. In Claude Code's `settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Bash",
        "hooks": [ { "type": "command", "command": "cmd=$(jq -r '.tool_input.command // \"\"'); case \"$cmd\" in *yt-rating*|*yt-sweep*) /path/to/yt-sync.sh ;; esac" } ] }
    ]
  }
}
```

**B) Via the CLI** — just call it after `rate`:

```bash
yt-briefing rate --rating 0 && /path/to/yt-sync.sh
```

> Optional but recommended: also `git pull --rebase` **before** the first sweep of a session
> (so a machine starts on the latest cursor), e.g. a `PreToolUse` hook matching
> `*yt-sweep*--reset*`, or just `cd "$YT_BRIEFING_DATA_DIR" && git pull --rebase` before you start.

---

## Why "sync-safe" (the footgun this avoids)

The naive version — `git push || true` — **silently swallows** a rejected push when the
other machine pushed first. The rating stays local-only while you believe it's saved; later
a careless conflict resolution drops it. The script above instead: per-rating commit →
push → on rejection `pull --rebase` + retry → on a real conflict, **abort and tell you**.
With profiles union-merging, the only thing that ever needs your hand is two machines rating
the *same channel* before syncing — and even then it surfaces loudly, never vanishes.
