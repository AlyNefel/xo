"use client";
import { useEffect, useState, useRef } from 'react';
import mqtt from 'mqtt';

const WIN_CONDITIONS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

const LOBBY_TOPIC = 'xo-game-lobby-v4';
const BROKER_URL  = 'wss://broker.emqx.io:8084/mqtt';

export default function Game() {
  // ─── Refs (never cause stale closures in message handler) ───
  const clientRef      = useRef(null);
  const clientIdRef    = useRef('');
  const nicknameRef    = useRef('');
  const overlayRef     = useRef('nickname');  // mirrors overlayState
  const myRoleRef      = useRef(null);
  const roomIdRef      = useRef(null);
  const boardRef       = useRef(Array(9).fill(''));
  const currentTurnRef = useRef('X');
  const gameActiveRef  = useRef(false);
  const intervalRef    = useRef(null);
  const boardDomRef    = useRef(null);
  const cellRefs       = useRef([]);
  const matchedRef     = useRef(false);  // guards against double-pairing

  // ─── React state (drives re-renders) ───
  const [overlayState,  setOverlayState]  = useState('nickname');
  const [nicknameInput, setNicknameInput] = useState('');
  const [myRole,        setMyRole]        = useState(null);
  const [players,       setPlayers]       = useState({ X: 'Player X', O: 'Player O' });
  const [boardView,     setBoardView]     = useState(Array(9).fill(''));
  const [currentPlayer, setCurrentPlayer] = useState('X');
  const [winningLine,   setWinningLine]   = useState(null);
  const [gameOverText,  setGameOverText]  = useState({ title: '', desc: '', className: '' });
  const [connected,     setConnected]     = useState(false);

  // ─── Connect MQTT once on mount ───
  useEffect(() => {
    const id = 'xo_' + Math.random().toString(16).substring(2, 12);
    clientIdRef.current = id;

    const mc = mqtt.connect(BROKER_URL, {
      clientId: id,
      clean: true,
      connectTimeout: 8000,
      reconnectPeriod: 2000,
    });

    mc.on('connect', () => {
      console.log('[MQTT] connected as', id);
      mc.subscribe(LOBBY_TOPIC);
      setConnected(true);
      // Re-subscribe to room on reconnect
      if (roomIdRef.current) mc.subscribe(roomIdRef.current);
    });

    mc.on('offline', () => setConnected(false));
    mc.on('close',   () => setConnected(false));

    mc.on('message', onMessage);

    clientRef.current = mc;
    return () => { stopLooking(); mc.end(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ═══════════════════════════════════════════════
  //  MATCHMAKING HELPERS
  // ═══════════════════════════════════════════════

  function startLooking() {
    matchedRef.current = false;
    broadcastFindMatch();
    intervalRef.current = setInterval(broadcastFindMatch, 2500);
  }

  function stopLooking() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  function broadcastFindMatch() {
    if (!clientRef.current || matchedRef.current) return;
    clientRef.current.publish(LOBBY_TOPIC, JSON.stringify({
      type: 'FIND_MATCH',
      id:   clientIdRef.current,
      nick: nicknameRef.current,
    }));
  }

  // Shared helper to start the game for either player
  function startGame(role, roomId, playerX, playerO) {
    myRoleRef.current    = role;
    roomIdRef.current    = roomId;
    gameActiveRef.current = true;
    overlayRef.current   = 'none';

    setMyRole(role);
    setPlayers({ X: playerX, O: playerO });
    setOverlayState('none');
    resetBoardState();
  }

  // ═══════════════════════════════════════════════
  //  MQTT MESSAGE HANDLER  (stable – registered once)
  // ═══════════════════════════════════════════════

  function onMessage(topic, rawMsg) {
    let data;
    try { data = JSON.parse(rawMsg.toString()); } catch { return; }

    // ── LOBBY messages ──────────────────────────────────────────
    if (topic === LOBBY_TOPIC) {

      // Someone is looking for a match
      if (
        data.type === 'FIND_MATCH' &&
        data.id   !== clientIdRef.current &&
        overlayRef.current === 'waiting' &&
        !matchedRef.current
      ) {
        // Deterministic: alphabetically higher clientId becomes Host (X)
        const iAmHost = clientIdRef.current > data.id;
        if (!iAmHost) return; // Guest waits for MATCH_FOUND

        // ── I AM THE HOST – start MY game immediately ──────────
        matchedRef.current = true;
        stopLooking();

        const newRoomId = 'xo_room_' + Math.random().toString(16).substring(2, 10);
        clientRef.current.subscribe(newRoomId);

        // Start host's own game right now (don't rely on MQTT echo)
        startGame('X', newRoomId, nicknameRef.current, data.nick);

        // Notify guest via lobby
        clientRef.current.publish(LOBBY_TOPIC, JSON.stringify({
          type:      'MATCH_FOUND',
          hostId:    clientIdRef.current,
          guestId:   data.id,
          roomId:    newRoomId,
          hostNick:  nicknameRef.current,
          guestNick: data.nick,
        }));
      }

      // MATCH_FOUND – only the designated guest processes this
      if (
        data.type     === 'MATCH_FOUND' &&
        data.guestId  === clientIdRef.current &&
        overlayRef.current === 'waiting' &&
        !matchedRef.current
      ) {
        matchedRef.current = true;
        stopLooking();

        clientRef.current.subscribe(data.roomId);
        // Start guest's game
        startGame('O', data.roomId, data.hostNick, data.guestNick);
      }
    }

    // ── ROOM messages ───────────────────────────────────────────
    if (roomIdRef.current && topic === roomIdRef.current) {
      if (data.type === 'MOVE' && data.player !== myRoleRef.current && gameActiveRef.current) {
        applyMove(data.index, data.player);
      }

      if (data.type === 'LEAVE') {
        gameActiveRef.current = false;
        setGameOverText({
          title:     'Opponent Disconnected',
          desc:      'The other player has left the game.',
          className: 'mb-4 fw-bold text-danger',
        });
        overlayRef.current = 'disconnect';
        setOverlayState('disconnect');
        resetBoardState();
      }
    }
  }

  // ═══════════════════════════════════════════════
  //  BOARD LOGIC
  // ═══════════════════════════════════════════════

  function resetBoardState() {
    boardRef.current       = Array(9).fill('');
    currentTurnRef.current = 'X';
    setBoardView(Array(9).fill(''));
    setCurrentPlayer('X');
    setWinningLine(null);
  }

  function applyMove(index, player) {
    const newBoard = [...boardRef.current];
    if (newBoard[index] !== '') return;
    newBoard[index] = player;
    boardRef.current = newBoard;
    setBoardView([...newBoard]);
    checkWinner(newBoard, player);
  }

  function checkWinner(board, lastPlayer) {
    for (const [a, b, c] of WIN_CONDITIONS) {
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        gameActiveRef.current = false;
        calcWinningLine([a, b, c], lastPlayer);
        setTimeout(() => {
          setGameOverText({
            title:     'Game Over',
            desc:      lastPlayer === myRoleRef.current ? 'Victory! 🎉' : 'Defeat! 😢',
            className: 'mb-4 fw-bold',
          });
          overlayRef.current = 'disconnect';
          setOverlayState('disconnect');
          resetBoardState();
        }, 3000);
        return;
      }
    }
    if (!board.includes('')) {
      gameActiveRef.current = false;
      setTimeout(() => {
        setGameOverText({ title: 'Game Over', desc: "It's a tie!", className: 'mb-4 fw-bold' });
        overlayRef.current = 'disconnect';
        setOverlayState('disconnect');
        resetBoardState();
      }, 3000);
      return;
    }
    const next = lastPlayer === 'X' ? 'O' : 'X';
    currentTurnRef.current = next;
    setCurrentPlayer(next);
  }

  function calcWinningLine(condition, winnerPlayer) {
    if (!boardDomRef.current) return;
    const s = cellRefs.current[condition[0]];
    const e = cellRefs.current[condition[2]];
    if (!s || !e) return;
    const br = boardDomRef.current.getBoundingClientRect();
    const sr = s.getBoundingClientRect();
    const er = e.getBoundingClientRect();
    const sx = sr.left + sr.width  / 2 - br.left;
    const sy = sr.top  + sr.height / 2 - br.top;
    const ex = er.left + er.width  / 2 - br.left;
    const ey = er.top  + er.height / 2 - br.top;
    setWinningLine({
      condition,
      length: Math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2),
      angle:  Math.atan2(ey - sy, ex - sx) * 180 / Math.PI,
      sx, sy,
      player: winnerPlayer,
    });
  }

  // ═══════════════════════════════════════════════
  //  USER ACTIONS
  // ═══════════════════════════════════════════════

  function onCellClick(index) {
    if (!gameActiveRef.current) return;
    if (currentTurnRef.current !== myRoleRef.current) return;
    if (boardRef.current[index] !== '') return;

    applyMove(index, myRoleRef.current);
    clientRef.current.publish(roomIdRef.current, JSON.stringify({
      type: 'MOVE', index, player: myRoleRef.current,
    }));
  }

  function joinGame() {
    const nick = nicknameInput.trim();
    if (!nick || !connected) return;
    nicknameRef.current = nick;
    overlayRef.current  = 'waiting';
    setOverlayState('waiting');
    startLooking();
  }

  function rejoinGame() {
    if (clientRef.current && roomIdRef.current) {
      clientRef.current.publish(roomIdRef.current, JSON.stringify({
        type: 'LEAVE', player: myRoleRef.current,
      }));
      clientRef.current.unsubscribe(roomIdRef.current);
    }
    roomIdRef.current    = null;
    myRoleRef.current    = null;
    gameActiveRef.current = false;
    setMyRole(null);
    overlayRef.current   = 'waiting';
    setOverlayState('waiting');
    startLooking();
  }

  // ═══════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════

  const isMyTurn = overlayState === 'none' && currentPlayer === myRole;

  return (
    <>
      {/* ── Nickname Overlay ── */}
      {overlayState === 'nickname' && (
        <div className="overlay d-flex flex-column justify-content-center align-items-center">
          <div className="overlay-card text-center p-5 rounded-4 shadow-lg">
            <h2 className="mb-2 fw-bold">
              <span className="x-text">X</span><span className="o-text">O</span> Multiplayer
            </h2>
            <p className="text-muted mb-4">Enter your nickname to find a match</p>
            <input
              type="text"
              value={nicknameInput}
              onChange={e => setNicknameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && joinGame()}
              className="form-control form-control-lg mb-3 text-center"
              placeholder="Your nickname"
              maxLength="15"
              id="nickname-input"
            />
            <button
              id="btn-find-match"
              onClick={joinGame}
              disabled={!connected}
              className="btn btn-primary btn-lg rounded-pill px-5 fw-bold w-100"
            >
              {connected ? 'Find Match 🎮' : 'Connecting…'}
            </button>
          </div>
        </div>
      )}

      {/* ── Waiting Overlay ── */}
      {overlayState === 'waiting' && (
        <div className="overlay d-flex flex-column justify-content-center align-items-center">
          <div className="overlay-card text-center p-5 rounded-4 shadow-lg">
            <h2 className="mb-4 fw-bold">Waiting for opponent…</h2>
            <div
              className="spinner-border text-primary"
              style={{ width: '3rem', height: '3rem' }}
              role="status"
            >
              <span className="visually-hidden">Loading…</span>
            </div>
            <p className="mt-4 text-muted">
              Playing as <strong className="x-text">{nicknameInput}</strong>. Finding an opponent…
            </p>
          </div>
        </div>
      )}

      {/* ── Game Over / Disconnect Overlay ── */}
      {overlayState === 'disconnect' && (
        <div className="overlay d-flex flex-column justify-content-center align-items-center">
          <div className="overlay-card text-center p-5 rounded-4 shadow-lg">
            <h2 className={gameOverText.className}>{gameOverText.title}</h2>
            <p className="mt-2 text-muted">{gameOverText.desc}</p>
            <button
              id="btn-rejoin"
              onClick={rejoinGame}
              className="btn btn-danger btn-lg rounded-pill px-5 fw-bold mt-3"
            >
              Find New Match
            </button>
          </div>
        </div>
      )}

      {/* ── Main Game ── */}
      <div className="container min-vh-100 d-flex flex-column justify-content-center align-items-center">
        <div className="text-center mb-4">
          <h1 className="display-3 fw-bold">
            <span className="x-text">X</span><span className="o-text">O</span> Multiplayer
          </h1>
        </div>

        {/* Scoreboard */}
        <div
          className="scoreboard d-flex justify-content-between align-items-center mb-4 px-4 py-2 rounded-pill w-100"
          style={{ maxWidth: '500px' }}
        >
          <span className="x-text fs-5 fw-semibold">
            {players.X}{myRole === 'X' ? ' (You)' : ''}
          </span>
          <span className="text-white fw-bold fs-4">VS</span>
          <span className="o-text fs-5 fw-semibold">
            {players.O}{myRole === 'O' ? ' (You)' : ''}
          </span>
        </div>

        {/* Board */}
        <div className="board-container">
          <div className="board" ref={boardDomRef}>
            {boardView.map((cell, index) => {
              const isWinCell = winningLine?.condition.includes(index);
              return (
                <div
                  key={index}
                  ref={el => { cellRefs.current[index] = el; }}
                  className={[
                    'cell',
                    cell ? 'taken ' + cell.toLowerCase() : '',
                    isWinCell ? 'win-anim' : '',
                  ].join(' ')}
                  onClick={() => onCellClick(index)}
                >
                  {cell}
                </div>
              );
            })}

            {winningLine && (
              <div
                className="winning-line active"
                style={{
                  width:           `${winningLine.length}px`,
                  height:          '6px',
                  top:             `${winningLine.sy - 3}px`,
                  left:            `${winningLine.sx}px`,
                  transform:       `rotate(${winningLine.angle}deg)`,
                  backgroundColor: winningLine.player === 'X' ? 'var(--x-color)' : 'var(--o-color)',
                  boxShadow:       winningLine.player === 'X' ? 'var(--x-shadow)' : 'var(--o-shadow)',
                }}
              />
            )}
          </div>
        </div>

        {/* Turn Indicator */}
        <div className="turn-indicator mt-4 mb-3">
          <h4 className="fw-semibold">
            {overlayState !== 'none'
              ? 'Waiting to start…'
              : isMyTurn
                ? <span>Your Turn{' '}<span className={myRole === 'X' ? 'x-text' : 'o-text'}>({myRole})</span></span>
                : "Opponent's Turn…"
            }
          </h4>
        </div>
      </div>
    </>
  );
}
