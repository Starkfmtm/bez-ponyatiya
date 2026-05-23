const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const playerColors = ['#facc15', '#f43f5e', '#22c55e', '#06b6d4', '#a855f7', '#ff7849', '#38bdf8', '#fb7185'];

app.use(express.static(path.join(__dirname, 'public')));

// === ФУНКЦИИ ВАЛИДАЦИИ ДАННЫХ ===
function isValidUsername(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 15;
}

function isValidRoomCode(code) {
  if (typeof code !== 'string') return false;
  const trimmed = code.trim();
  return /^[A-Z]{4}$/i.test(trimmed);
}

function isValidCharacter(char) {
  if (typeof char !== 'string') return false;
  const trimmed = char.trim();
  return trimmed.length >= 1 && trimmed.length <= 60;
}

function isValidQuestion(q) {
  if (typeof q !== 'string') return false;
  const trimmed = q.trim();
  return trimmed.length >= 1 && trimmed.length <= 50;
}

function isValidGuess(g) {
  if (typeof g !== 'string') return false;
  const trimmed = g.trim();
  return trimmed.length >= 1 && trimmed.length <= 60;
}

function generateRoomCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  if (rooms.has(code)) return generateRoomCode();
  return code;
}

function assignTargets(players) {
  const len = players.length;
  for (let i = 0; i < len; i++) {
    const targetIndex = (i + 1) % len;
    players[i].targetName = players[targetIndex].name;
  }
}

function clearRoomTimers(room) {
  if (room.turnTimeout) {
    clearTimeout(room.turnTimeout);
    room.turnTimeout = null;
  }
  if (room.inputTimerInterval) {
    clearInterval(room.inputTimerInterval);
    room.inputTimerInterval = null;
  }
  if (room.deleteTimeout) {
    clearTimeout(room.deleteTimeout);
    room.deleteTimeout = null;
  }
  if (room.turnTimerInterval) {
    clearInterval(room.turnTimerInterval);
    room.turnTimerInterval = null;
  }
}

// Запуск таймера на ход (вопрос/догадка)
function startTurnTimer(room, roomCode) {
  if (room.turnTimerInterval) {
    clearInterval(room.turnTimerInterval);
    room.turnTimerInterval = null;
  }

  if (!room.options || !room.options.turnTimerDuration || room.options.turnTimerDuration === 0) {
    io.to(roomCode).emit('turn_timer_tick', { timeLeft: null, duration: null });
    return;
  }

  room.turnTimeLeft = room.options.turnTimerDuration;
  const duration = room.options.turnTimerDuration;

  io.to(roomCode).emit('turn_timer_tick', { timeLeft: room.turnTimeLeft, duration });

  room.turnTimerInterval = setInterval(() => {
    const currentRoom = rooms.get(roomCode);
    if (!currentRoom || currentRoom.status !== 'PLAYING') {
      clearInterval(room.turnTimerInterval);
      room.turnTimerInterval = null;
      return;
    }

    currentRoom.turnTimeLeft--;
    io.to(roomCode).emit('turn_timer_tick', { timeLeft: currentRoom.turnTimeLeft, duration });

    if (currentRoom.turnTimeLeft <= 0) {
      clearInterval(currentRoom.turnTimerInterval);
      currentRoom.turnTimerInterval = null;

      const activePlayer = currentRoom.players[currentRoom.activePlayerIndex];
      const name = activePlayer ? activePlayer.name : 'Игрок';
      io.to(roomCode).emit('toast_broadcast', {
        message: `⏰ Время хода игрока ${name} истекло! Ход переходит дальше.`,
        isSuccess: false
      });

      passTurnToNext(currentRoom, roomCode);
    }
  }, 1000);
}

