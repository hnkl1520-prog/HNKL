// 실제 작업 페이지를 대상으로 patch 로직을 검증한다.
// 원본은 절대 열어서 쓰지 않는다 — 임시 폴더로 '복사'한 뒤 그 복사본만 다룬다.
// 실행: node lib/realfile.test.js  [대상 html 경로]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'parse5';
import { patchCssRule, patchInlineStyle } from './patch.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const TARGET = process.argv[2] || path.join(ROOT, 'public/works/projects/vibra/vibra.html');

if (!fs.existsSync(TARGET)) {
    console.error(`대상 파일이 없습니다: ${TARGET}`);
    process.exit(1);
}

// --- 복사본 만들기 (원본 보호) ---
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hnkl-patch-test-'));
const FIXTURE = path.join(workDir, path.basename(TARGET));
fs.copyFileSync(TARGET, FIXTURE);
console.log(`대상 : ${path.relative(ROOT, TARGET)}`);
console.log(`복사본: ${FIXTURE}\n`);

const src = fs.readFileSync(FIXTURE, 'utf8');
const srcLines = src.split('\n');

let pass = 0, fail = 0;
const ok = m => { pass++; console.log(`  OK   ${m}`); };
const no = m => { fail++; console.log(`  FAIL ${m}`); };

function changedLines(a, b) {
    const A = a.split('\n'), B = b.split('\n');
    const out = [];
    for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) out.push(i + 1);
    return out;
}

// --- 문서 순회 도구 (브라우저와 같은 규칙: 요소 노드만 센다) ---
const doc = parse(src, { sourceCodeLocationInfo: true });
const html = doc.childNodes.find(n => n.nodeName === 'html');
const isEl = n => n.nodeName && !n.nodeName.startsWith('#');

function pathTo(target) {
    let found = null;
    (function walk(node, trail) {
        if (found) return;
        (node.childNodes || []).filter(isEl).forEach((kid, i) => {
            if (found) return;
            const next = [...trail, i];
            if (kid === target) { found = next; return; }
            walk(kid, next);
        });
    })(html, []);
    return found;
}
function findFirst(pred) {
    let hit = null;
    (function walk(node) {
        if (hit) return;
        for (const kid of (node.childNodes || []).filter(isEl)) {
            if (hit) return;
            if (pred(kid)) { hit = kid; return; }
            walk(kid);
        }
    })(html);
    return hit;
}
const attr = (el, n) => (el.attrs || []).find(a => a.name === n);
const hasClass = (el, c) => {
    const a = attr(el, 'class');
    return !!a && a.value.split(/\s+/).includes(c);
};

// ---------------------------------------------------------------
console.log('=== CSS 규칙 수정 ===');
// 대상 파일에 실제로 존재하는 선택자만 고른다
const cssCases = [
    ['.vb-group__head--lead', 'margin-bottom', '48px'],
    ['.aff-kw-card', 'min-width', 'calc(120px * var(--vb-s))'],
    ['.vb-info-col', 'max-width', 'calc(360px * var(--vb-s))'],
    ['.sky-inter__caption', 'font-size', '15px'],
    ['.bg-arrow svg', 'width', 'calc(18px * var(--vb-s))'],
];
let cssRan = 0;
for (const [sel, prop, val] of cssCases) {
    let r;
    try { r = patchCssRule(src, sel, prop, val); }
    catch { console.log(`  --   ${sel} { ${prop} } 없음, 건너뜀`); continue; }
    cssRan++;
    const ch = changedLines(src, r.text);
    if (ch.length === 1) ok(`${sel} { ${prop} }  "${r.before}" -> "${r.after}"  (${ch[0]}행)`);
    else no(`${sel} { ${prop} }  변경 줄이 ${ch.length}개 (기대 1) → ${ch.slice(0, 5)}`);
}
if (!cssRan) no('CSS 시험 케이스가 하나도 실행되지 않음');

// ---------------------------------------------------------------
console.log('\n=== 인라인 style 수정 ===');
const withStyle = findFirst(el => {
    const a = attr(el, 'style');
    return a && a.value.includes('margin-bottom');
});
if (withStyle) {
    const p = pathTo(withStyle);
    const r = patchInlineStyle(src, p, { 'margin-bottom': '99px' });
    const ch = changedLines(src, r.text);
    if (ch.length === 1 && r.text.includes('margin-bottom: 99px')) ok(`기존 style 수정 <${withStyle.nodeName}> (${ch[0]}행)`);
    else no(`기존 style 수정: 변경 줄 ${ch.length}개`);
} else console.log('  --   style에 margin-bottom 가진 요소 없음, 건너뜀');

const plain = findFirst(el => hasClass(el, 'aff-kw-card')) || findFirst(el => el.nodeName === 'p' && !attr(el, 'style'));
if (plain) {
    const p = pathTo(plain);
    const r = patchInlineStyle(src, p, { padding: '10px' });
    const ch = changedLines(src, r.text);
    if (ch.length === 1 && r.text.includes('style="padding: 10px"')) ok(`style 신규 추가 <${plain.nodeName}> (${ch[0]}행)`);
    else no(`style 신규 추가: 변경 줄 ${ch.length}개`);
} else console.log('  --   style 없는 요소를 못 찾음, 건너뜀');

if (withStyle) {
    const p = pathTo(withStyle);
    let cur = src;
    cur = patchInlineStyle(cur, p, { 'margin-top': '4px' }).text;
    cur = patchInlineStyle(cur, p, { 'margin-left': '6px' }).text;
    if (cur.includes('margin-top: 4px') && cur.includes('margin-left: 6px')) ok('연속 수정이 누적됨');
    else no('연속 수정 누적 실패');
}

// ---------------------------------------------------------------
console.log('\n=== 파일 무결성 ===');
{
    const r = patchCssRule(src, '.vb-info-col', 'max-width', 'calc(360px * var(--vb-s))');
    if (r.text.split('\n').length === srcLines.length) ok(`줄 수 유지 (${srcLines.length}행)`);
    else no(`줄 수 변화: ${srcLines.length} -> ${r.text.split('\n').length}`);

    // 실제로 복사본에 써보고 다시 읽어 확인
    fs.writeFileSync(FIXTURE, r.text, 'utf8');
    const back = fs.readFileSync(FIXTURE, 'utf8');
    if (back === r.text) ok('복사본에 저장 후 재읽기 일치');
    else no('저장/재읽기 불일치');

    // 저장된 파일이 여전히 파싱 가능한 정상 HTML인지
    try {
        const d2 = parse(back);
        const h2 = d2.childNodes.find(n => n.nodeName === 'html');
        if (h2) ok('저장 후에도 정상 HTML로 파싱됨');
        else no('저장 후 html 요소를 못 찾음');
    } catch (e) { no(`저장 후 파싱 실패: ${e.message}`); }
}

console.log(`\n결과: 통과 ${pass} / 실패 ${fail}`);
console.log(`(원본 ${path.relative(ROOT, TARGET)} 은 열어서 읽기만 했고, 수정은 복사본에서만 이뤄졌습니다)\n`);

fs.rmSync(workDir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
