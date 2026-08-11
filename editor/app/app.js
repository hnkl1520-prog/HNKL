// 에디터 화면 로직.
// 미리보기(iframe)와는 postMessage로만 대화하고, 파일 저장은 서버에 맡긴다.

const $ = s => document.querySelector(s);
const frame = $('#frame');
const frameWrap = $('#frameWrap');

let currentPage = null;
let selection = null;              // 브리지가 보내준 요소 정보
let mode = 'css';                  // 'css' = 같은 규칙 전체, 'inline' = 이 요소만
let pending = [];                  // 저장 대기중인 수정들
let bp = { w: 1536, h: 864 };
let zoom = 0.6;
let canvasX = 0, canvasY = 0;     // 캔버스 이동 위치
let pageH = 864;                  // 페이지 실제 높이 (브리지가 알려줌)
let needsCenter = true;           // 다음 pageHeight 수신 때 가운데 정렬할지
let isPanning = false;
let panStart = { sx: 0, sy: 0, cx: 0, cy: 0 };

// ---------------------------------------------------------------- 통신
const toFrame = (type, payload) =>
    frame.contentWindow?.postMessage({ source: '__hnkl_editor_host', type, payload }, '*');

window.addEventListener('message', e => {
    const msg = e.data;
    if (!msg || msg.source !== '__hnkl_editor') return;
    if (msg.type === 'ready') {
        toFrame('setPicking', pickOn);
        applyPendingPreview();
    }
    else if (msg.type === 'selected' || msg.type === 'previewApplied') {
        selection = msg.payload;
        renderInspector();
    }
    else if (msg.type === 'pageHeight') {
        if (msg.payload > 100) {
            pageH = msg.payload;
            if (needsCenter) { needsCenter = false; centerFrame(); }
            else applyStage();
        }
    }
    else if (msg.type === 'panStart') startPan(msg.payload.sx, msg.payload.sy);
    else if (msg.type === 'panMove') { if (isPanning) movePan(msg.payload.sx, msg.payload.sy); }
    else if (msg.type === 'panEnd') endPan();
    else if (msg.type === 'wheel') {
        canvasY -= msg.payload.dy;
        canvasX -= msg.payload.dx;
        applyStage();
    }
    else if (msg.type === 'designSystem') {
        renderDesignSystem(msg.payload);
    }
});

// ---------------------------------------------------------------- 페이지 목록
async function loadPages() {
    const res = await fetch('/__api/pages');
    const { pages } = await res.json();
    const sel = $('#pageSelect');
    sel.innerHTML = '';
    for (const p of pages) {
        const o = document.createElement('option');
        o.value = p.rel;
        o.textContent = (p.isScratch ? '(임시) ' : '') + p.rel;
        sel.appendChild(o);
    }
    // 최근에 고친 '본 페이지'를 기본으로
    const mains = pages.filter(p => p.isMain);
    const preferred = mains.sort((a, b) => b.mtime - a.mtime)[0] || pages[0];
    if (preferred) { sel.value = preferred.rel; openPage(preferred.rel); }
}

function openPage(rel) {
    if (pending.length && !confirm('저장하지 않은 변경이 있습니다. 버리고 이동할까요?')) {
        $('#pageSelect').value = currentPage;
        return;
    }
    pending = []; selection = null; updateDirty(); renderInspector();
    needsCenter = true;
    currentPage = rel;
    frame.src = '/preview/' + rel;
}

$('#pageSelect').addEventListener('change', e => openPage(e.target.value));
$('#reloadBtn').addEventListener('click', () => {
    if (pending.length && !confirm('저장하지 않은 변경이 사라집니다. 계속할까요?')) return;
    pending = []; updateDirty();
    frame.src = frame.src;
});

// ---------------------------------------------------------------- 화면 크기 / 확대
function applyStage() {
    frame.style.width = bp.w + 'px';
    frame.style.height = pageH + 'px';
    frameWrap.style.width = bp.w + 'px';
    frameWrap.style.height = pageH + 'px';
    frameWrap.style.transform =
        `translate(${Math.round(canvasX)}px, ${Math.round(canvasY)}px) scale(${zoom})`;
    $('#stageInfo').textContent =
        `${bp.w}px 기준 렌더링 · ${Math.round(zoom * 100)}%로 표시`;
}

function centerFrame() {
    const stageEl = document.getElementById('stage');
    const sw = stageEl.clientWidth;
    const sh = stageEl.clientHeight;
    const scaledW = bp.w * zoom;
    const scaledH = pageH * zoom;
    canvasX = Math.max(40, (sw - scaledW) / 2);
    canvasY = scaledH < sh ? (sh - scaledH) / 2 : 40;
    applyStage();
}

// ---------- 패닝 ----------
function startPan(sx, sy) {
    isPanning = true;
    panStart = { sx, sy, cx: canvasX, cy: canvasY };
    const ov = document.getElementById('stageOverlay');
    ov.style.pointerEvents = 'auto';
    ov.style.cursor = 'grabbing';
}
function movePan(sx, sy) {
    canvasX = panStart.cx + sx - panStart.sx;
    canvasY = panStart.cy + sy - panStart.sy;
    applyStage();
}
function endPan() {
    isPanning = false;
    const ov = document.getElementById('stageOverlay');
    ov.style.pointerEvents = '';
    ov.style.cursor = '';
}

const stageEl = document.getElementById('stage');
stageEl.addEventListener('mousedown', e => {
    if (e.button !== 1) return;
    e.preventDefault();
    startPan(e.screenX, e.screenY);
});
document.getElementById('stageOverlay').addEventListener('mousemove', e => {
    if (isPanning) movePan(e.screenX, e.screenY);
});
document.getElementById('stageOverlay').addEventListener('mouseup', e => {
    if (e.button === 1) endPan();
});
window.addEventListener('mousemove', e => { if (isPanning) movePan(e.screenX, e.screenY); });
window.addEventListener('mouseup', e => { if (e.button === 1 && isPanning) endPan(); });

// 스크롤 휠 → 캔버스 세로 이동
stageEl.addEventListener('wheel', e => {
    e.preventDefault();
    canvasY -= e.deltaY;
    canvasX -= e.deltaX;
    applyStage();
}, { passive: false });

$('#breakpoints').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    [...e.currentTarget.children].forEach(x => x.classList.toggle('on', x === b));
    bp = { w: +b.dataset.w, h: +b.dataset.h };
    updateBpRes();
    needsCenter = true;
    applyStage();
});

