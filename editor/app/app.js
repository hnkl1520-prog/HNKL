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

// ---------------------------------------------------------------- 디자인 시스템 (표시 전용)
// 서버(/__api/designsystem)가 tokens.css 를 파싱하고 vibra/common 사용처를 스캔한
// 결과를 받아 4개 섹션으로 그린다. 값 수정 기능 없음.
function el(tag, cls, text) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
}

// 현재 브레이크포인트 기준 --s (tokens.css 식과 동일: 1024 미만이면 1)
function currentScale() {
    const w = bp.w;
    return w < 1024 ? 1 : Math.min(1, Math.max(0.8, 0.5 + w / 5120));
}
const round1 = n => Math.round(n * 10) / 10;

// 코드 변수명 — 기본 숨김, 호버/토글로만 보임 (개발자용)
const varName = name => Object.assign(el('span', 'ds-var'), { textContent: name });
const badge = (text, cls) => Object.assign(el('span', 'ds-badge ' + (cls || '')), { textContent: text });

// 직접 + 경유(역할·별칭) 사용 횟수 문구
function usedCount(t) {
    const total = (t.count || 0) + (t.indirect || 0);
    if (t.indirect) return `${total}회 (직접 ${t.count} · 경유 ${t.indirect})`;
    return `${t.count || 0}회`;
}

async function fetchDesignSystem() {
    const canvas = document.getElementById('dsCanvas');
    canvas.innerHTML = '<div class="ds-loading">tokens.css 읽는 중…</div>';
    try {
        const res = await fetch('/__api/designsystem');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        renderDesignSystem(await res.json());
    } catch (e) {
        canvas.innerHTML = '<div class="ds-loading">불러오기 실패: ' + e.message + '</div>';
    }
}

function renderDesignSystem(data) {
    const canvas = document.getElementById('dsCanvas');
    canvas.innerHTML = '';
    const inner = el('div', 'ds-inner');
    inner.append(
        sectionColors(data),
        sectionRoles(data),
        sectionTypo(data),
        sectionSpacing(data),
    );
    canvas.appendChild(inner);
}

function dsSection(title) {
    const s = el('section', 'ds2-section');
    s.appendChild(el('h2', 'ds2-title', title));
    return s;
}

// 1) 색 · 팔레트
function sectionColors(data) {
    const s = dsSection('색 · 팔레트');

    s.appendChild(el('h3', 'ds2-sub', '회색 램프 — 밝은 것부터'));
    const ramp = el('div', 'ds2-ramp');
    for (const g of data.ramp) {
        const cell = el('div', 'ds2-ramp-cell' + (g.unused ? ' is-unused' : ''));
        const chip = el('div', 'ds2-ramp-chip');
        chip.style.background = g.hex;
        cell.append(
            chip,
            el('div', 'ds2-ramp-step', String(g.step)),
            el('div', 'ds2-ramp-hex', g.hex),
            varName(g.name),
        );
        if (g.unused) cell.appendChild(badge('미사용', 'warn'));
        cell.title = usedCount(g);
        ramp.appendChild(cell);
    }
    s.appendChild(ramp);

    s.appendChild(el('h3', 'ds2-sub', '포인트 · 서브 · 다크 배경'));
    const prim = el('div', 'ds2-prim');
    for (const p of data.primitives) {
        const item = el('div', 'ds2-prim-item');
        const chip = el('div', 'ds2-prim-chip');
        chip.style.background = p.hex;
        const meta = el('div', 'ds2-prim-meta');
        meta.append(el('div', 'ds2-prim-label', p.label), el('div', 'ds2-prim-hex', p.hex), varName(p.name));
        if (p.unused) meta.appendChild(badge('미사용', 'warn'));
        item.append(chip, meta);
        prim.appendChild(item);
    }
    s.appendChild(prim);
    return s;
}

