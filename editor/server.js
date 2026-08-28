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
import { patchInlineStyle, patchCssRule, insertHtml, patchAttr, applyMotion, moveElement, removeElement, duplicateElement, linkAsset } from './lib/patch.js';
import { buildDesignSystem, saveTokens } from './lib/designsystem.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
// 어느 사이트를 다루는지는 editor.config.json 이 정한다 (경로를 코드에 박지 않는다)
const { PUBLIC, BLOCKS_DIR, CONFIG, blockUrl } = await import('./lib/config.js');
const PORT = Number(process.env.PORT) || 5180;
// 유저가 등록한 컴포넌트 — public/ 밖이라 배포되지 않고, 페이지끼리 함께 쓴다
const COMPONENTS_FILE = path.join(HERE, 'components.json');

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

/** 등록된 컴포넌트 읽기 (파일이 없거나 깨졌으면 빈 목록) */
async function readComponents() {
    try {
        const raw = await fsp.readFile(COMPONENTS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed.items) ? parsed.items : [];
    } catch { return []; }
}

/** 컴포넌트 저장 — 통째로 다시 쓴다 (사람이 읽을 일이 있어 들여쓰기 유지) */
async function writeComponents(items) {
    await fsp.writeFile(COMPONENTS_FILE, JSON.stringify({ items }, null, 2) + '\n', 'utf8');
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

        // ---------- 내 컴포넌트 (등록·조회·삭제) ----------
        if (pathname === '/__api/components' && req.method === 'GET') {
            return sendJson(res, 200, { items: await readComponents() });
        }
        if (pathname === '/__api/components' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req));
            const items = await readComponents();

            if (body.remove) {
                const next = items.filter(it => it.id !== body.remove);
                if (next.length === items.length) return sendJson(res, 404, { error: '없는 컴포넌트입니다.' });
                await writeComponents(next);
                return sendJson(res, 200, { ok: true, items: next });
            }

            const name = String(body.name || '').trim();
            // 마스터로 등록하면 CSS·JS 를 blocks/ 아래 '컴포넌트 하나 = 파일 하나'로 저장한다.
            // (common.css 에 몰아넣으면 쓰지도 않는 페이지까지 계속 받아 가고, 나중에 고치기 어렵다)
            let block = null;
            if (body.master) {
                const slug = String(body.slug || '').trim();
                if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
                    return sendJson(res, 400, { error: '블록 이름은 영문 소문자·숫자·하이픈만 됩니다.' });
                }
                await fsp.mkdir(BLOCKS_DIR, { recursive: true });
                block = { slug, css: null, js: null };
                if (body.css) {
                    await fsp.writeFile(path.join(BLOCKS_DIR, slug + '.css'), String(body.css).trim() + '\n', 'utf8');
                    block.css = blockUrl(slug + '.css');
                }
                if (body.js) {
                    await fsp.writeFile(path.join(BLOCKS_DIR, slug + '.js'), String(body.js).trim() + '\n', 'utf8');
                    block.js = blockUrl(slug + '.js');
                }
            }
            const html = String(body.html || '').trim();
            if (!name) return sendJson(res, 400, { error: '이름이 필요합니다.' });
            if (!html) return sendJson(res, 400, { error: '내용이 비어 있습니다.' });
            if (html.length > 200_000) return sendJson(res, 400, { error: '너무 큽니다 (200KB 초과).' });
            if (String(body.css || '').length > 400_000) return sendJson(res, 400, { error: 'CSS 가 너무 큽니다 (400KB 초과).' });

            // 같은 이름이면 덮어쓴다 (계속 다듬어 가며 쓰는 흐름)
            const id = body.id || 'c' + Date.now().toString(36);
            const item = {
                id, name, html,
                // 마스터면 CSS 는 파일로 나가 있으므로 사본을 들고 다니지 않는다
                block,
                css: body.master ? '' : String(body.css || ''),
                vars: Array.isArray(body.vars) ? body.vars.slice(0, 80) : [],
                note: String(body.note || '').slice(0, 80),
                sketch: Array.isArray(body.sketch) ? body.sketch.slice(0, 8) : [],
                needs: Array.isArray(body.needs) ? body.needs.slice(0, 60) : [],
                from: String(body.from || ''),
            };
            const at = items.findIndex(it => it.name === name);
            if (at >= 0) items[at] = { ...item, id: items[at].id };
            else items.push(item);
            await writeComponents(items);
            return sendJson(res, 200, { ok: true, items, saved: name, replaced: at >= 0 });
        }

        // 디자인 시스템 (tokens.css 파싱 + vibra/common 사용처 스캔). 표시 전용.
        if (pathname === '/__api/designsystem') {
            return sendJson(res, 200, buildDesignSystem());
        }

        // 디자인 시스템 저장 — :root(라이트) + .dark-mode(다크) 갱신 (백업 남김)
        if (pathname === '/__api/savetokens' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req));
            if (!body || typeof body.edits !== 'object') return sendJson(res, 400, { error: 'edits 없음' });
            try {
                return sendJson(res, 200, { ok: true, ...saveTokens(body.edits, body.darkEdits) });
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
                } else if (edit.kind === 'insert') {
                    const r = insertHtml(text, edit.path, edit.html, edit.position || 'after');
                    text = r.text;
                    applied.push({ kind: 'insert', position: edit.position, before: r.before, after: r.after });
                } else if (edit.kind === 'attr') {
                    const r = patchAttr(text, edit.path, edit.name, edit.value);
                    text = r.text;
                    applied.push({ kind: 'attr', name: edit.name, before: r.before, after: r.after });
                } else if (edit.kind === 'move') {
                    const r = moveElement(text, edit.path, edit.dir);
                    text = r.text;
                    applied.push({ kind: 'move', dir: edit.dir, before: r.before, after: r.after });
                } else if (edit.kind === 'link') {
                    const r = linkAsset(text, edit.assetKind, edit.url);
                    text = r.text;
                    applied.push({ kind: 'link', url: edit.url, before: r.added ? '(없음)' : '이미 연결됨', after: r.added ? '연결' : '그대로' });
                } else if (edit.kind === 'remove') {
                    const r = removeElement(text, edit.path);
                    text = r.text;
                    applied.push({ kind: 'remove', before: r.before, after: r.after });
                } else if (edit.kind === 'duplicate') {
                    const r = duplicateElement(text, edit.path);
                    text = r.text;
                    applied.push({ kind: 'duplicate', before: r.before, after: r.after });
                } else if (edit.kind === 'motion') {
                    const r = applyMotion(text, edit.path, edit.className, edit.css);
                    text = r.text;
                    applied.push({ kind: 'motion', name: edit.className, before: r.before, after: r.after });
                } else {
                    return sendJson(res, 400, { error: `알 수 없는 수정 방식: ${edit.kind}` });
                }
            }
            await fsp.writeFile(file, text, 'utf8');
            return sendJson(res, 200, { ok: true, applied });
        }

        // ---------- 실제 모습 (주입 없이 그대로) ----------
        // '브라우저에서 열기' 버튼이 쓰는 길. / 와 /index.html 은 에디터 화면이
        // 가로채기 때문에, 어떤 페이지든 확실히 원본으로 여는 경로를 따로 둔다.
        if (pathname.startsWith('/raw/')) {
            const file = safeJoin(PUBLIC, pathname.slice('/raw'.length));
            if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                return send(res, 404, '없는 페이지입니다: ' + pathname.slice('/raw'.length));
            }
            res.writeHead(200, {
                'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
                'Cache-Control': 'no-store',
            });
            return fs.createReadStream(file).pipe(res);
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
    import('node:child_process').then(({ exec }) => {
        // 앱 창으로 띄운다 — 주소창·탭·북마크가 없는 창 하나만 뜬다.
        // 크로미움 계열(Chrome·Edge·Brave)의 --app 기능이라, 없으면 기본 브라우저로 넘어간다.
        const APP_FLAG = `--app=${url} --window-size=1600,1000`;
        const candidates = process.platform === 'darwin' ? [
            `open -na "Google Chrome" --args ${APP_FLAG}`,
            `open -na "Microsoft Edge" --args ${APP_FLAG}`,
            `open -na "Brave Browser" --args ${APP_FLAG}`,
        ] : process.platform === 'win32' ? [
            `start "" chrome ${APP_FLAG}`,
            `start "" msedge ${APP_FLAG}`,
        ] : [
            `google-chrome ${APP_FLAG}`,
            `chromium ${APP_FLAG}`,
            `microsoft-edge ${APP_FLAG}`,
        ];
        const fallback = process.platform === 'win32' ? `start "" "${url}"`
            : process.platform === 'darwin' ? `open "${url}"`
                : `xdg-open "${url}"`;

        // 앞에서부터 하나씩 시도하고, 다 실패하면 그냥 기본 브라우저로 연다
        const tryNext = i => {
            if (i >= candidates.length) return exec(fallback);
            exec(candidates[i], err => { if (err) tryNext(i + 1); });
        };
        if (process.env.NO_APP_WINDOW) exec(fallback); else tryNext(0);
    });
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
