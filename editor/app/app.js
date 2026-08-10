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

// ---------------------------------------------------------------- 디자인 시스템 (조절 가능)
// 서버(/__api/designsystem)가 tokens.css 를 파싱한 결과를 받아 4섹션으로 그리고,
// 값 조절 컨트롤을 붙인다. 조절은 미리보기(즉시)만, 저장은 tokens.css :root 만 갱신.
function el(tag, cls, text) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
}
// dataset 은 읽기전용이라 Object.assign 으로 못 넣는다 → 이 헬퍼로 설정
function dEl(tag, cls, key, val) { const d = el(tag, cls); d.dataset[key] = val; return d; }
function currentScale() {
    if ('--s' in dsEdits) return +dsEdits['--s'];
    const w = bp.w;
    return w < 1024 ? 1 : Math.min(1, Math.max(0.8, 0.5 + w / 5120));
}
const round1 = n => Math.round(n * 10) / 10;
const varName = name => Object.assign(el('span', 'ds-var'), { textContent: name });
const badge = (text, cls) => Object.assign(el('span', 'ds-badge ' + (cls || '')), { textContent: text });
function usedCount(t) {
    const total = (t.count || 0) + (t.indirect || 0);
    if (t.indirect) return `${total}회 (직접 ${t.count} · 경유 ${t.indirect})`;
    return `${t.count || 0}회`;
}

// ── 조절 상태 ──
let dsData = null;
let dsEdits = {};          // name -> 새 값 (hex | 팔레트이름 | px숫자 | 배율숫자)
let dsBaseHex = {};        // 팔레트 이름 -> 원래 hex
let dsBasePx = {};         // fs/space 이름 -> 원래 px
let dsBaseLink = {};       // 역할 이름 -> 원래 연결 팔레트
let dsPaletteList = [];    // 역할 드롭다운 후보 [{name,hex,label}]

function buildDsBase(d) {
    dsBaseHex = {}; dsBasePx = {}; dsBaseLink = {}; dsPaletteList = [];
    for (const g of d.ramp) { dsBaseHex[g.name] = g.hex; dsPaletteList.push({ name: g.name, label: '회색 ' + g.step }); }
    for (const s of d.surfaces) { dsBaseHex[s.name] = s.hex; dsPaletteList.push({ name: s.name, label: s.label }); }
    for (const p of d.primitives) { dsBaseHex[p.name] = p.hex; dsPaletteList.push({ name: p.name, label: p.label }); }
    for (const r of d.roles) dsBaseLink[r.name] = r.linked || r.name;   // --panel 은 자기 자신
    for (const t of d.typo) dsBasePx[t.name] = t.basePx;
    for (const sp of d.spacing) dsBasePx[sp.name] = sp.basePx;
}

const effHex = name => (name in dsEdits && dsBaseHex[name] != null) ? dsEdits[name] : dsBaseHex[name];
const effLink = role => (role in dsEdits) ? dsEdits[role] : dsBaseLink[role];
const effPx = name => (name in dsEdits && dsBasePx[name] != null) ? +dsEdits[name] : dsBasePx[name];
const roleHex = role => effHex(effLink(role));
const isChanged = name => {
    if (!(name in dsEdits)) return false;
    if (name in dsBaseHex) return dsEdits[name] !== dsBaseHex[name];
    if (name in dsBaseLink) return dsEdits[name] !== dsBaseLink[name];
    if (name in dsBasePx) return +dsEdits[name] !== dsBasePx[name];
    if (name === '--s') return true;
    return false;
};

// 대비 (WCAG)
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
const bgHexNow = () => effHex(effLink('--bg-color') || '--bg');
const cardHexNow = () => effHex(effLink('--card-bg') || '--surface');

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
        updateDsToolbar();
        pushTokenPreview();
    } catch (e) {
        canvas.innerHTML = '<div class="ds-loading">불러오기 실패: ' + e.message + '</div>';
    }
}

function applyEdit(name, value) { dsEdits[name] = value; refresh(); }