// 중앙 뷰포트 제어기: 활성 브레이크포인트의 실제 해상도 표시
function updateBpRes() {
    const el = $('#bpRes');
    if (el) el.textContent = `${bp.w} × ${bp.h}`;
}

$('#zoom').addEventListener('input', e => {
    const newZoom = +e.target.value / 100;
    const stEl = document.getElementById('stage');
    const cx = stEl.clientWidth / 2;
    const cy = stEl.clientHeight / 2;
    const px = (cx - canvasX) / zoom;
    const py = (cy - canvasY) / zoom;
    zoom = newZoom;
    canvasX = cx - px * zoom;
    canvasY = cy - py * zoom;
    $('#zoomVal').textContent = e.target.value + '%';
    applyStage();
});

// ---------------------------------------------------------------- 요소 고르기
let pickOn = false;
$('#pickBtn').addEventListener('click', () => {
    pickOn = !pickOn;
    $('#pickBtn').classList.toggle('on', pickOn);
    $('#pickBtn').textContent = pickOn ? '고르는 중… (끄기)' : '요소 고르기';
    toFrame('setPicking', pickOn);
});
$('#parentBtn')?.addEventListener('click', () => toFrame('selectParent'));

// ---------------------------------------------------------------- 속성 정의
const GROUPS = [
    { title: '타이포', props: ['font-size', 'line-height', 'font-weight', 'color'] },
    { title: '바깥 여백 (margin)', props: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'] },
    { title: '안쪽 여백 (padding)', props: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'] },
    { title: '크기', props: ['width', 'max-width', 'min-width', 'height'] },
    { title: '배치', props: ['gap', 'justify-content', 'align-items'] },
    { title: '기타', props: ['border-radius', 'background-color', 'opacity'] },
];
const LABEL = {
    'font-size': '글자 크기', 'line-height': '줄 간격', 'font-weight': '굵기', 'color': '글자색',
    'margin-top': '위', 'margin-right': '오른쪽', 'margin-bottom': '아래', 'margin-left': '왼쪽',
    'padding-top': '위', 'padding-right': '오른쪽', 'padding-bottom': '아래', 'padding-left': '왼쪽',
    'width': '너비', 'max-width': '최대 너비', 'min-width': '최소 너비', 'height': '높이',
    'gap': '간격', 'justify-content': '가로 정렬', 'align-items': '세로 정렬',
    'border-radius': '모서리', 'background-color': '배경색', 'opacity': '투명도',
};
const ALIGN_OPTIONS = ['left', 'center', 'right'];

// ---------------------------------------------------------------- 박스 모델 위젯
function boxModelWidget() {
    const wrap = document.createElement('div');
    wrap.className = 'bm-wrap';

    function fmt(v) {
        const n = parseFloat(v);
        if (isNaN(n)) return v || '-';
        return n % 1 === 0 ? String(n) : String(+n.toFixed(1));
    }

    function makeBmVal(prop) {
        const raw = currentValue(prop);
        const span = document.createElement('span');
        span.className = 'bm-v' + (pendingFor(prop) ? ' changed' : '');
        span.textContent = fmt(raw);
        span.title = prop + ': ' + raw;
        span.addEventListener('click', () => {
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.value = raw;
            inp.className = 'bm-input';
            span.replaceWith(inp);
            inp.focus(); inp.select();
            const commit = () => stageEdit(prop, inp.value.trim());
            inp.addEventListener('blur', commit);
            inp.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
                if (e.key === 'Escape') inp.replaceWith(span);
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    const m = inp.value.match(/^(-?[\d.]+)(px|rem|em|%)?$/);
                    if (!m) return;
                    const d = e.key === 'ArrowUp' ? 1 : -1;
                    inp.value = +(parseFloat(m[1]) + d * (e.shiftKey ? 10 : 1)).toFixed(3) + (m[2] || '');
                    stageEdit(prop, inp.value);
                }
            });
        });
        return span;
    }

    function makeLayer(cls, label, tProp, rProp, bProp, lProp, inner) {
        const d = document.createElement('div');
        d.className = 'bm-layer ' + cls;
        const lbl = document.createElement('span');
        lbl.className = 'bm-lbl'; lbl.textContent = label;
        d.appendChild(lbl);
        const tRow = document.createElement('div'); tRow.className = 'bm-t';
        tRow.appendChild(makeBmVal(tProp)); d.appendChild(tRow);
        const mid = document.createElement('div'); mid.className = 'bm-lr';
        mid.appendChild(makeBmVal(lProp)); mid.appendChild(inner); mid.appendChild(makeBmVal(rProp));
        d.appendChild(mid);
        const bRow = document.createElement('div'); bRow.className = 'bm-b';
        bRow.appendChild(makeBmVal(bProp)); d.appendChild(bRow);
        return d;
    }

    const w = selection.rect?.w ?? Math.round(parseFloat(selection.computed['width'] || 0));
    const h = selection.rect?.h ?? Math.round(parseFloat(selection.computed['height'] || 0));
    const contentEl = document.createElement('div');
    contentEl.className = 'bm-content';
    contentEl.textContent = `${w} × ${h}`;

    const pLayer = makeLayer('bm-padding', 'padding',
        'padding-top', 'padding-right', 'padding-bottom', 'padding-left', contentEl);
    const mLayer = makeLayer('bm-margin', 'margin',
        'margin-top', 'margin-right', 'margin-bottom', 'margin-left', pLayer);

    function postHl(area) {
        const f = document.getElementById('frame');
        if (!f?.contentWindow) return;
        const type = area ? 'highlight' : 'clearHighlight';
        f.contentWindow.postMessage({ source: '__hnkl_editor_host', type, payload: { area } }, '*');
    }

    contentEl.addEventListener('mouseenter', () => postHl('content'));
    contentEl.addEventListener('mouseleave', () => postHl('padding'));
    pLayer.addEventListener('mouseenter', () => postHl('padding'));
    pLayer.addEventListener('mouseleave', () => postHl('margin'));
    mLayer.addEventListener('mouseenter', () => postHl('margin'));
    mLayer.addEventListener('mouseleave', () => postHl(null));

    wrap.appendChild(mLayer);
    return wrap;
}

// ---------------------------------------------------------------- 속성별 스텝
const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

