const rooms = new Map();

function assignTargets(players) {
  const len = players.length;
  for (let i = 0; i < len; i++) {
    const targetIndex = (i + 1) % len;
    players[i].targetName = players[targetIndex].name;
  }
}

function getMaskedPlayersFor(room, socketId) {
  // САМОВОССТАНОВЛЕНИЕ ХОСТА: Если в комнате есть игроки, гарантируем наличие ровно одного онлайн-хоста
  if (room.players && room.players.length > 0) {
    const hasOnlineHost = room.players.some(p => p.isHost && p.online);
    if (!hasOnlineHost) {
      // Передаем хоста первому онлайн-игроку
      const firstOnline = room.players.find(p => p.online);
      if (firstOnline) {
        room.players.forEach(p => p.isHost = false);
        firstOnline.isHost = true;
      } else {
        // Если все оффлайн, ставим первого в списке
        room.players.forEach(p => p.isHost = false);
        room.players[0].isHost = true;
      }
    }
  }

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
      hasSubmitted,
      avatar: p.avatar || '🐱' // Передаем аватарку игрока на клиент
    };
  });
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

module.exports = {
  rooms,
  getMaskedPlayersFor,
  calculateAchievements,
  assignTargets
};