// Безопасная передача хода следующему активному игроку
function passTurnToNext(room, roomCode) {
  if (room.turnTimeout) {
    clearTimeout(room.turnTimeout);
    room.turnTimeout = null;
  }

  const activePlayers = room.players.filter(p => !p.hasGuessed);
  if (activePlayers.length === 0) {
    room.status = 'RESULTS';
    clearRoomTimers(room);
    const achievements = calculateAchievements(room.players);
    room.players.forEach(p => {
      io.to(p.socketId).emit('game_state_update', {
        status: room.status,
        players: room.players,
        achievements: achievements
      });
    });
    return;
  }

  let nextIndex = room.activePlayerIndex;
  for (let i = 0; i < room.players.length; i++) {
    nextIndex = (nextIndex + 1) % room.players.length;
    if (!room.players[nextIndex].hasGuessed) {
      room.activePlayerIndex = nextIndex;
      break;
    }
  }

  const nextActivePlayer = room.players[room.activePlayerIndex];

  startTurnTimer(room, roomCode);

  room.players.forEach(p => {
    io.to(p.socketId).emit('game_state_update', {
      status: room.status,
      roomCode: room.roomCode,
      activePlayerId: nextActivePlayer ? nextActivePlayer.socketId : null,
      activePlayerHistory: nextActivePlayer ? nextActivePlayer.history : [],
      myPersonalHistory: p.history,
      players: getMaskedPlayersFor(room, p.socketId),
      options: room.options
    });
  });
}

function getMaskedPlayersFor(room, socketId) {
  return room.players.map(p => {
    const isSelf = p.socketId === socketId;
    let maskedCharacter = p.character;

    if (room.status === 'INPUTTING') {
      maskedCharacter = null;
    } else if (room.status === 'PLAYING') {
      maskedCharacter = isSelf ? '❓' : p.character;
    }

    const target = room.players.find(t => t.name === p.targetName);
    const hasSubmitted = target ? target.character !== null : false;

    return {
      socketId: p.socketId,
      name: p.name,
      isHost: p.isHost,
      character: maskedCharacter,
      hasGuessed: p.hasGuessed,
      targetName: p.targetName,
      color: p.color,
      online: p.online !== false,
      hasSubmitted
    };
  });
}

function checkAndResolveVote(room, roomCode) {
  if (room.status !== 'PLAYING') return;
  if (!room.currentQuestion) return;

  const activePlayer = room.players[room.activePlayerIndex];
  if (!activePlayer) return;

  const eligibleVoters = room.players.filter(p => p.socketId !== activePlayer.socketId && p.online);
  const totalVoters = eligibleVoters.length;

  room.votedPlayers = room.votedPlayers.filter(id => room.players.some(p => p.socketId === id && p.online));
  const votedCount = room.votedPlayers.length;

  io.to(roomCode).emit('votes_updated', {
    votes: room.votes,
    totalVoters,
    votedCount
  });

  if (votedCount >= totalVoters && totalVoters > 0) {
    const yesVotes = room.votes.yes || 0;
    const noVotes = room.votes.no || 0;
    const dontKnowVotes = room.votes.dont_know || 0;

    let verdict = '';
    let isYes = false;
    let isTie = false;
    let isDontKnow = false;

    if (dontKnowVotes > yesVotes && dontKnowVotes > noVotes) {
      verdict = 'НЕ ЗНАЮ 🤷';
      isDontKnow = true;
    } else if (yesVotes > noVotes) {
      verdict = 'ДА 👍';
      isYes = true;
    } else if (noVotes > yesVotes) {
      verdict = 'НЕТ 👎';
      isYes = false;
    } else if (yesVotes === noVotes && yesVotes > 0) {
      verdict = 'НЕПОНЯТНО 🤷';
      isYes = false;
      isTie = true;
    } else {
      verdict = 'НЕ ЗНАЮ 🤷';
      isDontKnow = true;
    }

    activePlayer.history.push({
      question: room.currentQuestion,
      verdict: verdict
    });

    io.to(roomCode).emit('voting_complete', {
      isYes,
      isTie,
      isDontKnow,
      votes: room.votes,
      activePlayerHistory: activePlayer.history
    });

    room.currentQuestion = null;
    room.votes = { yes: 0, no: 0, dont_know: 0 };
    room.votedPlayers = [];

    if (isYes) {
      startTurnTimer(room, roomCode);
    } else if (isTie || isDontKnow) {
      startTurnTimer(room, roomCode);
    } else {
      if (room.turnTimeout) clearTimeout(room.turnTimeout);
      room.turnTimeout = setTimeout(() => {
        const currentRoom = rooms.get(roomCode);
        if (!currentRoom || currentRoom.status !== 'PLAYING') return;
        passTurnToNext(currentRoom, roomCode);
      }, 3500);
    }
  }
}