function stepFontWeight(val, dir) {
    const cur = parseFloat(val) || 400;
    const snapped = FONT_WEIGHTS.reduce((p, w) =>
        Math.abs(w - cur) < Math.abs(p - cur) ? w : p);
    const idx = FONT_WEIGHTS.indexOf(snapped);
    return String(FONT_WEIGHTS[Math.max(0, Math.min(8, idx + dir))]);
}

// ---------------------------------------------------------------- 인스펙터
function renderInspector() {
    const empty = $('#emptyState'), insp = $('#inspector');
    if (!selection) { empty.hidden = false; insp.hidden = true; return; }
    empty.hidden = true; insp.hidden = false;

    $('#selTag').textContent =
        selection.tag + (selection.id ? '#' + selection.id : '') +
        (selection.classes.length ? '.' + selection.classes.filter(c => !c.startsWith('__ed')).join('.') : '');
    $('#selMeta').textContent =
        `${selection.rect.w}×${selection.rect.h}px · 자식 ${selection.childCount}개` +
        (selection.text ? ` · "${selection.text}"` : '');

    $('#modeHelp').textContent = mode === 'css'
        ? '같은 선택자를 쓰는 요소 전부가 함께 바뀝니다. CSS 규칙을 직접 고칩니다.'
        : '이 요소에만 style="…" 을 붙입니다. 하나만 예외로 두고 싶을 때 쓰세요.';

    const box = $('#fields');
    box.innerHTML = '';

    // 박스 모델 시각화
    box.appendChild(boxModelWidget());

    // 정렬은 버튼으로
    box.appendChild(alignRow());

    for (const g of GROUPS) {
        const wrap = document.createElement('div');
        wrap.className = 'group';
        wrap.innerHTML = `<h3>${g.title}</h3>`;
        for (const prop of g.props) wrap.appendChild(fieldRow(prop));
        box.appendChild(wrap);
    }
}

function currentValue(prop) {
    const p = pendingFor(prop);
    if (p) return p.kind === 'css' ? p.value : p.changes[prop];
    if (selection.inline[prop] != null) return selection.inline[prop];
    const hits = selection.rules[prop];
    if (hits?.length) return hits[hits.length - 1].value;
    return selection.computed[prop] || '';
}

function originOf(prop) {
    if (selection.inline[prop] != null) {
        return { label: 'style="" (이 요소)', selector: null, kind: 'inline' };
    }
    const hits = selection.rules[prop];
    if (hits?.length) {
        const h = hits[hits.length - 1];
        return {
            label: h.selector + (h.media ? ` @${h.media}` : ''),
            selector: h.selector, media: h.media, kind: 'rule'
        };
    }
    // 이 속성을 직접 정하는 규칙이 없을 때 → 어느 규칙에 새로 넣을지 고른다.
    //   (padding 처럼 한 줄로 묶여 있어 브라우저가 padding-top 을 못 알려주는 경우)
    const target = (selection.elementRules || []).find(r => !r.media);
    if (target) {
        // 이 속성을 정하는 규칙이 아직 없음 → 고치면 이 규칙에 한 줄이 새로 생긴다.
        // (디자인 시스템이 아니라 '이 페이지의 CSS'가 바뀐다는 뜻)
        return { label: `아직 없음 → ${target.selector} 규칙에 새 줄 생김`, selector: target.selector, kind: 'insert' };
    }
    return { label: '계산된 기본값 (규칙 없음)', selector: null, kind: 'none' };
}

function alignRow() {
    const g = document.createElement('div');
    g.className = 'group';
    g.innerHTML = '<h3>텍스트 정렬</h3>';
    const row = document.createElement('div');
    row.className = 'segRow';
    const cur = currentValue('text-align');
    for (const v of ALIGN_OPTIONS) {
        const b = document.createElement('button');
        b.textContent = { left: '왼쪽', center: '가운데', right: '오른쪽' }[v];
        b.className = cur === v ? 'on' : '';
        b.onclick = () => stageEdit('text-align', v);
        row.appendChild(b);
    }
    g.appendChild(row);
    const o = document.createElement('div');
    o.className = 'origin';
    o.innerHTML = `현재 값 <b>${cur || '-'}</b> · ${originOf('text-align').label}`;
    o.style.marginLeft = '0';
    g.appendChild(o);
    return g;
}

// ---------------------------------------------------------------- 토큰 목록 (인스펙터용)
// 기본은 '디자인 시스템 안에서만' 고르게 한다. 임의 값이 필요하면 '직접' 버튼으로 잠금을 푼다.
let insTokens = null;                 // { colors:[{label,name}], fs:[...], space:[...] }
const freeMode = new Set();           // 직접 입력 잠금을 푼 속성들

async function loadInsTokens() {
    try {
        const d = await (await fetch('/__api/designsystem')).json();
        const colors = [
            ...d.roles.map(r => ({ label: r.label, name: r.name })),
            ...d.ramp.map(g => ({ label: '회색 ' + g.step, name: g.name })),
            ...d.surfaces.map(s => ({ label: s.label, name: s.name })),
            ...d.primitives.map(p => ({ label: p.label, name: p.name })),
        ];
        insTokens = {
            colors,
            fs: d.typo.map(t => ({ label: `${t.label} (${t.basePx}px)`, name: t.name })),
            space: d.spacing.map(s => ({ label: `${s.step}단계 (${s.basePx}px)`, name: s.name })),
        };
    } catch { insTokens = null; }
}

const SPACE_PROPS = /^(margin|padding)-(top|right|bottom|left)$|^gap$/;
function tokenChoicesFor(prop) {
    if (!insTokens) return null;
    if (prop === 'color' || prop === 'background-color') return insTokens.colors;
    if (prop === 'font-size') return insTokens.fs;
    if (SPACE_PROPS.test(prop)) return insTokens.space;
    return null;   // line-height·width·display 등은 토큰이 없다 → 자유 입력
}

function fieldRow(prop) {
    const choices = tokenChoicesFor(prop);
    if (choices && !freeMode.has(prop)) return tokenFieldRow(prop, choices);
    return freeFieldRow(prop);
}

