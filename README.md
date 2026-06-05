# yt-briefing

**Save hours on YouTube.** yt-briefing watches the channels you follow so you don't have to —
it turns each new video into a short, readable summary in your own language that keeps
everything that matters and drops the filler. Reading it takes a fraction of the time the
video would, so you stay on top of everything and only ever press play on what's genuinely
worth it.

And it gets sharper the more you use it. Each summary takes a one-tap rating — *worth my time*
or *not* — and from those it learns what to keep putting in front of you and what to quietly
leave out. Over time the queue becomes **yours**: less noise, only the things you actually
care about.

## Setup

You'll need **Node ≥ 18 or Bun**, a **YouTube Data API v3 key**, and an **LLM key** (a
[free Gemini key](https://aistudio.google.com/apikey) works — see [Providers](#providers)).

**1. Install yt-dlp** (it pulls the subtitles):

| OS | Command |
|----|---------|
| macOS | `brew install yt-dlp` |
| Windows | `winget install yt-dlp` |
| Linux / any Python | `pipx install yt-dlp` |

Keep it current with `yt-dlp -U` — YouTube changes often.

**2. Add the package** — any package manager:

```bash
npm  i   yt-briefing
pnpm add yt-briefing
yarn add yt-briefing
bun  add yt-briefing
```

**3. Onboard:**

```bash
npx yt-briefing init      # or: bunx yt-briefing init
```

`init` asks for your language, your keys, the channels to follow, and which agent runs `/yt`.
No build step.

## Run it

Open your project in **Claude Code** or **Cursor** and run **`/yt`**. Not listed? Start a fresh
session. To (re)install the skill for another agent or project: `yt-briefing install-skill`.

## Providers

Any OpenAI-compatible endpoint. **Gemini 2.5 Flash** is the easy default — fast, cheap, free to
start at [Google AI Studio](https://aistudio.google.com/apikey):

```ini
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_API_KEY=<gemini-key>
LLM_MODEL=gemini-2.5-flash
```

> Free-tier Gemini can return a *"model is overloaded / high demand"* error — retry, or switch
> to a paid key (enable billing, same model) to avoid it.

Prefer something else? Change those three lines for OpenRouter (`https://openrouter.ai/api/v1`),
OpenAI (`https://api.openai.com/v1`), or a local Ollama (`http://localhost:11434/v1`).

## Sync across machines

Point `YT_DATA_DIR` at a private git repo and commit after each rating — full recipe in
[docs/sync-across-machines.md](./docs/sync-across-machines.md).

## License

MIT — see [LICENSE](./LICENSE).
