function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToInt16(b64: string): Int16Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 2));
}

function downsampleTo16k(input: Float32Array, inputRate: number): Int16Array {
  const targetRate = 16000;
  if (inputRate <= targetRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }
  const ratio = inputRate / targetRate;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIdx = Math.min(input.length - 1, Math.floor(i * ratio));
    const s = Math.max(-1, Math.min(1, input[srcIdx]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export interface WssMediaRelayOptions {
  localStream: MediaStream | null;
  isVideo: boolean;
  dataSaver: boolean;
  isMuted: () => boolean;
  isCameraOff: () => boolean;
  onSendAudio: (pcmBase64: string, sampleRate: number) => void;
  onSendVideo: (jpegDataUrl: string) => void;
}

export class WssMediaRelay {
  private captureCtx: AudioContext | null = null;
  private playbackCtx: AudioContext | null = null;
  private playbackGain: GainNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silentGain: GainNode | null = null;
  private videoTimer: number | null = null;
  private offscreenVideo: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private nextPlayTime = 0;
  private stopped = false;
  private sampleBuffer: number[] = [];

  start(opts: WssMediaRelayOptions) {
    this.stop();
    this.stopped = false;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    try {
      this.playbackCtx = new AudioCtx();
      this.playbackCtx.resume().catch(() => {});
      this.playbackGain = this.playbackCtx.createGain();
      this.playbackGain.gain.value = 1;
      this.playbackGain.connect(this.playbackCtx.destination);
    } catch {
      this.playbackCtx = null;
    }

    if (opts.localStream && opts.localStream.getAudioTracks().length > 0) {
      try {
        this.captureCtx = new AudioCtx();
        this.captureCtx.resume().catch(() => {});
        const audioOnlyStream = new MediaStream(opts.localStream.getAudioTracks());
        this.sourceNode = this.captureCtx.createMediaStreamSource(audioOnlyStream);
        this.processor = this.captureCtx.createScriptProcessor(2048, 1, 1);
        this.silentGain = this.captureCtx.createGain();
        this.silentGain.gain.value = 0;

        this.processor.onaudioprocess = (ev) => {
          if (this.stopped || opts.isMuted()) return;
          const input = ev.inputBuffer.getChannelData(0);
          const down = downsampleTo16k(input, this.captureCtx?.sampleRate || 48000);
          for (let i = 0; i < down.length; i++) {
            this.sampleBuffer.push(down[i]);
          }
          while (this.sampleBuffer.length >= 1600) {
            const batch = new Int16Array(this.sampleBuffer.splice(0, 1600));
            opts.onSendAudio(int16ToBase64(batch), 16000);
          }
        };

        this.sourceNode.connect(this.processor);
        this.processor.connect(this.silentGain);
        this.silentGain.connect(this.captureCtx.destination);
      } catch {
        // Capture unavailable
      }
    }

    if (opts.isVideo && opts.localStream && opts.localStream.getVideoTracks().length > 0) {
      this.startVideoPump(opts.localStream, opts.dataSaver, opts.isCameraOff, opts.onSendVideo);
    }
  }

  updateVideoStream(
    localStream: MediaStream | null,
    isVideo: boolean,
    dataSaver: boolean,
    isCameraOff: () => boolean,
    onSendVideo: (jpegDataUrl: string) => void
  ) {
    if (this.videoTimer !== null) {
      window.clearInterval(this.videoTimer);
      this.videoTimer = null;
    }
    if (isVideo && localStream && localStream.getVideoTracks().length > 0) {
      this.startVideoPump(localStream, dataSaver, isCameraOff, onSendVideo);
    }
  }

  private startVideoPump(
    stream: MediaStream,
    dataSaver: boolean,
    isCameraOff: () => boolean,
    onSendVideo: (jpegDataUrl: string) => void
  ) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream(stream.getVideoTracks());
    video.play().catch(() => {});
    this.offscreenVideo = video;

    const w = dataSaver ? 180 : 240;
    const h = dataSaver ? 240 : 320;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');

    this.videoTimer = window.setInterval(() => {
      if (this.stopped || isCameraOff() || !ctx || video.readyState < 2) return;
      try {
        ctx.drawImage(video, 0, 0, w, h);
        const jpg = canvas.toDataURL('image/jpeg', dataSaver ? 0.42 : 0.55);
        if (jpg && jpg.length < 48000) {
          onSendVideo(jpg);
        }
      } catch {
        // Ignore transient canvas frame errors
      }
    }, dataSaver ? 220 : 150);
  }

  playIncomingAudio(pcmBase64: string, sampleRate = 16000) {
    if (this.stopped || !this.playbackCtx || !this.playbackGain) return;
    if (this.playbackCtx.state === 'suspended') {
      this.playbackCtx.resume().catch(() => {});
    }
    try {
      const pcm = base64ToInt16(pcmBase64);
      if (pcm.length === 0) return;
      const buf = this.playbackCtx.createBuffer(1, pcm.length, sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) {
        ch[i] = pcm[i] / 0x8000;
      }

      const now = this.playbackCtx.currentTime;
      if (this.nextPlayTime < now || this.nextPlayTime > now + 0.45) {
        this.nextPlayTime = now + 0.04;
      }
      const src = this.playbackCtx.createBufferSource();
      src.buffer = buf;
      src.connect(this.playbackGain);
      src.start(this.nextPlayTime);
      this.nextPlayTime += buf.duration;
    } catch {
      // Ignore malformed audio frame
    }
  }

  setOutputGain(value: number) {
    if (this.playbackGain) {
      this.playbackGain.gain.value = value;
    }
  }

  stop() {
    this.stopped = true;
    this.sampleBuffer = [];
    if (this.videoTimer !== null) {
      window.clearInterval(this.videoTimer);
      this.videoTimer = null;
    }
    if (this.offscreenVideo) {
      this.offscreenVideo.srcObject = null;
      this.offscreenVideo = null;
    }
    this.canvas = null;
    try {
      this.processor?.disconnect();
      this.sourceNode?.disconnect();
      this.silentGain?.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    this.processor = null;
    this.sourceNode = null;
    this.silentGain = null;
    if (this.captureCtx) {
      this.captureCtx.close().catch(() => {});
      this.captureCtx = null;
    }
    if (this.playbackCtx) {
      this.playbackCtx.close().catch(() => {});
      this.playbackCtx = null;
    }
    this.playbackGain = null;
    this.nextPlayTime = 0;
  }
}
