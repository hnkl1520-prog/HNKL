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
    needsCenter = true;
    applyStage();
});

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
        return { label: `${target.selector} 에 추가`, selector: target.selector, kind: 'insert' };
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

function fieldRow(prop) {
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

    // 편집 전용 컨트롤 표시/숨김
    for (const id of ['pageSelect', 'breakpoints', 'zoom', 'pickBtn', 'reloadBtn',
                       'dirty', 'revertBtn', 'saveBtn']) {
        const el = document.getElementById(id) || $('#' + id);
        if (el) el.hidden = ds;
    }
    // zoomWrap은 label이라 id 따로 없으므로 클래스로 접근
    const zw = document.querySelector('.zoomWrap');
    const bp = document.querySelector('.bp');
    const seps = [...document.querySelectorAll('.bar .sep')];
    if (zw) zw.hidden = ds;
    if (bp) bp.hidden = ds;
    // sep들도 정리 (첫 번째는 brand 옆 → 유지, 나머지 숨김)
    seps.slice(1).forEach(s => s.hidden = ds);

    document.querySelector('.layout').style.display = ds ? 'none' : '';
    document.getElementById('dsView').style.display = ds ? 'flex' : 'none';

    if (ds) {
        const canvas = document.getElementById('dsCanvas');
        canvas.innerHTML = '<div class="ds-loading">데이터를 불러오는 중…</div>';
        // bridge가 준비됐으면 바로 요청
        toFrame('getDesignSystem', {});
    }
}

// ---------------------------------------------------------------- 디자인 시스템 렌더
function el(tag, cls) { const d = document.createElement(tag); if (cls) d.className = cls; return d; }

/**
 * --vb-line → line 처럼 프로젝트 접두사를 벗긴다.
 * 단어 하나만 보고 자르면 --card-bg 가 bg 로 뭉개지므로,
 * '여러 토큰이 공유하는 접두사'만 진짜 네임스페이스로 보고 제거한다.
 */
function makeTokenCleaner(names) {
    const counts = {};
    const head = n => n.replace(/^--/, '').match(/^([a-z]{2,4}\d*)-(?=[a-z])/);
    names.forEach(n => { const m = head(n); if (m) counts[m[1]] = (counts[m[1]] || 0) + 1; });
    const nsp = new Set(Object.entries(counts).filter(([, c]) => c >= 3).map(([p]) => p));
    return name => {
        const bare = name.replace(/^--/, '');
        const m = head(name);
        return m && nsp.has(m[1]) ? bare.slice(m[0].length) : bare;
    };
}
const prettyToken = n =>
    n.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// ── 색 계산 ──
function parseRgb(str) {
    if (!str) return null;
    const m = str.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (m) return [+m[1], +m[2], +m[3]];
    const h = str.trim().replace('#', '');
    if (/^[0-9a-f]{6}$/i.test(h)) return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16));
    if (/^[0-9a-f]{3}$/i.test(h)) return [...h].map(c => parseInt(c + c, 16));
    return null;
}
const toHex = rgb => '#' + rgb
    .map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'))
    .join('').toUpperCase();

function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, s = 0;
    if (d) {
        s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
        if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
    }
    return [h, s * 100, l * 100];
}
function hslToRgb([h, s, l]) {
    h /= 360; s /= 100; l /= 100;
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = t => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255));
}

// 레퍼런스와 같은 14단계 (1=가장 밝음, 100=가장 어두움)
const RAMP_STEPS = [1, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100];
const stepToL = step => 98 - step * 0.96;

function buildRamp(rgb) {
    const [h, s, l] = rgbToHsl(rgb);
    // 원본 색이 어느 단계에 해당하는지 표시해 준다
    const baseStep = RAMP_STEPS.reduce((best, st) =>
        Math.abs(stepToL(st) - l) < Math.abs(stepToL(best) - l) ? st : best, RAMP_STEPS[0]);
    return RAMP_STEPS.map(step => {
        // 아주 밝은 쪽은 채도를 낮춰야 파스텔처럼 자연스럽다
        const sAdj = step <= 20 ? s * (0.5 + (step / 20) * 0.5) : s;
        return {
            step,
            hex: toHex(hslToRgb([h, sAdj, stepToL(step)])),
            isBase: step === baseStep,
        };
    });
}

function swatchRow(ramp) {
    const row = el('div', 'ds-swatch-row');
    ramp.forEach(({ step, hex, isBase }) => {
        const sw = el('div', 'ds-swatch' + (isBase ? ' is-base' : ''));
        const color = el('div', 'ds-swatch-color');
        color.style.background = hex;
        const meta = el('div', 'ds-swatch-meta');
        meta.append(
            Object.assign(el('div', 'ds-swatch-step'), { textContent: step }),
            Object.assign(el('div', 'ds-swatch-hex'), { textContent: hex })
        );
        sw.append(color, meta);
        row.appendChild(sw);
    });
    return row;
}

