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


const streamLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutter
    max: 10, // max 10 konverteringer per IP per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: 'For mange konverteringer, prøv igjen senere.'
});
const helmet = require('helmet');
const sanitize = require('sanitize-filename');
const multer = require('multer');

// Slett alle .sh-filer i uploads-mappen ved oppstart og etter hver opplasting/konvertering
function deleteShFiles() {
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    fs.readdir(uploadsDir, (err, files) => {
        if (err) return;
        files.filter(f => f.endsWith('.sh')).forEach(f => {
            fs.unlink(path.join(uploadsDir, f), () => {});
        });
    });
}

deleteShFiles(); // Kjør ved oppstart

// Blokker IP midlertidig etter for mange misbruksforsøk
const abuseBlockMap = new Map(); // ip -> { count, last, blockedUntil }
const ABUSE_LIMIT = 10; // antall misbruksforsøk før blokk
const ABUSE_BLOCK_MINUTES = 30; // hvor lenge blokk varer

let ENABLE_RATE_LIMIT_BLOCK = false;

function isBlocked(ip) {
    const entry = abuseBlockMap.get(ip);
    if (entry && entry.blockedUntil && entry.blockedUntil > Date.now()) {
        return true;
    }
    return false;
}

function registerAbuse(ip) {
    const now = Date.now();
    let entry = abuseBlockMap.get(ip);
    if (!entry) entry = { count: 0, last: now, blockedUntil: 0 };
    entry.count++;
    entry.last = now;
    if (entry.count >= ABUSE_LIMIT) {
        entry.blockedUntil = now + ABUSE_BLOCK_MINUTES * 60 * 1000;
        entry.count = 0; // reset count after block
    }
    abuseBlockMap.set(ip, entry);
}

// Felles funksjon for misbrukslogging
function logAbuse({ip, reason, req}) {
    // Første sjekk: blokkert IP?
    if (typeof abuseConfig !== 'undefined' && abuseConfig.blocked_ips && abuseConfig.blocked_ips.includes(ip)) {
        const reasonMsg = reason ? reason + ' (statisk blokkert IP)' : 'Statisk blokkert IP';
        const blocked = 'true';
        const abuseLog = `${new Date().toISOString()} | IP: ${ip} (${ipClass}) | Blocked: ${blocked} | Status: ${status} | Method: ${method} | Endpoint: ${endpoint} | UA: ${userAgent} | Device: ${deviceType} | OS: ${os} | Browser: ${browser} | Referer: ${referer} | Cookies: ${cookies} | Query: ${query} | Body: ${body} | Misbruk: ${reasonMsg}\n`;
        fs.appendFile(path.join(__dirname, 'abuse_log.txt'), abuseLog, () => {});
        if (req && req.res) {
            req.res.status(429).send('Din IP er blokkert av administrator.');
        }
        return;
    }
    // Rate limit blokkering kan slås av med config
    if (ENABLE_RATE_LIMIT_BLOCK && isBlocked(ip)) {
        logAbuse({ip, reason: 'Forsøk fra blokkert IP', req});
        if (req && req.res) {
            req.res.status(429).send('Din IP er midlertidig blokkert pga. misbruk. Prøv igjen senere.');
        }
        return;
    }
    // Registrer misbruk
    registerAbuse(ip);
    // Sikre at status alltid er definert
    let status = '-';
    try {
        if (req && req.res && typeof req.res.statusCode !== 'undefined') {
            status = req.res.statusCode;
        }
    } catch {}
    // IP-klasse må settes her hvis ikke allerede satt
    let ipClass = '-';
    if (ip && typeof ip === 'string') {
        if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.16.') || ip.startsWith('172.17.') || ip.startsWith('172.18.') || ip.startsWith('172.19.') || ip.startsWith('172.20.') || ip.startsWith('172.21.') || ip.startsWith('172.22.') || ip.startsWith('172.23.') || ip.startsWith('172.24.') || ip.startsWith('172.25.') || ip.startsWith('172.26.') || ip.startsWith('172.27.') || ip.startsWith('172.28.') || ip.startsWith('172.29.') || ip.startsWith('172.30.') || ip.startsWith('172.31.')) {
            ipClass = 'Private';
        } else if (ip.startsWith('127.')) {
            ipClass = 'Loopback';
        } else {
            ipClass = 'Public';
        }
    }
    const userAgent = req && req.headers['user-agent'] ? req.headers['user-agent'] : '-';
    const endpoint = req && req.originalUrl ? req.originalUrl : '-';
    const method = req && req.method ? req.method : '-';
    const referer = req && req.headers['referer'] ? req.headers['referer'] : '-';
    const body = req && req.body ? JSON.stringify(req.body).slice(0, 500) : '-';
    const query = req && req.query ? JSON.stringify(req.query).slice(0, 500) : '-';
    const cookies = req && req.headers['cookie'] ? req.headers['cookie'] : '-';
    // Prøv å hente ut mer info om enheten fra user-agent
    let deviceType = '-';
    let os = '-';
    let browser = '-';
    if (userAgent && typeof userAgent === 'string') {
        if (/mobile/i.test(userAgent)) deviceType = 'Mobile';
        else if (/tablet/i.test(userAgent)) deviceType = 'Tablet';
        else deviceType = 'Desktop';
        // Enkel OS-deteksjon
        if (/windows/i.test(userAgent)) os = 'Windows';
        else if (/android/i.test(userAgent)) os = 'Android';
        else if (/linux/i.test(userAgent)) os = 'Linux';
        else if (/iphone|ipad|ipod/i.test(userAgent)) os = 'iOS';
        else if (/mac os/i.test(userAgent)) os = 'MacOS';
        // Enkel browser-deteksjon
        if (/chrome/i.test(userAgent)) browser = 'Chrome';
        else if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) browser = 'Safari';
        else if (/firefox/i.test(userAgent)) browser = 'Firefox';
        else if (/edge/i.test(userAgent)) browser = 'Edge';
        else if (/msie|trident/i.test(userAgent)) browser = 'IE';
    }
    const abuseLog = `${new Date().toISOString()} | IP: ${ip} (${ipClass}) | Status: ${status} | Method: ${method} | Endpoint: ${endpoint} | UA: ${userAgent} | Device: ${deviceType} | OS: ${os} | Browser: ${browser} | Referer: ${referer} | Cookies: ${cookies} | Query: ${query} | Body: ${body} | Misbruk: ${reason}\n`;
    fs.appendFile(path.join(__dirname, 'abuse_log.txt'), abuseLog, () => {});
}

