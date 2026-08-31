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
        if (!Array.isArray(path)) return null;
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

    /**
     * 위·아래 형제와 눈에 보이는 간격을 잰다.
     * 텍스트 사이 간격은 보통 '위 요소의 margin-bottom + 아래 요소의 margin-top'이라
     * 둘을 따로 찾아다녀야 했다. 여기서 한 번에 계산해 인스펙터가 한 줄로 다루게 한다.
     */
    function neighborGaps(el) {
        const out = { up: null, down: null };
        const mine = el.getBoundingClientRect();
        const myCS = getComputedStyle(el);
        const prev = el.previousElementSibling, next = el.nextElementSibling;
        const label = n => n.tagName.toLowerCase() + (n.classList[0] ? '.' + n.classList[0] : '');

        if (prev && prev.offsetHeight >= 0) {
            const r = prev.getBoundingClientRect();
            out.up = {
                gap: Math.round(mine.top - r.bottom),          // 실제 눈에 보이는 틈
                path: pathOf(prev), name: label(prev),
                theirBottom: Math.round(parseFloat(getComputedStyle(prev).marginBottom)) || 0,
                myTop: Math.round(parseFloat(myCS.marginTop)) || 0,
            };
        }
        if (next) {
            const r = next.getBoundingClientRect();
            out.down = {
                gap: Math.round(r.top - mine.bottom),
                path: pathOf(next), name: label(next),
                theirTop: Math.round(parseFloat(getComputedStyle(next).marginTop)) || 0,
                myBottom: Math.round(parseFloat(myCS.marginBottom)) || 0,
            };
        }
        return out;
    }

    /** 간격 토큰(--space-*)의 지금 화면 기준 실제 px 값 */
    function spaceTokens() {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;visibility:hidden;height:0';
        document.body.appendChild(probe);
        const out = [];
        for (let i = 1; i <= 12; i++) {
            const name = `--space-${i}`;
            probe.style.marginTop = `var(${name})`;
            const px = Math.round(parseFloat(getComputedStyle(probe).marginTop)) || 0;
            if (px > 0) out.push({ name, label: `Gap ${i}`, px });
        }
        probe.remove();
        return out;
    }

    function describe(el) {
        const cs = getComputedStyle(el);
        // 사진의 '틀'(.ed-ph)은 부모다. 비율을 고치려면 부모를 알아야 한다.
        const par = el.parentElement;
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
        const parentInfo = par && par !== document.body
            ? { parentPath: pathOf(par), parentClasses: [...par.classList].filter(c => !c.startsWith('__ed')) }
            : {};
        return {
            ...parentInfo,
            page: PAGE,
            path: pathOf(el),
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            classes: [...el.classList],
            text: (el.textContent || '').trim().slice(0, 60),
            // 자식 태그 없이 글자만 들어 있으면 인스펙터에서 직접 고칠 수 있다
            textOnly: !el.children.length,
            // 위아래 이웃이 가진 여백 — 내 여백과 겹쳐(margin collapse) 큰 쪽만 보인다
            collapse: (() => {
                const p = el.previousElementSibling, n = el.nextElementSibling;
                const px = (e, prop) => e ? Math.round(parseFloat(getComputedStyle(e)[prop])) || 0 : 0;
                return { above: px(p, 'marginBottom'), below: px(n, 'marginTop') };
            })(),
            fullText: el.children.length ? '' : (el.textContent || ''),
            computed, inline, rules,
            elementRules: rulesForElement(el).slice(0, 8),
            rect: { w: Math.round(r.width), h: Math.round(r.height) },
            childCount: el.children.length,
            // 이미지·영상 링크를 인스펙터에서 바로 고치기 위해
            attrs: { src: el.getAttribute('src') || '', href: el.getAttribute('href') || '', alt: el.getAttribute('alt') || '' },
            // 위/아래 형제와의 '실제 간격' — 두 요소의 margin 을 따로 찾아다니지 않게
            neighbors: neighborGaps(el),
            spaceTokens: spaceTokens(),
        };
    }

    // ---------- 겉모습 (선택/호버 표시) ----------
    const style = document.createElement('style');
    style.id = '__ed-chrome';   // 컴포넌트를 뜰 때 이 스타일이 딸려가지 않도록 표시해 둔다
    style.textContent = `
        .__ed-hover { outline: 2px solid rgba(59,130,246,.55) !important; outline-offset: -2px !important; }
        /* 캐러셀 끝의 '한 장 더' — 에디터에서만 보인다 */
        .__ed-addcard {
            flex: 0 0 auto; align-self: stretch; min-width: 96px;
            border: 2px dashed rgba(59,130,246,.45); border-radius: 14px;
            background: rgba(59,130,246,.06); color: rgba(59,130,246,.85);
            font-size: 28px; font-weight: 300; line-height: 1; cursor: pointer;
        }
        .__ed-addcard:hover { background: rgba(59,130,246,.13); }
        .__ed-selected { outline: 2px solid #3B82F6 !important; outline-offset: -2px !important; }
        /* Shift 로 함께 고른 것 — 고른 것과 같은 급임을 보이려 같은 색, 조금 옅게 */
        .__ed-picked { outline: 2px solid rgba(59,130,246,.6) !important; outline-offset: -2px !important; }
        .__ed-picking, .__ed-picking * { cursor: crosshair !important; }
        /* 섹션 이동 모드 — 덩어리째 고르는 중이라 커서도 '집는' 모양으로 */
        .__ed-moving, .__ed-moving * { cursor: grab !important; }
        /* 이동 모드 — 어디까지가 한 덩어리인지 면으로 보여준다 (선만으로는 경계가 안 읽힘) */
        .__ed-move-hot {
            outline: 2px solid rgba(59,130,246,.5) !important; outline-offset: -2px !important;
            background-image: linear-gradient(rgba(59,130,246,.10), rgba(59,130,246,.10)) !important;
        }
        .__ed-move-pick {
            outline: 2px solid #3B82F6 !important; outline-offset: -2px !important;
            background-image: linear-gradient(rgba(59,130,246,.16), rgba(59,130,246,.16)) !important;
        }
        .__ed-dragging { opacity: .45 !important; }
        /* 인스펙터에서 여백에 손을 올리면, 그 여백이 페이지의 어디인지 색으로 짚어 준다 */
        .__ed-boxhint {
            position: absolute; z-index: 2147483644; pointer-events: none; border-radius: 2px;
        }
        .__ed-boxhint--margin  { background: rgba(79,209,197,.38); outline: 1px solid rgba(79,209,197,.7); }
        .__ed-boxhint--padding { background: rgba(59,130,246,.34); outline: 1px solid rgba(59,130,246,.7); }
        /* 글자 고치는 중 — 어디를 고치고 있는지 분명히 */
        .__ed-editing {
            outline: 2px solid #16a34a !important; outline-offset: -2px !important;
            background-image: linear-gradient(rgba(22,163,74,.08), rgba(22,163,74,.08)) !important;
            cursor: text !important;
        }
        /* 놓을 자리 — 섹션 사이에 굵은 선으로 */
        .__ed-move-line {
            position: absolute; z-index: 2147483646; height: 4px; border-radius: 2px;
            background: #3B82F6; box-shadow: 0 0 0 4px rgba(59,130,246,.18); pointer-events: none;
        }
        .__ed-movebar {
            position: absolute; z-index: 2147483647; display: flex; gap: 6px;
            padding: 6px; border-radius: 999px; background: rgba(20,20,24,.92);
            box-shadow: 0 8px 24px rgba(0,0,0,.28); font: 500 13px/1 system-ui, sans-serif;
        }
        .__ed-movebar button {
            all: unset; cursor: pointer; width: 30px; height: 30px; border-radius: 999px;
            display: flex; align-items: center; justify-content: center; color: #fff;
        }
        .__ed-movebar button:hover { background: rgba(255,255,255,.16); }
        .__ed-movebar button[disabled] { opacity: .3; cursor: default; }
        .__ed-movebar span { color: rgba(255,255,255,.72); padding: 0 8px; align-self: center; white-space: nowrap; }
    `;
    document.documentElement.appendChild(style);

    let hovered = null;
    const clearHover = () => { hovered?.classList.remove('__ed-hover', '__ed-move-hot'); hovered = null; };

    document.addEventListener('mouseover', e => {
        if (moving) {
            if (e.target.closest && e.target.closest('.__ed-movebar')) return;
            clearHover();
            const b = topBlockOf(e.target);
            if (b && b !== moveTarget) { hovered = b; b.classList.add('__ed-move-hot'); }
            return;
        }
        if (!picking) return;
        clearHover();
        hovered = e.target;
        if (hovered !== selected) hovered.classList.add('__ed-hover');
    }, true);

    document.addEventListener('click', e => {
        if (editing && editing.contains(e.target)) return;   // 글자 고치는 중엔 선택하지 않는다
        // 에디터가 얹어 둔 것(캐러셀의 '한 장 더' 등)은 페이지 요소가 아니다.
        // 여기서 걸러내지 않으면 잡는 단계에서 먼저 채가 제 일을 못 한다.
        if (e.target.closest && e.target.closest('.__ed-addcard')) return;
        if (moving) {
            if (e.target.closest && e.target.closest('.__ed-movebar')) return;  // 화살표는 그대로 통과
            e.preventDefault(); e.stopPropagation();
            const b = topBlockOf(e.target);
            if (b) setMoveTarget(b);
            return;
        }
        if (!picking) return;
        // 캐러셀 화살표는 눌러서 넘겨봐야 하므로 선택보다 우선한다
        if (e.target.closest && e.target.closest('[data-carousel-prev],[data-carousel-next]')) return;
        e.preventDefault(); e.stopPropagation();
        if (e.shiftKey && selected) addPick(e.target);
        else select(e.target);
    }, true);

    let picked = [];      // Shift 로 함께 고른 것들 (selected 포함)

    function clearPicked() {
        picked.forEach(n => n.classList.remove('__ed-picked'));
        picked = [];
    }

    function select(el) {
        // 사진 자리(.ed-ph)를 누르면 껍데기가 아니라 그 안의 사진·영상이 잡혀야 한다.
        // 껍데기가 잡히면 인스펙터에 '미디어' 칸이 아예 안 뜬다.
        if (el.classList?.contains('ed-ph')) {
            const inner = el.querySelector(':scope > img, :scope > video, :scope > iframe');
            if (inner) el = inner;
        }
        clearBoxHint();
        clearPicked();
        selected?.classList.remove('__ed-selected');
        clearHover();
        selected = el;
        selected.classList.add('__ed-selected');
        post('selected', describe(el));
    }

    /**
     * Shift 로 하나 더 고른다. 같은 부모의 형제만 받는다 —
     * 급이 다른 것을 섞으면 '사이 간격'이라는 말이 뜻을 잃기 때문이다.
     */
    function addPick(el) {
        if (!selected || el === selected) return;
        if (el.parentElement !== selected.parentElement) {
            post('pickRejected', { reason: 'not-sibling' });
            return;
        }
        const i = picked.indexOf(el);
        if (i >= 0) { picked.splice(i, 1); el.classList.remove('__ed-picked'); }
        else { picked.push(el); el.classList.add('__ed-picked'); }
        sendPicks();
    }

    /** 고른 것들과 그 사이 간격을 알려 준다 */
    function sendPicks() {
        const all = [selected, ...picked].filter(Boolean);
        // 화면에 놓인 순서대로 (부모의 자식 순서)
        const kids = [...selected.parentElement.children];
        all.sort((a, b) => kids.indexOf(a) - kids.indexOf(b));

        const gaps = [];
        for (let i = 0; i < all.length - 1; i++) {
            const a = all[i].getBoundingClientRect(), b = all[i + 1].getBoundingClientRect();
            gaps.push({
                px: Math.round(b.top - a.bottom),                    // 눈에 보이는 거리
                path: pathOf(all[i + 1]),
                marginTop: getComputedStyle(all[i + 1]).marginTop,
            });
        }
        post('picked', {
            count: all.length,
            items: all.map(el => ({
                path: pathOf(el),
                tag: el.tagName.toLowerCase(),
                classes: [...el.classList].filter(c => !c.startsWith('__ed')),
            })),
            gaps,
        });
    }

    /**
     * 이 페이지의 CSS 가 알고 있는 클래스 이름 전부.
     * 다른 페이지에서 만든 컴포넌트를 넣을 때, 기대는 클래스가 여기 없으면 모양이 깨진다.
     */
    /** 이 페이지가 정의한 CSS 변수(디자인 토큰) 이름 — 컴포넌트가 기대는 토큰이 있는지 확인용 */
    /**
     * 페이지 전체를 정하는 토큰들의 원문과 지금 값.
     * calc(1280px * var(--vb-s)) 같은 식이라 계산 결과만으로는 기준값을 알 수 없어
     * :root 규칙에 적힌 문자열을 그대로 읽는다.
     */
    /**
     * 페이지 전체를 정하는 토큰들.
     * 커스텀 속성의 computed value 는 계산 결과가 아니라 적힌 글자 그대로다
     * (calc(1280px * clamp(...)) 처럼). 그래서 이것만 읽으면 기준값을 알 수 있다.
     */
    // 페이지 배경을 '실제로' 칠하는 게 누구인지 찾는다.
    // --bg-color 토큰만 보면, 이 페이지처럼 html 에 색을 직접 박아 둔 경우
    // 토큰을 바꿔도 화면이 그대로라 "왜 안 되지?" 가 된다.
    function pageBg() {
        const clear = v => !v || v === 'transparent' || v === 'rgba(0, 0, 0, 0)';
        for (const [sel, el] of [['html', document.documentElement], ['body', document.body]]) {
            if (!el) continue;
            const cs = getComputedStyle(el);
            const img = cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage : '';
            if (clear(cs.backgroundColor) && !img) continue;
            return { selector: sel, color: cs.backgroundColor, hasImage: !!img };
        }
        return { selector: 'body', color: '', hasImage: false };
    }

    function pageTokens() {
        const want = ['--vb-maxw', '--vb-gap', '--vb-pad-block', '--vb-s', '--bg-color'];
        const cs = getComputedStyle(document.documentElement);
        const now = {};
        for (const n of want) {
            const v = cs.getPropertyValue(n).trim();
            if (v) now[n] = v;
        }
        return { now };
    }

    function pageVars() {
        const out = new Set();
        // 커스텀 속성은 CSSOM 목록에 안 나오므로 글자에서 뽑는다
        for (const sheet of document.styleSheets) {
            let rules; try { rules = sheet.cssRules; } catch { continue; }
            if (!rules) continue;
            const scan = list => {
                for (const r of list) {
                    if (r.cssRules) { scan(r.cssRules); continue; }
                    for (const m of (r.cssText || '').matchAll(/(--[\w-]+)\s*:/g)) out.add(m[1]);
                }
            };
            scan(rules);
        }
        return [...out];
    }

    function pageClasses() {
        const out = new Set();
        for (const sheet of document.styleSheets) {
            let rules;
            try { rules = sheet.cssRules; } catch { continue; }   // 남의 도메인 스타일시트는 못 읽는다
            if (!rules) continue;
            const scan = list => {
                for (const r of list) {
                    if (r.selectorText) {
                        for (const m of r.selectorText.matchAll(/\.([A-Za-z_][-\w]*)/g)) out.add(m[1]);
                    }
                    if (r.cssRules) scan(r.cssRules);   // @media 안쪽도 본다
                }
            };
            scan(rules);
        }
        return [...out];
    }

    /**
     * 이 덩어리에 실제로 적용되는 CSS 규칙을 순서대로 모은다.
     *
     * 까다로운 점 두 가지:
     *  1) :hover · :focus-visible 같은 상태 규칙은 matches() 로 안 잡힌다
     *     → 선택자에서 상태 부분을 떼고 맞춰 본 뒤, 규칙은 원래대로 담는다.
     *  2) @media 안의 규칙은 조건까지 살려야 반응형이 따라온다.
     * 파일에 적힌 순서를 지켜야 덮어쓰기 관계가 깨지지 않으므로, 시트 순회 순서를 그대로 쓴다.
     */
    function collectCss(root) {
        const nodes = [root, ...root.querySelectorAll('*')];
        const hit = sel => {
            // 상태·의사요소를 걷어낸 형태로 검사 (":hover", "::after", ":not(...)" 등)
            const plain = sel
                .replace(/::[a-z-]+(\([^)]*\))?/gi, '')
                .replace(/:(hover|focus|focus-visible|active|visited|target|checked|disabled|first-of-type|last-child|first-child|nth-child\([^)]*\))/gi, '')
                .trim();
            if (!plain) return false;
            for (const n of nodes) {
                try { if (n.matches(plain)) return true; } catch { /* 못 읽는 선택자는 건너뛴다 */ }
            }
            return false;
        };

        const out = [];        // { css, media } — 나온 순서 그대로
        const seen = new Set();
        const scan = (rules, media) => {
            for (const r of rules) {
                if (r.type === 4 /* @media */) {
                    scan(r.cssRules || [], media ? `${media} and ${r.conditionText}` : r.conditionText);
                    continue;
                }
                if (r.cssRules && !r.selectorText) { scan(r.cssRules, media); continue; }   // @supports 등
                if (!r.selectorText) continue;
                // 쉼표로 묶인 선택자는 우리 덩어리에 걸리는 것만 남긴다 (남의 규칙까지 끌고 오지 않게)
                const parts = r.selectorText.split(',').map(x => x.trim()).filter(Boolean);
                // *, html, body, :root 같은 페이지 전체 규칙은 덩어리의 스타일이 아니다.
                // 함께 옮기면 대상 페이지의 기본값까지 덮어써 버린다.
                const GLOBAL = /^(\*|html|body|:root|:where\(html\))$/i;
                const keep = parts.filter(sel => !GLOBAL.test(sel) && hit(sel));
                if (!keep.length) continue;
                const text = `${keep.join(', ')} { ${r.style.cssText} }`;
                const key = media + '|' + text;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({ css: text, media: media || '' });
            }
        };

        for (const sheet of document.styleSheets) {
            // 에디터가 미리보기용으로 끼워 넣은 시트는 컴포넌트의 것이 아니다
            const id = sheet.ownerNode && sheet.ownerNode.id;
            if (id && id.startsWith('__ed-')) continue;
            let rules;
            try { rules = sheet.cssRules; } catch { continue; }
            if (rules) scan(rules, '');
        }

        // @media 는 조건별로 다시 묶는다
        const plain = out.filter(r => !r.media).map(r => r.css);
        const byMedia = new Map();
        for (const r of out.filter(r => r.media)) {
            if (!byMedia.has(r.media)) byMedia.set(r.media, []);
            byMedia.get(r.media).push(r.css);
        }
        const chunks = [...plain];
        for (const [cond, list] of byMedia) {
            chunks.push(`@media ${cond} {\n${list.map(c => '    ' + c).join('\n')}\n}`);
        }
        return { text: chunks.join('\n'), count: out.length };
    }

    /** 이 덩어리가 쓰는 CSS 변수 이름들 (디자인 시스템 토큰이 필요한지 알려준다) */
    function usedVars(cssText) {
        return [...new Set([...String(cssText).matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]))];
    }

    // ---------- 여백이 페이지의 어디인지 짚어 주기 ----------
    // 인스펙터의 간격 판에 손을 올리면 그 자리에 색을 덮는다.
    // 숫자만 봐서는 '이 144px 가 어디인지' 알 수 없기 때문이다.
    let boxHints = [];
    function clearBoxHint() { boxHints.forEach(n => n.remove()); boxHints = []; }

    function showBoxHint(path, part, side) {
        clearBoxHint();
        const el = elementAtPath(path);
        if (!el || !part) return;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const num = n => parseFloat(cs.getPropertyValue(n)) || 0;
        const sx = window.scrollX, sy = window.scrollY;

        // margin 은 요소 바깥, padding 은 요소 안쪽에 그린다
        const band = (x, y, w, h) => {
            if (w <= 0 || h <= 0) return;
            const d = document.createElement('div');
            d.className = `__ed-boxhint __ed-boxhint--${part}`;
            d.style.cssText = `left:${sx + x}px;top:${sy + y}px;width:${w}px;height:${h}px`;
            document.body.appendChild(d);
            boxHints.push(d);
        };
        const sides = side ? [side] : ['top', 'right', 'bottom', 'left'];
        for (const sd of sides) {
            const v = num(`${part}-${sd}`);
            if (!v) continue;
            if (part === 'margin') {
                if (sd === 'top')    band(r.left, r.top - v, r.width, v);
                if (sd === 'bottom') band(r.left, r.bottom, r.width, v);
                if (sd === 'left')   band(r.left - v, r.top, v, r.height);
                if (sd === 'right')  band(r.right, r.top, v, r.height);
            } else {
                if (sd === 'top')    band(r.left, r.top, r.width, v);
                if (sd === 'bottom') band(r.left, r.bottom - v, r.width, v);
                if (sd === 'left')   band(r.left, r.top, v, r.height);
                if (sd === 'right')  band(r.right - v, r.top, v, r.height);
            }
        }
        // 짚은 자리가 화면 밖이면 보이도록 끌어온다
        if (boxHints.length) {
            const first = boxHints[0].getBoundingClientRect();
            if (first.bottom < 0 || first.top > window.innerHeight) {
                el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        }
    }

    // ---------- 미리보기에서 글자 바로 고치기 ----------
    // 요소를 두 번 누르면 그 자리에서 글자를 고친다. Enter 나 바깥을 누르면 확정, Esc 면 취소.
    // 자식 태그가 없는 '잎' 요소만 다룬다 — 안에 <br>·<span> 이 있으면 구조가 깨진다.
    let editing = null, editBefore = '';

    function canEditText(el) {
        return el && el.nodeType === 1 && !el.children.length
            && !/^(IMG|VIDEO|IFRAME|INPUT|TEXTAREA|SELECT|BR|HR|SVG|PATH)$/i.test(el.tagName)
            && (el.textContent || '').trim().length > 0;
    }

    function startTextEdit(el) {
        if (editing) endTextEdit(true);
        editing = el;
        editBefore = el.textContent;
        el.classList.add('__ed-editing');
        el.setAttribute('contenteditable', 'plaintext-only');
        el.focus();
        // 글자 전체를 잡아 둔다 (바로 새로 쓸 수 있게)
        const r = document.createRange();
        r.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(r);
        post('textEditing', { path: pathOf(el), on: true });
    }

    function endTextEdit(commit) {
        if (!editing) return;
        const el = editing;
        editing = null;
        const value = (el.textContent || '');
        el.removeAttribute('contenteditable');
        el.classList.remove('__ed-editing');
        if (!commit) { el.textContent = editBefore; post('textEditing', { on: false }); return; }
        if (value === editBefore) { post('textEditing', { on: false }); return; }
        post('textEdited', { path: pathOf(el), value });
        setTimeout(reportHeight, 80);
    }

    document.addEventListener('dblclick', e => {
        if (!picking || moving) return;
        const el = e.target;
        if (!canEditText(el)) return;
        e.preventDefault(); e.stopPropagation();
        startTextEdit(el);
    }, true);

    document.addEventListener('keydown', e => {
        if (!editing) return;
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); endTextEdit(true); }
        else if (e.key === 'Escape') { e.preventDefault(); endTextEdit(false); }
    }, true);

    // 편집 중 다른 곳을 누르면 확정 (선택 핸들러보다 먼저 잡는다)
    document.addEventListener('mousedown', e => {
        if (editing && !editing.contains(e.target)) endTextEdit(true);
    }, true);

    // ---------- 고른 것을 컴포넌트로 뜨기 ----------
    /**
     * 선택한 요소의 HTML 을 '저장해도 되는 상태'로 만들어 돌려준다.
     * 미리보기에만 존재하는 흔적(선택 테두리 클래스, reveal 을 풀어둔 인라인 스타일,
     * 삽입 표시)을 지워야 다음에 다시 넣었을 때 원래 모습이 나온다.
     */
    function cleanHtml(el) {
        const c = el.cloneNode(true);
        const strip = n => {
            if (!n.classList) return;
            n.classList.remove('__ed-selected', '__ed-hover', '__ed-move-pick');
            if (!n.classList.length) n.removeAttribute('class');
            n.removeAttribute('data-ed-inserted');
            n.removeAttribute('contenteditable');
            n.classList.remove('__ed-editing');
            // revealNow 가 눈에 보이게 하려고 넣은 값만 되돌린다 (원래는 CSS 가 맡는다)
            if (n.classList && n.classList.contains('reveal')) {
                if (n.style.opacity === '1') n.style.removeProperty('opacity');
                if (n.style.transform === 'none') n.style.removeProperty('transform');
            }
            if (n.getAttribute && n.getAttribute('style') === '') n.removeAttribute('style');
        };
        strip(c);
        c.querySelectorAll('*').forEach(strip);
        return c.outerHTML;
    }

    /** 컴포넌트 카드에 그릴 뼈대 — 자식들의 크기 비율만 네모로 옮긴다 */
    function sketch(el) {
        const box = el.getBoundingClientRect();
        if (!box.width || !box.height) return [];
        const kids = [...el.children].slice(0, 8);
        const src = kids.length ? kids : [el];
        return src.map(k => {
            const r = k.getBoundingClientRect();
            return {
                x: +(((r.left - box.left) / box.width) * 140).toFixed(1),
                y: +(((r.top - box.top) / box.height) * 54).toFixed(1),
                w: +((r.width / box.width) * 140).toFixed(1),
                h: +((r.height / box.height) * 54).toFixed(1),
            };
        }).filter(r => r.w > 1 && r.h > 0.5);
    }

    // ---------- 섹션 이동 (최상위 덩어리 순서 바꾸기) ----------
    // 페이지의 큰 흐름을 바꾸는 일이라, 안쪽 요소가 아니라 '가장 바깥 블록'만 고른다.
    let moving = false, moveTarget = null, moveBar = null;
    const moveHistory = [];   // 되돌리기용 — 에디터의 pending 과 같은 순서로 쌓인다
    const blockHistory = [];  // 지우기·복제 되돌리기용 (지운 노드를 들고 있다가 제자리에 꽂는다)

    /** 최상위 블록들 = <main> 직속(없으면 body 직속). 스크립트·스타일은 뺀다 */
    function topBlocks() {
        const host = document.querySelector('main') || document.body;
        return [...host.children].filter(n => !/^(SCRIPT|STYLE|LINK|TEMPLATE|NOSCRIPT)$/.test(n.tagName));
    }
    /** 어디를 눌렀든 그게 속한 최상위 블록으로 올라간다 */
    function topBlockOf(el) {
        const blocks = topBlocks();
        let cur = el;
        while (cur && !blocks.includes(cur)) cur = cur.parentElement;
        return cur || null;
    }
    function hideMoveBar() {
        moveTarget?.classList.remove('__ed-move-pick');
        moveTarget = null;
        moveBar?.remove(); moveBar = null;
    }
    function placeMoveBar() {
        if (!moveTarget) return;
        if (!moveBar) {
            moveBar = document.createElement('div');
            moveBar.className = '__ed-movebar';
            moveBar.innerHTML =
                '<button data-dir="up" title="Move up">\u2191</button>' +
                '<span></span>' +
                '<button data-dir="down" title="Move down">\u2193</button>';
            moveBar.addEventListener('click', onMoveClick, true);
            document.body.appendChild(moveBar);
        }
        const blocks = topBlocks();
        const i = blocks.indexOf(moveTarget);
        moveBar.querySelector('[data-dir=up]').disabled = i <= 0;
        moveBar.querySelector('[data-dir=down]').disabled = i < 0 || i >= blocks.length - 1;
        moveBar.querySelector('span').textContent = `${i + 1} / ${blocks.length}`;
        const r = moveTarget.getBoundingClientRect();
        moveBar.style.top = (window.scrollY + Math.max(r.top, 8) + 8) + 'px';
        moveBar.style.left = (window.scrollX + r.right - 150) + 'px';
    }
    function setMoveTarget(el) {
        moveTarget?.classList.remove('__ed-move-pick');
        clearHover();
        moveTarget = el;
        moveTarget.classList.add('__ed-move-pick');
        placeMoveBar();
    }
    // ── 끌어서 순서 바꾸기 ──
    // 이동 모드에서는 최상위 블록을 통째로 끌 수 있다. 놓을 자리는 굵은 선으로 미리 보여준다.
    let dragEl = null, moveLine = null, moveDropAt = null;

    function showMoveLine(before, after) {
        if (!moveLine) {
            moveLine = document.createElement('div');
            moveLine.className = '__ed-move-line';
            document.body.appendChild(moveLine);
        }
        // 두 블록 사이(또는 끝)의 y 좌표를 잡는다
        const ref = before || after;
        const r = ref.getBoundingClientRect();
        const y = before ? r.bottom : r.top;
        moveLine.style.top = (window.scrollY + y - 2) + 'px';
        moveLine.style.left = (window.scrollX + r.left) + 'px';
        moveLine.style.width = r.width + 'px';
    }
    function hideMoveLine() { moveLine?.remove(); moveLine = null; moveDropAt = null; }

    document.addEventListener('mousedown', e => {
        if (!moving) return;
        if (e.target.closest && e.target.closest('.__ed-movebar')) return;
        const b = topBlockOf(e.target);
        if (!b) return;
        dragEl = b;
        dragEl.__startY = e.clientY;
    }, true);

    document.addEventListener('mousemove', e => {
        if (!moving || !dragEl) return;
        // 살짝 눌린 것만으로 끌기로 오해하지 않게, 어느 정도 움직여야 시작한다
        if (!dragEl.classList.contains('__ed-dragging')) {
            if (Math.abs(e.clientY - dragEl.__startY) < 6) return;
            dragEl.classList.add('__ed-dragging');
        }
        e.preventDefault();
        const blocks = topBlocks().filter(b => b !== dragEl);
        let before = null, after = null;
        for (const b of blocks) {
            const r = b.getBoundingClientRect();
            if (e.clientY >= r.top + r.height / 2) before = b;
            else { after = b; break; }
        }
        moveDropAt = { before, after };
        if (before || after) showMoveLine(before, after);
    }, true);

    document.addEventListener('mouseup', e => {
        if (!moving || !dragEl) return;
        const wasDragging = dragEl.classList.contains('__ed-dragging');
        const el = dragEl;
        el.classList.remove('__ed-dragging');
        dragEl = null;
        if (!wasDragging) { hideMoveLine(); return; }   // 그냥 클릭이면 선택만 (click 핸들러가 처리)
        e.preventDefault(); e.stopPropagation();

        const at = moveDropAt;
        hideMoveLine();
        if (!at || (!at.before && !at.after)) return;

        const before = topBlocks().indexOf(el);
        // 놓을 자리로 옮기고, 파일에는 '한 칸씩 이동'을 그만큼 쌓아 보낸다
        if (at.before) at.before.parentNode.insertBefore(el, at.before.nextSibling);
        else at.after.parentNode.insertBefore(el, at.after);
        const after = topBlocks().indexOf(el);
        if (before === after) return;

        const dir = after > before ? 'down' : 'up';
        const steps = Math.abs(after - before);
        // 되돌리기는 한 칸씩 무르므로, 옮긴 칸 수만큼 이력을 쌓아 에디터의 pending 과 짝을 맞춘다
        for (let i = 0; i < steps; i++) moveHistory.push({ el, dir });
        post('movedMany', { from: before, steps, dir });
        setMoveTarget(el);
        setTimeout(reportHeight, 80);
    }, true);

    function onMoveClick(e) {
        const btn = e.target.closest('button[data-dir]');
        if (!btn || btn.disabled || !moveTarget) return;
        e.preventDefault(); e.stopPropagation();
        const dir = btn.dataset.dir;
        const blocks = topBlocks();
        const i = blocks.indexOf(moveTarget);
        const partner = dir === 'up' ? blocks[i - 1] : blocks[i + 1];
        if (!partner) return;
        // 파일 수정은 '옮기기 전' 경로 기준이라, DOM 을 건드리기 전에 먼저 읽는다
        const path = pathOf(moveTarget);
        if (dir === 'up') partner.parentNode.insertBefore(moveTarget, partner);
        else partner.parentNode.insertBefore(partner, moveTarget);
        moveHistory.push({ el: moveTarget, dir });
        post('moved', { path, dir });
        placeMoveBar();
        moveTarget.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setTimeout(reportHeight, 80);
    }

    /**
     * 삽입한 요소를 즉시 보이게 한다.
     * vibra 의 .reveal 은 opacity:0 으로 시작해 스크롤 애니메이션이 켜주는데,
     * 나중에 끼워 넣은 노드는 그 등록을 못 받아 계속 투명하다.
     * (미리보기 화면에서만 인라인으로 풀어주고, 저장되는 HTML 에는 안 들어간다)
     */
    function revealNow(root) {
        const fix = n => {
            if (!n.classList || !n.classList.contains('reveal')) return;
            n.style.opacity = '1';
            n.style.transform = 'none';
        };
        fix(root);
        root.querySelectorAll && root.querySelectorAll('.reveal').forEach(fix);
    }

    /**
     * 인터랙션이 붙었는지 눈으로 확인시켜 준다.
     * 호버·클릭 효과는 마우스를 올려야 보여서, 적용 직후엔 화면에 아무 변화가 없다.
     * → 테두리로 대상을 표시하고, 그 효과를 한 번 실제로 재생해 보여준다.
     */
    function demoMotion(el, className) {
        const badge = document.createElement('div');
        badge.textContent = 'Interaction applied · ' + className.replace('ed-', '');
        badge.style.cssText =
            'position:absolute;z-index:2147483647;background:#3B82F6;color:#fff;' +
            'font:600 11px/1.7 system-ui,sans-serif;padding:2px 8px;border-radius:6px;' +
            'pointer-events:none;transition:opacity .3s;box-shadow:0 2px 8px rgba(0,0,0,.25)';
        const r = el.getBoundingClientRect();
        badge.style.top = (r.top + window.scrollY - 24) + 'px';
        badge.style.left = (r.left + window.scrollX + 6) + 'px';
        document.body.appendChild(badge);

        const prevOutline = el.style.outline;
        el.style.outline = '2px solid #3B82F6';
        el.style.outlineOffset = '-2px';

        // 효과 한 번 시연 (호버/클릭 상태를 흉내)
        const prevT = el.style.transition, prevX = el.style.transform;
        el.style.transition = 'transform .32s cubic-bezier(.2,.7,.3,1), box-shadow .32s ease';
        if (className.includes('grow')) el.style.transform = 'scale(1.04)';
        else if (className.includes('lift')) el.style.transform = 'translateY(-8px)';
        else if (className.includes('pulse')) el.style.transform = 'scale(.96)';
        setTimeout(() => { el.style.transform = prevX || ''; }, 420);
        setTimeout(() => {
            el.style.transition = prevT || '';
            el.style.outline = prevOutline || '';
            badge.style.opacity = '0';
            setTimeout(() => badge.remove(), 320);
        }, 1400);
    }

    // ---------- 섹션 간격 조절 핸들 ----------
    // 큰 덩어리(.vb-section) 사이 경계에 막대를 띄우고, 끌어서 위아래 여백을 조절한다.
    //   전체 모드: --vb-pad-block 토큰을 바꿔 모든 섹션이 함께 움직인다
    //   개별 모드: 그 섹션에만 padding 을 덮어씌운다
    let gapOn = false, gapBars = [], gapScopeLocal = 'all';
    const GAP_SEL = '.vb-section';
