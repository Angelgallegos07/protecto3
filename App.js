import React, { useState, useEffect, useCallback } from 'react';
import io from 'socket.io-client';
import { Chess } from 'chess.js';
import './App.css';

// Configuración inicial del socket
const setupSocket = () => {
  const socket = io('http://localhost:5000', {
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    transports: ['websocket']
  });
  return socket;
};

// Componente de Pieza de Ajedrez
const ChessPiece = ({ type, color }) => {
  const pieceMap = {
    p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
    P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔'
  };

  return (
    <div className={`chess-piece ${color}`}>
      {pieceMap[type]}
    </div>
  );
};

// Componente del Tablero de Ajedrez
const ChessBoard = ({ 
  board, 
  onMove, 
  currentPlayer, 
  playerColor, 
  selectedPiece,
  onSelectPiece,
  lastMove,
  isFlipped
}) => {
  const renderSquare = (row, col) => {
    const isLight = (row + col) % 2 === 0;
    const piece = board[row][col];
    const isSelected = selectedPiece && selectedPiece.row === row && selectedPiece.col === col;
    const isLastMove = lastMove && (
      (lastMove.from.row === row && lastMove.from.col === col) ||
      (lastMove.to.row === row && lastMove.to.col === col)
    );

    const displayRow = isFlipped ? 7 - row : row;
    const displayCol = isFlipped ? 7 - col : col;

    return (
      <div
        key={`${row}-${col}`}
        className={`square ${isLight ? 'light' : 'dark'} 
          ${isSelected ? 'selected' : ''}
          ${isLastMove ? 'last-move' : ''}`}
        onClick={() => {
          if (piece && (piece === piece.toUpperCase() ? 'white' : 'black') === playerColor) {
            onSelectPiece({ row, col });
          } else if (selectedPiece) {
            onMove({
              from: selectedPiece,
              to: { row, col },
              piece: board[selectedPiece.row][selectedPiece.col]
            });
          }
        }}
      >
        {piece && (
          <ChessPiece 
            type={piece} 
            color={piece === piece.toUpperCase() ? 'white' : 'black'} 
          />
        )}
        {(row === 0 || row === 7) && (
          <div className="square-label file">
            {String.fromCharCode(97 + displayCol)}
          </div>
        )}
        {(col === 0 || col === 7) && (
          <div className="square-label rank">
            {8 - displayRow}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`chess-board ${isFlipped ? 'flipped' : ''}`}>
      {Array(8).fill().map((_, row) => (
        <div key={row} className="board-row">
          {Array(8).fill().map((_, col) => renderSquare(row, col))}
        </div>
      ))}
    </div>
  );
};

// Componente de Temporizador
const Timer = ({ time, isActive, color }) => {
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className={`timer ${color} ${isActive ? 'active' : ''}`}>
      {formatTime(time)}
    </div>
  );
};

// Componente principal de la App
function App() {
  // Estados del juego
  const [board, setBoard] = useState(Array(8).fill().map(() => Array(8).fill('')));
  const [currentPlayer, setCurrentPlayer] = useState('white');
  const [gameStatus, setGameStatus] = useState('lobby');
  const [playerColor, setPlayerColor] = useState(null);
  const [gameId, setGameId] = useState('');
  const [betAmount, setBetAmount] = useState(10);
  const [balance, setBalance] = useState(1000);
  const [playerName, setPlayerName] = useState('');
  const [opponentName, setOpponentName] = useState('');
  const [pot, setPot] = useState(0);
  const [availableGames, setAvailableGames] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [socket, setSocket] = useState(null);
  const [selectedPiece, setSelectedPiece] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [whiteTime, setWhiteTime] = useState(300);
  const [blackTime, setBlackTime] = useState(300);
  const [timerInterval, setTimerInterval] = useState(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const [gameResult, setGameResult] = useState(null);
  const [showPromotionDialog, setShowPromotionDialog] = useState(false);
  const [pendingPromotion, setPendingPromotion] = useState(null);
  const [chessEngine] = useState(new Chess());
  const [joinCode, setJoinCode] = useState('');
  const [showJoinModal, setShowJoinModal] = useState(false);

  // Función para actualizar el estado del tablero
  const updateBoardState = useCallback(() => {
    const newBoard = Array(8).fill().map(() => Array(8).fill(''));
    chessEngine.board().forEach((row, rowIndex) => {
      row.forEach((square, colIndex) => {
        if (square) {
          newBoard[rowIndex][colIndex] = square.type === 'p' 
            ? square.color === 'w' ? 'P' : 'p'
            : square.color === 'w' 
              ? square.type.toUpperCase() 
              : square.type;
        }
      });
    });
    setBoard(newBoard);
  }, [chessEngine]);

  // Función para inicializar el juego
  const initializeGame = useCallback(() => {
    chessEngine.reset();
    updateBoardState();
  }, [chessEngine, updateBoardState]);

  // Calcular movimientos válidos
  const calculateValidMoves = useCallback((from) => {
    const moves = chessEngine.moves({
      square: `${String.fromCharCode(97 + from.col)}${8 - from.row}`,
      verbose: true
    });
    
    return moves.map(move => ({
      row: 8 - parseInt(move.to[1]),
      col: move.to.charCodeAt(0) - 97
    }));
  }, [chessEngine]);

  // Manejar selección de pieza
  const handleSelectPiece = useCallback((position) => {
    if (gameStatus !== 'playing' || currentPlayer !== playerColor) return;
    
    const piece = board[position.row][position.col];
    if (piece && (piece === piece.toUpperCase() ? 'white' : 'black') === playerColor) {
      setSelectedPiece(position);
    }
  }, [board, currentPlayer, gameStatus, playerColor]);

  // Efecto para el temporizador
  useEffect(() => {
    const startTimer = () => {
      if (timerInterval) clearInterval(timerInterval);
      
      const interval = setInterval(() => {
        if (currentPlayer === 'white') {
          setWhiteTime(prev => {
            if (prev <= 1) {
              clearInterval(interval);
              socket?.emit('timeout', { gameId, player: 'white' });
              return 0;
            }
            return prev - 1;
          });
        } else {
          setBlackTime(prev => {
            if (prev <= 1) {
              clearInterval(interval);
              socket?.emit('timeout', { gameId, player: 'black' });
              return 0;
            }
            return prev - 1;
          });
        }
      }, 1000);
      
      setTimerInterval(interval);
    };

    if (gameStatus === 'playing') {
      startTimer();
    }
    
    return () => {
      if (timerInterval) clearInterval(timerInterval);
    };
  }, [currentPlayer, gameStatus, gameId, socket, timerInterval]);

  // Efecto principal para la conexión del socket
  useEffect(() => {
    const newSocket = setupSocket();
    setSocket(newSocket);

    // Configurar listeners del socket
    newSocket.on('connect', () => {
      setConnectionStatus('connected');
    });

    newSocket.on('disconnect', () => {
      setConnectionStatus('disconnected');
    });

    newSocket.on('availableGames', (games) => {
      setAvailableGames(games);
    });

    newSocket.on('gameCreated', (data) => {
      setGameId(data.gameId);
      setGameStatus('waiting');
      addChatMessage('Sistema', `Sala creada. Código: ${data.gameId}`);
    });

    newSocket.on('gameStarted', (data) => {
      chessEngine.load(data.fen);
      updateBoardState();
      setCurrentPlayer(data.currentPlayer);
      setGameStatus('playing');
      setPlayerColor(data.playerColor);
      setOpponentName(data.opponentName);
      setPot(data.betAmount * 2);
      setIsFlipped(data.playerColor === 'black');
      setWhiteTime(data.timeControls || 300);
      setBlackTime(data.timeControls || 300);
      setGameResult(null);
      addChatMessage('Sistema', `¡Partida comenzada! Apuesta: $${data.betAmount}`);
    });

    newSocket.on('moveMade', (data) => {
      chessEngine.load(data.fen);
      updateBoardState();
      setCurrentPlayer(data.currentPlayer);
      setLastMove({ from: data.from, to: data.to });
      addChatMessage('Sistema', `Movimiento: ${data.piece} de ${data.move.from} a ${data.move.to}`);
    });

    newSocket.on('gameFinished', (data) => {
      setGameStatus('finished');
      setBalance(data.balance);
      setGameResult(data.result);
      addChatMessage('Sistema', `¡Partida terminada! Ganador: ${data.result === 'draw' ? 'Empate' : data.result === 'white_wins' ? 'Blancas' : 'Negras'}`);
    });

    newSocket.on('playerDisconnected', () => {
      setGameStatus('finished');
      setGameResult('opponent_disconnected');
      addChatMessage('Sistema', '¡El oponente se ha desconectado!');
    });

    newSocket.on('chatMessage', (message) => {
      addChatMessage(message.sender, message.text);
    });

    // Solicitar partidas disponibles al conectar
    newSocket.emit('requestGames');
    initializeGame();

    return () => {
      newSocket.disconnect();
      if (timerInterval) clearInterval(timerInterval);
    };
  }, [chessEngine, initializeGame, timerInterval, updateBoardState]);

  // Funciones del juego
  const addChatMessage = (sender, text) => {
    setChatMessages(prev => [...prev.slice(-50), { sender, text }]);
  };

  const sendChatMessage = () => {
    if (messageInput.trim() && socket) {
      socket.emit('sendChat', {
        gameId,
        message: messageInput,
        sender: playerName
      });
      setMessageInput('');
    }
  };

  const createGame = () => {
    if (balance < betAmount || !playerName.trim() || !socket) {
      addChatMessage('Sistema', 'Nombre o apuesta inválidos');
      return;
    }
    socket.emit('createGame', { 
      playerName, 
      betAmount,
      timeControls: 300
    });
  };

  const joinGame = (id) => {
    if (balance < betAmount || !playerName.trim() || !socket) {
      addChatMessage('Sistema', 'Nombre o apuesta inválidos');
      return;
    }
    socket.emit('joinGame', { 
      gameId: id, 
      playerName
    });
    setShowJoinModal(false);
  };

  const handleMove = (move) => {
    if (gameStatus !== 'playing' || currentPlayer !== playerColor || !socket) return;

    const fromPos = `${String.fromCharCode(97 + move.from.col)}${8 - move.from.row}`;
    const toPos = `${String.fromCharCode(97 + move.to.col)}${8 - move.to.row}`;
    
    // Verificar si es un movimiento de promoción
    const promotionMove = (move.piece.toLowerCase() === 'p' && 
      (move.to.row === 0 || move.to.row === 7));
    
    if (promotionMove) {
      setPendingPromotion({ from: move.from, to: move.to, piece: move.piece });
      setShowPromotionDialog(true);
      return;
    }
    
    // Mover la pieza en el motor de ajedrez
    try {
      const chessMove = chessEngine.move({
        from: fromPos,
        to: toPos,
        promotion: 'q'
      });
      
      if (chessMove) {
        updateBoardState();
        setLastMove({ from: move.from, to: move.to });
        setSelectedPiece(null);
        
        socket.emit('makeMove', {
          from: move.from,
          to: move.to,
          piece: move.piece,
          player: playerColor,
          gameId,
          fen: chessEngine.fen()
        });
        
        setCurrentPlayer(playerColor === 'white' ? 'black' : 'white');
      }
    } catch (err) {
      console.error("Movimiento inválido:", err);
    }
  };

  const handlePromotion = (piece) => {
    if (!pendingPromotion || !socket) return;
    
    setShowPromotionDialog(false);
    const promotionPiece = playerColor === 'white' ? piece.toUpperCase() : piece.toLowerCase();
    
    try {
      const fromPos = `${String.fromCharCode(97 + pendingPromotion.from.col)}${8 - pendingPromotion.from.row}`;
      const toPos = `${String.fromCharCode(97 + pendingPromotion.to.col)}${8 - pendingPromotion.to.row}`;
      
      const chessMove = chessEngine.move({
        from: fromPos,
        to: toPos,
        promotion: piece
      });
      
      if (chessMove) {
        updateBoardState();
        setLastMove({ from: pendingPromotion.from, to: pendingPromotion.to });
        
        socket.emit('makeMove', {
          from: pendingPromotion.from,
          to: pendingPromotion.to,
          piece: pendingPromotion.piece,
          promotion: promotionPiece,
          player: playerColor,
          gameId,
          fen: chessEngine.fen()
        });
        
        setCurrentPlayer(playerColor === 'white' ? 'black' : 'white');
      }
    } catch (err) {
      console.error("Error en promoción:", err);
    }
    
    setPendingPromotion(null);
  };

  const handleResign = () => {
    if (gameStatus === 'playing' && socket) {
      socket.emit('resignGame', { gameId, player: playerColor });
      addChatMessage('Sistema', `${playerName} se ha rendido.`);
    }
  };

  const offerDraw = () => {
    if (gameStatus === 'playing' && socket) {
      socket.emit('offerDraw', { gameId });
      addChatMessage('Sistema', `${playerName} ofrece tablas`);
    }
  };

  const flipBoard = () => {
    setIsFlipped(!isFlipped);
  };

  // Componentes de la interfaz
  const PromotionDialog = () => (
    <div className="promotion-dialog">
      <h3>Promocionar peón a:</h3>
      <div className="promotion-options">
        {['q', 'r', 'b', 'n'].map(piece => (
          <div 
            key={piece} 
            className="promotion-option"
            onClick={() => handlePromotion(piece)}
          >
            <ChessPiece 
              type={playerColor === 'white' ? piece.toUpperCase() : piece.toLowerCase()} 
              color={playerColor} 
            />
          </div>
        ))}
      </div>
    </div>
  );

  const JoinModal = () => (
    <div className="modal-overlay">
      <div className="modal">
        <h3>Unirse a Partida</h3>
        <input
          type="text"
          placeholder="Código de la sala"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
        />
        <div className="modal-buttons">
          <button onClick={() => joinGame(joinCode)}>Unirse</button>
          <button onClick={() => setShowJoinModal(false)}>Cancelar</button>
        </div>
      </div>
    </div>
  );

  const GameResultMessage = () => {
    if (!gameResult) return null;
    
    const messages = {
      'white_wins': '¡Blancas ganan!',
      'black_wins': '¡Negras ganan!',
      'draw': '¡Tablas!',
      'timeout_white': '¡Negras ganan por tiempo!',
      'timeout_black': '¡Blancas ganan por tiempo!',
      'opponent_disconnected': '¡El oponente se desconectó!',
      'white_resigned': '¡Negras ganan por rendición!',
      'black_resigned': '¡Blancas ganan por rendición!'
    };
    
    return (
      <div className={`game-result ${gameResult.includes('white') ? 'white' : 'black'}`}>
        {messages[gameResult] || 'Partida terminada'}
        {gameResult.includes('wins') && (
          <p>¡Ganaste ${pot} monedas!</p>
        )}
      </div>
    );
  };

  // Renderizado principal
  return (
    <div className="app">
      {showJoinModal && <JoinModal />}
      {showPromotionDialog && <PromotionDialog />}

      {gameStatus === 'waiting' && (
        <div className="waiting-room">
          <h2>Sala de Espera</h2>
          <p>Código de sala: <strong>{gameId}</strong></p>
          <p>Comparte este código con tu oponente</p>
          <p>Apuesta: <strong>${betAmount}</strong></p>
          <p>Esperando al segundo jugador...</p>
          <button onClick={() => socket.emit('cancelGame', { gameId })}>Cancelar partida</button>
        </div>
      )}

      {gameStatus === 'playing' && (
        <div className="game-container">
          <div className="game-header">
            <div className="player-info">
              <div className={`player ${playerColor === 'white' ? 'active' : ''}`}>
                <span>{playerColor === 'white' ? playerName : opponentName} (Blancas)</span>
                <Timer time={whiteTime} isActive={currentPlayer === 'white'} color="white" />
              </div>
              
              <div className="game-status">
                <span>Apuesta: ${betAmount} (Total: ${pot})</span>
                <span>Turno: {currentPlayer === 'white' ? 'Blancas' : 'Negras'}</span>
              </div>
              
              <div className={`player ${playerColor === 'black' ? 'active' : ''}`}>
                <span>{playerColor === 'black' ? playerName : opponentName} (Negras)</span>
                <Timer time={blackTime} isActive={currentPlayer === 'black'} color="black" />
              </div>
            </div>
            
            <div className="game-controls">
              <button onClick={flipBoard}>Voltear tablero</button>
              <button onClick={offerDraw}>Ofrecer tablas</button>
              <button onClick={handleResign}>Rendirse</button>
            </div>
          </div>
          
          <div className="game-content">
            <div className="board-container">
              <ChessBoard 
                board={board} 
                onMove={handleMove} 
                currentPlayer={currentPlayer}
                playerColor={playerColor}
                selectedPiece={selectedPiece}
                onSelectPiece={handleSelectPiece}
                lastMove={lastMove}
                isFlipped={isFlipped}
              />
            </div>
            
            <div className="game-sidebar">
              <div className="chat-container">
                <div className="chat-messages">
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`message ${msg.sender === playerName ? 'own' : ''}`}>
                      <strong>{msg.sender}:</strong> {msg.text}
                    </div>
                  ))}
                </div>
                <div className="chat-input">
                  <input
                    type="text"
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                    placeholder="Escribe un mensaje..."
                  />
                  <button onClick={sendChatMessage}>Enviar</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {gameStatus === 'finished' && (
        <div className="game-finished">
          <GameResultMessage />
          <div className="balance-update">
            Nuevo saldo: <span>${balance}</span>
          </div>
          <button onClick={() => setGameStatus('lobby')}>Volver al lobby</button>
        </div>
      )}

      {gameStatus === 'lobby' && (
        <div className="lobby">
          <h1>Ajedrez Multiplayer con Apuestas</h1>
          <div className="connection-status">
            Estado: {connectionStatus === 'connected' ? 'Conectado al servidor' : 'Desconectado'}
          </div>
          
          <div className="player-setup">
            <input
              type="text"
              placeholder="Tu nombre"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              required
            />
            <div className="balance">Saldo: ${balance}</div>
          </div>
          
          <div className="create-game">
            <h2>Crear Nueva Sala</h2>
            <div className="bet-selector">
              <label>Apuesta inicial:</label>
              <input
                type="number"
                min="10"
                max={balance}
                value={betAmount}
                onChange={(e) => setBetAmount(Math.max(10, parseInt(e.target.value) || 10))}
              />
              <span>Monedas</span>
            </div>
            <button 
              onClick={createGame}
              disabled={connectionStatus !== 'connected' || !playerName.trim() || balance < betAmount}
            >
              Crear Sala (${betAmount})
            </button>
          </div>
          
          <div className="join-game">
            <h2>Unirse a Sala Existente</h2>
            <button 
              onClick={() => setShowJoinModal(true)}
              disabled={connectionStatus !== 'connected' || !playerName.trim()}
            >
              Ingresar Código de Sala
            </button>
          </div>
          
          <div className="available-games">
            <h2>Salas Disponibles</h2>
            {availableGames.length > 0 ? (
              <div className="games-list">
                {availableGames.map(game => (
                  <div key={game.id} className="game-item">
                    <div className="game-info">
                      <span className="creator">{game.creator}</span>
                      <span className="bet">${game.betAmount}</span>
                      <span className="status">{game.players.length}/2 jugadores</span>
                    </div>
                    <button 
                      onClick={() => joinGame(game.id)}
                      disabled={connectionStatus !== 'connected' || !playerName.trim() || game.players.length >= 2 || balance < game.betAmount}
                    >
                      {game.players.length >= 2 ? 'Llena' : 'Unirse'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p>No hay salas disponibles</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;