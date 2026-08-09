// 디자인 시스템 데이터 수집 (표시 전용)
//
// - tokens.css 의 :root / .dark-mode / @media(--s) 를 '파일에서' 파싱한다. (값 하드코딩 금지)
// - 사용처·횟수는 vibra.html + common.css 를 스캔한다.
// - 값 수정 기능 없음. 읽기만.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../../public');

const TOKENS = path.join(PUBLIC, 'tokens.css');
const COMMON = path.join(PUBLIC, 'common.css');
const VIBRA = path.join(PUBLIC, 'works/projects/vibra/vibra.html');

// ---------- 유틸 ----------
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** `--name: value;` 선언들을 뽑는다 (한 블록 본문 문자열에서) */
function parseDecls(body) {
    const out = {};
    const clean = stripComments(body);
    for (const m of clean.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        out[m[1].trim()] = m[2].trim();
    }
    return out;
}

/** 최상위 selector { ... } 블록 하나의 본문을 꺼낸다 (중괄호 깊이 추적) */
function extractBlock(css, selector) {
    const start = css.indexOf(selector);
    if (start < 0) return '';
    const open = css.indexOf('{', start);
    if (open < 0) return '';
    let depth = 0;
    for (let i = open; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') { depth--; if (depth === 0) return css.slice(open + 1, i); }
    }
    return '';
}

