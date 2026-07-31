"use client";
import { useEffect, useState, useRef } from 'react';
import mqtt from 'mqtt';

const WIN_CONDITIONS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

export default function Game() {
  const [client, setClient] = useState(null);
  const [clientId, setClientId] = useState('');
  
  // UI States
  const [nickname, setNickname] = useState('');
  const [overlayState, setOverlayState] = useState('nickname'); // nickname, waiting, disconnect, none
  
  // Game States
  const [board, setBoard] = useState(Array(9).fill(""));
  const [currentPlayer, setCurrentPlayer] = useState("X");
  const [myRole, setMyRole] = useState(null); // 'X' or 'O'
  const [gameActive, setGameActive] = useState(false);
  const [players, setPlayers] = useState({ X: 'Player X', O: 'Player O' });
  const [winningLine, setWinningLine] = useState(null);
  const [gameOverText, setGameOverText] = useState({ title: '', desc: '', className: '' });
  
  const [roomId, setRoomId] = useState(null);

  const boardRef = useRef(null);
  const cellRefs = useRef([]);

  // Connect to MQTT Broker on load
  useEffect(() => {
    const id = 'xo_player_' + Math.random().toString(16).substring(2, 10);
    setClientId(id);

    // Free public MQTT broker over WebSockets
    const mqttClient = mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
      clientId: id,
      clean: true,
      connectTimeout: 4000,
      reconnectPeriod: 1000,
    });

    mqttClient.on('connect', () => {
      console.log('Connected to MQTT');
      mqttClient.subscribe('xo-lobby-global-v1');
    });

    setClient(mqttClient);

    return () => {
      mqttClient.end();
    };
  }, []);

  // Handle incoming messages
  useEffect(() => {
    if (!client) return;

    const handleMessage = (topic, message) => {
      const data = JSON.parse(message.toString());
      
      if (topic === 'xo-lobby-global-v1') {
        // I am waiting for a match, someone else wants to play
        if (data.type === 'FIND_MATCH' && data.id !== clientId && overlayState === 'waiting') {
          // I will be the Host
          const newRoomId = 'xo_room_' + Math.random().toString(16).substring(2, 10);
          client.subscribe(newRoomId);
          client.publish('xo-lobby-global-v1', JSON.stringify({
            type: 'MATCH_FOUND',
            hostId: clientId,
            guestId: data.id,
            roomId: newRoomId,
            hostNickname: nickname
          }));
        }
        
        // Someone found a match for me (I am the Guest)
        if (data.type === 'MATCH_FOUND' && data.guestId === clientId && overlayState === 'waiting') {
          client.subscribe(data.roomId);
          setRoomId(data.roomId);
          setMyRole('O');
          setPlayers({ X: data.hostNickname, O: nickname });
          setOverlayState('none');
          setGameActive(true);
          resetBoardState();
          
          client.publish(data.roomId, JSON.stringify({
            type: 'GAME_START',
            guestNickname: nickname
          }));
        }
      }

      // Room-specific messages
      if (topic === roomId) {
        if (data.type === 'GAME_START' && myRole === 'X') {
          setPlayers(prev => ({ ...prev, O: data.guestNickname }));
          setOverlayState('none');
          setGameActive(true);
          resetBoardState();
        }

        if (data.type === 'MOVE' && data.player !== myRole) {
          handleMove(data.index, data.player, false);
        }

        if (data.type === 'LEAVE' && data.player !== myRole) {
          handleOpponentDisconnect();
        }
      }
    };

    client.on('message', handleMessage);
    return () => client.removeListener('message', handleMessage);
  }, [client, clientId, overlayState, nickname, roomId, myRole]);

  const handleOpponentDisconnect = () => {
    setGameActive(false);
    setGameOverText({
      title: "Opponent Disconnected",
      desc: "The other player has left the game.",
      className: "mb-4 fw-bold text-danger"
    });
    setOverlayState('disconnect');
    resetBoardState();
    if (client && roomId) {
      client.unsubscribe(roomId);
      setRoomId(null);
    }
  };

  const resetBoardState = () => {
    setBoard(Array(9).fill(""));
    setWinningLine(null);
    setCurrentPlayer("X");
  };

  const handleMove = (index, player, isLocal) => {
    setBoard(prev => {
      const newBoard = [...prev];
      if (newBoard[index] === "") {
        newBoard[index] = player;
        checkWinner(newBoard, player, isLocal);
      }
      return newBoard;
    });
  };

  const checkWinner = (currentBoard, lastPlayerMoved, isLocal) => {
    let roundWon = false;
    let winCond = null;

    for (let i = 0; i < WIN_CONDITIONS.length; i++) {
      const [a, b, c] = WIN_CONDITIONS[i];
      if (currentBoard[a] && currentBoard[a] === currentBoard[b] && currentBoard[a] === currentBoard[c]) {
        roundWon = true;
        winCond = WIN_CONDITIONS[i];
        break;
      }
    }

    if (roundWon) {
      setGameActive(false);
      calculateWinningLine(winCond);
      
      setTimeout(() => {
        setGameOverText({
          title: "Game Over",
          desc: lastPlayerMoved === myRole ? "Victory!" : "Defeat!",
          className: "mb-4 fw-bold"
        });
        setOverlayState('disconnect');
        resetBoardState();
      }, 3000);
    } else if (!currentBoard.includes("")) {
      setGameActive(false);
      setTimeout(() => {
        setGameOverText({
          title: "Game Over",
          desc: "It was a tie!",
          className: "mb-4 fw-bold"
        });
        setOverlayState('disconnect');
        resetBoardState();
      }, 3000);
    } else {
      setCurrentPlayer(prev => prev === "X" ? "O" : "X");
    }
  };

  const calculateWinningLine = (condition) => {
    if (!boardRef.current || !cellRefs.current[condition[0]] || !cellRefs.current[condition[2]]) return;
    const startCell = cellRefs.current[condition[0]];
    const endCell = cellRefs.current[condition[2]];
    const boardRect = boardRef.current.getBoundingClientRect();
    const startRect = startCell.getBoundingClientRect();
    const endRect = endCell.getBoundingClientRect();

    const startX = startRect.left + startRect.width / 2 - boardRect.left;
    const startY = startRect.top + startRect.height / 2 - boardRect.top;
    const endX = endRect.left + endRect.width / 2 - boardRect.left;
    const endY = endRect.top + endRect.height / 2 - boardRect.top;

    const length = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
    const angle = Math.atan2(endY - startY, endX - startX) * 180 / Math.PI;

    setWinningLine({ condition, length, angle, startX, startY });
  };

  const onCellClick = (index) => {
    if (!gameActive || currentPlayer !== myRole || board[index] !== "") return;
    handleMove(index, myRole, true);
    if (client && roomId) {
      client.publish(roomId, JSON.stringify({ type: 'MOVE', index, player: myRole }));
    }
  };

  const joinGame = () => {
    if (nickname.trim().length > 0 && client) {
      setOverlayState('waiting');
      setMyRole('X'); // Default to X (Host), will become O if acting as Guest
      
      // Publish intent to lobby
      client.publish('xo-lobby-global-v1', JSON.stringify({
        type: 'FIND_MATCH',
        id: clientId,
        nickname: nickname.trim()
      }));
    }
  };

  const rejoinGame = () => {
    if (client && roomId) {
      client.publish(roomId, JSON.stringify({ type: 'LEAVE', player: myRole }));
      client.unsubscribe(roomId);
      setRoomId(null);
    }

    if (nickname.trim().length > 0) {
      joinGame();
    } else {
      setOverlayState('nickname');
    }
  };

  return (
    <>
      {/* Overlay: Nickname Entry */}
      {overlayState === 'nickname' && (
        <div className="overlay d-flex flex-column justify-content-center align-items-center">
          <div className="overlay-card text-center p-5 rounded-4 shadow-lg">
            <h2 className="mb-4 fw-bold">Enter Your Nickname</h2>
            <input 
              type="text" 
              value={nickname} 
              onChange={e => setNickname(e.target.value)} 
              className="form-control form-control-lg mb-3 text-center" 
              placeholder="Player Name" 
              maxLength="15" 
            />
            <button onClick={joinGame} className="btn btn-primary btn-lg rounded-pill px-5 fw-bold w-100">
              {!client ? 'Connecting...' : 'Find Match'}
            </button>
          </div>
        </div>
      )}

      {/* Overlay: Waiting for Opponent */}
      {overlayState === 'waiting' && (
        <div className="overlay d-flex flex-column justify-content-center align-items-center">
          <div className="overlay-card text-center p-5 rounded-4 shadow-lg">
            <h2 className="mb-4 fw-bold">Waiting for opponent...</h2>
            <div className="spinner-border text-primary" style={{ width: '3rem', height: '3rem' }} role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            <p className="mt-4 text-muted">We are matching you with another player.</p>
          </div>
        </div>
      )}

      {/* Overlay: Game Over / Disconnected */}
      {overlayState === 'disconnect' && (
        <div className="overlay d-flex flex-column justify-content-center align-items-center">
          <div className="overlay-card text-center p-5 rounded-4 shadow-lg">
            <h2 className={gameOverText.className}>{gameOverText.title}</h2>
            <p className="mt-2 text-muted">{gameOverText.desc}</p>
            <button onClick={rejoinGame} className="btn btn-danger btn-lg rounded-pill px-5 fw-bold mt-3">Find New Match</button>
          </div>
        </div>
      )}

      <div className="container min-vh-100 d-flex flex-column justify-content-center align-items-center">
        {/* Header Section */}
        <div className="text-center mb-4 header-section">
          <h1 className="display-3 fw-bold game-title">
            <span className="x-text">X</span><span className="o-text">O</span> Multiplayer
          </h1>
        </div>

        {/* Scoreboard */}
        <div className="scoreboard d-flex justify-content-between align-items-center mb-4 px-4 py-2 rounded-pill shadow-sm w-100" style={{ maxWidth: '500px' }}>
          <div className="score-item text-center">
            <span className="score-label x-text fs-5">{players.X} {myRole === 'X' ? '(You)' : ''}</span>
          </div>
          <div className="score-item text-center mx-4">
            <span className="score-label text-white fw-bold fs-4">VS</span>
          </div>
          <div className="score-item text-center">
            <span className="score-label o-text fs-5">{players.O} {myRole === 'O' ? '(You)' : ''}</span>
          </div>
        </div>

        {/* Game Board */}
        <div className="board-container">
          <div id="board" className="board" ref={boardRef}>
            {board.map((cell, index) => {
              const isWinCell = winningLine?.condition.includes(index);
              return (
                <div 
                  key={index}
                  ref={el => cellRefs.current[index] = el}
                  className={`cell ${cell !== "" ? 'taken ' + cell.toLowerCase() : ''} ${isWinCell ? 'win-anim' : ''}`}
                  onClick={() => onCellClick(index)}
                >
                  {cell}
                </div>
              );
            })}
            
            {/* Winning Line */}
            {winningLine && (
              <div 
                className="winning-line active"
                style={{
                  width: `${winningLine.length}px`,
                  height: '6px',
                  top: `${winningLine.startY - 3}px`,
                  left: `${winningLine.startX}px`,
                  transform: `rotate(${winningLine.angle}deg)`,
                  backgroundColor: currentPlayer === "X" ? "var(--x-color)" : "var(--o-color)",
                  boxShadow: currentPlayer === "X" ? "var(--x-shadow)" : "var(--o-shadow)"
                }}
              />
            )}
          </div>
        </div>

        {/* Turn Indicator */}
        <div className="turn-indicator mt-4 mb-3">
          <h4 className="fw-semibold">
            {!gameActive ? 'Waiting to start...' : 
              currentPlayer === myRole ? 
                `Your Turn (${myRole})` : 
                `Opponent's Turn...`
            }
          </h4>
        </div>
      </div>
    </>
  );
}
