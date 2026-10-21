// Replay clock for the client-side sources (file replay, demo simulator): seconds that advance at `speed` x real time and stand
// still while paused. Mirrors Clock in plant/feed.py, which does the same for the plant replay on the server.
export const SPEEDS = [0.5, 1, 2];

export class ReplayClock {
  constructor(now = () => performance.now() / 1000) { this.now = now; this.pos = 0; this.w = now(); this.paused = false; this.speed = 1; }
  get() { return this.pos + (this.paused ? 0 : (this.now() - this.w) * this.speed); }
  set({ paused = this.paused, speed = this.speed } = {}) {
    if (!SPEEDS.includes(speed)) return;
    this.pos = this.get(); this.w = this.now(); this.paused = !!paused; this.speed = speed;
  }
  reset() { this.pos = 0; this.w = this.now(); }
}

/** 42 -> "0:42", 90 -> "1:30" */
export const fmtClock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
