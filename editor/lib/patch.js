// 원본 HTML 파일을 '수술하듯' 부분만 고치는 모듈.
//
// 왜 이렇게 하는가:
//   HTML을 파싱해서 통째로 다시 써내면(serialize) 들여쓰기·주석·따옴표 스타일이 전부 바뀐다.
//   그러면 git diff가 파일 전체로 뜨고, 사람이 손으로 쓴 코드가 뭉개진다.
//   그래서 parse5로 '위치'만 알아낸 뒤, 원본 문자열의 그 구간만 잘라 끼운다.
//   → 건드린 줄만 diff에 뜬다.

import { parse } from 'parse5';

/** parse5 트리를 깊이 우선으로 순회 */
function walk(node, visit) {
    visit(node);
    const kids = node.childNodes || [];
    for (const kid of kids) walk(kid, visit);
    // <template>의 내용은 content 안에 들어있다
    if (node.content) walk(node.content, visit);
}

/** 요소 노드인지 (텍스트·주석·doctype 제외) */
function isElement(node) {
    return node.nodeName && node.nodeName !== '#text'
        && node.nodeName !== '#comment' && node.nodeName !== '#documentType'
        && node.nodeName !== '#document' && node.nodeName !== '#document-fragment';
}

/**
 * 브라우저에서 만든 경로로 원본 속 요소를 찾는다.
 *
 * 경로 형식: 루트부터의 자식 순번 배열. 예) [1, 3, 0, 2]
 * 브라우저와 Node가 '같은 규칙'으로 세야 하므로, 양쪽 모두
 * "요소 노드만" 순번을 센다 (텍스트·주석은 무시).
 */
function findByPath(document, path) {
    // parse5 문서 최상위에서 <html>을 찾는다
    let current = (document.childNodes || []).find(n => n.nodeName === 'html');
    if (!current) return null;

    for (const index of path) {
        const kids = (current.childNodes || []).filter(isElement);
        current = kids[index];
        if (!current) return null;
    }
    return current;
}

/** 요소에서 특정 속성 노드를 찾는다 */
function getAttr(el, name) {
    return (el.attrs || []).find(a => a.name === name);
}

/**
 * "margin-top:4px; color:red" 같은 선언 문자열을 객체로.
 * 값 안의 세미콜론(예: url(data:...;base64))까지 고려하진 않는다 —
 * 이 도구가 다루는 건 간격·크기 값이라 실용상 충분하다.
 */
export function parseStyle(styleText) {
    const out = {};
    if (!styleText) return out;
    for (const chunk of styleText.split(';')) {
        const i = chunk.indexOf(':');
        if (i === -1) continue;
        const prop = chunk.slice(0, i).trim();
        const value = chunk.slice(i + 1).trim();
        if (prop) out[prop] = value;
    }
    return out;
}

/** 객체를 다시 선언 문자열로. 원본의 한 줄/여러 줄 여부는 유지하지 않는다(짧아서 무해) */
export function stringifyStyle(obj) {
    return Object.entries(obj)
        .filter(([, v]) => v !== '' && v != null)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ');
}

/**
 * 요소의 인라인 style을 수정한 새 파일 내용을 돌려준다.
 *
 * @param {string} source   원본 파일 전체 문자열
 * @param {number[]} path   요소 경로
 * @param {Object} changes  { 'margin-top': '24px', 'color': null }  — null이면 해당 속성 삭제
 * @returns {{ text: string, before: string, after: string }}
 */
