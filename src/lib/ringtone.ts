import { setNativeRingtone } from './nativeBridge';

export type RomanticRingtoneId =
  | 'imo_velvet'
  | 'sunset_kalimba'
  | 'midnight_love'
  | 'crystal_dew'
  | 'golden_heart';

export interface RomanticRingtoneOption {
  id: RomanticRingtoneId;
  title: string;
  subtitle: string;
  file: string;
  durationLabel: string;
}

export const ROMANTIC_RINGTONES: RomanticRingtoneOption[] = [
  {
    id: 'imo_velvet',
    title: 'Imo Romantic Breeze',
    subtitle: 'imo স্টাইল · মিষ্টি মারিম্বা ও উজ্জ্বল রোমান্টিক চাইম',
    file: '/ringtones/imo_velvet.wav',
    durationLabel: '4.8s',
  },
  {
    id: 'sunset_kalimba',
    title: 'Sunset Kalimba',
    subtitle: 'নরম ক্যালিম্বা ও হার্প · শান্ত রোমান্টিক সুর',
    file: '/ringtones/sunset_kalimba.wav',
    durationLabel: '5.2s',
  },
  {
    id: 'midnight_love',
    title: 'Midnight Love Harp',
    subtitle: 'আবেগী ভালোবাসার হার্প · মেলোডিক ও স্নিগ্ধ',
    file: '/ringtones/midnight_love.wav',
    durationLabel: '5.4s',
  },
  {
    id: 'crystal_dew',
    title: 'Crystal Dew Bells',
    subtitle: 'মিষ্টি ক্রিস্টাল বেল · দূর থেকেও ঝকঝকে শোনা যায়',
    file: '/ringtones/crystal_dew.wav',
    durationLabel: '4.6s',
  },
  {
    id: 'golden_heart',
    title: 'Golden Heartbeat',
    subtitle: 'ওয়ার্ম ভেলভেট ই-পিয়ানো · আধুনিক রোমান্টিক ভাইব',
    file: '/ringtones/golden_heart.wav',
    durationLabel: '5.0s',
  },
];

const RINGTONE_STORAGE_KEY = 'easycall_ringtone_id';

export function getSelectedRingtoneId(): RomanticRingtoneId {
  try {
    const saved = window.localStorage.getItem(RINGTONE_STORAGE_KEY) as RomanticRingtoneId | null;
    if (saved && ROMANTIC_RINGTONES.some((r) => r.id === saved)) {
      return saved;
    }
  } catch {
    // Ignore storage read errors
  }
  return 'imo_velvet';
}

export function setSelectedRingtoneId(id: RomanticRingtoneId): void {
  try {
    window.localStorage.setItem(RINGTONE_STORAGE_KEY, id);
  } catch {
    // Ignore storage write errors
  }
  setNativeRingtone(id);
}

export function getRingtoneFileUrl(id: RomanticRingtoneId): string {
  const found = ROMANTIC_RINGTONES.find((r) => r.id === id);
  return found ? found.file : '/easycall-ringtone.wav';
}

class RingtonePlayer {
  private ctx: AudioContext | null = null;
  private timer: number | null = null;
  private incomingAudio: HTMLAudioElement | null = null;

  private playTone(freq: number, durationMs: number, delayMs = 0, gainVal = 0.22) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime + delayMs / 1000;
    const osc = this.ctx.createOscillator();
    const harmonic = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const hGain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    harmonic.type = 'triangle';
    harmonic.frequency.setValueAtTime(freq * 2, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(gainVal, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationMs / 1000);

    hGain.gain.setValueAtTime(0.001, now);
    hGain.gain.exponentialRampToValueAtTime(gainVal * 0.3, now + 0.015);
    hGain.gain.exponentialRampToValueAtTime(0.001, now + (durationMs * 0.7) / 1000);

    osc.connect(gain);
    harmonic.connect(hGain);
    gain.connect(this.ctx.destination);
    hGain.connect(this.ctx.destination);

    osc.start(now);
    harmonic.start(now);
    osc.stop(now + durationMs / 1000 + 0.03);
    harmonic.stop(now + durationMs / 1000 + 0.03);
  }

  private startRomanticSynthLoop() {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      const phrase = () => {
        // Backup imo-style romantic marimba motif
        this.playTone(659.25, 420, 0, 0.24);
        this.playTone(783.99, 420, 200, 0.25);
        this.playTone(1046.5, 550, 400, 0.28);
        this.playTone(987.77, 400, 640, 0.24);
        this.playTone(783.99, 520, 860, 0.24);
        this.playTone(659.25, 550, 1120, 0.22);

        this.playTone(698.46, 420, 1520, 0.24);
        this.playTone(880.0, 420, 1720, 0.25);
        this.playTone(1174.66, 550, 1920, 0.28);
        this.playTone(1046.5, 420, 2160, 0.25);
        this.playTone(880.0, 480, 2400, 0.24);
        this.playTone(783.99, 550, 2660, 0.23);

        this.playTone(659.25, 380, 3040, 0.24);
        this.playTone(783.99, 380, 3240, 0.25);
        this.playTone(880.0, 450, 3440, 0.26);
        this.playTone(1046.5, 650, 3680, 0.29);
        this.playTone(783.99, 720, 4000, 0.24);
      };
      phrase();
      this.timer = window.setInterval(phrase, 4800);
    } catch {
      // Ignore autoplay restrictions before user gesture
    }
  }

  private playWavUrl(url: string) {
    this.stop();
    try {
      const audio = new Audio(url);
      audio.loop = true;
      audio.volume = 1.0;
      this.incomingAudio = audio;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          if (this.incomingAudio === audio) {
            this.incomingAudio = null;
            this.startRomanticSynthLoop();
          }
        });
      }
    } catch {
      this.startRomanticSynthLoop();
    }
  }

  preview(id: RomanticRingtoneId) {
    this.playWavUrl(getRingtoneFileUrl(id));
  }

  startIncoming() {
    this.playWavUrl(getRingtoneFileUrl(getSelectedRingtoneId()));
  }

  startOutgoing() {
    this.stop();
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      const pulse = () => {
        this.playTone(440, 750, 0, 0.05);
        this.playTone(480, 750, 0, 0.04);
      };
      pulse();
      this.timer = window.setInterval(pulse, 3000);
    } catch {
      // Ignore autoplay restrictions
    }
  }

  stop() {
    if (this.incomingAudio) {
      try {
        this.incomingAudio.pause();
        this.incomingAudio.currentTime = 0;
      } catch {
        // Ignore stop errors
      }
      this.incomingAudio = null;
    }
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
