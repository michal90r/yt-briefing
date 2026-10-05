export type Pending = {
  channel: string
  videoId: string
  title: string
  type: string
  publishedAt: string
}

export type View = {
  phase: 'idle' | 'loading' | 'rating' | 'done' | 'error'
  /** Briefing markdown of the video awaiting a rating. */
  summary?: string
  pending?: Pending
  /** Language the engine writes in; the research hand-off asks for it too. */
  lang?: string
  /** Videos the filters dropped on the way to this one, one line. */
  skipped?: string
  /** Error or status text for the done/error phases. */
  message?: string
  /** Set while a rating or comment is being written; presses are ignored meanwhile. */
  busy?: string
}

declare module 'claude-code' {
  interface PluginState {
    'yt-briefing': { view: View }
  }
}