export function patchInlineStyle(source, path, changes) {
    const document = parse(source, { sourceCodeLocationInfo: true });
    const el = findByPath(document, path);
    if (!el) throw new Error('요소를 찾지 못했습니다. 파일이 그 사이 바뀌었을 수 있어요.');

    const loc = el.sourceCodeLocation;
    if (!loc || !loc.startTag) throw new Error('요소의 원본 위치를 알 수 없습니다.');

    const styleAttr = getAttr(el, 'style');
    const merged = { ...parseStyle(styleAttr ? styleAttr.value : ''), ...changes };
    for (const [k, v] of Object.entries(changes)) if (v == null) delete merged[k];

    const nextStyle = stringifyStyle(merged);

    // 이미 style 속성이 있으면 그 구간만 교체
    const attrLoc = loc.attrs && loc.attrs.style;
    if (attrLoc) {
        const before = source.slice(attrLoc.startOffset, attrLoc.endOffset);
        // 값이 비면 속성 자체를 지운다 (앞의 공백까지)
        const after = nextStyle ? `style="${nextStyle}"` : '';
        let start = attrLoc.startOffset;
        if (!nextStyle) {
            while (start > 0 && /\s/.test(source[start - 1])) start--;
        }
        return {
            text: source.slice(0, start) + after + source.slice(attrLoc.endOffset),
            before,
            after
        };
    }

    // style 속성이 없으면 여는 태그 끝 직전에 새로 끼워 넣는다
    if (!nextStyle) return { text: source, before: '', after: '' };

    const tagText = source.slice(loc.startTag.startOffset, loc.startTag.endOffset);
    // '<div ...>' 또는 '<img ... />' 의 닫는 부분 바로 앞
    const closeLen = tagText.endsWith('/>') ? 2 : 1;
    const insertAt = loc.startTag.endOffset - closeLen;
    const needsSpace = !/\s$/.test(source.slice(0, insertAt));
    const inserted = `${needsSpace ? ' ' : ''}style="${nextStyle}"`;

    return {
        text: source.slice(0, insertAt) + inserted + source.slice(insertAt),
        before: tagText,
        after: tagText.slice(0, tagText.length - closeLen) + inserted + tagText.slice(tagText.length - closeLen)
    };
}

/**
 * <style> 블록 안의 CSS 선언 하나를 고친다.
 * 같은 클래스를 쓰는 요소 전체에 반영하고 싶을 때 사용.
 *
 * @param {string} source
 * @param {string} selector  예) '.vb-group__head--lead'
 * @param {string} prop      예) 'margin-bottom'
 * @param {string} value     예) '48px'
 */
export function patchCssRule(source, selector, prop, value, options = {}) {
    const { insertIfMissing = true } = options;

    // 문서 안의 모든 <style> 블록 범위를 구한다
    const document = parse(source, { sourceCodeLocationInfo: true });
    const styleRanges = [];
    walk(document, node => {
        if (node.nodeName === 'style' && node.sourceCodeLocation) {
            const text = node.childNodes && node.childNodes[0];
            if (text && text.sourceCodeLocation) {
                styleRanges.push([text.sourceCodeLocation.startOffset, text.sourceCodeLocation.endOffset]);
            }
        }
    });
    if (!styleRanges.length) throw new Error('<style> 블록을 찾지 못했습니다.');

    // 1순위: 이미 그 속성이 있으면 값만 교체
    for (const [start, end] of styleRanges) {
        const css = source.slice(start, end);
        const hit = findDeclaration(css, selector, prop);
        if (!hit) continue;
        return {
            text: source.slice(0, start + hit.valueStart) + value + source.slice(start + hit.valueEnd),
            before: css.slice(hit.valueStart, hit.valueEnd),
            after: value,
            mode: 'replace'
        };
    }

    // 2순위: 규칙은 있는데 속성만 없으면 끝에 새로 넣는다
    //   (padding 처럼 한 줄로 묶여 있어 padding-top 을 따로 못 찾는 경우가 여기 해당)
    if (insertIfMissing) {
        for (const [start, end] of styleRanges) {
            const css = source.slice(start, end);
            const block = findRuleBlock(css, selector);
            if (!block) continue;

            const body = css.slice(block.bodyStart, block.bodyEnd);
            // 이 블록이 쓰는 들여쓰기를 그대로 따라간다
            const indentMatch = body.match(/\n([ \t]+)\S/);
            const indent = indentMatch ? indentMatch[1] : '    ';
            const multiline = body.includes('\n');

            // 마지막 선언 뒤(공백 앞)에 끼워 넣는다
            let at = block.bodyEnd;
            while (at > block.bodyStart && /\s/.test(css[at - 1])) at--;
            const needsSemi = at > block.bodyStart && css[at - 1] !== ';' && css[at - 1] !== '{';
            const decl = multiline
                ? `${needsSemi ? ';' : ''}\n${indent}${prop}: ${value};`
                : `${needsSemi ? ';' : ''} ${prop}: ${value};`;

            return {
                text: source.slice(0, start + at) + decl + source.slice(start + at),
                before: '(없음)',
                after: `${prop}: ${value}`,
                mode: 'insert'
            };
        }
    }

    throw new Error(`선택자 '${selector}' 를 찾지 못했습니다.`);
}