function normHex(raw) {
    let s = String(raw).trim();
    let m = s.match(/^#([0-9a-f]{3})$/i);
    if (m) return '#' + [...m[1]].map(c => c + c).join('').toUpperCase();
    m = s.match(/^#([0-9a-f]{6})$/i);
    if (m) return '#' + m[1].toUpperCase();
    return s;
}

/** 값이 색인지 판별하고, var() 체인을 따라 최종 hex 로 해석 */
function resolveColor(val, map, depth = 0) {
    if (depth > 8 || val == null) return null;
    const v = String(val).trim();
    if (/^#[0-9a-f]{3,6}$/i.test(v)) return normHex(v);
    const vm = v.match(/^var\(\s*(--[\w-]+)\s*\)$/);
    if (vm && map[vm[1]] != null) return resolveColor(map[vm[1]], map, depth + 1);
    return null; // calc/clamp 등은 색 아님
}

/** calc(Npx * var(--s)) 또는 Npx 에서 기준 px 를 꺼낸다 */
function basePx(val) {
    const v = String(val);
    let m = v.match(/calc\(\s*([\d.]+)px\s*\*\s*var\(--s\)\s*\)/);
    if (m) return parseFloat(m[1]);
    m = v.match(/^([\d.]+)px$/);
    if (m) return parseFloat(m[1]);
    return null;
}

// 상대휘도 · 대비 (WCAG)
function luminance(hex) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(hexA, hexB) {
    const a = luminance(hexA), b = luminance(hexB);
    const [hi, lo] = a > b ? [a, b] : [b, a];
    return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
}

// ---------- 사용처 스캔 ----------
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** vibra + common 에서 var(--name) 사용 횟수 */
function countVar(text, name) {
    const re = new RegExp('var\\(\\s*' + escapeRe(name) + '\\s*[,)]', 'g');
    return (text.match(re) || []).length;
}

/** CSS 안의 잎 규칙(selector{body}) 들을 뽑는다 — @media 래퍼는 자연히 건너뜀 */
function leafRules(css) {
    const clean = stripComments(css);
    const rules = [];
    for (const m of clean.matchAll(/([^{}]+?)\{([^{}]+?)\}/g)) {
        let sel = m[1].trim().split(',')[0].trim();
        // @media/@supports 조건 잔여물 정리
        sel = sel.replace(/^@[^{]*\{?/, '').trim();
        if (sel && !sel.startsWith('@')) rules.push({ sel, body: m[2] });
    }
    return rules;
}

/** 이 토큰을 쓰는 대표 selector 들 + inline 사용 여부 */
function usageOf(name, sources) {
    const sels = new Set();
    let inlineCount = 0;
    const re = new RegExp('var\\(\\s*' + escapeRe(name) + '\\s*[,)]');
    for (const src of sources) {
        for (const { sel, body } of src.rules) {
            if (re.test(body)) sels.add(sel);
        }
        for (const style of src.inline || []) {
            if (re.test(style)) inlineCount++;
        }
    }
    return { selectors: [...sels], inlineCount };
}

/** 사용처를 짧은 사람용 힌트로 (selector 몇 개 + inline N) */
function usageHint(u) {
    const parts = u.selectors.slice(0, 4);
    let hint = parts.join(', ');
    if (u.selectors.length > 4) hint += ` 외 ${u.selectors.length - 4}`;
    if (u.inlineCount) hint += (hint ? ' · ' : '') + `inline ${u.inlineCount}곳`;
    return hint || '—';
}

// ---------- font-weight 현황 ----------
function scanFontWeights(sources) {
    const map = new Map();  // weight -> { count, sizes:Set }
    const add = (w, size) => {
        w = String(w).trim();
        if (!/^\d{2,3}$/.test(w)) return;   // normal/bold 등은 제외 (숫자만)
        if (!map.has(w)) map.set(w, { count: 0, sizes: new Set() });
        const e = map.get(w);
        e.count++;
        if (size) e.sizes.add(size);
    };
    const sizeOf = (decl) => {
        const m = decl.match(/font-size\s*:\s*([^;]+)/);
        if (!m) return null;
        let v = m[1].trim();
        const vm = v.match(/var\(\s*(--fs-[\w-]+)\s*\)/);
        if (vm) return vm[1];               // --fs-body 처럼
        const bp = basePx(v) ?? (v.match(/([\d.]+)rem/) ? Math.round(parseFloat(v) * 16) : null);
        return bp ? bp + 'px' : v;
    };
    for (const src of sources) {
        for (const { body } of src.rules) {
            const wm = body.match(/font-weight\s*:\s*([^;]+)/);
            if (wm) add(wm[1], sizeOf(body));
        }
        for (const style of src.inline || []) {
            const wm = style.match(/font-weight\s*:\s*([^;]+)/);
            if (wm) add(wm[1], sizeOf(style));
        }
    }
    return [...map.entries()]
        .map(([weight, e]) => ({ weight: +weight, count: e.count, sizes: [...e.sizes] }))
        .sort((a, b) => b.weight - a.weight);
}

// ---------- 메인 ----------
export function buildDesignSystem() {
    const tokensCss = fs.readFileSync(TOKENS, 'utf8');
    const commonCss = fs.readFileSync(COMMON, 'utf8');
    const vibraHtml = fs.readFileSync(VIBRA, 'utf8');

    // 스캔 소스: common.css 전체 + vibra 의 <style> + vibra 의 inline style
    const vibraStyle = (() => {
        const o = vibraHtml.indexOf('<style>'); const c = vibraHtml.indexOf('</style>', o);
        return o >= 0 && c >= 0 ? vibraHtml.slice(o + 7, c) : '';
    })();
    const vibraInline = [...vibraHtml.matchAll(/style="([^"]*)"/g)].map(m => m[1]);
    const scanText = commonCss + '\n' + vibraStyle + '\n' + vibraInline.join(';');
    const sources = [
        { rules: leafRules(commonCss), inline: [] },
        { rules: leafRules(vibraStyle), inline: vibraInline },
    ];

    // --- 토큰 파싱 (파일에서) ---
    const light = parseDecls(extractBlock(tokensCss, ':root'));
    const dark = parseDecls(extractBlock(tokensCss, '.dark-mode'));
    // --s 오버라이드(@media) 식
    const sOverride = (() => {
        const m = tokensCss.match(/:root\s*\{\s*--s:\s*(clamp\([^;]+)\s*;\s*\}/);
        return m ? m[1].trim() : (light['--s'] || '1');
    })();

    const count = name => countVar(scanText, name);
    const hintOf = name => usageHint(usageOf(name, sources));
    const isUnused = name => count(name) === 0;

    // 1) 회색 램프
    const ramp = [];
    for (let n = 100; n <= 900; n += 100) {
        const key = `--gray-${n}`;
        if (!light[key]) continue;
        ramp.push({
            name: key, step: n,
            hex: normHex(light[key]), darkHex: dark[key] ? normHex(dark[key]) : null,
            count: count(key), usage: hintOf(key), unused: isUnused(key),
        });
    }
    // 램프 특수 단계 사이도 있으면(예: 없음) 무시. 밝은→어두운(=번호 오름) 순 유지.

    // 1) 원시 색 (블루/퍼플/틸/다크배경)
    const primitives = [
        { name: '--blue', label: '포인트 블루' },
        { name: '--purple', label: '서브 퍼플' },
        { name: '--teal', label: '서브 틸' },
        { name: '--dark-surface', label: '다크 배경' },
    ].filter(p => light[p.name]).map(p => ({
        ...p, hex: resolveColor(light[p.name], light),
        count: count(p.name), usage: hintOf(p.name), unused: isUnused(p.name),
    }));

    // 표면 (배경/카드/면) — 1층, 다크값 있음
    const surfaces = [
        { name: '--bg', label: '페이지 배경' },
        { name: '--surface', label: '카드 배경' },
        { name: '--panel', label: '면 배경' },
    ].filter(s => light[s.name]).map(s => ({
        ...s, hex: normHex(light[s.name]), darkHex: dark[s.name] ? normHex(dark[s.name]) : null,
        count: count(s.name), usage: hintOf(s.name), unused: isUnused(s.name),
    }));

    // 2) 색 · 역할 (2층)
    const roleDefs = [
        { name: '--bg-color', label: '페이지 배경' },
        { name: '--card-bg', label: '카드 배경' },
        { name: '--panel', label: '면 배경' },
        { name: '--text-color', label: '본문 글자', text: true },
        { name: '--text-sub', label: '보조 글자', text: true },
        { name: '--dim-color', label: '흐린 글자', text: true },
        { name: '--accent-color', label: '포인트' },
    ];
    const bgHex = resolveColor('var(--bg-color)', light) || normHex(light['--bg'] || '#FFFFFF');
    const cardHex = resolveColor('var(--card-bg)', light) || normHex(light['--surface'] || '#FFFFFF');
    const roles = roleDefs.filter(r => light[r.name]).map(r => {
        const hex = resolveColor(light[r.name], light);
        // 연결된 팔레트 이름 (var(--x) 면 --x)
        const linkM = String(light[r.name]).match(/^var\(\s*(--[\w-]+)\s*\)$/);
        const row = {
            name: r.name, label: r.label, hex,
            linked: linkM ? linkM[1] : null,
            count: count(r.name), usage: hintOf(r.name), unused: isUnused(r.name),
        };
        if (r.text && hex) {
            row.contrast = {
                onBg: contrast(hex, bgHex),
                onCard: contrast(hex, cardHex),
            };
        }
        return row;
    });

    // 3) 타이포
    const typoDefs = [
        { name: '--fs-display', label: '대형 타이틀' },
        { name: '--fs-h1', label: '제목 1' },
        { name: '--fs-h2', label: '제목 2' },
        { name: '--fs-h3', label: '제목 3' },
        { name: '--fs-body', label: '본문' },
        { name: '--fs-small', label: '작은 글씨' },
        { name: '--fs-caption', label: '캡션' },
    ];
    const typo = typoDefs.filter(t => light[t.name]).map(t => ({
        name: t.name, label: t.label,
        def: light[t.name],                       // 정의값 원문 (calc(...))
        basePx: basePx(light[t.name]),            // × var(--s) 벗긴 기준 px
        count: count(t.name), usage: hintOf(t.name), unused: isUnused(t.name),
    }));
    const fontWeights = scanFontWeights(sources);

    // 4) 간격 · 배율
    const spacing = [];
    for (let n = 1; n <= 10; n++) {
        const key = `--space-${n}`;
        if (!light[key]) continue;
        spacing.push({
            name: key, step: n, def: light[key], basePx: basePx(light[key]),
            count: count(key), usage: hintOf(key), unused: isUnused(key),
        });
    }
    const scale = { name: '--s', base: light['--s'] || '1', override: sOverride };

    // 하위호환 별칭 (접힘 영역)
    const aliasNames = ['--gray-ink', '--gray-50', '--space-xs', '--space-sm', '--space-md', '--space-lg', '--space-xl'];
    const aliases = aliasNames.filter(n => light[n]).map(n => {
        const linkM = String(light[n]).match(/^var\(\s*(--[\w-]+)\s*\)$/);
        return {
            name: n, def: light[n], linked: linkM ? linkM[1] : null,
            resolvedHex: resolveColor(light[n], light),   // 색이면
            basePx: basePx(light[n]),                       // 간격이면
            count: count(n), usage: hintOf(n), unused: isUnused(n),
        };
    });

    // --- 간접 사용 집계 ---
    // T 가 `var(--B)` 로 정의돼 있으면, T 의 사용 횟수를 B 의 '경유 사용'으로 크레딧한다.
    // (역할 --text-sub→--gray-600, 별칭 --space-md→--space-6, --accent-color→--blue 등)
    const indirect = {};
    for (const [name, val] of Object.entries(light)) {
        const m = String(val).match(/^var\(\s*(--[\w-]+)\s*\)$/);
        if (m) indirect[m[1]] = (indirect[m[1]] || 0) + count(name);
    }
    const annotate = arr => arr.forEach(t => {
        t.indirect = indirect[t.name] || 0;
        // 직접·간접 모두 0 일 때만 진짜 미사용
        t.unused = (t.count + t.indirect) === 0;
    });
    annotate(ramp);
    annotate(primitives);
    annotate(surfaces);
    annotate(spacing);

    return {
        ramp, primitives, surfaces, roles,
        typo, fontWeights,
        spacing, scale,
        aliases,
        meta: { source: 'tokens.css', scanned: ['vibra.html', 'common.css'] },
    };
}
