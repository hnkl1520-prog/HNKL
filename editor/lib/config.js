// 에디터가 다루는 사이트의 위치를 한 곳에서 정한다.
// 코드 곳곳에 'public', 'tokens.css' 를 박아 두면 다른 사이트에 붙일 때 전부 찾아 고쳐야 한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EDITOR_DIR = path.resolve(HERE, '..');   // editor/
const REPO = path.resolve(EDITOR_DIR, '..');   // 저장소 루트

const DEFAULTS = {
    siteRoot: 'public',
    tokensFile: 'tokens.css',
    sharedCss: 'common.css',
    sharedJs: 'common.js',
    blocksDir: 'blocks',
    scan: [],
};

function load() {
    const file = path.join(EDITOR_DIR, 'editor.config.json');
    let user = {};
    try {
        user = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        if (e.code !== 'ENOENT') console.warn(`editor.config.json 을 읽지 못했습니다 (기본값 사용): ${e.message}`);
    }
    // '_' 로 시작하는 키는 사람이 읽는 설명이라 무시한다
    const clean = Object.fromEntries(Object.entries(user).filter(([k]) => !k.startsWith('_')));
    return { ...DEFAULTS, ...clean };
}

const cfg = load();

export const CONFIG = cfg;
export const PUBLIC = path.join(REPO, cfg.siteRoot);
export const TOKENS_FILE = path.join(PUBLIC, cfg.tokensFile);
export const SHARED_CSS = path.join(PUBLIC, cfg.sharedCss);
export const SHARED_JS = path.join(PUBLIC, cfg.sharedJs);
export const BLOCKS_DIR = path.join(PUBLIC, cfg.blocksDir);
/** 블록 파일을 페이지에서 부를 때 쓰는 URL (사이트 루트 기준) */
export const blockUrl = name => '/' + [cfg.blocksDir, name].join('/');
