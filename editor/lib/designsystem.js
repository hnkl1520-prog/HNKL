// 디자인 시스템 데이터 수집 (표시 전용)
//
// - tokens.css 의 :root / .dark-mode / @media(--s) 를 '파일에서' 파싱한다. (값 하드코딩 금지)
// - 사용처·횟수는 vibra.html + common.css 를 스캔한다.
// - 값 수정 기능 없음. 읽기만.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PUBLIC, TOKENS_FILE, SHARED_CSS, CONFIG } from './config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TOKENS = TOKENS_FILE;
const COMMON = SHARED_CSS;

/**
 * 토큰이 어디에 몇 번 쓰이는지 셀 대상 페이지들.
 * 설정의 scan 에 적은 폴더 아래 .html 을 모은다 (특정 파일을 코드에 박지 않는다).
 */
function scanTargets() {
    const out = [];
    const walk = dir => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.name.endsWith('.html')) out.push(full);
        }
    };
    for (const rel of (CONFIG.scan || [])) walk(path.join(PUBLIC, rel));
    return out;
}

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
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped + '\\s*\\{');
    const m = re.exec(css);
    if (!m) return '';
    const open = css.indexOf('{', m.index);
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

// ---------- 저장 (:root=라이트, .dark-mode=다크, 백업 남김) ----------
// edits     : { '--gray-50': '#848487', '--text-sub': 'var(--gray-70)', '--fs-body': 'calc(20px * var(--s))', ... }
// darkEdits : { '--text-sub': 'var(--gray-40)', ... }  // 역할의 다크 매핑
// 규칙: :root 는 기존 선언 값만 치환(추가 금지). .dark-mode 는 역할 다크 매핑을 치환하고,
//       아직 없는 역할이면 새 줄로 추가한다. 주석·정렬·@media 는 손대지 않는다.
export function saveTokens(edits, darkEdits) {
    const original = fs.readFileSync(TOKENS, 'utf8');

    // 백업 먼저 — 원본 그대로 남긴다
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backup = TOKENS + '.bak-' + stamp;
    fs.writeFileSync(backup, original, 'utf8');

    let css = original;
    const applied = [];

    // 한 selector 의 { ... } 범위. 헤더는 정규식으로 찾아 주석 안 이름(.dark-mode = 다크.)에 걸리지 않게 한다.
    const blockRange = (text, headerRe) => {
        const m = headerRe.exec(text);
        if (!m) return null;
        const open = text.indexOf('{', m.index);
        if (open < 0) return null;
        let depth = 0;
        for (let i = open; i < text.length; i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') { depth--; if (depth === 0) return { open, close: i }; }
        }
        return null;
    };

    // 블록 본문에서 기존 선언 값만 치환. insert=true 면 없는 이름은 닫는 괄호 앞에 새 줄로 추가.
    const patchBlock = (body, obj, { insert = false, tag = '' } = {}) => {
        for (const [name, rawVal] of Object.entries(obj || {})) {
            const newVal = String(rawVal).trim();
            const re = new RegExp('(' + escapeRe(name) + '\\s*:\\s*)([^;]+)(;)');
            const m = body.match(re);
            if (m) {
                const before = m[2].trim();
                if (before === newVal) { applied.push({ name: name + tag, before, after: newVal, unchanged: true }); continue; }
                body = body.replace(re, `$1${newVal}$3`);
                applied.push({ name: name + tag, before, after: newVal });
            } else if (insert) {
                body = body.replace(/\s*$/, '\n') + `    ${name}: ${newVal};\n`;
                applied.push({ name: name + tag, before: '(없음)', after: newVal });
            } else {
                applied.push({ name: name + tag, skipped: '정의 없음(추가 안 함)' });
            }
        }
        return body;
    };

    // 1) :root (라이트) — 기존 선언만 치환, 추가 금지
    const root = blockRange(css, /:root\s*\{/);
    if (!root) throw new Error(':root 블록을 찾지 못했습니다.');
    const newRoot = patchBlock(css.slice(root.open + 1, root.close), edits);
    css = css.slice(0, root.open + 1) + newRoot + css.slice(root.close);

    // 2) .dark-mode (다크) — 없는 역할은 새 줄로 추가
    if (darkEdits && Object.keys(darkEdits).length) {
        const dark = blockRange(css, /\.dark-mode\s*\{/);
        if (!dark) throw new Error('.dark-mode 블록을 찾지 못했습니다.');
        const newDark = patchBlock(css.slice(dark.open + 1, dark.close), darkEdits, { insert: true, tag: ' (다크)' });
        css = css.slice(0, dark.open + 1) + newDark + css.slice(dark.close);
    }

    fs.writeFileSync(TOKENS, css, 'utf8');
    return { applied: applied.filter(a => !a.unchanged && !a.skipped), backup: path.basename(backup) };
}

/**
 * (크기 토큰, 굵기) 짝이 몇 번 쓰였는지 센다.
 * 단계별 '기본 굵기'를 규칙이 아니라 실제 현황에서 뽑기 위한 것.
 *   { '--fs-body': { 700: 6, 600: 4, ... } }
 */
function scanFsWeightPairs(sources) {
    const out = {};        // fs -> weight -> { count, selectors:Set }
    const bump = (fs, w, sel) => {
        ((out[fs] ||= {})[w] ||= { count: 0, selectors: new Set() });
        out[fs][w].count++;
        if (sel) out[fs][w].selectors.add(sel);
    };
    const scan = (decl, sel) => {
        const fs = decl.match(/font-size\s*:\s*[^;]*var\(\s*(--fs-[\w-]+)\s*\)/);
        const fw = decl.match(/font-weight\s*:\s*(\d{3})\b/);
        if (fs && fw) bump(fs[1], +fw[1], sel);
    };
    for (const src of sources) {
        for (const { sel, body } of src.rules) scan(body, sel.split(',')[0].trim());
        for (const style of src.inline || []) scan(style, '본문 inline');
    }
    return out;
}

// ---------- 메인 ----------
export function buildDesignSystem() {
    const tokensCss = fs.readFileSync(TOKENS, 'utf8');
    const commonCss = fs.readFileSync(COMMON, 'utf8');

    // 스캔 소스: 공용 CSS 전체 + 설정에 적힌 페이지들의 <style>·inline style.
    // (특정 파일을 코드에 박지 않으므로, 게시물이 늘면 자동으로 함께 세어진다)
    const pages = scanTargets().map(file => {
        const html = fs.readFileSync(file, 'utf8');
        const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
        const inline = [...html.matchAll(/style="([^"]*)"/g)].map(m => m[1]);
        return { name: path.basename(file), styles, inline };
    });

    const scanText = [commonCss, ...pages.map(p => p.styles), ...pages.flatMap(p => p.inline)].join('\n');
    const sources = [
        { rules: leafRules(commonCss), inline: [] },
        ...pages.map(p => ({ rules: leafRules(p.styles), inline: p.inline })),
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

    // 1) 회색 램프 — 단일 팔레트 (라이트·다크가 같은 램프에서 단계만 다르게 집는다)
    const ramp = [];
    for (const n of [1, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100]) {
        const key = `--gray-${n}`;
        if (!light[key]) continue;
        ramp.push({
            name: key, step: n,
            hex: normHex(light[key]), darkHex: null,
            count: count(key), usage: hintOf(key), unused: isUnused(key),
        });
    }

    // 1-b) 포인트 램프 — Primary(10단계) / Secondary 퍼플·틸(각 5단계)
    const buildRamp = (prefix, steps) => {
        const out = [];
        for (const n of steps) {
            const key = `--${prefix}-${n}`;
            if (!light[key]) continue;
            out.push({
                name: key, step: n,
                hex: normHex(light[key]),
                count: count(key), usage: hintOf(key), unused: isUnused(key),
            });
        }
        return out;
    };
    const primary = buildRamp('primary', [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    const purpleRamp = buildRamp('purple', [10, 30, 50, 70, 90]);
    const tealRamp = buildRamp('teal', [10, 30, 50, 70, 90]);

    // 1-c) 원시 색 (흑·백)
    const primitives = [
        { name: '--black', label: '검정' },
        { name: '--white', label: '흰색' },
    ].filter(p => light[p.name]).map(p => ({
        ...p, hex: resolveColor(light[p.name], light),
        count: count(p.name), usage: hintOf(p.name), unused: isUnused(p.name),
    }));

    // 다크값 해석용: 다크 블록이 덮은 값 위에서 var() 체인을 따라간다.
    // (--panel 처럼 var(--gray-10) 을 가리키는 토큰도 올바른 다크 hex 로 풀린다)
    const darkMap = { ...light, ...dark };
    const resolveDark = name => resolveColor(darkMap[name], darkMap);

    // 표면 (배경/카드/면) — 1층
    const surfaces = [
        { name: '--bg', label: '페이지 배경' },
        { name: '--surface', label: '카드 배경' },
        { name: '--panel', label: '면 배경' },
    ].filter(s => light[s.name]).map(s => ({
        ...s, hex: resolveColor(light[s.name], light), darkHex: resolveDark(s.name),
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
        { name: '--label-color', label: '라벨 글자', text: true },
        { name: '--line-color', label: '선·테두리' },
        { name: '--accent-color', label: '포인트' },
    ];
    const bgHex = resolveColor('var(--bg-color)', light) || normHex(light['--bg'] || '#FFFFFF');
    const cardHex = resolveColor('var(--card-bg)', light) || normHex(light['--surface'] || '#FFFFFF');
    const darkBgHex = resolveDark('--bg-color') || resolveDark('--bg') || '#050505';
    const darkCardHex = resolveDark('--card-bg') || resolveDark('--surface') || '#1C1C1E';
    const roles = roleDefs.filter(r => light[r.name]).map(r => {
        const hex = resolveColor(light[r.name], light);
        const darkHex = resolveDark(r.name);
        const linkM = String(light[r.name]).match(/^var\(\s*(--[\w-]+)\s*\)$/);
        const darkLinkM = dark[r.name] ? String(dark[r.name]).match(/^var\(\s*(--[\w-]+)\s*\)$/) : null;
        const row = {
            name: r.name, label: r.label, hex, darkHex,
            linked: linkM ? linkM[1] : null,
            darkLinked: darkLinkM ? darkLinkM[1] : null,
            count: count(r.name), usage: hintOf(r.name), unused: isUnused(r.name),
        };
        if (r.text && hex) {
            row.contrast = {
                onBg: contrast(hex, bgHex),
                onCard: contrast(hex, cardHex),
            };
            if (darkHex) {
                row.darkContrast = {
                    onBg: contrast(darkHex, darkBgHex),
                    onCard: contrast(darkHex, darkCardHex),
                };
            }
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
    const fontWeights = scanFontWeights(sources);

    // 스케일마다 '실제로 함께 쓰인 굵기' 를 뒤집어 모은다.
    // (본문 설명처럼 <strong> 이 섞이면 자연히 굵기가 2개가 된다)
    const weightsByFs = {};
    for (const w of fontWeights) {
        for (const sz of w.sizes) {
            if (!sz.startsWith('--fs-')) continue;
            (weightsByFs[sz] ||= []).push(w.weight);
        }
    }
    for (const k in weightsByFs) weightsByFs[k].sort((a, b) => b - a);

    // 단계별 굵기 현황: 그 크기에서 실제로 쓰이는 굵기들 + 각 굵기가 붙은 요소
    const fsWeightPairs = scanFsWeightPairs(sources);
    const dominantWeight = fs => {
        const m = fsWeightPairs[fs];
        if (!m) return null;
        return +Object.entries(m).sort((a, b) => b[1].count - a[1].count || +b[0] - +a[0])[0][0];
    };
    // [{ weight, selectors:[...] }] — 굵은 것부터
    const weightRows = fs => Object.entries(fsWeightPairs[fs] || {})
        .map(([w, v]) => ({ weight: +w, selectors: [...v.selectors] }))
        .sort((a, b) => b.weight - a.weight);

    const typo = typoDefs.filter(t => light[t.name]).map(t => ({
        name: t.name, label: t.label,
        def: light[t.name],                       // 정의값 원문 (calc(...))
        basePx: basePx(light[t.name]),            // × var(--s) 벗긴 기준 px
        weights: weightsByFs[t.name] || [],       // 이 크기와 함께 쓰이는 굵기들
        weightRows: weightRows(t.name),           // 굵기별 사용 요소 (표의 굵기·용도 칸)
        defaultWeight: dominantWeight(t.name),    // 이름 샘플을 어떤 굵기로 보일지
        count: count(t.name), usage: hintOf(t.name), unused: isUnused(t.name),
    }));

    // 굵기 토큰 (tokens.css 에 이름만 추가한 상태 — 요소 적용 안 됨)
    const usedWeightCount = {};
    for (const w of fontWeights) usedWeightCount[w.weight] = w.count;
    const weightTokens = Object.keys(light)
        .filter(n => /^--fw-/.test(n))
        .map(n => {
            const value = parseInt(light[n], 10);
            return {
                name: n, value,
                inCode: usedWeightCount[value] || 0,   // 지금 코드에서 이 굵기가 쓰인 횟수
                reserved: (usedWeightCount[value] || 0) <= 2,   // 사실상 미사용 → 예약 표시
            };
        })
        .sort((a, b) => a.value - b.value);

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
    const aliasNames = ['--gray-ink', '--space-xs', '--space-sm', '--space-md', '--space-lg', '--space-xl'];
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
    annotate(primary);
    annotate(purpleRamp);
    annotate(tealRamp);
    annotate(primitives);
    annotate(surfaces);
    annotate(spacing);

    // 무슨 글꼴을 쓰는지 — 디자인시스템을 열어 보는 이유의 절반이다.
    // 가장 많이 적힌 font-family 를 이 사이트의 글꼴로 본다.
    const famCount = {};
    for (const m of scanText.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
        const first = m[1].split(',')[0].trim().replace(/^['"]|['"]$/g, '');
        if (!first || /^(inherit|initial|unset|var\()/i.test(first)) continue;
        famCount[first] = (famCount[first] || 0) + 1;
    }
    const fontFamily = Object.entries(famCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    return {
        ramp, primary, purpleRamp, tealRamp, primitives, surfaces, roles,
        typo, fontWeights, weightTokens, fontFamily,
        spacing, scale,
        aliases,
        meta: { source: CONFIG.tokensFile, scanned: [CONFIG.sharedCss, ...pages.map(p => p.name)] },
    };
}