function checkAndProcessRestartVote(room, roomCode) {
  if (!room.restartVotes) room.restartVotes = [];

  room.restartVotes = room.restartVotes.filter(name => 
    room.players.some(p => p.name === name && p.online)
  );

  const activeOnlinePlayers = room.players.filter(p => p.online);
  const requiredVotes = activeOnlinePlayers.length;

  io.to(roomCode).emit('restart_vote_update', {
    votedCount: room.restartVotes.length,
    requiredVotes: requiredVotes
  });

  if (requiredVotes > 0 && room.restartVotes.length >= requiredVotes) {
    room.status = 'LOBBY';
    clearRoomTimers(room);
    room.currentQuestion = null;
    room.votes = { yes: 0, no: 0, dont_know: 0 };
    room.votedPlayers = [];
    room.activePlayerIndex = 0;
    room.restartVotes = [];

    room.players.forEach(p => {
      p.character = null;
      p.hasGuessed = false;
      p.questionsCount = 0;
      p.reactionsCount = 0;
      p.history = [];
    });

    room.players.forEach(p => {
      io.to(p.socketId).emit('room_state_update', {
        roomCode: room.roomCode,
        status: room.status,
        players: getMaskedPlayersFor(room, p.socketId),
        options: room.options
      });
    });
  }
}

function calculateAchievements(players) {
  const achievements = {};

  let maxQuestions = -1;
  let philosopher = null;
  players.forEach(p => {
    if (p.questionsCount > maxQuestions) {
      maxQuestions = p.questionsCount;
      philosopher = p.name;
    }
  });
  if (philosopher && maxQuestions > 0) achievements[philosopher] = '🧐 Философ партии';

  let maxReactions = -1;
  let partySoul = null;
  players.forEach(p => {
    if (p.reactionsCount > maxReactions) {
      maxReactions = p.reactionsCount;
      partySoul = p.name;
    }
  });
  if (partySoul && maxReactions > 0) achievements[partySoul] = '😂 Душа компании';

  let minQuestions = 999;
  let sniper = null;
  players.forEach(p => {
    if (p.hasGuessed && p.questionsCount < minQuestions) {
      minQuestions = p.questionsCount;
      sniper = p.name;
    }
  });
  if (sniper && minQuestions < 999) achievements[sniper] = `🎯 Снайпер догадок (${minQuestions} вопр.)`;

  players.forEach(p => {
    if (p.questionsCount === 0 && !achievements[p.name]) {
      achievements[p.name] = '💤 Спящий красавец';
    }
  });

  return achievements;
}

