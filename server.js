#!/usr/bin/env node
'use strict';

const http = require('http');
const path = require('path');
const fs   = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');

const PORT       = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CAP_DIR    = path.join(PUBLIC_DIR, 'captures');
const INDEX_HTML = path.join(__dirname, 'public', 'index.html');
const CLI        = path.join(__dirname, 'index.js');

fs.mkdirSync(CAP_DIR, { recursive: true });

// ─── helpers ──────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

const MIME = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webm': 'video/webm',
  '.mp4':  'video/mp4',
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
};

// ─── server ───────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // POST /capture
  if (req.method === 'POST' && url.pathname === '/capture') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }

    const { url: targetUrl, mode = 'tour', device = 'desktop', flow } = body;
    if (!targetUrl) return json(res, 400, { error: 'url is required' });

    const id     = crypto.randomBytes(6).toString('hex');
    const outDir = path.join(CAP_DIR, id);
    fs.mkdirSync(outDir, { recursive: true });

    const args = [
      CLI, targetUrl,
      '--mode',   mode,
      '--device', device,
      '--out',    outDir,
    ];

    if (mode === 'reel' || mode === 'flow') {
      const flowPath = flow
        ? path.resolve(flow)
        : path.join(__dirname, 'flows', 'eightfang.json'); // fallback example
      args.push('--flow', flowPath);
    }

    console.log(`[${id}] capture ${targetUrl} mode=${mode} device=${device}`);

    // Stream logs back via SSE
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });

    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const proc = spawn(process.execPath, args);

    proc.stdout.on('data', d => {
      for (const line of d.toString().split('\n').filter(Boolean))
        send('log', { line });
    });
    proc.stderr.on('data', d => {
      for (const line of d.toString().split('\n').filter(Boolean))
        send('log', { line });
    });

    proc.on('close', code => {
      if (code !== 0) {
        send('done', { error: `Process exited with code ${code}` });
      } else {
        const files = fs.readdirSync(outDir).map(f => `/captures/${id}/${f}`);
        send('done', { files });
      }
      res.end();
    });

    return;
  }

  // GET /captures/:id/:file  — serve output files
  if (req.method === 'GET' && url.pathname.startsWith('/captures/')) {
    const rel  = url.pathname.slice(1); // captures/id/file
    const file = path.join(PUBLIC_DIR, rel);
    const ext  = path.extname(file);
    return serveFile(res, file, MIME[ext] || 'application/octet-stream');
  }

  // GET / — serve UI
  if (req.method === 'GET' && url.pathname === '/') {
    return serveFile(res, INDEX_HTML, 'text/html');
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, () => {
  console.log(`capture server  http://localhost:${PORT}`);
});
