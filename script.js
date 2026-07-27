const cells = document.querySelectorAll('.cell');
const statusText = document.querySelector('#turn-text');
const restartBtn = document.querySelector('#btn-restart');
const winningLine = document.querySelector('#winning-line');
const pvpBtn = document.querySelector('#btn-pvp');
const pvaBtn = document.querySelector('#btn-pva');

const scoreXElement = document.getElementById('score-x');
const scoreOElement = document.getElementById('score-o');
const scoreTieElement = document.getElementById('score-tie');

const winConditions = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
    [0, 4, 8], [2, 4, 6]             // Diagonals
];

let options = ["", "", "", "", "", "", "", "", ""];
let currentPlayer = "X";
let running = false;
let isBotMode = false;
let scores = { X: 0, O: 0, Tie: 0 };
let botThinking = false;

initializeGame();

function initializeGame() {
    cells.forEach(cell => cell.addEventListener('click', cellClicked));
    restartBtn.addEventListener('click', restartGame);
    
    pvpBtn.addEventListener('click', () => setMode(false));
    pvaBtn.addEventListener('click', () => setMode(true));

    running = true;
    updateStatusText();
}

function setMode(botMode) {
    if (botMode === isBotMode) return;
    
    isBotMode = botMode;
    if (isBotMode) {
        pvaBtn.classList.add('active');
        pvpBtn.classList.remove('active');
    } else {
        pvpBtn.classList.add('active');
        pvaBtn.classList.remove('active');
    }
    
    scores = { X: 0, O: 0, Tie: 0 };
    updateScoreBoard();
    restartGame();
}

function cellClicked(e) {
    if (botThinking || !running) return;

    const cell = e.target;
    const cellIndex = cell.getAttribute('data-index');

    if (options[cellIndex] != "" || !running) return;

    updateCell(cell, cellIndex);
    checkWinner();

    if (running && isBotMode && currentPlayer === "O") {
        botThinking = true;
        setTimeout(botMove, 500); // Slight delay for realism
    }
}

function updateCell(cell, index) {
    options[index] = currentPlayer;
    cell.textContent = currentPlayer;
    cell.classList.add('taken', currentPlayer.toLowerCase());
}

function changePlayer() {
    currentPlayer = (currentPlayer === "X") ? "O" : "X";
    updateStatusText();
}

function updateStatusText() {
    if (currentPlayer === "X") {
        statusText.innerHTML = `Player <span class="x-text">X</span>'s Turn`;
    } else {
        statusText.innerHTML = `Player <span class="o-text">O</span>'s Turn`;
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

        if (cellA == "" || cellB == "" || cellC == "") {
            continue;
        }
        if (cellA == cellB && cellB == cellC) {
            roundWon = true;
            winningCondition = condition;
            break;
        }
    }

    if (roundWon) {
        let winnerText = currentPlayer === "X" ? `<span class="x-text">X</span> Wins!` : `<span class="o-text">O</span> Wins!`;
        statusText.innerHTML = winnerText;
        running = false;
        scores[currentPlayer]++;
        updateScoreBoard();
        drawWinningLine(winningCondition);
        highlightCells(winningCondition);
    } else if (!options.includes("")) {
        statusText.innerHTML = `It's a <span class="text-white">Draw!</span>`;
        running = false;
        scores.Tie++;
        updateScoreBoard();
    } else {
        changePlayer();
    }
}

function drawWinningLine(condition) {
    const startCell = cells[condition[0]];
    const endCell = cells[condition[2]];
    
    // Get positions relative to the board
    const boardRect = document.getElementById('board').getBoundingClientRect();
    const startRect = startCell.getBoundingClientRect();
    const endRect = endCell.getBoundingClientRect();

    const startX = startRect.left + startRect.width / 2 - boardRect.left;
    const startY = startRect.top + startRect.height / 2 - boardRect.top;
    const endX = endRect.left + endRect.width / 2 - boardRect.left;
    const endY = endRect.top + endRect.height / 2 - boardRect.top;

    const length = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
    const angle = Math.atan2(endY - startY, endX - startX) * 180 / Math.PI;

    // We add a little padding so the line doesn't start exactly at the center
    const thickness = 6;
    
    winningLine.style.width = '0px'; // Start at 0 for animation
    winningLine.style.height = `${thickness}px`;
    winningLine.style.top = `${startY - thickness / 2}px`;
    winningLine.style.left = `${startX}px`;
    winningLine.style.transform = `rotate(${angle}deg)`;
    winningLine.style.backgroundColor = currentPlayer === "X" ? "var(--x-color)" : "var(--o-color)";
    winningLine.style.boxShadow = currentPlayer === "X" ? "var(--x-shadow)" : "var(--o-shadow)";
    
    winningLine.classList.add('active');
    
    // Animate
    setTimeout(() => {
        winningLine.style.width = `${length}px`;
    }, 50);
}

function highlightCells(condition) {
    condition.forEach(index => {
        cells[index].classList.add('win-anim');
    });
}

function updateScoreBoard() {
    scoreXElement.textContent = scores.X;
    scoreOElement.textContent = scores.O;
    scoreTieElement.textContent = scores.Tie;
}

function restartGame() {
    currentPlayer = "X";
    options = ["", "", "", "", "", "", "", "", ""];
    updateStatusText();
    
    winningLine.classList.remove('active');
    winningLine.style.width = '0px';

    cells.forEach(cell => {
        cell.textContent = "";
        cell.classList.remove('taken', 'x', 'o', 'win-anim');
    });
    
    running = true;
    botThinking = false;
}


/* ===========================
   BOT LOGIC (Minimax)
=========================== */

function botMove() {
    if (!running) return;

    let bestScore = -Infinity;
    let move = -1;

    for (let i = 0; i < options.length; i++) {
        if (options[i] === "") {
            options[i] = "O";
            let score = minimax(options, 0, false);
            options[i] = "";
            
            // To add a little bit of randomness to prevent identical boring games all the time
            // We can occasionally pick a sub-optimal move or just randomize if multiple best scores.
            // But Minimax guarantees no-loss. We'll stick to strict Minimax for unbeatable.
            if (score > bestScore) {
                bestScore = score;
                move = i;
            } else if (score === bestScore && Math.random() < 0.5) {
                // Randomize between equal best moves
                move = i;
            }
        }
    }

    if (move !== -1) {
        const cell = cells[move];
        updateCell(cell, move);
        checkWinner();
    }
    botThinking = false;
}

let minimaxScores = {
    X: -10,
    O: 10,
    Tie: 0
};

function minimax(board, depth, isMaximizing) {
    let result = checkWinCondition(board);
    if (result !== null) {
        return minimaxScores[result];
    }

    if (isMaximizing) {
        let bestScore = -Infinity;
        for (let i = 0; i < board.length; i++) {
            if (board[i] === "") {
                board[i] = "O";
                let score = minimax(board, depth + 1, false);
                board[i] = "";
                bestScore = Math.max(score, bestScore);
            }
        }
        return bestScore;
    } else {
        let bestScore = Infinity;
        for (let i = 0; i < board.length; i++) {
            if (board[i] === "") {
                board[i] = "X";
                let score = minimax(board, depth + 1, true);
                board[i] = "";
                bestScore = Math.min(score, bestScore);
            }
        }
        return bestScore;
    }
}

function checkWinCondition(board) {
    for (let i = 0; i < winConditions.length; i++) {
        const [a, b, c] = winConditions[i];
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a]; // 'X' or 'O'
        }
    }
    if (!board.includes("")) {
        return "Tie";
    }
    return null;
}
