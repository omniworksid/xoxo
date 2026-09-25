const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

let roomState = {
  players: [],
  spectators: [],
  board: Array(16).fill(null),
  turn: 'w',
  gameActive: false,
  round: 1,
  timer: null,
  timeLeft: 5,
  rematchVotes: new Set()
};

function generate4x4Board() {
  const setups = [
    [
      { pos: 0, piece: 'bR' }, { pos: 1, piece: 'bK' }, { pos: 2, piece: 'bB' }, { pos: 3, piece: 'bP' },
      { pos: 12, piece: 'wP' }, { pos: 13, piece: 'wB' }, { pos: 14, piece: 'wK' }, { pos: 15, piece: 'wR' }
    ],
    [
      { pos: 1, piece: 'bK' }, { pos: 2, piece: 'bN' }, { pos: 3, piece: 'bP' },
      { pos: 12, piece: 'wP' }, { pos: 13, piece: 'wN' }, { pos: 14, piece: 'wK' }
    ],
    [
      { pos: 0, piece: 'bK' }, { pos: 1, piece: 'bR' }, { pos: 6, piece: 'bP' },
      { pos: 9, piece: 'wP' }, { pos: 14, piece: 'wR' }, { pos: 15, piece: 'wK' }
    ]
  ];

  const chosen = setups[Math.floor(Math.random() * setups.length)];
  const newBoard = Array(16).fill(null);
  chosen.forEach(item => { newBoard[item.pos] = item.piece; });
  return newBoard;
}

// Validasi Langkah Bidak Catur (Ukuran 4x4)
function isValidMove(board, from, to, playerColor) {
  const piece = board[from];
  if (!piece || piece[0] !== playerColor) return false;

  const target = board[to];
  if (target && target[0] === playerColor) return false; // Tidak bisa memakan teman

  const fromRow = Math.floor(from / 4), fromCol = from % 4;
  const toRow = Math.floor(to / 4), toCol = to % 4;
  const dRow = Math.abs(toRow - fromRow), dCol = Math.abs(toCol - fromCol);
  const type = piece[1];

  if (type === 'K') return dRow <= 1 && dCol <= 1; // King
  if (type === 'R') return (fromRow === toRow || fromCol === toCol); // Rook
  if (type === 'B') return dRow === dCol; // Bishop
  if (type === 'N') return (dRow === 2 && dCol === 1) || (dRow === 1 && dCol === 2); // Knight
  if (type === 'P') { // Pawn
    const dir = playerColor === 'w' ? -1 : 1;
    if (fromCol === toCol && toRow - fromRow === dir && !target) return true;
    if (dCol === 1 && toRow - fromRow === dir && target) return true;
    return false;
  }
  return true;
}

function broadcastState() {
  io.emit('updateGame', {
    players: roomState.players,
    spectators: roomState.spectators,
    board: roomState.board,
    turn: roomState.turn,
    gameActive: roomState.gameActive,
    round: roomState.round,
    timeLeft: roomState.timeLeft
  });
}

function startTurnTimer() {
  clearInterval(roomState.timer);
  roomState.timeLeft = 5;
  io.emit('timerUpdate', roomState.timeLeft);

  roomState.timer = setInterval(() => {
    roomState.timeLeft -= 1;
    io.emit('timerUpdate', roomState.timeLeft);

    if (roomState.timeLeft <= 0) {
      clearInterval(roomState.timer);
      const loserColor = roomState.turn;
      const winnerColor = loserColor === 'w' ? 'b' : 'w';
      endRound(winnerColor, "Waktu habis! Terlalu lambat berpikir.");
    }
  }, 1000);
}

function endRound(winnerColor, reason) {
  clearInterval(roomState.timer);
  roomState.gameActive = false;

  const winnerPlayer = roomState.players.find(p => p.color === winnerColor);
  if (winnerPlayer) winnerPlayer.score += 1;

  let praiseText = "";
  if (roomState.round >= 5 || roomState.players.some(p => p.score >= 3)) {
    const p1 = roomState.players[0];
    const p2 = roomState.players[1];
    if (p1 && p2) {
      if (p1.score > p2.score) praiseText = `🏆 ${p1.name} MENANG TOTAL (${p1.score}-${p2.score})! Murni keberuntungan di catur 4x4 mini ini! 😉`;
      else if (p2.score > p1.score) praiseText = `🏆 ${p2.name} MENANG TOTAL (${p2.score}-${p1.score})! Luar biasa, jagoan di papan seukuran telapak tangan! 👏`;
      else praiseText = `⚖️ SERI TOTAL (${p1.score}-${p2.score})! Dua-duanya sama seimbang!`;
    }
  } else {
    praiseText = reason || `Player (${winnerColor === 'w' ? 'Putih' : 'Hitam'}) memenangkan ronde!`;
  }

  io.emit('roundOver', { winnerColor, reason: praiseText, players: roomState.players });
}