/**
 * 속성을 '새로 추가'할 블록을 고른다.
 *
 * 값을 교체할 때는 뒤쪽 규칙이 이기지만(CSS 규칙), 새로 추가할 때는 그 기준이 위험하다.
 *   - @media 안에 넣으면 특정 화면 크기에서만 적용된다
 *   - '.card, .other' 처럼 묶인 규칙에 넣으면 엉뚱한 요소까지 바뀐다
 * 그래서 다음 순서로 고른다:
 *   1) @media 밖 + 선택자가 정확히 일치
 *   2) @media 밖 + 쉼표로 묶인 규칙
 *   3) @media 안 + 정확히 일치
 *   4) @media 안 + 쉼표로 묶인 규칙
 */
function findRuleBlock(css, selector) {
    const scan = maskCssNoise(css);
    const target = selector.trim().replace(/\s+/g, ' ');
    const found = { topExact: null, topGroup: null, nestedExact: null, nestedGroup: null };

    // at-rule(@media 등)의 본문 범위를 미리 모아둔다
    const atRanges = [];
    {
        let i = 0;
        while (i < scan.length) {
            const open = scan.indexOf('{', i);
            if (open === -1) break;
            const selStart = Math.max(scan.lastIndexOf('}', open), scan.lastIndexOf('{', open - 1)) + 1;
            const head = scan.slice(selStart, open).trim();
            let depth = 1, j = open + 1;
            while (j < scan.length && depth > 0) {
                if (scan[j] === '{') depth++;
                else if (scan[j] === '}') depth--;
                j++;
            }
            if (head.startsWith('@')) { atRanges.push([open + 1, j - 1]); i = open + 1; }
            else i = j;
        }
    }
    const insideAt = pos => atRanges.some(([s, e]) => pos > s && pos < e);

    let i = 0;
    while (i < scan.length) {
        const open = scan.indexOf('{', i);
        if (open === -1) break;
        const selStart = Math.max(scan.lastIndexOf('}', open), scan.lastIndexOf('{', open - 1)) + 1;
        const selectorText = scan.slice(selStart, open).trim().replace(/\s+/g, ' ');

        let depth = 1, j = open + 1;
        while (j < scan.length && depth > 0) {
            if (scan[j] === '{') depth++;
            else if (scan[j] === '}') depth--;
            j++;
        }
        if (selectorText.startsWith('@')) { i = open + 1; continue; }
        if (selectorText.split(',').map(s => s.trim()).includes(target)) {
            const block = { bodyStart: open + 1, bodyEnd: j - 1 };
            const exact = selectorText === target;
            const nested = insideAt(open);
            if (!nested && exact) found.topExact = block;
            else if (!nested) found.topGroup = block;
            else if (exact) found.nestedExact = block;
            else found.nestedGroup = block;
        }
        i = j;
    }
    return found.topExact || found.topGroup || found.nestedExact || found.nestedGroup;
}

/**
 * 주석 /* ... *\/ 과 따옴표 문자열의 '내용'을 같은 길이의 공백으로 덮는다.
 *
 * 왜 필요한가:
 *   - 선택자 위의 주석이 선택자 텍스트에 섞여 들어와 매칭이 실패한다.
 *   - 주석 안의 'margin:auto' 같은 글자가 진짜 선언으로 오인된다.
 *   - content:"{" 처럼 문자열 속 중괄호가 깊이 계산을 망가뜨린다.
 * 길이를 그대로 유지하므로, 이 마스크에서 찾은 위치를 원본에 그대로 쓸 수 있다.
 */
