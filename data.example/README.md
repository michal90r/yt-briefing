# data.example — what onboarding generates

`bun run init` creates a real `data/` directory next to this one. This folder is a
reference for the shape of that data, and a home for the channel-profile template.

```
data/
├── config.json          { "output_lang": "English" }   ← your summary/rating language
├── channels.md          the channels you follow (a flat list)
├── state.md             per-channel per-type cursor (last video seen of each type)
├── channels/
│   ├── _template.md     the profile section template (see this folder)
│   └── <slug>.md        one profile per channel — its policy, skip-titles, notes
└── .cache/              throwaway session state (queue/pending/prefetch); safe to delete
```

Everything is plain Markdown / JSON. After onboarding you can edit any of it by hand —
add a channel, tighten a `## Channel policy`, or curate `## Notes`. The two filters pick
up the changes on the next sweep. See `channels/_template.md` for the section conventions.
