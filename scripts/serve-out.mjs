// Minimal static file server for the exported site in ./out.
// Used for "npm start" / "npm run preview" and by the end-to-end tests so they run against the
// production build rather than the dev server.  Usage: node scripts/serve-out.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'out');
const port = Number(process.argv[2] || process.env.PORT || 3000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('out/index.html not found. Run "npm run build" first.');
  process.exit(1);
}

http
  .createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      let target = file;
      if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        const withHtml = target + '.html';
        target = fs.existsSync(withHtml) ? withHtml : path.join(root, '404.html');
        if (target.endsWith('404.html')) res.statusCode = 404;
      }
      const type = TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
      res.setHeader('Content-Type', type);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      fs.createReadStream(target).pipe(res);
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  })
  .listen(port, () => console.log(`Serving ./out at http://localhost:${port}`));
