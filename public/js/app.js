import { playSound } from './sound.js';
import { 
  showToast, 
  triggerConfetti, 
  triggerCelebrationConfetti, 
  renderNotepad, 
  renderHistory, 
  updateLobbyUI, 
  updateResultsUI 
} from './ui.js';
import { 
  bgCanvas, 
  resizeCanvas, 
  setupBrush, 
  startDrawBg, 
  drawBg, 
  stopDrawBg, 
  drawSegment, 
  setBrushColor, 
  clearBgCanvas 
} from './canvas.js';

const socket = io();

let currentRoomCode = '';
let myName = '';
let isHost = false;
let activePlayerId = '';
let lastAskedQuestion = '';

// DOM ссылки
const screenWelcome = document.getElementById('screen-welcome');
const screenLobby = document.getElementById('screen-lobby');
const screenInput = document.getElementById('screen-input');
const screenGame = document.getElementById('screen-game');
const screenResults = document.getElementById('screen-results');

const btnCreate = document.getElementById('btn-create');
const btnJoin = document.getElementById('btn-join');
const usernameInput = document.getElementById('username');
const roomCodeInput = document.getElementById('room-code');

const selectTimer = document.getElementById('settings-timer-duration');
const selectTurnTimer = document.getElementById('settings-turn-duration');

const lobbyCodeDisplay = document.getElementById('lobby-code-display');
const btnStart = document.getElementById('btn-start');
const btnLeave = document.getElementById('btn-leave');

const targetPlayerDisplay = document.getElementById('target-player-display');
const characterInput = document.getElementById('character-input');
const btnSubmit = document.getElementById('btn-submit');
const inputFormZone = document.getElementById('input-form-zone');
const waitingZone = document.getElementById('waiting-zone');
const timerBar = document.getElementById('timer-bar');

const gameActivePlayer = document.getElementById('game-active-player');
const gameAnswererZone = document.getElementById('game-answerer-zone');
const gameActiveRoundContent = document.getElementById('game-active-round-content');
const gameGuesserZone = document.getElementById('game-guesser-zone');
const secretCharacterDisplay = document.getElementById('secret-character-display');
const gameQuestionText = document.getElementById('game-question-text');
const questionInputBlock = document.getElementById('question-input-block');
const liveVotesResults = document.getElementById('live-votes-results');
const voteProgressStatus = document.getElementById('vote-progress-status');
const votedCountDisplay = document.getElementById('voted-count-display');
const votersTotalDisplay = document.getElementById('voted-total-display');
const votingButtonsGrid = document.getElementById('voting-buttons-grid');
const gameHistoryLog = document.getElementById('game-history-log');
const myPersonalHistoryBlock = document.getElementById('my-personal-history-block');
const reactionPanel = document.getElementById('reaction-panel');

const btnRestart = document.getElementById('btn-restart');
const btnMainMenu = document.getElementById('btn-main-menu');