function renderDesignSystem(data) {
    const canvas = document.getElementById('dsCanvas');
    canvas.innerHTML = '';
    const inner = el('div', 'ds-inner');
    inner.append(sectionColors(data), sectionRoles(data), sectionTypo(data), sectionSpacing(data));
    canvas.appendChild(inner);
    refresh();
}
function dsSection(title) {
    const s = el('section', 'ds2-section');
    s.appendChild(el('h2', 'ds2-title', title));
    return s;
}

// 1) 색 · 팔레트
function sectionColors(data) {
    const s = dsSection('색 · 팔레트');
    s.appendChild(el('h3', 'ds2-sub', '회색 램프 — 밝은 것부터 (칸 클릭해 색 조절)'));
    const ramp = el('div', 'ds2-ramp');
    for (const g of data.ramp) ramp.appendChild(colorCell(g, '회색 ' + g.step));
    s.appendChild(ramp);

    s.appendChild(el('h3', 'ds2-sub', '포인트 · 서브 · 다크 배경'));
    const prim = el('div', 'ds2-prim');
    for (const p of data.primitives) {
        const item = el('div', 'ds2-prim-item');
        const picker = colorInput(p.name);
        const meta = el('div', 'ds2-prim-meta');
        meta.append(el('div', 'ds2-prim-label', p.label),
            dEl('div', 'ds2-prim-hex', 'hex', p.name), varName(p.name));
        const chg = badge('', 'chg'); chg.dataset.chg = p.name;
        meta.appendChild(chg);
        item.append(picker, meta);
        prim.appendChild(item);
    }
    s.appendChild(prim);
    return s;
}
function colorCell(g, label) {
    const cell = el('div', 'ds2-ramp-cell');
    cell.dataset.cell = g.name;
    const picker = colorInput(g.name, 'ds2-ramp-chip');
    cell.append(
        picker,
        el('div', 'ds2-ramp-step', String(g.step)),
        dEl('div', 'ds2-ramp-hex', 'hex', g.name),
        varName(g.name),
    );
    const chg = badge('', 'chg'); chg.dataset.chg = g.name; cell.appendChild(chg);
    cell.title = usedCount(g);
    return cell;
}
// 컬러피커 = <input type=color> 를 스와치 모양으로
function colorInput(name, chipCls) {
    const inp = el('input', 'ds2-color ' + (chipCls || ''));
    inp.type = 'color';
    inp.value = (effHex(name) || '#000000').toLowerCase();
    inp.dataset.chip = name;
    inp.title = name + ' 색 조절';
    inp.addEventListener('input', () => applyEdit(name, inp.value.toUpperCase()));
    return inp;
}

// 2) 색 · 역할
function sectionRoles(data) {
    const s = dsSection('색 · 역할');
    s.appendChild(el('p', 'ds2-note', '역할은 반드시 팔레트에 연결합니다. 직접 hex 입력은 없습니다.'));
    const table = el('div', 'ds2-roles');
    const head = el('div', 'ds2-role-row is-head');
    ['', '이름', '연결 팔레트', 'HEX', '사용처', '횟수'].forEach((h, i) => head.appendChild(el('div', 'ds2-rc c' + i, h)));
    table.appendChild(head);

    for (const r of data.roles) {
        const row = el('div', 'ds2-role-row'); row.dataset.role = r.name;
        const sw = el('div', 'ds2-rc c0');
        const chip = el('div', 'ds2-role-chip'); chip.dataset.rolechip = r.name;
        sw.appendChild(chip);

        const namec = el('div', 'ds2-rc c1');
        namec.append(el('span', 'ds2-role-name', r.label), varName(r.name));
        const chg = badge('', 'chg'); chg.dataset.chg = r.name; namec.appendChild(chg);
        if (r.contrast) {
            const cc = el('div', 'ds2-contrast'); cc.dataset.contrast = r.name;
            namec.appendChild(cc);
        }

        // 연결 드롭다운
        const linkCell = el('div', 'ds2-rc c2');
        const sel = el('select', 'ds2-link');
        for (const opt of dsPaletteList) {
            const o = el('option'); o.value = opt.name; o.textContent = `${opt.label} (${opt.name})`;
            sel.appendChild(o);
        }
        sel.value = effLink(r.name);
        sel.addEventListener('change', () => applyEdit(r.name, sel.value));
        linkCell.appendChild(sel);

        row.append(
            sw, namec, linkCell,
            dEl('div', 'ds2-rc c3 mono', 'rolehex', r.name),
            Object.assign(el('div', 'ds2-rc c4 use'), { textContent: r.usage }),
            Object.assign(el('div', 'ds2-rc c5'), { textContent: usedCount(r) }),
        );
        table.appendChild(row);
    }
    s.appendChild(table);
    return s;
}

