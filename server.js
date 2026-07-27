const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the current directory
app.use(express.static(__dirname));

let waitingPlayer = null;

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join_game', (nickname) => {
        socket.nickname = nickname;

        // Clean up previous room if any
        if (socket.room) {
            socket.leave(socket.room);
            socket.room = null;
        }

        if (waitingPlayer === socket) {
            // Already waiting
            return;
        }

        if (waitingPlayer) {
            // Match found!
            const player1 = waitingPlayer;
            const player2 = socket;
            waitingPlayer = null; // Reset waiting player

            const roomName = `room_${player1.id}_${player2.id}`;
            player1.join(roomName);
            player2.join(roomName);

            player1.room = roomName;
            player2.room = roomName;
            
            // Assign roles
            player1.role = 'X';
            player2.role = 'O';

            // Notify both players
            io.to(roomName).emit('game_start', {
                playerX: player1.nickname,
                playerO: player2.nickname,
                startingTurn: 'X'
            });

            // Tell each player their role
            player1.emit('role_assigned', 'X');
            player2.emit('role_assigned', 'O');

        } else {
            // Wait for opponent
            waitingPlayer = socket;
            socket.emit('waiting_for_opponent');
        }
    });

    socket.on('make_move', (data) => {
        // data: { index: cellIndex, player: 'X' or 'O' }
        if (socket.room) {
            socket.to(socket.room).emit('opponent_moved', data);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        if (waitingPlayer === socket) {
            waitingPlayer = null;
        }

        if (socket.room) {
            socket.to(socket.room).emit('opponent_disconnected');
            // Kick the other player out of the room so they can rejoin matchmaking if they want
            const clients = io.sockets.adapter.rooms.get(socket.room);
            if (clients) {
                for (const clientId of clients) {
                    const clientSocket = io.sockets.sockets.get(clientId);
                    if (clientSocket) {
                        clientSocket.leave(socket.room);
                        clientSocket.room = null;
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
