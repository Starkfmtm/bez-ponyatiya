import { playSound } from './sound.js';

export function showToast(text, duration = 3000, isSuccess = true) {
  const toast = document.getElementById('game-toast');
  const toastText = document.getElementById('game-toast-text');
  if (!toast || !toastText) return;
  toastText.textContent = text;
  
  if (isSuccess) {
    toast.className = "fixed top-4 left-1/2 -translate-x-1/2 bg-green-400 text-black border-4 border-black px-6 py-3 rounded-2xl font-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] z-50 transform scale-100 transition-all duration-300";
  } else {
    toast.className = "fixed top-4 left-1/2 -translate-x-1/2 bg-red-400 text-white border-4 border-black px-6 py-3 rounded-2xl font-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] z-50 transform scale-100 transition-all duration-300";
  }

  setTimeout(() => {
    toast.className = "fixed top-4 left-1/2 -translate-x-1/2 bg-yellow-400 text-black border-4 border-black px-6 py-3 rounded-2xl font-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] z-50 transform scale-0 transition-all duration-300";
  }, duration);
}

export function triggerConfetti() {
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    });
  }
}

export function triggerCelebrationConfetti() {
  if (typeof confetti === 'function') {
    var end = Date.now() + (3.5 * 1000); 
    (function frame() {
      confetti({
        particleCount: 2,
        angle: 60,
        spread: 55,
        origin: { x: 0 }
      });
      confetti({
        particleCount: 2,
        angle: 120,
        spread: 55,
        origin: { x: 1 }
      });
      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    }());
  }
}

export function renderNotepad(historyArray) {
  const yesLog = document.getElementById('notepad-yes-log');
  const noLog = document.getElementById('notepad-no-log');
  if (!yesLog || !noLog) return; 
  
  yesLog.innerHTML = '';
  noLog.innerHTML = '';

  const yesItems = historyArray ? historyArray.filter(item => item.verdict && item.verdict.includes('ДА')) : [];
  const noItems = historyArray ? historyArray.filter(item => !item.verdict || !item.verdict.includes('ДА')) : [];

  yesItems.forEach(item => {
    const itemEl = document.createElement('div');
    itemEl.className = "text-[11px] text-stone-900 font-semibold border-b border-green-300/80 truncate px-1";
    itemEl.style.lineHeight = "28px";
    itemEl.style.height = "28px";
    itemEl.textContent = `• ${item.question}`;
    yesLog.appendChild(itemEl);
  });

  noItems.forEach(item => {
    const itemEl = document.createElement('div');
    itemEl.className = "text-[11px] text-stone-900 font-semibold border-b border-red-300/80 truncate px-1";
    itemEl.style.lineHeight = "28px";
    itemEl.style.height = "28px";
    itemEl.textContent = `• ${item.question}`;
    noLog.appendChild(itemEl);
  });

  fillWithLines(yesLog, Math.max(5, yesItems.length), "border-green-300/80");
  fillWithLines(noLog, Math.max(5, noItems.length), "border-red-300/80");

  yesLog.scrollTop = yesLog.scrollHeight;
  noLog.scrollTop = noLog.scrollHeight;
}

function fillWithLines(element, targetCount, borderClass) {
  if (!element) return;
  const currentCount = element.children.length;
  if (currentCount < targetCount) {
    for (let i = 0; i < (targetCount - currentCount); i++) {
      const emptyLine = document.createElement('div');
      emptyLine.style.height = "28px";
      emptyLine.className = `border-b ${borderClass}`;
      element.appendChild(emptyLine);
    }
  }
}

