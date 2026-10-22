const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = 3000;
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.txd': 'application/octet-stream',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Access-Control-Allow-Origin', '*');

  let reqUrl = req.url.split('?')[0];
  if (reqUrl === '/') reqUrl = '/index.html';

  // Proxy game asset streams from CDN
  if (reqUrl.startsWith('/assets/classic/game/') || reqUrl.startsWith('/assets/classic/localization/')) {
    const remoteUrl = 'https://gta.rabisco.net' + req.url;
    const options = {
      method: req.method,
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        'Accept': req.headers['accept'] || '*/*',
        ...(req.headers['range'] ? { 'Range': req.headers['range'] } : {})
      }
    };
    
    const proxyReq = https.request(remoteUrl, options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        ...proxyRes.headers,
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
        'access-control-allow-origin': '*'
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      res.statusCode = 502;
      res.end('Proxy Error: ' + err.message);
    });

    req.pipe(proxyReq);
    return;
  }

  const filePath = path.join(PUBLIC_DIR, reqUrl);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.statusCode = 404;
    res.end('404 Not Found: ' + reqUrl);
  }
});

server.listen(PORT, () => {
  console.log(`🎮 Yerel GTA Web Sunucusu Hazır: http://localhost:${PORT}`);
});
