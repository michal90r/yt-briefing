// How the pane runs the engine, relative to the project root (the session's working directory).
// This is the dev-clone form; `yt-briefing install-skill` / `init` rewrites it for the project it
// installs into (the compiled dist/ under node_modules, with the runtime that ran the installer).
export const engine = (name: string): string[] => ['bun', `src/${name}.ts`]
