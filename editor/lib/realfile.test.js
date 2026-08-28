// 실제 작업 페이지를 대상으로 patch 로직을 검증한다.
// 원본은 절대 열어서 쓰지 않는다 — 임시 폴더로 '복사'한 뒤 그 복사본만 다룬다.
// 실행: node lib/realfile.test.js  [대상 html 경로]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'parse5';
import { patchCssRule, patchInlineStyle, moveElement, removeElement, duplicateElement, appendCss } from './patch.js';

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
console.log('\n=== 섹션 이동 ===');
{
    // main 직속 블록의 순서를 읽는다 (bridge/patch 와 같은 규칙: 보이지 않는 태그는 제외)
    const SKIP = /^(script|style|link|template|noscript)$/i;
    const isEl = n => /^[a-z]/i.test(n.nodeName) && !n.nodeName.startsWith('#');
    const order = t => {
        const d = parse(t);
        const h = d.childNodes.find(n => n.nodeName === 'html');
        const b = h.childNodes.find(n => n.nodeName === 'body');
        const m = b.childNodes.find(n => n.nodeName === 'main');
        if (!m) return null;
        return m.childNodes.filter(n => isEl(n) && !SKIP.test(n.nodeName)).map(n => {
            const c = (n.attrs || []).find(a => a.name === 'class');
            return c ? c.value.trim() : n.nodeName;
        });
    };

    const base = order(src);
    if (!base || base.length < 3) {
        console.log('  --   main 직속 블록이 3개 미만이라 건너뜁니다');
    } else {
        // main 의 경로를 찾는다 (요소만 세는 findByPath 규칙과 맞춘다)
        const d0 = parse(src);
        const h0 = d0.childNodes.find(n => n.nodeName === 'html');
        const bodyIdx = h0.childNodes.filter(isEl).findIndex(n => n.nodeName === 'body');
        const b0 = h0.childNodes.find(n => n.nodeName === 'body');
        const mainIdx = b0.childNodes.filter(isEl).findIndex(n => n.nodeName === 'main');
        const pathAt = i => [bodyIdx, mainIdx, i];

        const down = moveElement(src, pathAt(1), 'down');
        const a1 = order(down.text);
        if (a1[1] === base[2] && a1[2] === base[1]) ok(`아래로: "${base[1].slice(0,24)}" 와 자리 바꿈`);
        else no('아래로 이동이 반영되지 않음');
        if (a1.slice(3).join() === base.slice(3).join()) ok('나머지 블록 순서 그대로');
        else no('무관한 블록 순서가 바뀜');

        // 왕복하면 원본과 바이트까지 같아야 한다 (주석·들여쓰기 보존)
        const back = moveElement(down.text, pathAt(2), 'up');
        if (back.text === src) ok('아래 → 위 왕복 시 원본과 완전히 동일');
        else no('왕복 후 원본과 달라짐');

        // 주석이 섹션을 따라갔는지 — 옮긴 섹션 바로 앞 주석이 그대로 붙어 있어야 한다
        const commentBefore = (t, cls) => {
            const i = t.indexOf(`class="${cls}"`);
            if (i < 0) return null;
            const head = t.lastIndexOf('<!--', i);
            const tail = t.indexOf('-->', head);
            return (head >= 0 && tail > head && tail < i) ? t.slice(head, tail + 3) : null;
        };
        const c0 = commentBefore(src, base[1]);
        const c1 = commentBefore(down.text, base[1]);
        if (c0 === null) console.log('  --   앞 주석이 없어 주석 추적 검사는 건너뜁니다');
        else if (c0 === c1) ok('앞 주석이 섹션을 따라 옮겨짐');
        else no('앞 주석이 제자리에 남음');

        // 길이·집합 보존
        if (down.text.length === src.length) ok('글자 수 보존 (내용 유실 없음)');
        else no(`글자 수 변화: ${down.text.length - src.length}`);
        if (JSON.stringify([...a1].sort()) === JSON.stringify([...base].sort())) ok('블록 집합 보존');
        else no('블록이 사라지거나 늘어남');

        // 경계: 맨 위를 더 위로 / 맨 아래를 더 아래로 는 막혀야 한다
        let guarded = 0;
        try { moveElement(src, pathAt(0), 'up'); } catch { guarded++; }
        try { moveElement(src, pathAt(base.length - 1), 'down'); } catch { guarded++; }
        if (guarded === 2) ok('맨 위/맨 아래에서 더 못 나가게 막힘');
        else no('경계를 벗어나는 이동이 허용됨');
    }
}

