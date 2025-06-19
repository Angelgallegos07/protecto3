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

// Configuración del servidor
const PORT = 3000;
const INITIAL_BALANCE = 1000;

// Almacenamiento en memoria
const games = {};
const players = {};
const activeGames = {};

// Clase Game para manejar la lógica del juego
class Game {
  constructor(id, creator, betAmount, timeControls = 300) {
    this.id = id;
    this.creator = creator;
    this.betAmount = betAmount;
    this.players = [];
    this.chess = new Chess();
    this.currentPlayer = 'white';
    this.status = 'waiting'; // waiting, playing, finished
    this.timeControls = timeControls;
    this.whiteTime = timeControls;
    this.blackTime = timeControls;
    this.lastMove = null;
    this.result = null;
    this.drawOffered = null;
    this.createdAt = new Date();
    this.chatMessages = [];
  }

  addPlayer(player) {
    if (this.players.length >= 2) return false;
    
    // Verificar si el jugador tiene suficiente balance
    if (player.balance < this.betAmount) {
      return { error: "Saldo insuficiente" };
    }
    
    // Deduce la apuesta del balance del jugador
    player.balance -= this.betAmount;
    
    this.players.push(player);
    
    if (this.players.length === 2) {
      this.startGame();
      return { success: true };
    }
    
    return { success: true };
  }

  startGame() {
    this.status = 'playing';
    this.players[0].color = 'white';
    this.players[1].color = 'black';
    
    // Notificar a los jugadores
    this.players.forEach(player => {
      io.to(player.socketId).emit('gameStarted', {
        fen: this.chess.fen(),
        currentPlayer: this.currentPlayer,
        playerColor: player.color,
        opponentName: this.players.find(p => p.socketId !== player.socketId).name,
        betAmount: this.betAmount,
        timeControls: this.timeControls
      });
    });
    
    this.broadcastGameUpdate();
    this.updateAvailableGames();
  }

  makeMove(socketId, from, to, piece, promotion) {
    if (this.status !== 'playing') return false;
    
    const player = this.players.find(p => p.socketId === socketId);
    if (!player || player.color !== this.currentPlayer) return false;
    
    const fromPos = `${String.fromCharCode(97 + from.col)}${8 - from.row}`;
    const toPos = `${String.fromCharCode(97 + to.col)}${8 - to.row}`;
    
    try {
      const move = this.chess.move({
        from: fromPos,
        to: toPos,
        promotion: promotion ? promotion.toLowerCase() : 'q'
      });
      
      if (move) {
        this.currentPlayer = this.currentPlayer === 'white' ? 'black' : 'white';
        this.lastMove = { from, to, piece };
        this.drawOffered = null;
        
        // Agregar mensaje al chat
        this.addChatMessage('Sistema', `Movimiento: ${piece} de ${fromPos} a ${toPos}`);
        
        this.broadcastGameUpdate();
        
        // Verificar si el juego ha terminado
        this.checkGameEnd();
        
        return true;
      }
    } catch (err) {
      console.error("Error en movimiento:", err);
      return false;
    }
  }

  checkGameEnd() {
    if (this.chess.isGameOver()) {
      let result;
      
      if (this.chess.isCheckmate()) {
        result = this.currentPlayer === 'white' ? 'black_wins' : 'white_wins';
      } else if (this.chess.isDraw()) {
        result = 'draw';
      } else if (this.chess.isStalemate()) {
        result = 'draw';
      } else if (this.chess.isThreefoldRepetition()) {
        result = 'draw';
      } else if (this.chess.isInsufficientMaterial()) {
        result = 'draw';
      }
      
      if (result) {
        this.finishGame(result);
      }
    }
  }