function palBlock(title, subs) {
    const block = el('div', 'ds-pal-block');
    block.appendChild(Object.assign(el('h2'), { textContent: title }));
    subs.forEach(({ label, ramp }) => {
        const sub = el('div', 'ds-pal-sub');
        if (label) sub.appendChild(Object.assign(el('h3'), { textContent: label }));
        sub.appendChild(swatchRow(ramp));
        block.appendChild(sub);
    });
    return block;
}

// ── 문서 껍데기 ──
function docFrame(label, cls) {
    const frame = el('div', 'ds-frame ' + cls);
    frame.appendChild(Object.assign(el('div', 'ds-frame-label'), { textContent: label }));
    const doc = el('div', 'ds-doc');
    const body = el('div', 'ds-doc-body');
    doc.appendChild(body);
    frame.appendChild(doc);
    return { frame, body };
}

// ---------------------------------------------------------------- 메인
function renderDesignSystem(data) {
    const canvas = document.getElementById('dsCanvas');
    canvas.innerHTML = '';

    const { fontStyles = [], colorTokens = [] } = data;

    canvas.appendChild(colorPaletteDoc(colorTokens));
    canvas.appendChild(typeScaleDoc(fontStyles));
}

// ── 문서 1: Color Palettes ──
function colorPaletteDoc(colorTokens) {
    const { frame, body } = docFrame('Color Palettes', 'ds-frame-color');

    const clean = makeTokenCleaner(colorTokens.map(t => t.name));

    // 값이 완전히 같은 토큰은 한 줄로 합친다 (--bg / --bg-tint 처럼 중복 정의된 것들)
    const byHex = new Map();
    for (const t of colorTokens) {
        const rgb = parseRgb(t.value) || parseRgb(t.raw);
        if (!rgb) continue;
        const hex = toHex(rgb);
        if (byHex.has(hex)) { byHex.get(hex).names.push(clean(t.name)); continue; }
        byHex.set(hex, { names: [clean(t.name)], rgb });
    }
    const uniq = [...byHex.values()].map(t => ({ ...t, name: t.names[0] }));

    body.appendChild(Object.assign(el('p', 'ds-note'), {
        textContent: '페이지에 정의된 색 토큰을 14단계(1 = 가장 밝음, 100 = 가장 어두움)로 펼친 것. ● 이 원래 토큰의 위치.',
    }));

    body.appendChild(palBlock('White & Black', [{
        label: null,
        ramp: [{ step: 'White', hex: '#FFFFFF' }, { step: 'Black', hex: '#000000' }],
    }]));

    // 중립(회색 계열)은 램프가 사실상 동일하므로 딱 한 줄로 대표시킨다
    const neutrals = uniq.filter(t => rgbToHsl(t.rgb)[1] < 14);
    const chromatic = uniq.filter(t => rgbToHsl(t.rgb)[1] >= 14);

    if (neutrals.length) {
        // 가장 중간 밝기인 회색을 기준 삼아야 램프가 고르게 펼쳐진다
        const base = neutrals.reduce((best, t) =>
            Math.abs(rgbToHsl(t.rgb)[2] - 50) < Math.abs(rgbToHsl(best.rgb)[2] - 50) ? t : best);
        body.appendChild(palBlock('Gray', [{ label: null, ramp: buildRamp(base.rgb) }]));
    }

    // 색상환에서 45° 안쪽이면 사실상 같은 색 → 한 줄만 남긴다
    const seen = new Set();
    const distinct = chromatic.filter(t => {
        const bucket = Math.round(rgbToHsl(t.rgb)[0] / 45);
        if (seen.has(bucket)) return false;
        seen.add(bucket);
        return true;
    });

    const PRIMARY = /accent|primary|brand|key|point/i;
    const FUNCTIONAL = /warn|error|danger|success|info|alert|caution|positive|negative/i;

    const rowOf = t => ({ label: prettyToken(t.name), ramp: buildRamp(t.rgb) });
    const primary = distinct.filter(t => PRIMARY.test(t.name));
    const functional = distinct.filter(t => !PRIMARY.test(t.name) && FUNCTIONAL.test(t.name));
    const others = distinct.filter(t => !PRIMARY.test(t.name) && !FUNCTIONAL.test(t.name));

    if (primary.length) {
        body.appendChild(palBlock('Primary', primary.map(t =>
            primary.length > 1 ? rowOf(t) : { label: null, ramp: buildRamp(t.rgb) })));
    }
    if (functional.length) body.appendChild(palBlock('Functional', functional.map(rowOf)));
    if (others.length) body.appendChild(palBlock('Sub', others.map(rowOf)));

    if (!uniq.length) {
        body.appendChild(Object.assign(el('p', 'ds-note'), {
            textContent: '이 페이지에서 CSS 변수로 정의된 색을 찾지 못했습니다.',
        }));
    }
    return frame;
}