// 2) 색 · 역할
function sectionRoles(data) {
    const s = dsSection('색 · 역할');
    const table = el('div', 'ds2-roles');
    const head = el('div', 'ds2-role-row is-head');
    ['', '이름', '팔레트', 'HEX', '사용처', '횟수'].forEach((h, i) => head.appendChild(el('div', 'ds2-rc c' + i, h)));
    table.appendChild(head);

    for (const r of data.roles) {
        const row = el('div', 'ds2-role-row');
        const sw = el('div', 'ds2-rc c0');
        const chip = el('div', 'ds2-role-chip');
        chip.style.background = r.hex || 'transparent';
        sw.appendChild(chip);

        const namec = el('div', 'ds2-rc c1');
        namec.append(el('span', 'ds2-role-name', r.label), varName(r.name));
        if (r.unused) namec.appendChild(badge('미사용', 'warn'));
        if (r.contrast) {
            const cc = el('div', 'ds2-contrast');
            const mk = (label, v) => Object.assign(el('span', 'ds2-cr' + (v < 4.5 ? ' bad' : '')), {
                textContent: `${label} ${v}${v < 4.5 ? ' ⚠' : ''}`,
            });
            cc.append(mk('배경 위', r.contrast.onBg), mk('카드 위', r.contrast.onCard));
            namec.appendChild(cc);
        }

        row.append(
            sw, namec,
            Object.assign(el('div', 'ds2-rc c2 mono'), { textContent: r.linked || '직접값' }),
            Object.assign(el('div', 'ds2-rc c3 mono'), { textContent: r.hex || '—' }),
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
    const scale = currentScale();
    const SAMPLE = '다람쥐 헌 쳇바퀴';

    const list = el('div', 'ds2-typo');
    for (const t of data.typo) {
        const row = el('div', 'ds2-typo-row');
        const px = t.basePx != null ? round1(t.basePx * scale) : null;
        const sample = el('div', 'ds2-typo-sample', SAMPLE);
        if (px) sample.style.fontSize = px + 'px';

        const meta = el('div', 'ds2-typo-meta');
        const nm = el('div', 'ds2-typo-name');
        nm.append(el('span', 'ds2-typo-label', t.label), varName(t.name));
        if (t.unused) nm.appendChild(badge('미사용', 'warn'));
        meta.append(
            nm,
            Object.assign(el('div', 'ds2-typo-nums'), {
                innerHTML: `<b>${t.basePx}px</b> <span class="ds2-dim">정의</span> · <b>${px}px</b> <span class="ds2-dim">현재 ×${round1(scale)}</span>`,
            }),
            Object.assign(el('div', 'ds2-typo-use'), { textContent: t.usage + ' · ' + usedCount(t) }),
        );
        row.append(sample, meta);
        list.appendChild(row);
    }
    s.appendChild(list);

    s.appendChild(el('h3', 'ds2-sub', '굵기 현황 — 지금 코드에서 쓰이는 font-weight (토큰 아님)'));
    const wt = el('div', 'ds2-weights');
    for (const w of data.fontWeights) {
        const card = el('div', 'ds2-weight');
        const val = el('div', 'ds2-weight-val', String(w.weight));
        val.style.fontWeight = w.weight;
        card.append(
            val,
            el('div', 'ds2-weight-cnt', `${w.count}회`),
            el('div', 'ds2-weight-sizes', w.sizes.slice(0, 6).map(cleanSize).join(', ') + (w.sizes.length > 6 ? ' …' : '')),
        );
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
    const scale = currentScale();

    const sBox = el('div', 'ds2-scale');
    sBox.append(
        el('div', 'ds2-scale-label', '전체 크기 배율 --s'),
        el('div', 'ds2-scale-val', '×' + round1(scale)),
        el('div', 'ds2-scale-note', `현재 기준 ${bp.w}px · 정의 ${data.scale.override}`),
    );
    s.appendChild(sBox);

    s.appendChild(el('h3', 'ds2-sub', '간격 스케일 — 실제 폭 비율'));
    const maxPx = Math.max(...data.spacing.map(x => x.basePx || 0)) || 1;
    const bars = el('div', 'ds2-bars');
    for (const sp of data.spacing) {
        const row = el('div', 'ds2-bar-row' + (sp.unused ? ' is-unused' : ''));
        const track = el('div', 'ds2-bar-track');
        const fill = el('div', 'ds2-bar-fill');
        fill.style.width = ((sp.basePx || 0) / maxPx * 100) + '%';
        track.appendChild(fill);
        const cnt = el('div', 'ds2-bar-cnt', usedCount(sp));
        if (sp.unused) cnt.appendChild(badge('미사용', 'warn'));
        row.append(
            el('div', 'ds2-bar-num', String(sp.step)),
            track,
            Object.assign(el('div', 'ds2-bar-px'), { innerHTML: `<b>${sp.basePx}px</b> <span class="ds2-dim">→ ${round1((sp.basePx || 0) * scale)}</span>` }),
            cnt,
        );
        bars.appendChild(row);
    }
    s.appendChild(bars);

    if (data.aliases && data.aliases.length) {
        const det = el('details', 'ds2-aliases');
        det.appendChild(Object.assign(el('summary'), { textContent: `하위호환 별칭 ${data.aliases.length}개 — 정리 예정` }));
        const alist = el('div', 'ds2-alias-list');
        for (const a of data.aliases) {
            const row = el('div', 'ds2-alias-row');
            row.append(
                Object.assign(el('span', 'ds2-alias-name'), { textContent: a.name }),
                Object.assign(el('span', 'ds2-alias-arrow'), { textContent: '→ ' + (a.linked || '') }),
                Object.assign(el('span', 'ds2-alias-cnt'), { textContent: usedCount(a) }),
            );
            if (a.count === 0) row.appendChild(badge('미사용', 'warn'));
            alist.appendChild(row);
        }
        det.appendChild(alist);
        s.appendChild(det);
    }
    return s;
}

// 변수명 전역 토글
$('#dsShowVars')?.addEventListener('change', e => {
    document.getElementById('dsView').classList.toggle('show-vars', e.target.checked);
});


// ---------------------------------------------------------------- 시작
updateBpRes();
applyStage();
loadPages();