  finishGame(result) {
    this.status = 'finished';
    this.result = result;
    
    // Actualizar balances
    if (result === 'white_wins') {
      this.players[0].balance += this.betAmount * 2;
      this.addChatMessage('Sistema', `¡${this.players[0].name} (Blancas) gana $${this.betAmount * 2}!`);
    } else if (result === 'black_wins') {
      this.players[1].balance += this.betAmount * 2;
      this.addChatMessage('Sistema', `¡${this.players[1].name} (Negras) gana $${this.betAmount * 2}!`);
    } else {
      // Empate - devolver la apuesta a cada jugador
      this.players[0].balance += this.betAmount;
      this.players[1].balance += this.betAmount;
      this.addChatMessage('Sistema', '¡Empate! Cada jugador recupera su apuesta.');
    }
    
    // Notificar a los jugadores
    this.players.forEach(player => {
      io.to(player.socketId).emit('gameFinished', {
        result: this.result,
        balance: player.balance,
        fen: this.chess.fen()
      });
    });
    
    this.broadcastGameUpdate();
    this.updateAvailableGames();
    
    // Eliminar el juego después de un tiempo
    setTimeout(() => {
      delete games[this.id];
    }, 60000); // 1 minuto para reconectar
  }

  handleTimeout(playerColor) {
    if (this.status !== 'playing') return;
    
    const result = playerColor === 'white' ? 'black_wins' : 'white_wins';
    this.finishGame(`timeout_${playerColor}`);
  }

  handleResign(playerColor) {
    if (this.status !== 'playing') return;
    
    const result = playerColor === 'white' ? 'black_wins' : 'white_wins';
    this.finishGame(`${playerColor}_resigned`);
  }

  offerDraw(socketId) {
    if (this.status !== 'playing') return false;
    
    const player = this.players.find(p => p.socketId === socketId);
    if (!player) return false;
    
    if (this.drawOffered === null) {
      this.drawOffered = player.color;
      this.addChatMessage('Sistema', `${player.name} ofrece tablas`);
      
      // Notificar al otro jugador
      const opponent = this.players.find(p => p.socketId !== socketId);
      io.to(opponent.socketId).emit('drawOffered', { by: player.name });
      
      return true;
    } else if (this.drawOffered !== player.color) {
      // El otro jugador acepta las tablas
      this.finishGame('draw');
      return true;
    }
    
    return false;
  }

  addChatMessage(sender, text) {
    this.chatMessages.push({ sender, text, timestamp: new Date() });
    if (this.chatMessages.length > 100) {
      this.chatMessages.shift();
    }
    
    this.players.forEach(player => {
      io.to(player.socketId).emit('chatMessage', { sender, text });
    });
  }

  broadcastGameUpdate() {
    const gameInfo = {
      id: this.id,
      creator: this.creator,
      players: this.players.map(p => ({ name: p.name, color: p.color })),
      betAmount: this.betAmount,
      status: this.status,
      currentPlayer: this.currentPlayer,
      fen: this.chess.fen(),
      lastMove: this.lastMove,
      whiteTime: this.whiteTime,
      blackTime: this.blackTime
    };
    
    this.players.forEach(player => {
      io.to(player.socketId).emit('gameUpdate', gameInfo);
    });
  }

  updateAvailableGames() {
    io.emit('availableGames', getAvailableGames());
  }
}

// Funciones auxiliares
function generateGameId() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function getAvailableGames() {
  return Object.values(games)
    .filter(game => game.status === 'waiting')
    .map(game => ({
      id: game.id,
      creator: game.creator,
      betAmount: game.betAmount,
      players: game.players.map(p => p.name),
      createdAt: game.createdAt
    }));
}

