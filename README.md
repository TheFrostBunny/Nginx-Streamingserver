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
