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

// ---------------------------------------------------------------- 디자인 시스템
// 여기는 '기준'을 보는 곳이다. 대시보드가 아니므로 사용처·사용횟수는 보여주지 않는다.
// 화면: ① 색 · 팔레트(칩 카드)  ② 색 · 역할(어디에 쓰는 색인가)  ③ 타이포
// 조절: 칩 클릭 = 색 고르기 / 역할 = 팔레트 연결 / 타이포 = 크기 슬라이더
function el(tag, cls, text) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
}
function dEl(tag, cls, key, val) { const d = el(tag, cls); d.dataset[key] = val; return d; }

// 타이포 '현재 px' 계산용 배율 (tokens.css 의 --s 식과 동일)
function currentScale() {
    const w = bp.w;
    return w < 1024 ? 1 : Math.min(1, Math.max(0.8, 0.5 + w / 5120));
}
const round1 = n => Math.round(n * 10) / 10;
const varName = name => Object.assign(el('span', 'ds-var'), { textContent: name });

// ── 조절 상태 ──
let dsData = null;
let dsEdits = {};        // name -> 새 값 (hex | 팔레트이름 | px)
let dsBaseHex = {};      // 팔레트 이름 -> 원래 hex
let dsBasePx = {};       // --fs-* -> 원래 px
let dsBaseLink = {};     // 역할 -> 원래 연결 팔레트
let dsPalette = [];      // 역할 드롭다운 후보

// 역할 섹션에서 --panel 은 뺀다: 팔레트(표면)에 이미 있고, 2층이 아니라 1층이라 헷갈린다.
const ROLE_SKIP = new Set(['--panel']);

function buildDsBase(d) {
    dsBaseHex = {}; dsBasePx = {}; dsBaseLink = {}; dsPalette = [];
    for (const g of d.ramp) { dsBaseHex[g.name] = g.hex; dsPalette.push({ name: g.name, label: '회색 ' + g.step }); }
    for (const s of d.surfaces) { dsBaseHex[s.name] = s.hex; dsPalette.push({ name: s.name, label: s.label }); }
    for (const p of d.primitives) { dsBaseHex[p.name] = p.hex; dsPalette.push({ name: p.name, label: p.label }); }
    for (const r of d.roles) if (!ROLE_SKIP.has(r.name) && r.linked) dsBaseLink[r.name] = r.linked;
    for (const t of d.typo) dsBasePx[t.name] = t.basePx;
}
const effHex = n => (n in dsEdits && n in dsBaseHex) ? dsEdits[n] : dsBaseHex[n];
const effLink = r => (r in dsEdits) ? dsEdits[r] : dsBaseLink[r];
const effPx = n => (n in dsEdits && n in dsBasePx) ? +dsEdits[n] : dsBasePx[n];
const roleHex = r => effHex(effLink(r));
function isChanged(n) {
    if (!(n in dsEdits)) return false;
    if (n in dsBaseHex) return dsEdits[n] !== dsBaseHex[n];
    if (n in dsBaseLink) return dsEdits[n] !== dsBaseLink[n];
    if (n in dsBasePx) return +dsEdits[n] !== dsBasePx[n];
    return false;
}
const changedNames = () => Object.keys(dsEdits).filter(isChanged);

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
const bgHexNow = () => effHex(effLink('--bg-color'));
const cardHexNow = () => effHex(effLink('--card-bg'));

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

// ── 칩 카드 (색 하나) ──
function chipCard(name, step, wide) {
    const card = el('div', 'ds3-chip' + (wide ? ' is-wide' : ''));
    card.dataset.cell = name;
    const inp = el('input', 'ds3-chip-color');
    inp.type = 'color';
    inp.dataset.chip = name;
    inp.title = name + ' — 눌러서 색 고르기';
    inp.addEventListener('input', () => applyEdit(name, inp.value.toUpperCase()));
    const meta = el('div', 'ds3-chip-meta');
    meta.append(el('div', 'ds3-chip-step', step), dEl('div', 'ds3-chip-hex', 'hex', name));
    card.append(inp, meta);
    const chg = el('span', 'ds3-chg'); chg.dataset.chg = name; card.appendChild(chg);
    return card;
}
function chipRow(items) {
    const row = el('div', 'ds3-chips');
    for (const it of items) row.appendChild(chipCard(it.name, it.step, it.wide));
    return row;
}

// ① 색 · 팔레트
function sectionPalette(d) {
    const s = dsSection('색 · 팔레트', '색의 원본. 칩을 눌러 색을 고칠 수 있습니다.');

    s.appendChild(el('h3', 'ds3-sub', '회색 — 밝은 것부터'));
    s.appendChild(chipRow(d.ramp.map(g => ({ name: g.name, step: String(g.step) }))));

    s.appendChild(el('h3', 'ds3-sub', '배경 · 면'));
    s.appendChild(chipRow(d.surfaces.map(x => ({ name: x.name, step: x.label, wide: true }))));

    s.appendChild(el('h3', 'ds3-sub', '포인트 · 서브'));
    s.appendChild(chipRow(d.primitives.map(x => ({ name: x.name, step: x.label, wide: true }))));
    return s;
}

