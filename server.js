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
    return {
      socketId: p.socketId,
      name: p.name,
      isHost: p.isHost,
      character: (isSelf && room.status === 'PLAYING') ? '❓' : p.character,
      hasGuessed: p.hasGuessed,
      targetName: p.targetName
    };
  });
}

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
          history: []
        }
      ],
      activePlayerIndex: 0,
      currentQuestion: null,
      votes: { yes: 0, no: 0 },
      votedPlayers: [],
      turnTimeout: null
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

    const trimmedName = username ? username.trim() : '';

    // Восстановление сессии для вылетевшего игрока
    const existingPlayer = room.players.find(p => p.name.toLowerCase() === trimmedName.toLowerCase());
    if (existingPlayer) {
      if (room.status === 'PLAYING') {
        existingPlayer.socketId = socket.id;
        socket.join(cleanCode);

        const activePlayer = room.players[room.activePlayerIndex];
        socket.emit('game_state_update', {
          status: room.status,
          roomCode: room.roomCode,
          activePlayerId: activePlayer.socketId,
          activePlayerHistory: activePlayer.history,
          myPersonalHistory: existingPlayer.history,
          players: getMaskedPlayersFor(room, socket.id)
        });
        return;
      } else {
        return socket.emit('error_message', 'Это имя уже занято!');
      }
    }

    if (room.status !== 'LOBBY') {
      return socket.emit('error_message', 'Игра уже началась.');
    }
    if (room.players.length >= 8) {
      return socket.emit('error_message', 'Комната заполнена.');
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
      history: []
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
      room.activePlayerIndex = 0;
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

    // Сброс таймера переключения хода, так как игрок задал новый вопрос
    if (room.turnTimeout) {
      clearTimeout(room.turnTimeout);
      room.turnTimeout = null;
    }

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
        // При ДА или НИЧЬЕЙ ход остается у текущего игрока
        room.currentQuestion = null;
        room.votes = { yes: 0, no: 0 };
        room.votedPlayers = [];
      } else {
        // При НЕТ запускаем безопасный таймер передачи хода
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
          room.players.forEach(p => {
            io.to(p.socketId).emit('game_state_update', {
              status: room.status,
              players: room.players
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

  // Передача эмодзи-реакций (спам!)
  socket.on('send_reaction', (data) => {
    const { roomCode, emoji } = data;
    const room = rooms.get(roomCode);
    if (!room) return;

    const sender = room.players.find(p => p.socketId === socket.id);
    const senderName = sender ? sender.name : 'Кто-то';

    io.to(roomCode).emit('broadcast_reaction', {
      emoji,
      senderName
    });
  });

  socket.on('disconnect', () => {
    console.log(`Игрок отключился: ${socket.id}`);
    for (const [roomCode, room] of rooms.entries()) {
      const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex !== -1) {
        const leftPlayer = room.players[playerIndex];
        
        // В процессе активного матча НЕ удаляем профиль игрока из памяти для авто-реконнекта!
        if (room.status === 'PLAYING') {
          console.log(`Игрок ${leftPlayer.name} временно отключился от активного матча.`);
          return; 
        }

        room.players.splice(playerIndex, 1);

        if (room.players.length === 0) {
          rooms.delete(roomCode);
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