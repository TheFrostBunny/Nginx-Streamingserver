const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

const HLS_PATH = '/var/www/html/stream/hls';

app.set('view engine', 'ejs');
app.use('/vjs', express.static(path.join(__dirname, 'node_modules/video.js/dist')));

// Kanal/strøm-side
app.get('/stream/:id', (req, res) => {
    const streamId = req.params.id;
    res.render('stream', { streamId });
});

// Slett en strøm og tilhørende .ts-filer
app.delete('/api/stream/:id', (req, res) => {
    const streamId = req.params.id;
    const m3u8Path = path.join(HLS_PATH, `${streamId}.m3u8`);
    fs.unlink(m3u8Path, err => {
        // Slett .ts-filer med samme prefix
        fs.readdir(HLS_PATH, (err2, files) => {
            if (!err2) {
                files.filter(f => f.startsWith(streamId) && f.endsWith('.ts')).forEach(tsFile => {
                    fs.unlink(path.join(HLS_PATH, tsFile), () => {});
                });
            }
            if (err) return res.status(404).json({ deleted: false, error: 'Fant ikke m3u8' });
            res.json({ deleted: true });
        });
    });
});

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
