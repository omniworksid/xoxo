const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

let roomState = {
  players: [], // [{ id, name, role: 'P1'|'P2', color: 'w'|'b', ready: false, score: 0 }]
  spectators: [], // [{ id, name }]
  board: Array(16).fill(null),
  turn: 'w',
  gameActive: false,
  round: 1,
  timer: null,
  timeLeft: 5,
  rematchVotes: new Set()
};

// Preset Bidak 4x4 opsional / Random Puzzle Setup
function generate4x4Board() {
  // Papan 4x4 (Indeks 0-15)
  // Baris 0: 0,1,2,3 | Baris 1: 4,5,6,7 | Baris 2: 8,9,10,11 | Baris 3: 12,13,14,15
  // w = White, b = Black; K = King, R = Rook, B = Bishop, P = Pawn, N = Knight
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

function broadcastState() {
  io.emit('updateGame', {
    players: roomState.players,
    spectators: roomState.spectators,
    board: roomState.board,
    turn: roomState.turn,
    gameActive: roomState.gameActive,
    round: roomState.round,
    timeLeft: roomState.timeLeft,
    rematchCount: roomState.rematchVotes.size
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
      // Timeout - Pemain yang gilirannya habis kalah
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
  let isMatchEnd = false;

  if (roomState.round >= 5 || roomState.players.some(p => p.score >= 3)) {
    isMatchEnd = true;
    const p1 = roomState.players[0];
    const p2 = roomState.players[1];
    
    if (p1 && p2) {
      if (p1.score > p2.score) {
        praiseText = `🏆 ${p1.name} MENANG TOTAL (${p1.score}-${p2.score})! Murni keberuntungan di catur 4x4 mini ini! 😉`;
      } else if (p2.score > p1.score) {
        praiseText = `🏆 ${p2.name} MENANG TOTAL (${p2.score}-${p1.score})! Luar biasa, jagoan di papan seukuran telapak tangan! 👏`;
      } else {
        praiseText = `⚖️ SERI TOTAL (${p1.score}-${p2.score})! Dua-duanya sama-sama seimbang (atau sama-sama payah)!`;
      }
    }
  } else {
    praiseText = reason || `Player (${winnerColor === 'w' ? 'Putih' : 'Hitam'}) memenangkan ronde ${roomState.round}!`;
  }

  io.emit('roundOver', {
    winnerColor,
    reason: praiseText,
    isMatchEnd,
    players: roomState.players
  });
}

io.on('connection', (socket) => {

  socket.on('joinRoom', (name) => {
    const cleanName = name ? name.trim().substring(0, 12) : "Anonim";
    socket.userName = cleanName;

    if (roomState.players.length < 2) {
      const role = roomState.players.length === 0 ? 'P1' : 'P2';
      roomState.players.push({
        id: socket.id,
        name: cleanName,
        role,
        color: null,
        ready: false,
        score: 0
      });
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

    // Jika 2 pemain ready, mulai pertandingan
    if (roomState.players.length === 2 && roomState.players.every(p => p.ready)) {
      // Acak warna P1 dan P2
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

    const piece = roomState.board[from];
    if (!piece || piece[0] !== player.color) return;

    const targetPiece = roomState.board[to];

    // Eksekusi Langkah
    roomState.board[to] = piece;
    roomState.board[from] = null;

    // Cek jika Raja termakan
    if (targetPiece && targetPiece[1] === 'K') {
      endRound(player.color, `👑 RAJA TERMAKAN! ${player.name} memenangkan ronde ini!`);
      return;
    }

    // Berganti Giliran
    roomState.turn = roomState.turn === 'w' ? 'b' : 'w';
    startTurnTimer();
    broadcastState();
  });

  socket.on('voteRematch', () => {
    roomState.rematchVotes.add(socket.id);
    const required = roomState.players.length;

    if (roomState.rematchVotes.size >= required && required === 2) {
      roomState.round += 1;
      if (roomState.round > 5) {
        roomState.round = 1;
        roomState.players.forEach(p => p.score = 0);
      }
      
      // Acak warna lagi tiap ronde
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
    // Reset penuh room
    roomState = {
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
