const { rooms, getMaskedPlayersFor, calculateAchievements, assignTargets } = require('./roomManager');
const { clearRoomTimers, startTurnTimer, passTurnToNext } = require('./timerManager');
const { isValidUsername, isValidRoomCode, isValidCharacter, isValidQuestion, isValidGuess } = require('./validators');
const DECKS = require('./decks');

const playerColors = ['#facc15', '#f43f5e', '#22c55e', '#06b6d4', '#a855f7', '#ff7849', '#38bdf8', '#fb7185'];

function checkAndProcessRestartVote(io, room, roomCode) {
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
    console.log(`[DEBUG] Перезапуск комнаты [${roomCode}] по итогам голосования`);
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

function initSockets(io) {
  io.on('connection', (socket) => {
    console.log(`Новое подключение: ${socket.id}`);

    // 1. Создание комнаты
    socket.on('create_room', (data) => {
      const { username, avatar } = data;
      if (!isValidUsername(username)) {
        return socket.emit('error_message', 'Имя игрока должно быть от 1 до 20 символов.');
      }

      const roomCode = (function generateRoomCode() {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let code = '';
        for (let i = 0; i < 4; i++) {
          code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
        }
        if (rooms.has(code)) return generateRoomCode();
        return code;
      })();

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
            online: true,
            avatar: avatar || '🐱'
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

      console.log(`🏠 [DEBUG] Создана комната: [${roomCode}] для хоста: ${username}`);
      console.log("[DEBUG] Активные комнаты на сервере:", Array.from(rooms.keys()));

      socket.emit('room_created', {
        roomCode,
        players: getMaskedPlayersFor(newRoom, socket.id),
        options: newRoom.options
      });
    });

    // 2. Вход в комнату
    socket.on('join_room', (data) => {
      const { username, roomCode, avatar } = data;
      if (!isValidRoomCode(roomCode)) {
        return socket.emit('error_message', 'Неверный формат кода комнаты.');
      }
      if (!isValidUsername(username)) {
        return socket.emit('error_message', 'Имя должно быть от 1 до 20 символов.');
      }

      const cleanCode = roomCode.toUpperCase().trim();
      const room = rooms.get(cleanCode);

      console.log(`🔌 Попытка входа игрока [${username}] в комнату [${cleanCode}]`);
      console.log("[DEBUG] Доступные комнаты на сервере:", Array.from(rooms.keys()));

      if (!room) {
        console.log(`❌ Ошибка: комната [${cleanCode}] не найдена!`);
        return socket.emit('error_message', 'Комната не найдена. Проверь код!');
      }

      if (room.deleteTimeout) {
        console.log(`[DEBUG] Очистка deleteTimeout для комнаты [${cleanCode}] (игрок переподключился)`);
        clearTimeout(room.deleteTimeout);
        room.deleteTimeout = null;
      }

      const trimmedName = username.trim();
      const existingPlayer = room.players.find(p => p.name.toLowerCase() === trimmedName.toLowerCase());

      if (existingPlayer) {
        if (existingPlayer.disconnectTimeout) {
          clearTimeout(existingPlayer.disconnectTimeout);
          existingPlayer.disconnectTimeout = null;
        }

        existingPlayer.socketId = socket.id;
        existingPlayer.online = true;
        socket.join(cleanCode);

        console.log(`🔄 Игрок [${username}] успешно переподключился к [${cleanCode}]`);

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

          if (room.status === 'PLAYING') {
            if (!room.turnTimerInterval && room.options.turnTimerDuration > 0) {
              startTurnTimer(io, rooms, room, cleanCode);
            } else if (room.options.turnTimerDuration > 0) {
              socket.emit('turn_timer_tick', { timeLeft: room.turnTimeLeft, duration: room.options.turnTimerDuration });
            }
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

        (function checkAndResolveVote(room, roomCode) {
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
        })(room, cleanCode);
        return;
      }

      if (room.status !== 'LOBBY') {
        return socket.emit('error_message', 'Игра уже началась.');
      }
      if (room.players.length >= 9) {
        return socket.emit('error_message', 'Комната заполнена.');
      }

      const nameExists = room.players.some(p => p.name.toLowerCase() === trimmedName.toLowerCase());
      if (nameExists) {
        return socket.emit('error_message', 'Это имя уже занято!');
      }

      const newPlayer = {
        socketId: socket.id,
        name: trimmedName,
        isHost: room.players.length === 0 || !room.players.some(p => p.isHost),
        character: null,
        targetPlayerId: null,
        targetName: null,
        hasGuessed: false,
        questionsCount: 0,
        history: [],
        color: playerColors[room.players.length % playerColors.length],
        online: true,
        avatar: avatar || '🐱'
      };

      room.players.push(newPlayer);
      socket.join(cleanCode);

      console.log(`✅ Игрок [${username}] успешно вошел в комнату [${cleanCode}]`);

      room.players.forEach(p => {
        io.to(p.socketId).emit('room_state_update', {
          roomCode: room.roomCode,
          status: room.status,
          players: getMaskedPlayersFor(room, p.socketId),
          options: room.options
        });
      });
    });

    // 3. Изменение опций хостом
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

    // 4. Старт игры
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

          startTurnTimer(io, rooms, room, room.roomCode);

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

    // 5. Рандомный персонаж
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

    // 6. Подтверждение персонажа
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

        startTurnTimer(io, rooms, room, room.roomCode);

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

    // 7. Отправка вопроса
    socket.on('submit_question', (data) => {
      const { roomCode, question } = data;
      if (!isValidRoomCode(roomCode) || !isValidQuestion(question)) {
        return socket.emit('error_message', 'Недопустимый вопрос (до 120 символов).');
      }

      const cleanCode = roomCode.toUpperCase().trim();
      const room = rooms.get(cleanCode);
      if (!room) return;

      const activePlayer = room.players[room.activePlayerIndex];
      if (!activePlayer || activePlayer.socketId !== socket.id) {
        return socket.emit('error_message', 'Сейчас не твой ход задавать вопросы!');
      }

      if (room.turnTimerInterval) {
        clearInterval(room.turnTimerInterval);
        room.turnTimerInterval = null;
      }
      io.to(cleanCode).emit('turn_timer_tick', { timeLeft: null, duration: null });

      if (room.turnTimeout) {
        clearTimeout(room.turnTimeout);
        room.turnTimeout = null;
      }

      activePlayer.questionsCount++;
      room.currentQuestion = question.trim();
      room.votes = { yes: 0, no: 0, dont_know: 0 };
      room.votedPlayers = [];

      io.to(cleanCode).emit('question_broadcast', {
        question: room.currentQuestion,
        activePlayerId: activePlayer.socketId,
        players: getMaskedPlayersFor(room, '')
      });
    });

    // 8. Голосование за ответ
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

      if (!room.votes) {
        room.votes = { yes: 0, no: 0, dont_know: 0 };
      }

      room.votes[voteType]++;
      room.votedPlayers.push(socket.id);

      console.log(`🗳️ Голос [${voteType}] принят от ${socket.id} в комнате [${roomCode}]. Текущие голоса:`, room.votes);

      (function checkAndResolveVote(room, roomCode) {
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

          console.log(`🏁 Голосование завершено в [${roomCode}]. Решение зала: ${verdict}`);

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

          if (isYes || isTie || isDontKnow) {
            startTurnTimer(io, rooms, room, roomCode);
          } else {
            if (room.turnTimeout) clearTimeout(room.turnTimeout);
            room.turnTimeout = setTimeout(() => {
              const currentRoom = rooms.get(roomCode);
              if (!currentRoom || currentRoom.status !== 'PLAYING') return;
              passTurnToNext(io, rooms, currentRoom, roomCode);
            }, 3500);
          }
        }
      })(room, room.roomCode);
    });

    // 9. Попытка угадать роль
    socket.on('guess_attempt', (data) => {
      const { roomCode, guess } = data;
      if (!isValidRoomCode(roomCode) || !isValidGuess(guess)) {
        return socket.emit('error_message', 'Недопустимая попытка отгадки.');
      }

      const cleanCode = roomCode.toUpperCase().trim();
      const room = rooms.get(cleanCode);
      if (!room || room.status !== 'PLAYING') return;

      const activePlayer = room.players[room.activePlayerIndex];
      if (!activePlayer || socket.id !== activePlayer.socketId) {
        return socket.emit('error_message', 'Сейчас не твой ход!');
      }

      if (room.turnTimerInterval) {
        clearInterval(room.turnTimerInterval);
        room.turnTimerInterval = null;
      }
      io.to(cleanCode).emit('turn_timer_tick', { timeLeft: null, duration: null });

      if (room.turnTimeout) {
        clearTimeout(room.turnTimeout);
        room.turnTimeout = null;
      }

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

    // 10. Вердикт догадки
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
            passTurnToNext(io, rooms, room, room.roomCode);
          }
        } else {
          io.to(room.roomCode).emit('guess_result', {
            success: false,
            playerName: activePlayer.name
          });
          passTurnToNext(io, rooms, room, room.roomCode);
        }

        room.currentQuestion = null;
        room.votes = { yes: 0, no: 0, dont_know: 0 };
        room.votedPlayers = [];
      }
    });

    // 11. Отправка реакции (Кулдаун снижен до 300мс)
    socket.on('send_reaction', (data) => {
      const { emoji, roomCode } = data;
      if (!isValidRoomCode(roomCode)) return;

      const room = rooms.get(roomCode.toUpperCase().trim());
      if (!room) return;

      const sender = room.players.find(p => p.socketId === socket.id);
      if (!sender) return;

      // Backend Cooldown Check (300 миллисекунд)
      const now = Date.now();
      if (sender.lastReactionTime && (now - sender.lastReactionTime < 300)) {
        return socket.emit('error_message', 'Слишком часто!');
      }
      sender.lastReactionTime = now;

      sender.reactionsCount++;
      const senderName = sender.name;

      io.to(room.roomCode).emit('broadcast_reaction', {
        emoji,
        senderName
      });
    });

    // 12. Рисование линий
    socket.on('draw_line', (data) => {
      const { roomCode, x1, y1, x2, y2, color } = data;
      if (!isValidRoomCode(roomCode)) return;
      socket.to(roomCode.toUpperCase().trim()).emit('broadcast_line', {
        x1, y1, x2, y2, color
      });
    });

    // 13. Стереть рисунки
    socket.on('clear_drawings', (data) => {
      const { roomCode } = data;
      if (!isValidRoomCode(roomCode)) return;
      io.to(roomCode.toUpperCase().trim()).emit('broadcast_clear_drawings');
    });

    // 14. Запрос перезапуска
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

      checkAndProcessRestartVote(io, room, cleanCode);
    });

    // 15. Отключение
    socket.on('disconnect', () => {
      for (const [roomCode, room] of rooms.entries()) {
        const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
        if (playerIndex !== -1) {
          const leftPlayer = room.players[playerIndex];
          
          if (room.status === 'PLAYING' || room.status === 'RESULTS' || room.status === 'INPUTTING') {
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
              console.log(`⚠️ [DEBUG] Все игроки вышли из активной комнаты [${roomCode}]. Старт deleteTimeout на 5 минут.`);
              room.deleteTimeout = setTimeout(() => {
                const checkRoom = rooms.get(roomCode);
                if (checkRoom && (!io.sockets.adapter.rooms.get(roomCode) || io.sockets.adapter.rooms.get(roomCode).size === 0)) {
                  console.log(`💀 [DEBUG] Истекло время ожидания. Комната [${roomCode}] удалена из памяти.`);
                  rooms.delete(roomCode);
                }
              }, 300000); 
            } else {
              if (room.status === 'RESULTS') {
                checkAndProcessRestartVote(io, room, roomCode);
              } else {
                (function checkAndResolveVote(room, roomCode) {
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
                })(room, roomCode);
              }
            }
            return; 
          }

          // СТАТУС LOBBY: Отложенное удаление для защиты от перезагрузки страницы (Grace Period)
          leftPlayer.online = false;
          
          if (leftPlayer.disconnectTimeout) {
            clearTimeout(leftPlayer.disconnectTimeout);
          }

          leftPlayer.disconnectTimeout = setTimeout(() => {
            const currentRoom = rooms.get(roomCode);
            if (!currentRoom) return;

            const targetIndex = currentRoom.players.findIndex(p => p.name === leftPlayer.name);
            if (targetIndex !== -1) {
              const pObject = currentRoom.players[targetIndex];
              
              if (pObject.online) {
                return;
              }

              currentRoom.players.splice(targetIndex, 1);
              console.log(`[DEBUG] Игрок [${leftPlayer.name}] удален из лобби [${roomCode}] после таймаута отключения.`);
              
              if (pObject.isHost && currentRoom.players.length > 0) {
                currentRoom.players[0].isHost = true;
              }

              currentRoom.players.forEach(p => {
                io.to(p.socketId).emit('room_state_update', {
                  roomCode: currentRoom.roomCode,
                  status: currentRoom.status,
                  players: getMaskedPlayersFor(currentRoom, p.socketId),
                  options: currentRoom.options
                });
              });
            }

            const activeSockets = io.sockets.adapter.rooms.get(roomCode);
            if (!activeSockets || activeSockets.size === 0) {
              clearRoomTimers(currentRoom);
              console.log(`⚠️ [DEBUG] Пустое лобби [${roomCode}]. Старт deleteTimeout на 2 минуты.`);
              currentRoom.deleteTimeout = setTimeout(() => {
                const checkRoom = rooms.get(roomCode);
                if (checkRoom && (!io.sockets.adapter.rooms.get(roomCode) || io.sockets.adapter.rooms.get(roomCode).size === 0)) {
                  console.log(`💀 [DEBUG] Истекло время ожидания лобби. Комната [${roomCode}] удалена.`);
                  rooms.delete(roomCode);
                }
              }, 120000);
            }
          }, 4000); 

          room.players.forEach(p => {
            if (p.socketId !== socket.id) {
              io.to(p.socketId).emit('room_state_update', {
                roomCode: room.roomCode,
                status: room.status,
                players: getMaskedPlayersFor(room, p.socketId),
                options: room.options
              });
            }
          });
          break;
        }
      }
    });
  });
}

module.exports = initSockets;