/** 토큰 중에서만 고르는 줄 */
function tokenFieldRow(prop, choices) {
    const wrap = document.createElement('div');
    const row = document.createElement('div');
    row.className = 'field';

    const label = document.createElement('label');
    label.textContent = LABEL[prop] || prop;
    row.appendChild(label);

    const cur = currentValue(prop);
    const curVar = (cur.match(/var\(\s*(--[\w-]+)\s*\)/) || [])[1] || null;

    const sel = document.createElement('select');
    sel.className = 'tokenSel';
    if (pendingFor(prop)) sel.classList.add('changed');
    // 토큰이 아닌 값이면 맨 위에 '지금 값'을 보여준다 (고르면 토큰으로 바뀜)
    if (!curVar) {
        const o = document.createElement('option');
        o.value = ''; o.textContent = `지금: ${cur || '없음'} (토큰 아님)`;
        sel.appendChild(o);
    }
    for (const c of choices) {
        const o = document.createElement('option');
        o.value = c.name; o.textContent = c.label;
        sel.appendChild(o);
    }
    sel.value = curVar || '';
    sel.addEventListener('change', () => {
        if (!sel.value) return;
        stageEdit(prop, `var(${sel.value})`);
    });
    row.appendChild(sel);

    const free = document.createElement('button');
    free.className = 'btn ghost tiny freeBtn';
    free.textContent = '직접';
    free.title = '디자인 시스템 밖의 값을 직접 넣습니다 (권장하지 않음)';
    free.addEventListener('click', () => {
        if (!confirm('디자인 시스템 밖의 값을 직접 넣습니다.\n이 값은 토큰과 연결되지 않아 나중에 한꺼번에 못 바꿉니다.\n계속할까요?')) return;
        freeMode.add(prop);
        renderInspector();
    });
    row.appendChild(free);

    wrap.appendChild(row);
    const o = document.createElement('div');
    o.className = 'origin';
    o.innerHTML = `<b>${originOf(prop).label}</b>`;
    wrap.appendChild(o);
    return wrap;
}

/** 자유 입력 줄 (토큰이 없는 속성, 또는 '직접' 잠금 해제) */
function freeFieldRow(prop) {
    const row = document.createElement('div');
    row.className = 'field';

    const label = document.createElement('label');
    label.textContent = LABEL[prop] || prop;
    row.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentValue(prop);

    if (prop === 'color' || prop === 'background-color') {
        const comp = selection.computed[prop] || '';
        const isTransparent = !comp || comp === 'transparent' || comp === 'rgba(0, 0, 0, 0)';
        const swatch = document.createElement('span');
        swatch.className = 'color-swatch' + (isTransparent ? ' is-transparent' : '');
        if (!isTransparent) swatch.style.background = comp;
        swatch.title = comp || 'transparent';
        swatch.addEventListener('click', () => input.focus());
        row.appendChild(swatch);
    }
    input.dataset.prop = prop;
    if (pendingFor(prop)) input.classList.add('changed');
    input.addEventListener('change', () => stageEdit(prop, input.value.trim()));
    input.addEventListener('keydown', e => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const dir = e.key === 'ArrowUp' ? 1 : -1;
        if (prop === 'font-weight') {
            input.value = stepFontWeight(input.value, dir);
        } else {
            const m = input.value.match(/^(-?[\d.]+)(px|rem|em|%|vw|vh)?$/);
            if (!m) return;
            const step = e.shiftKey ? 10 : 1;
            input.value = +(parseFloat(m[1]) + dir * step).toFixed(3) + (m[2] || '');
        }
        stageEdit(prop, input.value);
    });
    row.appendChild(input);

    const stepper = document.createElement('div');
    stepper.className = 'stepper';
    for (const [txt, dir] of [['▲', 1], ['▼', -1]]) {
        const b = document.createElement('button');
        b.textContent = txt;
        b.onclick = () => {
            if (prop === 'font-weight') {
                input.value = stepFontWeight(input.value, dir);
            } else {
                const m = input.value.match(/^(-?[\d.]+)(px|rem|em|%|vw|vh)?$/);
                if (!m) return;
                input.value = +(parseFloat(m[1]) + dir).toFixed(3) + (m[2] || '');
            }
            stageEdit(prop, input.value);
        };
        stepper.appendChild(b);
    }
    row.appendChild(stepper);

    // '직접'으로 풀었던 속성은 다시 토큰 선택으로 돌아갈 수 있게
    if (freeMode.has(prop)) {
        const back = document.createElement('button');
        back.className = 'btn ghost tiny freeBtn';
        back.textContent = '토큰';
        back.title = '디자인 시스템 값에서 고르기로 돌아갑니다';
        back.addEventListener('click', () => { freeMode.delete(prop); renderInspector(); });
        row.appendChild(back);
    }

    const wrap = document.createElement('div');
    wrap.appendChild(row);
    const o = document.createElement('div');
    o.className = 'origin';
    const org = originOf(prop);
    o.innerHTML = `<b>${org.label}</b>`;
    wrap.appendChild(o);
    return wrap;
}

// ---------------------------------------------------------------- 수정 담기
function pendingFor(prop) {
    return pending.find(p =>
        samePath(p.path, selection.path) &&
        (p.kind === 'inline' ? p.changes[prop] !== undefined : p.prop === prop));
}
const samePath = (a, b) => Array.isArray(a) && Array.isArray(b) && a.join() === b.join();

function stageEdit(prop, value) {
    if (!selection) return;

    if (mode === 'css') {
        const org = originOf(prop);
        if (!org.selector) {
            toast('이 요소에 걸린 CSS 규칙이 없어 "이 요소만"으로 바꿉니다.', 'err');
            setMode('inline');
            return stageEdit(prop, value);
        }
        if (org.media) toast(`이 값은 @${org.media} 안에서 정해집니다. 그 규칙을 고칩니다.`);
        else if (org.kind === 'insert') toast(`${org.selector} 규칙에 ${prop} 을 새로 추가합니다.`);
        const i = pending.findIndex(p => p.kind === 'css' && p.selector === org.selector && p.prop === prop);
        const edit = { kind: 'css', selector: org.selector, prop, value, path: selection.path };
        if (i >= 0) pending[i] = edit; else pending.push(edit);
    } else {
        let e = pending.find(p => p.kind === 'inline' && samePath(p.path, selection.path));
        if (!e) { e = { kind: 'inline', path: selection.path, changes: {} }; pending.push(e); }
        e.changes[prop] = value === '' ? null : value;
    }

    updateDirty();
    applyPendingPreview();
}

function applyPendingPreview() {
    // 규칙 수정은 임시 <style> 로, 요소 수정은 인라인으로 미리 보여준다
    const css = pending.filter(p => p.kind === 'css')
        .map(p => `${p.selector}{${p.prop}:${p.value} !important}`).join('\n');
    toFrame('previewCss', { css });
    for (const p of pending.filter(p => p.kind === 'inline')) {
        toFrame('preview', { path: p.path, changes: p.changes });
    }
}

