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

// Уникальная палитра цветов для рисования игроков
const playerColors = ['#facc15', '#f43f5e', '#22c55e', '#06b6d4', '#a855f7', '#ff7849', '#38bdf8', '#fb7185'];

app.use(express.static(path.join(__dirname, 'public')));

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
    players[i].targetPlayerId = players[targetIndex].socketId;
    players[i].targetName = players[targetIndex].name;
  }
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

    // Проверяем, ввел ли уже данный игрок имя персонажа для своей цели
    const target = room.players.find(t => t.socketId === p.targetPlayerId);
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

// Вспомогательная функция проверки и завершения голосования
function checkAndResolveVote(room, roomCode) {
  if (room.status !== 'PLAYING') return;
  if (!room.currentQuestion) return;

  const activePlayer = room.players[room.activePlayerIndex];
  
  // Голосовать могут только те игроки, которые онлайн и не являются активным игроком
  const eligibleVoters = room.players.filter(p => p.socketId !== activePlayer.socketId && p.online);
  const totalVoters = eligibleVoters.length;

  // Очищаем голоса от отключившихся игроков во избежание зависания
  room.votedPlayers = room.votedPlayers.filter(id => room.players.some(p => p.socketId === id && p.online));
  const votedCount = room.votedPlayers.length;

  io.to(roomCode).emit('votes_updated', {
    votes: room.votes,
    totalVoters,
    votedCount
  });

  if (votedCount >= totalVoters && totalVoters > 0) {
    const yesVotes = room.votes.yes;
    const noVotes = room.votes.no;

    let verdict = '';
    let isYes = false;
    let isTie = false;

    if (yesVotes > noVotes) {
      verdict = 'ДА 👍';
      isYes = true;
    } else if (noVotes > yesVotes) {
      verdict = 'НЕТ 👎';
      isYes = false;
    } else {
      verdict = 'НЕПОНЯТНО 🤷';
      isYes = false;
      isTie = true;
    }

    activePlayer.history.push({
      question: room.currentQuestion,
      verdict: verdict
    });

    io.to(roomCode).emit('voting_complete', {
      isYes,
      isTie,
      votes: room.votes,
      activePlayerHistory: activePlayer.history
    });

    if (isYes || isTie) {
      room.currentQuestion = null;
      room.votes = { yes: 0, no: 0 };
      room.votedPlayers = [];
    } else {
      if (room.turnTimeout) clearTimeout(room.turnTimeout);

      room.turnTimeout = setTimeout(() => {
        const currentRoom = rooms.get(roomCode);
        if (!currentRoom || currentRoom.status !== 'PLAYING') return;

        currentRoom.currentQuestion = null;
        currentRoom.votes = { yes: 0, no: 0 };
        currentRoom.votedPlayers = [];

        const startIndex = currentRoom.activePlayerIndex;
        do {
          currentRoom.activePlayerIndex = (currentRoom.activePlayerIndex + 1) % currentRoom.players.length;
        } while (currentRoom.players[currentRoom.activePlayerIndex].hasGuessed && currentRoom.activePlayerIndex !== startIndex);

        const nextActivePlayer = currentRoom.players[currentRoom.activePlayerIndex];

        currentRoom.players.forEach(p => {
          io.to(p.socketId).emit('game_state_update', {
            status: currentRoom.status,
            roomCode: currentRoom.roomCode,
            activePlayerId: nextActivePlayer.socketId,
            activePlayerHistory: nextActivePlayer.history,
            myPersonalHistory: p.history,
            players: getMaskedPlayersFor(currentRoom, p.socketId)
          });
        });
      }, 3500);
    }
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
  if (philosopher && maxQuestions > 0) achievements[philosopher] = '🧐 Философ партии (задал больше всех вопросов)';

  let maxReactions = -1;
  let partySoul = null;
  players.forEach(p => {
    if (p.reactionsCount > maxReactions) {
      maxReactions = p.reactionsCount;
      partySoul = p.name;
    }
  });
  if (partySoul && maxReactions > 0) achievements[partySoul] = '😂 Душа компании (заспамил всех реакциями)';

  let minQuestions = 999;
  let sniper = null;
  players.forEach(p => {
    if (p.hasGuessed && p.questionsCount < minQuestions) {
      minQuestions = p.questionsCount;
      sniper = p.name;
    }
  });
  if (sniper && minQuestions < 999) achievements[sniper] = `🎯 Снайпер догадок (угадал себя всего за ${minQuestions} вопр.)`;

  players.forEach(p => {
    if (p.questionsCount === 0 && !achievements[p.name]) {
      achievements[p.name] = '💤 Спящий красавец (промолчал всю игру)';
    }
  });

  return achievements;
}

io.on('connection', (socket) => {
  console.log(`Новое подключение: ${socket.id}`);

  // 1. Создание комнаты
  socket.on('create_room', (data) => {
    const { username } = data;
    if (!username) return socket.emit('error_message', 'Имя игрока обязательно');

    const roomCode = generateRoomCode();
    const newRoom = {
      roomCode,
      status: 'LOBBY', 
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
          online: true // <-- Должно быть тут
        }
      ],
      activePlayerIndex: 0,
      currentQuestion: null,
      votes: { yes: 0, no: 0 },
      votedPlayers: [],
      turnTimeout: null,
      deleteTimeout: null
    };

    rooms.set(roomCode, newRoom);
    socket.join(roomCode);

    socket.emit('room_created', {
      roomCode,
      players: getMaskedPlayersFor(newRoom, socket.id)
    });
  });

  // 2. Вход в комнату (С восстановлением сессий)
  socket.on('join_room', (data) => {
    const { username, roomCode } = data;
    const cleanCode = roomCode ? roomCode.toUpperCase().trim() : '';
    const room = rooms.get(cleanCode);

    if (!room) {
      return socket.emit('error_message', 'Комната не найдена. Проверь код!');
    }

    if (room.deleteTimeout) {
      clearTimeout(room.deleteTimeout);
      room.deleteTimeout = null;
      console.log(`Удаление комнаты ${cleanCode} отменено.`);
    }

    const trimmedName = username ? username.trim() : '';

    // Восстановление сессии по имени
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
            activePlayerId: activePlayer.socketId,
            activePlayerHistory: activePlayer.history,
            myPersonalHistory: p.history,
            targetName: p.targetName,
            players: getMaskedPlayersFor(room, p.socketId)
          });
        });
      } else {
        room.players.forEach(p => {
          io.to(p.socketId).emit('room_state_update', {
            roomCode: room.roomCode,
            status: room.status,
            players: getMaskedPlayersFor(room, p.socketId)
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
      online: true // <-- Должно быть тут
    };

    room.players.push(newPlayer);
    socket.join(cleanCode);

    room.players.forEach(p => {
      io.to(p.socketId).emit('room_state_update', {
        roomCode: room.roomCode,
        status: room.status,
        players: getMaskedPlayersFor(room, p.socketId)
      });
    });
  });

  // 3. Запуск игры
  socket.on('start_game', (data) => {
    const { roomCode } = data;
    const room = rooms.get(roomCode);
    if (!room) return;

    if (room.players.length < 2) {
      return socket.emit('error_message', 'Для начала игры нужно минимум 2 игрока!');
    }

    room.status = 'INPUTTING';
    assignTargets(room.players);

    room.players.forEach(p => {
      io.to(p.socketId).emit('game_state_update', {
        status: room.status,
        roomCode: room.roomCode,
        targetName: p.targetName,
        players: getMaskedPlayersFor(room, p.socketId)
      });
    });
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
    const room = rooms.get(roomCode);
    if (!room) return;

    const currentPlayer = room.players.find(p => p.socketId === socket.id);
    if (!currentPlayer) return;

    const targetPlayer = room.players.find(p => p.socketId === currentPlayer.targetPlayerId);
    if (targetPlayer) targetPlayer.character = character.trim();

    const allSubmitted = room.players.every(p => p.character !== null);

    if (allSubmitted) {
      room.status = 'PLAYING';
      room.activePlayerIndex = Math.floor(Math.random() * room.players.length);
      const nextActivePlayer = room.players[room.activePlayerIndex];

      room.players.forEach(p => {
        io.to(p.socketId).emit('game_state_update', {
          status: room.status,
          roomCode: room.roomCode,
          activePlayerId: nextActivePlayer.socketId,
          activePlayerHistory: nextActivePlayer.history,
          myPersonalHistory: p.history,
          players: getMaskedPlayersFor(room, p.socketId)
        });
      });
    } else {
      socket.emit('waiting_for_others');
      // Обновляем состояние у других игроков, чтобы они увидели отметку о готовности
      room.players.forEach(p => {
        if (p.socketId !== socket.id) {
          io.to(p.socketId).emit('game_state_update', {
            status: room.status,
            roomCode: room.roomCode,
            players: getMaskedPlayersFor(room, p.socketId)
          });
        }
      });
    }
  });

  socket.on('submit_question', (data) => {
    const { roomCode, question } = data;
    const room = rooms.get(roomCode);
    if (!room) return;

    if (room.turnTimeout) {
      clearTimeout(room.turnTimeout);
      room.turnTimeout = null;
    }

    const activePlayer = room.players[room.activePlayerIndex];
    if (activePlayer) activePlayer.questionsCount++;

    room.currentQuestion = question;
    room.votes = { yes: 0, no: 0 };
    room.votedPlayers = [];

    io.to(roomCode).emit('question_broadcast', {
      question,
      activePlayerId: room.players[room.activePlayerIndex].socketId,
      players: getMaskedPlayersFor(room, '')
    });
  });

  socket.on('submit_vote', (data) => {
    const { roomCode, voteType } = data;
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'PLAYING') return;

    const activePlayer = room.players[room.activePlayerIndex];
    if (socket.id === activePlayer.socketId) return;
    if (room.votedPlayers.includes(socket.id)) return;

    if (!room.votes.yes) room.votes.yes = 0;
    if (!room.votes.no) room.votes.no = 0;

    room.votes[voteType]++;
    room.votedPlayers.push(socket.id);

    checkAndResolveVote(room, roomCode);
  });

  socket.on('guess_attempt', (data) => {
    const { roomCode, guess } = data;
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'PLAYING') return;

    if (room.turnTimeout) {
      clearTimeout(room.turnTimeout);
      room.turnTimeout = null;
    }

    const activePlayer = room.players[room.activePlayerIndex];
    if (socket.id !== activePlayer.socketId) return;

    room.pendingGuess = guess.trim();
    room.votes = { yes: 0, no: 0 };
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
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'PLAYING') return;

    const activePlayer = room.players[room.activePlayerIndex];
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
        
        io.to(roomCode).emit('guess_result', {
          success: true,
          playerName: activePlayer.name,
          character: activePlayer.character
        });

        const remainingPlayers = room.players.filter(p => !p.hasGuessed);
        if (remainingPlayers.length <= 1) {
          room.status = 'RESULTS';
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
      } else {
        io.to(roomCode).emit('guess_result', {
          success: false,
          playerName: activePlayer.name
        });
      }

      room.currentQuestion = null;
      room.votes = { yes: 0, no: 0 };
      room.votedPlayers = [];

      const startIndex = room.activePlayerIndex;
      do {
        room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
      } while (room.players[room.activePlayerIndex].hasGuessed && room.activePlayerIndex !== startIndex);

      const nextActivePlayer = room.players[room.activePlayerIndex];

      room.players.forEach(p => {
        io.to(p.socketId).emit('game_state_update', {
          status: room.status,
          roomCode: room.roomCode,
          activePlayerId: nextActivePlayer.socketId,
          activePlayerHistory: nextActivePlayer.history,
          myPersonalHistory: p.history,
          players: getMaskedPlayersFor(room, p.socketId)
        });
      });
    }
  });

  socket.on('send_reaction', (data) => {
    const { roomCode, emoji } = data;
    const room = rooms.get(roomCode);
    if (!room) return;

    const sender = room.players.find(p => p.socketId === socket.id);
    if (sender) {
      sender.reactionsCount++;
    }
    const senderName = sender ? sender.name : 'Кто-то';

    io.to(roomCode).emit('broadcast_reaction', {
      emoji,
      senderName
    });
  });

  socket.on('draw_line', (data) => {
    const { roomCode, x1, y1, x2, y2, color } = data;
    socket.to(roomCode).emit('broadcast_line', {
      x1, y1, x2, y2, color
    });
  });

  socket.on('clear_drawings', (data) => {
    const { roomCode } = data;
    io.to(roomCode).emit('broadcast_clear_drawings');
  });

  socket.on('restart_game', (data) => {
    const { roomCode } = data;
    const room = rooms.get(roomCode);
    if (!room) return;

    room.status = 'LOBBY';
    if (room.turnTimeout) clearTimeout(room.turnTimeout);
    room.turnTimeout = null;
    room.currentQuestion = null;
    room.votes = { yes: 0, no: 0 };
    room.votedPlayers = [];
    room.activePlayerIndex = 0;

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
        players: getMaskedPlayersFor(room, p.socketId)
      });
    });
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
              players: getMaskedPlayersFor(room, p.socketId)
            });
          });

          const activeSockets = io.sockets.adapter.rooms.get(roomCode);
          if (!activeSockets || activeSockets.size === 0) {
            if (room.deleteTimeout) clearTimeout(room.deleteTimeout);
            room.deleteTimeout = setTimeout(() => {
              rooms.delete(roomCode);
              console.log(`Комната ${roomCode} окончательно удалена из памяти.`);
            }, 30000);
          } else {
            checkAndResolveVote(room, roomCode);
          }
          return; 
        }

        room.players.splice(playerIndex, 1);

        const activeSockets = io.sockets.adapter.rooms.get(roomCode);
        if (!activeSockets || activeSockets.size === 0) {
          if (room.deleteTimeout) clearTimeout(room.deleteTimeout);
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
              players: getMaskedPlayersFor(room, p.socketId)
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
  ],
  mix_status: [
    'Пьяный', 'Грустный', 'Богатый', 'Нищий', 'Сумасшедший', 'Злой', 'Влюбленный', 'Радиоактивный',
    'Спящий', 'Летающий', 'Гламурный', 'Интеллигентный', 'На пенсии', 'Беременный', 'Сверхзвуковой'
  ]
};

server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});