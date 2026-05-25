function isValidUsername(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  // Лимит символов увеличен с 15 до 20
  return trimmed.length >= 1 && trimmed.length <= 20;
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
  return trimmed.length >= 1 && trimmed.length <= 120;
}

function isValidGuess(g) {
  if (typeof g !== 'string') return false;
  const trimmed = g.trim();
  return trimmed.length >= 1 && trimmed.length <= 60;
}

module.exports = {
  isValidUsername,
  isValidRoomCode,
  isValidCharacter,
  isValidQuestion,
  isValidGuess
};