function maskCssNoise(css) {
    const out = css.split('');
    let i = 0;
    while (i < css.length) {
        // 주석
        if (css[i] === '/' && css[i + 1] === '*') {
            const end = css.indexOf('*/', i + 2);
            const stop = end === -1 ? css.length : end + 2;
            for (let k = i; k < stop; k++) if (out[k] !== '\n') out[k] = ' ';
            i = stop;
            continue;
        }
        // 문자열
        if (css[i] === '"' || css[i] === "'") {
            const quote = css[i];
            let k = i + 1;
            while (k < css.length && css[k] !== quote) {
                if (css[k] === '\\') k++;
                k++;
            }
            for (let m = i; m <= Math.min(k, css.length - 1); m++) if (out[m] !== '\n') out[m] = ' ';
            i = k + 1;
            continue;
        }
        i++;
    }
    return out.join('');
}

/**
 * CSS 문자열에서 선택자 블록을 찾아 그 안의 속성 값 위치를 돌려준다.
 * 중괄호 깊이를 세므로 @media 안에 든 규칙도 찾는다.
 * 같은 선택자가 여러 번 나오면 '마지막' 것을 쓴다 — CSS는 뒤가 이기므로.
 */
function findDeclaration(css, selector, prop) {
    const scan = maskCssNoise(css);   // 위치 계산은 마스크에서, 값은 원본에서
    let result = null;
    const target = selector.trim().replace(/\s+/g, ' ');

    let i = 0;
    while (i < scan.length) {
        const open = scan.indexOf('{', i);
        if (open === -1) break;

        // 이 블록의 선택자 = 직전 '}' 또는 '{' 이후부터 open 까지
        const selStart = Math.max(scan.lastIndexOf('}', open), scan.lastIndexOf('{', open - 1)) + 1;
        const selectorText = scan.slice(selStart, open).trim().replace(/\s+/g, ' ');

        // 짝 맞는 '}' 찾기
        let depth = 1, j = open + 1;
        while (j < scan.length && depth > 0) {
            if (scan[j] === '{') depth++;
            else if (scan[j] === '}') depth--;
            j++;
        }
        const bodyStart = open + 1, bodyEnd = j - 1;

        // @media 같은 그룹 규칙은 내부를 계속 훑는다
        if (selectorText.startsWith('@')) { i = bodyStart; continue; }

        const matched = selectorText.split(',').map(s => s.trim()).includes(target);
        if (matched) {
            const found = findPropInBody(scan.slice(bodyStart, bodyEnd), prop);
            if (found) {
                result = {
                    valueStart: bodyStart + found.valueStart,
                    valueEnd: bodyStart + found.valueEnd
                };
            }
        }
        i = j;
    }
    return result;
}

/** 선언 블록 본문에서 'prop: value' 의 value 구간을 찾는다 (본문은 마스크된 문자열) */
function findPropInBody(body, prop) {
    let depth = 0, declStart = 0;
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if ((ch === ';' || i === body.length - 1) && depth === 0) {
            const end = ch === ';' ? i : body.length;
            const decl = body.slice(declStart, end);
            const colon = decl.indexOf(':');
            if (colon !== -1 && decl.slice(0, colon).trim() === prop) {
                let vs = declStart + colon + 1;
                while (vs < end && /\s/.test(body[vs])) vs++;
                let ve = end;
                while (ve > vs && /\s/.test(body[ve - 1])) ve--;
                return { valueStart: vs, valueEnd: ve };
            }
            declStart = i + 1;
        }
    }
    return null;
}

/**
 * 요소의 앞·뒤·안쪽에 HTML 조각을 끼워 넣는다.
 * 원본은 그대로 두고 '그 지점에만' 문자열을 삽입하므로, 다른 줄은 diff에 안 뜬다.
 *
 * @param {string} source
 * @param {number[]} path   기준 요소 경로 (findByPath 규칙)
 * @param {string} html     넣을 HTML 조각
 * @param {'before'|'after'|'firstChild'|'lastChild'} position
 */