// 3) 타이포
function sectionTypo(data) {
    const s = dsSection('타이포');
    const SAMPLE = '다람쥐 헌 쳇바퀴';
    const list = el('div', 'ds2-typo');
    for (const t of data.typo) {
        const row = el('div', 'ds2-typo-row');
        const sample = el('div', 'ds2-typo-sample', SAMPLE); sample.dataset.sample = t.name;
        const meta = el('div', 'ds2-typo-meta');
        const nm = el('div', 'ds2-typo-name');
        nm.append(el('span', 'ds2-typo-label', t.label), varName(t.name));
        const chg = badge('', 'chg'); chg.dataset.chg = t.name; nm.appendChild(chg);
        const slider = pxSlider(t.name, 8, 80);
        meta.append(nm, slider,
            dEl('div', 'ds2-typo-nums', 'nums', t.name),
            Object.assign(el('div', 'ds2-typo-use'), { textContent: t.usage + ' · ' + usedCount(t) }));
        row.append(sample, meta);
        list.appendChild(row);
    }
    s.appendChild(list);

    s.appendChild(el('h3', 'ds2-sub', '굵기 현황 — 지금 코드의 font-weight (토큰 아님, 조절 대상 아님)'));
    const wt = el('div', 'ds2-weights');
    for (const w of data.fontWeights) {
        const card = el('div', 'ds2-weight');
        const val = el('div', 'ds2-weight-val', String(w.weight)); val.style.fontWeight = w.weight;
        card.append(val, el('div', 'ds2-weight-cnt', `${w.count}회`),
            el('div', 'ds2-weight-sizes', w.sizes.slice(0, 6).map(cleanSize).join(', ') + (w.sizes.length > 6 ? ' …' : '')));
        wt.appendChild(card);
    }
    s.appendChild(wt);
    return s;
}
function cleanSize(sz) {
    if (sz.startsWith('--fs-')) return sz.replace('--fs-', '');
    if (sz.startsWith('--')) return sz.replace('--', '');
    if (sz.includes('clamp') || sz.includes('calc')) return '가변';
    return sz;
}

