// HNKL 로컬 편집 서버
//
// 하는 일 3가지
//   1. 에디터 화면(app/)을 띄운다
//   2. public/ 을 그대로 서빙하되, HTML을 보낼 때만 편집용 스크립트를 끼워 넣는다
//      → 원본 파일에는 에디터 흔적이 전혀 남지 않는다. 배포 걱정 없음.
//   3. 화면에서 고친 값을 원본 파일에 저장한다
//
// 실행: npm start   (기본 http://localhost:5180)

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchInlineStyle, patchCssRule } from './lib/patch.js';
import { buildDesignSystem, saveTokens } from './lib/designsystem.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 5180;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
    '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
    '.ico': 'image/x-icon',
};

const send = (res, code, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
};
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj), MIME['.json']);

/** 경로가 base 안에 있는지 확인 (디렉터리 탈출 차단) */
function safeJoin(base, rel) {
    const target = path.resolve(base, '.' + path.posix.normalize('/' + rel));
    if (target !== base && !target.startsWith(base + path.sep)) return null;
    return target;
}

/** public/ 안의 편집 대상 HTML 목록 */
async function listPages() {
    const out = [];
    async function walk(dir) {
        for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) await walk(full);
            else if (entry.name.endsWith('.html')) {
                const rel = path.relative(PUBLIC, full).split(path.sep).join('/');
                const stat = await fsp.stat(full);
                const parts = rel.split('/');
                const base = parts.at(-1).replace(/\.html$/, '');
                // 이 저장소 규칙: 폴더명과 파일명이 같으면 그 폴더의 '본 페이지'
                const isMain = parts.length > 1 && parts.at(-2) === base;
                // '_' 로 시작하면 임시/실험용
                const isScratch = base.startsWith('_');
                out.push({ rel, size: stat.size, mtime: stat.mtimeMs, isMain, isScratch });
            }
        }
    }
    await walk(PUBLIC);
    // 본 페이지 → 그 외 → 임시 파일 순, 그 안에서 works/projects 우선
    out.sort((a, b) => {
        const rank = p => (p.isScratch ? 2 : p.isMain ? 0 : 1);
        const area = p => p.rel.startsWith('works/projects/') ? 0 : p.rel.startsWith('works') ? 1 : 2;
        return rank(a) - rank(b) || area(a) - area(b) || a.rel.localeCompare(b.rel);
    });
    return out;
}

/** 미리보기용 HTML에 편집 브리지를 주입 */
function injectBridge(html, relPath) {
    const tag = `<script src="/__editor/bridge.js" data-page="${relPath}" defer></script>`;
    if (html.includes('</body>')) return html.replace('</body>', `${tag}\n</body>`);
    return html + tag;
}

