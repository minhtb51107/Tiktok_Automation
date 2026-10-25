import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const host = '127.0.0.1';
const port = Number(process.env.PREVIEW_PORT ?? 4173);
const projectRoot = resolve(import.meta.dirname, '..');
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
};

const safeFile = (root, relativePath) => {
  const candidate = resolve(root, relativePath);
  const rootPrefix = `${root}${sep}`.toLocaleLowerCase();
  return candidate.toLocaleLowerCase().startsWith(rootPrefix) ? candidate : null;
};

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', `http://${host}:${port}`).pathname;
  let filePath = null;
  if (pathname === '/') {
    filePath = resolve(projectRoot, 'preview', 'index.html');
  } else if (
    pathname === '/app.js' ||
    pathname === '/app.js.map' ||
    pathname === '/app.css' ||
    pathname === '/app.css.map'
  ) {
    filePath = safeFile(resolve(projectRoot, 'preview-dist'), pathname.slice(1));
  } else if (pathname.startsWith('/fixtures/')) {
    filePath = safeFile(resolve(projectRoot, 'public'), pathname.slice(1));
  }

  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  const size = statSync(filePath).size;
  const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  const commonHeaders = {
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'content-type': mimeTypes[extname(filePath)] ?? 'application/octet-stream',
  };
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= size) {
      response.writeHead(416, { 'content-range': `bytes */${size}` });
      response.end();
      return;
    }
    response.writeHead(206, {
      ...commonHeaders,
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${size}`,
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(filePath, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { ...commonHeaders, 'content-length': size });
  if (request.method === 'HEAD') response.end();
  else createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
  console.log(`Preview server listening on http://${host}:${port}`);
});
