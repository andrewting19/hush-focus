// Offscreen document for audio playback
// This bypasses Chrome's autoplay policy for extensions

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

function playTone(
  ctx: AudioContext,
  destination: AudioNode,
  frequency: number,
  startTime: number,
  duration: number
): void {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(destination);

  oscillator.frequency.value = frequency;
  oscillator.type = "sine";

  // Gentle envelope
  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(0.8, startTime + 0.03);
  gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.1);
}

async function playSound(type: "block" | "finish"): Promise<void> {
  try {
    const ctx = getAudioContext();

    // Resume AudioContext if suspended
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const now = ctx.currentTime;

    // Create gain node for volume control
    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    masterGain.gain.value = 0.12; // Keep it subtle and refined

    if (type === "block") {
      // Warm, grounding two-note descent
      playTone(ctx, masterGain, 392, now, 0.2); // G4
      playTone(ctx, masterGain, 294, now + 0.15, 0.25); // D4
    } else {
      // Gentle ascending resolution
      playTone(ctx, masterGain, 523, now, 0.15); // C5
      playTone(ctx, masterGain, 659, now + 0.12, 0.15); // E5
      playTone(ctx, masterGain, 784, now + 0.24, 0.22); // G5
    }

  } catch {
    // Audio playback failed silently
  }
}

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "PLAY_SOUND" && message.sound) {
    playSound(message.sound);
  }
});
