---
type: yt-channel-profile-template
description: Section template for a channel profile. A section exists only when it has real content — never placeholders. An empty profile is just frontmatter + heading.
---

# Channel profile — section template

A channel profile is the durable memory of what's worth watching on a channel. It feeds the engine's two filters (`src/yt-sweep.ts`):

- **Title filter** (keep/skip *before* fetching the transcript) reads: `## Skip titles` (+ rules in `## Notes`). Keep-by-default — it only learns *what to drop* (there is no positive list).
- **Content filter** (writing the summary) gets the **whole profile**; it leans on `## Channel policy`, `## Summary format`, `## Cut sections`, `## Episode types`, `## Notes`.

Frontmatter (always):

```yaml
---
type: yt-channel-profile
name: <slug>-profile
channel: @Handle
channel_url: https://www.youtube.com/@Handle
updated: YYYY-MM-DD
sessions_observed: <int>
---
```

Optional sections. **A section exists ⟺ it has content.** Don't create empty placeholders.

| Section | Function | Source |
|---|---|---|
| `## Channel policy` | Per-channel base policy — short, conceptual: *what to pay attention to on this channel.* | By hand (optional) |
| `## Summary format` | Deviation from the default (numbered thematic sections). Use it when a channel needs a different style (headline-only, "what it was about", per-segment digest). | By hand |
| `## Episode types` | Taxonomy of formats (solo / interview / report / multi-segment). Steers summary style per type. | By hand |
| `## Skip titles` | **Negative** few-shots for the title filter (keep-by-default; learn only what to drop). FIFO cap 10. Format: `- "<title>" — <type>`. | `yt-rating.ts` on `rating=0` |
| `## Cut sections` | Typical intro/outro/sponsor segments to drop before summarizing. Cap 5. | By hand |
| `## Notes` | Durable rules: hard flags, edge cases, links (e.g. a sibling channel's mirror profile). **The permanent home for rules distilled from comments.** | By hand + `yt-rating.ts` on a comment |

## Rating scale

Three signals (UI: one step, two buttons + `Other` for a comment). **The write is immediate and durable — no buffer, no consolidation:**

- **`1` — neutral.** Watched, no signal. **Zero effect** — only bumps the cursor in `state.md` (video checked off); writes nothing to the profile.
- **`0` — worthless.** **Immediately** → `## Skip titles` (cap 10); the title filter learns to skip such titles from the very next sweep.
- **comment** — a generalizable rule. **Immediately** → `## Notes` (seen by both filters). The agent distills the user's raw comment into a clean rule before writing.

There is no positive rating — keeping the channel subscribed is the implicit "plus".