io.on('connection', (socket) => {
  console.log(`Новое подключение: ${socket.id}`);

  // 1. Создание комнаты
  socket.on('create_room', (data) => {
    const { username } = data;
    if (!isValidUsername(username)) {
      return socket.emit('error_message', 'Имя игрока должно быть от 1 до 15 символов.');
    }

    const roomCode = generateRoomCode();
    const newRoom = {
      roomCode,
      status: 'LOBBY', 
      options: {
        inputTimerDuration: 60,
        turnTimerDuration: 60
      },
      players: [
        {
          socketId: socket.id,
          name: username.trim(),
          isHost: true,
          character: null,
          targetPlayerId: null,
          targetName: null,
          hasGuessed: false,
          questionsCount: 0,
          reactionsCount: 0,
          history: [],
          color: playerColors[0],
          online: true
        }
      ],
      activePlayerIndex: 0,
      currentQuestion: null,
      votes: { yes: 0, no: 0, dont_know: 0 },
      votedPlayers: [],
      restartVotes: [],
      turnTimeout: null,
      deleteTimeout: null,
      inputTimeLeft: 60,
      inputTimerInterval: null,
      turnTimerInterval: null
    };

    rooms.set(roomCode, newRoom);
    socket.join(roomCode);

    socket.emit('room_created', {
      roomCode,
      players: getMaskedPlayersFor(newRoom, socket.id),
      options: newRoom.options
    });
  });

  // 2. Вход в комнату
  socket.on('join_room', (data) => {
    const { username, roomCode } = data;
    if (!isValidRoomCode(roomCode)) {
      return socket.emit('error_message', 'Неверный формат кода комнаты.');
    }
    if (!isValidUsername(username)) {
      return socket.emit('error_message', 'Имя должно быть от 1 до 15 символов.');
    }

    const cleanCode = roomCode.toUpperCase().trim();
    const room = rooms.get(cleanCode);

    if (!room) {
      return socket.emit('error_message', 'Комната не найдена. Проверь код!');
    }

    if (room.deleteTimeout) {
      clearTimeout(room.deleteTimeout);
      room.deleteTimeout = null;
      console.log(`Удаление комнаты ${cleanCode} отменено.`);
    }

    const trimmedName = username.trim();

    const existingPlayer = room.players.find(p => p.name.toLowerCase() === trimmedName.toLowerCase());
    if (existingPlayer) {
      existingPlayer.socketId = socket.id;
      existingPlayer.online = true;
      socket.join(cleanCode);

      if (room.status === 'PLAYING' || room.status === 'INPUTTING') {
        const activePlayer = room.players[room.activePlayerIndex];
        room.players.forEach(p => {
          io.to(p.socketId).emit('game_state_update', {
            status: room.status,
            roomCode: room.roomCode,
            activePlayerId: activePlayer ? activePlayer.socketId : null,
            activePlayerHistory: activePlayer ? activePlayer.history : [],
            myPersonalHistory: p.history,
            targetName: p.targetName,
            players: getMaskedPlayersFor(room, p.socketId),
            currentQuestion: room.currentQuestion,
            votes: room.votes,
            votedPlayers: room.votedPlayers,
            pendingGuess: room.pendingGuess,
            options: room.options
          });
        });

        if (room.status === 'PLAYING' && room.options.turnTimerDuration > 0) {
          socket.emit('turn_timer_tick', { timeLeft: room.turnTimeLeft, duration: room.options.turnTimerDuration });
        }
      } else {
        room.players.forEach(p => {
          io.to(p.socketId).emit('room_state_update', {
            roomCode: room.roomCode,
            status: room.status,
            players: getMaskedPlayersFor(room, p.socketId),
            options: room.options
          });
        });
      }

      checkAndResolveVote(room, cleanCode);
      return;
    }

    if (room.status !== 'LOBBY') {
      return socket.emit('error_message', 'Игра уже началась.');
    }
    if (room.players.length >= 8) {
      return socket.emit('error_message', 'Комната заполнена.');
    }

    const nameExists = room.players.some(p => p.name.toLowerCase() === trimmedName.toLowerCase());
    if (nameExists) {
      return socket.emit('error_message', 'Это имя уже занято!');
    }

    const newPlayer = {
      socketId: socket.id,
      name: trimmedName,
      isHost: false,
      character: null,
      targetPlayerId: null,
      targetName: null,
      hasGuessed: false,
      questionsCount: 0,
      history: [],
      color: playerColors[room.players.length % playerColors.length],
      online: true
    };

    room.players.push(newPlayer);
    socket.join(cleanCode);

    room.players.forEach(p => {
      io.to(p.socketId).emit('room_state_update', {
        roomCode: room.roomCode,
        status: room.status,
        players: getMaskedPlayersFor(room, p.socketId),
        options: room.options
      });
    });
  });

  // Настройки лобби (Синхронизация)
  socket.on('update_room_options', (data) => {
    const { roomCode, options } = data;
    if (!isValidRoomCode(roomCode)) return;

    const room = rooms.get(roomCode.toUpperCase().trim());
    if (!room) return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || !player.isHost) return;

    if (options) {
      if (options.inputTimerDuration && [30, 60, 90].includes(options.inputTimerDuration)) {
        room.options.inputTimerDuration = options.inputTimerDuration;
      }
      if (options.turnTimerDuration !== undefined && [0, 30, 60, 90, 120].includes(options.turnTimerDuration)) {
        room.options.turnTimerDuration = options.turnTimerDuration;
      }
    }

    room.players.forEach(p => {
      io.to(p.socketId).emit('room_state_update', {
        roomCode: room.roomCode,
        status: room.status,
        players: getMaskedPlayersFor(room, p.socketId),
        options: room.options
      });
    });
  });

  // 3. Запуск игры
  socket.on('start_game', (data) => {
    const { roomCode } = data;
    if (!isValidRoomCode(roomCode)) return;

    const room = rooms.get(roomCode.toUpperCase().trim());
    if (!room) return;

    if (room.players.length < 2) {
      return socket.emit('error_message', 'Для начала игры нужно минимум 2 игрока!');
    }

    room.status = 'INPUTTING';
    assignTargets(room.players);
    room.inputTimeLeft = room.options ? room.options.inputTimerDuration : 60;

    room.players.forEach(p => {
      io.to(p.socketId).emit('game_state_update', {
        status: room.status,
        roomCode: room.roomCode,
        targetName: p.targetName,
        players: getMaskedPlayersFor(room, p.socketId),
        options: room.options
      });
    });

    if (room.inputTimerInterval) clearInterval(room.inputTimerInterval);
    room.inputTimerInterval = setInterval(() => {
      room.inputTimeLeft--;
      io.to(room.roomCode).emit('timer_tick', { 
        timeLeft: room.inputTimeLeft,
        duration: room.options ? room.options.inputTimerDuration : 60
      });

      if (room.inputTimeLeft <= 0) {
        clearInterval(room.inputTimerInterval);
        room.inputTimerInterval = null;

        // Автозаполнение ролей из всех колод
        const decks = ['people', 'movies', 'cartoons', 'games'];
        room.players.forEach(p => {
          const target = room.players.find(t => t.name === p.targetName);
          if (target && target.character === null) {
            const randomDeckName = decks[Math.floor(Math.random() * decks.length)];
            const currentDeck = DECKS[randomDeckName] || DECKS.people;
            const randChar = currentDeck[Math.floor(Math.random() * currentDeck.length)];
            target.character = randChar;
          }
        });

        room.status = 'PLAYING';
        room.activePlayerIndex = Math.floor(Math.random() * room.players.length);
        const nextActivePlayer = room.players[room.activePlayerIndex];

        startTurnTimer(room, room.roomCode);

        room.players.forEach(p => {
          io.to(p.socketId).emit('game_state_update', {
            status: room.status,
            roomCode: room.roomCode,
            activePlayerId: nextActivePlayer ? nextActivePlayer.socketId : null,
            activePlayerHistory: nextActivePlayer ? nextActivePlayer.history : [],
            myPersonalHistory: p.history,
            players: getMaskedPlayersFor(room, p.socketId),
            options: room.options
          });
        });
      }
    }, 1000);
  });

  socket.on('get_random_character', (data) => {
    const { category } = data;
    let char = '';

    if (DECKS[category]) {
      const arr = DECKS[category];
      char = arr[Math.floor(Math.random() * arr.length)];
    } else {
      char = 'Шрек';
    }

    socket.emit('random_character_result', { character: char });
  });

  socket.on('submit_character', (data) => {
    const { roomCode, character } = data;
    if (!isValidRoomCode(roomCode) || !isValidCharacter(character)) {
      return socket.emit('error_message', 'Недопустимый персонаж (от 1 до 60 символов).');
    }

    const room = rooms.get(roomCode.toUpperCase().trim());
    if (!room) return;

    const currentPlayer = room.players.find(p => p.socketId === socket.id);
    if (!currentPlayer) return;

    const targetPlayer = room.players.find(p => p.name === currentPlayer.targetName);
    if (targetPlayer) targetPlayer.character = character.trim();

    const allSubmitted = room.players.every(p => p.character !== null);

    if (allSubmitted) {
      if (room.inputTimerInterval) {
        clearInterval(room.inputTimerInterval);
        room.inputTimerInterval = null;
      }
      room.status = 'PLAYING';
      room.activePlayerIndex = Math.floor(Math.random() * room.players.length);
      const nextActivePlayer = room.players[room.activePlayerIndex];

      startTurnTimer(room, room.roomCode);

      room.players.forEach(p => {
        io.to(p.socketId).emit('game_state_update', {
          status: room.status,
          roomCode: room.roomCode,
          activePlayerId: nextActivePlayer ? nextActivePlayer.socketId : null,
          activePlayerHistory: nextActivePlayer ? nextActivePlayer.history : [],
          myPersonalHistory: p.history,
          players: getMaskedPlayersFor(room, p.socketId),
          options: room.options
        });
      });
    } else {
      room.players.forEach(p => {
        io.to(p.socketId).emit('game_state_update', {
          status: room.status,
          roomCode: room.roomCode,
          targetName: p.targetName,
          players: getMaskedPlayersFor(room, p.socketId),
          options: room.options
        });
      });
    }
  });

  socket.on('submit_question', (data) => {
    const { roomCode, question } = data;
    if (!isValidRoomCode(roomCode) || !isValidQuestion(question)) {
      return socket.emit('error_message', 'Недопустимый вопрос (от 1 до 50 символов).');
    }

    const room = rooms.get(roomCode.toUpperCase().trim());
    if (!room) return;

    if (room.turnTimerInterval) {
      clearInterval(room.turnTimerInterval);
      room.turnTimerInterval = null;
    }
    // Скрываем таймер на клиентах при переходе к голосованию
    io.to(room.roomCode).emit('turn_timer_tick', { timeLeft: null, duration: null });

    if (room.turnTimeout) {
      clearTimeout(room.turnTimeout);
      room.turnTimeout = null;
    }

    const activePlayer = room.players[room.activePlayerIndex];
    if (activePlayer) activePlayer.questionsCount++;

    room.currentQuestion = question.trim();
    room.votes = { yes: 0, no: 0, dont_know: 0 };
    room.votedPlayers = [];

    io.to(room.roomCode).emit('question_broadcast', {
      question: room.currentQuestion,
      activePlayerId: room.players[room.activePlayerIndex].socketId,
      players: getMaskedPlayersFor(room, '')
    });
  });

  socket.on('submit_vote', (data) => {
    const { roomCode, voteType } = data;
    if (!isValidRoomCode(roomCode)) return;
    if (!['yes', 'no', 'dont_know'].includes(voteType)) return;

    const room = rooms.get(roomCode.toUpperCase().trim());
    if (!room || room.status !== 'PLAYING') return;

    const activePlayer = room.players[room.activePlayerIndex];
    if (!activePlayer) return;
    if (socket.id === activePlayer.socketId) return;
    if (room.votedPlayers.includes(socket.id)) return;

    if (!room.votes.yes) room.votes.yes = 0;
    if (!room.votes.no) room.votes.no = 0;
    if (!room.votes.dont_know) room.votes.dont_know = 0;

    room.votes[voteType]++;
    room.votedPlayers.push(socket.id);

    checkAndResolveVote(room, room.roomCode);
  });

  socket.on('guess_attempt', (data) => {
    const { roomCode, guess } = data;
    if (!isValidRoomCode(roomCode) || !isValidGuess(guess)) {
      return socket.emit('error_message', 'Недопустимая попытка отгадки.');
    }

    const room = rooms.get(roomCode.toUpperCase().trim());
    if (!room || room.status !== 'PLAYING') return;

    if (room.turnTimerInterval) {
      clearInterval(room.turnTimerInterval);
      room.turnTimerInterval = null;
    }
    // Скрываем таймер на клиентах во время верификации
    io.to(room.roomCode).emit('turn_timer_tick', { timeLeft: null, duration: null });

    if (room.turnTimeout) {
      clearTimeout(room.turnTimeout);
      room.turnTimeout = null;
    }

    const activePlayer = room.players[room.activePlayerIndex];
    if (!activePlayer || socket.id !== activePlayer.socketId) return;

    room.pendingGuess = guess.trim();
    room.votes = { yes: 0, no: 0, dont_know: 0 };
    room.votedPlayers = [];

    room.players.forEach(p => {
      if (p.socketId !== socket.id) {
        io.to(p.socketId).emit('guess_verification_request', {
          playerName: activePlayer.name,
          guess: room.pendingGuess,
          actualCharacter: activePlayer.character
        });
      } else {
        socket.emit('guess_waiting_for_verdict');
      }
    });
  });

  socket.on('submit_guess_verdict', (data) => {
    const { roomCode, isCorrect } = data;
    if (!isValidRoomCode(roomCode)) return;

    const room = rooms.get(roomCode.toUpperCase().trim());
    if (!room || room.status !== 'PLAYING') return;

    const activePlayer = room.players[room.activePlayerIndex];
    if (!activePlayer) return;
    if (socket.id === activePlayer.socketId) return;
    if (room.votedPlayers.includes(socket.id)) return;

    if (isCorrect) room.votes.yes++;
    else room.votes.no++;

    room.votedPlayers.push(socket.id);

    const eligibleVoters = room.players.filter(p => p.socketId !== activePlayer.socketId && p.online);
    const totalVoters = eligibleVoters.length;

    if (room.votedPlayers.length >= totalVoters) {
      const approved = room.votes.yes >= room.votes.no;

      if (approved) {
        activePlayer.hasGuessed = true;
        
        io.to(room.roomCode).emit('guess_result', {
          success: true,
          playerName: activePlayer.name,
          character: activePlayer.character
        });

        const remainingPlayers = room.players.filter(p => !p.hasGuessed);
        if (remainingPlayers.length <= 1) {
          room.status = 'RESULTS';
          clearRoomTimers(room);
          const achievements = calculateAchievements(room.players);

          room.players.forEach(p => {
            io.to(p.socketId).emit('game_state_update', {
              status: room.status,
              players: room.players,
              achievements: achievements
            });
          });
          return;
        } else {
          passTurnToNext(room, room.roomCode);
        }
      } else {
        io.to(room.roomCode).emit('guess_result', {
          success: false,
          playerName: activePlayer.name
        });
        passTurnToNext(room, room.roomCode);
      }

      room.currentQuestion = null;
      room.votes = { yes: 0, no: 0, dont_know: 0 };
      room.votedPlayers = [];
    }
  });

  socket.on('send_reaction', (data) => {
    const { emoji, roomCode } = data;
    if (!isValidRoomCode(roomCode)) return;

    const room = rooms.get(roomCode.toUpperCase().trim());
    if (!room) return;

    const sender = room.players.find(p => p.socketId === socket.id);
    if (sender) {
      sender.reactionsCount++;
    }
    const senderName = sender ? sender.name : 'Кто-то';

    io.to(room.roomCode).emit('broadcast_reaction', {
      emoji,
      senderName
    });
  });

  socket.on('draw_line', (data) => {
    const { roomCode, x1, y1, x2, y2, color } = data;
    if (!isValidRoomCode(roomCode)) return;
    socket.to(roomCode.toUpperCase().trim()).emit('broadcast_line', {
      x1, y1, x2, y2, color
    });
  });

  socket.on('clear_drawings', (data) => {
    const { roomCode } = data;
    if (!isValidRoomCode(roomCode)) return;
    io.to(roomCode.toUpperCase().trim()).emit('broadcast_clear_drawings');
  });

  socket.on('request_restart', (data) => {
    const { roomCode } = data;
    if (!isValidRoomCode(roomCode)) return;

    const cleanCode = roomCode.toUpperCase().trim();
    const room = rooms.get(cleanCode);
    if (!room) return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    if (!room.restartVotes) room.restartVotes = [];
    if (!room.restartVotes.includes(player.name)) {
      room.restartVotes.push(player.name);
    }

    checkAndProcessRestartVote(room, cleanCode);
  });

  socket.on('disconnect', () => {
    console.log(`Игрок отключился: ${socket.id}`);
    for (const [roomCode, room] of rooms.entries()) {
      const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex !== -1) {
        const leftPlayer = room.players[playerIndex];
        
        if (room.status === 'PLAYING' || room.status === 'RESULTS' || room.status === 'INPUTTING') {
          console.log(`Игрок ${leftPlayer.name} временно отключился.`);
          leftPlayer.online = false;

          const activePlayer = room.players[room.activePlayerIndex] || room.players[0];
          room.players.forEach(p => {
            io.to(p.socketId).emit('game_state_update', {
              status: room.status,
              roomCode: room.roomCode,
              activePlayerId: activePlayer ? activePlayer.socketId : null,
              activePlayerHistory: activePlayer ? activePlayer.history : [],
              myPersonalHistory: p.history,
              targetName: p.targetName,
              players: getMaskedPlayersFor(room, p.socketId),
              options: room.options
            });
          });

          const activeSockets = io.sockets.adapter.rooms.get(roomCode);
          if (!activeSockets || activeSockets.size === 0) {
            clearRoomTimers(room);
            room.deleteTimeout = setTimeout(() => {
              rooms.delete(roomCode);
              console.log(`Комната ${roomCode} окончательно удалена из памяти.`);
            }, 30000);
          } else {
            if (room.status === 'RESULTS') {
              checkAndProcessRestartVote(room, roomCode);
            } else {
              checkAndResolveVote(room, roomCode);
            }
          }
          return; 
        }

        room.players.splice(playerIndex, 1);

        const activeSockets = io.sockets.adapter.rooms.get(roomCode);
        if (!activeSockets || activeSockets.size === 0) {
          clearRoomTimers(room);
          room.deleteTimeout = setTimeout(() => {
            rooms.delete(roomCode);
            console.log(`Комната ${roomCode} окончательно удалена.`);
          }, 5000);
        } else {
          if (leftPlayer.isHost && room.players.length > 0) {
            room.players[0].isHost = true;
          }
          room.players.forEach(p => {
            io.to(p.socketId).emit('room_state_update', {
              roomCode: room.roomCode,
              status: room.status,
              players: getMaskedPlayersFor(room, p.socketId),
              options: room.options
            });
          });
        }
        break;
      }
    }
  });
});

