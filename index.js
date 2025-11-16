
// Networking config
const API_BASE = 'http://localhost:4000';
let roomId = null;
let player = { color: null, token: null, name: null };
let ws = null;
let wsUrl = null;
// Track which colors are active (have seated players)
let activeColors = new Set(['blue','red','yellow','green']); // default single-device play

// Game state
const gameState = {
    currentPlayer: 0, // 0: Blue, 1: Red, 2: Yellow, 3: Green
    diceValue: 0,
    pieces: {
        blue: Array(4).fill().map((_, i) => ({ id: i, position: -1, isHome: true, isFinished: false })),
        red: Array(4).fill().map((_, i) => ({ id: i, position: -1, isHome: true, isFinished: false })),
        yellow: Array(4).fill().map((_, i) => ({ id: i, position: -1, isHome: true, isFinished: false })),
        green: Array(4).fill().map((_, i) => ({ id: i, position: -1, isHome: true, isFinished: false }))
    },
    selectedPiece: null,
    hasRolled: false
};

// Player colors and positions
const players = ['blue', 'red', 'yellow', 'green'];
const playerNames = ['Blue', 'Red', 'Yellow', 'Green'];
const startPositions = {
    blue: 67,
    red: 13,
    yellow: 49,
    green: 31
};

// Entry points on the ring: square just BEFORE each color's home path entry arrow in the ringPath
// When a piece lands on this square and moves forward, it should enter the home path
// These are the squares that come just before the arrow squares in clockwise ringPath order
const homeEntryRing = {
    blue: 46,   // before 52
    red: 6,     // before 6
    yellow: 42, // before 60
    green: 24   // before 29
};

// Visual ring order mapped to data-index values in this HTML (clockwise starting at 0)
const ringPath = [
    // BLUE -> RED
    0,1,2,3,4,5,6,
    12,13,14,15,16,17,
    18,19,20,21,22,23,24,
    30,31,32,33,34,35,
    36,37,38,39,40,41,42,
    48,49,50,51,52,53,
    54,55,56,57,58,59,60,
    66,67,68,69,70,71
];


// Actual home paths moving toward center (visual inward strips)
const homePaths = {
    blue: [61,62,63,64,65],
    red: [7, 8, 9, 10, 11],
    yellow: [43,44,45,46,47],
    green: [25,26,27,28,29]
};

// DOM elements
const diceElement = document.getElementById('dice');
const rollButton = document.getElementById('roll-button');
const playerTurnElement = document.getElementById('player-turn');
const gameInfoElement = document.getElementById('game-info');
const netStatusEl = document.getElementById('net-status');
const roomInputEl = document.getElementById('room-id-input');
const nameInputEl = document.getElementById('player-name');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const takeSeatBtn = document.getElementById('take-seat-btn');
const seatSelectEl = document.getElementById('seat-color');

// Initialize the game
function initGame() {
    createPieces();
    updateUI();
    
    rollButton.addEventListener('click', rollDice);

    // Networking handlers
    createRoomBtn.addEventListener('click', createRoom);
    joinRoomBtn.addEventListener('click', joinRoom);
    takeSeatBtn.addEventListener('click', takeSeat);
    updateNetStatus('Offline');
}

function getCurrentColor() {
    return players[gameState.currentPlayer];
}

// Create game pieces
function createPieces() {
    players.forEach(color => {
        const homeElement = document.getElementById(`${color}-home`);
        const insideBoxes = homeElement.querySelectorAll('.insidebox');
        
        gameState.pieces[color].forEach((piece, index) => {
            const pieceElement = document.createElement('div');
            pieceElement.className = `piece ${color}`;
            pieceElement.dataset.color = color;
            pieceElement.dataset.id = index;
            
            // Position piece in home
            const box = insideBoxes[index];
            const rect = box.getBoundingClientRect();
            const boardRect = document.querySelector('.ludo').getBoundingClientRect();
            
            pieceElement.style.left = `${rect.left - boardRect.left + 15}px`;
            pieceElement.style.top = `${rect.top - boardRect.top + 15}px`;
            
            pieceElement.addEventListener('click', () => selectPiece(color, index));
            
            document.querySelector('.ludo').appendChild(pieceElement);
        });
    });
}

