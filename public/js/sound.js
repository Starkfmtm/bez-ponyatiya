let audioCtx = null;

export function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

// Глобальная инициализация AudioContext на любой клик пользователя (препятствует блокировке звука браузером)
if (typeof window !== 'undefined') {
  const resumeAudioContext = () => {
    initAudio();
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  };
  window.addEventListener('click', resumeAudioContext, { passive: true });
  window.addEventListener('touchstart', resumeAudioContext, { passive: true });
}

export function playSound(type) {
  initAudio();
  if (!audioCtx) return;
  
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  if (type === 'click') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(150, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
  } 
  else if (type === 'correct') {
    const now = audioCtx.currentTime;
    osc.type = 'triangle';
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 0.45);

    osc.frequency.setValueAtTime(523.25, now); 
    osc.frequency.setValueAtTime(659.25, now + 0.08); 
    osc.frequency.setValueAtTime(783.99, now + 0.16); 
    osc.frequency.setValueAtTime(1046.50, now + 0.24); 
    osc.start();
    osc.stop(now + 0.45);
  } 
  else if (type === 'incorrect') {
    const now = audioCtx.currentTime;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(130, now);
    osc.frequency.linearRampToValueAtTime(80, now + 0.35);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 0.35);
    osc.start();
    osc.stop(now + 0.35);
  }
  else if (type === 'alarm') {
    const now = audioCtx.currentTime;
    for (let i = 0; i < 5; i++) {
      const alarmOsc = audioCtx.createOscillator();
      const alarmGain = audioCtx.createGain();
      alarmOsc.connect(alarmGain);
      alarmGain.connect(audioCtx.destination);
      
      alarmOsc.type = 'sine';
      const freq = i % 2 === 0 ? 880 : 987.77; 
      const startTime = now + (i * 0.08);
      
      alarmOsc.frequency.setValueAtTime(freq, startTime);
      alarmGain.gain.setValueAtTime(0.38, startTime);
      alarmGain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.07);
      
      alarmOsc.start(startTime);
      alarmOsc.stop(startTime + 0.08);
    }
  }
}