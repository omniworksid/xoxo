const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(__dirname));

// Menyimpan data room/permainan
let roomState = {
  players: [], // [{ id, ip, role: 'X' | 'O' }]
  spectators: [], // [{ id, ip }]
  board: Array(9).fill(null),
  turn: 'X',
  winner: null
};

function getClientIp(req, socket) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return socket.handshake.address;
}

function checkWinner(board) {
  const winPatterns = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // Baris
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // Kolom
    [0, 4, 8], [2, 4, 6]             // Diagonal
  ];
  for (let pattern of winPatterns) {
    const [a, b, c] = pattern;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], pattern };
    }
  }
  if (board.every(cell => cell !== null)) return { winner: 'DRAW', pattern: [] };
  return null;
}

io.on('connection', (socket) => {
  const userIp = getClientIp(socket.request, socket);
  let role = 'spectator';

  // Alokasi Role berdasarkan kedatangan IP / Socket
  if (roomState.players.length < 2) {
    const symbol = roomState.players.length === 0 ? 'X' : 'O';
    role = symbol;
    roomState.players.push({ id: socket.id, ip: userIp, role: symbol });
  } else {
    roomState.spectators.push({ id: socket.id, ip: userIp });
  }

  // Kirim info role ke user yang baru connect
  socket.emit('initRole', { role, ip: userIp });

  // Broadcast pembaruan room ke semua klien
  function broadcastState() {
    io.emit('updateGame', {
      board: roomState.board,
      turn: roomState.turn,
      playerCount: roomState.players.length,
      spectatorCount: roomState.spectators.length,
      winnerInfo: checkWinner(roomState.board),
      players: roomState.players.map(p => ({ role: p.role, ip: p.ip }))
    });
  }

  broadcastState();

  // Handler langkah pemain
  socket.on('makeMove', (index) => {
    const player = roomState.players.find(p => p.id === socket.id);
    const winResult = checkWinner(roomState.board);

    if (!player || winResult || roomState.players.length < 2) return;
    if (player.role !== roomState.turn) return;
    if (roomState.board[index] !== null) return;

    roomState.board[index] = player.role;
    roomState.turn = roomState.turn === 'X' ? 'O' : 'X';

    broadcastState();
  });

  // Reset/Restart Game
  socket.on('resetGame', () => {
    roomState.board = Array(9).fill(null);
    roomState.turn = 'X';
    broadcastState();
  });

  // Handler Disconnect
  socket.on('disconnect', () => {
    roomState.players = roomState.players.filter(p => p.id !== socket.id);
    roomState.spectators = roomState.spectators.filter(s => s.id !== socket.id);

    // Otomatis reset game jika ada player utama yang melepaskan koneksi
    roomState.board = Array(9).fill(null);
    roomState.turn = 'X';

    broadcastState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));