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

// ==============================================
// ОГРОМНАЯ БАЗА ПЕРСОНАЖЕЙ (200+)
// ==============================================
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

// Подсчет шуточных достижений в конце игры
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
  if (sniper) achievements[sniper] = `🎯 Снайпер догадок (угадал себя всего за ${minQuestions} вопр.)`;

  players.forEach(p => {
    if (p.questionsCount === 0 && !achievements[p.name]) {
      achievements[p.name] = '💤 Спящий красавец (промолчал всю игру)';
    }
  });

  return achievements;
}

app.use(express.static(path.join(__dirname, 'public')));

const playerColors = ['#facc15', '#f43f5e', '#22c55e', '#06b6d4', '#a855f7', '#ff7849', '#38bdf8', '#fb7185'];

io.on('connection', (socket) => {
  console.log(`Новое подключение: ${socket.id}`);

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
          color: playerColors[0]
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
      console.log(`Удаление комнаты ${cleanCode} успешно отменено.`);
    }

    const trimmedName = username ? username.trim() : '';

    const existingPlayer = room.players.find(p => p.name.toLowerCase() === trimmedName.toLowerCase());
    if (existingPlayer) {
      existingPlayer.socketId = socket.id;
      socket.join(cleanCode);

      if (room.status === 'PLAYING') {
        const activePlayer = room.players[room.activePlayerIndex];
        socket.emit('game_state_update', {
          status: room.status,
          roomCode: room.roomCode,
          activePlayerId: activePlayer.socketId,
          activePlayerHistory: activePlayer.history,
          myPersonalHistory: existingPlayer.history,
          players: getMaskedPlayersFor(room, socket.id)
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
      return socket.emit('error_message', 'Это имя уже занято в этой комнате! Выбери другое.');
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
      color: playerColors[room.players.length % playerColors.length]
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

  socket.on('start_game', (data) => {
    const { roomCode } = data;
    const room = rooms.get(roomCode);
    if (!room) return;

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

  // Запрос на случайную генерацию из колод (Люди, Кино, Мульты, Игры - Без микса!)
  socket.on('get_random_character', (data) => {
    const { category } = data;
    let char = '';

    if (DECKS[category]) {
      const arr = DECKS[category];
      char = arr[Math.floor(Math.random() * arr.length)];
    } else {
      char = 'Шрек'; // Дефолтный персонаж
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
      
      // Случайный первый ход
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
      activePlayerId: room.players[room.activePlayerIndex].socketId
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

    const totalVoters = room.players.length - 1;
    const votedCount = room.votedPlayers.length;

    io.to(roomCode).emit('votes_updated', {
      votes: room.votes,
      totalVoters,
      votedCount
    });

    if (votedCount === totalVoters) {
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

    const totalVoters = room.players.length - 1;

    if (room.votedPlayers.length === totalVoters) {
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

  // Спам-реакции
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
        
        if (room.status === 'PLAYING' || room.status === 'RESULTS') {
          console.log(`Игрок ${leftPlayer.name} временно отключился.`);
          return; 
        }

        room.players.splice(playerIndex, 1);

        if (room.players.length === 0) {
          room.deleteTimeout = setTimeout(() => {
            rooms.delete(roomCode);
            console.log(`Комната ${roomCode} окончательно удалена из памяти.`);
          }, 5000);
        } else {
          if (leftPlayer.isHost) {
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

server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});