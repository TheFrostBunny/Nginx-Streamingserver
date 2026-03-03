## Start server with PM2 as 'stream-dashboard'

To start your server with PM2 and give it the name `stream-dashboard`, use:

```
PORT=3000 pm2 start server.js --name stream-dashboard
```

This will let you manage it by name:

```
pm2 restart stream-dashboard
pm2 stop stream-dashboard
pm2 delete stream-dashboard
```
## Restart nginx (if needed)

If you need to reload or restart the nginx web server (for example, after changing nginx config or reverse proxy settings), run:

```
sudo systemctl restart nginx
```

cmd: 
pm2 list for å se hvilken server som er aktiv