// ---------------------------------------------------------------
console.log('\n=== 블록 지우기 · 복제 ===');
{
    const SKIP = /^(script|style|link|template|noscript)$/i;
    const isEl = n => /^[a-z]/i.test(n.nodeName) && !n.nodeName.startsWith('#');
    const blocks = t => {
        const d = parse(t);
        const h = d.childNodes.find(n => n.nodeName === 'html');
        const b = h.childNodes.find(n => n.nodeName === 'body');
        const m = b.childNodes.find(n => n.nodeName === 'main');
        return m ? m.childNodes.filter(n => isEl(n) && !SKIP.test(n.nodeName)) : [];
    };
    const names = t => blocks(t).map(n => {
        const c = (n.attrs || []).find(a => a.name === 'class');
        return c ? c.value.trim() : n.nodeName;
    });

    const d0 = parse(src);
    const h0 = d0.childNodes.find(n => n.nodeName === 'html');
    const bodyIdx = h0.childNodes.filter(isEl).findIndex(n => n.nodeName === 'body');
    const b0 = h0.childNodes.find(n => n.nodeName === 'body');
    const mainIdx = b0.childNodes.filter(isEl).findIndex(n => n.nodeName === 'main');
    const pathAt = i => [bodyIdx, mainIdx, i];

    const base = names(src);
    if (base.length < 3) {
        console.log('  --   블록이 3개 미만이라 건너뜁니다');
    } else {
        // 지우기 — 그 블록만 사라지고 나머지는 그대로
        const rm = removeElement(src, pathAt(1));
        const afterRm = names(rm.text);
        if (afterRm.length === base.length - 1) ok(`지우기: ${base.length} → ${afterRm.length}개`);
        else no(`지운 뒤 개수가 이상함: ${afterRm.length}`);
        if (!afterRm.includes(base[1]) && afterRm[1] === base[2]) ok('지운 블록만 빠지고 순서 유지');
        else no('엉뚱한 블록이 지워짐');
        try { parse(rm.text); ok('지운 뒤에도 정상 HTML'); } catch { no('지운 뒤 파싱 실패'); }

        // 복제 — 바로 뒤에 같은 것이 하나 더
        const dup = duplicateElement(src, pathAt(1));
        const afterDup = names(dup.text);
        if (afterDup.length === base.length + 1) ok(`복제: ${base.length} → ${afterDup.length}개`);
        else no(`복제 뒤 개수가 이상함: ${afterDup.length}`);
        if (afterDup[1] === base[1] && afterDup[2] === base[1]) ok('복제본이 바로 뒤에 붙음');
        else no('복제 위치가 어긋남');
        try { parse(dup.text); ok('복제 뒤에도 정상 HTML'); } catch { no('복제 뒤 파싱 실패'); }

        // 복제 → 지우기 로 되돌리면 원래 개수
        const back = removeElement(dup.text, pathAt(2));
        if (names(back.text).length === base.length) ok('복제 후 지우면 개수 원상복구');
        else no('복제/지우기 왕복이 안 맞음');
    }
}

// ---------------------------------------------------------------
console.log('\n=== 컴포넌트 CSS 동반 ===');
{
    const css = '.zz-demo-card { display: grid; gap: 12px; }\n.zz-demo-card__t { font-weight: 700; }';

    const r1 = appendCss(src, css, '컴포넌트: 데모');
    if (r1.added) ok('마지막 <style> 안에 규칙이 들어감');
    else no('CSS 가 삽입되지 않음');
    if (r1.text.includes('.zz-demo-card__t')) ok('여러 줄 규칙이 온전히 들어감');
    else no('일부 규칙이 빠짐');
    if (r1.text.includes('/* 컴포넌트: 데모 */')) ok('어디서 온 스타일인지 주석으로 남음');
    else no('설명 주석이 없음');

    // 같은 걸 또 넣어도 늘어나지 않아야 한다 (드롭을 두 번 해도 규칙이 두 벌 생기면 안 됨)
    const r2 = appendCss(r1.text, css, '컴포넌트: 데모');
    if (!r2.added && r2.text === r1.text) ok('같은 CSS 를 다시 넣어도 늘어나지 않음');
    else no('중복 삽입됨');

    // 삽입 뒤에도 문서가 멀쩡해야 한다
    try {
        const d = parse(r1.text);
        const h = d.childNodes.find(n => n.nodeName === 'html');
        if (h) ok('CSS 삽입 뒤에도 정상 HTML');
        else no('삽입 뒤 html 을 못 찾음');
    } catch (e) { no('삽입 뒤 파싱 실패: ' + e.message); }

    // 원래 있던 내용은 그대로 (덧붙이기만 한다)
    const addedLines = r1.text.split('\n').length - srcLines.length;
    if (r1.text.startsWith(src.slice(0, 2000))) ok('앞부분은 손대지 않음');
    else no('기존 내용이 바뀜');
    if (addedLines > 0 && addedLines < 12) ok(`늘어난 줄 ${addedLines}줄 (덧붙이기만)`);
    else no(`줄 증가가 이상함: ${addedLines}`);

    // <style> 이 없는 문서에는 손대지 않는다
    const bare = appendCss('<html><body><p>hi</p></body></html>', css, 'x');
    if (!bare.added) ok('<style> 이 없으면 건드리지 않음');
    else no('style 없는 문서를 고침');
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