export function insertHtml(source, path, html, position = 'after') {
    const document = parse(source, { sourceCodeLocationInfo: true });
    const el = findByPath(document, path);
    if (!el) throw new Error('요소를 찾지 못했습니다. 파일이 그 사이 바뀌었을 수 있어요.');

    const loc = el.sourceCodeLocation;
    if (!loc) throw new Error('요소의 원본 위치를 알 수 없습니다.');

    let at;
    if (position === 'before') at = loc.startOffset;
    else if (position === 'after') at = loc.endOffset;
    else if (position === 'firstChild') {
        if (!loc.startTag) throw new Error('여는 태그 위치를 알 수 없습니다.');
        at = loc.startTag.endOffset;
    } else if (position === 'lastChild') {
        // 닫는 태그가 없으면(자기닫기 등) 뒤에 붙인다
        at = loc.endTag ? loc.endTag.startOffset : loc.endOffset;
    } else {
        throw new Error(`알 수 없는 삽입 위치: ${position}`);
    }

    // 그 줄의 들여쓰기를 따라가서 새 줄로 넣는다 (한 줄짜리 조각도 보기 좋게)
    const lineStart = source.lastIndexOf('\n', loc.startOffset - 1) + 1;
    const indent = (source.slice(lineStart, loc.startOffset).match(/^[ \t]*/) || [''])[0];
    const inner = (position === 'firstChild' || position === 'lastChild') ? indent + '    ' : indent;
    const body = String(html).trim().split('\n').map((l, i) => (i === 0 ? l : inner + l)).join('\n');
    let snippet = `\n${inner}${body}`;
    // 삽입 지점 뒤에 곧바로 다른 태그가 붙어 있으면 줄을 바꿔 준다 (…</div><h3> 방지)
    const rest = source.slice(at);
    if (position === 'lastChild') snippet += `\n${indent}`;
    else if (rest && !/^[ \t]*\n/.test(rest)) snippet += `\n${indent}`;

    return {
        text: source.slice(0, at) + snippet + source.slice(at),
        before: '(없음)',
        after: body.split('\n')[0].slice(0, 80),
        mode: 'insert'
    };
}

/**
 * 형제 사이에서 요소를 한 칸 위/아래로 옮긴다. (섹션 순서 바꾸기)
 *
 * 요소만 딱 바꾸면 바로 앞의 주석이 제자리에 남아 엉뚱한 섹션을 가리키게 된다.
 *   <!-- 2. INFO -->   <section A>   <!-- 3. VIDEO -->   <section B>
 * 그래서 '앞 여백(개행·들여쓰기·주석)까지 한 덩어리'로 보고 통째로 맞바꾼다.
 * 덩어리 시작 = 바로 앞 형제 요소의 끝(첫 요소면 부모 여는 태그의 끝).
 *
 * @param {string} source
 * @param {number[]} path  옮길 요소 경로 (findByPath 규칙)
 * @param {'up'|'down'} dir
 */