// Инициализация событий при загрузке DOM
window.addEventListener('DOMContentLoaded', () => {
  resizeCanvas();

  // Привязка рисования
  if (bgCanvas) {
    bgCanvas.addEventListener('mousedown', startDrawBg);
    window.addEventListener('mousemove', (e) => drawBg(e, currentRoomCode, socket));
    window.addEventListener('mouseup', stopDrawBg);

    bgCanvas.addEventListener('touchstart', startDrawBg);
    window.addEventListener('touchmove', (e) => drawBg(e, currentRoomCode, socket));
    window.addEventListener('touchend', stopDrawBg);
  }

  const btnClearDrawings = document.getElementById('btn-clear-drawings');
  if (btnClearDrawings) {
    btnClearDrawings.addEventListener('click', () => {
      if (currentRoomCode) {
        socket.emit('clear_drawings', { roomCode: currentRoomCode });
      }
    });
  }

  // Навесим слушатели настроек
  const collectAndSendOptions = () => {
    if (!isHost || !currentRoomCode) return;
    socket.emit('update_room_options', {
      roomCode: currentRoomCode,
      options: {
        inputTimerDuration: parseInt(selectTimer.value, 10),
        turnTimerDuration: parseInt(selectTurnTimer.value, 10)
      }
    });
  };

  if (selectTimer) selectTimer.addEventListener('change', collectAndSendOptions);
  if (selectTurnTimer) selectTurnTimer.addEventListener('change', collectAndSendOptions);

  // Навесим интерактивные кнопки
  if (btnCreate) {
    btnCreate.addEventListener('click', () => {
      playSound('click');
      const name = usernameInput.value.trim();
      if (!name) return showToast('Имя введи!', 3000, false);
      myName = name;
      sessionStorage.setItem('username', name); 
      socket.emit('create_room', { username: name });
    });
  }

  if (btnJoin) {
    btnJoin.addEventListener('click', () => {
      playSound('click');
      const name = usernameInput.value.trim();
      const code = roomCodeInput.value.trim();
      if (!name || code.length < 4) return showToast('Заполни поля имени и кода комнаты!', 3000, false);
      myName = name;
      sessionStorage.setItem('username', name); 
      sessionStorage.setItem('roomCode', code);   
      socket.emit('join_room', { username: name, roomCode: code });
    });
  }

  if (btnStart) {
    btnStart.addEventListener('click', () => {
      playSound('click');
      socket.emit('start_game', { roomCode: currentRoomCode });
    });
  }

  if (btnSubmit) {
    btnSubmit.addEventListener('click', () => {
      playSound('click');
      const text = characterInput.value.trim();
      if (!text) return showToast('Введи персонажа!', 3000, false);
      socket.emit('submit_character', { roomCode: currentRoomCode, character: text });
    });
  }

  const btnAsk = document.getElementById('btn-ask');
  if (btnAsk) {
    btnAsk.addEventListener('click', () => {
      playSound('alarm');
      const qInput = document.getElementById('question-input');
      const questionText = qInput.value.trim();
      if (!questionText) return showToast('Запиши вопрос сначала!', 3000, false);
      
      btnAsk.disabled = true;
      const btnGuess = document.getElementById('btn-guess-attempt');
      if (btnGuess) btnGuess.disabled = true;
      btnAsk.classList.add('opacity-50', 'cursor-not-allowed');
      if (btnGuess) btnGuess.classList.add('opacity-50', 'cursor-not-allowed');

      socket.emit('submit_question', { roomCode: currentRoomCode, question: questionText });
      qInput.value = '';
    });
  }

  const btnGuess = document.getElementById('btn-guess-attempt');
  if (btnGuess) {
    btnGuess.addEventListener('click', () => {
      const guess = prompt('Кто ты? Напиши имя персонажа:');
      if (guess && guess.trim() !== '') {
        playSound('alarm');
        socket.emit('guess_attempt', { roomCode: currentRoomCode, guess });
      }
    });
  }

  if (btnRestart) {
    btnRestart.addEventListener('click', () => {
      playSound('click');
      socket.emit('request_restart', { roomCode: currentRoomCode });
    });
  }

  if (btnLeave) {
    btnLeave.addEventListener('click', () => {
      playSound('click');
      sessionStorage.clear();
      location.reload();
    });
  }

  if (btnMainMenu) {
    btnMainMenu.addEventListener('click', () => {
      playSound('click');
      sessionStorage.clear();
      location.reload();
    });
  }

  // Привязка эмодзи-реакций
  const reactionMapping = {
    'btn-reaction-go': 'ГО!',
    'btn-reaction-laugh': '😂',
    'btn-reaction-poop': '💩',
    'btn-reaction-party': '🎉',
    'btn-reaction-shock': '😱'
  };

  Object.entries(reactionMapping).forEach(([id, emoji]) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener('click', () => {
        playSound('click');
        if (currentRoomCode) {
          socket.emit('send_reaction', { roomCode: currentRoomCode, emoji });
        }
      });
    }
  });
});

// СОБЫТИЯ SOCKET.IO
socket.on('room_created', (data) => {
  currentRoomCode = data.roomCode;
  sessionStorage.setItem('roomCode', currentRoomCode);
  isHost = true;
  if (lobbyCodeDisplay) lobbyCodeDisplay.textContent = currentRoomCode;
  syncLobbySettingsUI(data.options);
  showScreen(screenLobby);
  updateLobbyUI(data.players, isHost, myName);

  const me = data.players.find(p => p.socketId === socket.id);
  if (me && me.color) setBrushColor(me.color);
});

