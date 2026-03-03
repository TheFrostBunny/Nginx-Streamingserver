const express = require('express');
const fs = require('fs');
const path = require('path'); // Lagt til for å håndtere filstier
const app = express();

const HLS_PATH = '/var/www/html/stream/hls';

app.set('view engine', 'ejs');

// --- NYTT: Serverer Video.js fra node_modules ---
// Dette gjør at du kan bruke /vjs/video.min.js i HTML-koden din
app.use('/vjs', express.static(path.join(__dirname, 'node_modules/video.js/dist')));

// API som returnerer liste over aktive strømmer
app.get('/api/streams', (req, res) => {
    fs.readdir(HLS_PATH, (err, files) => {
        if (err) return res.json([]);
        const streams = files
            .filter(f => f.endsWith('.m3u8'))
            .map(f => f.replace('.m3u8', ''));
        res.json(streams);
    });
});

app.get('/', (req, res) => res.render('index'));

app.listen(3000, () => console.log('Node kjører på port 3000 - Video.js er klar på /vjs'));