// 4) 간격 · 배율
function sectionSpacing(data) {
    const s = dsSection('간격 · 배율');
    const sBox = el('div', 'ds2-scale');
    sBox.append(
        el('div', 'ds2-scale-label', '전체 크기 배율 --s'),
        dEl('div', 'ds2-scale-val', 'scaleval', '1'),
        scaleSlider(),
        dEl('div', 'ds2-scale-note', 'scalenote', '1'),
    );
    s.appendChild(sBox);

    s.appendChild(el('h3', 'ds2-sub', '간격 스케일 — 실제 폭 비율 (슬라이더로 조절)'));
    const bars = el('div', 'ds2-bars');
    for (const sp of data.spacing) {
        const row = el('div', 'ds2-bar-row'); row.dataset.sp = sp.name;
        const track = el('div', 'ds2-bar-track');
        const fill = el('div', 'ds2-bar-fill'); fill.dataset.fill = sp.name; track.appendChild(fill);
        const chg = badge('', 'chg'); chg.dataset.chg = sp.name;
        row.append(
            el('div', 'ds2-bar-num', String(sp.step)),
            track,
            pxSlider(sp.name, 0, 160, true),
            dEl('div', 'ds2-bar-px', 'spx', sp.name),
            Object.assign(el('div', 'ds2-bar-cnt'), { textContent: usedCount(sp) }),
            chg,
        );
        bars.appendChild(row);
    }
    s.appendChild(bars);

    if (data.aliases && data.aliases.length) {
        const det = el('details', 'ds2-aliases');
        det.appendChild(Object.assign(el('summary'), { textContent: `하위호환 별칭 ${data.aliases.length}개 — 정리 예정 (조절 대상 아님)` }));
        const alist = el('div', 'ds2-alias-list');
        for (const a of data.aliases) {
            const row = el('div', 'ds2-alias-row');
            row.append(
                Object.assign(el('span', 'ds2-alias-name'), { textContent: a.name }),
                Object.assign(el('span', 'ds2-alias-arrow'), { textContent: '→ ' + (a.linked || '') }),
                Object.assign(el('span', 'ds2-alias-cnt'), { textContent: usedCount(a) }));
            if (a.count === 0) row.appendChild(badge('미사용', 'warn'));
            alist.appendChild(row);
        }
        det.appendChild(alist);
        s.appendChild(det);
    }
    return s;
}
function pxSlider(name, min, max, mini) {
    const inp = el('input', 'ds2-slider' + (mini ? ' mini' : ''));
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = 1;
    inp.value = effPx(name); inp.dataset.slider = name;
    inp.addEventListener('input', () => applyEdit(name, +inp.value));
    return inp;
}
function scaleSlider() {
    const inp = el('input', 'ds2-slider');
    inp.type = 'range'; inp.min = 0.6; inp.max = 1.3; inp.step = 0.05;
    inp.value = currentScale(); inp.dataset.slider = '--s';
    inp.addEventListener('input', () => applyEdit('--s', +inp.value));
    return inp;
}

// ── 실시간 갱신 (컨트롤은 다시 안 그림 → 드래그 유지) ──
function refresh() {
    const scale = currentScale();
    const bg = bgHexNow(), card = cardHexNow();
    const q = sel => document.querySelectorAll(sel);

    // 팔레트 칩·hex
    q('[data-chip]').forEach(inp => { const n = inp.dataset.chip; const h = effHex(n); if (h) inp.value = h.toLowerCase(); });
    q('[data-hex]').forEach(e => { const n = e.dataset.hex; e.textContent = effHex(n); });

    // 역할 칩·hex·대비
    q('[data-rolechip]').forEach(e => e.style.background = roleHex(e.dataset.rolechip) || 'transparent');
    q('[data-rolehex]').forEach(e => e.textContent = roleHex(e.dataset.rolehex) || '—');
    q('[data-contrast]').forEach(box => {
        const n = box.dataset.contrast, hex = roleHex(n);
        const onBg = contrast(hex, bg), onCard = contrast(hex, card);
        box.innerHTML = '';
        const mk = (l, v) => Object.assign(el('span', 'ds2-cr' + (v < 4.5 ? ' bad' : '')), { textContent: `${l} ${v}${v < 4.5 ? ' ⚠' : ''}` });
        box.append(mk('배경 위', onBg), mk('카드 위', onCard));
    });

    // 타이포 샘플·수치
    q('[data-sample]').forEach(e => { const px = effPx(e.dataset.sample); if (px != null) e.style.fontSize = round1(px * scale) + 'px'; });
    q('[data-nums]').forEach(e => {
        const n = e.dataset.nums, base = effPx(n);
        e.innerHTML = `<b>${base}px</b> <span class="ds2-dim">정의</span> · <b>${round1(base * scale)}px</b> <span class="ds2-dim">현재 ×${round1(scale)}</span>`;
    });

    // 간격 막대·수치
    const maxPx = Math.max(...dsData.spacing.map(x => effPx(x.name) || 0)) || 1;
    q('[data-fill]').forEach(e => e.style.width = ((effPx(e.dataset.fill) || 0) / maxPx * 100) + '%');
    q('[data-spx]').forEach(e => {
        const base = effPx(e.dataset.spx);
        e.innerHTML = `<b>${base}px</b> <span class="ds2-dim">→ ${round1(base * scale)}</span>`;
    });

    // 배율
    q('[data-scaleval]').forEach(e => e.textContent = '×' + round1(scale));
    q('[data-scalenote]').forEach(e => e.textContent = `현재 기준 ${bp.w}px · 저장 시 :root 의 --s 기본값`);

    // 변경 배지 (원래 값 함께)
    q('[data-chg]').forEach(b => {
        const n = b.dataset.chg;
        if (isChanged(n)) {
            let orig = n in dsBaseHex ? dsBaseHex[n] : n in dsBaseLink ? dsBaseLink[n] : n in dsBasePx ? dsBasePx[n] + 'px' : '';
            b.textContent = '변경됨 · 원래 ' + orig;
            b.hidden = false;
        } else { b.hidden = true; b.textContent = ''; }
    });
    q('[data-role]').forEach(r => r.classList.toggle('is-changed', isChanged(r.dataset.role)));
    q('[data-cell]').forEach(c => c.classList.toggle('is-changed', isChanged(c.dataset.cell)));
    q('[data-sp]').forEach(r => r.classList.toggle('is-changed', isChanged(r.dataset.sp)));

    updateDsToolbar();
    pushTokenPreview();
}

