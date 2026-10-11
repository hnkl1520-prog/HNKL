// 헤드리스 크롬을 DevTools 프로토콜로 직접 조작하는 작은 도구 (외부 패키지 없음).
// 저장소 루트를 이 프로세스 안의 임시 서버로 열고, 끝나면 크롬·서버·임시 프로필을 모두 정리한다.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = { '.wasm':'application/wasm','.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.css': 'text/css', '.y4m': 'application/octet-stream' };

function serve() {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.resolve(ROOT, '.' + path.posix.normalize('/' + p));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

export async function launch({ flags = [], serveRoot = true } = {}) {
  const server = serveRoot ? await serve() : null;
  const origin = server ? `http://127.0.0.1:${server.address().port}` : null;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'om-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-extensions', '--mute-audio', ...flags, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const cleanup = () => {
    try { proc.kill('SIGKILL'); } catch (e) { /* */ }
    if (server) server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  };
  let wsUrl;
  try {
    wsUrl = await new Promise((resolve, reject) => {
      let buf = '';
      const t = setTimeout(() => reject(new Error('크롬이 시작되지 않음')), 60000);
      proc.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); resolve(m[1]); } });
      proc.on('exit', (c) => reject(new Error(`크롬 종료 ${c}`)));
    });
  } catch (e) {
    cleanup();  // 시작에 실패해도 프로세스·임시 프로필을 남기지 않음
    throw e;
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let nextId = 1;
  const waiting = new Map(), listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) { const { resolve, reject } = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
    else for (const l of listeners) l(msg);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  async function open(url, { width = 1280, height = 800, scale = 1 } = {}) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const logs = [];
    listeners.add((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.consoleAPICalled') logs.push(`[${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
      if (m.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
      if (m.method === 'Log.entryAdded') logs.push(`[${m.params.entry.level}] ${m.params.entry.text} ${m.params.entry.url || ''}`);
    });
    const s = (method, params) => send(method, params, sessionId);
    await s('Page.enable'); await s('Runtime.enable'); await s('Log.enable');
    await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
    const full = url.startsWith('http') || url.startsWith('file:') ? url : origin + url;
    await s('Page.navigate', { url: full });
    const page = {
      logs, send: s,
      async eval(expression, awaitPromise = true) {
        const r = await s('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      },
      async waitFor(expression, timeout = 30000, every = 250) {
        const t0 = Date.now();
        for (;;) {
          let v = null;
          try { v = await page.eval(expression); } catch (e) { /* 아직 로딩 중 */ }
          if (v) return v;
          if (Date.now() - t0 > timeout) throw new Error(`시간 초과: ${expression}`);
          await new Promise((r) => setTimeout(r, every));
        }
      },
      async screenshot(file, clip) {
        const r = await s('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
        return file;
      },
      async click(selector) {
        return page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
      },
      async key(key) {
        await s('Input.dispatchKeyEvent', { type: 'keyDown', key, text: key });
        await s('Input.dispatchKeyEvent', { type: 'keyUp', key });
      },
      close: () => send('Target.closeTarget', { targetId }),
    };
    return page;
  }

  async function close() {
    try { await send('Browser.close'); } catch (e) { /* 이미 닫힘 */ }
    try { ws.close(); } catch (e) { /* */ }
    await new Promise((r) => { if (proc.exitCode != null) r(); else { proc.on('exit', r); setTimeout(() => { proc.kill('SIGKILL'); r(); }, 3000); } });
    if (server) await new Promise((r) => server.close(r));
    fs.rmSync(profile, { recursive: true, force: true });
  }
  return { open, close, origin, send };
}
