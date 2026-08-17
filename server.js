const http = require('http');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = 3000;
const KIRO_CLI = '/home/amit/.local/bin/kiro-cli';
const LOG_FILE = path.join(__dirname, 'debug.log');
const LOG_LEVEL = process.env.LOG_LEVEL || 'INFO'; // DEBUG, INFO, WARN, ERROR
const LOG_MAX_SIZE = 5 * 1024 * 1024; // 5MB
const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

// Current session ID — null means next request starts a new session
let sessionId = null;
let currentAgent = "";
var currentModel = "auto";

function log(level, msg, data) {
  if ((LOG_LEVELS[level] || 0) < (LOG_LEVELS[LOG_LEVEL] || 0)) return;
  var ts = new Date().toISOString();
  var entry = '[' + ts + '] [' + level + '] ' + msg + (data ? ' | ' + JSON.stringify(data) : '');
  console.log(entry);
  try {
    var stat = fs.statSync(LOG_FILE).size;
    if (stat > LOG_MAX_SIZE) {
      var bak = LOG_FILE + '.1';
      if (fs.existsSync(bak)) fs.unlinkSync(bak);
      fs.renameSync(LOG_FILE, bak);
    }
  } catch(e) {}
  fs.appendFileSync(LOG_FILE, entry + '\n');
}

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]|\x1B\[\?[0-9;]*[a-zA-Z]/g, '');
}

function extractResponse(raw) {
  let clean = stripAnsi(raw);
  log('DEBUG', 'After ANSI strip', { length: clean.length, first200: clean.slice(0, 200) });
  const bannerEnd = clean.lastIndexOf('How can I help?');
  if (bannerEnd !== -1) {
    clean = clean.slice(bannerEnd);
    clean = clean.replace(/^How can I help[^"\n]*"?\s*/, '');
  }
  clean = clean.replace(/^>\s*/, '');
  clean = clean.replace(/\s*\u25b8\s*Time:[\s\S]*$/, '');
  clean = clean.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '');
  return clean.trim();
}

function getSessionId() {
  return sessionId;
}

const MAX_BODY = 50 * 1024 * 1024;

