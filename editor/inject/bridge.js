// 미리보기 iframe 안에서만 도는 스크립트.
// 서버가 HTML을 보낼 때 끼워 넣으며, 원본 파일에는 저장되지 않는다.
//
// 역할: 요소 고르기 / 현재 값 알려주기 / 미리보기 즉시 반영
// 실제 파일 저장은 부모(에디터 화면)가 서버에 요청한다.

(function () {
    'use strict';

    const PAGE = document.currentScript?.dataset.page
        || document.querySelector('script[data-page]')?.dataset.page || '';

    let picking = false;
    let selected = null;

    // ---------- 요소 경로 ----------
    // 서버(parse5)와 반드시 같은 규칙이어야 한다: <html>부터, '요소 노드만' 순번을 센다.
    function pathOf(el) {
        const path = [];
        let cur = el;
        while (cur && cur !== document.documentElement) {
            const parent = cur.parentElement;
            if (!parent) return null;
            path.unshift([...parent.children].indexOf(cur));
            cur = parent;
        }
        return cur === document.documentElement ? path : null;
    }

    function elementAtPath(path) {
        let cur = document.documentElement;
        for (const i of path) {
            cur = cur.children[i];
            if (!cur) return null;
        }
        return cur;
    }

    // ---------- 이 요소에 적용된 CSS 규칙 찾기 ----------
    // 같은 클래스 전체를 한 번에 고치고 싶을 때 쓸 후보들.
    function matchedRules(el, prop) {
        const hits = [];
        for (const sheet of document.styleSheets) {
            let rules;
            try { rules = sheet.cssRules; } catch { continue; }   // 외부 시트는 접근 불가
            if (!rules) continue;
            walkRules(rules, null);

            function walkRules(list, media) {
                for (const rule of list) {
                    // 주의: 요즘 브라우저는 일반 스타일 규칙에도 cssRules가 (빈 채로) 있다.
                    //      그래서 'cssRules 존재'만으로 @media 여부를 판단하면 안 된다.
                    //      selectorText 유무로 먼저 갈라야 한다.
                    if (!rule.selectorText) {
                        if (rule.cssRules) {                 // @media, @supports 등 그룹 규칙
                            const cond = rule.conditionText || rule.media?.mediaText || '';
                            walkRules(rule.cssRules, [media, cond].filter(Boolean).join(' and '));
                        }
                        continue;
                    }
                    // 중첩 CSS를 쓰는 경우 안쪽도 훑는다 (이 저장소는 아직 안 쓰지만 대비)
                    if (rule.cssRules && rule.cssRules.length) walkRules(rule.cssRules, media);

                    const value = rule.style?.getPropertyValue(prop);
                    if (!value) continue;
                    // 쉼표로 묶인 선택자 중 이 요소에 맞는 조각을 찾는다
                    for (const part of rule.selectorText.split(',').map(s => s.trim())) {
                        let ok = false;
                        try { ok = el.matches(part); } catch { }
                        if (!ok) continue;
                        hits.push({ selector: rule.selectorText.trim(), matchedPart: part, value: value.trim(), media });
                        break;
                    }
                }
            }
        }
        return hits;   // 뒤쪽일수록 우선순위가 높다
    }

    /**
     * 이 요소에 걸리는 규칙 전부 (속성과 무관).
     * padding 처럼 한 줄로 묶여 있고 안에 var() 가 있으면 브라우저가 padding-top 을
     * 따로 알려주지 못한다. 그때 '어느 규칙에 새로 넣을지' 고르기 위해 쓴다.
     */
    function rulesForElement(el) {
        const hits = [];
        for (const sheet of document.styleSheets) {
            let rules;
            try { rules = sheet.cssRules; } catch { continue; }
            if (!rules) continue;
            (function walkRules(list, media) {
                for (const rule of list) {
                    if (!rule.selectorText) {
                        if (rule.cssRules) {
                            const cond = rule.conditionText || rule.media?.mediaText || '';
                            walkRules(rule.cssRules, [media, cond].filter(Boolean).join(' and '));
                        }
                        continue;
                    }
                    if (rule.cssRules && rule.cssRules.length) walkRules(rule.cssRules, media);
                    for (const part of rule.selectorText.split(',').map(s => s.trim())) {
                        let ok = false;
                        try { ok = el.matches(part); } catch { }
                        if (!ok) continue;
                        hits.push({
                            selector: rule.selectorText.trim(),
                            matchedPart: part,
                            media,
                            // 편집 대상으로 얼마나 적합한지: 이 요소만 겨냥한 단순한 규칙일수록 높게
                            score: (media ? 0 : 100)
                                + (rule.selectorText.includes(',') ? 0 : 20)
                                + (part.split(/[ >+~]/).length === 1 ? 10 : 0)
                                + (part.startsWith('.') ? 5 : 0),
                        });
                        break;
                    }
                }
            })(rules, null);
        }
        return hits.sort((a, b) => b.score - a.score);
    }

    // ---------- 요소 정보 ----------
    const PROPS = [
        'font-size', 'line-height', 'font-weight', 'text-align', 'color',
        'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
        'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
        'gap', 'width', 'max-width', 'min-width', 'height',
        'display', 'flex-direction', 'justify-content', 'align-items',
        'border-radius', 'background-color', 'opacity',
    ];

    function describe(el) {
        const cs = getComputedStyle(el);
        const computed = {};
        for (const p of PROPS) computed[p] = cs.getPropertyValue(p).trim();

        const inline = {};
        for (const p of (el.getAttribute('style') || '').split(';')) {
            const i = p.indexOf(':');
            if (i > 0) inline[p.slice(0, i).trim()] = p.slice(i + 1).trim();
        }

        const rules = {};
        for (const p of PROPS) {
            const hits = matchedRules(el, p);
            if (hits.length) rules[p] = hits;
        }

        const r = el.getBoundingClientRect();
        return {
            page: PAGE,
            path: pathOf(el),
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            classes: [...el.classList],
            text: (el.textContent || '').trim().slice(0, 60),
            computed, inline, rules,
            elementRules: rulesForElement(el).slice(0, 8),
            rect: { w: Math.round(r.width), h: Math.round(r.height) },
            childCount: el.children.length,
        };
    }

    // ---------- 겉모습 (선택/호버 표시) ----------
    const style = document.createElement('style');
    style.textContent = `
        .__ed-hover { outline: 2px solid rgba(59,130,246,.55) !important; outline-offset: -2px !important; }
        .__ed-selected { outline: 2px solid #3B82F6 !important; outline-offset: -2px !important; }
        .__ed-picking, .__ed-picking * { cursor: crosshair !important; }
    `;
    document.documentElement.appendChild(style);

    let hovered = null;
    const clearHover = () => { hovered?.classList.remove('__ed-hover'); hovered = null; };

    document.addEventListener('mouseover', e => {
        if (!picking) return;
        clearHover();
        hovered = e.target;
        if (hovered !== selected) hovered.classList.add('__ed-hover');
    }, true);

    document.addEventListener('click', e => {
        if (!picking) return;
        e.preventDefault(); e.stopPropagation();
        select(e.target);
    }, true);

    function select(el) {
        selected?.classList.remove('__ed-selected');
        clearHover();
        selected = el;
        selected.classList.add('__ed-selected');
        post('selected', describe(el));
    }

    // ---------- 부모와 대화 ----------
    const post = (type, payload) => parent.postMessage({ source: '__hnkl_editor', type, payload }, '*');

    window.addEventListener('message', e => {
        const msg = e.data;
        if (!msg || msg.source !== '__hnkl_editor_host') return;
        const { type, payload } = msg;

        if (type === 'setPicking') {
            picking = !!payload;
            document.documentElement.classList.toggle('__ed-picking', picking);
            if (!picking) clearHover();
        }
        else if (type === 'preview') {
            // 미리보기 즉시 반영 (파일에는 아직 안 씀)
            const el = elementAtPath(payload.path);
            if (!el) return;
            for (const [prop, value] of Object.entries(payload.changes)) {
                if (value == null || value === '') el.style.removeProperty(prop);
                else el.style.setProperty(prop, value);
            }
            post('previewApplied', describe(el));
        }
        else if (type === 'previewCss') {
            // 규칙 단위 미리보기: 임시 <style>로 덮어씌운다
            let tag = document.getElementById('__ed-preview-css');
            if (!tag) {
                tag = document.createElement('style');
                tag.id = '__ed-preview-css';
                (document.head || document.documentElement).appendChild(tag);
            }
            tag.textContent = payload.css || '';
            if (selected) post('previewApplied', describe(selected));
        }
        else if (type === 'clearPreview') {
            const el = payload?.path ? elementAtPath(payload.path) : null;
            if (el && payload.props) for (const p of payload.props) el.style.removeProperty(p);
            const tag = document.getElementById('__ed-preview-css');
            if (tag) tag.textContent = '';
            if (selected) post('previewApplied', describe(selected));
        }
        else if (type === 'reselect') {
            const el = elementAtPath(payload.path);
            if (el) select(el);
        }
        else if (type === 'selectParent') {
            if (selected?.parentElement && selected.parentElement !== document.documentElement) {
                select(selected.parentElement);
            }
        }
        else if (type === 'highlight') showHighlight(payload.area);
        else if (type === 'clearHighlight') clearHighlight();
        else if (type === 'getDesignSystem') post('designSystem', collectDesignSystem());
        else if (type === 'ping') post('ready', { page: PAGE, title: document.title });
    });

    // ---------- 박스 모델 하이라이트 ----------
    function showHighlight(area) {
        if (!selected) return;
        const r = selected.getBoundingClientRect();
        const cs = getComputedStyle(selected);
        const mt = parseFloat(cs.marginTop) || 0,    mr = parseFloat(cs.marginRight) || 0;
        const mb = parseFloat(cs.marginBottom) || 0, ml = parseFloat(cs.marginLeft) || 0;
        const pt = parseFloat(cs.paddingTop) || 0,   pr = parseFloat(cs.paddingRight) || 0;
        const pb = parseFloat(cs.paddingBottom) || 0, pl = parseFloat(cs.paddingLeft) || 0;

        const bx = r.left, by = r.top, bw = r.width, bh = r.height;
        const cx = bx + pl, cy = by + pt, cw = bw - pl - pr, ch = bh - pt - pb;

        const mC = 'rgba(246,178,107,0.45)', pC = 'rgba(147,196,125,0.45)', cC = 'rgba(111,168,220,0.45)';

        let hl = document.getElementById('__ed-hl');
        if (!hl) {
            hl = document.createElement('div');
            hl.id = '__ed-hl';
            hl.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999;overflow:hidden;';
            document.documentElement.appendChild(hl);
        }

        const seg = (x, y, w, h, c) =>
            `<div style="position:fixed;left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${Math.max(0,w).toFixed(1)}px;height:${Math.max(0,h).toFixed(1)}px;background:${c};"></div>`;

        let html = '';
        if (area === 'margin') {
            const mx = bx - ml, my = by - mt, mw = bw + ml + mr, mh = bh + mt + mb;
            html += seg(mx, my, mw, mt, mC);
            html += seg(mx, by + bh, mw, mb, mC);
            html += seg(mx, by, ml, bh, mC);
            html += seg(bx + bw, by, mr, bh, mC);
        } else if (area === 'padding') {
            html += seg(bx, by, bw, pt, pC);
            html += seg(bx, cy + ch, bw, pb, pC);
            html += seg(bx, cy, pl, ch, pC);
            html += seg(cx + cw, cy, pr, ch, pC);
        } else if (area === 'content') {
            html += seg(cx, cy, cw, ch, cC);
        }
        hl.innerHTML = html;
    }

    function clearHighlight() {
        const hl = document.getElementById('__ed-hl');
        if (hl) hl.innerHTML = '';
    }

    // ---------- 디자인 시스템 추출 ----------

    /**
     * 타입 스케일은 CSS 규칙이 아니라 '실제로 그려진 DOM'에서 읽는다.
     * font-size 가 var()/clamp()/rem 으로 적혀 있어도 계산된 px 로 잡히기 때문.
     */
    function collectTypeScale() {
        const map = new Map();

        for (const node of document.querySelectorAll('body *')) {
            if (node.id === '__ed-hl' || node.tagName === 'SCRIPT' || node.tagName === 'STYLE') continue;
            // 자기 자신이 글자를 가진 요소만 (감싸는 컨테이너는 제외)
            const ownText = [...node.childNodes]
                .some(c => c.nodeType === 3 && c.textContent.trim());
            if (!ownText) continue;

            const cs = getComputedStyle(node);
            if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;

            const px = Math.round(parseFloat(cs.fontSize));
            if (!px) continue;
            const fw = String(cs.fontWeight || '400');
            const key = px + '|' + fw;

            if (!map.has(key)) {
                map.set(key, {
                    fontSize: px + 'px',
                    fontWeight: fw,
                    lineHeight: cs.lineHeight === 'normal' ? '' : cs.lineHeight,
                    selectors: [],
                });
            }
            const entry = map.get(key);
            if (entry.selectors.length < 3) {
                const cls = (node.getAttribute('class') || '')
                    .split(/\s+/).filter(c => c && !c.startsWith('__ed'))[0];
                const sel = cls ? '.' + cls : node.tagName.toLowerCase();
                if (!entry.selectors.includes(sel)) entry.selectors.push(sel);
            }
        }

        return [...map.values()].sort((a, b) =>
            parseFloat(b.fontSize) - parseFloat(a.fontSize) ||
            (+b.fontWeight || 400) - (+a.fontWeight || 400));
    }

    /** 값이 진짜 '색'인지 판별 (숫자, 길이, calc/clamp 는 걸러낸다) */
    const _probe = document.createElement('span');
    function resolveColor(v) {
        if (!v) return null;
        if (/^\s*(calc|clamp|min|max|var|url)\s*\(/i.test(v)) return null;
        if (/^-?[\d.]+(px|rem|em|%|vw|vh|s|ms|deg|fr)?$/i.test(v)) return null;
        _probe.style.color = '';
        _probe.style.color = v;
        if (!_probe.style.color) return null;
        document.documentElement.appendChild(_probe);
        const resolved = getComputedStyle(_probe).color;
        _probe.remove();
        return (resolved && resolved !== 'rgba(0, 0, 0, 0)') ? resolved : null;
    }

    function collectColorTokens() {
        const cssVars = {};
        for (const sheet of document.styleSheets) {
            let rules;
            try { rules = sheet.cssRules; } catch { continue; }
            if (!rules) continue;
            (function walk(list) {
                for (const rule of list) {
                    if (rule.cssRules) walk(rule.cssRules);
                    if (!rule.style || !rule.selectorText) continue;
                    if (rule.selectorText !== ':root' && rule.selectorText !== 'html') continue;
                    for (const p of rule.style) {
                        if (p.startsWith('--')) cssVars[p] = rule.style.getPropertyValue(p).trim();
                    }
                }
            })(rules);
        }

        const rootCS = getComputedStyle(document.documentElement);
        const tokens = [];
        for (const [name, raw] of Object.entries(cssVars)) {
            const declared = rootCS.getPropertyValue(name).trim() || raw;
            const value = resolveColor(declared);
            if (value) tokens.push({ name, raw: declared, value });
        }
        return tokens;
    }

    function collectDesignSystem() {
        return { fontStyles: collectTypeScale(), colorTokens: collectColorTokens() };
    }

    // ---------- 페이지 높이 보고 (한 번만) ----------
    // 측정 전에 vh 단위를 현재 뷰포트 기준 px로 고정한다.
    // → iframe을 이후 늘려도 min-height:100vh 같은 요소가 팽창하지 않는다.
    let _htReported = false;

    function freezeVhUnits() {
        const vpH = window.innerHeight;
        if (vpH < 50) return;
        const vhPx = vpH / 100;
        const replaceVh = v =>
            v.replace(/(-?[\d.]+)vh/g, (_, n) => (parseFloat(n) * vhPx).toFixed(1) + 'px');
        for (const sheet of document.styleSheets) {
            let rules;
            try { rules = sheet.cssRules; } catch { continue; }
            if (!rules) continue;
            (function walk(list) {
                for (const rule of list) {
                    if (rule.cssRules) walk(rule.cssRules);
                    if (!rule.style) continue;
                    for (const prop of [...rule.style]) {
                        const v = rule.style.getPropertyValue(prop);
                        if (!v.includes('vh')) continue;
                        rule.style.setProperty(prop, replaceVh(v), rule.style.getPropertyPriority(prop));
                    }
                }
            })(rules);
        }
    }

    function reportHeight() {
        if (_htReported) return;
        _htReported = true;
        freezeVhUnits();
        const h = Math.max(
            document.documentElement.scrollHeight,
            document.body ? document.body.scrollHeight : 0
        );
        if (h > 200) post('pageHeight', h);
    }
    if (document.readyState === 'complete') {
        setTimeout(reportHeight, 200);
    } else {
        window.addEventListener('load', () => setTimeout(reportHeight, 200));
    }

    // ---------- 스크롤 → 캔버스 이동 ----------
    window.addEventListener('wheel', e => {
        e.preventDefault();
        post('wheel', { dx: e.deltaX, dy: e.deltaY });
    }, { passive: false });

    // ---------- 가운데 마우스 패닝 (screenX/Y 는 프레임 간 좌표 통일) ----------
    let _midDown = false;
    document.addEventListener('mousedown', e => {
        if (e.button !== 1) return;
        e.preventDefault();
        _midDown = true;
        post('panStart', { sx: e.screenX, sy: e.screenY });
    }, true);
    document.addEventListener('mousemove', e => {
        if (!_midDown) return;
        post('panMove', { sx: e.screenX, sy: e.screenY });
    }, { capture: true, passive: true });
    document.addEventListener('mouseup', e => {
        if (e.button !== 1) return;
        _midDown = false;
        post('panEnd', {});
    }, true);

    post('ready', { page: PAGE, title: document.title });
})();
