const express = require('express');
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const cors = require('cors');
const app = express();
const http = require('http');
const server = http.createServer(app);
const setupSocket = require('./socketStats');
setupSocket(server);

const si = require('systeminformation');
const rateLimit = require('express-rate-limit');
// Egen rate limiter for stream-konvertering (strengere)
const streamLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutter
    max: 10, // max 10 konverteringer per IP per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: 'For mange konverteringer, prøv igjen senere.'
});
const helmet = require('helmet');
const sanitize = require('sanitize-filename');

// Statistikk-endepunkt (super oversiktlig + systeminfo)
app.get('/api/stats', async (req, res) => {
    const uploadsPath = path.join(__dirname, 'public', 'uploads');
    const logPath = path.join(__dirname, 'upload_ip_log.txt');

    // Hent antall videoer
    let videoCount = 0;
    try {
        const files = await fs.promises.readdir(uploadsPath);
        videoCount = files.filter(f => !f.startsWith('.')).length;
    } catch {}

    // Hent antall opplastinger
    let uploadCount = 0;
    try {
        const data = await fs.promises.readFile(logPath, 'utf8');
        uploadCount = data.split('\n').filter(Boolean).length;
    } catch {}

    // Hent systeminfo
    let cpu = {}, mem = {}, temp = {}, uptime = 0;
    try {
        [cpu, mem, temp, uptime] = await Promise.all([
            si.currentLoad(),
            si.mem(),
            si.cpuTemperature(),
            si.time()
        ]);
    } catch {}

    res.json({
        "Antall videoer": videoCount,
        "Antall opplastinger": uploadCount,
        "Beskrivelse": "Dette er en enkel statistikk for video-serveren.",
        "CPU-bruk (%)": (typeof cpu.currentLoad === 'number' ? cpu.currentLoad.toFixed(1) : (typeof cpu.currentload === 'number' ? cpu.currentload.toFixed(1) : null)),
        "RAM-bruk (MB)": mem.active ? (mem.active/1024/1024).toFixed(0) : null,
        "RAM totalt (MB)": mem.total ? (mem.total/1024/1024).toFixed(0) : null,
        "CPU temp (°C)": temp.main || null,
        "Oppetid (min)": uptime.uptime ? Math.floor(uptime.uptime/60) : null
    });
});

app.get('/stats', (req, res) => {
    res.render('stats');
});

app.get('/upload', (req, res) => {
    res.render('upload');
});