socket.on('room_state_update', (data) => {
  currentRoomCode = data.roomCode;
  if (lobbyCodeDisplay) lobbyCodeDisplay.textContent = currentRoomCode;
  const me = data.players.find(p => p.name === myName);
  if (me) isHost = me.isHost;
  
  syncLobbySettingsUI(data.options);
  showScreen(screenLobby);
  updateLobbyUI(data.players, isHost, myName);

  const mePlayer = data.players.find(p => p.socketId === socket.id);
  if (mePlayer && mePlayer.color) setBrushColor(mePlayer.color);
});

socket.on('timer_tick', (data) => {
  const duration = data.duration || 60;
  const percentage = (data.timeLeft / duration) * 100;
  if (timerBar) timerBar.style.width = percentage + '%';
});

socket.on('turn_timer_tick', (data) => {
  const bar = document.getElementById('turn-timer-bar');
  if (bar) {
    if (data.timeLeft === null || data.duration === null || data.duration === 0) {
      bar.style.width = '100%';
      bar.parentElement.classList.add('hidden');
    } else {
      bar.parentElement.classList.remove('hidden');
      const percentage = (data.timeLeft / data.duration) * 100;
      bar.style.width = percentage + '%';
    }
  }
});

socket.on('toast_broadcast', (data) => {
  showToast(data.message, 4000, data.isSuccess);
});

