export class GameSound {
  private context: AudioContext | null = null;
  private lastTick = -100;
  enabled = true;
  volume = 0.5;
  async activate() {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      if (this.context.state === "suspended") await this.context.resume();
    } catch { /* Audio is optional; every cue also has visual feedback. */ }
  }
  play(kind: "shot" | "hit" | "gold" | "upgrade" | "leak" | "victory" | "defeat", tick = 0) {
    if (!this.enabled || !this.context || this.context.state !== "running") return;
    if (["shot", "hit"].includes(kind) && tick - this.lastTick < 8) return;
    if (["shot", "hit"].includes(kind)) this.lastTick = tick;
    const tones = { shot: [110, 65], hit: [180, 80], gold: [620, 930], upgrade: [440, 880], leak: [200, 100], victory: [520, 1040], defeat: [180, 65] };
    const frequencies = tones[kind], context = this.context, at = context.currentTime;
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = kind === "shot" || kind === "hit" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(frequencies[0]!, at);
    oscillator.frequency.exponentialRampToValueAtTime(frequencies[1]!, at + 0.13);
    gain.gain.setValueAtTime(Math.max(0.001, 0.07 * this.volume), at); gain.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(at); oscillator.stop(at + 0.2);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  reset() { this.lastTick = -100; }
  dispose() { void this.context?.close().catch(() => {}); this.context = null; }
}
