const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

let room = {
  players: [], // { id, name, photo, isHost, isReady, score }
  board: [],
  boardSize: 3,
  winStreak: 3,
  turnIndex: 0,
  gameActive: false,
  timerLimit: 10,
  timeLeft: 10,
  timerObj: null
};

function getGameSettings(playerCount) {
  if (playerCount <= 2) return { size: 3, win: 3 };
  if (playerCount === 3) return { size: 6, win: 4 };
  if (playerCount === 4) return { size: 8, win: 4 };
  return { size: 10, win: 4 };
}

function checkWin(board, size, winStreak, playerIndex) {
  const check = (r, c, dr, dc) => {
    let count = 0;
    for (let i = 0; i < winStreak; i++) {
      const nr = r + dr * i, nc = c + dc * i;
      if (nr >= 0 && nr < size && nc >= 0 && nc < size && board[nr * size + nc] === playerIndex) count++;
      else break;
    }
    return count === winStreak;
  };

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r * size + c] !== playerIndex) continue;
      if (check(r, c, 1, 0) || check(r, c, 0, 1) || check(r, c, 1, 1) || check(r, c, 1, -1)) return true;
    }
  }
  return false;
}

function broadcastLobby() {
  io.emit('lobbyUpdate', { players: room.players, timerLimit: room.timerLimit });
}

function broadcastGame() {
  io.emit('gameUpdate', {
    board: room.board,
    size: room.boardSize,
    turnIndex: room.turnIndex,
    players: room.players,
    timeLeft: room.timeLeft,
    gameActive: room.gameActive
  });
}

function nextTurn() {
  room.turnIndex = (room.turnIndex + 1) % room.players.length;
  startTimer();
  broadcastGame();
}

function startTimer() {
  clearInterval(room.timerObj);
  if (room.timerLimit === 0) return;

  room.timeLeft = room.timerLimit;
  io.emit('timerTick', room.timeLeft);

  room.timerObj = setInterval(() => {
    room.timeLeft--;
    io.emit('timerTick', room.timeLeft);
    if (room.timeLeft <= 0) {
      clearInterval(room.timerObj);
      nextTurn();
    }
  }, 1000);
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ name, photo }) => {
    if (room.gameActive || room.players.length >= 5) {
      socket.emit('errorMsg', 'Room penuh atau game sedang berjalan.');
      return;
    }
    const isHost = room.players.length === 0;
    room.players.push({ id: socket.id, name, photo, isHost, isReady: false, score: 0 });
    
    socket.emit('joinSuccess', { isHost, id: socket.id });
    broadcastLobby();
  });

  socket.on('changeTimer', (time) => {
    const p = room.players.find(x => x.id === socket.id);
    if (p && p.isHost) {
      room.timerLimit = parseInt(time);
      broadcastLobby();
    }
  });

  socket.on('toggleReady', () => {
    const p = room.players.find(x => x.id === socket.id);
    if (p) p.isReady = !p.isReady;
    broadcastLobby();
  });

  socket.on('sendChat', (msg) => {
    const p = room.players.find(x => x.id === socket.id);
    if (p && msg.trim()) {
      io.emit('receiveChat', { sender: p.name, text: msg.substring(0, 100) });
    }
  });

  socket.on('startGame', () => {
    const p = room.players.find(x => x.id === socket.id);
    if (!p || !p.isHost) return;
    if (room.players.length < 2 || !room.players.every(x => x.isReady)) return;

    const settings = getGameSettings(room.players.length);
    room.boardSize = settings.size;
    room.winStreak = settings.win;
    room.board = Array(settings.size * settings.size).fill(null);
    room.turnIndex = 0;
    room.gameActive = true;
    
    io.emit('gameStarted', { size: room.boardSize, winStreak: room.winStreak });
    startTimer();
    broadcastGame();
  });

  socket.on('makeMove', (index) => {
    if (!room.gameActive) return;
    
    const pIndex = room.players.findIndex(x => x.id === socket.id);
    if (pIndex === -1 || pIndex !== room.turnIndex || room.board[index] !== null) return;

    room.board[index] = pIndex;
    io.emit('sfxMove'); // Trigger suara pop ke semua pemain

    if (checkWin(room.board, room.boardSize, room.winStreak, pIndex)) {
      clearInterval(room.timerObj);
      room.gameActive = false;
      room.players[pIndex].score += 1; // Tambah skor pemenang
      io.emit('gameOver', { winner: room.players[pIndex], board: room.board, players: room.players });
      return;
    }

    if (room.board.every(cell => cell !== null)) {
      clearInterval(room.timerObj);
      room.gameActive = false;
      io.emit('gameOver', { winner: null, board: room.board, players: room.players });
      return;
    }

    nextTurn();
  });

  socket.on('backToLobby', () => {
    const p = room.players.find(x => x.id === socket.id);
    if (p && p.isHost) {
      room.gameActive = false;
      room.players.forEach(x => x.isReady = false);
      io.emit('returnToLobby');
      broadcastLobby();
    }
  });

  socket.on('disconnect', () => {
    room.players = room.players.filter(x => x.id !== socket.id);
    if (room.players.length > 0 && !room.players.some(x => x.isHost)) {
      room.players[0].isHost = true;
    }
    if (room.players.length < 2) room.gameActive = false;
    broadcastLobby();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Face XOXO running on ${PORT}`));