socket.on('game_state_update', (data) => {
  if (!data) return;

  if (data.roomCode) {
    currentRoomCode = data.roomCode;
    sessionStorage.setItem('roomCode', currentRoomCode);
  }

  if (data.status === 'INPUTTING') {
    if (targetPlayerDisplay) targetPlayerDisplay.textContent = data.targetName || '---';
    showScreen(screenInput);

    const me = data.players ? data.players.find(p => p.socketId === socket.id) : null;
    const progressList = document.getElementById('input-progress-list');
    if (progressList) {
      progressList.innerHTML = '';
      const playersArray = data.players || [];
      playersArray.forEach(p => {
        const statusIcon = p.hasSubmitted ? '<span class="text-green-400">✅ Готов</span>' : '<span class="text-yellow-400 animate-pulse">✍️ Думает...</span>';
        const item = document.createElement('div');
        item.className = 'flex justify-between items-center border-b border-white/5 pb-1';
        item.innerHTML = `<span>${p.name}</span> ${statusIcon}`;
        progressList.appendChild(item);
      });
    }

    if (me && me.hasSubmitted) {
      if (inputFormZone) inputFormZone.classList.add('hidden');
      if (waitingZone) waitingZone.classList.remove('hidden');
    } else {
      if (inputFormZone) inputFormZone.classList.remove('hidden');
      if (waitingZone) waitingZone.classList.add('hidden');
    }
  } 
  else if (data.status === 'PLAYING') {
    activePlayerId = data.activePlayerId || '';
    showScreen(screenGame);

    const playersArray = data.players || [];
    const activePlayer = playersArray.find(p => p.socketId === activePlayerId);

    const verBlock = document.getElementById('guess-verification-block');
    if (verBlock) verBlock.classList.add('hidden');
    if (gameActiveRoundContent) gameActiveRoundContent.classList.remove('hidden');
    
    const waitBlock = document.getElementById('guess-waiting-block');
    if (waitBlock) waitBlock.classList.add('hidden');
    
    const btnAsk = document.getElementById('btn-ask');
    const btnGuess = document.getElementById('btn-guess-attempt');
    if (btnAsk && btnGuess) {
      btnAsk.disabled = false;
      btnGuess.disabled = false;
      btnAsk.classList.remove('opacity-50', 'cursor-not-allowed');
      btnGuess.classList.remove('opacity-50', 'cursor-not-allowed');
    }

    renderNotepad(data.myPersonalHistory || []);
    renderHistory(data.activePlayerHistory || [], gameHistoryLog);

    const mePlayer = playersArray.find(p => p.socketId === socket.id);
    if (mePlayer && mePlayer.color) {
      setBrushColor(mePlayer.color);
    }

    if (myPersonalHistoryBlock) myPersonalHistoryBlock.classList.remove('hidden');
    if (reactionPanel) reactionPanel.classList.remove('hidden');

    const subtitleEl = document.getElementById('game-active-subtitle');
    const activePlayerEl = document.getElementById('game-active-player');

    if (socket.id === activePlayerId) {
      if (subtitleEl) subtitleEl.textContent = 'Твоя очередь!';
      if (activePlayerEl) {
        activePlayerEl.textContent = 'ТЫ ОТГАДЫВАЕШЬ!';
        activePlayerEl.className = 'text-2xl font-black text-pink-500 uppercase tracking-wide drop-shadow-[2px_2px_0px_rgba(0,0,0,1)]';
      }
      const historyBlock = document.getElementById('game-history-block');
      if (historyBlock) historyBlock.classList.add('hidden');

      if (gameAnswererZone) gameAnswererZone.classList.add('hidden');
      if (gameGuesserZone) gameGuesserZone.classList.remove('hidden');
      if (questionInputBlock) questionInputBlock.classList.remove('hidden');
      if (liveVotesResults) liveVotesResults.classList.add('hidden');
    } else {
      if (subtitleEl) subtitleEl.textContent = 'Сейчас угадывает:';
      if (activePlayerEl) {
        activePlayerEl.textContent = activePlayer ? activePlayer.name : '---';
        activePlayerEl.className = 'text-2xl font-black text-yellow-300 uppercase tracking-wide drop-shadow-[2px_2px_0px_rgba(0,0,0,1)]';
      }
      const historyBlock = document.getElementById('game-history-block');
      if (historyBlock) historyBlock.classList.remove('hidden');

      if (gameAnswererZone) gameAnswererZone.classList.remove('hidden');
      if (gameGuesserZone) gameGuesserZone.classList.add('hidden');
      
      if (secretCharacterDisplay) {
        secretCharacterDisplay.textContent = activePlayer ? (activePlayer.character || '---') : '---';
      }
      if (gameQuestionText) gameQuestionText.textContent = 'Ожидаем вопрос...';
      if (votingButtonsGrid) votingButtonsGrid.classList.add('hidden');
      if (voteProgressStatus) voteProgressStatus.classList.add('hidden');
    }

    if (data.currentQuestion) {
      lastAskedQuestion = data.currentQuestion;

      if (socket.id !== activePlayerId) {
        if (gameQuestionText) gameQuestionText.textContent = `«${data.currentQuestion}»`;
        if (votingButtonsGrid) votingButtonsGrid.classList.remove('hidden');
        if (voteProgressStatus) voteProgressStatus.classList.remove('hidden');
        if (votedCountDisplay) votedCountDisplay.textContent = data.votedPlayers ? data.votedPlayers.length : '0';

        const eligibleVoters = playersArray.filter(p => p.socketId !== activePlayerId && p.online);
        if (votersTotalDisplay) votersTotalDisplay.textContent = eligibleVoters.length || '1';

        const hasVoted = data.votedPlayers && data.votedPlayers.includes(socket.id);
        if (hasVoted) {
          if (votingButtonsGrid) votingButtonsGrid.classList.add('hidden');
        }
      } else {
        if (questionInputBlock) questionInputBlock.classList.add('hidden');
        if (liveVotesResults) liveVotesResults.classList.remove('hidden');
        
        const voteYes = document.getElementById('vote-yes-count');
        const voteNo = document.getElementById('vote-no-count');
        const voteDontKnow = document.getElementById('vote-dontknow-count');
        
        if (voteYes) voteYes.textContent = data.votes ? (data.votes.yes || 0) : '0';
        if (voteNo) voteNo.textContent = data.votes ? (data.votes.no || 0) : '0';
        if (voteDontKnow) voteDontKnow.textContent = data.votes ? (data.votes.dont_know || 0) : '0';
      }
    }
  }
  else if (data.status === 'RESULTS') {
    if (reactionPanel) reactionPanel.classList.add('hidden');
    if (myPersonalHistoryBlock) myPersonalHistoryBlock.classList.add('hidden');
    if (btnRestart) btnRestart.textContent = 'Еще разок!';
    showScreen(screenResults);
    updateResultsUI(data.players || [], data.achievements || {}, myName);
    triggerCelebrationConfetti();
  }
});