// Sjekk også config-fil for blokkert IP
    if (typeof abuseConfig !== 'undefined' && abuseConfig.blocked_ips && abuseConfig.blocked_ips.includes(ip)) {
        const reasonMsg = reason ? reason + ' (statisk blokkert IP)' : 'Statisk blokkert IP';
        const blocked = 'true';
        const abuseLog = `${new Date().toISOString()} | IP: ${ip} (${ipClass}) | Blocked: ${blocked} | Status: ${status} | Method: ${method} | Endpoint: ${endpoint} | UA: ${userAgent} | Device: ${deviceType} | OS: ${os} | Browser: ${browser} | Referer: ${referer} | Cookies: ${cookies} | Query: ${query} | Body: ${body} | Misbruk: ${reasonMsg}\n`;
        fs.appendFile(path.join(__dirname, 'abuse_log.txt'), abuseLog, () => {});
        if (req && req.res) {
            req.res.status(429).send('Din IP er blokkert av administrator.');
        }
        return;
    }

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
        "RAM-bruk (MB)": mem.active ? (mem.active/1024/1024).toFixed(1) : null,
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

// Sett opp temp-mappe for opplasting
const TEMP_UPLOADS = path.join(__dirname, 'public', 'temp_uploads');
if (!fs.existsSync(TEMP_UPLOADS)) {
    fs.mkdirSync(TEMP_UPLOADS, { recursive: true });
}

