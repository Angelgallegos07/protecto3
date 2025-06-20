import React, { useState, useEffect, useCallback } from 'react';
import { Chess } from 'chess.js';
import { io } from 'socket.io-client';
import './App.css';

// Conexión Socket.IO condicional
let socket;
try {
  socket = io('http://192.168.1.6:3000', {
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    autoConnect: false
  });
} catch (error) {
  console.log("Modo offline activado");
}

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

const ChessBoard = ({ 
  board, 
  onMove, 
  currentPlayer, 
  selectedPiece,
  onSelectPiece,
  lastMove,
  isFlipped
}) => {
  const handleSquareClick = (row, col) => {
    if (selectedPiece) {
      // Intentar mover la pieza
      onMove({
        from: selectedPiece,
        to: { row, col },
        piece: board[selectedPiece.row][selectedPiece.col]
      });
    } else if (board[row][col] && 
              ((currentPlayer === 'white' && board[row][col] === board[row][col].toUpperCase()) || 
               (currentPlayer === 'black' && board[row][col] === board[row][col].toLowerCase()))) {
      // Seleccionar pieza
      onSelectPiece({ row, col });
    }
  };

  return (
    <div className="chess-board-container">
      <div className="chess-board">
        {board.map((row, rowIndex) => (
          row.map((piece, colIndex) => {
            const isLight = (rowIndex + colIndex) % 2 === 0;
            const isSelected = selectedPiece && selectedPiece.row === rowIndex && selectedPiece.col === colIndex;
            const isLastMove = lastMove && 
              ((lastMove.from.row === rowIndex && lastMove.from.col === colIndex) || 
               (lastMove.to.row === rowIndex && lastMove.to.col === colIndex));

            return (
              <div
                key={`${rowIndex}-${colIndex}`}
                className={`chess-square ${isLight ? 'light' : 'dark'} ${
                  isSelected ? 'selected' : ''
                } ${isLastMove ? 'last-move' : ''}`}
                onClick={() => handleSquareClick(rowIndex, colIndex)}
              >
                {piece && <ChessPiece type={piece} color={piece === piece.toUpperCase() ? 'white' : 'black'} />}
              </div>
            );
          })
        ))}
      </div>
    </div>
  );
};

const PromotionDialog = ({ onSelect }) => {
  const pieces = ['q', 'r', 'b', 'n'];
  
  return (
    <div className="promotion-dialog">
      <div className="promotion-options">
        {pieces.map(piece => (
          <div 
            key={piece} 
            className="promotion-option"
            onClick={() => onSelect(piece)}
          >
            <ChessPiece type={piece} color="white" />
          </div>
        ))}
      </div>
    </div>
  );
};

const GameResultMessage = ({ result, onClose }) => {
  const resultMessages = {
    'white_wins': '¡Blancas ganan!',
    'black_wins': '¡Negras ganan!',
    'draw': '¡Empate!'
  };

  return (
    <div className="game-result">
      <div className="result-message">
        <h2>{resultMessages[result] || 'Fin del juego'}</h2>
        <button onClick={onClose}>Jugar de nuevo</button>
      </div>
    </div>
  );
};