io.on('connection', (socket) => {

  socket.on('joinRoom', (name) => {
    const cleanName = name ? name.trim().substring(0, 12) : "Anonim";
    socket.userName = cleanName;

    if (roomState.players.length < 2) {
      const role = roomState.players.length === 0 ? 'P1' : 'P2';
      roomState.players.push({ id: socket.id, name: cleanName, role, color: null, ready: false, score: 0 });
      socket.emit('assignedRole', { role, name: cleanName });
    } else {
      roomState.spectators.push({ id: socket.id, name: cleanName });
      socket.emit('assignedRole', { role: 'Spectator', name: cleanName });
    }
    broadcastState();
  });

  socket.on('toggleReady', () => {
    const player = roomState.players.find(p => p.id === socket.id);
    if (!player) return;

    player.ready = !player.ready;

    if (roomState.players.length === 2 && roomState.players.every(p => p.ready)) {
      const isP1White = Math.random() < 0.5;
      roomState.players[0].color = isP1White ? 'w' : 'b';
      roomState.players[1].color = isP1White ? 'b' : 'w';

      roomState.board = generate4x4Board();
      roomState.turn = 'w';
      roomState.gameActive = true;
      roomState.rematchVotes.clear();
      startTurnTimer();
    }
    broadcastState();
  });

  socket.on('makeMove', ({ from, to }) => {
    if (!roomState.gameActive) return;

    const player = roomState.players.find(p => p.id === socket.id);
    if (!player || player.color !== roomState.turn) return;

    // Cek validasi langkah
    if (!isValidMove(roomState.board, from, to, player.color)) return;

    const targetPiece = roomState.board[to];
    const isCapture = !!targetPiece;

    // Pindahkan Bidak
    roomState.board[to] = roomState.board[from];
    roomState.board[from] = null;

    // Kirim sinyal efek suara
    io.emit('moveMade', { isCapture });

    // Cek Pemakan Raja
    if (targetPiece && targetPiece[1] === 'K') {
      endRound(player.color, `👑 RAJA TERMAKAN! ${player.name} memenangkan ronde ini!`);
      return;
    }

    roomState.turn = roomState.turn === 'w' ? 'b' : 'w';
    startTurnTimer();
    broadcastState();
  });

  socket.on('voteRematch', () => {
    roomState.rematchVotes.add(socket.id);
    if (roomState.rematchVotes.size >= 2) {
      roomState.round += 1;
      if (roomState.round > 5) {
        roomState.round = 1;
        roomState.players.forEach(p => p.score = 0);
      }

      const isP1White = Math.random() < 0.5;
      roomState.players[0].color = isP1White ? 'w' : 'b';
      roomState.players[1].color = isP1White ? 'b' : 'w';

      roomState.board = generate4x4Board();
      roomState.turn = 'w';
      roomState.gameActive = true;
      roomState.rematchVotes.clear();
      startTurnTimer();
    }
    broadcastState();
  });

  socket.on('exitGame', () => {
    roomState = { players: [], spectators: [], board: Array(16).fill(null), turn: 'w', gameActive: false, round: 1, timer: null, timeLeft: 5, rematchVotes: new Set() };
    io.emit('gameReset');
  });

  socket.on('sendChat', (msg) => {
    if (!msg || !socket.userName) return;
    io.emit('newChat', { sender: socket.userName, text: msg.substring(0, 50) });
  });

  socket.on('sendEmoji', (emoji) => {
    if (!socket.userName) return;
    io.emit('newEmoji', { sender: socket.userName, emoji });
  });

  socket.on('disconnect', () => {
    clearInterval(roomState.timer);
    roomState.players = roomState.players.filter(p => p.id !== socket.id);
    roomState.spectators = roomState.spectators.filter(s => s.id !== socket.id);

    if (roomState.players.length < 2) {
      roomState.gameActive = false;
      roomState.round = 1;
      roomState.players.forEach(p => { p.ready = false; p.score = 0; });
    }
    broadcastState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Ches. running on port ${PORT}`));
