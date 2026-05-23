// Импорт из той же директории
const { getMaskedPlayersFor, calculateAchievements } = require('./roomManager');

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

function startTurnTimer(io, rooms, room, roomCode) {
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

  const thisTimerId = Math.random();
  room.activeTurnTimerId = thisTimerId;

  io.to(roomCode).emit('turn_timer_tick', { timeLeft: room.turnTimeLeft, duration });

  const intervalId = setInterval(() => {
    const currentRoom = rooms.get(roomCode);
    
    if (!currentRoom || currentRoom.status !== 'PLAYING' || currentRoom.activeTurnTimerId !== thisTimerId) {
      clearInterval(intervalId);
      return;
    }

    currentRoom.turnTimeLeft--;
    io.to(roomCode).emit('turn_timer_tick', { timeLeft: currentRoom.turnTimeLeft, duration });

    if (currentRoom.turnTimeLeft <= 0) {
      clearInterval(intervalId);
      if (currentRoom.activeTurnTimerId === thisTimerId) {
        currentRoom.turnTimerInterval = null;
      }

      const activePlayer = currentRoom.players[currentRoom.activePlayerIndex];
      const name = activePlayer ? activePlayer.name : 'Игрок';
      io.to(roomCode).emit('toast_broadcast', {
        message: `⏰ Время хода игрока ${name} истекло! Ход переходит дальше.`,
        isSuccess: false
      });

      passTurnToNext(io, rooms, currentRoom, roomCode);
    }
  }, 1000);

  room.turnTimerInterval = intervalId;
}

function passTurnToNext(io, rooms, room, roomCode) {
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

  startTurnTimer(io, rooms, room, roomCode);

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

module.exports = {
  clearRoomTimers,
  startTurnTimer,
  passTurnToNext
};