const server = http.createServer((req, res) => {
  log('INFO', `${req.method} ${req.url}`);

  if (req.method === 'GET' && req.url === '/marked.min.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(fs.readFileSync(path.join(__dirname, 'marked.min.js')));
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/clear') {
    log('INFO', 'Session cleared', { oldSessionId: sessionId });
    sessionId = null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/set-session') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.sessionId) { sessionId = data.sessionId; log('INFO', 'Session set', { sessionId }); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/session-info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ active: !!sessionId, sessionId: sessionId }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { res.writeHead(413, { "Content-Type": "application/json" }); res.end(JSON.stringify({ success: false, error: "File too large" })); req.destroy(); return; }
      body += chunk;
    });
    req.on('end', () => {
      try {
        const { prompt, screenshot, file } = JSON.parse(body);
        log('INFO', 'Request', { prompt: prompt ? prompt.slice(0, 200) : null, hasScreenshot: !!screenshot, sessionId });

        if (!prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'prompt required' }));
        }

        let userMsg = prompt;
        let screenshotPath = null;

        if (file) {
          const filePath = '/tmp/kiro-upload-' + Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          var content = file.content; if (file.encoding === 'base64') { content = Buffer.from(file.content, 'base64'); } fs.writeFileSync(filePath, content);
          userMsg = prompt + "\n\nI have attached a file at " + filePath + " -- please read and analyze it.";
          screenshotPath = filePath; // reuse cleanup
          log('INFO', 'File saved', { path: filePath, size: file.content.length });
        } else if (screenshot) {
          screenshotPath = `/tmp/kiro-screenshot-${Date.now()}.png`;
          const base64 = screenshot.replace(/^data:image\/\w+;base64,/, '');
          fs.writeFileSync(screenshotPath, Buffer.from(base64, 'base64'));
          userMsg = `${prompt}\n\nI have saved a screenshot at ${screenshotPath} — please read this image file and analyze it.`;
          log('INFO', 'Screenshot saved', { path: screenshotPath, bytes: fs.statSync(screenshotPath).size });
        }
        var sid = getSessionId();
        var args = ['chat', userMsg, '--no-interactive', '--wrap', 'never', '--trust-all-tools'];
        if (sid) args.push('--resume-id', sid);
        if (currentAgent) args.push('--agent', currentAgent);
        if (currentModel && currentModel !== 'auto') args.push('--model', currentModel);
        log("DEBUG", "Spawning kiro-cli", { sid: sid, argCount: args.length });

        const startTime = Date.now();
        const proc = spawn(KIRO_CLI, args, {
          timeout: 120000,
          env: { ...process.env, TERM: 'dumb' }
        });

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => stdout += d.toString());
        proc.stderr.on('data', d => stderr += d.toString());

        proc.on('close', (code, signal) => {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          log('INFO', 'kiro-cli exited', { code, signal, elapsed: elapsed + 's', stdoutLen: stdout.length });
          if (stderr) log('WARN', 'stderr', { stderr: stderr.slice(0, 500) });
          if (screenshotPath) try { fs.unlinkSync(screenshotPath); } catch(e) {}

          const data = extractResponse(stdout);
          if (!sessionId) {
            try {
              var listOut = execSync(KIRO_CLI + " chat --list-sessions --format json 2>/dev/null", { timeout: 5000, env: { ...process.env, TERM: "dumb" } });
              var parsed = JSON.parse(listOut.toString());
              var latest = parsed[0] && parsed[0].sessions && parsed[0].sessions[0];
              if (latest) { sessionId = latest.sessionId; log("INFO", "Captured session from kiro", { sessionId: sessionId }); }
            } catch(e) {}
          }
          log('INFO', 'Response sent', { length: data.length, elapsed: elapsed + 's' });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, data }));
        });

        proc.on('error', (err) => {
          log('ERROR', 'spawn error', { error: err.message });
          if (screenshotPath) try { fs.unlinkSync(screenshotPath); } catch(e) {}
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        });
      } catch (e) {
        log('ERROR', 'Parse error', { error: e.message });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/whoami') {
    var name = "";
    try {
      var content = fs.readFileSync(path.join(process.env.HOME || "/home/amit", ".kiro/steering/environment.md"), "utf8");
      var m = content.match(/- Name: (.+)/);
      if (m) name = m[1].trim();
    } catch(e) {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ name: name }));
    return;
    }

  if (req.method === 'GET' && req.url === '/api/models') {
    try {
      var out = execSync(KIRO_CLI + ' chat --list-models --format json 2>/dev/null', { timeout: 5000, env: { ...process.env, TERM: 'dumb' } });
      var parsed = JSON.parse(out.toString());
      var models = (parsed.models || []).map(function(m){ return {id:m.model_id, name:m.model_name, cost:m.rate_multiplier}; });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: models }));
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: [] }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/set-model') {
    var body = '';
    req.on('data', function(c){ body += c; });
    req.on('end', function(){
      try { currentModel = JSON.parse(body).model || 'auto'; log('INFO','Model set',{model:currentModel}); } catch(e){}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/agents') {
    try {
      var out = execSync(KIRO_CLI + ' agent list 2>&1', { timeout: 5000, env: { ...process.env, TERM: 'dumb' } });
      var clean = stripAnsi(out.toString());
      var agents = [];
      var lines = clean.split(String.fromCharCode(10));
      for (var i = 0; i < lines.length; i++) {
        var m = lines[i].match(/^([* ])\s+([\w][-\w]*)\s+(?:Global|\(Built-in\))/);
        if (m && m[2] !== 'Workspace:' && m[2] !== 'Global:') agents.push({ name: m[2], active: m[1] === '*' });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: agents }));
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: [] }));
    }
    return;
  }


  if (req.method === 'POST' && req.url === '/api/set-agent') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        currentAgent = data.agent || '';
        log('INFO', 'Agent switched', { agent: currentAgent || 'default' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/sessions') {
    try {
      const out = execSync(KIRO_CLI + ' chat --list-sessions --format json 2>/dev/null', { timeout: 5000, env: { ...process.env, TERM: 'dumb' } });
      const data = JSON.parse(out.toString());
      const sessions = (data[0] && data[0].sessions || []).slice(0, 10).map(s => ({ id: s.sessionId, title: s.title, updated: s.updatedAt }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: sessions }));
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: [] }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => log('INFO', `Server started on http://localhost:${PORT}`));