socket.on('question_broadcast', (data) => {
  lastAskedQuestion = data.question;
  activePlayerId = data.activePlayerId;

  const verdictText = document.getElementById('vote-verdict-text');
  if (verdictText) verdictText.classList.add('hidden');

  if (socket.id !== activePlayerId) {
    if (gameQuestionText) gameQuestionText.textContent = `«${data.question}»`;
    if (votingButtonsGrid) votingButtonsGrid.classList.remove('hidden');
    if (voteProgressStatus) voteProgressStatus.classList.remove('hidden');
    if (votedCountDisplay) votedCountDisplay.textContent = '0';

    const eligibleVoters = data.players ? data.players.filter(p => p.socketId !== activePlayerId && p.online) : [];
    if (votersTotalDisplay) votersTotalDisplay.textContent = eligibleVoters.length || '1';

    const buttons = document.querySelectorAll('#voting-buttons-grid button');
    buttons.forEach(btn => btn.disabled = false);
  } else {
    if (questionInputBlock) questionInputBlock.classList.add('hidden');
    if (liveVotesResults) liveVotesResults.classList.remove('hidden');
    
    const voteYes = document.getElementById('vote-yes-count');
    const voteNo = document.getElementById('vote-no-count');
    const voteDontKnow = document.getElementById('vote-dontknow-count');
    
    if (voteYes) voteYes.textContent = '0';
    if (voteNo) voteNo.textContent = '0';
    if (voteDontKnow) voteDontKnow.textContent = '0';
  }
});

socket.on('votes_updated', (data) => {
  if (socket.id === activePlayerId) {
    const voteYes = document.getElementById('vote-yes-count');
    const voteNo = document.getElementById('vote-no-count');
    const voteDontKnow = document.getElementById('vote-dontknow-count');
    
    if (voteYes) voteYes.textContent = data.votes.yes || 0;
    if (voteNo) voteNo.textContent = data.votes.no || 0;
    if (voteDontKnow) voteDontKnow.textContent = data.votes.dont_know || 0;
  } else {
    if (votedCountDisplay) votedCountDisplay.textContent = data.votedCount;
    if (votersTotalDisplay) votersTotalDisplay.textContent = data.totalVoters;
  }
});

socket.on('voting_complete', (data) => {
  const { isYes, isTie, isDontKnow, activePlayerHistory } = data;
  
  renderHistory(activePlayerHistory, gameHistoryLog);

  if (socket.id === activePlayerId) {
    renderNotepad(activePlayerHistory);
  }

  if (isYes) {
    playSound('correct');
  } else {
    playSound('incorrect');
  }

  if (socket.id === activePlayerId) {
    const verdictText = document.getElementById('vote-verdict-text');
    if (verdictText) {
      verdictText.classList.remove('hidden');

      if (isYes) {
        verdictText.textContent = '🎉  ДА! Задай еще вопрос.';
        verdictText.className = 'text-xs font-black uppercase text-green-400 mt-2 animate-bounce';
        
        setTimeout(() => {
          verdictText.classList.add('hidden');
          if (liveVotesResults) liveVotesResults.classList.add('hidden');
          if (questionInputBlock) questionInputBlock.classList.remove('hidden');
          
          const btnAsk = document.getElementById('btn-ask');
          const btnGuess = document.getElementById('btn-guess-attempt');
          if (btnAsk && btnGuess) {
            btnAsk.disabled = false;
            btnGuess.disabled = false;
            btnAsk.classList.remove('opacity-50', 'cursor-not-allowed');
            btnGuess.classList.remove('opacity-50', 'cursor-not-allowed');
          }
        }, 3000);
      } else if (isTie || isDontKnow) {
        verdictText.textContent = isDontKnow ? '🤷 НЕ ЗНАЮ! Спроси другое.' : '🤷 Мнения разделились! Спроси другое.';
        verdictText.className = 'text-xs font-black uppercase text-amber-400 mt-2';

        setTimeout(() => {
          verdictText.classList.add('hidden');
          if (liveVotesResults) liveVotesResults.classList.add('hidden');
          if (questionInputBlock) questionInputBlock.classList.remove('hidden');

          const btnAsk = document.getElementById('btn-ask');
          const btnGuess = document.getElementById('btn-guess-attempt');
          if (btnAsk && btnGuess) {
            btnAsk.disabled = false;
            btnGuess.disabled = false;
            btnAsk.classList.remove('opacity-50', 'cursor-not-allowed');
            btnGuess.classList.remove('opacity-50', 'cursor-not-allowed');
          }
        }, 3000);
      } else {
        const btnAsk = document.getElementById('btn-ask');
        const btnGuess = document.getElementById('btn-guess-attempt');
        if (btnAsk && btnGuess) {
          btnAsk.disabled = true;
          btnGuess.disabled = true;
          btnAsk.classList.add('opacity-50', 'cursor-not-allowed');
          btnGuess.classList.add('opacity-50', 'cursor-not-allowed');
        }

        verdictText.textContent = '❌  НЕТ. Ход переходит...';
        verdictText.className = 'text-xs font-black uppercase text-red-400 mt-2';
      }
    }
  } else {
    if (votingButtonsGrid) votingButtonsGrid.classList.add('hidden');
    if (gameQuestionText) {
      if (isYes) {
        gameQuestionText.textContent = 'Ответ ДА! Ход продолжается.';
      } else if (isTie) {
        gameQuestionText.textContent = 'Мнения разделились! Переспрос.';
      } else if (isDontKnow) {
        gameQuestionText.textContent = 'Зал не знает! Попробуй переспросить.';
      } else {
        gameQuestionText.textContent = 'Ответ НЕТ! Передаем ход...';
      }
    }
  }
});

