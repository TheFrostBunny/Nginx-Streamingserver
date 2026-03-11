const express = require('express');
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const cors = require('cors');
const app = express();

// Trust proxy for reverse proxy setup (nginx)
app.set('trust proxy', 1);

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

deleteShFiles();
setInterval(deleteShFiles, 5000);

const abuseBlockMap = new Map();
const ABUSE_LIMIT = 10;
const ABUSE_BLOCK_MINUTES = 30;

let ENABLE_RATE_LIMIT_BLOCK = true;

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
        entry.count = 0;
    }
    abuseBlockMap.set(ip, entry);
}

function logAbuse({ip, reason, req}) {
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
    if (ENABLE_RATE_LIMIT_BLOCK && isBlocked(ip)) {
        logAbuse({ip, reason: 'Forsøk fra blokkert IP', req});
        if (req && req.res) {
            req.res.status(429).send('Din IP er midlertidig blokkert pga. misbruk. Prøv igjen senere.');
        }
        return;
    }
    registerAbuse(ip);
    let status = '-';
    try {
        if (req && req.res && typeof req.res.statusCode !== 'undefined') {
            status = req.res.statusCode;
        }
    } catch {}
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

app.get('/api/stats', async (req, res) => {
    const uploadsPath = path.join(__dirname, 'public', 'uploads');
    const logPath = path.join(__dirname, 'upload_ip_log.txt');

    let videoCount = 0;
    try {
        const files = await fs.promises.readdir(uploadsPath);
        videoCount = files.filter(f => !f.startsWith('.')).length;
    } catch {}

    let uploadCount = 0;
    try {
        const data = await fs.promises.readFile(logPath, 'utf8');
        uploadCount = data.split('\n').filter(Boolean).length;
    } catch {}

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
            videoUrl: `/stream/${filename}`,
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
        const labels = Object.keys(perDay).sort();
        const counts = labels.map(l => perDay[l]);
        res.json({ labels, counts });
    });
});

const TEMP_UPLOADS = path.join(__dirname, 'public', 'temp_uploads');
if (!fs.existsSync(TEMP_UPLOADS)) {
    fs.mkdirSync(TEMP_UPLOADS, { recursive: true });
}

