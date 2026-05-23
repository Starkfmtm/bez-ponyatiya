export const bgCanvas = document.getElementById('bg-drawing-canvas');
export const bgCtx = bgCanvas ? bgCanvas.getContext('2d') : null;
export let isDrawingBg = false;
export let lastX = 0;
export let lastY = 0;
export let myBrushColor = '#facc15'; 

export function setBrushColor(color) {
  myBrushColor = color;
  setupBrush();
}

export function resizeCanvas() {
  if (!bgCanvas || !bgCtx) return;
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = bgCanvas.width;
  tempCanvas.height = bgCanvas.height;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(bgCanvas, 0, 0);

  bgCanvas.width = window.innerWidth;
  bgCanvas.height = window.innerHeight;

  bgCtx.drawImage(tempCanvas, 0, 0);
  setupBrush();
}

export function setupBrush() {
  if (!bgCtx) return;
  bgCtx.strokeStyle = myBrushColor;
  bgCtx.lineWidth = 5;
  bgCtx.lineCap = 'round';
  bgCtx.lineJoin = 'round';
}

function getBgCoords(e) {
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: clientX, y: clientY };
}

export function startDrawBg(e) {
  if (e.target !== bgCanvas) return;
  isDrawingBg = true;
  const coords = getBgCoords(e);
  lastX = coords.x;
  lastY = coords.y;
}

export function drawBg(e, currentRoomCode, socket) {
  if (!isDrawingBg || !bgCanvas) return;
  const coords = getBgCoords(e);

  drawSegment(lastX, lastY, coords.x, coords.y, myBrushColor);

  if (currentRoomCode) {
    socket.emit('draw_line', {
      roomCode: currentRoomCode,
      x1: lastX / bgCanvas.width,
      y1: lastY / bgCanvas.height,
      x2: coords.x / bgCanvas.width,
      y2: coords.y / bgCanvas.height,
      color: myBrushColor
    });
  }

  lastX = coords.x;
  lastY = coords.y;
}

export function stopDrawBg() {
  isDrawingBg = false;
}

export function drawSegment(x1, y1, x2, y2, color) {
  if (!bgCtx) return;
  bgCtx.strokeStyle = color;
  bgCtx.lineWidth = 5;
  bgCtx.lineCap = 'round';
  bgCtx.lineJoin = 'round';
  bgCtx.beginPath();
  bgCtx.moveTo(x1, y1);
  bgCtx.lineTo(x2, y2);
  bgCtx.stroke();
  bgCtx.closePath();
}

// Новая экспортируемая функция очистки холста
export function clearBgCanvas() {
  if (bgCtx && bgCanvas) {
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
  }
}