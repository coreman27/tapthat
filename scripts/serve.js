/* serve.js — zero-dependency static server for local testing on your iPhone.
 * Run: npm run serve  then open http://<your-mac-ip>:5173 in iPhone Safari.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const PORT = process.env.PORT || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json'
};

http.createServer(function (req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(root, path.normalize(urlPath));
  if (!filePath.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, function () {
  console.log('Serving DON\u2019T TAP THAT at http://localhost:' + PORT);
  console.log('On your iPhone (same Wi-Fi), open http://<your-mac-ip>:' + PORT);
});
