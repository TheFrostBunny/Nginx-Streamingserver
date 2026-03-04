const express = require('express');
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const cors = require('cors');
const app = express();

app.get('/upload', (req, res) => {
    res.render('upload');
});

app.get('/video/:filename', (req, res) => {
    const filename = req.params.filename;
    const videoPath = path.join(__dirname, 'public', 'uploads', filename);
    // Sjekk at filen finnes
    fs.access(videoPath, fs.constants.F_OK, err => {
        if (err) {
            return res.status(404).send('Video ikke funnet');
        }
        res.render('video', {
            videoUrl: `/uploads/${filename}`,
            videoName: filename
        });
    });
});

app.get('/videos', (req, res) => {
    const uploadsPath = path.join(__dirname, 'public', 'uploads');
    fs.readdir(uploadsPath, (err, files) => {
        if (err) {
            console.error('Feil ved lesing av uploads-mappe:', err);
            return res.render('videolist', { videos: [] });
        }
        const videos = files.filter(f => !f.startsWith('.'));
        res.render('videolist', { videos });
    });
});


app.get('/api/videos', (req, res) => {
    const uploadsPath = path.join(__dirname, 'public', 'uploads');
    fs.readdir(uploadsPath, (err, files) => {
        if (err) {
            console.error('Feil ved lesing av uploads-mappe:', err);
            return res.status(500).json([]);
        }
        const videos = files.filter(f => !f.startsWith('.'));
        res.json(videos);
    });
});

const multer = require('multer');
const upload = multer({
    dest: path.join(__dirname, 'public', 'uploads'),
    limits: { fileSize: 200 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype && file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Kun video-filer er tillatt!'), false);
        }
    }
});

const HLS_PATH = '/var/www/html/stream/hls';

app.use(morgan('dev'));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));


app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

app.set('view engine', 'ejs');

app.use('/vjs', express.static(path.join(__dirname, 'node_modules/video.js/dist')));

app.use('/hls', express.static(HLS_PATH));

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

app.get('/api/stream/:id', (req, res) => {
    const streamId = req.params.id;
    const filePath = path.join(HLS_PATH, `${streamId}.m3u8`);
    fs.access(filePath, fs.constants.F_OK, err => {
        if (err) return res.status(404).json({ exists: false });
        res.json({ exists: true });
    });
});

app.get('/', (req, res) => {
    res.render('home');
});

app.get('/streams', (req, res) => {
    res.render('streams');
});

app.post('/upload/video', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('Ingen fil lastet opp.');
    }
    const ext = path.extname(req.file.originalname) || '';
    const oldPath = req.file.path;
    const newFilename = req.file.filename + ext;
    const newPath = path.join(path.dirname(oldPath), newFilename);
    fs.rename(oldPath, newPath, err => {
        if (err) {
            console.error('Feil ved omdøping:', err);
            return res.status(500).send('Feil ved lagring av video.');
        }
        res.json({
            filename: newFilename,
            originalname: req.file.originalname,
            url: `/uploads/${newFilename}`
        });
    });
});

const PORT = process.env.PORT || 3000;
// --- HLS to MP4 conversion helper ---
const { exec } = require('child_process');

function convertHLStoMP4(streamId, callback) {
    const hlsFile = path.join(HLS_PATH, `${streamId}.m3u8`);
    const outputFile = path.join(__dirname, 'public', 'uploads', `${streamId}.mp4`);
    // ffmpeg command: -y to overwrite, -loglevel error for less noise
    const cmd = `ffmpeg -y -i "${hlsFile}" -c copy -bsf:a aac_adtstoasc "${outputFile}" -loglevel error`;
    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            console.error(`ffmpeg error:`, error, stderr);
            return callback(error);
        }
        callback(null, outputFile);
    });
}

// API endpoint to trigger conversion manually
app.post('/api/convert/:streamId', (req, res) => {
    const streamId = req.params.streamId;
    const hlsFile = path.join(HLS_PATH, `${streamId}.m3u8`);
    fs.access(hlsFile, fs.constants.F_OK, err => {
        if (err) return res.status(404).json({ error: 'Stream ikke funnet' });
        convertHLStoMP4(streamId, (err, outputFile) => {
            if (err) return res.status(500).json({ error: 'Konvertering feilet' });
            res.json({ success: true, file: `/uploads/${streamId}.mp4` });
        });
    });
});
app.listen(PORT, () => console.log(`Node kjører på port ${PORT} - Video.js er klar på /vjs`));