export function renderHistory(historyArray, logElement) {
  if (!logElement) return;
  logElement.innerHTML = '';

  if (!historyArray || historyArray.length === 0) {
    logElement.innerHTML = '<div class="text-stone-400 italic">Записей пока нет...</div>';
    return;
  }

  historyArray.forEach(item => {
    const logItem = document.createElement('div');
    logItem.className = "flex flex-col gap-1 border-b border-black/10 pb-1 text-[11px] leading-tight";
    const verdictColor = (item.verdict && item.verdict.includes('ДА')) ? 'text-green-600' : (item.verdict && item.verdict.includes('НЕТ') ? 'text-red-600' : 'text-amber-600');
    
    logItem.innerHTML = `
      <div class="flex justify-between items-start gap-1">
        <span class="break-words text-left">❓ ${item.question}</span>
        <span class="${verdictColor} font-black shrink-0">${item.verdict}</span>
      </div>
    `;
    logElement.appendChild(logItem);
  });

  logElement.scrollTop = logElement.scrollHeight;
}

export function updateLobbyUI(players, isHost, myName) {
  const playersList = document.getElementById('players-list');
  const playerCount = document.getElementById('player-count');
  const hostControls = document.getElementById('host-controls');
  const guestStatus = document.getElementById('guest-status');
  if (!playersList || !playerCount) return;

  playersList.innerHTML = '';
  playerCount.textContent = players.length;

  const rotations = ['rotate-[-2deg]', 'rotate-[1.5deg]', 'rotate-[-1deg]', 'rotate-[2.5deg]', 'rotate-[-1.5deg]', 'rotate-[2deg]'];

  players.forEach((player, index) => {
    const rotationClass = rotations[index % rotations.length];
    const card = document.createElement('div');
    
    const isOffline = player.online === false;
    const offlineBadge = isOffline ? '<span class="text-[8px] bg-red-500 text-white px-1 py-0.5 rounded ml-1 uppercase">Вышел</span>' : '';

    card.className = `text-black border-4 border-black p-3 rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] ${rotationClass} flex flex-col justify-between min-h-[145px] w-full relative overflow-visible`;
    card.style.backgroundColor = player.color || '#fff1f2';

    const badgeHTML = player.isHost 
      ? '<span class="text-[9px] font-black uppercase bg-pink-500 text-white px-2 py-0.5 rounded border-2 border-black rotate-[2deg] shadow-[1px_1px_0px_rgba(0,0,0,1)] inline-block">ХОСТ</span>' 
      : '<span class="text-[9px] font-black uppercase bg-white text-black px-2 py-0.5 rounded border-2 border-black rotate-[-2deg] shadow-[1px_1px_0px_rgba(0,0,0,1)] inline-block">ИГРОК</span>';

    const isMeHTML = player.name === myName 
      ? '<span class="text-[9px] font-black uppercase bg-yellow-400 text-black px-1.5 py-0.5 rounded border-2 border-black rotate-[-3deg] shadow-[1px_1px_0px_rgba(0,0,0,1)] inline-block mr-1">ТЫ</span>' 
      : '';

    card.innerHTML = `
      <div class="absolute -left-[11px] top-[66%] -translate-y-1/2 w-5 h-5 rounded-full bg-[#1a1c47] border-r-4 border-black z-20"></div>
      <div class="absolute -right-[11px] top-[66%] -translate-y-1/2 w-5 h-5 rounded-full bg-[#1a1c47] border-l-4 border-black z-20"></div>

      <!-- Приглушенная прозрачность водяного знака для читаемости -->
      <div class="absolute top-0 inset-x-0 h-[66%] flex items-center justify-center pointer-events-none z-0 overflow-hidden select-none">
        <span class="text-[64px] sm:text-[72px] select-none filter opacity-[0.12] pointer-events-none" style="mix-blend-mode: multiply;">${player.avatar || '🐱'}</span>
      </div>

      <div class="flex items-center justify-between w-full select-none z-10 relative">
        <div class="flex flex-col items-start leading-none opacity-70">
          <span class="text-[7px] font-mono tracking-wider font-black">PASS #00${index + 1}</span>
          <span class="text-[9px] font-mono tracking-[-0.5px] mt-0.5 select-none font-black">||||| || |||</span>
        </div>
        <div class="flex items-center">
          ${isMeHTML}
          ${badgeHTML}
        </div>
      </div>

      <div class="h-10 z-10"></div>

      <div class="w-full border-t-4 border-dashed border-black/20 my-1 z-10 relative"></div>

      <!-- Белая плашка для идеальной видимости никнейма -->
      <div class="w-full text-center z-10 relative mt-0.5 flex justify-center">
        <span class="inline-block bg-white text-black border-2 border-black px-2.5 py-1 rounded-lg font-black text-xs sm:text-sm tracking-tight leading-none truncate max-w-full uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)]" title="${player.name}">
          ${player.name}${offlineBadge}
        </span>
      </div>
    `;
    playersList.appendChild(card);
  });

  if (isHost) {
    if (hostControls) hostControls.classList.remove('hidden');
    if (guestStatus) guestStatus.classList.add('hidden');
  } else {
    if (hostControls) hostControls.classList.add('hidden');
    if (guestStatus) guestStatus.classList.remove('hidden');
  }
}

