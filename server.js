const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Разрешаем подключение с любых адресов для тестирования
  }
});

const PORT = process.env.PORT || 3000;

// Хранилище комнат в оперативной памяти сервера
const rooms = new Map();

// Указываем Express отдавать статические файлы (наши HTML страницы)
app.use(express.static(path.join(__dirname, 'public')));

// Генерация случайного 4-значного кода комнаты (только буквы)
function generateRoomCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  // Если код уже занят, генерируем заново
  if (rooms.has(code)) return generateRoomCode();
  return code;
}

// Распределение целей для загадывания слов «по кругу»
function assignTargets(players) {
  const len = players.length;
  for (let i = 0; i < len; i++) {
    // Следующий игрок в массиве (последний загадывает первому)
    const targetIndex = (i + 1) % len;
    players[i].targetPlayerId = players[targetIndex].socketId;
    players[i].targetName = players[targetIndex].name;
  }
}

// Безопасная отправка данных: скрываем от игрока его собственного персонажа
function getMaskedPlayersFor(room, socketId) {
  return room.players.map(p => {
    const isSelf = p.socketId === socketId;
    return {
      socketId: p.socketId,
      name: p.name,
      isHost: p.isHost,
      // Если это сам игрок и игра идет, заменяем его карту на знак вопроса
      character: (isSelf && room.status === 'PLAYING') ? '❓' : p.character,
      hasGuessed: p.hasGuessed,
      targetName: p.targetName
    };
  });
}