const upload = multer({
    dest: TEMP_UPLOADS,
    limits: { fileSize: 200 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'video/mp4',
            'video/webm',
            'video/ogg',
            'video/x-matroska',
            'video/quicktime',
            'video/x-msvideo',
            'video/x-flv',
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
        
            const ext = path.extname(file.originalname).toLowerCase();
            const forbiddenExts = ['.txt', '.md', '.csv', '.json', '.xml', '.sh', '.bat', '.exe', '.com', '.scr', '.pif', '.cmd', '.vbs', '.js', '.jar', '.php', '.py', '.pl', '.rb'];
            if (!allowedTypes.includes(file.mimetype) || forbiddenExts.includes(ext)) {
                logAbuse({ip, reason: `Blokkert fil: mimetype=${file.mimetype}, ext=${ext}`, req});
                if (file.path) {
                    fs.unlink(file.path, () => {});
                }
                return cb(new Error('Denne filtypen er ikke tillatt!'), false);
            }
            if (allowedTypes.includes('video/mp4') && ext === '.mp4') {
                const filePath = file.path;
                try {
                    const fd = fs.openSync(filePath, 'r');
                    const buffer = Buffer.alloc(12);
                    fs.readSync(fd, buffer, 0, 12, 0);
                    fs.closeSync(fd);
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

// Sikker streaming-route - ingen direkte tilgang til uploads-mappen
app.get('/stream/:filename', (req, res) => {
    const filename = sanitize(req.params.filename);
    if (!filename || filename !== req.params.filename) {
        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        if (ip && typeof ip === 'string' && ip.includes(',')) {
            const parts = ip.split(',');
            ip = parts[parts.length - 1].trim();
        }
        logAbuse({ip, reason: 'Ugyldig filnavn (path traversal/sanitizing)', req});
        return res.status(400).send('Ugyldig filnavn.');
    }
    
    const videoPath = path.join(__dirname, 'public', 'uploads', filename);
    
    fs.access(videoPath, fs.constants.F_OK, (err) => {
        if (err) {
            return res.status(404).send('Video ikke funnet');
        }
        
        const stat = fs.statSync(videoPath);
        const fileSize = stat.size;
        const range = req.headers.range;
        
        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(videoPath, { start, end });
            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'video/mp4',
            };
            res.writeHead(206, head);
            file.pipe(res);
        } else {
            const head = {
                'Content-Length': fileSize,
                'Content-Type': 'video/mp4',
            };
            res.writeHead(200, head);
            fs.createReadStream(videoPath).pipe(res);
        }
    });
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
    if (!allowedTypes.includes(ext.toLowerCase())) {
        fs.unlink(tempPath, () => {});
        logAbuse({ip, reason: `Ugyldig filtype: ${ext}`, req});
        return res.status(400).send('Kun video-filer er tillatt!');
    }
    const { exec } = require('child_process');
    const ffprobeCmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${tempPath}"`;
    
    try {
        const { stdout } = await new Promise((resolve, reject) => {
            exec(ffprobeCmd, { timeout: 30000 }, (error, stdout, stderr) => {
                if (error) {
                    let errorReason = 'Ukjent ffprobe-feil';
                    if (error.message.includes('Invalid data found')) {
                        errorReason = 'Ikke en gyldig mediefil';
                    } else if (error.message.includes('No such file')) {
                        errorReason = 'Fil ikke funnet';
                    } else if (error.signal === 'SIGTERM') {
                        errorReason = 'ffprobe timeout - fil for stor eller korrupt';
                    }
                    reject(new Error(errorReason));
                } else {
                    resolve({ stdout, stderr });
                }
            });
        });
        
        const mediaInfo = JSON.parse(stdout);
        const hasVideoStream = mediaInfo.streams && mediaInfo.streams.some(s => s.codec_type === 'video');
        
        if (!hasVideoStream) {
            fs.unlink(tempPath, () => {});
            logAbuse({ip, reason: 'Filen inneholder ingen video-stream', req});
            return res.status(400).send('Filen er ikke en gyldig video!');
        }
        
        const duration = parseFloat(mediaInfo.format.duration);
        if (!duration || duration < 0.1) {
            fs.unlink(tempPath, () => {});
            logAbuse({ip, reason: 'Video har ugyldig varighet', req});
            return res.status(400).send('Video-filen er korrupt eller ugyldig!');
        }
        const videoStream = mediaInfo.streams.find(s => s.codec_type === 'video');
        const fileSize = fs.statSync(tempPath).size;
        if (fileSize > 500 * 1024 * 1024) {
            fs.unlink(tempPath, () => {});
            logAbuse({ip, reason: `Fil for stor: ${(fileSize/1024/1024).toFixed(1)}MB`, req});
            return res.status(400).send('Video-fil kan ikke være større enn 500MB!');
        }
        
        if (duration > 1800) {
            fs.unlink(tempPath, () => {});
            logAbuse({ip, reason: `Video for lang: ${(duration/60).toFixed(1)} minutter`, req});
            return res.status(400).send('Video kan ikke være lenger enn 30 minutter!');
        }
        
        if (videoStream && (videoStream.width > 3840 || videoStream.height > 2160)) {
            fs.unlink(tempPath, () => {});
            logAbuse({ip, reason: `Oppløsning for høy: ${videoStream.width}x${videoStream.height}`, req});
            return res.status(400).send('Video-oppløsning kan ikke være høyere enn 4K!');
        }
        
        const format = mediaInfo.format;
        if (format.tags) {
            const suspiciousKeys = ['script', 'javascript', 'exec', 'command', 'shell'];
            const tagString = JSON.stringify(format.tags).toLowerCase();
            const hasSuspiciousTags = suspiciousKeys.some(key => tagString.includes(key));
            
            if (hasSuspiciousTags) {
                fs.unlink(tempPath, () => {});
                logAbuse({ip, reason: 'Mistenkelige metadata i video', req});
                return res.status(400).send('Video inneholder mistenkelige metadata!');
            }
        }
        
        const bitrate = parseInt(format.bit_rate);
        if (bitrate > 50000000) {
            fs.unlink(tempPath, () => {});
            logAbuse({ip, reason: `Bitrate for høy: ${(bitrate/1000000).toFixed(1)}Mbps`, req});
            return res.status(400).send('Video-bitrate er unormalt høy!');
        }
        
        const codecName = videoStream?.codec_name;
        const dangerousCodecs = ['rawvideo', 'zmbv', 'bintext'];
        if (codecName && dangerousCodecs.includes(codecName)) {
            fs.unlink(tempPath, () => {});
            logAbuse({ip, reason: `Farlig codec: ${codecName}`, req});
            return res.status(400).send('Video-codec er ikke tillatt av sikkerhetshensyn!');
        }
        
        const audioStream = mediaInfo.streams.find(s => s.codec_type === 'audio');
        
        const needsVideoConversion = videoStream && !['h264', 'vp8', 'vp9'].includes(videoStream.codec_name);
        const needsAudioConversion = audioStream && !['aac', 'mp3', 'vorbis', 'opus'].includes(audioStream.codec_name);
        
        if (needsVideoConversion || needsAudioConversion) {
            const convertedPath = tempPath + '_converted.mp4';
            
            let videoParams = needsVideoConversion ? '-c:v libx264 -profile:v baseline -level 3.0 -preset medium -crf 23 -pix_fmt yuv420p' : '-c:v copy';
            let audioParams = needsAudioConversion ? '-c:a aac -b:a 128k -ar 44100' : '-c:a copy';
            
            const convertCmd = `ffmpeg -i "${tempPath}" ${videoParams} ${audioParams} -movflags +faststart -f mp4 "${convertedPath}" -y`;
            
            try {
                await new Promise((resolve, reject) => {
                    exec(convertCmd, { timeout: 120000 }, (error, stdout, stderr) => {
                        if (error) reject(error);
                        else resolve({ stdout, stderr });
                    });
                });
                
                const validateCmd = `ffprobe -v quiet -print_format json -show_format "${convertedPath}"`;
                const { stdout: validateOutput } = await new Promise((resolve, reject) => {
                    exec(validateCmd, (error, stdout, stderr) => {
                        if (error) reject(error);
                        else resolve({ stdout, stderr });
                    });
                });
                
                const convertedInfo = JSON.parse(validateOutput);
                if (!convertedInfo.format || parseFloat(convertedInfo.format.duration) < 0.1) {
                    fs.unlink(convertedPath, () => {});
                    throw new Error('Konvertert fil er korrupt');
                }
                
                fs.unlinkSync(tempPath);
                fs.renameSync(convertedPath, tempPath);
                
            } catch (e) {
                fs.unlink(tempPath, () => {});
                fs.unlink(convertedPath, () => {});
                logAbuse({ip, reason: `Video-konvertering feilet: ${e.message}`, req});
                return res.status(400).send('Kunne ikke konvertere video til web-kompatibelt format!');
            }
        }
        
    } catch (e) {
        fs.unlink(tempPath, () => {});
        logAbuse({ip, reason: `ffprobe-feil: ${e.message}`, req});
        return res.status(400).send('Kunne ikke verifisere video-fil!');
    }

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
            url: `/stream/${newFilename}`
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
                deleteShFiles();
                if (err) return res.status(500).json({ error: 'Konvertering feilet' });
                res.json({ success: true, file: `/stream/${streamId}.mp4` });
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