export function updateResultsUI(players, achievements, myName) {
  const resultsList = document.getElementById('results-list');
  if (!resultsList) return;
  resultsList.innerHTML = '';

  const myData = players.find(p => p.name === myName);
  const resultsMascot = document.getElementById('results-mascot');

  if (resultsMascot && myData) {
    resultsMascot.src = myData.hasGuessed ? 'mascot-happy.png' : 'mascot-sad.png';
  }

  const sortedPlayers = [...players].sort((a, b) => (b.hasGuessed ? 1 : 0) - (a.hasGuessed ? 1 : 0));
  const tilts = ['rotate-[-1.5deg]', 'rotate-[1.2deg]', 'rotate-[-2deg]', 'rotate-[1.8deg]', 'rotate-[-0.8deg]'];

  sortedPlayers.forEach((player, index) => {
    const rotationClass = tilts[index % tilts.length];
    const isWinner = index === 0 && player.hasGuessed;

    const awardText = (achievements && achievements[player.name]) ? achievements[player.name] : null;
    const awardBadge = awardText ? `
      <div class="mt-2.5 bg-purple-600 text-white border-2 border-black px-2.5 py-1 rounded-xl text-[10px] font-black tracking-wide inline-block shadow-[2px_2px_0px_rgba(0,0,0,1)] uppercase">
        🏆 ${awardText}
      </div>
    ` : '';

    const wrapper = document.createElement('div');
    wrapper.className = 'w-full animate-bounce-pop';
    wrapper.style.animationDelay = `${index * 150}ms`;
    wrapper.style.opacity = '0';
    wrapper.style.animationFillMode = 'forwards';

    const card = document.createElement('div');
    
    if (isWinner) {
      card.className = `bg-yellow-400 text-black border-4 border-black p-4 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] ${rotationClass} relative animate-winner-float`;
      card.innerHTML = `
        <div class="absolute -top-5 -left-3 text-4xl rotate-[-15deg]">👑</div>
        <div class="flex justify-between items-center relative z-0">
          <div>
            <p class="text-[10px] font-black uppercase text-amber-950 tracking-wider">Победитель партии!</p>
            <h3 class="font-title text-xl font-black uppercase leading-tight">${player.name} ${player.name === myName ? '(Ты)' : ''}</h3>
            <p class="text-xs font-bold opacity-80">Угадал роль: <span class="underline font-black">${player.character}</span></p>
            ${awardBadge}
          </div>
          <div class="shrink-0 ml-2">
            <span class="bg-black text-yellow-400 font-black px-2.5 py-1 rounded-full text-[10px] uppercase border-2 border-black">ЧЕМПИОН</span>
          </div>
        </div>
      `;
    } else {
      const cardBg = player.hasGuessed ? 'bg-cyan-400 text-black' : 'bg-indigo-950/60 text-indigo-200 opacity-80';
      const labelText = player.hasGuessed ? 'Тоже угадал!' : 'Не успел отгадать';
      const textStyle = player.hasGuessed ? 'text-black font-black' : 'text-white opacity-70';

      card.className = `${cardBg} border-4 border-black p-3 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] ${rotationClass}`;
      card.innerHTML = `
        <div class="flex justify-between items-center">
          <div>
            <p class="text-[9px] font-black uppercase tracking-wider opacity-70">${labelText}</p>
            <h4 class="font-title text-base leading-tight ${textStyle}">${player.name} ${player.name === myName ? '(Ты)' : ''}</h4>
            <p class="text-xs font-bold opacity-80">Тайная роль: <span class="underline font-black">${player.character}</span></p>
            ${awardBadge}
          </div>
        </div>
      `;
    }
    
    wrapper.appendChild(card);
    resultsList.appendChild(wrapper);
  });
}