const DECKS = {
  people: [
    'Дональд Трамп', 'Илон Маск', 'Альберт Эйнштейн', 'Майкл Джексон', 'Хасбик', 'Владимир Жириновский',
    'Ким Кардашьян', 'Леонардо Ди Каприо', 'Джонни Депп', 'Арнольд Шварценеггер', 'Джеки Чан', 'Адольф Гитлер',
    'Юлий Цезарь', 'Наполеон Бонапарт', 'Королева Елизавета II', 'Юрий Гагарин', 'Стив Джобс', 'Марк Цукерберг',
    'Лионель Месси', 'Криштиану Роналду', 'Майк Тайсон', 'Киану Ривз', 'Уилл Смит', 'Анджелина Джоли',
    'Леди Гага', 'Эминем', 'Шакира', 'Билли Айлиш', 'Гордон Рамзи', 'Мистер Бист'
  ],
  movies: [
    'Гарри Поттер', 'Дарт Вейдер', 'Капитан Джек Воробей', 'Шерлок Холмс', 'Бэтмен', 'Танос', 'Терминатор',
    'Джокер', 'Железный Человек', 'Человек-Паук', 'Джеймс Бонд (Агент 007)', 'Нео (Матрица)', 'Джек Доусон (Титаник)',
    'Индиана Джонс', 'Форрест Гамп', 'Ганнибал Лектер', 'Тони Старк', 'Росомаха', 'Дэдпул', 'Тор',
    'Капитан Америка', 'Гермиона Грейнджер', 'Лорд Волан-де-Морт', 'Альбус Дамблдор', 'Северус Снейп',
    'Люк Скайуокер', 'Принцесса Лея', 'Джон Уик', 'Безумный Макс', 'Леголас'
  ],
  cartoons: [
    'Губка Боб', 'Шрек', 'Пикачу', 'Наруто', 'Миньон', 'Гомер Симпсон', 'Эльза (Холодное сердце)',
    'Микки Маус', 'Багз Банни', 'Скуби-Ду', 'Сейлор Мун', 'Кунг-фу Панда (По)', 'Беззубик', 'Чебурашка',
    'Волк (Ну, погоди!)', 'Маша (Маша и Медведь)', 'Фиона', 'Осел (Шрек)', 'Кот в сапогах',
    'Симба (Король Лев)', 'Аладдин', 'Жасмин', 'Джинн', 'Русалочка (Ариэль)', 'Рапунцель',
    'Стив (Майнкрафт)', 'Лило', 'Стич', 'Гуфи'
  ],
  games: [
    'Супер Марио', 'Геральт из Ривии', 'Лара Крофт', 'Соник', 'Линк (Зельда)', 'Кратос (God of War)',
    'Пакман', 'Агент 47 (Hitman)', 'Артур Морган (RDR2)', 'Си-Джей (GTA SA)',
    'Тревор Филлипс (GTA 5)', 'Мастер Чиф (Halo)', 'Нейтан Дрейк (Uncharted)', 'Гордон Фримен (Half-Life)',
    'Санс (Undertale)', 'Элли (The Last of Us)', 'Саб-Зиро (Mortal Kombat)', 'Скорпион (Mortal Kombat)'
  ]
};

server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});