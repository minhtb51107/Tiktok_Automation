// Explicitly launched local-only HTTPS callback bridge. Never starts Studio or a tunnel.
const https = require('node:https'),
  http = require('node:http'),
  fs = require('node:fs');
function allowed(req, host) {
  try {
    const u = new URL(req.url, 'https://invalid.test');
    return (
      req.method === 'GET' &&
      req.headers.host === host &&
      req.url.length <= 16384 &&
      [
        '/api/studio/threads/oauth/login',
        '/api/studio/threads/oauth/callback',
      ].includes(u.pathname)
    );
  } catch {
    return false;
  }
}
function handler(host, backendPort) {
  return (req, res) => {
    if (!allowed(req, host)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('OAuth route unavailable');
      return;
    }
    const state = String(req.headers.cookie || '').match(
      /(?:^|;)\s*(studio_threads_state=[a-f0-9]{64})(?:;|$)/,
    )?.[1];
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: backendPort,
        path: req.url,
        method: 'GET',
        headers: { host, ...(state ? { cookie: state } : {}) },
      },
      (r) => {
        const headers = {};
        for (const k of [
          'content-type',
          'location',
          'set-cookie',
          'cache-control',
          'referrer-policy',
        ])
          if (r.headers[k]) headers[k] = r.headers[k];
        res.writeHead(r.statusCode || 502, headers);
        r.pipe(res);
      },
    );
    upstream.setTimeout(75000, () => upstream.destroy());
    upstream.on('error', () => {
      if (!res.headersSent)
        res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(
        'OAuth backend unavailable; no credential diagnostics are exposed',
      );
    });
    req.on('aborted', () => upstream.destroy());
    upstream.end();
  };
}
if (require.main === module) {
  require('dotenv/config');
  try {
    const u = new URL(process.env.THREADS_REDIRECT_URI || ''),
      port = Number(u.port || 443),
      backendPort = Number(process.env.PORT || 3000);
    if (
      u.protocol !== 'https:' ||
      u.pathname !== '/api/studio/threads/oauth/callback' ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      !u.hostname.endsWith('.test') ||
      !Number.isInteger(backendPort) ||
      backendPort < 1 ||
      backendPort > 65535
    )
      throw Error();
    const cert = fs.readFileSync(
        process.env.THREADS_TLS_CERT || '.studio-data/threads-api/tls/cert.pem',
      ),
      key = fs.readFileSync(
        process.env.THREADS_TLS_KEY || '.studio-data/threads-api/tls/key.pem',
      );
    const server = https.createServer(
      { cert, key },
      handler(u.host, backendPort),
    );
    server.on('error', () => {
      process.stderr.write(
        'OAuth HTTPS proxy could not listen. Existing processes are untouched.\n',
      );
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () =>
      process.stdout.write(
        'Local OAuth HTTPS bridge ready. Only login/callback GET routes are forwarded.\n',
      ),
    );
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.on(signal, () => server.close());
  } catch {
    process.stderr.write(
      'BLOCKED_AUTH: configure the .test callback and locally trusted TLS cert/key first. No TLS material was installed or downloaded.\n',
    );
    process.exitCode = 1;
  }
}
module.exports = { allowed, handler };