export function renderTargetPlayerTicket(player, container, index) {
  if (!container || !player) return;
  
  // w-[210px] sm:w-[230px] и shrink-0 принудительно запрещают сжатие билета на любых экранах
  container.className = "text-black border-4 border-black p-3 rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-between min-h-[145px] w-[210px] sm:w-[230px] relative overflow-visible transform rotate-[1deg] text-left shrink-0";
  container.style.backgroundColor = player.color || '#fff1f2';
  
  const badgeHTML = player.isHost 
    ? '<span class="text-[9px] font-black uppercase bg-pink-500 text-white px-2 py-0.5 rounded border-2 border-black rotate-[2deg] shadow-[1px_1px_0px_rgba(0,0,0,1)] inline-block">ХОСТ</span>' 
    : '<span class="text-[9px] font-black uppercase bg-white text-black px-2 py-0.5 rounded border-2 border-black rotate-[-2deg] shadow-[1px_1px_0px_rgba(0,0,0,1)] inline-block">ИГРОК</span>';

  container.innerHTML = `
    <div class="absolute -left-[11px] top-[66%] -translate-y-1/2 w-5 h-5 rounded-full bg-[#1a1c47] border-r-4 border-black z-20"></div>
    <div class="absolute -right-[11px] top-[66%] -translate-y-1/2 w-5 h-5 rounded-full bg-[#1a1c47] border-l-4 border-black z-20"></div>

    <!-- Очень тонкий водяной знак (прозрачность 0.12) для устранения каши за текстом -->
    <div class="absolute top-0 inset-x-0 h-[66%] flex items-center justify-center pointer-events-none z-0 overflow-hidden select-none">
      <span class="text-[64px] sm:text-[72px] select-none filter opacity-[0.12] pointer-events-none" style="mix-blend-mode: multiply;">${player.avatar || '🐱'}</span>
    </div>

    <div class="flex items-center justify-between w-full select-none z-10 relative">
      <div class="flex flex-col items-start leading-none opacity-70">
        <span class="text-[7px] font-mono tracking-wider font-black">PASS #00${index + 1}</span>
        <span class="text-[9px] font-mono tracking-[-0.5px] mt-0.5 select-none font-black">||||| || |||</span>
      </div>
      <div class="flex items-center">
        ${badgeHTML}
      </div>
    </div>

    <div class="h-10 z-10"></div>

    <div class="w-full border-t-4 border-dashed border-black/20 my-1 z-10 relative"></div>

    <!-- Защитная белая плашка для безупречного считывания никнейма на любом фоне -->
    <div class="w-full text-center z-10 relative mt-0.5 flex justify-center">
      <span class="inline-block bg-white text-black border-2 border-black px-2.5 py-1 rounded-lg font-black text-xs sm:text-sm tracking-tight leading-none truncate max-w-full uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)]" title="${player.name}">
        ${player.name}
      </span>
    </div>
  `;
}