// Roll the dice
function rollDice() {
    if (gameState.hasRolled) return;

    // If connected: only the current player's seated client can roll
    if (player.color && players[gameState.currentPlayer] !== player.color) return;

    gameState.diceValue = Math.floor(Math.random() * 6) + 1;
    diceElement.textContent = gameState.diceValue;
    gameState.hasRolled = true;
    
    // Check if player can move any piece
    const currentColor = players[gameState.currentPlayer];
    const canMove = gameState.pieces[currentColor].some(piece => 
        canPieceMove(currentColor, piece.id)
    );
    
    if (!canMove) {
        gameInfoElement.textContent = "No valid moves. Next player's turn.";
        setTimeout(() => { nextTurn(); }, 500);
    } else {
        gameInfoElement.textContent = "Select a piece to move";
    }
    
    updateUI();

    // Broadcast state if connected
    syncState();
}

// Check if a piece can move
function canPieceMove(color, pieceId) {
    const piece = gameState.pieces[color][pieceId];
    
    // If piece is in home
    if (piece.isHome) {
        return gameState.diceValue === 6;
    }
    
    // If piece is on the board
    const newPosition = calculateNewPosition(color, piece.position, gameState.diceValue);
    
    // Check if new position is valid (not occupied by own piece)
    // Exclude the current piece from the check (in case it's at the same position as another piece)
    if (newPosition !== -1) {
        const occupyingPiece = getPieceAtPosition(newPosition, color, pieceId);
        return !occupyingPiece || occupyingPiece.color !== color;
    }
    
    return false;
}

// Calculate new position for a piece
function calculateNewPosition(color, currentPosition, steps) {
    // If piece is in home path
    if (isInHomePath(color, currentPosition)) {
        const pathIndex = homePaths[color].indexOf(currentPosition);
        if (pathIndex === -1) {
            // Should not happen, but safety check
            return currentPosition;
        }
        const newPathIndex = pathIndex + steps;
        if (newPathIndex < homePaths[color].length) {
            return homePaths[color][newPathIndex];
        }
        // Piece would finish (reached the end of home path)
        return -1;
    }

    // Normal movement on the ring using the visual path mapping
    console.log(`[calc] color=${color} current=${currentPosition} steps=${steps}`);
    const curIdx = ringPath.indexOf(currentPosition);
    console.log(`[calc] curIdx=${curIdx} ringPath[curIdx]=${ringPath[curIdx]}`);
    if (curIdx === -1) {
        // Position not found in ringPath - this should not happen for pieces on the board
        // But if it does, try to find the start position and move from there
        const startPos = startPositions[color];
        const startIdx = ringPath.indexOf(startPos);
        if (startIdx === -1) {
            console.warn('[calc] currentPosition not found in ringPath', currentPosition);
            // Start position also not found - return current position as fallback
            return currentPosition;
        }
        // Move from start position
        const targetIdx = (startIdx + steps) % ringPath.length;
        let newPosition = ringPath[targetIdx];
        console.log(`[calc] newRingIdx=${targetIdx} -> newPosition=${newPosition}`);

        // Check if we pass through or land on the entry point
        const entryPos = homeEntryRing[color];
        const entryIdx = ringPath.indexOf(entryPos);
        if (entryIdx !== -1) {
            // Check if entry point is between startIdx and targetIdx (accounting for wrap-around)
            let passedEntry = false;
            if (startIdx < targetIdx) {
                // Normal forward movement, no wrap-around
                passedEntry = entryIdx >= startIdx && entryIdx <= targetIdx;
            } else {
                // Wrap-around case: startIdx > targetIdx
                passedEntry = entryIdx >= startIdx || entryIdx <= targetIdx;
            }
            if (passedEntry) {
                // Calculate remaining steps after entering home path
                let stepsToEntry = entryIdx >= startIdx 
                    ? entryIdx - startIdx 
                    : (ringPath.length - startIdx) + entryIdx;
                const remainingSteps = steps - stepsToEntry;
                if (remainingSteps > 0 && remainingSteps <= homePaths[color].length) {
                    // Move into home path
                    return homePaths[color][remainingSteps - 1];
                } else if (remainingSteps > homePaths[color].length) {
                    // Would finish
                    return -1;
                } else {
                    // Exactly at entry point
                    return homePaths[color][0];
                }
            }
        }
        return newPosition;
    }
    
    // Calculate new position on the ring
    const newRingIdx = (curIdx + steps) % ringPath.length;
    let newPosition = ringPath[newRingIdx];

    // Check if we pass through or land on the entry point for this color
    const entryPos = homeEntryRing[color];
    const entryIdx = ringPath.indexOf(entryPos);
    if (entryIdx !== -1) {
        // Check if entry point is between curIdx and newRingIdx (accounting for wrap-around)
        let passedEntry = false;
        if (curIdx < newRingIdx) {
            // Normal forward movement, no wrap-around
            passedEntry = entryIdx >= curIdx && entryIdx <= newRingIdx;
        } else if (curIdx > newRingIdx) {
            // Wrap-around case: curIdx > newRingIdx
            passedEntry = entryIdx >= curIdx || entryIdx <= newRingIdx;
        } else {
            // curIdx === newRingIdx (wrapped around completely)
            passedEntry = true; // We passed through everything including entry
        }
        
        if (passedEntry) {
            // Calculate remaining steps after entering home path
            let stepsToEntry = entryIdx >= curIdx 
                ? entryIdx - curIdx 
                : (ringPath.length - curIdx) + entryIdx;
            const remainingSteps = steps - stepsToEntry;
            if (remainingSteps > 0 && remainingSteps <= homePaths[color].length) {
                // Move into home path
                return homePaths[color][remainingSteps - 1];
            } else if (remainingSteps > homePaths[color].length) {
                // Would finish
                return -1;
            } else {
                // Exactly at entry point
                return homePaths[color][0];
            }
        }
    }

    return newPosition;
}

