// One AudioContext for the whole app. All avatar speech is played through
// `output`, so lip sync can read `analyser` and the browser's echo canceller
// knows what is coming out of the speakers.

export interface AudioGraph {
  ctx: AudioContext;
  output: GainNode;
  analyser: AnalyserNode;
}

let graph: AudioGraph | null = null;

export function getAudio(): AudioGraph {
  if (!graph) {
    const ctx = new AudioContext({ latencyHint: "interactive" });
    const output = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.5;
    output.connect(analyser);
    analyser.connect(ctx.destination);
    graph = { ctx, output, analyser };
  }
  if (graph.ctx.state === "suspended") void graph.ctx.resume();
  return graph;
}

/** The graph if it exists, without creating it (safe to call every frame). */
export function peekAudio(): AudioGraph | null {
  return graph;
}

/** Call from a user gesture so later playback is not blocked by autoplay rules. */
export function unlockAudio(): void {
  getAudio();
}