// ② 색 · 역할
function sectionRoles(d) {
    const s = dsSection('색 · 역할',
        '"어디에 쓰는 색"인지 정하는 층. 팔레트에서 골라 연결합니다. 직접 색을 넣을 수는 없습니다.');
    const grid = el('div', 'ds3-roles');
    for (const r of d.roles) {
        if (ROLE_SKIP.has(r.name) || !dsBaseLink[r.name]) continue;
        const card = el('div', 'ds3-role'); card.dataset.role = r.name;

        const chip = el('div', 'ds3-role-chip'); chip.dataset.rolechip = r.name;

        const body = el('div', 'ds3-role-body');
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

        const foot = el('div', 'ds3-role-foot');
        foot.append(dEl('span', 'ds3-role-hex', 'rolehex', r.name));
        if (r.contrast) foot.appendChild(dEl('span', 'ds3-role-contrast', 'contrast', r.name));

        body.append(head, sel, foot);
        card.append(chip, body);
        grid.appendChild(card);
    }
    s.appendChild(grid);
    return s;
}

// ③ 타이포
function sectionTypo(d) {
    const s = dsSection('타이포', '슬라이더로 기준 크기를 조절합니다.');
    const list = el('div', 'ds3-typo');
    for (const t of d.typo) {
        const row = el('div', 'ds3-typo-row');
        const left = el('div', 'ds3-typo-left');
        const head = el('div', 'ds3-typo-head');
        head.append(el('span', 'ds3-typo-label', t.label), varName(t.name));
        const chg = el('span', 'ds3-chg'); chg.dataset.chg = t.name; head.appendChild(chg);
        left.append(head, dEl('div', 'ds3-typo-px', 'nums', t.name), pxSlider(t.name, 8, 80));
        row.append(dEl('div', 'ds3-typo-sample', 'sample', t.name), left);
        list.appendChild(row);
    }
    s.appendChild(list);

    if (d.fontWeights?.length) {
        s.appendChild(el('h3', 'ds3-sub', '쓰이는 굵기'));
        const wr = el('div', 'ds3-weights');
        for (const w of d.fontWeights) {
            const c = el('div', 'ds3-weight');
            const v = el('div', 'ds3-weight-val', '다람쥐'); v.style.fontWeight = w.weight;
            c.append(v, el('div', 'ds3-weight-num', String(w.weight)));
            wr.appendChild(c);
        }
        s.appendChild(wr);
    }
    return s;
}
function pxSlider(name, min, max) {
    const inp = el('input', 'ds3-slider');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = 1;
    inp.value = effPx(name); inp.dataset.slider = name;
    inp.addEventListener('input', () => applyEdit(name, +inp.value));
    return inp;
}

// ── 실시간 갱신 (컨트롤은 다시 안 그림) ──
function refresh() {
    const scale = currentScale();
    const bg = bgHexNow(), card = cardHexNow();
    const SAMPLE = '다람쥐 헌 쳇바퀴';
    const q = s => document.querySelectorAll(s);

    q('[data-chip]').forEach(i => { const h = effHex(i.dataset.chip); if (h) i.value = h.toLowerCase(); });
    q('[data-hex]').forEach(e => e.textContent = effHex(e.dataset.hex) || '');

    q('[data-rolechip]').forEach(e => e.style.background = roleHex(e.dataset.rolechip) || 'transparent');
    q('[data-rolehex]').forEach(e => e.textContent = roleHex(e.dataset.rolehex) || '—');
    q('[data-contrast]').forEach(box => {
        const hex = roleHex(box.dataset.contrast);
        const a = contrast(hex, bg), b = contrast(hex, card);
        const worst = Math.min(a, b);
        box.textContent = `대비 ${a} / ${b}` + (worst < 4.5 ? ' ⚠ 낮음' : '');
        box.classList.toggle('bad', worst < 4.5);
    });

    q('[data-sample]').forEach(e => {
        const px = effPx(e.dataset.sample);
        e.textContent = SAMPLE;
        if (px != null) e.style.fontSize = round1(px * scale) + 'px';
    });
    q('[data-nums]').forEach(e => {
        const base = effPx(e.dataset.nums);
        e.innerHTML = `<b>${base}px</b> <span class="ds3-dim">· 화면에선 ${round1(base * scale)}px</span>`;
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




// ---------------------------------------------------------------- 시작
updateBpRes();
applyStage();
loadPages();
