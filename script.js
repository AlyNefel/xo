const socket = io();

// UI Elements
const nicknameOverlay = document.getElementById('nickname-overlay');
const nicknameInput = document.getElementById('nickname-input');
const btnJoin = document.getElementById('btn-join');

const waitingOverlay = document.getElementById('waiting-overlay');
const disconnectOverlay = document.getElementById('disconnect-overlay');
const btnRejoin = document.getElementById('btn-rejoin');

const cells = document.querySelectorAll('.cell');
const statusText = document.querySelector('#turn-text');
const winningLine = document.querySelector('#winning-line');

const nameX = document.getElementById('name-x');
const nameO = document.getElementById('name-o');

// Game State
const winConditions = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
    [0, 4, 8], [2, 4, 6]             // Diagonals
];

let options = ["", "", "", "", "", "", "", "", ""];
let currentPlayer = "X";
let myRole = null; // 'X' or 'O'
let isMyTurn = false;
let gameActive = false;

// Initialization
btnJoin.addEventListener('click', joinGame);
btnRejoin.addEventListener('click', () => {
    disconnectOverlay.classList.remove('active');
    const nickname = nicknameInput.value.trim();
    if (nickname.length > 0) {
        socket.emit('join_game', nickname);
    } else {
        nicknameOverlay.classList.add('active');
    }
});

cells.forEach(cell => cell.addEventListener('click', cellClicked));

function joinGame() {
    const nickname = nicknameInput.value.trim();
    if (nickname.length > 0) {
        nicknameOverlay.classList.remove('active');
        socket.emit('join_game', nickname);
    }
}

// Socket Events
socket.on('waiting_for_opponent', () => {
    waitingOverlay.classList.add('active');
});

socket.on('role_assigned', (role) => {
    myRole = role;
});

socket.on('game_start', (data) => {
    waitingOverlay.classList.remove('active');
    
    nameX.textContent = `${data.playerX} (X)`;
    nameO.textContent = `${data.playerO} (O)`;
    
    currentPlayer = data.startingTurn;
    isMyTurn = (myRole === currentPlayer);
    gameActive = true;
    
    updateStatusText();
});

socket.on('opponent_moved', (data) => {
    // data: { index, player }
    const cell = cells[data.index];
    updateCell(cell, data.index, data.player);
    checkWinner();
});

socket.on('opponent_disconnected', () => {
    gameActive = false;
    disconnectOverlay.querySelector('h2').textContent = "Opponent Disconnected";
    disconnectOverlay.querySelector('h2').className = "mb-4 fw-bold text-danger";
    disconnectOverlay.querySelector('p').textContent = "The other player has left the game.";
    disconnectOverlay.classList.add('active');
    resetBoard();
});

// Game Logic
function cellClicked(e) {
    if (!gameActive || !isMyTurn) return;

    const cell = e.target;
    const cellIndex = cell.getAttribute('data-index');

    if (options[cellIndex] !== "") return;

    // Make move
    updateCell(cell, cellIndex, myRole);
    socket.emit('make_move', { index: cellIndex, player: myRole });
    checkWinner();
}

function updateCell(cell, index, player) {
    options[index] = player;
    cell.textContent = player;
    cell.classList.add('taken', player.toLowerCase());
}

function changePlayer() {
    currentPlayer = (currentPlayer === "X") ? "O" : "X";
    isMyTurn = (myRole === currentPlayer);
    updateStatusText();
}

function updateStatusText() {
    if (isMyTurn) {
        statusText.innerHTML = `Your Turn (<span class="${myRole.toLowerCase()}-text">${myRole}</span>)`;
    } else {
        statusText.innerHTML = `Opponent's Turn...`;
    }
}

function checkWinner() {
    let roundWon = false;
    let winningCondition = null;

    for (let i = 0; i < winConditions.length; i++) {
        const condition = winConditions[i];
        const cellA = options[condition[0]];
        const cellB = options[condition[1]];
        const cellC = options[condition[2]];

        if (cellA === "" || cellB === "" || cellC === "") {
            continue;
        }
        if (cellA === cellB && cellB === cellC) {
            roundWon = true;
            winningCondition = condition;
            break;
        }
    }

    if (roundWon) {
        let winnerText = (currentPlayer === myRole) ? `You Win! 🎉` : `You Lose! 😢`;
        statusText.innerHTML = winnerText;
        gameActive = false;
        drawWinningLine(winningCondition);
        highlightCells(winningCondition);
        
        // Show rejoin option after 3 seconds
        setTimeout(() => {
            disconnectOverlay.querySelector('h2').textContent = "Game Over";
            disconnectOverlay.querySelector('h2').className = "mb-4 fw-bold";
            disconnectOverlay.querySelector('p').textContent = (currentPlayer === myRole) ? "Victory!" : "Defeat!";
            disconnectOverlay.classList.add('active');
            resetBoard();
        }, 3000);

    } else if (!options.includes("")) {
        statusText.innerHTML = `It's a <span class="text-white">Draw!</span>`;
        gameActive = false;
        
        setTimeout(() => {
            disconnectOverlay.querySelector('h2').textContent = "Game Over";
            disconnectOverlay.querySelector('h2').className = "mb-4 fw-bold";
            disconnectOverlay.querySelector('p').textContent = "It was a tie!";
            disconnectOverlay.classList.add('active');
            resetBoard();
        }, 3000);
    } else {
        changePlayer();
    }
}

function drawWinningLine(condition) {
    const startCell = cells[condition[0]];
    const endCell = cells[condition[2]];
    
    const boardRect = document.getElementById('board').getBoundingClientRect();
    const startRect = startCell.getBoundingClientRect();
    const endRect = endCell.getBoundingClientRect();

    const startX = startRect.left + startRect.width / 2 - boardRect.left;
    const startY = startRect.top + startRect.height / 2 - boardRect.top;
    const endX = endRect.left + endRect.width / 2 - boardRect.left;
    const endY = endRect.top + endRect.height / 2 - boardRect.top;

    const length = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
    const angle = Math.atan2(endY - startY, endX - startX) * 180 / Math.PI;

    const thickness = 6;
    
    winningLine.style.width = '0px';
    winningLine.style.height = `${thickness}px`;
    winningLine.style.top = `${startY - thickness / 2}px`;
    winningLine.style.left = `${startX}px`;
    winningLine.style.transform = `rotate(${angle}deg)`;
    winningLine.style.backgroundColor = currentPlayer === "X" ? "var(--x-color)" : "var(--o-color)";
    winningLine.style.boxShadow = currentPlayer === "X" ? "var(--x-shadow)" : "var(--o-shadow)";
    
    winningLine.classList.add('active');
    
    setTimeout(() => {
        winningLine.style.width = `${length}px`;
    }, 50);
}

function highlightCells(condition) {
    condition.forEach(index => {
        cells[index].classList.add('win-anim');
    });
}

function resetBoard() {
    options = ["", "", "", "", "", "", "", "", ""];
    cells.forEach(cell => {
        cell.textContent = "";
        cell.classList.remove('taken', 'x', 'o', 'win-anim');
    });
    winningLine.classList.remove('active');
    winningLine.style.width = '0px';
}