// ── 문서 2: Type scale ──
// 크기가 촘촘한 페이지에서도 이름이 겹치지 않도록, 절대 px 로 시작점만 잡고
// 그 아래로는 사다리를 한 칸씩 내려가며 붙인다.
const TYPE_LADDER = [
    'Display', 'Headline xl', 'Headline lg', 'Headline md', 'Headline sm',
    'Title lg', 'Title md', 'Title sm', 'Title xs',
    'Body xl', 'Body lg', 'Body md', 'Body sm', 'Body xs', 'Body 2xs', 'Body 3xs',
];
const TYPE_ANCHOR = [[40, 0], [32, 1], [28, 2], [24, 3], [20, 4], [18, 5], [16, 6], [0, 7]];

function ladderNames(sizesDesc) {
    const start = (TYPE_ANCHOR.find(([min]) => sizesDesc[0] >= min) || TYPE_ANCHOR.at(-1))[1];
    // 사다리를 다 쓰면 Body 3xs 다음을 4xs, 5xs … 로 이어 붙인다
    return sizesDesc.map((_, i) => TYPE_LADDER[start + i] || `Body ${start + i - 12}xs`);
}

function typeScaleDoc(fontStyles) {
    const { frame, body } = docFrame('Type styles', 'ds-frame-type');

    if (!fontStyles.length) {
        body.appendChild(Object.assign(el('p', 'ds-note'), {
            textContent: '이 페이지에서 폰트 스타일을 찾지 못했습니다.'
        }));
        return frame;
    }

    body.appendChild(Object.assign(el('p', 'ds-note'), {
        textContent: `이 페이지에서 실제로 쓰이는 조합 ${fontStyles.length}종.`,
    }));

    // 같은 크기는 한 묶음으로, 굵기만 여러 줄
    const bySize = new Map();
    fontStyles.forEach(s => {
        const px = parseFloat(s.fontSize);
        if (!bySize.has(px)) bySize.set(px, []);
        bySize.get(px).push(s);
    });
    const sizes = [...bySize.keys()].sort((a, b) => b - a);
    const names = ladderNames(sizes);

    const table = el('table', 'ds-type-table');
    table.innerHTML = `<thead><tr>
        <th style="width:150px">Scale Category</th>
        <th style="width:46px">Size</th>
        <th style="width:52px">Weight</th>
        <th>Usage</th>
    </tr></thead>`;

    sizes.forEach((px, si) => {
        const variants = bySize.get(px).sort(
            (a, b) => (+b.fontWeight || 400) - (+a.fontWeight || 400));
        const tbody = el('tbody', 'ds-type-group');

        variants.forEach((s, i) => {
            const tr = el('tr');

            if (i === 0) {
                const nameTd = el('td');
                nameTd.rowSpan = variants.length;
                const nm = el('div', 'ds-type-name');
                nm.textContent = names[si];
                // 실제 크기·굵기 그대로 보여준다 (레퍼런스 방식)
                nm.style.cssText = `font-size:${Math.min(px, 34)}px;font-weight:${variants[0].fontWeight || 400}`;
                nameTd.appendChild(nm);

                const sizeTd = el('td');
                sizeTd.rowSpan = variants.length;
                sizeTd.appendChild(Object.assign(el('div', 'ds-type-num'), { textContent: px }));

                tr.append(nameTd, sizeTd);
            }

            tr.appendChild(Object.assign(el('td'), {
                innerHTML: `<div class="ds-type-num">${s.fontWeight || '400'}</div>`,
            }));
            tr.appendChild(Object.assign(el('td'), {
                innerHTML: `<div class="ds-type-usage">${(s.selectors || []).join(' / ') || '—'}</div>`,
            }));
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
    });

    body.appendChild(table);
    return frame;
}

$('#dsGap').addEventListener('input', e => {
    const v = e.target.value;
    $('#dsGapVal').textContent = v + 'px';
    document.getElementById('dsCanvas').style.setProperty('--ds-gap', v + 'px');
});

// ---------------------------------------------------------------- 시작
applyStage();
loadPages();