export function moveElement(source, path, dir = 'up') {
    const document = parse(source, { sourceCodeLocationInfo: true });
    const el = findByPath(document, path);
    if (!el) throw new Error('요소를 찾지 못했습니다. 파일이 그 사이 바뀌었을 수 있어요.');

    const parent = el.parentNode;
    if (!parent) throw new Error('바깥 요소가 없어 옮길 수 없습니다.');

    // 미리보기(bridge)와 '같은 규칙'으로 세야 화면과 파일이 어긋나지 않는다.
    // 눈에 안 보이는 태그는 순서에서 뺀다.
    const SKIP = /^(script|style|link|template|noscript)$/i;
    const sibs = (parent.childNodes || []).filter(n => isElement(n) && !SKIP.test(n.nodeName));
    const at = sibs.indexOf(el);
    const partner = dir === 'up' ? sibs[at - 1] : sibs[at + 1];
    if (!partner) throw new Error(dir === 'up' ? '이미 맨 위입니다.' : '이미 맨 아래입니다.');

    // 항상 (앞선 것, 뒤선 것) 순으로 정렬해서 두 덩어리를 맞바꾼다
    const [first, second] = dir === 'up' ? [partner, el] : [el, partner];
    const firstLoc = first.sourceCodeLocation, secondLoc = second.sourceCodeLocation;
    if (!firstLoc || !secondLoc) throw new Error('요소의 원본 위치를 알 수 없습니다.');

    // 앞 덩어리의 시작점 — 그 앞 형제의 끝, 없으면 부모 여는 태그의 끝
    const prev = sibs[sibs.indexOf(first) - 1];
    const head = prev
        ? prev.sourceCodeLocation.endOffset
        : (parent.sourceCodeLocation?.startTag?.endOffset ?? firstLoc.startOffset);

    const blockA = source.slice(head, firstLoc.endOffset);          // 앞 여백 + 앞 요소
    const blockB = source.slice(firstLoc.endOffset, secondLoc.endOffset); // 앞 여백 + 뒤 요소

    const label = n => {
        const cls = (n.attrs || []).find(a => a.name === 'class');
        return n.nodeName + (cls ? '.' + cls.value.trim().split(/\s+/)[0] : '');
    };
    return {
        text: source.slice(0, head) + blockB + blockA + source.slice(secondLoc.endOffset),
        before: `${label(first)} → ${label(second)}`,
        after: `${label(second)} → ${label(first)}`,
        mode: 'move'
    };
}

/**
 * 요소를 지운다. 앞 여백(개행·들여쓰기·주석)까지 같이 걷어내야
 * 빈 줄과 주인 없는 주석이 남지 않는다. (moveElement 와 같은 '덩어리' 규칙)
 */
export function removeElement(source, path) {
    const document = parse(source, { sourceCodeLocationInfo: true });
    const el = findByPath(document, path);
    if (!el) throw new Error('요소를 찾지 못했습니다. 파일이 그 사이 바뀌었을 수 있어요.');
    const loc = el.sourceCodeLocation;
    if (!loc) throw new Error('요소의 원본 위치를 알 수 없습니다.');

    const parent = el.parentNode;
    const SKIP = /^(script|style|link|template|noscript)$/i;
    const sibs = (parent?.childNodes || []).filter(n => isElement(n) && !SKIP.test(n.nodeName));
    const prev = sibs[sibs.indexOf(el) - 1];
    const head = prev
        ? prev.sourceCodeLocation.endOffset
        : (parent?.sourceCodeLocation?.startTag?.endOffset ?? loc.startOffset);

    const cls = (el.attrs || []).find(a => a.name === 'class');
    return {
        text: source.slice(0, head) + source.slice(loc.endOffset),
        before: el.nodeName + (cls ? '.' + cls.value.trim().split(/\s+/)[0] : ''),
        after: '(지움)',
        mode: 'remove'
    };
}

/**
 * 요소를 그대로 하나 더 만들어 바로 뒤에 붙인다.
 * 원본 문자열을 그대로 복사하므로 들여쓰기·주석·따옴표 스타일이 유지된다.
 */
export function duplicateElement(source, path) {
    const document = parse(source, { sourceCodeLocationInfo: true });
    const el = findByPath(document, path);
    if (!el) throw new Error('요소를 찾지 못했습니다. 파일이 그 사이 바뀌었을 수 있어요.');
    const loc = el.sourceCodeLocation;
    if (!loc) throw new Error('요소의 원본 위치를 알 수 없습니다.');

    const block = source.slice(loc.startOffset, loc.endOffset);
    // 원본이 있던 줄의 들여쓰기를 그대로 따라간다
    const lineStart = source.lastIndexOf('\n', loc.startOffset - 1) + 1;
    const indent = (source.slice(lineStart, loc.startOffset).match(/^[ \t]*/) || [''])[0];

    const cls = (el.attrs || []).find(a => a.name === 'class');
    return {
        text: source.slice(0, loc.endOffset) + '\n' + indent + block + source.slice(loc.endOffset),
        before: el.nodeName + (cls ? '.' + cls.value.trim().split(/\s+/)[0] : ''),
        after: '(하나 더)',
        mode: 'duplicate'
    };
}