const ChessGame = () => {
  const [board, setBoard] = useState(Array(8).fill().map(() => Array(8).fill('')));
  const [currentPlayer, setCurrentPlayer] = useState('white');
  const [selectedPiece, setSelectedPiece] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const [gameStatus, setGameStatus] = useState('menu');
  const [gameResult, setGameResult] = useState(null);
  const [showPromotionDialog, setShowPromotionDialog] = useState(false);
  const [pendingPromotion, setPendingPromotion] = useState(null);
  const [chessEngine] = useState(new Chess());
  const [gameCode, setGameCode] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [playerColor, setPlayerColor] = useState('');
  const [opponentConnected, setOpponentConnected] = useState(false);
  const [whiteTime, setWhiteTime] = useState(300);
  const [blackTime, setBlackTime] = useState(300);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [gameMode, setGameMode] = useState('online');

  const updateBoardFromFen = useCallback((fen) => {
    chessEngine.load(fen);
    const newBoard = Array(8).fill().map(() => Array(8).fill(''));
    chessEngine.board().forEach((row, rowIndex) => {
      row.forEach((square, colIndex) => {
        if (square) {
          newBoard[rowIndex][colIndex] = square.color === 'w' 
            ? square.type.toUpperCase() 
            : square.type.toLowerCase();
        }
      });
    });
    setBoard(newBoard);
    setCurrentPlayer(chessEngine.turn() === 'w' ? 'white' : 'black');
  }, [chessEngine]);

  useEffect(() => {
    if (gameMode !== 'online') return;

    const onConnect = () => setConnectionStatus('connected');
    const onDisconnect = () => setConnectionStatus('disconnected');
    const onGameCreated = ({ code, color }) => {
      setGameCode(code);
      setPlayerColor(color);
      setGameStatus('waiting');
      setIsCreatingRoom(false);
    };
    const onGameStart = ({ fen, color }) => {
      setPlayerColor(color);
      updateBoardFromFen(fen);
      setGameStatus('playing');
      setOpponentConnected(true);
    };
    const onMoveMade = ({ fen }) => updateBoardFromFen(fen);
    const onGameOver = ({ result }) => {
      setGameStatus('finished');
      setGameResult(result);
    };
    const onOpponentDisconnected = () => {
      setGameStatus('finished');
      setGameResult(playerColor === 'white' ? 'white_wins' : 'black_wins');
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('gameCreated', onGameCreated);
    socket.on('gameStart', onGameStart);
    socket.on('moveMade', onMoveMade);
    socket.on('gameOver', onGameOver);
    socket.on('opponentDisconnected', onOpponentDisconnected);

    socket.connect();

    return () => {
      if (socket) {
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
        socket.off('gameCreated', onGameCreated);
        socket.off('gameStart', onGameStart);
        socket.off('moveMade', onMoveMade);
        socket.off('gameOver', onGameOver);
        socket.off('opponentDisconnected', onOpponentDisconnected);
        socket.disconnect();
      }
    };
  }, [gameMode, playerColor, updateBoardFromFen]);

  useEffect(() => {
    let interval;
    if (gameStatus === 'playing') {
      interval = setInterval(() => {
        if (currentPlayer === 'white') {
          setWhiteTime(prev => prev <= 0 ? 0 : prev - 1);
        } else {
          setBlackTime(prev => prev <= 0 ? 0 : prev - 1);
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [currentPlayer, gameStatus]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const createGame = () => {
    if (gameMode === 'offline') {
      startOfflineGame();
      return;
    }

    setIsCreatingRoom(true);
    socket.emit('createGame', (response) => {
      if (!response.success) {
        setIsCreatingRoom(false);
        alert('Error al crear la sala. Activando modo offline...');
        setGameMode('offline');
        startOfflineGame();
      }
    });
  };

  const startOfflineGame = () => {
    setGameMode('offline');
    setPlayerColor('white');
    setGameStatus('playing');
    initializeGame();
    setConnectionStatus('offline');
  };

  const joinGame = () => {
    if (!inputCode.trim()) {
      alert('Por favor ingresa un código de sala');
      return;
    }

    socket.emit('joinGame', inputCode.trim(), (response) => {
      if (!response.success) {
        alert(response.message || 'No se pudo unir a la sala. Jugando offline...');
        setGameMode('offline');
        startOfflineGame();
      }
    });
  };

  const handleMove = (move) => {
    if (gameStatus !== 'playing') return;
    if (gameMode === 'online' && playerColor !== currentPlayer) return;

    const fromPos = `${String.fromCharCode(97 + move.from.col)}${8 - move.from.row}`;
    const toPos = `${String.fromCharCode(97 + move.to.col)}${8 - move.to.row}`;

    if (move.piece.toLowerCase() === 'p' && (move.to.row === 0 || move.to.row === 7)) {
      setPendingPromotion({ from: fromPos, to: toPos });
      setShowPromotionDialog(true);
      return;
    }

    if (gameMode === 'online') {
      socket.emit('move', { 
        gameId: gameCode,
        move: { from: fromPos, to: toPos, promotion: 'q' }
      });
    } else {
      try {
        const result = chessEngine.move({
          from: fromPos,
          to: toPos,
          promotion: 'q'
        });
        
        if (result) {
          updateBoardFromFen(chessEngine.fen());
          setLastMove({ from: move.from, to: move.to });
          setSelectedPiece(null);
          
          if (chessEngine.isGameOver()) {
            const result = chessEngine.isCheckmate() 
              ? currentPlayer === 'white' ? 'black_wins' : 'white_wins'
              : 'draw';
            setGameStatus('finished');
            setGameResult(result);
          }
        }
      } catch (err) {
        console.log("Movimiento inválido:", err);
      }
    }
  };

  const handlePromotionSelect = (piece) => {
    setShowPromotionDialog(false);
    if (gameMode === 'online') {
      socket.emit('move', { 
        gameId: gameCode,
        move: { 
          from: pendingPromotion.from, 
          to: pendingPromotion.to, 
          promotion: piece 
        }
      });
    } else {
      try {
        const result = chessEngine.move({
          from: pendingPromotion.from,
          to: pendingPromotion.to,
          promotion: piece
        });
        
        if (result) {
          updateBoardFromFen(chessEngine.fen());
          setSelectedPiece(null);
          
          if (chessEngine.isGameOver()) {
            const result = chessEngine.isCheckmate() 
              ? currentPlayer === 'white' ? 'black_wins' : 'white_wins'
              : 'draw';
            setGameStatus('finished');
            setGameResult(result);
          }
        }
      } catch (err) {
        console.log("Movimiento inválido:", err);
      }
    }
  };

  const initializeGame = useCallback(() => {
    chessEngine.reset();
    updateBoardFromFen(chessEngine.fen());
    setCurrentPlayer('white');
    setGameStatus(gameMode === 'offline' ? 'playing' : 'menu');
    setGameResult(null);
    setLastMove(null);
    setSelectedPiece(null);
    setWhiteTime(300);
    setBlackTime(300);
    setGameCode('');
    setOpponentConnected(false);
    setIsCreatingRoom(false);
  }, [chessEngine, updateBoardFromFen, gameMode]);

  return (
    <div className="chess-app">
      <h1>Ajedrez {gameMode === 'online' ? 'Multijugador' : 'Offline'}</h1>
      <p className={`connection-status ${connectionStatus}`}>
        Modo: {gameMode === 'online' ? 
          (connectionStatus === 'connected' ? 'Online (Conectado)' : 'Online (Desconectado)') : 
          'Offline'}
      </p>

      {gameStatus === 'menu' && (
        <div className="lobby">
          <div className="mode-selector">
            <button 
              onClick={() => setGameMode('online')} 
              className={gameMode === 'online' ? 'active' : ''}
            >
              Online
            </button>
            <button 
              onClick={() => setGameMode('offline')} 
              className={gameMode === 'offline' ? 'active' : ''}
            >
              Offline
            </button>
          </div>

          {gameMode === 'online' ? (
            <>
              <button 
                onClick={createGame} 
                disabled={isCreatingRoom}
                className={`create-btn ${isCreatingRoom ? 'creating' : ''}`}
              >
                {isCreatingRoom ? 'Creando sala...' : 'Crear Sala'}
              </button>
              <div className="join-game">
                <input
                  type="text"
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value)}
                  placeholder="Código de sala"
                />
                <button onClick={joinGame}>Unirse</button>
              </div>
            </>
          ) : (
            <button onClick={startOfflineGame} className="start-offline-btn">
              Comenzar Juego Offline
            </button>
          )}
        </div>
      )}

      {gameStatus === 'waiting' && (
        <div className="waiting-room">
          <h2>Esperando oponente...</h2>
          <p>Código de sala: <strong>{gameCode}</strong></p>
          <p>Tu color: <strong>{playerColor === 'white' ? 'Blancas' : 'Negras'}</strong></p>
        </div>
      )}

      {(gameStatus === 'playing' || gameStatus === 'finished') && (
        <>
          <div className="game-controls">
            <button onClick={() => setIsFlipped(!isFlipped)} className="flip-board-btn">
              Voltear tablero
            </button>
            <button onClick={initializeGame} className="reset-btn">
              Reiniciar
            </button>
          </div>

          <div className="timers">
            <div className={`timer white ${currentPlayer === 'white' ? 'active' : ''}`}>
              Blancas: {formatTime(whiteTime)}
            </div>
            <div className={`timer black ${currentPlayer === 'black' ? 'active' : ''}`}>
              Negras: {formatTime(blackTime)}
            </div>
          </div>

          <ChessBoard
            board={board}
            onMove={handleMove}
            currentPlayer={playerColor || currentPlayer}
            selectedPiece={selectedPiece}
            onSelectPiece={setSelectedPiece}
            lastMove={lastMove}
            isFlipped={isFlipped}
          />

          {showPromotionDialog && (
            <PromotionDialog onSelect={handlePromotionSelect} />
          )}

          {gameStatus === 'finished' && gameResult && (
            <GameResultMessage 
              result={gameResult} 
              onClose={initializeGame}
            />
          )}
        </>
      )}
    </div>
  );
};

export default ChessGame;