function setMode(m) {
    mode = m;
    [...$('#modeSeg').children].forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    renderInspector();
}
$('#modeSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (b) setMode(b.dataset.mode);
});

function updateDirty() {
    const n = pending.reduce((s, p) => s + (p.kind === 'inline' ? Object.keys(p.changes).length : 1), 0);
    $('#dirty').hidden = n === 0;
    $('#dirtyCount').textContent = n;
    $('#saveBtn').disabled = n === 0;
    $('#revertBtn').disabled = n === 0;
}

// ---------------------------------------------------------------- 저장 / 되돌리기
$('#revertBtn').addEventListener('click', () => {
    pending = [];
    updateDirty();
    toFrame('clearPreview', {});
    frame.src = frame.src;
});

$('#saveBtn').addEventListener('click', async () => {
    if (!pending.length) return;
    $('#saveBtn').disabled = true;
    $('#saveBtn').textContent = '저장 중…';
    try {
        const res = await fetch('/__api/patch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: currentPage,
                edits: pending.map(p => p.kind === 'css'
                    ? { kind: 'css', selector: p.selector, prop: p.prop, value: p.value }
                    : { kind: 'inline', path: p.path, changes: p.changes })
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '저장 실패');
        toast(`저장 완료 — ${data.applied.length}건`, 'ok');
        pending = [];
        updateDirty();
        frame.src = frame.src;      // 저장된 실제 파일을 다시 읽어온다
    } catch (err) {
        toast('저장 실패: ' + err.message, 'err');
    } finally {
        $('#saveBtn').textContent = '파일에 저장';
        updateDirty();
    }
});

// ---------------------------------------------------------------- 알림
let toastTimer;
function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

// 저장 안 한 채로 창을 닫으려 하면 경고
window.addEventListener('beforeunload', e => {
    if (pending.length) { e.preventDefault(); e.returnValue = ''; }
});

// ---------------------------------------------------------------- 디자인 시스템 모드
let dsMode = false;

$('#editTab').addEventListener('click', () => setAppMode(false));
$('#dsTab').addEventListener('click', () => setAppMode(true));

function setAppMode(ds) {
    dsMode = ds;
    $('#editTab').classList.toggle('on', !ds);
    $('#dsTab').classList.toggle('on', ds);

    // 편집 전용 구역(중앙 뷰포트 제어 + 우측 도구/액션)은 DS 모드에서 통째로 숨김.
    // 좌측 구역(브랜드·모드·파일)은 두 모드 공통으로 유지.
    document.querySelector('.bar-center').hidden = ds;
    document.querySelector('.bar-right').hidden = ds;
    $('#compToggle').hidden = ds;
    if (ds) closeLeftPanel();

    document.querySelector('.layout').style.display = ds ? 'none' : '';
    document.getElementById('dsView').style.display = ds ? 'flex' : 'none';

    if (ds) {
        // 서버가 tokens.css 를 파싱해서 준다 (미리보기 iframe 과 무관)
        fetchDesignSystem();
    }
}

// ---------------------------------------------------------------- 좌측 컴포넌트 패널
const leftPanel = $('#leftPanel');
function openLeftPanel() {
    leftPanel.hidden = false;
    $('#compToggle').classList.add('on');
    $('#compToggle').setAttribute('aria-pressed', 'true');
}
function closeLeftPanel() {
    leftPanel.hidden = true;
    $('#compToggle').classList.remove('on');
    $('#compToggle').setAttribute('aria-pressed', 'false');
}
$('#compToggle').addEventListener('click', () => leftPanel.hidden ? openLeftPanel() : closeLeftPanel());
$('#compClose').addEventListener('click', closeLeftPanel);

// ---------------------------------------------------------------- 디자인 시스템
// ① 색 · 팔레트 — '색 자체'. 이름도 색 이름으로 부른다(용도 이름을 쓰면 역할과 겹쳐 헷갈림).
// ② 색 · 역할  — '어디에 쓰는지'. 팔레트에서 골라 연결하고, 라이트/다크 값을 같이 보여준다.
// ③ 타이포     — 크기는 더블클릭해 입력, 굵기는 그 크기와 실제로 함께 쓰이는 것들.
function el(tag, cls, text) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
}
function dEl(tag, cls, key, val) { const d = el(tag, cls); d.dataset[key] = val; return d; }

function currentScale() {
    const w = bp.w;
    return w < 1024 ? 1 : Math.min(1, Math.max(0.8, 0.5 + w / 5120));
}
const round1 = n => Math.round(n * 10) / 10;
const varName = name => Object.assign(el('span', 'ds-var'), { textContent: name });

// 팔레트에서 쓸 '색 이름' (tokens.css 의 용도 이름 대신)
const PALETTE_LABEL = {
    '--surface': '흰색',
    '--bg': '회색 50',        // 값(#F5F5F7)은 그대로 두고 램프 50 자리에 표시만 한다
    '--blue': '블루',
    '--purple': '퍼플',
    '--teal': '틸',
    '--dark-surface': '먹색',
};
// --panel 은 회색 100 과 같은 값을 가리키게 정리했으므로 팔레트에 따로 두지 않는다.
const PALETTE_SKIP = new Set(['--panel']);

let dsData = null;
let dsEdits = {};
let dsBaseHex = {}, dsDarkHex = {}, dsBasePx = {}, dsBaseLink = {};
let dsPalette = [];

// 역할 목록: 2층 토큰만 (팔레트를 직접 쓰는 --panel 은 제외하고 아래 주석으로 알린다)
const ROLE_SKIP = new Set(['--panel']);

// 팔레트를 3그룹으로 정리해 둔다 (표시용 — tokens.css 는 그대로)
//   흰색 & 검정 / 회색 램프 50~900 / 포인트 · 서브
let dsGroups = { whites: [], ramp: [], primitives: [] };