app.get('/video/:filename', (req, res) => {
    const filename = req.params.filename;
    const videoPath = path.join(__dirname, 'public', 'uploads', filename);
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

// Streams per dag (for grafer)
app.get('/api/streams-per-day', (req, res) => {
    const logPath = path.join(__dirname, 'upload_ip_log.txt');
    fs.readFile(logPath, 'utf8', (err, data) => {
        const perDay = {};
        if (!err && data) {
            data.split('\n').filter(Boolean).forEach(line => {
                const date = line.split(' | ')[0]?.slice(0, 10); // YYYY-MM-DD
                if (date) {
                    perDay[date] = (perDay[date] || 0) + 1;
                }
            });
        }
        // Sorter datoer
        const labels = Object.keys(perDay).sort();
        const counts = labels.map(l => perDay[l]);
        res.json({ labels, counts });
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
            // Logg misbruk: feil filtype
            let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            if (ip && typeof ip === 'string' && ip.includes(',')) {
                const parts = ip.split(',');
                ip = parts[parts.length - 1].trim();
            }
            const abuseLog = `${new Date().toISOString()} | IP: ${ip} | Misbruk: Feil filtype (${file.mimetype})\n`;
            fs.appendFile(path.join(__dirname, 'abuse_log.txt'), abuseLog, () => {});
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
    // Sanitér streamId
    const streamId = sanitize(req.params.id);
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
        // Logg misbruk: ingen fil lastet opp
        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        if (ip && typeof ip === 'string' && ip.includes(',')) {
            const parts = ip.split(',');
            ip = parts[parts.length - 1].trim();
        }
        const abuseLog = `${new Date().toISOString()} | IP: ${ip} | Misbruk: Ingen fil lastet opp\n`;
        fs.appendFile(path.join(__dirname, 'abuse_log.txt'), abuseLog, () => {});
        return res.status(400).send('Ingen fil lastet opp.');
    }
    // Sanitér originalt filnavn
    const safeOriginal = sanitize(req.file.originalname);
    const ext = path.extname(safeOriginal) || '';
    const oldPath = req.file.path;
    const newFilename = req.file.filename + ext;
    const newPath = path.join(path.dirname(oldPath), newFilename);
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip && typeof ip === 'string' && ip.includes(',')) {
        const parts = ip.split(',');
        ip = parts[parts.length - 1].trim();
    }
    const logPath = path.join(__dirname, 'upload_ip_log.txt');
    fs.readFile(logPath, 'utf8', (err, data) => {
        let count = 0;
        if (!err && data) {
            const lines = data.split('\n').filter(Boolean);
            count = lines.filter(line => line.includes(`IP: ${ip}`)).length;
        }
        if (count >= 10) {
            fs.unlink(oldPath, () => {});
            // Logg misbruk: for mange uploads
            const abuseLog = `${new Date().toISOString()} | IP: ${ip} | Misbruk: For mange videoopplastinger\n`;
            fs.appendFile(path.join(__dirname, 'abuse_log.txt'), abuseLog, () => {});
            return res.status(429).send('Du har nådd maks 10 videoopplastinger.');
        }
        const logLine = `${new Date().toISOString()} | IP: ${ip} | Fil: ${newFilename}\n`;
        fs.appendFile(logPath, logLine, err => {
            if (err) {
                console.error('Feil ved logging av IP:', err);
            }
        });
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
});

app.use((req, res, next) => {
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip && typeof ip === 'string' && ip.includes(',')) {
        const parts = ip.split(',');
        ip = parts[parts.length - 1].trim();
    }
    const logLine = `${new Date().toISOString()} | IP: ${ip} | URL: ${req.originalUrl}\n`;
    fs.appendFile(path.join(__dirname, 'visit_ip_log.txt'), logLine, err => {
        if (err) {
            console.error('Feil ved logging av besøkende IP:', err);
        }
    });
    next();
});

const PORT = process.env.PORT || 3000;
const { exec } = require('child_process');

function convertHLStoMP4(streamId, callback) {
    const hlsFile = path.join(HLS_PATH, `${streamId}.m3u8`);
    const outputFile = path.join(__dirname, 'public', 'uploads', `${streamId}.mp4`);
    const cmd = `ffmpeg -y -i "${hlsFile}" -c copy -bsf:a aac_adtstoasc "${outputFile}" -loglevel error`;
    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            console.error(`ffmpeg error:`, error, stderr);
            return callback(error);
        }
        callback(null, outputFile);
    });
}

app.post('/api/convert/:streamId', (req, res) => {
    streamLimiter(req, res, () => {
        const streamId = sanitize(req.params.streamId);
        const hlsFile = path.join(HLS_PATH, `${streamId}.m3u8`);
        fs.access(hlsFile, fs.constants.F_OK, err => {
            if (err) return res.status(404).json({ error: 'Stream ikke funnet' });
            convertHLStoMP4(streamId, (err, outputFile) => {
                if (err) return res.status(500).json({ error: 'Konvertering feilet' });
                res.json({ success: true, file: `/uploads/${streamId}.mp4` });
            });
        });
    });
});

app.use(helmet());

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'For mange forespørsler, prøv igjen senere.'
});
app.use(limiter);

server.listen(PORT, () => console.log(`Node kjører på port ${PORT} - Video.js er klar på /vjs`));