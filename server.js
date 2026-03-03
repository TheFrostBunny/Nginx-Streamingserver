require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// SQLite DB setup
const db = new sqlite3.Database(path.join(__dirname, 'database', 'chat.db'));

const HLS_PATH = '/var/www/html/stream/hls';


// Middleware
app.use(morgan('dev'));
app.use(cors());
app.use(helmet());
app.use(compression());
app.use(express.static(path.join(__dirname, 'public'))); // For evt. statiske filer
app.use(express.json());

app.set('view engine', 'ejs');

// Server Video.js fra node_modules
app.use('/vjs', express.static(path.join(__dirname, 'node_modules/video.js/dist')));

// Server HLS-strømmer direkte
app.use('/hls', express.static(HLS_PATH));

// API: Liste over aktive strømmer
app.get('/api/streams', (req, res) => {
    fs.readdir(HLS_PATH, (err, files) => {
        if (err) {
            console.error('Feil ved lesing av HLS-mappe:', err);
            return res.status(500).json([]);
        }
        const streams = files
            .filter(f => f.endsWith('.m3u8'))
            .map(f => f.replace('.m3u8', ''));
        res.json(streams);
    });
});

// API: Sjekk om en strøm eksisterer
app.get('/api/stream/:id', (req, res) => {
    const streamId = req.params.id;
    const filePath = path.join(HLS_PATH, `${streamId}.m3u8`);
    fs.access(filePath, fs.constants.F_OK, err => {
        if (err) return res.status(404).json({ exists: false });
        res.json({ exists: true });
    });
});


// Chat API: Hent siste meldinger
app.get('/api/chat', (req, res) => {
    db.all('SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT 50', [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        res.json(rows.reverse());
    });
});

// Chat API: Post ny melding
app.post('/api/chat', (req, res) => {
    const { username, message } = req.body;
    if (!username || !message) return res.status(400).json({ error: 'Missing fields' });
    db.run('INSERT INTO chat_messages (username, message) VALUES (?, ?)', [username, message], function(err) {
        if (err) return res.status(500).json({ error: 'DB error' });
        // Emit til alle via websocket
        io.emit('chat message', { id: this.lastID, username, message, created_at: new Date().toISOString() });
        res.json({ id: this.lastID, username, message, created_at: new Date().toISOString() });
    });
});

// WebSocket for chat
io.on('connection', (socket) => {
    socket.on('chat message', (msg) => {
        // Forventet: { username, message }
        if (!msg.username || !msg.message) return;
        db.run('INSERT INTO chat_messages (username, message) VALUES (?, ?)', [msg.username, msg.message], function(err) {
            if (!err) {
                io.emit('chat message', { id: this.lastID, username: msg.username, message: msg.message, created_at: new Date().toISOString() });
            }
        });
    });
});

app.get('/', (req, res) => res.render('index'));


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Node kjører på port ${PORT} - Video.js og chat er klar!`));