function buildDsBase(d) {
    dsBaseHex = {}; dsDarkHex = {}; dsBasePx = {}; dsBaseLink = {}; dsPalette = [];
    dsGroups = { whites: [], ramp: [], primitives: [] };
    const add = (group, name, label, hex, darkHex) => {
        if (PALETTE_SKIP.has(name)) return;
        dsBaseHex[name] = hex;
        if (darkHex) dsDarkHex[name] = darkHex;
        dsPalette.push({ name, label });
        group.push({ name, label });
    };

    const byName = n => d.surfaces.find(s => s.name === n);
    const surf = byName('--surface'), bg = byName('--bg');

    // ① 흰색 & 검정 — 흰색만 토큰이 있다. 검정 자리는 회색 900 을 참고로 보여준다.
    if (surf) add(dsGroups.whites, surf.name, PALETTE_LABEL[surf.name], surf.hex, surf.darkHex);

    // ② 회색 램프 — #F5F5F7(--bg) 을 50 자리에 함께 (값·참조는 그대로)
    if (bg) add(dsGroups.ramp, bg.name, PALETTE_LABEL[bg.name], bg.hex, bg.darkHex);
    for (const g of d.ramp) add(dsGroups.ramp, g.name, '회색 ' + g.step, g.hex, g.darkHex);

    // ③ 포인트 · 서브
    for (const p of d.primitives) add(dsGroups.primitives, p.name, PALETTE_LABEL[p.name] || p.label, p.hex, null);

    // 팔레트에서 뺀 --panel 도 역할 해석에는 필요하므로 색만 등록해 둔다
    const panel = byName('--panel');
    if (panel) { dsBaseHex[panel.name] = panel.hex; if (panel.darkHex) dsDarkHex[panel.name] = panel.darkHex; }

    for (const r of d.roles) if (!ROLE_SKIP.has(r.name) && r.linked) dsBaseLink[r.name] = r.linked;
    for (const t of d.typo) dsBasePx[t.name] = t.basePx;
}
const effHex = n => (n in dsEdits && n in dsBaseHex) ? dsEdits[n] : dsBaseHex[n];
const darkHexOf = n => dsDarkHex[n] || effHex(n);      // 다크값이 따로 없으면 같은 색
const effLink = r => (r in dsEdits) ? dsEdits[r] : dsBaseLink[r];
const effPx = n => (n in dsEdits && n in dsBasePx) ? +dsEdits[n] : dsBasePx[n];
const roleHex = r => effHex(effLink(r));
const roleDark = r => darkHexOf(effLink(r));
function isChanged(n) {
    if (!(n in dsEdits)) return false;
    if (n in dsBaseHex) return dsEdits[n] !== dsBaseHex[n];
    if (n in dsBaseLink) return dsEdits[n] !== dsBaseLink[n];
    if (n in dsBasePx) return +dsEdits[n] !== dsBasePx[n];
    return false;
}
const changedNames = () => Object.keys(dsEdits).filter(isChanged);

function lum(hex) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
    if (!a || !b) return 0;
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100;
}

async function fetchDesignSystem() {
    const canvas = document.getElementById('dsCanvas');
    canvas.innerHTML = '<div class="ds-loading">tokens.css 읽는 중…</div>';
    try {
        const res = await fetch('/__api/designsystem');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        dsData = await res.json();
        dsEdits = {};
        buildDsBase(dsData);
        renderDesignSystem(dsData);
    } catch (e) {
        canvas.innerHTML = '<div class="ds-loading">불러오기 실패: ' + e.message + '</div>';
    }
}
function applyEdit(name, value) { dsEdits[name] = value; refresh(); }

function renderDesignSystem(d) {
    const canvas = document.getElementById('dsCanvas');
    canvas.innerHTML = '';
    const inner = el('div', 'ds-inner');
    inner.append(sectionPalette(d), sectionRoles(d), sectionTypo(d));
    canvas.appendChild(inner);
    refresh();
}
function dsSection(title, desc) {
    const s = el('section', 'ds3-section');
    s.appendChild(el('h2', 'ds3-title', title));
    if (desc) s.appendChild(el('p', 'ds3-desc', desc));
    return s;
}

// ── 칩 카드 (크기 통일 · 색 면적 넓게) ──
function chipCard(name, label) {
    const card = el('div', 'ds3-chip');
    card.dataset.cell = name;
    const inp = el('input', 'ds3-chip-color');
    inp.type = 'color';
    inp.dataset.chip = name;
    inp.title = label + ' — 눌러서 색 고르기';
    inp.addEventListener('input', () => applyEdit(name, inp.value.toUpperCase()));
    const meta = el('div', 'ds3-chip-meta');
    meta.append(el('div', 'ds3-chip-name', label), dEl('div', 'ds3-chip-hex', 'hex', name));
    card.append(inp, meta);
    const chg = el('span', 'ds3-chg'); chg.dataset.chg = name; card.appendChild(chg);
    return card;
}
function chipRow(items) {
    const row = el('div', 'ds3-chips');
    for (const it of items) row.appendChild(chipCard(it.name, it.label));
    return row;
}

// ① 색 · 팔레트
function sectionPalette(d) {
    const s = dsSection('색 · 팔레트', '색 자체입니다. 여기서는 색 이름으로만 부르고, 어디에 쓸지는 아래 "역할"에서 정합니다.');

    s.appendChild(el('h3', 'ds3-sub', '흰색 & 검정'));
    const wRow = chipRow(dsGroups.whites);
    // 검정은 아직 토큰이 없다 → 자리만 두고 가장 어두운 회색을 참고로 보여준다
    const darkest = dsGroups.ramp.at(-1);
    if (darkest) {
        const ref = el('div', 'ds3-chip is-ref');
        const face = el('div', 'ds3-chip-refface');
        face.style.background = effHex(darkest.name);
        const meta = el('div', 'ds3-chip-meta');
        meta.append(el('div', 'ds3-chip-name', '검정 (없음)'),
            el('div', 'ds3-chip-hex', darkest.label + ' 참고'));
        ref.append(face, meta);
        ref.title = '검정 토큰은 아직 만들지 않았습니다. 가장 어두운 ' + darkest.label + ' 을 참고로 보여줍니다.';
        wRow.appendChild(ref);
    }
    s.appendChild(wRow);

    s.appendChild(el('h3', 'ds3-sub', '회색 램프 — 밝은 것부터'));
    s.appendChild(chipRow(dsGroups.ramp));

    s.appendChild(el('h3', 'ds3-sub', '포인트 · 서브'));
    s.appendChild(chipRow(dsGroups.primitives));
    return s;
}