// 조절값을 tokens.css 정의 형태로
function editAsDecl(name) {
    if (name in dsBaseHex) return effHex(name);
    if (name in dsBaseLink) return 'var(' + effLink(name) + ')';
    if (name in dsBasePx) return `calc(${effPx(name)}px * var(--s))`;
    if (name === '--s') return String(round1(currentScale()));
    return null;
}
function changedNames() { return Object.keys(dsEdits).filter(isChanged); }

// 미리보기 iframe 에 :root 덮어쓰기
function pushTokenPreview() {
    const decls = changedNames().map(n => `  ${n}: ${editAsDecl(n)};`).join('\n');
    toFrame('tokenPreview', { css: decls ? `:root{\n${decls}\n}` : '' });
}

function updateDsToolbar() {
    const n = changedNames().length;
    const dirty = $('#dsDirty'); if (dirty) { dirty.hidden = n === 0; const c = $('#dsDirtyCount'); if (c) c.textContent = n; }
    const rev = $('#dsRevert'), sav = $('#dsSave');
    if (rev) rev.disabled = n === 0;
    if (sav) sav.disabled = n === 0;
}

function dsRevert() {
    dsEdits = {};
    renderDesignSystem(dsData);   // 컨트롤 값도 원래대로 다시 그림
    updateDsToolbar();
    pushTokenPreview();
}

// 저장 — 확인 목록 → 서버
function dsSaveConfirm() {
    const names = changedNames();
    if (!names.length) return;
    const list = $('#dsConfirmList'); list.innerHTML = '';
    for (const n of names) {
        const before = n in dsBaseHex ? dsBaseHex[n] : n in dsBaseLink ? `var(${dsBaseLink[n]})` : n in dsBasePx ? `calc(${dsBasePx[n]}px * var(--s))` : dsData.scale.base;
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
        await fetchDesignSystem();   // 다시 읽어 최신 상태로 (edits 초기화)
    } catch (e) {
        toast('저장 실패: ' + e.message, 'err');
    } finally {
        $('#dsConfirmOk').disabled = false;
    }
}

// 툴바/모달 배선
$('#dsRevert')?.addEventListener('click', dsRevert);
$('#dsSave')?.addEventListener('click', dsSaveConfirm);
$('#dsConfirmCancel')?.addEventListener('click', () => { $('#dsConfirm').hidden = true; });
$('#dsConfirmOk')?.addEventListener('click', dsSaveCommit);
$('#dsShowVars')?.addEventListener('change', e => {
    document.getElementById('dsView').classList.toggle('show-vars', e.target.checked);
});



// ---------------------------------------------------------------- 시작
updateBpRes();
applyStage();
loadPages();
