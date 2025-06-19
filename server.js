const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Chess } = require('chess.js');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Configuración del puerto
const PORT = process.env.PORT || 5000;

// Datos del servidor
const games = {};
const players = {};

// Generar ID único para las salas
const generateGameId = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

// Manejar conexiones
io.on('connection', (socket) => {
  console.log(`Nuevo cliente conectado: ${socket.id}`);
  players[socket.id] = { connected: true };
  
  // Notificar a todos los jugadores actualizados
  io.emit('playersOnline', Object.keys(players).length);
  
  // Manejar creación de sala
  socket.on('createGame', ({ playerName, betAmount, timeControls }) => {
    const gameId = generateGameId();
    const chess = new Chess();
    
    games[gameId] = {
      id: gameId,
      creator: playerName,
      betAmount: parseInt(betAmount) || 10,
      timeControls: parseInt(timeControls) || 300,
      players: [socket.id],
      playerNames: [playerName],
      chess,
      fen: chess.fen(),
      status: 'waiting',
      currentPlayer: 'white'
    };
    
    socket.join(gameId);
    socket.emit('gameCreated', { gameId });
    io.emit('availableGames', Object.values(games).filter(game => game.status === 'waiting'));
  });
  
  // Manejar unión a sala
  socket.on('joinGame', ({ gameId, playerName }) => {
    const game = games[gameId];
    
    if (!game || game.players.length >= 2) {
      socket.emit('error', { message: 'Sala no disponible' });
      return;
    }
    
    // Verificar saldo suficiente (simulado)
    const hasEnoughCoins = true; // En una app real, verificaría contra una DB
    
    if (!hasEnoughCoins) {
      socket.emit('error', { message: 'Saldo insuficiente' });
      return;
    }
    
    game.players.push(socket.id);
    game.playerNames.push(playerName);
    game.status = 'playing';
    
    socket.join(gameId);
    
    // Notificar a ambos jugadores que la partida comenzó
    const whitePlayer = io.sockets.sockets.get(game.players[0]);
    const blackPlayer = io.sockets.sockets.get(game.players[1]);
    
    whitePlayer.emit('gameStarted', {
      playerColor: 'white',
      opponentName: game.playerNames[1],
      betAmount: game.betAmount,
      timeControls: game.timeControls,
      fen: game.chess.fen(),
      currentPlayer: 'white'
    });
    
    blackPlayer.emit('gameStarted', {
      playerColor: 'black',
      opponentName: game.playerNames[0],
      betAmount: game.betAmount,
      timeControls: game.timeControls,
      fen: game.chess.fen(),
      currentPlayer: 'white'
    });
    
    io.emit('availableGames', Object.values(games).filter(game => game.status === 'waiting'));
  });
  
  // Manejar movimiento
  socket.on('makeMove', ({ from, to, piece, player, gameId, fen, promotion }) => {
    const game = games[gameId];
    if (!game || game.status !== 'playing') return;
    
    try {
      // Convertir coordenadas a notación algebraica
      const fromPos = `${String.fromCharCode(97 + from.col)}${8 - from.row}`;
      const toPos = `${String.fromCharCode(97 + to.col)}${8 - to.row}`;
      
      const moveObj = {
        from: fromPos,
        to: toPos,
        promotion: promotion ? promotion.toLowerCase() : undefined
      };
      
      const move = game.chess.move(moveObj);
      
      if (move) {
        game.fen = game.chess.fen();
        game.currentPlayer = game.currentPlayer === 'white' ? 'black' : 'white';
        
        // Verificar estado del juego
        if (game.chess.isGameOver()) {
          let result;
          if (game.chess.isCheckmate()) {
            result = player === 'white' ? 'white_wins' : 'black_wins';
          } else if (game.chess.isDraw()) {
            result = 'draw';
          } else {
            result = 'draw'; // Por tiempo o otra razón
          }
          
          endGame(gameId, result);
          return;
        }
        
        // Notificar movimiento a ambos jugadores
        io.to(gameId).emit('moveMade', {
          from,
          to,
          piece,
          player,
          fen: game.fen,
          currentPlayer: game.currentPlayer,
          promotion,
          move: {
            from: fromPos,
            to: toPos
          }
        });
      }
    } catch (err) {
      console.error('Error en movimiento:', err);
    }
  });
  
  // Manejar rendición
  socket.on('resignGame', ({ gameId, player }) => {
    const result = player === 'white' ? 'black_wins' : 'white_wins';
    endGame(gameId, result);
  });
  
  // Manejar oferta de tablas
  socket.on('offerDraw', ({ gameId }) => {
    const game = games[gameId];
    if (!game) return;
    
    const opponentSocketId = game.players.find(id => id !== socket.id);
    const opponentSocket = io.sockets.sockets.get(opponentSocketId);
    
    if (opponentSocket) {
      opponentSocket.emit('drawOffered', { player: socket.id });
    }
  });
  
  // Manejar aceptación/rechazo de tablas
  socket.on('acceptDraw', ({ gameId }) => {
    endGame(gameId, 'draw');
  });
  
  socket.on('declineDraw', ({ gameId }) => {
    const game = games[gameId];
    if (!game) return;
    
    const opponentSocketId = game.players.find(id => id !== socket.id);
    const opponentSocket = io.sockets.sockets.get(opponentSocketId);
    
    if (opponentSocket) {
      opponentSocket.emit('drawDeclined', { player: socket.id });
    }
  });
  
  // Manejar tiempo agotado
  socket.on('timeout', ({ gameId, player }) => {
    const result = player === 'white' ? 'black_wins' : 'white_wins';
    endGame(gameId, result);
  });
  
  // Manejar cancelación de sala
  socket.on('cancelGame', ({ gameId }) => {
    if (games[gameId] && games[gameId].players[0] === socket.id) {
      delete games[gameId];
      io.emit('availableGames', Object.values(games).filter(game => game.status === 'waiting'));
    }
  });
  
  // Manejar chat
  socket.on('sendChat', ({ gameId, message, sender }) => {
    io.to(gameId).emit('chatMessage', { sender, text: message });
  });
  
  // Solicitar salas disponibles
  socket.on('requestGames', () => {
    socket.emit('availableGames', Object.values(games).filter(game => game.status === 'waiting'));
  });
  
  // Manejar desconexión
  socket.on('disconnect', () => {
    console.log(`Cliente desconectado: ${socket.id}`);
    players[socket.id] = { connected: false };
    io.emit('playersOnline', Object.keys(players).filter(id => players[id].connected).length);
    
    // Buscar partidas afectadas por la desconexión
    for (const gameId in games) {
      const game = games[gameId];
      
      if (game.players.includes(socket.id)) {
        if (game.status === 'playing') {
          // Notificar al oponente
          const opponentId = game.players.find(id => id !== socket.id);
          if (opponentId) {
            io.to(opponentId).emit('playerDisconnected');
          }
          endGame(gameId, 'opponent_disconnected');
        } else if (game.status === 'waiting' && game.players[0] === socket.id) {
          // Eliminar sala si el creador se desconecta
          delete games[gameId];
          io.emit('availableGames', Object.values(games).filter(game => game.status === 'waiting'));
        }
      }
    }
  });
});

// Función para finalizar partida
function endGame(gameId, result) {
  const game = games[gameId];
  if (!game) return;
  
  game.status = 'finished';
  
  // Calcular nuevos saldos (simulado)
  const whitePlayer = game.players[0];
  const blackPlayer = game.players[1];
  
  // En una app real, esto se guardaría en una base de datos
  const whiteBalance = 1000; // Valor simulado
  const blackBalance = 1000; // Valor simulado
  
  let whiteResult = whiteBalance;
  let blackResult = blackBalance;
  
  if (result === 'white_wins') {
    whiteResult += game.betAmount;
    blackResult -= game.betAmount;
  } else if (result === 'black_wins') {
    whiteResult -= game.betAmount;
    blackResult += game.betAmount;
  }
  // En caso de empate, los saldos se mantienen igual
  
  // Notificar a los jugadores
  io.to(gameId).emit('gameFinished', {
    result,
    balance: {
      [whitePlayer]: whiteResult,
      [blackPlayer]: blackResult
    }
  });
  
  // Eliminar la partida después de un tiempo
  setTimeout(() => {
    delete games[gameId];
    io.emit('availableGames', Object.values(games).filter(game => game.status === 'waiting'));
  }, 30000); // 30 segundos para ver el resultado
}

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});