// ② 색 · 역할
function sectionRoles(d) {
    const s = dsSection('색 · 역할',
        '어디에 쓰는 색인지 정합니다. 팔레트에서 골라 연결하며, 직접 색을 넣을 수는 없습니다. 다크모드 값도 함께 보여줍니다.');
    const grid = el('div', 'ds3-roles');
    for (const r of d.roles) {
        if (ROLE_SKIP.has(r.name) || !dsBaseLink[r.name]) continue;
        const card = el('div', 'ds3-role'); card.dataset.role = r.name;

        const head = el('div', 'ds3-role-head');
        head.append(el('span', 'ds3-role-name', r.label), varName(r.name));
        const chg = el('span', 'ds3-chg'); chg.dataset.chg = r.name; head.appendChild(chg);

        const sel = el('select', 'ds3-select');
        for (const o of dsPalette) {
            const opt = el('option'); opt.value = o.name; opt.textContent = o.label;
            sel.appendChild(opt);
        }
        sel.value = effLink(r.name);
        sel.addEventListener('change', () => applyEdit(r.name, sel.value));

        // 라이트 / 다크 두 칸
        const modes = el('div', 'ds3-modes');
        for (const m of ['light', 'dark']) {
            const box = el('div', 'ds3-mode ' + m);
            box.append(
                el('div', 'ds3-mode-label', m === 'light' ? '라이트' : '다크'),
                dEl('div', 'ds3-mode-chip', m === 'light' ? 'rolechip' : 'rolechipdark', r.name),
                dEl('div', 'ds3-mode-hex', m === 'light' ? 'rolehex' : 'rolehexdark', r.name),
            );
            if (r.contrast) box.appendChild(dEl('div', 'ds3-mode-contrast', m === 'light' ? 'contrast' : 'contrastdark', r.name));
            modes.appendChild(box);
        }
        card.append(head, sel, modes);
        grid.appendChild(card);
    }
    s.appendChild(grid);
    s.appendChild(el('p', 'ds3-foot', '면 배경(--panel)은 역할을 거치지 않고 팔레트를 그대로 쓰고 있어 여기 없습니다.'));
    return s;
}

// ③ 타이포
function sectionTypo(d) {
    const s = dsSection('타이포', '크기 숫자를 더블클릭하면 바꿀 수 있습니다. 굵기는 그 크기와 실제로 함께 쓰이는 것들입니다.');
    const table = el('div', 'ds3-typo');
    const head = el('div', 'ds3-typo-row is-head');
    head.append(el('div', 'ds3-th', '이름'), el('div', 'ds3-th', '보기'),
        el('div', 'ds3-th ta-r', '크기'), el('div', 'ds3-th', '굵기'));
    table.appendChild(head);

    for (const t of d.typo) {
        const row = el('div', 'ds3-typo-row'); row.dataset.typo = t.name;

        const nameCell = el('div', 'ds3-typo-name');
        nameCell.append(el('span', 'ds3-typo-label', t.label), varName(t.name));
        const chg = el('span', 'ds3-chg'); chg.dataset.chg = t.name; nameCell.appendChild(chg);

        const sizeCell = el('div', 'ds3-typo-size ta-r');
        sizeCell.append(dEl('span', 'ds3-numbox', 'numbox', t.name));

        const wCell = el('div', 'ds3-typo-weights');
        if (t.weights.length) {
            for (const w of t.weights) {
                const b = el('span', 'ds3-wbadge', String(w));
                b.style.fontWeight = w;
                wCell.appendChild(b);
            }
        } else wCell.appendChild(el('span', 'ds3-wnone', '안 쓰임'));

        row.append(nameCell, dEl('div', 'ds3-typo-sample', 'sample', t.name), sizeCell, wCell);
        table.appendChild(row);
    }
    s.appendChild(table);
    return s;
}

// 크기 숫자 더블클릭 편집 (위임 — refresh 로 다시 그려도 유지)
document.addEventListener('dblclick', e => {
    const box = e.target.closest('[data-numbox]');
    if (!box || box.querySelector('input')) return;
    const name = box.dataset.numbox;
    const inp = el('input', 'ds3-numinput');
    inp.type = 'text';
    inp.value = effPx(name);
    box.innerHTML = '';
    box.appendChild(inp);
    inp.focus(); inp.select();
    let done = false;
    const commit = () => {
        if (done) return;            // Enter 뒤 blur 로 두 번 들어오는 것 방지
        done = true;
        const v = parseFloat(inp.value);
        inp.remove();                // 먼저 걷어내야 refresh 가 숫자를 다시 그린다
        if (!isNaN(v) && v > 0 && v < 400) applyEdit(name, Math.round(v));
        else refresh();
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        if (ev.key === 'Escape') { ev.preventDefault(); done = true; inp.remove(); refresh(); }
    });
});

// ── 실시간 갱신 ──
function refresh() {
    const scale = currentScale();
    const SAMPLE = '다람쥐 헌 쳇바퀴';
    const q = s => document.querySelectorAll(s);

    const lightBg = effHex(effLink('--bg-color'));
    const darkBg = darkHexOf(effLink('--bg-color'));

    q('[data-chip]').forEach(i => { const h = effHex(i.dataset.chip); if (h) i.value = h.toLowerCase(); });
    q('[data-hex]').forEach(e => e.textContent = effHex(e.dataset.hex) || '');

    q('[data-rolechip]').forEach(e => e.style.background = roleHex(e.dataset.rolechip) || 'transparent');
    q('[data-rolechipdark]').forEach(e => e.style.background = roleDark(e.dataset.rolechipdark) || 'transparent');
    q('[data-rolehex]').forEach(e => e.textContent = roleHex(e.dataset.rolehex) || '—');
    q('[data-rolehexdark]').forEach(e => e.textContent = roleDark(e.dataset.rolehexdark) || '—');
    const setC = (node, hex, bg) => {
        const v = contrast(hex, bg);
        node.textContent = '대비 ' + v + (v < 4.5 ? ' ⚠' : '');
        node.classList.toggle('bad', v < 4.5);
    };
    q('[data-contrast]').forEach(n => setC(n, roleHex(n.dataset.contrast), lightBg));
    q('[data-contrastdark]').forEach(n => setC(n, roleDark(n.dataset.contrastdark), darkBg));

    q('[data-sample]').forEach(e => {
        const n = e.dataset.sample, px = effPx(n);
        const w = (dsData.typo.find(t => t.name === n)?.weights || [])[0] || 400;
        e.textContent = SAMPLE;
        if (px != null) e.style.fontSize = round1(px * scale) + 'px';
        e.style.fontWeight = w;
    });
    q('[data-numbox]').forEach(box => {
        if (box.querySelector('input')) return;      // 편집 중이면 건드리지 않는다
        const n = box.dataset.numbox;
        box.innerHTML = `<b>${effPx(n)}</b><span class="ds3-unit">px</span>`
            + `<span class="ds3-onscreen">화면 ${round1(effPx(n) * scale)}</span>`;
    });

    q('[data-chg]').forEach(b => {
        const n = b.dataset.chg;
        if (isChanged(n)) {
            const orig = n in dsBaseHex ? dsBaseHex[n]
                : n in dsBaseLink ? (dsPalette.find(p => p.name === dsBaseLink[n])?.label || dsBaseLink[n])
                    : dsBasePx[n] + 'px';
            b.textContent = '바뀜 · 원래 ' + orig;
            b.hidden = false;
        } else { b.hidden = true; b.textContent = ''; }
    });
    q('[data-cell]').forEach(c => c.classList.toggle('is-changed', isChanged(c.dataset.cell)));
    q('[data-role]').forEach(c => c.classList.toggle('is-changed', isChanged(c.dataset.role)));
    q('[data-typo]').forEach(c => c.classList.toggle('is-changed', isChanged(c.dataset.typo)));

    updateDsToolbar();
    pushTokenPreview();
}

