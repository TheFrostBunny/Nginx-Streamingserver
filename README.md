# Nginx Streamingserver Dashboard

## Overview

The **Nginx Streamingserver Dashboard** is a real-time monitoring application that automatically displays streams being transmitted to the server.

This project uses **PM2** for process management to ensure smooth operation, reliability, and easy maintenance.

---

## Starting the Server

To start the Stream Dashboard using PM2 and assign it the name `stream-dashboard`, run:

```bash
PORT=3000 pm2 start server.js --name stream-dashboard
```

This allows you to manage the application easily using its assigned name.

---

## Managing the Server with PM2

Use the following commands to control the server instance:

```bash
pm2 restart stream-dashboard   # Restart the server
pm2 stop stream-dashboard      # Stop the server
pm2 delete stream-dashboard    # Remove the server from PM2 management
```

To view all running PM2 processes:

```bash
pm2 list
```

This provides an overview of all active applications.

---

## Restarting Nginx

If you update Nginx configuration files or modify reverse proxy settings, restart Nginx with:

```bash
sudo systemctl restart nginx
```

---

## Viewing Active Streams

Active streams are automatically displayed in the Stream Dashboard interface.

To verify that the backend process is running:

```bash
pm2 list
```

---

## Requirements

* Node.js
* PM2
* Nginx (if using reverse proxy)
* Linux server environment (recommended)

---

## Production Tips

Monitor logs in real time:

```bash
pm2 logs stream-dashboard
```

Enable PM2 to start on system boot:

```bash
pm2 startup
pm2 save
```

Ensure port `3000` is open or properly proxied via Nginx.

---

## Sette opp Nginx

For å bruke denne dashbord-løsningen sammen med Nginx, må du konfigurere Nginx til å fungere både som reverse proxy for Node.js-applikasjonen og for å levere HLS-strømmer.

### Eksempel på Nginx-konfigurasjon

Legg til følgende i din `nginx.conf` (eller bruk filen i `nginx/nginx.conf` i prosjektet):

```nginx
http {
	server {
		listen 80;

		# Node.js Dashboard
		location / {
			proxy_pass http://localhost:3000;
			proxy_http_version 1.1;
			proxy_set_header Upgrade $http_upgrade;
			proxy_set_header Connection 'upgrade';
			proxy_set_header Host $host;
		}

		# Video-levering (HLS)
		location /hls {
			root /var/www/html/stream;
			add_header 'Access-Control-Allow-Origin' '*' always;
			add_header 'Cache-Control' 'no-cache';
			types {
				application/vnd.apple.mpegurl m3u8;
				video/mp2t ts;
			}
		}
	}
}
```

### RTMP-modul for streaming

Hvis du skal bruke Nginx til å motta og videresende RTMP-strømmer, må du også ha RTMP-modulen aktivert. Eksempel på RTMP-oppsett:

```nginx
rtmp {
	server {
		listen 1935;
		chunk_size 4000;

		application live {
			live on;
			record off;

			hls on;
			hls_path /var/www/html/stream/hls;
			hls_fragment 4s;
			hls_playlist_length 20s;
			hls_cleanup on;
			hls_continuous off;
			hls_fragment_naming sequential;
		}
	}
}
```

### Starte og restarte Nginx

Etter å ha endret konfigurasjonen, start eller restart Nginx:

```bash
sudo systemctl restart nginx
```

Sjekk at Nginx kjører:

```bash
sudo systemctl status nginx
```

---
