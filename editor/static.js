// HNKL 정적 미리보기 서버
//
// public/ 을 있는 그대로 서빙한다. 에디터 화면도, 편집 스크립트 주입도 없다.
// 배포된 사이트와 똑같은 상태로 홈페이지를 확인할 때 쓴다.
//
// 실행: npm run static   (기본 http://localhost:8000)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(path.resolve(HERE, '..'), 'public');
const PORT = Number(process.env.PORT) || 8000;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
    '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
    '.ico': 'image/x-icon', '.glb': 'model/gltf-binary',
};

/** 경로가 base 안에 있는지 확인 (디렉터리 탈출 차단) */
function safeJoin(base, rel) {
    const target = path.resolve(base, '.' + path.posix.normalize('/' + rel));
    if (target !== base && !target.startsWith(base + path.sep)) return null;
    return target;
}

const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
    let file = safeJoin(PUBLIC, pathname);

    // 디렉터리면 index.html 을 찾는다 (Firebase Hosting 과 같은 동작)
    if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        file = path.join(file, 'index.html');
    }

    // 없는 주소는 404.html 로 (배포 환경과 맞춘다)
    if (!file || !fs.existsSync(file)) {
        const notFound = path.join(PUBLIC, '404.html');
        res.writeHead(404, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
        return fs.existsSync(notFound)
            ? fs.createReadStream(notFound).pipe(res)
            : res.end('not found: ' + pathname);
    }

    res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
});

server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
        console.log(`\n  ${PORT} 포트가 이미 쓰이고 있습니다. http://localhost:${PORT}\n`);
        return process.exit(0);
    }
    console.error(err);
    process.exit(1);
});

server.listen(PORT, () => {
    console.log(`\n  HNKL 홈페이지 (원본 그대로)`);
    console.log(`  http://localhost:${PORT}\n`);
    console.log(`  대상 폴더: ${PUBLIC}`);
});