function editAsDecl(name) {
    if (name in dsBaseHex) return effHex(name);
    if (name in dsBaseLink) return 'var(' + effLink(name) + ')';
    if (name in dsBasePx) return `calc(${effPx(name)}px * var(--s))`;
    return null;
}
function pushTokenPreview() {
    const decls = changedNames().map(n => `  ${n}: ${editAsDecl(n)};`).join('\n');
    toFrame('tokenPreview', { css: decls ? `:root{\n${decls}\n}` : '' });
}
function updateDsToolbar() {
    const n = changedNames().length;
    const dirty = $('#dsDirty'); if (dirty) { dirty.hidden = n === 0; const c = $('#dsDirtyCount'); if (c) c.textContent = n; }
    if ($('#dsRevert')) $('#dsRevert').disabled = n === 0;
    if ($('#dsSave')) $('#dsSave').disabled = n === 0;
}
function dsRevert() { dsEdits = {}; renderDesignSystem(dsData); }

function dsSaveConfirm() {
    const names = changedNames();
    if (!names.length) return;
    const list = $('#dsConfirmList'); list.innerHTML = '';
    for (const n of names) {
        const before = n in dsBaseHex ? dsBaseHex[n]
            : n in dsBaseLink ? `var(${dsBaseLink[n]})`
                : `calc(${dsBasePx[n]}px * var(--s))`;
        const row = el('div', 'ds-confirm-row');
        row.append(
            Object.assign(el('span', 'ds-confirm-name'), { textContent: n }),
            Object.assign(el('span', 'ds-confirm-before'), { textContent: before }),
            Object.assign(el('span', 'ds-confirm-arrow'), { textContent: '→' }),
            Object.assign(el('span', 'ds-confirm-after'), { textContent: editAsDecl(n) }),
        );
        list.appendChild(row);
    }
    $('#dsConfirm').hidden = false;
}
async function dsSaveCommit() {
    const edits = {};
    for (const n of changedNames()) edits[n] = editAsDecl(n);
    $('#dsConfirmOk').disabled = true;
    try {
        const res = await fetch('/__api/savetokens', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ edits }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '저장 실패');
        $('#dsConfirm').hidden = true;
        toast(`저장됨 — ${data.applied.length}건 · 백업 ${data.backup}`, 'ok');
        await fetchDesignSystem();
    } catch (e) {
        toast('저장 실패: ' + e.message, 'err');
    } finally { $('#dsConfirmOk').disabled = false; }
}

$('#dsRevert')?.addEventListener('click', dsRevert);
$('#dsSave')?.addEventListener('click', dsSaveConfirm);
$('#dsConfirmCancel')?.addEventListener('click', () => { $('#dsConfirm').hidden = true; });
$('#dsConfirmOk')?.addEventListener('click', dsSaveCommit);
$('#dsShowVars')?.addEventListener('change', e => {
    document.getElementById('dsView').classList.toggle('show-vars', e.target.checked);
});

// ---------------------------------------------------------------- 칩 모양 조절 인스펙터
// 칩 크기·색 면적·아래 텍스트 여백을 직접 만져볼 수 있는 작은 창.
// CSS 변수만 바꾸므로 파일에는 아무 영향이 없다.
const CHIP_VARS = [
    { v: '--chip-w', label: '칩 너비', min: 60, max: 200, def: 104 },
    { v: '--chip-h', label: '색 높이', min: 40, max: 180, def: 104 },
    { v: '--chip-px', label: '글자 좌우 여백', min: 0, max: 24, def: 9 },
    { v: '--chip-pt', label: '글자 위 여백', min: 0, max: 24, def: 8 },
    { v: '--chip-pb', label: '글자 아래 여백', min: 0, max: 24, def: 9 },
    { v: '--chip-gap', label: '이름 ↔ 코드 간격', min: 0, max: 16, def: 2 },
    { v: '--chip-radius', label: '모서리', min: 0, max: 24, def: 12 },
];
function buildChipTuner() {
    const host = $('#chipTunerRows');
    if (!host || host.childElementCount) return;
    const canvas = document.getElementById('dsCanvas');
    for (const c of CHIP_VARS) {
        const row = el('div', 'ct-row');
        const top = el('div', 'ct-top');
        const out = el('output', null, c.def + 'px');
        top.append(el('span', null, c.label), out);
        const inp = el('input', 'ct-range');
        inp.type = 'range'; inp.min = c.min; inp.max = c.max; inp.value = c.def; inp.step = 1;
        inp.addEventListener('input', () => {
            canvas.style.setProperty(c.v, inp.value + 'px');
            out.textContent = inp.value + 'px';
        });
        row.append(top, inp);
        host.appendChild(row);
    }
}
$('#chipTunerBtn')?.addEventListener('click', () => {
    const p = $('#chipTuner');
    buildChipTuner();
    p.hidden = !p.hidden;
    $('#chipTunerBtn').classList.toggle('on', !p.hidden);
});
$('#chipTunerClose')?.addEventListener('click', () => {
    $('#chipTuner').hidden = true;
    $('#chipTunerBtn').classList.remove('on');
});





// ---------------------------------------------------------------- 시작
updateBpRes();
applyStage();
loadPages();
// 인스펙터가 '토큰 중에서만' 고르게 하려면 토큰 목록이 먼저 필요하다.
loadInsTokens().then(() => { if (selection) renderInspector(); });