// Обработка WebSocket подключений
io.on('connection', (socket) => {
  console.log(`Новое сокет-подключение: ${socket.id}`);

  // 1. Создание комнаты
  socket.on('create_room', (data) => {
    const { username } = data;
    if (!username) return socket.emit('error_message', 'Имя игрока обязательно');

    const roomCode = generateRoomCode();
    const newRoom = {
      roomCode,
      status: 'LOBBY', // LOBBY, INPUTTING, PLAYING, RESULTS
      players: [
        {
          socketId: socket.id,
          name: username,
          isHost: true,
          character: null,
          targetPlayerId: null,
          targetName: null,
          hasGuessed: false,
          questionsCount: 0,
          history: [] // Личная история вопросов игрока
        }
      ],
      activePlayerIndex: 0,
      currentQuestion: null,
      votes: { yes: 0, no: 0 },
      votedPlayers: []
    };

    rooms.set(roomCode, newRoom);
    socket.join(roomCode);

    socket.emit('room_created', {
      roomCode,
      players: getMaskedPlayersFor(newRoom, socket.id)
    });

    console.log(`Комната ${roomCode} успешно создана игроком ${username}`);
  });

  // 2. Вход в комнату по коду
  socket.on('join_room', (data) => {
    const { username, roomCode } = data;
    const cleanCode = roomCode ? roomCode.toUpperCase().trim() : '';
    const room = rooms.get(cleanCode);

    if (!room) {
      return socket.emit('error_message', 'Комната не найдена. Проверь код!');
    }
    if (room.status !== 'LOBBY') {
      return socket.emit('error_message', 'Игра в этой комнате уже началась.');
    }
    if (room.players.length >= 8) {
      return socket.emit('error_message', 'Комната уже заполнена (макс. 8 человек).');
    }

    // Добавляем нового игрока
    const newPlayer = {
      socketId: socket.id,
      name: username,
      isHost: false,
      character: null,
      targetPlayerId: null,
      targetName: null,
      hasGuessed: false,
      questionsCount: 0,
      history: [] // Личная история вопросов игрока
    };

    room.players.push(newPlayer);
    socket.join(cleanCode);

    // Уведомляем всех в комнате об обновлении списка игроков
    room.players.forEach(p => {
      io.to(p.socketId).emit('room_state_update', {
        roomCode: room.roomCode,
        status: room.status,
        players: getMaskedPlayersFor(room, p.socketId)
      });
    });

    console.log(`Игрок ${username} вошел в комнату ${cleanCode}`);
  });

  // 3. Запуск игры (только для Хоста)
  socket.on('start_game', (data) => {
    const { roomCode } = data;
    const room = rooms.get(roomCode);

    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || !player.isHost) return;

    if (room.players.length < 2) {
      return socket.emit('error_message', 'Для игры нужно минимум 2 игрока.');
    }

    room.status = 'INPUTTING';
    assignTargets(room.players);

    // Рассылаем игрокам событие начала ввода слов
    room.players.forEach(p => {
      io.to(p.socketId).emit('game_state_update', {
        status: room.status,
        roomCode: room.roomCode, // Передаем код комнаты принудительно
        targetName: p.targetName,
        players: getMaskedPlayersFor(room, p.socketId)
      });
    });
  });

  // 4. Получение загаданного персонажа от игрока
  socket.on('submit_character', (data) => {
    const { roomCode, character } = data;
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'INPUTTING') return;

    const currentPlayer = room.players.find(p => p.socketId === socket.id);
    if (!currentPlayer) return;

    // Находим игрока, которому текущий игрок должен был придумать роль
    const targetPlayer = room.players.find(p => p.socketId === currentPlayer.targetPlayerId);
    if (targetPlayer) {
      targetPlayer.character = character.trim();
    }

    // Проверяем, все ли игроки заполнили персонажей
    const allSubmitted = room.players.every(p => p.character !== null);

    if (allSubmitted) {
      room.status = 'PLAYING';
      room.activePlayerIndex = 0;
      const nextActivePlayer = room.players[room.activePlayerIndex];

      room.players.forEach(p => {
        io.to(p.socketId).emit('game_state_update', {
          status: room.status,
          roomCode: room.roomCode, // Передаем код комнаты принудительно
          activePlayerId: nextActivePlayer.socketId,
          activePlayerHistory: nextActivePlayer.history, // Отправляем пустую историю первого игрока
          players: getMaskedPlayersFor(room, p.socketId)
        });
      });
    } else {
      // Иначе просто сообщаем текущему игроку, что его голос принят
      socket.emit('waiting_for_others');
    }
  });

  // 5. Обработка вопроса отгадывающего игрока
  socket.on('submit_question', (data) => {
    const { roomCode, question } = data;
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'PLAYING') return;

    // Сброс голосов для нового вопроса
    room.currentQuestion = question;
    room.votes = { yes: 0, no: 0 };
    room.votedPlayers = [];

    io.to(roomCode).emit('question_broadcast', {
      question,
      activePlayerId: room.players[room.activePlayerIndex].socketId
    });
  });

  // 6. Обработка голосов (только ДА / НЕТ)
  socket.on('submit_vote', (data) => {
    const { roomCode, voteType } = data; // 'yes' или 'no'
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'PLAYING') return;

    const activePlayer = room.players[room.activePlayerIndex];
    if (socket.id === activePlayer.socketId) return; // Угадывающий не голосует
    if (room.votedPlayers.includes(socket.id)) return; // Уже голосовал

    // Инициализируем голоса, если их не было (для безопасности)
    if (!room.votes.yes) room.votes.yes = 0;
    if (!room.votes.no) room.votes.no = 0;

    room.votes[voteType]++;
    room.votedPlayers.push(socket.id);

    const totalVoters = room.players.length - 1;
    const votedCount = room.votedPlayers.length;

    // Отправляем обновленные данные о голосах в реальном времени
    io.to(roomCode).emit('votes_updated', {
      votes: room.votes,
      totalVoters,
      votedCount
    });

    // Если проголосовали абсолютно все отвечающие
    if (votedCount === totalVoters) {
      const yesVotes = room.votes.yes;
      const noVotes = room.votes.no;
      
      // Большинство ответило ДА (при ничьей ход тоже сохраняется)
      const isYes = yesVotes >= noVotes;
      const verdict = isYes ? 'ДА 👍' : 'НЕТ 👎';

      // Записываем вопрос в личную историю активного игрока
      activePlayer.history.push({
        question: room.currentQuestion,
        verdict: verdict
      });

      // Оповещаем клиентов о результате голосования и шлем его обновленную историю
      io.to(roomCode).emit('voting_complete', {
        isYes,
        votes: room.votes,
        activePlayerHistory: activePlayer.history
      });

      if (isYes) {
        // Ответ "ДА": Сбрасываем вопрос и голоса, но ХОД НЕ МЕНЯЕМ (игрок спрашивает снова)
        room.currentQuestion = null;
        room.votes = { yes: 0, no: 0 };
        room.votedPlayers = [];
      } else {
        // Ответ "НЕТ": Автоматически передаем ход следующему через 3.5 секунды
        setTimeout(() => {
          const currentRoom = rooms.get(roomCode);
          if (!currentRoom || currentRoom.status !== 'PLAYING') return;

          // Очищаем данные вопроса
          currentRoom.currentQuestion = null;
          currentRoom.votes = { yes: 0, no: 0 };
          currentRoom.votedPlayers = [];

          // Ищем следующего угадывающего
          const startIndex = currentRoom.activePlayerIndex;
          do {
            currentRoom.activePlayerIndex = (currentRoom.activePlayerIndex + 1) % currentRoom.players.length;
          } while (currentRoom.players[currentRoom.activePlayerIndex].hasGuessed && currentRoom.activePlayerIndex !== startIndex);

          const nextActivePlayer = currentRoom.players[currentRoom.activePlayerIndex];

          // Рассылаем игрокам событие смены хода и подкидываем историю следующего игрока
          currentRoom.players.forEach(p => {
            io.to(p.socketId).emit('game_state_update', {
              status: currentRoom.status,
              roomCode: currentRoom.roomCode,
              activePlayerId: nextActivePlayer.socketId,
              activePlayerHistory: nextActivePlayer.history, // История нового угадывающего
              players: getMaskedPlayersFor(currentRoom, p.socketId)
            });
          });
        }, 3500);
      }
    }
  });

  // 7. Попытка угадать персонажа (Запуск голосования зала)
  socket.on('guess_attempt', (data) => {
    const { roomCode, guess } = data;
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'PLAYING') return;

    const activePlayer = room.players[room.activePlayerIndex];
    if (socket.id !== activePlayer.socketId) return;

    // Сохраняем догадку на сервере для последующей проверки
    room.pendingGuess = guess.trim();
    room.votes = { yes: 0, no: 0 }; // Обнуляем голоса для этого решения
    room.votedPlayers = [];

    // Отправляем догадку всем отвечающим для верификации
    room.players.forEach(p => {
      if (p.socketId !== socket.id) {
        io.to(p.socketId).emit('guess_verification_request', {
          playerName: activePlayer.name,
          guess: room.pendingGuess,
          actualCharacter: activePlayer.character
        });
      } else {
        // Сам угадывающий просто видит экран ожидания вердикта
        socket.emit('guess_waiting_for_verdict');
      }
    });
  });

  // 7.1. Обработка вердикта игроков по поводу догадки
  socket.on('submit_guess_verdict', (data) => {
    const { roomCode, isCorrect } = data; // true (засчитать) или false (отклонить)
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'PLAYING') return;

    const activePlayer = room.players[room.activePlayerIndex];
    if (socket.id === activePlayer.socketId) return; // Сам угадывающий не голосует
    if (room.votedPlayers.includes(socket.id)) return; // Защита от мультикликов

    if (isCorrect) room.votes.yes++;
    else room.votes.no++;

    room.votedPlayers.push(socket.id);

    const totalVoters = room.players.length - 1;

    if (room.votedPlayers.length === totalVoters) {
      // Все проголосовали. Определяем судьбу игрока
      const approved = room.votes.yes >= room.votes.no;

      if (approved) {
        activePlayer.hasGuessed = true;
        
        io.to(roomCode).emit('guess_result', {
          success: true,
          playerName: activePlayer.name,
          character: activePlayer.character
        });

        // Проверяем, закончена ли игра
        const remainingPlayers = room.players.filter(p => !p.hasGuessed);
        if (remainingPlayers.length <= 1) {
          room.status = 'RESULTS';
          io.to(roomCode).emit('game_state_update', {
            status: room.status,
            players: room.players
          });
          return;
        }
      } else {
        io.to(roomCode).emit('guess_result', {
          success: false,
          playerName: activePlayer.name
        });
      }

      // Передаем ход следующему игроку (в любом случае)
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
          roomCode: room.roomCode, // Передаем код комнаты принудительно
          activePlayerId: nextActivePlayer.socketId,
          activePlayerHistory: nextActivePlayer.history,
          players: getMaskedPlayersFor(room, p.socketId)
        });
      });
    }
  });

  // 8. Ручная передача хода следующему игроку (упрощенная)
  socket.on('next_turn', (data) => {
    const { roomCode } = data;
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'PLAYING') return;

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
        players: getMaskedPlayersFor(room, p.socketId)
      });
    });
  });

  // Отключение игрока от сервера
  socket.on('disconnect', () => {
    console.log(`Игрок отключился: ${socket.id}`);
    
    for (const [roomCode, room] of rooms.entries()) {
      const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex !== -1) {
        const leftPlayer = room.players[playerIndex];
        room.players.splice(playerIndex, 1);

        if (room.players.length === 0) {
          rooms.delete(roomCode);
          console.log(`Комната ${roomCode} удалена (нет игроков)`);
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

// Запуск сервера
server.listen(PORT, () => {
  console.log(`Сервер «Без Понятия!» успешно запущен на порту ${PORT}`);
});