async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);

    try {
        // ---------- 에디터 화면 ----------
        if (pathname === '/' || pathname === '/index.html') {
            return send(res, 200, await fsp.readFile(path.join(HERE, 'app/index.html')), MIME['.html']);
        }
        if (pathname.startsWith('/__app/')) {
            const f = safeJoin(path.join(HERE, 'app'), pathname.slice('/__app'.length));
            if (!f || !fs.existsSync(f)) return send(res, 404, 'not found');
            return send(res, 200, await fsp.readFile(f), MIME[path.extname(f)] || 'application/octet-stream');
        }
        if (pathname === '/__editor/bridge.js') {
            return send(res, 200, await fsp.readFile(path.join(HERE, 'inject/bridge.js')), MIME['.js']);
        }

        // ---------- API ----------
        if (pathname === '/__api/pages') {
            return sendJson(res, 200, { pages: await listPages() });
        }

        // 디자인 시스템 (tokens.css 파싱 + vibra/common 사용처 스캔). 표시 전용.
        if (pathname === '/__api/designsystem') {
            return sendJson(res, 200, buildDesignSystem());
        }

        // 디자인 시스템 저장 — tokens.css 의 :root 값만 갱신 (백업 남김)
        if (pathname === '/__api/savetokens' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req));
            if (!body || typeof body.edits !== 'object') return sendJson(res, 400, { error: 'edits 없음' });
            try {
                return sendJson(res, 200, { ok: true, ...saveTokens(body.edits) });
            } catch (e) {
                return sendJson(res, 500, { error: e.message });
            }
        }

        if (pathname === '/__api/patch' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req));
            const { page, edits } = body;
            const file = safeJoin(PUBLIC, page || '');
            if (!file || !fs.existsSync(file)) return sendJson(res, 400, { error: '파일을 찾을 수 없습니다.' });

            let text = await fsp.readFile(file, 'utf8');
            const applied = [];
            for (const edit of edits) {
                if (edit.kind === 'inline') {
                    const r = patchInlineStyle(text, edit.path, edit.changes);
                    text = r.text;
                    applied.push({ kind: 'inline', before: r.before, after: r.after });
                } else if (edit.kind === 'css') {
                    const r = patchCssRule(text, edit.selector, edit.prop, edit.value);
                    text = r.text;
                    applied.push({ kind: 'css', selector: edit.selector, prop: edit.prop, before: r.before, after: r.after });
                } else {
                    return sendJson(res, 400, { error: `알 수 없는 수정 방식: ${edit.kind}` });
                }
            }
            await fsp.writeFile(file, text, 'utf8');
            return sendJson(res, 200, { ok: true, applied });
        }

        // ---------- 미리보기 (public/ 서빙 + 주입) ----------
        if (pathname.startsWith('/preview/')) {
            const rel = pathname.slice('/preview'.length);
            const file = safeJoin(PUBLIC, rel);
            if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                return send(res, 404, '미리보기 대상을 찾을 수 없습니다: ' + rel);
            }
            const ext = path.extname(file);
            if (ext === '.html') {
                const html = await fsp.readFile(file, 'utf8');
                const relPage = path.relative(PUBLIC, file).split(path.sep).join('/');
                return send(res, 200, injectBridge(html, relPage), MIME['.html']);
            }
            res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            return fs.createReadStream(file).pipe(res);
        }

        // 미리보기 페이지가 '/common.css' 같은 루트 경로를 참조할 때를 위한 대비
        {
            const file = safeJoin(PUBLIC, pathname);
            if (file && fs.existsSync(file) && !fs.statSync(file).isDirectory()) {
                res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
                return fs.createReadStream(file).pipe(res);
            }
        }

        send(res, 404, 'not found: ' + pathname);
    } catch (err) {
        console.error(err);
        sendJson(res, 500, { error: err.message });
    }
});

const URL_ = `http://localhost:${PORT}`;

/** 기본 브라우저로 열기 (NO_OPEN=1 이면 건너뜀) */
function openBrowser(url) {
    if (process.env.NO_OPEN) return;
    const cmd = process.platform === 'win32' ? `start "" "${url}"`
        : process.platform === 'darwin' ? `open "${url}"`
            : `xdg-open "${url}"`;
    import('node:child_process').then(({ exec }) => exec(cmd));
}

server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
        console.log(`\n  에디터가 이미 켜져 있습니다. 브라우저만 엽니다.`);
        console.log(`  ${URL_}\n`);
        openBrowser(URL_);
        // 창이 바로 닫히지 않게 잠깐 둔다
        setTimeout(() => process.exit(0), 1500);
        return;
    }
    console.error(err);
    process.exit(1);
});

server.listen(PORT, () => {
    console.log(`\n  HNKL 에디터`);
    console.log(`  ${URL_}\n`);
    console.log(`  대상 폴더: ${PUBLIC}`);
    console.log(`  (원본 파일에는 편집 스크립트가 저장되지 않습니다)`);
    console.log(`\n  끄려면 이 창을 닫거나 Ctrl+C\n`);
    openBrowser(URL_);
});