/**
 * <head> 에 <link> 나 <script> 를 한 줄 넣는다. 이미 있으면 그대로 둔다.
 * 블록(마스터 컴포넌트)을 페이지에 떨어뜨릴 때, 그 블록이 필요로 하는
 * 파일을 페이지가 스스로 불러오게 만드는 용도.
 *
 * @param {'css'|'js'} kind
 * @param {string} url   예: /blocks/hero.css
 * @returns {{text: string, added: boolean}}
 */
export function linkAsset(source, kind, url) {
    if (!url) return { text: source, added: false };
    if (source.includes(url)) return { text: source, added: false };   // 이미 걸려 있다

    const tag = kind === 'js'
        ? `<script src="${url}" defer></script>`
        : `<link rel="stylesheet" href="${url}">`;

    const doc = parse(source, { sourceCodeLocationInfo: true });
    let head = null, body = null;
    walk(doc, n => {
        if (n.nodeName === 'head' && n.sourceCodeLocation) head = n.sourceCodeLocation;
        if (n.nodeName === 'body' && n.sourceCodeLocation) body = n.sourceCodeLocation;
    });

    // 넣을 자리: </head> 바로 앞. head 가 없으면 <body> 앞.
    let at, indent = '    ';
    if (head && head.endTag) at = head.endTag.startOffset;
    else if (body && body.startTag) at = body.startTag.startOffset;
    else return { text: source, added: false };

    // 그 줄의 들여쓰기를 따라간다
    const lineStart = source.lastIndexOf('\n', at - 1) + 1;
    const cur = (source.slice(lineStart, at).match(/^[ \t]*/) || [''])[0];
    if (cur) indent = cur + (head && head.endTag ? '    ' : '');

    return { text: source.slice(0, at) + `${indent}${tag}\n` + source.slice(at), added: true };
}

/**
 * 요소 안의 글자를 바꾼다. 자식 태그가 없는 '잎' 요소만 다룬다.
 * (안에 <br> 이나 <span> 이 있는 경우까지 건드리면 구조가 깨진다)
 *
 * 여는 태그 끝 ~ 닫는 태그 시작 사이만 갈아끼우므로 속성·들여쓰기는 그대로 남는다.
 */
export function patchText(source, path, text) {
    const document = parse(source, { sourceCodeLocationInfo: true });
    const el = findByPath(document, path);
    if (!el) throw new Error('요소를 찾지 못했습니다. 파일이 그 사이 바뀌었을 수 있어요.');

    const loc = el.sourceCodeLocation;
    if (!loc || !loc.startTag || !loc.endTag) {
        throw new Error('여는/닫는 태그를 찾을 수 없어 글자를 바꿀 수 없습니다.');
    }
    const kids = (el.childNodes || []).filter(n => n.nodeName !== '#text');
    if (kids.length) throw new Error('안에 다른 태그가 있어 글자만 바꿀 수 없습니다.');

    const from = loc.startTag.endOffset;
    const to = loc.endTag.startOffset;
    const before = source.slice(from, to);
    // & < > 만 막는다. 사용자가 넣은 글자를 그대로 보이게 하는 최소한의 처리.
    const safe = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return {
        text: source.slice(0, from) + safe + source.slice(to),
        before: before.trim().slice(0, 60) || '(빈 글자)',
        after: safe.trim().slice(0, 60) || '(빈 글자)',
        mode: 'text'
    };
}

/**
 * 요소의 속성 하나를 바꾸거나(있으면) 새로 넣는다(없으면).
 * 이미지 src·영상 링크처럼 style 이 아닌 값을 고칠 때 쓴다.
 * value 가 null 이면 속성을 지운다.
 */