// 섹션을 눈에 보이는 이름으로 부른다. 클래스 이름(sec-dark)은 디자이너가 알아볼 수 없다.
function sectionLabel(s, n) {
    // 제목을 하나씩 순서대로 찾는다. 한 번에 찾으면 라벨과 제목을 함께 담은
    // 껍데기가 걸려 "Interaction사용자의 행동을…" 처럼 붙어 나온다.
    // 제목은 "Interaction<br><span>부제</span>" 처럼 줄바꿈 뒤에 부제가 붙어 있다.
    // 첫 줄까지만 읽어야 이름이 된다.
    const firstLine = h => {
        let t = '';
        for (const n of h.childNodes) {
            if (n.nodeName === 'BR') break;
            t += n.textContent || '';
        }
        return t.replace(/\s+/g, ' ').trim() || (h.textContent || '').replace(/\s+/g, ' ').trim();
    };
    let t = '';
    for (const sel of ['h2', 'h1', 'h3', '.vb-label']) {
        const h = s.querySelector(sel);
        if (h) t = firstLine(h);
        if (t) break;
    }
    if (!t) return 'Section ' + n;
    return t.length > 24 ? t.slice(0, 23) + '…' : t;
}

    function basePadPx() {
        const s = document.querySelector(GAP_SEL);
        return s ? Math.round(parseFloat(getComputedStyle(s).paddingTop)) || 0 : 0;
    }
    function clearGapBars() {
        gapBars.forEach(b => b.remove());
        gapBars = [];
    }
    /**
     * 섹션을 반투명 색 박스로 덮고, 그 안의 '위·아래 여백'을 다른 색 띠로 보여준다.
     * 조절되는 건 경계선이 아니라 이 여백이므로, 여백 자체를 잡아 끌게 한다.
     */
    function buildGapBars() {
        clearGapBars();
        if (!gapOn) return;
        const secs = [...document.querySelectorAll(GAP_SEL)];
        secs.forEach((sec, i) => {
            const r = sec.getBoundingClientRect();
            const cs = getComputedStyle(sec);
            const padT = parseFloat(cs.paddingTop) || 0;
            const padB = parseFloat(cs.paddingBottom) || 0;
            const top = r.top + window.scrollY;

            // ① 섹션 본체 박스 (파란 반투명)
            const box = document.createElement('div');
            box.className = '__ed-gap-bar';
            box.style.cssText =
                'position:absolute;z-index:2147483630;pointer-events:none;' +
                'border:1.5px solid rgba(59,130,246,.5);border-radius:10px;' +
                'background:rgba(59,130,246,.07);';
            box.style.top = top + 'px';
            box.style.left = r.left + window.scrollX + 'px';
            box.style.width = r.width + 'px';
            box.style.height = r.height + 'px';

            // 섹션 이름표
            const name = document.createElement('span');
            name.style.cssText =
                'position:absolute;top:6px;left:8px;background:#3B82F6;color:#fff;' +
                'font:700 12px/1.7 system-ui,sans-serif;padding:1px 9px;border-radius:6px;white-space:nowrap';
            name.textContent = `Section ${i + 1}`;
            box.appendChild(name);
            box.__sec = sec; box.__kind = 'box';
            document.body.appendChild(box);
            gapBars.push(box);

            // ② 위·아래 여백 띠 (주황) — 이걸 잡아 끈다
            [['top', padT], ['bottom', padB]].forEach(([side, pad]) => {
                if (pad < 4) return;
                const band = document.createElement('div');
                band.className = '__ed-gap-bar';
                band.style.cssText =
                    'position:absolute;z-index:2147483640;cursor:ns-resize;' +
                    'background:repeating-linear-gradient(45deg,rgba(79,209,197,.22) 0 8px,rgba(79,209,197,.10) 8px 16px);' +
                    'border:1px dashed rgba(79,209,197,.75);' +
                    'display:flex;align-items:center;justify-content:center;transition:background .12s';
                band.style.left = r.left + window.scrollX + 'px';
                band.style.width = r.width + 'px';
                band.style.height = pad + 'px';
                band.style.top = (side === 'top' ? top : top + r.height - pad) + 'px';

                const tag = document.createElement('span');
                tag.style.cssText =
                    'background:#B45309;color:#fff;font:700 12px/1.8 system-ui,sans-serif;' +
                    'padding:1px 10px;border-radius:6px;white-space:nowrap;pointer-events:none;' +
                    'box-shadow:0 1px 4px rgba(0,0,0,.25)';
                tag.textContent = `${Math.round(pad)}px  ↕ drag to adjust`;
                band.appendChild(tag);

                band.addEventListener('mouseenter', () => {
                    band.style.background = 'repeating-linear-gradient(45deg,rgba(79,209,197,.38) 0 8px,rgba(79,209,197,.20) 8px 16px)';
                });
                band.addEventListener('mouseleave', () => {
                    if (!band.__dragging) band.style.background =
                        'repeating-linear-gradient(45deg,rgba(79,209,197,.22) 0 8px,rgba(79,209,197,.10) 8px 16px)';
                });
                // 위쪽 띠는 위로 끌면 넓어지고, 아래쪽 띠는 아래로 끌면 넓어진다
                band.addEventListener('mousedown', e => startGapDrag(e, sec, band, tag, side));
                band.__sec = sec; band.__kind = 'band'; band.__side = side;
                document.body.appendChild(band);
                gapBars.push(band);
            });
        });
    }
    /**
     * 오버레이(섹션 박스·여백 띠)를 실제 요소 위치에 다시 맞춘다.
     * 새로 만들지 않고 좌표만 갱신하므로 드래그 중에도 끊기지 않는다.
     */
    function syncGapBars() {
        for (const el of gapBars) {
            const sec = el.__sec;
            if (!sec || !sec.isConnected) continue;
            const r = sec.getBoundingClientRect();
            const cs = getComputedStyle(sec);
            const top = r.top + window.scrollY;
            el.style.left = (r.left + window.scrollX) + 'px';
            el.style.width = r.width + 'px';
            if (el.__kind === 'box') {
                el.style.top = top + 'px';
                el.style.height = r.height + 'px';
            } else {
                const pad = parseFloat(el.__side === 'top' ? cs.paddingTop : cs.paddingBottom) || 0;
                el.style.height = pad + 'px';
                el.style.top = (el.__side === 'top' ? top : top + r.height - pad) + 'px';
                const t = el.querySelector('span');
                if (t) t.textContent = `${Math.round(pad)}px  ↕ drag to adjust`;
            }
        }
    }

    function startGapDrag(e, sec, band, tag, side) {
        e.preventDefault(); e.stopPropagation();
        band.__dragging = true;
        band.style.background =
            'repeating-linear-gradient(45deg,rgba(79,209,197,.5) 0 8px,rgba(79,209,197,.3) 8px 16px)';
        const startY = e.clientY;
        const cs = getComputedStyle(sec);
        const start = Math.round(parseFloat(side === 'top' ? cs.paddingTop : cs.paddingBottom)) || 0;

        // 위쪽 띠: 위로 끌면(음수) 넓어진다 / 아래쪽 띠: 아래로 끌면(양수) 넓어진다
        const calc = ev => {
            const d = ev.clientY - startY;
            const delta = (side === 'top') ? -d : d;
            return Math.max(0, Math.round(start + delta));
        };
        const onMove = ev => {
            const next = calc(ev);
            tag.textContent = `${next}px  ↕ drag to adjust`;
            // 여백을 여기서 바로 적용한다. 호스트를 거쳐 돌아오면 한 박자 늦어
            // 띠와 실제 콘텐츠가 어긋나 겹쳐 보인다.
            if (gapScopeLocal === 'all') {
                document.documentElement.style.setProperty('--vb-pad-block', next + 'px');
            } else {
                if (side === 'bottom') sec.style.paddingBottom = next + 'px';
                else sec.style.paddingTop = next + 'px';
                const mate = side === 'bottom' ? sec.nextElementSibling : sec.previousElementSibling;
                if (mate && mate.classList.contains('vb-section')) {
                    if (side === 'bottom') mate.style.paddingTop = next + 'px';
                    else mate.style.paddingBottom = next + 'px';
                }
            }
            syncGapBars();                       // 적용 뒤 곧바로 오버레이를 맞춘다
            post('gapDragMove', { path: pathOf(sec), px: next, side });
        };
        const onUp = ev => {
            band.__dragging = false;
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('mouseup', onUp, true);
            post('gapDragEnd', { path: pathOf(sec), px: calc(ev), side });
            setTimeout(buildGapBars, 80);
        };
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
    }

    /**
     * 나중에 넣은 캐러셀의 좌우 화살표를 살린다.
     * 원본 JS 는 페이지 로드 때 한 번만 연결하므로, 삽입된 것은 여기서 직접 붙인다.
     */
    function bindCarouselNav(root) {
        if (!root || !root.querySelectorAll) return;
        root.querySelectorAll('[data-carousel-prev],[data-carousel-next]').forEach(btn => {
            if (btn.__edBound) return;
            btn.__edBound = true;
            const next = btn.hasAttribute('data-carousel-next');
            const id = btn.getAttribute(next ? 'data-carousel-next' : 'data-carousel-prev');
            btn.addEventListener('click', e => {
                e.preventDefault(); e.stopPropagation();
                const track = document.getElementById(id);
                if (!track) return;
                const box = track.parentElement;              // .vb-carousel (스크롤 되는 쪽)
                // scroll-snap 이 걸려 있어 임의 위치로 밀면 되돌아온다 → 카드 위치로 정확히 맞춘다
                const items = [...track.querySelectorAll('.vb-carousel__item')];
                if (!items.length) return;
                // 카드 하나 폭(+간격)만큼 이동한다. 스냅이 가까운 카드로 붙여 준다.
                const w = items[0].getBoundingClientRect().width;
                const gap = items.length > 1
                    ? items[1].getBoundingClientRect().left - items[0].getBoundingClientRect().right
                    : 16;
                const step = Math.round(w + Math.max(0, gap));
                const max = box.scrollWidth - box.clientWidth;
                const target = Math.max(0, Math.min(max, box.scrollLeft + (next ? step : -step)));
                box.scrollLeft = target;      // 스냅과 싸우지 않게 즉시 이동
            }, true);
        });
    }

    // ---------- 컴포넌트 드롭 (라이브러리에서 끌어다 넣기) ----------
    // 드롭 지점에서 '어느 블록의 위/아래인지'를 정해 파란 선으로 보여준다.
    let dropLine = null;
    function ensureDropLine() {
        if (dropLine) return dropLine;
        dropLine = document.createElement('div');
        dropLine.id = '__ed-drop-line';
        dropLine.style.cssText =
            'position:absolute;left:0;right:0;height:3px;background:#3B82F6;z-index:2147483646;' +
            'pointer-events:none;box-shadow:0 0 8px rgba(59,130,246,.8);border-radius:2px;display:none';
        document.body.appendChild(dropLine);
        return dropLine;
    }
    /** 드롭 기준이 될 '블록' 요소 (너무 작은 인라인 요소는 위로 올라가며 찾는다) */
    function blockAt(x, y) {
        let el = document.elementFromPoint(x, y);
        while (el && el !== document.body) {
            const r = el.getBoundingClientRect();
            const disp = getComputedStyle(el).display;
            if (r.height > 24 && disp !== 'inline') return el;
            el = el.parentElement;
        }
        return document.body.firstElementChild || document.body;
    }
    /**
     * 드롭 대상 보정.
     * 그리드(.vb-grid, .ig-grid …) 나 캐러셀 트랙 '안'에 새 섹션을 꽂으면
     * 그 레이아웃의 한 칸으로 들어가 버려 구조가 깨진다.
     * → 그런 컨테이너 안이면 컨테이너 자체를 기준으로 올려 잡는다.
     */
    const LAYOUT_PARENT = '.vb-grid, .ig-grid, .sky-features, .vb-carousel__track, .bg-flow, .tl-grid, .sf-track, .vb-carousel';
    function liftOutOfLayout(el) {
        let cur = el;
        while (cur && cur !== document.body) {
            if (cur.parentElement && cur.parentElement.closest &&
                cur.parentElement.matches && cur.parentElement.matches(LAYOUT_PARENT)) {
                cur = cur.parentElement;      // 컨테이너 자체로 올린다
                continue;
            }
            const p = cur.closest(LAYOUT_PARENT);
            if (p && p !== cur) { cur = p; continue; }
            break;
        }
        return cur || el;
    }
    function dropTargetAt(x, y) {
        const el = liftOutOfLayout(blockAt(x, y));
        const r = el.getBoundingClientRect();
        const position = (y < r.top + r.height / 2) ? 'before' : 'after';
        return { el, r, position };
    }
    // 대상 '덩어리'를 색면으로 덮어 어디까지가 한 블록인지 보여준다 (선만으론 구분이 안 됨)
    let dropZone = null;
    function ensureDropZone() {
        if (dropZone) return dropZone;
        dropZone = document.createElement('div');
        dropZone.id = '__ed-drop-zone';
        dropZone.style.cssText =
            'position:absolute;z-index:2147483645;pointer-events:none;display:none;' +
            'background:rgba(59,130,246,.10);border:1.5px solid rgba(59,130,246,.55);border-radius:8px;';
        const label = document.createElement('span');
        label.id = '__ed-drop-label';
        label.style.cssText =
            'position:absolute;top:0;left:0;transform:translateY(-100%);' +
            'background:#3B82F6;color:#fff;font:600 11px/1.6 system-ui,sans-serif;' +
            'padding:1px 7px;border-radius:5px 5px 0 0;white-space:nowrap';
        dropZone.appendChild(label);
        document.body.appendChild(dropZone);
        return dropZone;
    }
    function showDropAt(x, y) {
        const t = dropTargetAt(x, y);
        const line = ensureDropLine();
        const top = (t.position === 'before' ? t.r.top : t.r.bottom) + window.scrollY;
        line.style.top = (top - 1) + 'px';
        line.style.display = 'block';

        const zone = ensureDropZone();
        zone.style.display = 'block';
        zone.style.top = (t.r.top + window.scrollY) + 'px';
        zone.style.left = (t.r.left + window.scrollX) + 'px';
        zone.style.width = t.r.width + 'px';
        zone.style.height = t.r.height + 'px';
        const el = t.el;
        const name = el.tagName.toLowerCase() +
            (el.classList[0] ? '.' + el.classList[0] : '');
        zone.querySelector('#__ed-drop-label').textContent =
            `Insert ${t.position === 'before' ? 'above' : 'below'} ${name}`;
        return t;
    }
    function hideDrop() {
        if (dropLine) dropLine.style.display = 'none';
        if (dropZone) dropZone.style.display = 'none';
    }

    document.addEventListener('dragover', e => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        showDropAt(e.clientX, e.clientY);
    });
    document.addEventListener('dragleave', e => { if (!e.relatedTarget) hideDrop(); });
    document.addEventListener('drop', e => {
        e.preventDefault();
        const t = dropTargetAt(e.clientX, e.clientY);
        hideDrop();
        let key = '', kind = 'component';
        try {
            const dt = e.dataTransfer;
            if (dt.getData('text/x-hnkl-saved')) { key = dt.getData('text/x-hnkl-saved'); kind = 'saved'; }
            else if (dt.getData('text/x-hnkl-motion')) { key = dt.getData('text/x-hnkl-motion'); kind = 'motion'; }
            else key = dt.getData('text/x-hnkl-component') || dt.getData('text/plain') || '';
        } catch (_) {}
        if (!key) return;
        // 인터랙션은 '그 요소 자체'에 붙이므로 정확한 대상이 필요하다
        const el = kind === 'motion' ? (document.elementFromPoint(e.clientX, e.clientY) || t.el) : t.el;
        post('componentDropped', { key, kind, path: pathOf(el), position: t.position });
    });

    // ---------- 부모와 대화 ----------
    const post = (type, payload) => parent.postMessage({ source: '__hnkl_editor', type, payload }, '*');

    window.addEventListener('message', e => {
        const msg = e.data;
        if (!msg || msg.source !== '__hnkl_editor_host') return;
        const { type, payload } = msg;

        if (type === 'removeElement' || type === 'duplicateElement') {
            const el = selected;
            if (!el || !el.parentNode) { post('blockDone', { error: 'Nothing is selected.' }); return; }
            const path = pathOf(el);                       // 파일 수정은 '건드리기 전' 경로 기준
            if (type === 'removeElement') {
                // 되돌릴 수 있게 어디에 있었는지 함께 적어 둔다
                blockHistory.push({ act: 'remove', node: el, parent: el.parentNode, next: el.nextSibling });
                el.classList.remove('__ed-selected');
                el.remove();
                selected = null;
                post('blockDone', { act: 'remove', path });
            } else {
                const copy = el.cloneNode(true);
                copy.classList.remove('__ed-selected', '__ed-hover', '__ed-move-pick');
                el.parentNode.insertBefore(copy, el.nextSibling);
                revealNow(copy);
                bindCarouselNav(copy);
                blockHistory.push({ act: 'duplicate', node: copy });
                post('blockDone', { act: 'duplicate', path });
            }
            setTimeout(reportHeight, 80);
        }
        else if (type === 'undoBlock') {
            const last = blockHistory.pop();
            if (!last) return;
            if (last.act === 'remove') last.parent.insertBefore(last.node, last.next);
            else last.node.remove();
            setTimeout(reportHeight, 80);
        }
        else if (type === 'textPreview') {
            const el = elementAtPath(payload.path);
            if (el && !el.children.length) el.textContent = payload.value;
            setTimeout(reportHeight, 80);
        }
        else if (type === 'replay') {
            // 저장 대기 중인 편집을 처음부터 순서대로 다시 적용한다.
            // (되돌리기/다시실행은 화면을 새로 그린 뒤 여기로 되돌아온다 —
            //  구조를 바꾸는 편집은 거꾸로 되짚는 것보다 처음부터 다시 트는 편이 정확하다)
            for (const st of (payload.steps || [])) {
                try {
                    if (st.kind === 'insert') {
                        const el = elementAtPath(st.path); if (!el) continue;
                        const tpl = document.createElement('template');
                        tpl.innerHTML = String(st.html || '').trim();
                        const node = tpl.content.firstElementChild; if (!node) continue;
                        node.setAttribute('data-ed-inserted', '1');
                        if (st.position === 'before') el.parentNode.insertBefore(node, el);
                        else if (st.position === 'firstChild') el.insertBefore(node, el.firstChild);
                        else if (st.position === 'lastChild') el.appendChild(node);
                        else el.parentNode.insertBefore(node, el.nextSibling);
                        revealNow(node); bindCarouselNav(node);
                    } else if (st.kind === 'move') {
                        const el = elementAtPath(st.path); if (!el) continue;
                        const blocks = topBlocks();
                        const i = blocks.indexOf(el);
                        const partner = st.dir === 'up' ? blocks[i - 1] : blocks[i + 1];
                        if (!partner) continue;
                        if (st.dir === 'up') partner.parentNode.insertBefore(el, partner);
                        else partner.parentNode.insertBefore(partner, el);
                    } else if (st.kind === 'remove') {
                        const el = elementAtPath(st.path); if (el) el.remove();
                    } else if (st.kind === 'duplicate') {
                        const el = elementAtPath(st.path); if (!el) continue;
                        const copy = el.cloneNode(true);
                        copy.classList?.remove('__ed-selected', '__ed-hover', '__ed-move-pick');
                        el.parentNode.insertBefore(copy, el.nextSibling);
                        revealNow(copy); bindCarouselNav(copy);
                    } else if (st.kind === 'text') {
                        const el = elementAtPath(st.path);
                        if (el && !el.children.length) el.textContent = st.value;
                    } else if (st.kind === 'link') {
                        if (!st.url || document.querySelector(`[data-ed-asset="${st.url}"]`)) continue;
                        const el = st.assetKind === 'js'
                            ? Object.assign(document.createElement('script'), { src: st.url, defer: true })
                            : Object.assign(document.createElement('link'), { rel: 'stylesheet', href: st.url });
                        el.setAttribute('data-ed-asset', st.url);
                        document.head.appendChild(el);
                    }
                } catch (e) { /* 한 단계가 실패해도 나머지는 이어서 적용한다 */ }
            }
            setTimeout(reportHeight, 120);
        }
        else if (type === 'boxHint') {
            if (!payload || !payload.path) clearBoxHint();
            else showBoxHint(payload.path, payload.part, payload.side);
        }
        else if (type === 'linkAsset') {
            // 마스터 블록의 파일을 미리보기에도 걸어 준다 (저장 전에 모양을 보려고)
            for (const [kind, url] of [['css', payload.css], ['js', payload.js]]) {
                if (!url || document.querySelector(`[data-ed-asset="${url}"]`)) continue;
                const el = kind === 'css'
                    ? Object.assign(document.createElement('link'), { rel: 'stylesheet', href: url })
                    : Object.assign(document.createElement('script'), { src: url, defer: true });
                el.setAttribute('data-ed-asset', url);
                document.head.appendChild(el);
            }
            setTimeout(reportHeight, 200);
        }
        else if (type === 'grabComponent') {
            if (!selected) { post('grabbed', { error: 'Nothing is selected.' }); return; }
            const css = collectCss(selected);
            post('grabbed', {
                html: cleanHtml(selected),
                css: css.text,
                cssCount: css.count,
                vars: usedVars(css.text),
                tag: selected.tagName.toLowerCase(),
                className: (selected.getAttribute('class') || '').trim(),
                text: (selected.textContent || '').trim().slice(0, 40),
                sketch: sketch(selected),
                // 이 덩어리가 기대는 클래스들 — 다른 페이지에 넣을 때 있는지 확인하는 데 쓴다
                needs: [...new Set([selected, ...selected.querySelectorAll('*')]
                    .flatMap(n => [...(n.classList || [])])
                    .filter(c => !c.startsWith('__ed') && !c.startsWith('ed-')))].slice(0, 60),
            });
        }
        else if (type === 'undoMove') {
            // 마지막에 옮긴 것을 반대로 한 칸 되돌린다 (에디터가 pending 을 뺄 때 같이 부른다)
            const last = moveHistory.pop();
            if (!last) return;
            const blocks = topBlocks();
            const i = blocks.indexOf(last.el);
            const back = last.dir === 'up' ? blocks[i + 1] : blocks[i - 1];
            if (!back) return;
            if (last.dir === 'up') back.parentNode.insertBefore(back, last.el);
            else back.parentNode.insertBefore(last.el, back);
            if (moveTarget) placeMoveBar();
            setTimeout(reportHeight, 80);
        }
        else if (type === 'setMoving') {
            moving = !!payload;
            document.documentElement.classList.toggle('__ed-moving', moving);
            if (!moving) { hideMoveBar(); hideMoveLine(); dragEl = null; } else clearHover();
        }
        else if (type === 'setPicking') {
            // 고르기가 켜져 있을 때만 '한 장 더' 를 보여 준다
            setTimeout(() => window.postMessage({ source: '__hnkl_editor_host', type: 'showAddCard', payload: { on: !!payload } }, '*'), 0);
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
        else if (type === 'insertPreview') {
            // 컴포넌트 삽입 미리보기 — 저장 전이라 화면에만 넣는다
            const el = elementAtPath(payload.path);
            if (!el) return;
            const tpl = document.createElement('template');
            tpl.innerHTML = String(payload.html || '').trim();
            const node = tpl.content.firstElementChild;
            if (!node) return;
            node.setAttribute('data-ed-inserted', '1');
            if (payload.position === 'before') el.parentNode.insertBefore(node, el);
            else if (payload.position === 'firstChild') el.insertBefore(node, el.firstChild);
            else if (payload.position === 'lastChild') el.appendChild(node);
            else el.parentNode.insertBefore(node, el.nextSibling);
            // .reveal 은 스크롤 애니메이션이 켜줘야 보이는데, 나중에 넣은 건 등록이 안 돼
            // 영원히 투명하게 남는다 → 삽입한 것은 바로 보이게 해 준다.
            revealNow(node);
            node.scrollIntoView({ block: 'center', behavior: 'smooth' });
            // 넣자마자 덩어리 전체를 골라 둔다 — 인스펙터에서 바로 여백을 만질 수 있게.
            // (직접 클릭하면 마우스가 닿은 말단 요소가 잡혀서 덩어리 여백을 못 준다)
            select(node);
            post('inserted', { path: pathOf(node) });
            setTimeout(reportHeight, 80);
            bindCarouselNav(node);
        }
        else if (type === 'undoInserts') {
            document.querySelectorAll('[data-ed-inserted]').forEach(n => n.remove());
        }
        else if (type === 'setGapScope') {
            gapScopeLocal = payload || 'all';
        }
        else if (type === 'listGapExceptions') {
            // 토큰(--vb-pad-block)을 따르지 않고 값이 따로 박힌 섹션을 찾아 알린다.
            // 토큰 값은 clamp(...) 문자열이라 px 로 못 읽는다 → 가장 많이 쓰인 실제 값을 기준으로 삼는다.
            const counts = {};
            document.querySelectorAll(GAP_SEL).forEach(s => {
                const v = Math.round(parseFloat(getComputedStyle(s).paddingTop)) || 0;
                counts[v] = (counts[v] || 0) + 1;
            });
            const base = +(Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [0])[0];
            const out = [];
            document.querySelectorAll(GAP_SEL).forEach((s, i) => {
                const cs = getComputedStyle(s);
                const t = Math.round(parseFloat(cs.paddingTop)) || 0;
                const b = Math.round(parseFloat(cs.paddingBottom)) || 0;
                if (Math.abs(t - base) > 2 || Math.abs(b - base) > 2) {
                    out.push({
                        index: i + 1, path: pathOf(s), top: t, bottom: b,
                        name: sectionLabel(s, i + 1),
                    });
                }
            });
            post('gapExceptions', { base, list: out });
        }
        else if (type === 'hintSections') {
            // 여러 섹션을 한꺼번에 짚어 준다 — 목록에 손을 올렸을 때
            document.querySelectorAll('.__hnkl-secmark').forEach(n => n.remove());
            for (const p of (payload.paths || [])) {
                const el = elementAtPath(p);
                if (!el) continue;
                const r = el.getBoundingClientRect();
                const m = document.createElement('div');
                m.className = '__hnkl-secmark';
                m.style.cssText =
                    'position:absolute;z-index:2147483645;pointer-events:none;border-radius:8px;' +
                    'background:rgba(59,130,246,.14);outline:1.5px solid rgba(59,130,246,.65);';
                m.style.top = (r.top + window.scrollY) + 'px';
                m.style.left = (r.left + window.scrollX) + 'px';
                m.style.width = r.width + 'px';
                m.style.height = r.height + 'px';
                document.body.appendChild(m);
            }
        }
        else if (type === 'focusSection') {
            // 예외 목록에서 고른 섹션으로 이동하고 잠깐 강조한다
            const el = elementAtPath(payload.path);
            if (!el) return;
            const r = el.getBoundingClientRect();
            post('scrollToY', { y: r.top + window.scrollY, h: r.height });
            const mark = document.createElement('div');
            mark.style.cssText =
                'position:absolute;z-index:2147483646;pointer-events:none;border-radius:10px;' +
                'background:rgba(59,130,246,.22);border:2px solid rgba(59,130,246,.9);transition:opacity .4s';
            mark.style.top = (r.top + window.scrollY) + 'px';
            mark.style.left = (r.left + window.scrollX) + 'px';
            mark.style.width = r.width + 'px';
            mark.style.height = r.height + 'px';
            document.body.appendChild(mark);
            setTimeout(() => { mark.style.opacity = '0'; }, 1200);
            setTimeout(() => mark.remove(), 1700);
        }
        else if (type === 'setGapMode') {
            gapOn = !!payload;
            document.documentElement.classList.toggle('__ed-gapping', gapOn);
            buildGapBars();
            // 켜져 있는 동안에는 어떤 경로로 값이 바뀌든(슬라이더·저장·리플로우)
            // 오버레이가 항상 실제 여백을 따라가게 한다.
            clearInterval(window.__edGapTimer);
            if (gapOn) window.__edGapTimer = setInterval(syncGapBars, 120);
        }
        else if (type === 'contentGuide') {
            // 본문이 놓이는 띠를 켜 둔 채로 보여 준다 (호버 힌트와 달리 지워지지 않는다)
            let tag = document.getElementById('__ed-guide-css');
            if (!tag) {
                tag = document.createElement('style');
                tag.id = '__ed-guide-css';
                (document.head || document.documentElement).appendChild(tag);
            }
            tag.textContent = payload.on
                ? `.vb-wrap{outline:1px dashed rgba(59,130,246,.55) !important;outline-offset:-1px;` +
                  `background-image:linear-gradient(rgba(59,130,246,.05),rgba(59,130,246,.05)) !important}`
                : '';
        }
        else if (type === 'pageHint') {
            // '이 값이 페이지의 어디인지' 를 짚어 준다 (말보다 빠르다)
            clearBoxHint();
            if (!payload || !payload.what) return;
            const paint = (el, cls) => {
                const r = el.getBoundingClientRect();
                const d = document.createElement('div');
                d.className = `__ed-boxhint __ed-boxhint--${cls}`;
                d.style.cssText = `left:${window.scrollX + r.left}px;top:${window.scrollY + r.top}px;width:${r.width}px;height:${r.height}px`;
                document.body.appendChild(d);
                boxHints.push(d);
            };
            if (payload.what === 'maxw') {
                // 본문이 놓이는 띠
                document.querySelectorAll('.vb-wrap').forEach(el => {
                    const r = el.getBoundingClientRect();
                    if (r.bottom > 0 && r.top < window.innerHeight) paint(el, 'padding');
                });
            } else if (payload.what === 'gap') {
                // 섹션의 위아래 여백
                for (const sec of document.querySelectorAll('.vb-section')) {
                    const r = sec.getBoundingClientRect();
                    if (r.bottom < 0 || r.top > window.innerHeight) continue;
                    const cs = getComputedStyle(sec);
                    const top = parseFloat(cs.paddingTop) || 0, bot = parseFloat(cs.paddingBottom) || 0;
                    const band = (y, h) => {
                        if (h <= 0) return;
                        const d = document.createElement('div');
                        d.className = '__ed-boxhint __ed-boxhint--padding';
                        d.style.cssText = `left:${window.scrollX + r.left}px;top:${window.scrollY + y}px;width:${r.width}px;height:${h}px`;
                        document.body.appendChild(d); boxHints.push(d);
                    };
                    band(r.top, top); band(r.bottom - bot, bot);
                }
            } else if (payload.what === 'cardgap') {
                // 카드가 늘어선 줄 (그 사이 간격이 이 값이다)
                document.querySelectorAll('.sky-features, .ig-grid, .ql-method-grid').forEach(el => {
                    const r = el.getBoundingClientRect();
                    if (r.bottom > 0 && r.top < window.innerHeight) paint(el, 'margin');
                });
            }
            if (!boxHints.length) {
                // 화면에 없으면 첫 번째로 데려간다
                const sel = payload.what === 'maxw' ? '.vb-wrap' : '.sky-features, .ig-grid';
                document.querySelector(sel)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        }
        else if (type === 'pageTokenPreview') {
            // 페이지 토큰을 조절하는 동안 화면에 바로 보여 준다
            let tag = document.getElementById('__ed-pagetoken-css');
            if (!tag) {
                tag = document.createElement('style');
                tag.id = '__ed-pagetoken-css';
                (document.head || document.documentElement).appendChild(tag);
            }
            const body = Object.entries(payload.vars || {})
                .map(([k, v]) => `${k}:${v} !important`).join(';');
            tag.textContent = body ? `:root{${body}}` : '';
            setTimeout(reportHeight, 80);
        }
        else if (type === 'gapPreview') {
            // 조절 중 실시간 반영 — 전체는 토큰, 개별은 그 섹션에만
            let tag = document.getElementById('__ed-gap-css');
            if (!tag) {
                tag = document.createElement('style');
                tag.id = '__ed-gap-css';
                (document.head || document.documentElement).appendChild(tag);
            }
            if (payload.scope === 'all') {
                // 토큰은 위·아래를 함께 정하므로 모든 섹션이 같이 움직인다
                tag.textContent = `:root{--vb-pad-block:${payload.px}px !important}`;
            } else {
                const el = elementAtPath(payload.path);
                if (el) {
                    if (payload.side === 'bottom') el.style.paddingBottom = payload.px + 'px';
                    else el.style.paddingTop = payload.px + 'px';
                    // 섹션 사이엔 빈 틈이 없다. 눈에 보이는 '간격'은 맞닿은 두 여백의 합이므로
                    // 짝이 되는 쪽도 같이 움직여야 실제로 간격을 조절하는 느낌이 난다.
                    const mate = payload.side === 'bottom' ? el.nextElementSibling : el.previousElementSibling;
                    if (mate && mate.classList.contains('vb-section')) {
                        if (payload.side === 'bottom') mate.style.paddingTop = payload.px + 'px';
                        else mate.style.paddingBottom = payload.px + 'px';
                    }
                }
            }
            requestAnimationFrame(syncGapBars);
        }
        else if (type === 'showAddCard') {
            // 캐러셀 끝에 '한 장 더' 버튼을 얹는다 (에디터에서만 보이는 것)
            document.querySelectorAll('.__ed-addcard').forEach(n => n.remove());
            if (!payload.on) return;
            for (const track of document.querySelectorAll('.vb-carousel__track')) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = '__ed-addcard';
                b.textContent = '+';
                b.title = '카드 한 장 더';
                b.addEventListener('click', ev => {
                    ev.preventDefault(); ev.stopPropagation();
                    const items = track.querySelectorAll('.vb-carousel__item');
                    const last = items[items.length - 1];
                    if (last) post('addCard', { path: pathOf(last) });
                });
                track.appendChild(b);
            }
        }
        else if (type === 'duplicatePreview') {
            const el = elementAtPath(payload.path);
            if (!el) return;
            const copy = el.cloneNode(true);
            copy.classList.remove('__ed-selected', '__ed-hover');
            el.after(copy);
            setTimeout(reportHeight, 80);
        }
        else if (type === 'replacePreview') {
            // 사진 ↔ 영상 — 태그가 바뀌므로 요소째 갈아 끼운다
            const el = elementAtPath(payload.path);
            if (!el) return;
            const tmp = document.createElement('div');
            tmp.innerHTML = payload.html;
            const next = tmp.firstElementChild;
            if (!next) return;
            // 에디터가 붙여 둔 표시는 새 요소에도 옮긴다 (고른 상태가 풀리지 않게)
            for (const c of el.classList) if (c.startsWith('__ed')) next.classList.add(c);
            el.replaceWith(next);
            setTimeout(reportHeight, 80);
        }
        else if (type === 'setAttr') {
            const el = elementAtPath(payload.path);
            if (!el) return;
            if (payload.value == null || payload.value === '') el.removeAttribute(payload.name);
            else el.setAttribute(payload.name, payload.value);
        }
        else if (type === 'motionPreview') {
            // 인터랙션 미리보기 — 클래스만 붙이고, 규칙은 임시 <style> 로 넣는다
            const el = elementAtPath(payload.path);
            if (!el) return;
            if (payload.className) el.classList.add(payload.className);
            let tag = document.getElementById('__ed-motion-css');
            if (!tag) {
                tag = document.createElement('style');
                tag.id = '__ed-motion-css';
                (document.head || document.documentElement).appendChild(tag);
            }
            if (payload.css && !tag.textContent.includes(payload.css)) tag.textContent += '\n' + payload.css;
            // 호버 효과는 마우스를 올려야 보이므로, 적용됐는지 알 수가 없다.
            // → 적용 직후 한 번 '시연'해 주고, 어느 요소에 붙었는지 배지로 알린다.
            if (payload.className) demoMotion(el, payload.className);
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
        else if (type === 'tokenPreview') {
            // 디자인 시스템 조절 미리보기: :root 토큰 값을 임시 <style>로 덮어씀 (파일 저장 아님)
            let tag = document.getElementById('__ed-token-preview');
            if (!tag) {
                tag = document.createElement('style');
                tag.id = '__ed-token-preview';
                (document.head || document.documentElement).appendChild(tag);
            }
            tag.textContent = payload.css || '';
        }
        else if (type === 'highlight') showHighlight(payload.area);
        else if (type === 'clearHighlight') clearHighlight();
        else if (type === 'getDesignSystem') post('designSystem', collectDesignSystem());
        else if (type === 'ping') post('ready', { page: PAGE, title: document.title, classes: pageClasses(), vars: pageVars(), mainPath: pathOf(document.querySelector('main') || document.body), pageTokens: pageTokens(), pageBg: pageBg() });
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
        // iframe 은 페이지 전체 높이로 늘어나므로, 그 시점의 innerHeight 로 vh 를 굳히면
        // 100vh 가 수만 px 이 된다. 브레이크포인트의 '기기 높이'를 기준으로 삼는다.
        const fromUrl = +(new URLSearchParams(location.search).get('__edvh') || 0);
        const vpH = fromUrl > 200 ? fromUrl
            : Math.min(window.innerHeight, Math.round(window.innerWidth * 2.2) || 900);
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

    /**
     * 에디터 미리보기에서는 스크롤 애니메이션이 돌지 않는다(iframe 을 전체 높이로 펼쳐 보여주므로).
     * 그래서 .reveal 이 opacity:0 인 채로 남아 '공간만 있고 안 보이는' 상태가 된다.
     * 편집 중에는 전부 보이게 덮어쓴다 — 원본 파일에는 영향 없음.
     */
    function revealAllForEditing() {
        const tag = document.createElement('style');
        tag.id = '__ed-reveal-all';
        tag.textContent =
            '.reveal{opacity:1 !important;transform:none !important}' +
            /* 에디터 미리보기에는 브라우저 스크롤바가 필요 없다 (휠·드래그로 움직인다) */
            '::-webkit-scrollbar{width:0 !important;height:0 !important;display:none !important}' +
            'html,body,*{scrollbar-width:none !important;-ms-overflow-style:none !important}';
        (document.head || document.documentElement).appendChild(tag);
    }

    /**
     * 스크롤 연출이 iframe 높이를 '화면 높이'로 착각해 만드는 거대한 빈 공간을 없앤다.
     *
     * 예) vibra 의 히어로 덮기 효과는 stage.paddingBottom 을 window.innerHeight 기준으로 잡는데,
     *     에디터는 iframe 을 페이지 전체 높이(수만 px)로 펼치므로 그 값이 1만 px 넘게 들어간다.
     *     실제 사이트에서는 정상이고 편집 화면에서만 생기는 문제라, 여기서만 되돌린다.
     */
    function stripScrollFillers() {
        const tag = document.createElement('style');
        tag.id = '__ed-no-filler';
        tag.textContent =
            '.vb-stage{padding-bottom:0 !important}' +
            '.vb-stage.is-boosted .vb-hero{margin-bottom:0 !important}' +
            '.vb-stage.is-boosted .vb-cover{padding-bottom:0 !important;transform:none !important}';
        (document.head || document.documentElement).appendChild(tag);
        // JS 가 인라인으로 다시 써 넣으므로, 인라인 값도 계속 지운다
        const clear = () => {
            document.querySelectorAll('.vb-stage').forEach(s => {
                if (s.style.paddingBottom) s.style.paddingBottom = '';
            });
            document.querySelectorAll('.vb-cover').forEach(c => {
                if (c.style.transform) c.style.transform = '';
            });
        };
        clear();
        setInterval(clear, 400);
    }

    let _lastH = 0;
    function measure() {
        return Math.max(
            document.documentElement.scrollHeight,
            document.body ? document.body.scrollHeight : 0
        );
    }
    function reportHeight() {
        // vh 고정은 '측정 전에 딱 한 번'. 이게 끝나야 높이가 안정된다.
        if (!_htReported) {
            _htReported = true;
            revealAllForEditing();
            stripScrollFillers();
            freezeVhUnits();
        }
        const h = measure();
        // 호스트가 iframe 을 늘리면 100vh 요소가 따라 커져서 다시 더 커지는 되먹임이 생긴다.
        // → '늘어나기만' 하는 변화는 무시하고, 의미 있게 달라졌을 때만 알린다.
        if (h <= 200) return;
        const grew = h - _lastH;
        if (_lastH && grew > 0 && grew < _lastH * 0.02) return;   // 2% 미만의 증가는 되먹임으로 본다
        if (Math.abs(h - _lastH) <= 8) return;
        _lastH = h;
        post('pageHeight', h);
    }
    if (document.readyState === 'complete') {
        setTimeout(reportHeight, 200);
    } else {
        window.addEventListener('load', () => setTimeout(reportHeight, 200));
    }
    // 늦게 로드되는 이미지·영상만 따라간다 (ResizeObserver 는 되먹임을 일으켜 쓰지 않는다)
    document.addEventListener('load', e => {
        if (/^(IMG|VIDEO|IFRAME)$/.test(e.target.tagName)) setTimeout(reportHeight, 80);
    }, true);
    [800, 2000, 4000].forEach(ms => setTimeout(reportHeight, ms));

    // ---------- 스크롤 → 캔버스 이동 ----------
    // 에디터 iframe 안일 때만 가로챈다.
    // (브라우저에서 /preview/ 주소를 직접 열었을 땐 페이지가 정상 스크롤돼야 한다)
    const IN_EDITOR = window.parent !== window;
    if (IN_EDITOR) {
        window.addEventListener('wheel', e => {
            e.preventDefault();
            // Ctrl(⌘) 를 같이 눌렀으면 확대/축소 — 호스트가 마우스 위치 기준으로 처리한다
            post('wheel', {
                dx: e.deltaX, dy: e.deltaY, zoom: e.ctrlKey || e.metaKey,
                sx: e.clientX, sy: e.clientY,
            });
        }, { passive: false });
    }

    // ---------- 가운데 마우스 패닝 (screenX/Y 는 프레임 간 좌표 통일) ----------
    let _midDown = false;
    document.addEventListener('mousedown', e => {
        if (!IN_EDITOR || e.button !== 1) return;
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

    post('ready', { page: PAGE, title: document.title, classes: pageClasses(), vars: pageVars(), mainPath: pathOf(document.querySelector('main') || document.body), pageTokens: pageTokens(), pageBg: pageBg() });
})();
