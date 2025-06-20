const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Chess } = require('chess.js');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Almacenamiento de juegos en memoria
const games = new Map();

// Generar código de sala aleatorio
const generateGameCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

// Manejar conexiones Socket.io
io.on('connection', (socket) => {
  console.log(`Usuario conectado: ${socket.id}`);

  // Crear una nueva sala de juego
  socket.on('createGame', (callback) => {
    try {
      const gameCode = generateGameCode();
      const chess = new Chess();
      
      const game = {
        code: gameCode,
        players: [socket.id],
        playerColors: { [socket.id]: 'white' },
        chess,
        fen: chess.fen(),
        status: 'waiting',
        turn: 'white'
      };
      
      games.set(gameCode, game);
      socket.join(gameCode);
      
      console.log(`Sala creada: ${gameCode}`);
      
      callback({ 
        success: true, 
        code: gameCode, 
        color: 'white' 
      });
    } catch (error) {
      console.error('Error al crear sala:', error);
      callback({ 
        success: false, 
        message: 'Error al crear la sala' 
      });
    }
  });

  // Unirse a una sala existente
  socket.on('joinGame', (code, callback) => {
    try {
      const game = games.get(code);
      
      if (!game) {
        return callback({ 
          success: false, 
          message: 'Sala no encontrada' 
        });
      }
      
      if (game.players.length >= 2) {
        return callback({ 
          success: false, 
          message: 'La sala está llena' 
        });
      }
      
      // Asignar color al segundo jugador
      const color = 'black';
      game.players.push(socket.id);
      game.playerColors[socket.id] = color;
      game.status = 'playing';
      
      socket.join(code);
      
      // Notificar a ambos jugadores que el juego ha comenzado
      io.to(code).emit('gameStart', { 
        fen: game.chess.fen(), 
        color: game.playerColors 
      });
      
      console.log(`Usuario ${socket.id} se unió a la sala ${code} como ${color}`);
      
      callback({ 
        success: true, 
        color 
      });
    } catch (error) {
      console.error('Error al unirse a sala:', error);
      callback({ 
        success: false, 
        message: 'Error al unirse a la sala' 
      });
    }
  });

  // Manejar movimiento de pieza
  socket.on('move', ({ gameId, move }, callback) => {
    try {
      const game = games.get(gameId);
      
      if (!game) {
        return callback({ 
          success: false, 
          message: 'Juego no encontrado' 
        });
      }
      
      // Verificar que es el turno del jugador
      const playerColor = game.playerColors[socket.id];
      if ((playerColor === 'white' && game.chess.turn() !== 'w') || 
          (playerColor === 'black' && game.chess.turn() !== 'b')) {
        return callback({ 
          success: false, 
          message: 'No es tu turno' 
        });
      }
      
      // Intentar hacer el movimiento
      let result;
      try {
        result = game.chess.move(move);
      } catch (err) {
        return callback({ 
          success: false, 
          message: 'Movimiento inválido' 
        });
      }
      
      if (!result) {
        return callback({ 
          success: false, 
          message: 'Movimiento inválido' 
        });
      }
      
      // Actualizar estado del juego
      game.fen = game.chess.fen();
      game.turn = game.chess.turn() === 'w' ? 'white' : 'black';
      
      // Notificar a ambos jugadores sobre el movimiento
      io.to(gameId).emit('moveMade', { 
        fen: game.fen,
        move: result
      });
      
      // Verificar si el juego ha terminado
      if (game.chess.isGameOver()) {
        let result;
        if (game.chess.isCheckmate()) {
          result = game.chess.turn() === 'w' ? 'black_wins' : 'white_wins';
        } else if (game.chess.isDraw()) {
          result = 'draw';
        } else {
          result = 'draw'; // Por insuficiencia de material, etc.
        }
        
        game.status = 'finished';
        io.to(gameId).emit('gameOver', { result });
        
        // Limpiar el juego después de un tiempo
        setTimeout(() => {
          games.delete(gameId);
        }, 30000);
      }
      
      callback({ 
        success: true 
      });
    } catch (error) {
      console.error('Error al procesar movimiento:', error);
      callback({ 
        success: false, 
        message: 'Error al procesar movimiento' 
      });
    }
  });

  // Manejar desconexión de jugador
  socket.on('disconnect', () => {
    console.log(`Usuario desconectado: ${socket.id}`);
    
    // Buscar juegos donde este jugador estaba participando
    for (const [code, game] of games) {
      const index = game.players.indexOf(socket.id);
      
      if (index !== -1) {
        // Si el juego estaba en progreso, notificar al otro jugador
        if (game.status === 'playing') {
          const otherPlayerId = game.players.find(id => id !== socket.id);
          if (otherPlayerId) {
            io.to(otherPlayerId).emit('opponentDisconnected');
          }
        }
        
        // Eliminar el juego
        games.delete(code);
        console.log(`Sala ${code} eliminada por desconexión`);
        break;
      }
    }
  });
});

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('Servidor de Ajedrez Multijugador');
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