// Conexión de Socket.io
io.on('connection', (socket) => {
  console.log('Nuevo cliente conectado:', socket.id);
  
  // Registrar jugador
  socket.on('registerPlayer', (name, callback) => {
    players[socket.id] = {
      socketId: socket.id,
      name: name,
      balance: INITIAL_BALANCE,
      currentGame: null
    };
    
    callback({ success: true, balance: INITIAL_BALANCE });
    io.emit('availableGames', getAvailableGames());
  });
  
  // Crear un nuevo juego
  socket.on('createGame', ({ playerName, betAmount, timeControls }, callback) => {
    if (!players[socket.id]) {
      return callback({ error: "Jugador no registrado" });
    }
    
    if (players[socket.id].balance < betAmount) {
      return callback({ error: "Saldo insuficiente" });
    }
    
    const gameId = generateGameId();
    const game = new Game(gameId, playerName, betAmount, timeControls);
    games[gameId] = game;
    
    // Asignar el jugador al juego
    const result = game.addPlayer(players[socket.id]);
    if (result.error) {
      delete games[gameId];
      return callback(result);
    }
    
    players[socket.id].currentGame = gameId;
    
    callback({ gameId });
    game.addChatMessage('Sistema', `Sala creada por ${playerName}. Código: ${gameId}`);
    io.emit('availableGames', getAvailableGames());
  });
  
  // Unirse a un juego existente
  socket.on('joinGame', ({ gameId, playerName, betAmount }, callback) => {
    if (!players[socket.id]) {
      return callback({ error: "Jugador no registrado" });
    }
    
    const game = games[gameId];
    if (!game) {
      return callback({ error: "Sala no encontrada" });
    }
    
    if (game.betAmount !== betAmount) {
      return callback({ error: "El monto de apuesta no coincide" });
    }
    
    if (game.players.length >= 2) {
      return callback({ error: "La sala está llena" });
    }
    
    // Asignar el jugador al juego
    const result = game.addPlayer(players[socket.id]);
    if (result.error) {
      return callback(result);
    }
    
    players[socket.id].currentGame = gameId;
    
    callback({ success: true });
    game.addChatMessage('Sistema', `${playerName} se ha unido a la sala`);
  });
  
  // Realizar un movimiento
  socket.on('makeMove', ({ from, to, piece, gameId, promotion }, callback) => {
    const game = games[gameId];
    if (!game || game.status !== 'playing') {
      return callback({ error: "Juego no disponible" });
    }
    
    const success = game.makeMove(socket.id, from, to, piece, promotion);
    callback({ success });
  });
  
  // Ofrecer tablas
  socket.on('offerDraw', ({ gameId }, callback) => {
    const game = games[gameId];
    if (!game) {
      return callback({ error: "Juego no encontrado" });
    }
    
    const success = game.offerDraw(socket.id);
    callback({ success });
  });
  
  // Rendirse
  socket.on('resignGame', ({ gameId, player }, callback) => {
    const game = games[gameId];
    if (!game) {
      return callback({ error: "Juego no encontrado" });
    }
    
    game.handleResign(player);
    callback({ success: true });
  });
  
  // Tiempo agotado
  socket.on('timeout', ({ gameId, player }, callback) => {
    const game = games[gameId];
    if (!game) {
      return callback({ error: "Juego no encontrado" });
    }
    
    game.handleTimeout(player);
    callback({ success: true });
  });
  
  // Mensaje de chat
  socket.on('sendChat', ({ gameId, message, sender }, callback) => {
    const game = games[gameId];
    if (!game) {
      return callback({ error: "Juego no encontrado" });
    }
    
    game.addChatMessage(sender, message);
    callback({ success: true });
  });
  
  // Solicitar juegos disponibles
  socket.on('requestGames', (callback) => {
    callback(getAvailableGames());
  });
  
  // Cancelar juego
  socket.on('cancelGame', ({ gameId }, callback) => {
    const game = games[gameId];
    if (!game || game.status !== 'waiting') {
      return callback({ error: "No se puede cancelar el juego" });
    }
    
    // Devolver el dinero al creador
    const creator = game.players[0];
    if (creator) {
      creator.balance += game.betAmount;
      io.to(creator.socketId).emit('balanceUpdate', { balance: creator.balance });
    }
    
    delete games[gameId];
    io.emit('availableGames', getAvailableGames());
    callback({ success: true });
  });
  
  // Desconexión del cliente
  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
    
    const player = players[socket.id];
    if (player && player.currentGame) {
      const game = games[player.currentGame];
      if (game) {
        if (game.status === 'waiting') {
          // Si estaba esperando, cancelar el juego
          player.balance += game.betAmount;
          delete games[player.currentGame];
          io.emit('availableGames', getAvailableGames());
        } else if (game.status === 'playing') {
          // Si estaba jugando, terminar el juego
          game.addChatMessage('Sistema', `${player.name} se ha desconectado`);
          game.finishGame('opponent_disconnected');
        }
      }
    }
    
    delete players[socket.id];
  });
});

// Iniciar el servidor
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor de ajedrez corriendo en http://localhost:${PORT}`);
});