// Check if a position is in a player's home path
function isInHomePath(color, position) {
    return homePaths[color].includes(position);
}

// Get piece at a specific position (optionally excluding a specific piece)
function getPieceAtPosition(position, excludeColor = null, excludeId = null) {
    for (const color of players) {
        for (const piece of gameState.pieces[color]) {
            if (piece.position === position && !piece.isHome && !piece.isFinished) {
                // Skip if this is the piece we're excluding
                if (excludeColor === color && excludeId === piece.id) {
                    continue;
                }
                return { color, id: piece.id };
            }
        }
    }
    return null;
}

// Select a piece to move
function selectPiece(color, pieceId) {
    if (players[gameState.currentPlayer] !== color || !gameState.hasRolled) return;

    // If connected: only allow local seat to move their color
    if (player.color && player.color !== color) return;
    
    const piece = gameState.pieces[color][pieceId];
    
    if (!canPieceMove(color, pieceId)) return;
    
    // Deselect previous piece
    if (gameState.selectedPiece) {
        const prevPieceElement = document.querySelector(`.piece[data-color="${gameState.selectedPiece.color}"][data-id="${gameState.selectedPiece.id}"]`);
        if (prevPieceElement) prevPieceElement.classList.remove('selected');
    }
    
    // Select new piece
    gameState.selectedPiece = { color, id: pieceId };
    const pieceElement = document.querySelector(`.piece[data-color="${color}"][data-id="${pieceId}"]`);
    pieceElement.classList.add('selected');
    
    // Move the piece
    movePiece(color, pieceId);
}

// Move a piece
function movePiece(color, pieceId) {
    const piece = gameState.pieces[color][pieceId];
    
    // If piece is in home and dice is 6
    if (piece.isHome && gameState.diceValue === 6) {
        piece.isHome = false;
        piece.position = startPositions[color];
        
        // Check if there's a piece at the start position (exclude current piece)
        const occupyingPiece = getPieceAtPosition(piece.position, color, pieceId);
        if (occupyingPiece && occupyingPiece.color !== color) {
            // Send the occupying piece back to its home
            gameState.pieces[occupyingPiece.color][occupyingPiece.id].position = -1;
            gameState.pieces[occupyingPiece.color][occupyingPiece.id].isHome = true;
            updatePiecePosition(occupyingPiece.color, occupyingPiece.id);
        }
    } 
    // If piece is on the board
    else if (!piece.isHome) {
        const newPosition = calculateNewPosition(color, piece.position, gameState.diceValue);
        
        // If piece would finish
        if (newPosition === -1) {
            piece.isFinished = true;
            gameInfoElement.textContent = `${playerNames[gameState.currentPlayer]} piece finished!`;
        } else {
            // Check if there's a piece at the new position (exclude current piece)
            const occupyingPiece = getPieceAtPosition(newPosition, color, pieceId);
            if (occupyingPiece) {
                // Send the occupying piece back to its home (only if different color)
                if (occupyingPiece.color !== color) {
                    gameState.pieces[occupyingPiece.color][occupyingPiece.id].position = -1;
                    gameState.pieces[occupyingPiece.color][occupyingPiece.id].isHome = true;
                    updatePiecePosition(occupyingPiece.color, occupyingPiece.id);
                } else {
                    // Can't move to a position occupied by own piece
                    return;
                }
            }
            
            piece.position = newPosition;
        }
    }
    
    // Update UI
    updatePiecePosition(color, pieceId);
    
    // Deselect piece
    if (gameState.selectedPiece) {
        const pieceElement = document.querySelector(`.piece[data-color="${gameState.selectedPiece.color}"][data-id="${gameState.selectedPiece.id}"]`);
        if (pieceElement) pieceElement.classList.remove('selected');
        gameState.selectedPiece = null;
    }
    
    // Check for extra turn (rolled a 6)
    if (gameState.diceValue === 6 && !piece.isFinished) {
        gameState.hasRolled = false;
        gameInfoElement.textContent = "Rolled a 6! Roll again.";
    } else {
        nextTurn();
    }
    
    updateUI();
    
    // Check for win condition
    checkWinCondition();

    // Broadcast state if connected
    syncState();
}

