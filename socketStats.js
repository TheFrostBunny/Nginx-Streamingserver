const { Server } = require('socket.io');

let totalUsers = 0;
let streamViewers = {};

function setupSocket(server) {
    const io = new Server(server);

    io.on('connection', (socket) => {
        totalUsers++;
        io.emit('userCount', totalUsers);

        socket.on('watchStream', (streamId) => {
            if (!streamViewers[streamId]) streamViewers[streamId] = 0;
            streamViewers[streamId]++;
            io.emit('streamViewers', streamViewers);
            socket.join(streamId);
            socket._streamId = streamId;
        });

        socket.on('leaveStream', (streamId) => {
            if (streamViewers[streamId]) {
                streamViewers[streamId]--;
                if (streamViewers[streamId] < 0) streamViewers[streamId] = 0;
                io.emit('streamViewers', streamViewers);
            }
            socket.leave(streamId);
            socket._streamId = null;
        });

        socket.on('disconnect', () => {
            totalUsers--;
            io.emit('userCount', totalUsers);
            if (socket._streamId && streamViewers[socket._streamId]) {
                streamViewers[socket._streamId]--;
                if (streamViewers[socket._streamId] < 0) streamViewers[socket._streamId] = 0;
                io.emit('streamViewers', streamViewers);
            }
        });
    });
}

module.exports = setupSocket;
