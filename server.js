const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const initSockets = require('./socketManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Эндпоинт пинга для удержания сервера в активном состоянии на Render
app.get('/ping', (req, res) => {
  res.send('pong');
});

// Глобальные обработчики ошибок процесса для выявления крашей в логах
process.on('uncaughtException', (err) => {
  console.error('🔥 [CRITICAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 [CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

initSockets(io);

server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});