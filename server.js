#!/usr/bin/env node
// Julpies House LAN server: shared named saves + (optionally) the built game. Node >= 18, no dependencies.
//
//   node server.js --dev             vite dev server on :4141 (proxying /api) + save API on :4142
//   node server.js [--port 4141]     serves dist/ and the save API on the same port
//
// Flags: --dev, --port <n> (game port: vite in --dev, static+API otherwise), --api-port <n> (--dev only),
//        --host <addr> (default 0.0.0.0), --saves <dir> (default ./saves)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// ---- args ---------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes('--' + name);
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith('--' + name + '='));
  return eq ? eq.slice(name.length + 3) : def;
};
const DEV = flag('dev');
const HOST = opt('host', '0.0.0.0');
const PORT = Number(opt('port', DEV ? 4141 : 4141));
const API_PORT = DEV ? Number(opt('api-port', 4142)) : PORT;
const SAVES_DIR = path.resolve(ROOT, opt('saves', 'saves'));
const DIST = path.join(ROOT, 'dist');
const MAX_BODY = 1024 * 1024;

fs.mkdirSync(SAVES_DIR, { recursive: true });

// ---- saves --------------------------------------------------------------------------------
const slugify = (name) => String(name).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
const fileFor = (name) => path.join(SAVES_DIR, slugify(name) + '.json');

function readSave(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}
function summary(s, file) {
  return {
    name: String(s.name || path.basename(file, '.json')),
    time: Number(s.time) || fs.statSync(file).mtimeMs,
    score: Number(s.score) || 0,
    mult: Number(s.mult) || 1,
    missions: Array.isArray(s.done) ? s.done.length : 0,
  };
}
function listSaves() {
  const out = [];
  for (const f of fs.readdirSync(SAVES_DIR)) {
    if (!f.endsWith('.json')) continue;
    const file = path.join(SAVES_DIR, f);
    const s = readSave(file);
    if (s && typeof s === 'object') out.push(summary(s, file));
  }
  return out.sort((a, b) => b.time - a.time);
}

function send(res, code, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('body too large'), { code: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'saves', name?]
  if (parts[1] === 'health' && parts.length === 2) return send(res, 200, { ok: true, saves: listSaves().length, time: Date.now() });
  if (parts[1] !== 'saves' || parts.length > 3) return send(res, 404, { error: 'not found' });

  if (parts.length === 2) {
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    return send(res, 200, listSaves());
  }

  let name;
  try { name = decodeURIComponent(parts[2]).trim(); } catch (e) { return send(res, 400, { error: 'bad name' }); }
  if (!name || name.length > 60) return send(res, 400, { error: 'name must be 1-60 characters' });
  const file = fileFor(name);

  if (req.method === 'GET') {
    if (!fs.existsSync(file)) return send(res, 404, { error: 'no such save' });
    return send(res, 200, fs.readFileSync(file, 'utf8'));
  }
  if (req.method === 'PUT') {
    let state;
    try { state = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.code === 413 ? 413 : 400, { error: e.code === 413 ? 'body too large' : 'invalid JSON' }); }
    if (!state || typeof state !== 'object' || Array.isArray(state)) return send(res, 400, { error: 'state must be an object' });
    state.name = name;
    state.time = Date.now();
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);
    return send(res, 200, summary(state, file));
  }
  if (req.method === 'DELETE') {
    if (!fs.existsSync(file)) return send(res, 404, { error: 'no such save' });
    fs.unlinkSync(file);
    return send(res, 200, { ok: true });
  }
  return send(res, 405, { error: 'method not allowed' });
}

// ---- static (production) -----------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json', '.wasm': 'application/wasm',
};
function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (e) { return send(res, 400, { error: 'bad path' }); }
  let file = path.normalize(path.join(DIST, rel));
  if (file !== DIST && !file.startsWith(DIST + path.sep)) return send(res, 403, { error: 'forbidden' });
  let st = null;
  try { st = fs.statSync(file); if (st.isDirectory()) { file = path.join(file, 'index.html'); st = fs.statSync(file); } } catch (e) { st = null; }
  if (!st) {
    if (path.extname(rel)) return send(res, 404, 'not found', { 'Content-Type': 'text/plain' });
    file = path.join(DIST, 'index.html'); // SPA fallback
    try { st = fs.statSync(file); } catch (e) { return send(res, 503, 'dist/ not found - run "npm run build" first (or use "npm run serve")', { 'Content-Type': 'text/plain' }); }
  }
  const ext = path.extname(file).toLowerCase();
  const immutable = file.includes(path.sep + 'assets' + path.sep) && /-[A-Za-z0-9_-]{8,}\./.test(path.basename(file));
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---- server -----------------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (DEV) return send(res, 404, { error: 'API only - open the game on the vite port' });
    return serveStatic(req, res, url);
  } catch (e) {
    console.error('request error:', e);
    if (!res.headersSent) send(res, 500, { error: 'server error' });
    else res.end();
  }
});

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}
function banner(port) {
  console.log(`\n  Julpies House ${DEV ? '(dev)' : ''}`);
  console.log(`  local:   http://localhost:${port}/`);
  for (const a of lanAddresses()) console.log(`  network: http://${a}:${port}/   <- open this on the iPad`);
  console.log(`  saves:   ${SAVES_DIR}  (shared by everyone on the LAN)\n`);
}

let vite = null;
function shutdown(code = 0) {
  if (vite && vite.exitCode === null && !vite.killed) vite.kill('SIGINT');
  server.close();
  setTimeout(() => process.exit(code), 300).unref();
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `port ${API_PORT} is already in use (try --${DEV ? 'api-' : ''}port <n>)` : e);
  shutdown(1);
});
server.listen(API_PORT, HOST, () => {
  if (!DEV) { banner(PORT); return; }
  console.log(`  save API on :${API_PORT}`);
  const localVite = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
  const viteArgs = ['--host', HOST, '--port', String(PORT)];
  const env = { ...process.env, API_PORT: String(API_PORT) };
  const [cmd, args] = fs.existsSync(localVite) ? [localVite, viteArgs] : ['npx', ['vite', ...viteArgs]];
  vite = spawn(cmd, args, { cwd: ROOT, env, stdio: 'inherit', shell: process.platform === 'win32' });
  vite.on('exit', (code, sig) => {
    console.log(`vite exited (${sig || code})`);
    server.close();
    setTimeout(() => process.exit(code || 0), 100).unref();
  });
  vite.on('error', (e) => { console.error('could not start vite:', e.message); shutdown(1); });
});