// Update piece position on the board
function updatePiecePosition(color, pieceId) {
    const piece = gameState.pieces[color][pieceId];
    const pieceElement = document.querySelector(`.piece[data-color="${color}"][data-id="${pieceId}"]`);
    
    if (piece.isHome) {
        const homeElement = document.getElementById(`${color}-home`);
        const insideBoxes = homeElement.querySelectorAll('.insidebox');
        const box = insideBoxes[pieceId];
        const rect = box.getBoundingClientRect();
        const boardRect = document.querySelector('.ludo').getBoundingClientRect();
        
        pieceElement.style.left = `${rect.left - boardRect.left + 15}px`;
        pieceElement.style.top = `${rect.top - boardRect.top + 15}px`;
    } else if (piece.isFinished) {
        // Hide finished pieces
        pieceElement.style.display = 'none';
    } else {
        const squareElement = document.querySelector(`.square[data-index="${piece.position}"]`);
        if (squareElement) {
            const rect = squareElement.getBoundingClientRect();
            const boardRect = document.querySelector('.ludo').getBoundingClientRect();
            
            pieceElement.style.left = `${rect.left - boardRect.left + 9}px`;
            pieceElement.style.top = `${rect.top - boardRect.top + 9}px`;
        }
    }
}

// Move to next player's turn
function nextTurn() {
    // advance to the next active color
    let idx = gameState.currentPlayer;
    for (let i = 0; i < 4; i++) {
        idx = (idx + 1) % 4;
        if (activeColors.has(players[idx])) break;
    }
    gameState.currentPlayer = idx;
    gameState.diceValue = 0;
    gameState.hasRolled = false;
    diceElement.textContent = '0';
    
    updateUI();
    // share the turn advance
    syncState();
}

// Check if a player has won
function checkWinCondition() {
    for (const color of players) {
        if (gameState.pieces[color].every(piece => piece.isFinished)) {
            gameInfoElement.textContent = `${playerNames[players.indexOf(color)]} wins the game!`;
            rollButton.disabled = true;
            syncState();
            return;
        }
    }
}

// Update UI based on game state
function updateUI() {
    playerTurnElement.textContent = `${playerNames[gameState.currentPlayer]}'s Turn`;
    playerTurnElement.className = `player-turn ${players[gameState.currentPlayer]}Font`;
    
    rollButton.disabled = gameState.hasRolled;
}

// -------- Networking helpers --------
function updateNetStatus(text) {
    netStatusEl.textContent = text;
}