socket.on('guess_verification_request', (data) => {
  const verBlock = document.getElementById('guess-verification-block');
  const nameLabel = document.getElementById('guessing-player-name');
  const answerLabel = document.getElementById('guessing-player-answer');
  const actualLabel = document.getElementById('actual-role-display');

  if (nameLabel) nameLabel.textContent = data.playerName;
  if (answerLabel) answerLabel.textContent = data.guess;
  if (actualLabel) actualLabel.textContent = data.actualCharacter;
  
  if (gameActiveRoundContent) gameActiveRoundContent.classList.add('hidden');
  if (verBlock) verBlock.classList.remove('hidden');
});

socket.on('guess_waiting_for_verdict', () => {
  const waitBlock = document.getElementById('guess-waiting-block');
  if (waitBlock) {
    waitBlock.classList.add('hidden');
    waitBlock.classList.remove('hidden');
  }
  if (questionInputBlock) questionInputBlock.classList.add('hidden');
  
  const btnAsk = document.getElementById('btn-ask');
  const btnGuess = document.getElementById('btn-guess-attempt');
  if (btnAsk && btnGuess) {
    btnAsk.disabled = true;
    btnGuess.disabled = true;
  }
});

socket.on('broadcast_reaction', (data) => {
  const { emoji, senderName } = data;
  const container = document.getElementById('reaction-container');
  if (!container) return;

  const el = document.createElement('div');
  el.className = 'floating-emoji bg-indigo-950/90 text-white border-2 border-black px-3 py-1.5 rounded-full font-black text-sm flex items-center gap-1 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]';
  el.innerHTML = `<span>${senderName}:</span> <span class="text-2xl">${emoji}</span>`;

  const randomX = Math.floor(Math.random() * 60) + 10; 
  el.style.left = `${randomX}%`;

  container.appendChild(el);
  playSound('click'); 

  setTimeout(() => { el.remove(); }, 2500);
});

socket.on('broadcast_line', (data) => {
  if (!bgCanvas) return;
  const x1 = data.x1 * bgCanvas.width;
  const y1 = data.y1 * bgCanvas.height;
  const x2 = data.x2 * bgCanvas.width;
  const y2 = data.y2 * bgCanvas.height;
  drawSegment(x1, y1, x2, y2, data.color);
});

socket.on('broadcast_clear_drawings', () => {
  clearBgCanvas();
});

socket.on('guess_result', (data) => {
  const waitBlock = document.getElementById('guess-waiting-block');
  if (waitBlock) waitBlock.classList.add('hidden');
  if (data.success) {
    playSound('correct');
    triggerConfetti();
    showToast(`🎉 ${data.playerName} правильно угадал, что он — ${data.character}!`, 4000, true);
  } else {
    playSound('incorrect');
    showToast(`❌ Зал посчитал догадку игрока ${data.playerName} неверной. Ход передается дальше.`, 4000, false);
  }
});

socket.on('error_message', (message) => {
  showToast(message, 3000, false);
  
  const btnAsk = document.getElementById('btn-ask');
  const btnGuess = document.getElementById('btn-guess-attempt');
  if (btnAsk && btnGuess) {
    btnAsk.disabled = false;
    btnGuess.disabled = false;
    btnAsk.classList.remove('opacity-50', 'cursor-not-allowed');
    btnGuess.classList.remove('opacity-50', 'cursor-not-allowed');
  }

  if (message.includes('не найдена') || message.includes('уже началась')) {
    sessionStorage.removeItem('roomCode');
  }
});