export function patchAttr(source, path, name, value) {
    const document = parse(source, { sourceCodeLocationInfo: true });
    const el = findByPath(document, path);
    if (!el) throw new Error('요소를 찾지 못했습니다. 파일이 그 사이 바뀌었을 수 있어요.');

    const loc = el.sourceCodeLocation;
    if (!loc || !loc.startTag) throw new Error('요소의 원본 위치를 알 수 없습니다.');

    const attrLoc = loc.attrs && loc.attrs[name.toLowerCase()];
    if (attrLoc) {
        const before = source.slice(attrLoc.startOffset, attrLoc.endOffset);
        let start = attrLoc.startOffset;
        let after;
        if (value == null) {
            after = '';
            while (start > 0 && /\s/.test(source[start - 1])) start--;
        } else {
            after = `${name}="${String(value).replace(/"/g, '&quot;')}"`;
        }
        return { text: source.slice(0, start) + after + source.slice(attrLoc.endOffset), before, after, mode: 'replace' };
    }

    if (value == null) return { text: source, before: '', after: '', mode: 'noop' };

    const tagText = source.slice(loc.startTag.startOffset, loc.startTag.endOffset);
    const closeLen = tagText.endsWith('/>') ? 2 : 1;
    const insertAt = loc.startTag.endOffset - closeLen;
    const needsSpace = !/\s$/.test(source.slice(0, insertAt));
    const inserted = `${needsSpace ? ' ' : ''}${name}="${String(value).replace(/"/g, '&quot;')}"`;

    return {
        text: source.slice(0, insertAt) + inserted + source.slice(insertAt),
        before: '(없음)',
        after: inserted.trim(),
        mode: 'insert'
    };
}

/**
 * 인터랙션 적용: 요소에 클래스를 붙이고, 필요한 CSS 를 <style> 끝에 한 번만 넣는다.
 * 같은 클래스를 또 적용해도 CSS 는 중복되지 않는다.
 */
/**
 * CSS 를 페이지의 마지막 <style> 블록 끝에 덧붙인다.
 * 첫 줄을 표시로 삼아 이미 들어 있으면 건너뛰므로, 같은 걸 두 번 넣어도 늘어나지 않는다.
 * (컴포넌트가 기대는 규칙을 함께 옮길 때도, 인터랙션 CSS 를 넣을 때도 이 경로를 쓴다)
 *
 * @returns {{text: string, added: boolean}}
 */
export function appendCss(source, css, label = '') {
    const body = String(css || '').trim();
    if (!body) return { text: source, added: false };
    const marker = body.split('\n')[0].trim();
    if (marker && source.includes(marker)) return { text: source, added: false };

    const doc = parse(source, { sourceCodeLocationInfo: true });
    let last = null;
    walk(doc, node => {
        if (node.nodeName === 'style' && node.sourceCodeLocation) {
            const t = node.childNodes && node.childNodes[0];
            if (t && t.sourceCodeLocation) last = t.sourceCodeLocation;
        }
    });
    if (!last) return { text: source, added: false };   // <style> 이 없으면 손대지 않는다

    let at = last.endOffset;
    while (at > last.startOffset && /\s/.test(source[at - 1])) at--;
    const head = label ? `\n\n        /* ${label} */\n` : '\n\n';
    const block = head + body.split('\n').map(l => '        ' + l).join('\n') + '\n';
    return { text: source.slice(0, at) + block + source.slice(at), added: true };
}

export function applyMotion(source, path, className, css) {
    let text = source;
    const notes = [];

    // 1) 요소에 클래스 추가 (className 이 비면 CSS 만 넣는 경우)
    if (className) {
        const document = parse(text, { sourceCodeLocationInfo: true });
        const el = findByPath(document, path);
        if (!el) throw new Error('요소를 찾지 못했습니다. 파일이 그 사이 바뀌었을 수 있어요.');
        const cls = getAttr(el, 'class');
        const has = cls && cls.value.split(/\s+/).includes(className);
        if (!has) {
            const next = cls ? (cls.value + ' ' + className).trim() : className;
            text = patchAttr(text, path, 'class', next).text;
            notes.push('+.' + className);
        }
    }

    // 2) CSS 를 페이지에 넣는다
    const r = appendCss(text, css, className ? `인터랙션: ${className}` : '');
    text = r.text;
    if (r.added) notes.push('+CSS');

    return { text, before: '(없음)', after: notes.join(' ') || '이미 적용됨', mode: 'motion' };
}
