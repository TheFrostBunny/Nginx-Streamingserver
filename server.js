const express = require('express');
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const cors = require('cors');
const app = express();

const HLS_PATH = '/var/www/html/stream/hls';

// Middleware
app.use(morgan('dev'));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public'))); // For evt. statiske filer

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

app.get('/', (req, res) => res.render('index'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Node kjører på port ${PORT} - Video.js er klar på /vjs`));