# yt-briefing

[![npm](https://img.shields.io/npm/v/yt-briefing)](https://www.npmjs.com/package/yt-briefing)
[![license](https://img.shields.io/npm/l/yt-briefing)](./LICENSE)
[![node](https://img.shields.io/node/v/yt-briefing)](https://www.npmjs.com/package/yt-briefing)
[![mac](https://github.com/michal90r/yt-briefing/actions/workflows/ci-mac.yml/badge.svg)](https://github.com/michal90r/yt-briefing/actions/workflows/ci-mac.yml)
[![ubuntu](https://github.com/michal90r/yt-briefing/actions/workflows/ci-ubuntu.yml/badge.svg)](https://github.com/michal90r/yt-briefing/actions/workflows/ci-ubuntu.yml)
[![windows](https://github.com/michal90r/yt-briefing/actions/workflows/ci-windows.yml/badge.svg)](https://github.com/michal90r/yt-briefing/actions/workflows/ci-windows.yml)

Save hours on YouTube. yt-briefing watches the channels you follow so you don't have to. For
each new video it gives you a short briefing in your own language — every point that matters, with
only the filler cut, so nothing important is lost. Reading it takes a fraction of the time the
video would, so you stay on top of everything and only watch what's actually worth it.

It also gets better the more you use it. You give each summary a quick rating, worth my time
or not, and from that it learns what to keep showing you and what to drop. Over time the queue
becomes yours: less noise, more of what you care about.

yt-briefing runs inside [Claude Code](https://claude.com/claude-code). `/yt` opens the briefing in
a pane next to your chat, and the filtering and summaries run on your own Claude Code login. There
is no separate model, provider or LLM key to set up.

## First run vs later

On a channel's first sweep there is no history, so yt-briefing takes the latest video of each
kind: the newest long-form, the newest short, and the newest live. That gives you a baseline
without pulling the whole back catalog.

After that it works from history. Each rating moves a per-type cursor forward, so later runs
only surface videos newer than the ones you already handled, and a session just continues where
the last one left off.

## Setup

You'll need Node 18+ or Bun, a YouTube Data API v3 key, and
[Claude Code](https://claude.com/claude-code) installed and logged in, with `claude` on your PATH.

1. Install yt-dlp (it pulls the subtitles):

| OS | Command |
|----|---------|
| macOS | `brew install yt-dlp` |
| Windows | `winget install yt-dlp` |
| Linux / any Python | `pipx install yt-dlp` |

Keep it current with `yt-dlp -U`. YouTube changes often.

2. Add the package with any package manager:

```bash
npm  i   yt-briefing
pnpm add yt-briefing
yarn add yt-briefing
bun  add yt-briefing
```

3. Put your YouTube key in a `.env` at your project root:

```ini
YT_BRIEFING_YOUTUBE_API_KEY=<key>    # console.cloud.google.com → enable "YouTube Data API v3"
```

Optional extras: `YT_BRIEFING_MODEL` picks the Claude model for filtering and summaries (default
`sonnet`, any alias or model name `claude --model` accepts, `haiku` for faster runs), and `YT_BRIEFING_PROXY` routes
transcript fetches through a proxy on datacenter/VPS IPs.

4. Onboard:

```bash
npx yt-briefing init      # or: bunx yt-briefing init
```

`init` asks for your language and the channels to follow, then installs `/yt` and the two
skills into your project's `.claude/skills/`.

Add or remove channels anytime:

```bash
npx yt-briefing add @handle https://youtube.com/@another   # one or more, handle or URL
npx yt-briefing remove @handle                              # also deletes its learned profile
npx yt-briefing list                                        # show the current list
```

## One-off: transcribe a single video

Just want one video summarized — no channels, no queue, no rating? Run `/yt-transcribe` and
paste a URL or video ID. It pulls that video's transcript and writes a journalist-grade
summary in the language you chose at setup (the same `output_lang` as `/yt`). Want a one-off in
another language? Just say so when you run it (e.g. `/yt-transcribe <url> in German`) — it
won't change your setup. `--lang pl|en` is separate — it picks which caption track to fetch,
not the summary language.

For example:

```
/yt-transcribe https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

## Search within a channel

Mine one channel's videos for a topic and get a comparison. Run `/yt-search` with a channel and
an intent — for example:

```
/yt-search @betterstack which terminal for AI coding
```

It covers the channel's **whole history** (not just recent uploads), re-ranks every upload against
your intent, then lazily yields one matching video at a time to keep or skip — and synthesizes a
comparison from everything you kept.

The one flag is `--top N` — how many of the top re-ranked matches to triage (**default 10**). Raise
it to go deeper, lower it for a quicker pass:

```
/yt-search @betterstack which terminal
/yt-search @betterstack which terminal --top 5
```

## Run it

Open your project in Claude Code and type `/yt`. The briefing opens in a pane: the summary, and
under it four keys.

| Key | What it does |
|-----|--------------|
| `1` OK | Neutral. The video is marked as seen, the next one loads. |
| `2` Weak | Worthless. The title goes to the channel's skip examples, so the filter learns to drop titles like it. |
| `3` Research | Ends the loop and hands this video to Claude, see below. |
| `4` Stop | Closes the pane. The next `/yt` resumes where you stopped. |

The **Comment** field takes anything else. Type what you think in your own words ("too many panel
shows, skip those") and press Enter: Claude turns it into a standing rule for that channel and
infers the rating. `? your question` starts research with that question, `stop` closes the pane.

Each step is the engine, not a chat turn: rating a video costs no tokens of your session, and
the next summary is usually ready before you have finished reading the current one.

`/yt` is a Claude Code mod (a plugin in `.claude/skills/yt-briefing/`). Claude Code loads it on
its own once you trust the project folder. If `/yt` is not listed, start a fresh session. To
install again, after an upgrade or into another project, run `npx yt-briefing install-skill` (it
installs `/yt`, `/yt-transcribe` and `/yt-search`).

## Don't shelve it — research it

Tech channels announce something new every week, and the usual fate is "looks interesting" →
to-do list → never. So next to OK/Weak there is a third key: **Research**. Press it, or type
`? your question` into the comment field, and the loop ends there: the pane closes and the video
lands in your chat with its briefing and the command for its full transcript. Claude works your
question with you, against your own codebase if you ask "would this fit my project", against the
web if the claims need checking. A quick feedback loop instead of a shelf. The video is marked as
seen, and the next `/yt` resumes the queue right where you broke off.

## Upgrading from 0.x

1.0 runs on Claude Code only. The OpenAI-compatible provider and its three `YT_BRIEFING_LLM_*`
keys are gone (delete them from `.env`), and the chat-driven `/yt` skill with its rating popup is
replaced by the pane. Run `npx yt-briefing install-skill` once in your project: it installs the
pane, and removes the old `/yt` skill and the summary-gate hook from `.claude/settings.json`. Your
channels, profiles and ratings in `.yt-briefing/data/` carry over unchanged.

## Why Claude Code, and nothing else

Filtering and summaries are a `claude -p` call from the engine: one prompt in, one answer out, with
no tools, no project settings or hooks, no MCP servers and no saved session. It runs on the login
you already have, so there is no second model to pay for or keep a key to. If `ANTHROPIC_API_KEY`
is set in your environment, the engine removes it for that call, because Claude Code would
otherwise bill it as API usage instead of using your login.

The engine still works ahead in the background. It expands channels in parallel and summarizes the
next video while you rate the current one, so each step is usually ready with no wait. The pane
only shows what the engine produced and sends your key presses back to it.

Supporting every agent that reads `SKILL.md` meant a chat loop for the rating: the model pasted
each summary, asked the question and recorded the answer, every video a full turn, plus a hook to
make sure the summary was really shown. A Claude Code pane does the same with no model in the loop,
which is why 1.0 drops the other agents.

## Why one transcript at a time

yt-briefing pulls transcripts lazily. It fetches the one you are about to read, warms the next
one in the background while you rate, and stops there. It never grabs the whole queue up front.

That pacing is deliberate. Pulling many transcripts in a quick burst looks like scraping to
YouTube and gets your IP rate-limited or blocked, which is easy to hit on a server. Fetching
them at the speed you actually work through the queue keeps you under the radar and the queue
flowing.

## Sync across machines

Your state is plain files in `.yt-briefing/data/`. Version that folder (or point `YT_BRIEFING_DATA_DIR`
at a separate private repo) and commit after each rating: set `"after_rate"` in
`.yt-briefing/data/config.json` to a script and the engine runs it after every rating. Recipe:
[docs/sync-across-machines.md](./docs/sync-across-machines.md).

## Running on a VPS

YouTube blocks datacenter IPs, so transcript fetches fail on most servers. Route them through a
free Cloudflare WARP proxy. See [docs/warp-proxy.md](./docs/warp-proxy.md).

## License

MIT, see [LICENSE](./LICENSE).