const upload = multer({
    dest: TEMP_UPLOADS,
    limits: { fileSize: 200 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        // Kun tillatte video-filtyper (utvid gjerne listen)
        const allowedTypes = [
            'video/mp4',
            'video/webm',
            'video/ogg',
            'video/x-matroska', // mkv
            'video/quicktime',  // mov
            'video/x-msvideo',  // avi
            'video/x-flv',      // flv
            'video/mpeg',
            'video/3gpp',
            'video/3gpp2'
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            if (ip && typeof ip === 'string' && ip.includes(',')) {
                const parts = ip.split(',');
                ip = parts[parts.length - 1].trim();
            }
            // Ekstra: blokker .txt, .sh og ikke-video også etter opplasting, og slett filen umiddelbart hvis den sniker seg gjennom
            const ext = path.extname(file.originalname).toLowerCase();
            const forbiddenExts = ['.txt', '.md', '.csv', '.json', '.xml', '.sh', '.bat', '.exe', '.com', '.scr', '.pif', '.cmd', '.vbs', '.js', '.jar', '.php', '.py', '.pl', '.rb'];
            if (!allowedTypes.includes(file.mimetype) || forbiddenExts.includes(ext)) {
                logAbuse({ip, reason: `Blokkert fil: mimetype=${file.mimetype}, ext=${ext}`, req});
                // Slett filen hvis den har blitt lagret
                if (file.path) {
                    fs.unlink(file.path, () => {});
                }
                return cb(new Error('Denne filtypen er ikke tillatt!'), false);
            }
            // Ekstra: Sjekk faktisk mp4-format etter opplasting
            if (allowedTypes.includes('video/mp4') && ext === '.mp4') {
                const filePath = file.path;
                // Les de første byte for å sjekke mp4-signatur
                try {
                    const fd = fs.openSync(filePath, 'r');
                    const buffer = Buffer.alloc(12);
                    fs.readSync(fd, buffer, 0, 12, 0);
                    fs.closeSync(fd);
                    // MP4-filer starter ofte med ftyp
                    if (!buffer.includes(Buffer.from('ftyp'))) {
                        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
                        if (ip && typeof ip === 'string' && ip.includes(',')) {
                            const parts = ip.split(',');
                            ip = parts[parts.length - 1].trim();
                        }
                        logAbuse({ip, reason: `Filen utgir seg for å være mp4, men mangler ftyp-signatur`, req});
                        fs.unlink(filePath, () => {});
                        return cb(new Error('Filen er ikke et gyldig mp4-format!'), false);
                    }
                } catch (e) {
                    // Hvis det ikke går å lese filen, slett og blokker
                    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
                    if (ip && typeof ip === 'string' && ip.includes(',')) {
                        const parts = ip.split(',');
                        ip = parts[parts.length - 1].trim();
                    }
                    logAbuse({ip, reason: `Feil ved lesing av mp4-fil: ${e.message}`, req});
                    fs.unlink(filePath, () => {});
                    return cb(new Error('Kunne ikke verifisere mp4-fil!'), false);
                }
            }
            logAbuse({ip, reason: `Feil filtype (${file.mimetype})`, req});
            cb(new Error('Kun bestemte video-filtyper er tillatt!'), false);
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

app.post('/upload/video', upload.single('video'), async (req, res, next) => {
    deleteShFiles();
    if (!req.file) {
        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        if (ip && typeof ip === 'string' && ip.includes(',')) {
            const parts = ip.split(',');
            ip = parts[parts.length - 1].trim();
        }
        logAbuse({ip, reason: 'Ingen fil lastet opp', req});
        return res.status(400).send('Ingen fil lastet opp.');
    }
    // Sjekk filtype og innhold i temp-mappen
    const tempPath = req.file.path;
    const safeOriginal = sanitize(req.file.originalname);
    const ext = path.extname(safeOriginal) || '';
    
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip && typeof ip === 'string' && ip.includes(',')) {
        const parts = ip.split(',');
        ip = parts[parts.length - 1].trim();
    }
    
    const allowedTypes = [
        '.mp4', '.webm', '.ogg', '.mkv', '.mov', '.avi', '.flv', '.mpeg', '.3gp', '.3g2'
    ];
    // Sjekk extension først
    if (!allowedTypes.includes(ext.toLowerCase())) {
        fs.unlink(tempPath, () => {});
        logAbuse({ip, reason: `Ugyldig filtype: ${ext}`, req});
        return res.status(400).send('Kun video-filer er tillatt!');
    }
    // Bruk ffprobe for å verifisere at filen faktisk er en gyldig video
    const { exec } = require('child_process');
    const ffprobeCmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${tempPath}"`;
    
    try {
        const { stdout } = await new Promise((resolve, reject) => {
            exec(ffprobeCmd, (error, stdout, stderr) => {
                if (error) reject(error);
                else resolve({ stdout, stderr });
            });
        });
        
        const mediaInfo = JSON.parse(stdout);
        const hasVideoStream = mediaInfo.streams && mediaInfo.streams.some(s => s.codec_type === 'video');
        
        if (!hasVideoStream) {
            fs.unlink(tempPath, () => {});
            logAbuse({ip, reason: 'Filen inneholder ingen video-stream', req});
            return res.status(400).send('Filen er ikke en gyldig video!');
        }
        
        // Sjekk om videoen har gyldig varighet (ikke korrupt)
        const duration = parseFloat(mediaInfo.format.duration);
        if (!duration || duration < 0.1) {
            fs.unlink(tempPath, () => {});
            logAbuse({ip, reason: 'Video har ugyldig varighet', req});
            return res.status(400).send('Video-filen er korrupt eller ugyldig!');
        }
        
        // Sjekk video-codec - konverter HEVC til H.264 for kompatibilitet
        const videoStream = mediaInfo.streams.find(s => s.codec_type === 'video');
        const needsConversion = videoStream && (videoStream.codec_name === 'hevc' || videoStream.codec_name === 'h265');
        
        if (needsConversion) {
            const convertedPath = tempPath + '_converted.mp4';
            const convertCmd = `ffmpeg -i "${tempPath}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k "${convertedPath}" -y`;
            
            try {
                await new Promise((resolve, reject) => {
                    exec(convertCmd, (error, stdout, stderr) => {
                        if (error) reject(error);
                        else resolve({ stdout, stderr });
                    });
                });
                
                // Erstatte original med konvertert fil
                fs.unlinkSync(tempPath);
                fs.renameSync(convertedPath, tempPath);
                
            } catch (e) {
                fs.unlink(tempPath, () => {});
                logAbuse({ip, reason: `HEVC-konvertering feilet: ${e.message}`, req});
                return res.status(400).send('Kunne ikke konvertere HEVC-video til kompatibelt format!');
            }
        }
        
    } catch (e) {
        fs.unlink(tempPath, () => {});
        logAbuse({ip, reason: `ffprobe-feil: ${e.message}`, req});
        return res.status(400).send('Kunne ikke verifisere video-fil!');
    }
    // Flytt filen til uploads hvis OK
    const uploadsPath = path.join(__dirname, 'public', 'uploads');
    const newFilename = req.file.filename + ext;
    const newPath = path.join(uploadsPath, newFilename);
    fs.rename(tempPath, newPath, err => {
        if (err) {
            console.error('Feil ved flytting til uploads:', err);
            return res.status(500).send('Feil ved lagring av video.');
        }
        res.json({
            filename: newFilename,
            originalname: req.file.originalname,
            url: `/uploads/${newFilename}`
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

// Logg misbruk ved global rate limit
app.use((err, req, res, next) => {
    if (err && err.status === 429) {
        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        if (ip && typeof ip === 'string' && ip.includes(',')) {
            const parts = ip.split(',');
            ip = parts[parts.length - 1].trim();
        }
        logAbuse({ip, reason: 'Global rate limit nådd', req});
    }
    next(err);
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
    streamLimiter(req, res, (err) => {
        if (err) {
            let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            if (ip && typeof ip === 'string' && ip.includes(',')) {
                const parts = ip.split(',');
                ip = parts[parts.length - 1].trim();
            }
            logAbuse({ip, reason: 'Stream konvertering rate limit nådd', req});
            return res.status(429).json({ error: 'For mange konverteringer, prøv igjen senere.' });
        }
        const streamId = sanitize(req.params.streamId);
        if (!streamId || streamId !== req.params.streamId) {
            let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            if (ip && typeof ip === 'string' && ip.includes(',')) {
                const parts = ip.split(',');
                ip = parts[parts.length - 1].trim();
            }
            logAbuse({ip, reason: 'Ugyldig streamId (path traversal/sanitizing)', req});
            return res.status(400).json({ error: 'Ugyldig streamId.' });
        }
        const hlsFile = path.join(HLS_PATH, `${streamId}.m3u8`);
        fs.access(hlsFile, fs.constants.F_OK, err => {
            if (err) return res.status(404).json({ error: 'Stream ikke funnet' });
            convertHLStoMP4(streamId, (err, outputFile) => {
                deleteShFiles(); // Slett .sh-filer etter konvertering
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