class RingtonePlayer {
  private ctx: AudioContext | null = null;
  private timer: number | null = null;

  private playTone(freq: number, durationMs: number, delayMs = 0, gainVal = 0.08) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime + delayMs / 1000;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(gainVal, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationMs / 1000);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + durationMs / 1000 + 0.02);
  }

  startIncoming() {
    this.stop();
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      const burst = () => {
        this.playTone(587.33, 220, 0, 0.09);
        this.playTone(783.99, 280, 180, 0.09);
        this.playTone(587.33, 220, 520, 0.09);
        this.playTone(783.99, 280, 700, 0.09);
      };
      burst();
      this.timer = window.setInterval(burst, 2400);
    } catch {
      // Ignore autoplay restrictions before user gesture
    }
  }

  startOutgoing() {
    this.stop();
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      const pulse = () => {
        this.playTone(440, 750, 0, 0.04);
        this.playTone(480, 750, 0, 0.03);
      };
      pulse();
      this.timer = window.setInterval(pulse, 3000);
    } catch {
      // Ignore autoplay restrictions
    }
  }

  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

export const ringtone = new RingtonePlayer();