async function fetchRoomAndSetActiveColors(id) {
    try {
        const res = await fetch(`${API_BASE}/rooms/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Room not found');
        const playersObj = data.room.players || {};
        const nextActive = new Set();
        ['blue','red','yellow','green'].forEach(c => {
            if (playersObj[c]) nextActive.add(c);
        });
        // if no seats taken, keep default local 4-color rotation
        activeColors = nextActive.size > 0 ? nextActive : new Set(['blue','red','yellow','green']);
        ensureCurrentPlayerActive();
        return data;
    } catch (e) {
        // keep existing activeColors if fetch fails
        return null;
    }
}

function ensureCurrentPlayerActive() {
    // If current color is not active, advance until we find one
    if (!activeColors.has(getCurrentColor())) {
        nextTurn();
    }
}

async function createRoom() {
    try {
        const res = await fetch(`${API_BASE}/rooms`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create room');
        roomId = data.room.id;
        wsUrl = data.wsUrl;
        roomInputEl.value = roomId;
        updateNetStatus(`Room ${roomId} created`);
        await fetchRoomAndSetActiveColors(roomId);
    } catch (e) {
        updateNetStatus(`Error: ${e.message}`);
    }
}

async function joinRoom() {
    try {
        const id = (roomInputEl.value || '').trim();
        if (!id) return;
        const res = await fetch(`${API_BASE}/rooms/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Room not found');
        roomId = data.room.id;
        wsUrl = data.wsUrl;
        updateNetStatus(`Joined room ${roomId}. Pick a seat.`);
        await fetchRoomAndSetActiveColors(roomId);
    } catch (e) {
        updateNetStatus(`Error: ${e.message}`);
    }
}

async function takeSeat() {
    try {
        if (!roomId || !wsUrl) return;
        const color = seatSelectEl.value;
        if (!['blue','red','yellow','green'].includes(color)) {
            updateNetStatus('Pick a valid seat color');
            return;
        }
        const name = (nameInputEl.value || '').trim() || color;
        const res = await fetch(`${API_BASE}/rooms/${roomId}/seat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, color })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Seat failed');
        player = { color: data.player.color, token: data.player.token, name };
        const fullWsUrl = data.wsUrl;
        connectWs(fullWsUrl);
        updateNetStatus(`Seated as ${player.color}. Connecting...`);
        await fetchRoomAndSetActiveColors(roomId);
    } catch (e) {
        updateNetStatus(`Error: ${e.message}`);
    }
}

function connectWs(url) {
    try {
        if (ws) {
            try { ws.close(); } catch {}
        }
        ws = new WebSocket(url);
        ws.onopen = () => {
            updateNetStatus(`Connected (room ${roomId})`);
            // Send initial snapshot so others get our state if we're first
            syncState();
        };
        ws.onmessage = (evt) => {
            try {
                const msg = JSON.parse(evt.data);
                handleWsMessage(msg);
            } catch {}
        };
        ws.onclose = () => {
            updateNetStatus('Disconnected');
        };
        ws.onerror = () => {
            updateNetStatus('Connection error');
        };
    } catch (e) {
        updateNetStatus(`WS error: ${e.message}`);
    }
}

function serializeState() {
    return {
        currentPlayer: gameState.currentPlayer,
        diceValue: gameState.diceValue,
        hasRolled: gameState.hasRolled,
        selectedPiece: null, // do not sync selection
        pieces: {
            blue: gameState.pieces.blue.map(p => ({ id: p.id, position: p.position, isHome: p.isHome, isFinished: p.isFinished })),
            red: gameState.pieces.red.map(p => ({ id: p.id, position: p.position, isHome: p.isHome, isFinished: p.isFinished })),
            yellow: gameState.pieces.yellow.map(p => ({ id: p.id, position: p.position, isHome: p.isHome, isFinished: p.isFinished })),
            green: gameState.pieces.green.map(p => ({ id: p.id, position: p.position, isHome: p.isHome, isFinished: p.isFinished }))
        }
    };
}

function applyState(state) {
    gameState.currentPlayer = state.currentPlayer;
    gameState.diceValue = state.diceValue;
    gameState.hasRolled = state.hasRolled;
    diceElement.textContent = String(state.diceValue || 0);
    ['blue','red','yellow','green'].forEach(color => {
        state.pieces[color].forEach((p, idx) => {
            gameState.pieces[color][idx].position = p.position;
            gameState.pieces[color][idx].isHome = p.isHome;
            gameState.pieces[color][idx].isFinished = p.isFinished;
            updatePiecePosition(color, idx);
        });
    });
    updateUI();
}

function syncState() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const payload = serializeState();
    ws.send(JSON.stringify({ type: 'state', payload }));
}

function handleWsMessage(msg) {
    if (msg.type === 'state' && msg.payload) {
        applyState(msg.payload);
    }
    // Optionally handle presence / chat
    if (msg.type === 'presence') {
        // lightweight hint in status
        updateNetStatus(`Room ${roomId}: ${msg.event} ${msg.color || ''}`.trim());
        // Update active colors based on presence if color provided
        if (msg.color) {
            if (msg.event === 'join') activeColors.add(msg.color);
            if (msg.event === 'leave') activeColors.delete(msg.color);
            ensureCurrentPlayerActive();
        }
    }
}

// Start the game
initGame();
