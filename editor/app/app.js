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
        pageClassSet = new Set(msg.payload?.classes || []);
        pageVarSet = new Set(msg.payload?.vars || []);
        mainPath = msg.payload?.mainPath || null;
        pageTokens = msg.payload?.pageTokens || null;
        pageBg = msg.payload?.pageBg || null;
        if (!selection) renderInspector();
        // 토큰을 안 따르는 섹션이 몇인지 — 슬라이더가 일부에만 먹히는 이유가 된다.
        // 미리보기가 준비된 지금 물어야 답이 온다.
        refreshGapExceptions();
        toFrame('setPicking', pickOn);
        toFrame('setMoving', tool === 'move');
        applyPendingPreview();
    }
    else if (msg.type === 'textEdited') {
        // 미리보기에서 글자를 고쳤다 — 화면은 이미 바뀌었고 파일에 쓸 것만 쌓는다.
        // 같은 요소를 이어서 고치면 마지막 값만 남긴다.
        const { path, value } = msg.payload;
        const last = pending[pending.length - 1];
        if (last && last.kind === 'text' && String(last.path) === String(path)) last.value = value;
        else pending.push({ kind: 'text', path, value });
        updateDirty();
        toast('Text changed — not saved yet', 'ok');
    }
    else if (msg.type === 'textEditing') {
        // 글자를 고치는 동안에는 Delete 로 덩어리가 지워지지 않게 막는다
        editingText = !!msg.payload?.on;
    }
    else if (msg.type === 'blockDone') {
        const p = msg.payload || {};
        if (p.error) { toast(p.error, 'warn'); return; }
        pending.push({ kind: p.act === 'remove' ? 'remove' : 'duplicate', path: p.path });
        updateDirty();
        if (p.act === 'remove') { selection = null; renderInspector(); }
        toast(p.act === 'remove' ? 'Deleted — not saved yet'
                                 : 'Duplicated — not saved yet', 'ok');
    }
    else if (msg.type === 'grabbed') {
        onGrabbed(msg.payload);
    }
    else if (msg.type === 'movedMany') {
        // 끌어서 여러 칸 옮긴 경우 — 파일에는 '한 칸 이동'을 그만큼 쌓는다.
        // 서버가 순서대로 적용하므로 매번 경로가 한 칸씩 따라 움직인다.
        const { from, steps, dir } = msg.payload;
        const mainPath = framePathOfMain();
        for (let i = 0; i < steps; i++) {
            const idx = dir === 'down' ? from + i : from - i;
            pending.push({ kind: 'move', path: [...mainPath, idx], dir });
        }
        updateDirty();
        toast(`Moved ${steps} step(s) — not saved yet`, 'ok');
    }
    else if (msg.type === 'moved') {
        // 미리보기에서는 이미 옮겨졌다. 파일에 반영할 내용만 쌓아 둔다.
        // 경로는 '옮기기 전' 기준이고 서버가 순서대로 적용하므로, 여러 번 눌러도 어긋나지 않는다.
        pending.push({ kind: 'move', path: msg.payload.path, dir: msg.payload.dir });
        updateDirty();
        toast('Section moved — not saved yet', 'ok');
    }
    else if (msg.type === 'picked') {
        picks = msg.payload;
        renderInspector();
    }
    else if (msg.type === 'pickRejected') {
        toast('Shift-click picks siblings — items that sit side by side.', 'warn');
    }
    else if (msg.type === 'selected' || msg.type === 'previewApplied') {
        picks = null;
        selection = msg.payload;
        renderInspector();
    }
    else if (msg.type === 'pageHeight') {
        if (msg.payload > 100) {
            pageH = msg.payload;
            const stageEl = document.getElementById('stage');
            // 첫 로드일 때만 스크롤 초기화 + 가운데 정렬.
            // (늦게 로드된 이미지로 높이만 갱신될 때 보던 위치가 튀지 않게)
            if (needsCenter) {
                if (stageEl) { stageEl.scrollTop = 0; stageEl.scrollLeft = 0; }
                needsCenter = false;
                centerFrame();
            } else applyStage();
        }
    }
    else if (msg.type === 'panStart') startPan(msg.payload.sx, msg.payload.sy);
    else if (msg.type === 'panMove') { if (isPanning) movePan(msg.payload.sx, msg.payload.sy); }
    else if (msg.type === 'panEnd') endPan();
    else if (msg.type === 'wheel') {
        const p = msg.payload;
        if (p.zoom) {
            // iframe 안 좌표 → 화면 좌표로 옮겨서 그 지점 기준 확대
            const fr = frame.getBoundingClientRect();
            zoomAt(zoom * (p.dy < 0 ? 1.1 : 1 / 1.1), fr.left + p.sx * zoom, fr.top + p.sy * zoom);
            return;
        }
        canvasY -= p.dy;
        canvasX -= p.dx;
        applyStage();
    }
    else if (msg.type === 'designSystem') {
        renderDesignSystem(msg.payload);
    }
    else if (msg.type === 'componentDropped') {
        onComponentDropped(msg.payload);
    }
    else if (msg.type === 'gapDragMove') onGapMove(msg.payload);
    else if (msg.type === 'gapDragEnd') { onGapEnd(msg.payload); refreshGapExceptions(); }
    else if (msg.type === 'gapExceptions') renderGapExceptions(msg.payload);
    else if (msg.type === 'addCard') {
        // 캐러셀 끝의 + — 마지막 카드를 그대로 하나 더 만든다
        pending.push({ kind: 'duplicate', path: msg.payload.path });
        toFrame('duplicatePreview', { path: msg.payload.path });
        updateDirty();
        toast('Card added — not saved yet', 'ok');
    }
    else if (msg.type === 'scrollToY') {
        // 미리보기 안 좌표 → 캔버스 이동 (화면 가운데에 오도록)
        const stageEl = document.getElementById('stage');
        const target = msg.payload.y * zoom;
        canvasY = -(target - stageEl.clientHeight / 2 + (msg.payload.h * zoom) / 2);
        applyStage();
    }
});

/**
 * 프로젝트 정보를 넣을 때 항목과 역할을 받는다.
 * 러프한 구조만 잡고 세부는 나중에 고치는 흐름이라, 비워 두면 예시가 들어간다.
 * @returns {{rows: string[][], roles: string[][]}|null}  null 이면 취소
 */
function askProjectInfo() {
    const rowText = prompt(
        'Project info rows — one per line, "Label: Value"\n(leave empty for the default example)',
        'Type: Team Project\nDuration: 2024.03 – 2024.11\nMembers: 2\nContribution: 70%'
    );
    if (rowText === null) return null;

    const roleText = prompt(
        'Contribution breakdown — one per line, "Role: 70"\n(leave empty to skip the ▾ toggle)',
        'Research: 50\nUX · UI: 70\nPrototype: 80'
    );
    if (roleText === null) return null;

    const parse = (t, isRole) => String(t).split('\n')
        .map(l => l.trim()).filter(Boolean)
        .map(l => {
            const i = l.indexOf(':');
            if (i < 0) return [l, ''];
            const k = l.slice(0, i).trim();
            const v = l.slice(i + 1).trim();
            return isRole ? [k, (parseInt(v, 10) || 0)] : [k, v];
        });

    return { rows: parse(rowText, false), roles: parse(roleText, true) };
}

// 라이브러리에서 미리보기로 떨어뜨렸을 때: 화면에 바로 넣고, 저장 대기열에 쌓는다.
async function onComponentDropped({ key, kind, path, position }) {
    // ① 인터랙션 — 그 요소에 클래스를 붙이고, 필요한 CSS 를 페이지에 넣는다
    if (kind === 'motion') {
        const def = MOTION_DEFS[key];
        if (!def) return;
        pending.push({ kind: 'motion', path, className: def.className, css: def.css });
        toFrame('motionPreview', { path, className: def.className, css: def.css });
        updateDirty();
        toast(`Interaction applied — ${def.className}`, 'ok');
        return;
    }
    // ② 내가 등록한 컴포넌트 — 저장해 둔 HTML 을 그대로 넣는다
    if (kind === 'saved') {
        const it = savedComps.find(c => c.id === key);
        if (!it) return;
        const missing = missingClasses(it);

        if (it.block) {
            // 마스터 블록 — 스타일은 이미 파일로 있으니, 페이지가 그 파일을 부르게만 한다
            if (it.block.css) pending.push({ kind: 'link', assetKind: 'css', url: it.block.css });
            if (it.block.js) pending.push({ kind: 'link', assetKind: 'js', url: it.block.js });
            // 미리보기에도 같은 파일을 걸어 바로 모양이 보이게 한다
            toFrame('linkAsset', { css: it.block.css, js: it.block.js });
        } else if (missing.length && it.css) {
            // 일반 컴포넌트 — 이 페이지에 없는 규칙만 그 페이지에 복사한다.
            // (이미 있는 페이지에는 넣지 않는다 — 같은 규칙을 두 벌 만들면 나중 것이 이기며 헷갈린다)
            pending.push({ kind: 'motion', path, className: '', css: it.css });
            toFrame('motionPreview', { path, className: '', css: it.css });
        }
        pending.push({ kind: 'insert', path, html: it.html, position });
        toFrame('insertPreview', { path, html: it.html, position });
        updateDirty();

        const missingVars = (it.vars || []).filter(v => !pageVarSet.has(v));
        if (it.block) {
            toast(`${it.name} — linked blocks/${it.block.slug} to this page`, 'ok');
        } else if (missing.length && it.css) {
            toast(missingVars.length
                ? `${it.name} — styles added, but ${missingVars.length} token(s) are missing here (${missingVars.slice(0, 3).join(', ')}…)`
                : `${it.name} — its missing styles were added to this page`,
                missingVars.length ? 'warn' : 'ok');
        } else if (missing.length) {
            toast(`${it.name} — ${missing.length} class(es) missing and no styles were saved (re-save it to include them)`, 'warn');
        } else {
            toast(`${it.name} inserted — not saved yet`, 'ok');
        }
        return;
    }
    // ③ 미디어 / 기본 컴포넌트 — HTML 조각을 삽입
    let src = COMPONENT_HTML[key] || MEDIA_HTML[key];
    if (!src) return;
    // 개수를 고를 수 있는 컴포넌트는 카드에서 고른 값을 쓴다 (카드 안 −/+ 로 조절)
    const n = (typeof src === 'function')
        ? (compCount[key] || COMPONENT_COUNT[key] || 3)
        : 0;
    // 표처럼 '무엇을 적을지'가 정해져야 뜻이 생기는 컴포넌트는 넣을 때 물어본다.
    // 값이 비면 기본 예시가 들어가고, 나머지는 인스펙터에서 고치면 된다.
    if (key === 'carousel') {
        const n = await askCount('How many cards?', compCount.carousel || 3);
        if (n === null) return;                       // 취소
        compCount.carousel = n;
    }
    const opt = (key === 'projectinfo') ? askProjectInfo() : undefined;
    if (opt === null) return;    // 창에서 취소
    const html = (typeof src === 'function') ? src(n, opt) : src;
    // 자리표시(ed-ph) 스타일은 미디어·컴포넌트 둘 다 필요하다.
    // (캐러셀·카드 안의 빈 이미지가 0px 로 찌그러지는 걸 막는다)
    if (html.includes('ed-ph')) {
        pending.push({ kind: 'motion', path, className: '', css: MEDIA_PH_CSS });
        toFrame('motionPreview', { path, className: '', css: MEDIA_PH_CSS });
    }
    pending.push({ kind: 'insert', path, html, position });
    toFrame('insertPreview', { path, html, position });
    updateDirty();
    toast(NEEDS_LINK.has(key) ? 'Added — set its link on the right' : 'Inserted — not saved yet', 'ok');
}

/** 현재 파일 위치를 경로로 보여준다 (works/projects/vibra/vibra.html → Works / Projects / Vibra / vibra.html) */
function renderCrumb(rel) {
    const host = $('#crumbPath');
    if (!host || !rel) return;
    const parts = rel.split('/');
    const file = parts.pop();
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    host.innerHTML =
        parts.map(p => `<span>${cap(p)}</span>`).join('<span class="cr-sep"> / </span>') +
        (parts.length ? '<span class="cr-sep"> / </span>' : '') +
        `<span class="cr-last">${file}</span>`;
}

// ---------------------------------------------------------------- 페이지 목록
async function loadPages() {
    const res = await fetch('/__api/pages');
    const { pages } = await res.json();
    const sel = $('#pageSelect');
    sel.innerHTML = '';
    for (const p of pages) {
        const o = document.createElement('option');
        o.value = p.rel;
        o.textContent = (p.isScratch ? '(temp) ' : '') + p.rel;
        sel.appendChild(o);
    }
    // 최근에 고친 '본 페이지'를 기본으로
    const mains = pages.filter(p => p.isMain);
    const preferred = mains.sort((a, b) => b.mtime - a.mtime)[0] || pages[0];
    if (preferred) { sel.value = preferred.rel; openPage(preferred.rel); }
}

function openPage(rel) {
    if (pending.length && !confirm('You have unsaved changes. Discard them and switch?')) {
        $('#pageSelect').value = currentPage;
        return;
    }
    pending = []; selection = null; updateDirty(); renderInspector();
    needsCenter = true;
    currentPage = rel;
    if (!selection) renderInspector();     // '페이지 설정'의 파일 이름을 채운다
    renderCrumb(rel);
    // 브릿지가 100vh 를 '기기 높이' 기준으로 굳히도록 알려준다 (iframe 은 전체 높이로 늘어나므로)
    frame.src = '/preview/' + rel + '?__edvh=' + bp.h;
}

$('#pageSelect').addEventListener('change', e => openPage(e.target.value));
$('#reloadBtn')?.addEventListener('click', () => {
    if (pending.length && !confirm('Unsaved changes will be lost. Continue?')) return;
    pending = []; updateDirty();
    needsCenter = true;
    frame.src = frame.src;
});

// ---------------------------------------------------------------- 화면 크기 / 확대
function applyStage() {
    frame.style.width = bp.w + 'px';
    frame.style.height = pageH + 'px';
    frameWrap.style.width = bp.w + 'px';
    frameWrap.style.height = pageH + 'px';
    clampCanvas();
    // canvasX/Y 는 '화면에서 몇 px 옮길지'다. translate 를 먼저 걸어야 그 값이 그대로 화면 이동량이 된다.
    frameWrap.style.transformOrigin = 'top left';
    frameWrap.style.transform =
        `translate(${Math.round(canvasX)}px, ${Math.round(canvasY)}px) scale(${zoom})`;
    // overflow:hidden 이어도 브라우저가 iframe 안 포커스를 따라 스테이지를 스크롤시킬 때가 있다.
    // (긴 페이지에서 리로드 직후 화면이 엉뚱한 곳에 가 있는 원인)
    const stageEl = document.getElementById('stage');
    if (stageEl && (stageEl.scrollTop || stageEl.scrollLeft)) { stageEl.scrollTop = 0; stageEl.scrollLeft = 0; }
    showStageInfo(`${bp.w}px wide · ${Math.round(zoom * 100)}%`);
}

let stageInfoTimer = null;
/** 배율이 바뀐 순간에만 잠깐 알려 준다 */
function showStageInfo(text) {
    const el = $('#stageInfo');
    if (!el) return;
    el.textContent = text;
    el.classList.add('is-on');
    clearTimeout(stageInfoTimer);
    stageInfoTimer = setTimeout(() => el.classList.remove('is-on'), 1400);
}

/**
 * 캔버스 이동 범위 제한.
 * 제한이 없으면 휠·패닝으로 프레임이 화면 밖까지 밀려나 '화면이 깨진 것처럼' 보인다.
 * 항상 프레임의 일부가 스테이지 안에 남도록 잡아 준다.
 */
function clampCanvas() {
    const stageEl = document.getElementById('stage');
    if (!stageEl) return;
    const sw = stageEl.clientWidth, sh = stageEl.clientHeight;
    const scaledW = bp.w * zoom, scaledH = pageH * zoom;
    const keep = 120;                       // 최소한 이만큼은 화면에 남긴다

    if (scaledW <= sw) canvasX = Math.min(Math.max(canvasX, 0), sw - scaledW);
    else canvasX = Math.min(Math.max(canvasX, sw - scaledW), 0);

    if (scaledH <= sh) canvasY = Math.min(Math.max(canvasY, 0), sh - scaledH);
    else canvasY = Math.min(Math.max(canvasY, sh - scaledH - keep), keep);
}

function centerFrame() {
    const stageEl = document.getElementById('stage');
    const sw = stageEl.clientWidth;
    const sh = stageEl.clientHeight;
    const scaledW = bp.w * zoom;
    const scaledH = pageH * zoom;

    // 좌우 패널은 캔버스 위에 떠 있다. 무대 전체를 기준으로 가운데를 잡으면
    // 미리보기가 왼쪽 패널 밑에 깔리고 오른쪽에 빈 바닥만 남는다.
    const shown = el => el && !el.hidden && !el.classList.contains('is-closed')
        ? el.getBoundingClientRect().width : 0;
    const padL = shown(document.querySelector('.left-panel')) + 24;
    const padR = shown(document.querySelector('aside.panel')) + 24;
    const room = sw - padL - padR;

    canvasX = room > scaledW ? padL + (room - scaledW) / 2 : Math.max(24, (sw - scaledW) / 2);
    canvasY = scaledH < sh ? (sh - scaledH) / 2 : 40;
    applyStage();
}

// ---------- 패닝 ----------
function startPan(sx, sy) {
    isPanning = true;
    // 기준점은 첫 mousemove 에서 다시 잡는다.
    // (iframe 안/밖에서 온 이벤트의 좌표계가 어긋나면 누르자마자 화면이 튄다)
    panStart = { sx, sy, cx: canvasX, cy: canvasY, primed: false };
    const ov = document.getElementById('stageOverlay');
    ov.style.pointerEvents = 'auto';
    ov.style.cursor = 'grabbing';
}
function movePan(sx, sy) {
    if (!panStart.primed) {
        panStart.sx = sx; panStart.sy = sy;
        panStart.cx = canvasX; panStart.cy = canvasY;
        panStart.primed = true;
        return;
    }
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
    // 가운데 버튼은 항상, 손 도구일 땐 왼쪽 버튼으로도 화면을 끈다
    if (e.button !== 1 && !(e.button === 0 && tool === 'pan')) return;
    e.preventDefault();
    startPan(e.screenX, e.screenY);
});
window.addEventListener('mouseup', e => { if (e.button === 0 && isPanning) endPan(); });
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
    if (e.ctrlKey || e.metaKey) {          // Ctrl(⌘) + 휠 = 확대/축소
        zoomAt(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX, e.clientY);
        return;
    }
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
    // 100vh 기준이 기기마다 달라지므로 다시 읽어 온다 (저장 안 한 변경은 지키기 위해 물어봄)
    if (!pending.length) frame.src = '/preview/' + currentPage + '?__edvh=' + bp.h;
});

// 중앙 뷰포트 제어기: 활성 브레이크포인트의 실제 해상도 표시
function updateBpRes() {
    const el = $('#bpRes');
    if (el) el.textContent = `${bp.w} × ${bp.h}`;
}

/**
 * 확대/축소 — Ctrl(⌘) + 휠.
 * 마우스가 가리키는 지점을 기준으로 확대돼서 보던 곳이 그대로 남는다.
 * (상단 슬라이더를 없애고 이 방식만 쓴다 — 손이 캔버스를 떠나지 않는다)
 */
function zoomAt(nextZoom, sx, sy) {
    const stEl = document.getElementById('stage');
    const r = stEl.getBoundingClientRect();
    const cx = sx - r.left, cy = sy - r.top;          // 스테이지 안 좌표
    const px = (cx - canvasX) / zoom;                 // 그 지점의 문서 좌표
    const py = (cy - canvasY) / zoom;
    zoom = Math.min(2, Math.max(0.1, nextZoom));
    canvasX = cx - px * zoom;
    canvasY = cy - py * zoom;
    applyStage();
}

// ---------------------------------------------------------------- 캔버스 도구 (선택 / 손)
// 요소 선택은 한 번 누르는 '동작'이 아니라 커서의 '상태'다.
// 그래서 캔버스 안 플로팅 툴바에 두고 V·H 단축키로도 바꾼다.
let pickOn = true, tool = 'select';
function setTool(next) {
    tool = next;
    pickOn = (next === 'select');
    const moveOn = (next === 'move');
    const mark = (id, on) => {
        const b = $(id); if (!b) return;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    };
    mark('#pickBtn', pickOn);
    mark('#panBtn', next === 'pan');
    mark('#moveBtn', moveOn);
    const st = document.getElementById('stage');
    if (st) st.style.cursor = (next === 'pan') ? 'grab' : '';
    // 두 모드는 배타적 — 이동 중에는 요소 선택을 끈다
    toFrame('setPicking', pickOn);
    toFrame('setMoving', moveOn);
}
$('#pickBtn')?.addEventListener('click', () => setTool('select'));
$('#panBtn')?.addEventListener('click', () => setTool('pan'));
$('#moveBtn')?.addEventListener('click', () => setTool('move'));
document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;   // 입력 중엔 무시
    if (e.key === 'v' || e.key === 'V') setTool('select');
    if (e.key === 'h' || e.key === 'H') setTool('pan');
    if (e.key === 'm' || e.key === 'M') setTool('move');
    if (editingText) return;   // 미리보기에서 글자 고치는 중이면 단축키를 넘긴다
    if (e.key === 'Delete' || e.key === 'Backspace') { if (selection) { e.preventDefault(); blockAction('remove'); } }
});
$('#openRawBtn')?.addEventListener('click', () => {
    if (!currentPage) return;
    // 저장 전 변경은 파일에 없으니, 실제 모습과 다를 수 있다는 것만 알려 준다
    if (pending.length) toast('Unsaved changes will not appear', 'warn');
    window.open('/raw/' + currentPage, '_blank', 'noopener');
});
/** 고른 덩어리를 지우거나 복제한다 — 미리보기가 먼저 반영하고, 결과를 받아 대기열에 쌓는다 */
function blockAction(act) {
    if (!selection) { toast('Pick a block in the preview first', 'warn'); return; }
    toFrame(act === 'remove' ? 'removeElement' : 'duplicateElement', {});
}

$('#saveCompBtn')?.addEventListener('click', () => {
    if (!selection) { toast('Pick a block in the preview first', 'warn'); return; }
    toFrame('grabComponent', {});
});

// ---------------------------------------------------------------- 섹션 간격 조절
// 큰 덩어리(.vb-section) 사이를 끌어서 위아래 여백을 조절한다.
//   전체 섹션 : --vb-pad-block 토큰을 바꿔 모든 섹션이 같이 움직인다 (리듬 유지)
//   이 섹션만 : 그 섹션에만 값을 덮어씌운다 (예외)
let gapOn = false, gapScope = 'all', gapLast = null;
function setGapMode(on) {
    gapOn = on;
    if (on && pickOn) setTool('pan');   // 여백을 끄는 동안엔 요소 선택을 꺼 둔다
    toFrame('setGapMode', on);
}
$('#gapScope')?.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    gapScope = b.dataset.scope;
    [...e.currentTarget.children].forEach(x => x.classList.toggle('on', x === b));
    toFrame('setGapScope', gapScope);
});
// 빠른 설정 · 슬라이더 — 전체 여백을 한 번에
function applyGapAll(px) {
    const i = pending.findIndex(p => p.kind === 'css' && p.selector === ':root' && p.prop === '--vb-pad-block');
    const edit = { kind: 'css', selector: ':root', prop: '--vb-pad-block', value: px + 'px' };
    if (i >= 0) pending[i] = edit; else pending.push(edit);
    toFrame('gapPreview', { scope: 'all', px });
    const r = $('#gapRange'), o = $('#gapRangeVal');
    if (r) r.value = px;
    if (o) o.textContent = px + 'px';
    updateDirty();
}
$('#gapRange')?.addEventListener('input', e => applyGapAll(+e.target.value));
$('#gapRange')?.addEventListener('change', () => setTimeout(refreshGapExceptions, 200));
// 미리보기에서 여백을 보여주고 끌어서 조절할지
$('#gapShow')?.addEventListener('change', e => {
    setGapMode(e.target.checked);
    const row = $('#gapScopeRow'); if (row) row.hidden = !e.target.checked;
    if (e.target.checked) setTimeout(refreshGapExceptions, 300);
});
// 예외 목록은 '페이지 설정'이 보일 때 불러온다 (renderInspector 참고)

/**
 * 토큰을 따르지 않는 섹션 목록.
 * 이게 있으면 슬라이더가 일부에만 먹혀 '왜 얘만 안 움직이지?' 가 된다 → 눈에 보이게 알린다.
 */
function renderGapExceptions({ base, list }) {
    const box = $('#gapExc'), host = $('#gapExcList'), sum = $('#gapExcSum');
    if (!box || !host || !sum) return;
    if (!list.length) { box.hidden = true; return; }
    box.hidden = false;
    // "1 sections" 는 어색하다
    const many = list.length > 1;
    sum.innerHTML = `<b>${list.length}</b> section${many ? 's' : ''} set${many ? '' : 's'} ${many ? 'their' : 'its'} own`;

    // 줄에 손을 올리면 그 섹션들이 미리보기에서 한꺼번에 밝아진다 — 글로 설명할 필요가 없다
    const paths = list.map(it => it.path);
    sum.onmouseenter = () => toFrame('hintSections', { paths });
    sum.onmouseleave = () => toFrame('hintSections', { paths: [] });
    sum.onclick = () => { host.hidden = !host.hidden; sum.classList.toggle('is-open', !host.hidden); };

    host.innerHTML = '';
    for (const it of list) {
        const row = el('button', 'sp-exc__item');
        row.type = 'button';
        const 값 = it.top === it.bottom ? `${it.top}` : `${it.top} / ${it.bottom}`;
        row.innerHTML =
            `<span class="sp-exc__name">${it.name}</span>` +
            `<span class="sp-exc__val">${값}</span>`;
        row.onmouseenter = () => toFrame('hintSections', { paths: [it.path] });
        row.onmouseleave = () => toFrame('hintSections', { paths: [] });
        row.addEventListener('click', () => {
            toFrame('hintSections', { paths: [] });
            toFrame('focusSection', { path: it.path });
        });
        host.appendChild(row);
    }
}
function refreshGapExceptions() { toFrame('listGapExceptions', {}); }

function onGapMove({ path, px, side }) {
    gapLast = { path, px, side };
    toFrame('gapPreview', { scope: gapScope, path, px, side });
}
function onGapEnd({ path, px, side }) {
    gapLast = null;
    if (gapScope === 'all') {
        // 토큰 한 줄만 바꾸면 13개 섹션이 함께 움직인다
        const i = pending.findIndex(p => p.kind === 'css' && p.selector === ':root' && p.prop === '--vb-pad-block');
        const edit = { kind: 'css', selector: ':root', prop: '--vb-pad-block', value: px + 'px' };
        if (i >= 0) pending[i] = edit; else pending.push(edit);
        toast(`All sections ${px}px — not saved yet`, 'ok');
    } else {
        // 눈에 보이는 간격 = 맞닿은 두 여백의 합. 짝이 되는 섹션도 같이 저장한다.
        const put = (p, prop) => {
            let e = pending.find(x => x.kind === 'inline' && samePath(x.path, p));
            if (!e) { e = { kind: 'inline', path: p, changes: {} }; pending.push(e); }
            e.changes[prop] = px + 'px';
        };
        put(path, side === 'bottom' ? 'padding-bottom' : 'padding-top');
        const mate = side === 'bottom'
            ? path.slice(0, -1).concat(path[path.length - 1] + 1)
            : path.slice(0, -1).concat(path[path.length - 1] - 1);
        if (mate[mate.length - 1] >= 0) put(mate, side === 'bottom' ? 'padding-top' : 'padding-bottom');
        toast(`This edge ${px}px (both sides)`, 'ok');
    }
    updateDirty();
}

// ---------------------------------------------------------------- 속성 정의
// 인스펙터 그룹.
//   when : 어떤 요소일 때 보여줄지 (없으면 항상)
//   adv  : 고급 — 기본은 접어 두고 'Show advanced'로 펼친다
// 선택한 게 무엇이든 24개를 다 쏟아내면 정작 필요한 값을 못 찾는다.
const LABEL = {
    'font-size': 'Font size', 'line-height': 'Line height', 'font-weight': 'Weight', 'color': 'Color',
    'margin-top': 'Top', 'margin-right': 'Right', 'margin-bottom': 'Bottom', 'margin-left': 'Left',
    'padding-top': 'Top', 'padding-right': 'Right', 'padding-bottom': 'Bottom', 'padding-left': 'Left',
    'width': 'Width', 'height': 'Height',
    'gap': 'Gap',
    'border-radius': 'Radius', 'background-color': 'Background', 'opacity': 'Opacity',
};

// ---------------------------------------------------------------- 박스 모델 위젯

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
// ── 인스펙터 ────────────────────────────────────────────────────
// 이 패널의 일은 하나다: "이 덩어리가 만드는 공간을 시스템 안에서 고친다."
// 그래서 간격을 주인공으로 크게 두고, 나머지 속성은 접어 둔다.
//
//   · 네 변을 끌어서 조절한다 (클릭해 숫자를 치는 것보다 빠르다)
//   · 끌면 디자인 시스템의 간격 단계에 자석처럼 붙는다 → 아무 값이나 나오지 않는다
//   · Alt 를 누른 채 끌면 시스템 밖 값도 만질 수 있다 (예외를 둘 때만)

let draggingEdge = false;   // 여백 숫자를 끌고 있는 중인지 (그동안 인스펙터를 다시 그리지 않는다)
let quietEdits = false;     // 끌고 있는 동안에는 안내 토스트를 띄우지 않는다

/** 간격 토큰 목록 — [{ name, px }] (없으면 빈 배열) */
function spaceSteps() {
    return (selection?.spaceTokens || []).filter(t => t && isFinite(t.px));
}

/** px 에 가장 가까운 토큰 단계 (없으면 null) */
function nearestStep(px) {
    const steps = spaceSteps();
    if (!steps.length) return null;
    return steps.reduce((a, b) => Math.abs(b.px - px) < Math.abs(a.px - px) ? b : a);
}

/** 한 변(위/오른쪽/아래/왼쪽)의 값 하나 — 끌어서 조절하고 토큰에 붙는다 */
function edgeField(prop, label) {
    const el = document.createElement('div');
    el.className = 'sp-edge';
    // 이 변이 페이지의 어디인지 색으로 짚어 준다
    const [part, side] = prop.split('-');
    el.addEventListener('mouseenter', ev => {
        ev.stopPropagation();
        toFrame('boxHint', { path: selection.path, part, side });
    });

    // 규칙에 var(--space-9) 처럼 적혀 있으면 숫자로 읽을 수 없다.
    // 그럴 땐 실제로 계산된 값(computed)을 쓴다.
    const raw = currentValue(prop) || '0px';
    const startPx = /var\(/.test(raw)
        ? Math.round(parseFloat(selection.computed?.[prop])) || 0
        : Math.round(parseFloat(raw)) || 0;
    const hit = nearestStep(startPx);
    const onToken = hit && Math.abs(hit.px - startPx) < 1;

    el.innerHTML =
        `<span class="sp-edge__label">${label}</span>` +
        `<span class="sp-edge__val${pendingFor(prop) ? ' is-changed' : ''}">${startPx}</span>`;
    // S9 · 같은 꼬리표 대신 숫자 색으로 알린다. 여기 숫자는 전부 px 이라 단위도 뺀다.
    // 0 은 '값이 없음'이지 '시스템 밖'이 아니다.
    el.classList.toggle('is-free', startPx !== 0 && !onToken);

    const valEl = el.querySelector('.sp-edge__val');

    // 끌어서 조절 — 세로로 움직인 만큼 값이 변하고, 손을 떼면 가까운 단계에 붙는다
    let dragging = false, from = 0, base = 0, snap = true;
    const onMove = ev => {
        if (!dragging) return;
        ev.preventDefault();
        const moved = from - ev.clientY;              // 위로 끌면 커진다
        let next = Math.max(0, base + moved);
        snap = !ev.altKey;                            // Alt 를 누르면 시스템 밖 값도 허용
        if (snap) {
            const st = nearestStep(next);
            if (st && Math.abs(st.px - next) <= 12) next = st.px;   // 가까우면 자석처럼
        }
        next = Math.round(next);
        if (String(next) === valEl.textContent) return;
        valEl.textContent = next;
        el.classList.toggle('is-free', !snap);
        stageEdit(prop, next + 'px');                 // 확정과 같은 길 — 규칙에 가려지지 않는다
    };
    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        draggingEdge = false;
        quietEdits = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('is-dragging-num');
        // 단계에 딱 붙었으면 숫자 대신 그 이름으로 남긴다 —
        // 화면 크기가 바뀌어도 같은 단계를 따라가고, 나중에 단계 값을 고치면 함께 움직인다
        const px = parseFloat(valEl.textContent) || 0;
        const st = nearestStep(px);
        stageEdit(prop, (st && Math.abs(st.px - px) < 1) ? `var(${st.name})` : px + 'px');
        renderInspector();
    };
    valEl.addEventListener('mousedown', ev => {
        ev.preventDefault();
        dragging = true; draggingEdge = true; quietEdits = true;
        from = ev.clientY; base = parseFloat(valEl.textContent) || 0;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.body.classList.add('is-dragging-num');
    });
    // 숫자를 두 번 누르면 직접 입력 (드래그로 맞추기 어려운 값)
    valEl.addEventListener('dblclick', () => {
        const inp = document.createElement('input');
        inp.className = 'sp-edge__input'; inp.value = valEl.textContent;
        valEl.replaceWith(inp); inp.focus(); inp.select();
        const done = () => stageEdit(prop, (parseFloat(inp.value) || 0) + 'px');
        inp.addEventListener('blur', done);
        inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); done(); }
            if (e.key === 'Escape') inp.replaceWith(valEl);
        });
    });
    return el;
}

/**
 * 간격 판 — 바깥(margin) 안에 안쪽(padding), 그 안에 내용.
 * 네 변을 모두 같은 방식으로 두어야 어느 값이 무엇인지 헷갈리지 않는다.
 * (좌우만 따로 빼면 "이 마진은 뭐지?" 하고 다시 읽어야 한다)
 *
 * 패널이 270px 남짓이라 글자와 여백을 바짝 조여 네 변을 다 담는다.
 */
function spacingBoard() {
    const wrap = document.createElement('div');
    wrap.className = 'sp-board';

    const ring = (cls, name, props) => {
        const el = document.createElement('div');
        el.className = `sp-ring sp-ring--${cls}`;
        el.dataset.part = cls;
        el.innerHTML = `<span class="sp-ring__name">${name}</span>`;
        el.append(
            edgeField(props[0], '↑'), edgeField(props[1], '→'),
            edgeField(props[2], '↓'), edgeField(props[3], '←'),
        );
        return el;
    };

    const outer = ring('margin', 'Outside',
        ['margin-top', 'margin-right', 'margin-bottom', 'margin-left']);
    const inner = ring('padding', 'Inside',
        ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']);

    // 가운데는 '이 요소'를 뜻하는 빈 칸. 크기는 맨 위에 이미 적혀 있다.
    const core = document.createElement('div');
    core.className = 'sp-core';

    inner.appendChild(core);
    outer.appendChild(inner);
    wrap.appendChild(outer);

    // 어느 부분인지 미리보기에서 색으로 알려 준다 (판을 떠나면 지운다)
    for (const el of [outer, inner]) {
        el.addEventListener('mouseenter', () => toFrame('boxHint', { path: selection.path, part: el.dataset.part }));
    }
    wrap.addEventListener('mouseleave', () => toFrame('boxHint', { path: null }));

    return wrap;
}


/**
 * 페이지 전체를 정하는 값 하나 — 끌어서 조절한다.
 * calc(1280px * var(--vb-s)) 처럼 식으로 적힌 값은 기준 숫자만 갈아끼운다.
 */
function pageTokenRow(name, label, hint, opt = {}) {
    // 저장 대기 중인 값이 있으면 그것을 먼저 본다 (되돌린 뒤 옛 값이 남지 않게)
    const pend = pending.find(p => p.kind === 'css' && p.selector === ':root' && p.prop === name);
    const raw = pend ? pend.value : (pageTokens?.now?.[name] || '');
    // calc(NNNpx * 배율) 형태의 숫자만 고른다.
    // 그냥 px 를 다 잡으면 배율 식 안의 5120px(100vw / 5120px) 까지 걸린다.
    const RE = /calc\(\s*(-?[\d.]+)px/g;
    const all = [...raw.matchAll(RE)].map(x => x[1]);
    if (!all.length) return null;
    // clamp(min, 유동, max) 처럼 여러 개면 실제를 정하는 쪽 — 넓은 화면에선 상한(마지막)이다
    const at = opt.which === 'last' ? all.length - 1 : 0;
    const basePx = parseFloat(all[at]);

    const row = document.createElement('div');
    row.className = 'pt-row';
    row.innerHTML =
        `<span class="pt-label">${label}</span>` +
        `<span class="pt-field"><span class="pt-val">${basePx}</span>` +
        `<span class="pt-unit">px</span></span>`;

    const valEl = row.querySelector('.pt-val');
    const fieldEl = row.querySelector('.pt-field');   // 칸 전체가 손잡이다 (여백·단위를 잡아도 끌린다)
    // 말로 설명하는 것보다 페이지에서 짚어 주는 편이 빠르다
    if (opt.hint) {
        row.addEventListener('mouseenter', () => toFrame('pageHint', { what: opt.hint }));
        row.addEventListener('mouseleave', () => toFrame('pageHint', { what: null }));
    }
    const apply = px => {
        let seen = -1;
        const next = raw.replace(/calc\(\s*(-?[\d.]+)px/g,
            (m, n) => (++seen === at ? m.replace(n + 'px', px + 'px') : m));
        // :root 규칙을 고친다 — 페이지 전체 규칙이라 요소 하나에 붙이지 않는다
        const i = pending.findIndex(p => p.kind === 'css' && p.selector === ':root' && p.prop === name);
        const edit = { kind: 'css', selector: ':root', prop: name, value: next };
        if (i >= 0) pending[i] = edit; else pending.push(edit);
        toFrame('pageTokenPreview', { vars: Object.fromEntries(
            pending.filter(p => p.kind === 'css' && p.selector === ':root').map(p => [p.prop, p.value])) });
        updateDirty();
    };

    let dragging = false, from = 0, base = 0;
    const onMove = ev => {
        if (!dragging) return;
        ev.preventDefault();
        const next = Math.max(0, Math.round(base + (from - ev.clientY) * 4));   // 폭은 큰 값이라 4배로
        if (String(next) === valEl.textContent) return;
        valEl.textContent = next;
        apply(next);
    };
    const onUp = () => {
        dragging = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('is-dragging-num');
    };
    fieldEl.addEventListener('mousedown', ev => {
        ev.preventDefault();
        dragging = true; from = ev.clientY; base = parseFloat(valEl.textContent) || 0;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.body.classList.add('is-dragging-num');
    });
    fieldEl.addEventListener('dblclick', () => {
        const inp = document.createElement('input');
        inp.className = 'pt-input'; inp.value = valEl.textContent;
        valEl.replaceWith(inp); inp.focus(); inp.select();
        const done = () => { const v = parseFloat(inp.value) || basePx; inp.replaceWith(valEl); valEl.textContent = v; apply(v); };
        inp.addEventListener('blur', done);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(); } if (e.key === 'Escape') inp.replaceWith(valEl); });
    });

    if (hint) {
        const h = document.createElement('p');
        h.className = 'pt-hint';
        h.textContent = hint;
        const wrap = document.createElement('div');
        wrap.append(row, h);
        return wrap;
    }
    return row;
}

/**
 * 본문 띠를 켜 두고 보는 토글.
 * 값을 숫자로만 보면 어디까지가 본문인지 알 수 없다. 켜 두면 계속 보인다.
 */
let contentGuideOn = false;
function contentGuideRow() {
    const label = document.createElement('label');
    label.className = 'sp-row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = contentGuideOn;
    box.addEventListener('change', () => {
        contentGuideOn = box.checked;
        toFrame('contentGuide', { on: contentGuideOn });
    });
    const span = document.createElement('span');
    span.className = 'sp-check';
    span.append(box, document.createTextNode(' Show the content band'));
    label.appendChild(span);
    return label;
}

/**
 * 고른 것들 사이의 간격.
 * 각 간격은 '아래쪽 요소의 margin-top' 으로 만들어지므로 그 값을 고친다.
 * (여백이 겹쳐 실제로 보이는 거리는 다를 수 있어, 눈에 보이는 값을 함께 보여 준다)
 */
function gapsBetweenRow() {
    const wrap = document.createElement('div');
    wrap.className = 'group';
    wrap.innerHTML = '<h3>Space between</h3>';

    picks.gaps.forEach((g, i) => {
        const row = document.createElement('div');
        row.className = 'field';
        row.innerHTML = `<label>${i + 1} → ${i + 2}</label>`;

        const steps = spaceSteps();
        const hit = steps.length ? steps.reduce((a, b) =>
            Math.abs(b.px - g.px) < Math.abs(a.px - g.px) ? b : a) : null;
        const onToken = hit && Math.abs(hit.px - g.px) < 1;

        const sel = document.createElement('select');
        sel.className = 'tokenSel';
        const cur = document.createElement('option');
        cur.value = ''; cur.textContent = `${g.px}px${onToken ? ` · ${hit.label}` : ''}`;
        sel.appendChild(cur);
        for (const st of steps) {
            const o = document.createElement('option');
            o.value = st.name; o.textContent = `${st.label} · ${st.px}px`;
            if (onToken && st.name === hit.name) o.selected = true;
            sel.appendChild(o);
        }
        sel.addEventListener('change', () => {
            if (!sel.value) return;
            // 아래쪽 요소의 위 여백을 바꾸면 그 사이가 벌어진다
            pending.push({ kind: 'inline', path: g.path, changes: { 'margin-top': `var(${sel.value})` } });
            updateDirty();
            toFrame('preview', { path: g.path, changes: { 'margin-top': `var(${sel.value})` } });
        });
        row.appendChild(sel);
        wrap.appendChild(row);
    });

    const note = document.createElement('p');
    note.className = 'fold-note';
    note.textContent = picks.gaps.length
        ? 'Changes the top margin of the lower item.'
        : 'Pick two or more items that sit side by side.';
    wrap.appendChild(note);
    return wrap;
}

/** 페이지 뒷배경 색 — :root 의 --bg-color 를 고친다 */
/**
 * 팔레트를 여는 버튼 옆에 붙여 띄운다 (패널이 오른쪽이라 왼쪽으로).
 *
 * body 로 옮겨 붙인다: 패널에 backdrop-filter 가 걸려 있어서, 그 안에 두면
 * position:fixed 가 화면이 아니라 패널을 기준으로 잡힌다.
 */
function openPopBeside(btn, pop) {
    const opening = pop.hidden;
    closeColorPops();
    if (!opening) return;

    document.body.appendChild(pop);
    pop.hidden = false;
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(8, r.left - pop.offsetWidth - 10) + 'px';
    pop.style.top = Math.max(8, Math.min(r.top, window.innerHeight - pop.offsetHeight - 8)) + 'px';

    // 딴 데를 누르면 닫는다
    setTimeout(() => {
        const away = ev => {
            if (pop.contains(ev.target) || btn.contains(ev.target)) return;
            document.removeEventListener('mousedown', away);
            closeColorPops();
        };
        document.addEventListener('mousedown', away);
    }, 0);
}

/** 떠 있는 팔레트를 모두 치운다 (패널을 다시 그릴 때 body 에 남지 않게) */
function closeColorPops() {
    document.querySelectorAll('body > .color-pop').forEach(n => n.remove());
}

/** 시스템 밖 색 — 눈으로 고르고, 헥스로도 칠 수 있게 */
function pickerBlock(startHex, commit) {
    const box = document.createElement('div');
    box.className = 'color-free';

    const title = document.createElement('div');
    title.className = 'color-cat';
    title.textContent = 'Other';
    box.appendChild(title);

    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'color-hex'; inp.placeholder = '#000000';
    inp.value = startHex || '';

    // 끄는 동안에는 화면에만 보여 주고, 손을 떼면 확정한다
    let live = null;
    const pick = colorPicker(startHex, v => { live = v; inp.value = v; commit(v); });
    box.appendChild(pick);
    box.appendChild(inp);

    inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const v = inp.value.trim();
        if (/^#?[0-9a-f]{3,8}$/i.test(v)) { pick.setHex(v.startsWith('#') ? v : '#' + v); commit(v.startsWith('#') ? v : '#' + v); }
    });
    return box;
}

// ---------------------------------------------------------------- 색 고르개
const hex2rgb = h => {
    const v = String(h || '').replace('#', '');
    const f = v.length === 3 ? v.split('').map(c => c + c).join('') : v.padEnd(6, '0');
    return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16) || 0);
};
const rgb2hex = ([r, g, b]) =>
    '#' + [r, g, b].map(x => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('').toUpperCase();

function rgb2hsv([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) {
        if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
    }
    return [h, mx ? d / mx : 0, mx];
}
function hsv2rgb([h, s, v]) {
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    const t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
        : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return t.map(n => (n + m) * 255);
}

/**
 * 색을 직접 고르는 판 — 채도·밝기 사각형 + 색상 띠.
 * 시스템 밖 색이 필요할 때 헥스코드를 외워 치게 하지 않는다.
 */
function colorPicker(startHex, onChange) {
    let hsv = rgb2hsv(hex2rgb(startHex || '#808080'));

    const box = document.createElement('div');
    box.className = 'cp';
    box.innerHTML =
        '<div class="cp-sv"><i class="cp-dot"></i></div>' +
        '<div class="cp-bar">' +
            '<button type="button" class="cp-pipette" title="Pick a color from the screen">' +
                '<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M172-172h40l402-403-40-40-402 402v41Zm-52 52v-114l454-453q7-7 15.5-10.5T607-701q9 0 17.5 3.5T640-687l52 53q7 7 10 15.5t3 17.5q0 9-3.5 17.5T691-568L238-120H120Zm646-499-92-92 62-62q8-8 16.5-11.5T769-840q9 0 17.5 3.5T802-825l52 53q7 7 10.5 15.5T868-739q0 9-3.5 17.5T854-706l-88 87Z"/></svg>' +
            '</button>' +
            '<div class="cp-hue"><i class="cp-dot"></i></div>' +
        '</div>';
    const sv = box.querySelector('.cp-sv'), hue = box.querySelector('.cp-hue');
    const svDot = sv.querySelector('.cp-dot'), hueDot = hue.querySelector('.cp-dot');

    // 화면 어디서든 색을 집어 온다 (크롬의 EyeDropper)
    const pipette = box.querySelector('.cp-pipette');
    if (window.EyeDropper) {
        pipette.addEventListener('click', async () => {
            try {
                const { sRGBHex } = await new window.EyeDropper().open();
                hsv = rgb2hsv(hex2rgb(sRGBHex));
                paint();
                onChange(sRGBHex.toUpperCase());
            } catch { /* 사용자가 취소함 */ }
        });
    } else {
        pipette.hidden = true;   // 이 브라우저는 못 집는다
    }

    const paint = () => {
        const [h, s, v] = hsv;
        sv.style.background =
            `linear-gradient(to top, #000, transparent), ` +
            `linear-gradient(to right, #fff, ${rgb2hex(hsv2rgb([h, 1, 1]))})`;
        svDot.style.left = s * 100 + '%';
        svDot.style.top = (1 - v) * 100 + '%';
        svDot.style.background = rgb2hex(hsv2rgb(hsv));
        hueDot.style.left = (h / 360) * 100 + '%';
    };
    paint();

    // 사각형·띠를 누르거나 끄는 동안 계속 따라온다
    const track = (el, onPos) => {
        const move = ev => {
            const r = el.getBoundingClientRect();
            onPos(
                Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)),
                Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)),
            );
            paint();
            onChange(rgb2hex(hsv2rgb(hsv)));
        };
        el.addEventListener('mousedown', ev => {
            ev.preventDefault();
            move(ev);
            const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });
    };
    track(sv, (x, y) => { hsv[1] = x; hsv[2] = 1 - y; });
    track(hue, x => { hsv[0] = x * 360; });

    box.setHex = h => { hsv = rgb2hsv(hex2rgb(h)); paint(); };
    return box;
}

/**
 * 색 견본 — 디자인 시스템의 갈래를 그대로 살려 이름을 얹고 줄줄이 늘어놓는다.
 * 갈래를 뭉개면 60개 중에서 무엇을 고르는지 알 수 없다.
 */
function swatchGroups(onPick, isOn) {
    const box = document.createElement('div');
    const groups = insTokens?.colorGroups || [];
    for (const g of groups) {
        const title = document.createElement('div');
        title.className = 'color-cat';
        title.textContent = g.title;
        box.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'color-grid';
        for (const c of g.items) {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className = 'color-sw' + (isOn(c) ? ' is-on' : '');
            sw.title = `${c.label}  ${c.hex || ''}`.trim();
            sw.style.background = c.hex || `var(${c.name})`;
            sw.addEventListener('click', () => onPick(c));
            grid.appendChild(sw);
        }
        box.appendChild(grid);
    }
    return box;
}

function pageColorRow() {
    if (!insTokens?.colorGroups?.length) return null;

    // --bg-color 토큰이 아니라 '실제로 배경을 칠하는 쪽'을 고친다.
    // 이 사이트처럼 html 에 색을 직접 박아 둔 페이지에서는 토큰만 바꿔 봐야 화면이 그대로다.
    const sel = pageBg?.selector || 'body';
    const staged = pending.find(p => p.kind === 'css' && p.selector === sel && p.prop === 'background-color');
    const cur = staged ? staged.value : (pageBg?.color || '');
    const curVar = (cur.match(/var\(\s*(--[\w-]+)\s*\)/) || [])[1] || null;
    const all = insTokens.colors;
    const hit = curVar ? all.find(c => c.name === curVar)
        : all.find(c => c.hex && sameColor(c.hex, cur));
    const hex = /^#/.test(cur) ? cur.toUpperCase() : (hit?.hex || toHex(cur) || '');

    const wrap = document.createElement('div');
    const row = document.createElement('div');
    row.className = 'field field--wide';   // 제목(Page background)이 이미 무엇인지 말한다

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-btn';
    btn.innerHTML =
        `<span class="color-chip" style="background:${hex || 'transparent'}"></span>` +
        `<span class="color-name">${hit ? hit.label : (hex || '—')}</span>`;
    row.appendChild(btn);
    wrap.appendChild(row);


    const pop = document.createElement('div');
    pop.className = 'color-pop';
    pop.hidden = true;
    pop.appendChild(swatchGroups(
        c => setColor(`var(${c.name})`),
        c => !!hit && hit.name === c.name,
    ));

    const setColor = value => {
        const put = (prop, v) => {
            const i = pending.findIndex(p => p.kind === 'css' && p.selector === sel && p.prop === prop);
            const edit = { kind: 'css', selector: sel, prop, value: v };
            if (i >= 0) pending[i] = edit; else pending.push(edit);
        };
        put('background-color', value);
        // 그라데이션이 위에 덮여 있으면 색을 바꿔도 안 보인다 — 함께 걷어낸다
        if (pageBg?.hasImage) put('background-image', 'none');
        updateDirty();
        applyPendingPreview();
        // 패널을 통째로 다시 그리면 열려 있는 팔레트가 사라져 색을 끌 수가 없다.
        // 바뀐 자리만 손본다.
        const shown = insTokens.colors.find(c => value === `var(${c.name})`);
        const swatch = shown?.hex || toHex(value) || value;
        btn.querySelector('.color-chip').style.background = swatch;
        btn.querySelector('.color-name').textContent = shown ? shown.label : (toHex(value) || value);
        pop.querySelectorAll('.color-sw').forEach(el => el.classList.remove('is-on'));
    };

    pop.appendChild(pickerBlock(hex, v => setColor(v)));
    wrap.appendChild(pop);

    btn.addEventListener('click', () => openPopBeside(btn, pop));
    return wrap;
}

/** rgb(...) 과 #hex 를 같은 색으로 볼 수 있게 견준다 */
function sameColor(a, b) {
    const h = v => (toHex(v) || String(v || '')).toUpperCase();
    return !!a && !!b && h(a) === h(b);
}

/** 접히는 묶음 — 자주 안 쓰는 것은 닫아 둔다 */
function foldGroup(title, build, open = false) {
    const d = document.createElement('details');
    d.className = 'fold';
    if (open) d.open = true;
    const sum = document.createElement('summary');
    sum.textContent = title;
    d.appendChild(sum);
    const body = document.createElement('div');
    body.className = 'fold__body';
    build(body);
    d.appendChild(body);
    return d;
}

/**
 * 고른 게 있을 때만 켜지는 것들.
 * 복제·삭제는 버튼을 두지 않는다 — Ctrl+D 와 Delete 로 하고,
 * 캔버스 툴바는 '커서 상태'(이동·선택)를 고르는 곳으로 남긴다.
 */
function syncSelectionButtons() {
    const save = $('#saveCompBtn');
    // 고른 게 없으면 할 수 있는 일이 아니다 — 흐리게 두지 말고 치운다
    if (save) { save.hidden = !selection; save.disabled = !selection; }
}

/**
 * 고른 것을 사람 말로 부른다.
 * 'div.vb-wrap' 은 코드 이름이지 디자이너가 화면에서 보는 것의 이름이 아니다.
 */
function friendlyName(sel) {
    const t = (sel.tag || '').toLowerCase();
    const cls = (sel.classes || []).filter(c => !c.startsWith('__ed'));
    // 등록해 둔 컴포넌트라면 그 이름으로 부른다
    const saved = savedComps.find(c => (c.needs || []).length && cls.includes((c.needs[0] || '')));
    if (saved) return saved.name;
    if (/^h[1-6]$/.test(t)) return 'Heading';
    if (t === 'p') return 'Paragraph';
    if (t === 'img') return 'Image';
    if (t === 'video' || t === 'iframe') return 'Video';
    if (t === 'a' || t === 'button') return 'Link';
    if (t === 'ul' || t === 'ol' || t === 'li') return 'List';
    if (t === 'section' || t === 'main' || t === 'header' || t === 'footer') return 'Section';
    if (sel.textOnly) return 'Text';
    return 'Group';
}

function renderInspector() {
    closeColorPops();
    if (draggingEdge) return;          // 값을 끌고 있는 중엔 화면을 갈아엎지 않는다
    syncSelectionButtons();
    const empty = $('#emptyState'), insp = $('#inspector');
    if (!selection) {
        // 고른 게 없으면 이 패널은 '페이지 전체'를 다룬다.
        // (아무것도 안 고른 상태 = 페이지를 고른 상태 — 여느 에디터와 같은 규칙)
        const lay = $('#pageLayout');
        if (lay) {
            lay.innerHTML = '';     // 이 안(Content width·띠 보기)만 다시 그린다
            // 카드 사이 간격은 여기 두지 않는다 — 카드 줄을 고르면 Layout > Gap 에서 정한다.
            // 페이지 전체에 걸리는 값만 남긴다.
            // 이름과 값만 — 손을 올리면 페이지에서 어디인지 짚어 주므로 설명이 필요 없다.
            // 보기 토글은 그 값 바로 아래에 둔다 (무엇을 보여 주는 토글인지 붙어 있어야 안다)
            const width = pageTokenRow('--vb-maxw', 'Content width', null, { hint: 'maxw' });
            if (width) { lay.appendChild(width); lay.appendChild(contentGuideRow()); }

            const gap = pageTokenRow('--vb-pad-block', 'Section spacing', null,
                { which: 'last', hint: 'gap' });
            if (gap) lay.appendChild(gap);
            lay.hidden = !(width || gap);

            // 페이지 배경색
            const bgBody = $('#pageBgBody');
            if (bgBody) {
                bgBody.innerHTML = '';
                const row = pageColorRow();
                if (row) bgBody.appendChild(row); else $('#pageBg').hidden = true;
            }
        }
        empty.hidden = false; insp.hidden = true; syncSelectionButtons();
        // 예외 목록은 ready 를 받은 뒤에 물어본다 (아래 'ready' 처리 참고)
        return;
    }
    empty.hidden = true; insp.hidden = false; emptyShown = false;

    $('#selTag').textContent = friendlyName(selection);
    // 코드 이름은 필요할 때만 (마우스를 올리면 보인다)

    $('#selMeta').textContent = `${selection.rect.w} × ${selection.rect.h}`;


    const box = $('#fields');
    box.innerHTML = '';

    // 여러 개를 골랐다면 궁금한 건 각자의 속성이 아니라 '사이 간격'이다
    if (picks && picks.count > 1) {
        $('#selTag').textContent = `${picks.count} items`;
        $('#selMeta').textContent = picks.items.map(i => i.classes[0] || i.tag).join(' · ');
        box.appendChild(gapsBetweenRow());
        return;
    }

    // 무엇을 골랐느냐에 따라 보여줄 것이 다르다.
    // 특히 '글자 속성'은 자식 태그가 없을 때만 뜻이 있다 — 제목과 설명이 묶인
    // 덩어리를 고르고 글자 크기를 하나로 정할 수는 없기 때문이다.
    // 글자를 담을 수 없는 것들 — 자식이 없다고 '글자 하나짜리'로 보면 안 된다
    const NO_TEXT = /^(IMG|VIDEO|IFRAME|SOURCE|BR|HR|INPUT|CANVAS|SVG|EMBED|OBJECT|AREA|TRACK|WBR|SELECT|TEXTAREA)$/i;
    const ctx = {
        isLeafText: !!selection.textOnly && !NO_TEXT.test(selection.tag),
        isMedia: /^(IMG|VIDEO|IFRAME|SOURCE)$/i.test(selection.tag),
        isFlexOrGrid: /flex|grid/.test(selection.computed?.display || ''),
        isContainer: selection.childCount > 0,
    };

    // ① 값을 채우는 일이 먼저 (글자·링크)
    if (ctx.isLeafText) box.appendChild(textRow());
    if (ctx.isMedia) box.appendChild(mediaRow());

    // 캐러셀 트랙이면 '넘어가는 속도'는 이 덩어리 전체의 설정이다
    if (/vb-carousel__track/.test((selection.classes || []).join(' '))) {
        box.appendChild(carouselRow());
    }

    // ② 주인공 — 이 덩어리가 만드는 공간
    box.appendChild(spacingBoard());

    // 카드 사이 간격은 여백과 같은 종류다. Layout 접힘 안에 묻어 두면
    // 정작 제일 자주 만지는 값을 찾느라 두 번 클릭하게 된다.
    if (/flex|grid/.test(selection.computed?.display || '')) {
        const row = el('div', 'sp-between');
        row.appendChild(el('span', 'sp-between__label', 'Between'));
        row.appendChild(edgeField('gap', '↔'));
        box.appendChild(row);
    }

    // 이웃과의 간격을 따로 두었다가 뺐다 — 간격 판과 같은 margin 을 만지는데
    // 두 곳에서 조절하니 한쪽을 바꾸면 다른 쪽이 0 으로 보여 헷갈렸다.
    // 겹침(margin collapse) 안내는 간격 판 아래에 남아 있다.

    // ④ 나머지는 고른 것에 맞는 것만, 그것도 접어서
    if (ctx.isLeafText) {
        // 글자 하나짜리 — 크기·굵기·색이 하나로 정해지므로 뜻이 있다
        box.appendChild(foldGroup('Text', b => {
            b.appendChild(alignRow());
            for (const prop of ['font-size', 'line-height', 'font-weight', 'color']) b.appendChild(fieldRow(prop));
        }));
    } else if (ctx.isContainer && !ctx.isFlexOrGrid) {
        // 덩어리 — 안에 여러 크기가 섞여 있어 '글자 크기' 하나를 정할 수 없다.
        // 다만 카드가 늘어선 묶음(flex·grid)은 빼둔다 — 거기서 정렬은
        // Layout 의 Across·Down 이 맡는다. 둘 다 띄우면 어느 쪽이 먹는지 알 수 없다.
        box.appendChild(foldGroup('Text', b => {
            b.appendChild(alignRow());   // 정렬은 덩어리 단위로도 뜻이 있다
        }));
    }
    if (ctx.isFlexOrGrid) {
        box.appendChild(foldGroup('Layout', b => {
            // 이름은 무엇이 일어나는지로 부른다 (flex-start / space-between 은 CSS 말이다)
            b.appendChild(choiceRow('justify-content', 'Across',
                [['flex-start', 'Start'], ['center', 'Middle'],
                 ['flex-end', 'End'], ['space-between', 'Spread']]));
            b.appendChild(choiceRow('align-items', 'Down',
                [['flex-start', 'Top'], ['center', 'Middle'],
                 ['flex-end', 'Bottom'], ['stretch', 'Fill']]));
        }));
    }
    // 배경·모서리는 면이 있는 것에만
    if (!ctx.isLeafText || ctx.isMedia) {
        box.appendChild(foldGroup('Appearance', b => {
            for (const prop of ['background-color', 'border-radius', 'opacity']) b.appendChild(fieldRow(prop));
        }));
    }
    // 크기는 미디어와 덩어리에만 (인라인 글자에 폭을 주는 일은 거의 없다)
    if (ctx.isMedia || ctx.isContainer) {
        box.appendChild(foldGroup('Size', b => {
            for (const prop of ['width', 'height']) b.appendChild(fieldRow(prop));
        }));
    }
}

/**
 * 위·아래 이웃과의 간격을 한 줄로 조절한다.
 *
 * 텍스트 사이 간격은 '위 요소의 margin-bottom + 아래 요소의 margin-top'이라,
 * 예전엔 두 요소를 각각 선택해 서로 다른 항목을 찾아야 했다.
 * 여기서는 지금 보이는 간격을 그대로 보여주고, 조절하면 '이 요소 쪽' 값만 바꾼다.
 */
/**
 * 유튜브 주소를 붙이면 그대로는 안 나온다 — 넣을 수 있는 주소로 바꿔 준다.
 * (주소창에서 복사한 watch?v=… / youtu.be/… 를 embed 형태로)
 */
function embedUrl(v) {
    const m = String(v).match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
    return m ? `https://www.youtube.com/embed/${m[1]}` : v;
}

// 이 페이지 옆 media/ 폴더에 뭐가 있는지 — 한 번 받아 두고 쓴다
let mediaFiles = null;
async function loadMediaFiles() {
    if (mediaFiles) return mediaFiles;
    try {
        const r = await fetch('/__api/media?page=' + encodeURIComponent(currentPage));
        mediaFiles = (await r.json()).items || [];
    } catch { mediaFiles = []; }
    return mediaFiles;
}

const isVideoUrl = u => /\.(mp4|webm|mov)(\?|#|$)/i.test(String(u || ''));

/**
 * 파일에 적히는 경로는 페이지 기준(media/1.jpg)이지만,
 * 에디터 화면은 다른 자리에서 도니 그대로 쓰면 썸네일이 안 뜬다.
 * 보여줄 때만 페이지가 있는 폴더를 앞에 붙인다.
 */
function mediaSrc(u) {
    if (!u || /^(https?:|data:|\/)/i.test(u)) return u;
    const dir = (currentPage || '').replace(/[^/]*$/, '');
    return '/' + dir + u;
}

/**
 * 미디어를 고른다 — media/ 폴더를 훑어 썸네일로 늘어놓는다.
 *
 * 영상이면 <video>, 사진이면 <img> 로 태그까지 바꾼다.
 * src 만 갈아 끼우면 영상 자리에 재생이 안 되는 <img> 가 남는다.
 */
/**
 * 숫자 하나를 묻는 창. 브라우저 기본 prompt 는 이 앱과 아무 관계 없는 모양이라
 * 화면 한가운데에 우리 결로 띄운다.
 */
function askCount(title, value, min = 1, max = 12) {
    return new Promise(resolve => {
        const back = el('div', 'dlg-back');
        const box = el('div', 'dlg');
        box.innerHTML = `<div class="dlg__title">${title}</div>`;

        const row = el('div', 'dlg__row');
        const dec = el('button', 'dlg__step'); dec.type = 'button'; dec.textContent = '−';
        const num = el('span', 'dlg__num', String(value));
        const inc = el('button', 'dlg__step'); inc.type = 'button'; inc.textContent = '+';
        const set = n => { value = Math.max(min, Math.min(max, n)); num.textContent = String(value); };
        dec.onclick = () => set(value - 1);
        inc.onclick = () => set(value + 1);
        row.append(dec, num, inc);
        box.appendChild(row);

        const acts = el('div', 'dlg__acts');
        const cancel = el('button', 'btn ghost'); cancel.type = 'button'; cancel.textContent = 'Cancel';
        const ok = el('button', 'btn primary'); ok.type = 'button'; ok.textContent = 'Add';
        acts.append(cancel, ok);
        box.appendChild(acts);

        const close = v => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
        cancel.onclick = () => close(null);
        ok.onclick = () => close(value);
        back.onclick = e => { if (e.target === back) close(null); };
        const onKey = e => {
            if (e.key === 'Escape') close(null);
            if (e.key === 'Enter') close(value);
            if (e.key === 'ArrowUp') set(value + 1);
            if (e.key === 'ArrowDown') set(value - 1);
        };
        document.addEventListener('keydown', onKey);

        back.appendChild(box);
        document.body.appendChild(back);
        ok.focus();
    });
}

/** 캐러셀 전체 설정 — 카드 하나가 아니라 묶음에 걸리는 값 */
function carouselRow() {
    const g = el('div', 'group');
    g.innerHTML = '<h3>Carousel</h3>';

    const secRow = (attr, label, fallback) => {
        const row = el('div', 'pt-row');
        row.appendChild(el('span', 'pt-label', label));
        const field = el('div', 'pt-field');
        const now = Number(selection.attrs?.[attr]) || fallback;
        const val = el('span', 'pt-val', (now / 1000).toFixed(1));
        field.append(val, el('span', 'pt-unit', 'sec'));
        row.appendChild(field);

        // 다른 값들과 같이 끌어서 조절한다
        let dragging = false, from = 0, base = 0;
        const onMove = ev => {
            if (!dragging) return;
            ev.preventDefault();
            const next = Math.min(20, Math.max(0.5, base + (from - ev.clientY) * 0.05));
            const shown = next.toFixed(1);
            if (shown === val.textContent) return;
            val.textContent = shown;
            const ms = Math.round(next * 1000);
            const i = pending.findIndex(p => p.kind === 'attr' && samePath(p.path, selection.path) && p.name === attr);
            const edit = { kind: 'attr', path: selection.path, name: attr, value: String(ms) };
            if (i >= 0) pending[i] = edit; else pending.push(edit);
            toFrame('setAttr', { path: selection.path, name: attr, value: String(ms) });
            updateDirty();
        };
        const onUp = () => {
            dragging = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.classList.remove('is-dragging-num');
        };
        field.addEventListener('mousedown', ev => {
            ev.preventDefault();
            dragging = true; from = ev.clientY; base = parseFloat(val.textContent) || 1;
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            document.body.classList.add('is-dragging-num');
        });
        return row;
    };

    // 사진과 영상은 머무는 시간이 다르다 — 영상은 재생 시간을 벌어야 한다
    g.appendChild(secRow('data-delay', 'Photo card', 2200));
    g.appendChild(secRow('data-delay-video', 'Video card', 5000));
    return g;
}

function mediaRow() {
    const g = el('div', 'group');
    g.innerHTML = '<h3>Media</h3>';

    const cur = selection.attrs?.src || '';
    const isVid = selection.tag?.toUpperCase() === 'VIDEO' || isVideoUrl(cur);

    // 주소 칸을 먼저 만들어 둔다 (빈 자리를 누르면 여기로 보낸다)
    const inp = el('input');
    inp.type = 'text';
    inp.value = cur;

    // 지금 무엇이 들어 있는지 먼저 보여 준다
    const now = el('div', 'mp-now' + (cur ? '' : ' is-empty'));
    if (cur) {
        now.innerHTML = isVid
            ? `<video src="${mediaSrc(cur)}" muted playsinline></video><span class="mp-play">▶</span>`
            : `<img src="${mediaSrc(cur)}" alt="">`;
    } else {
        now.innerHTML =
            '<svg class="mp-plus" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-480ZM212.31-140Q182-140 161-161q-21-21-21-51.31v-535.38Q140-778 161-799q21-21 51.31-21h300v60h-300q-5.39 0-8.85 3.46t-3.46 8.85v535.38q0 5.39 3.46 8.85t8.85 3.46h535.38q5.39 0 8.85-3.46t3.46-8.85v-300h60v300Q820-182 799-161q-21 21-51.31 21H212.31Zm43.08-152.31h449.22L565-478.46 445-322.69l-85-108.08-104.61 138.46ZM680-600v-80h-80v-60h80v-80h60v80h80v60h-80v80h-60Z"/></svg>' +
            '<span>Drop a file here, or click to choose</span>';
        now.onclick = () => inp.focus();
    }
    g.appendChild(now);

    /** 고른 것을 넣는다. 태그가 달라지면 요소째 갈아 끼운다. */
    const pick = url => {
        const wantVideo = isVideoUrl(url);
        const nowTag = selection.tag?.toUpperCase();
        if (wantVideo !== (nowTag === 'VIDEO')) {
            // 영상 ↔ 사진 — 태그가 바뀐다
            const cls = (selection.classes || []).filter(c => !c.startsWith('__ed')).join(' ');
            const attr = cls ? ` class="${cls}"` : '';
            const html = wantVideo
                ? `<video${attr} src="${url}" autoplay muted loop playsinline></video>`
                : `<img${attr} src="${url}" alt="" loading="lazy">`;
            pending.push({ kind: 'replace', path: selection.path, html });
            toFrame('replacePreview', { path: selection.path, html });
        } else {
            pending.push({ kind: 'attr', path: selection.path, name: 'src', value: url });
            toFrame('setAttr', { path: selection.path, name: 'src', value: url });
        }
        updateDirty();
        renderInspector();
    };

    // 사진 크기는 폭을 % 로 미는 것보다 '틀의 비율' 을 고르는 편이 맞다.
    // 이미지는 틀에 꽉 차게(cover) 들어가므로, 폭만 늘리면 잘리는 자리만 바뀐다.
    const shapes = [['ed-ph--16x9', '16:9'], ['ed-ph--4x3', '4:3'],
                    ['ed-ph--1x1', '1:1'], ['ed-ph--3x4', '3:4']];
    const frame = selection.parentClasses?.some?.(c => c === 'ed-ph') ? null : null;
    const shapeRow = el('div', 'field');
    shapeRow.appendChild(el('label', null, 'Shape'));
    const seg = el('div', 'segRow');
    for (const [cls, name] of shapes) {
        const b = el('button');
        b.type = 'button';
        b.textContent = name;
        b.className = (selection.parentClasses || []).includes(cls) ? 'on' : '';
        b.onclick = () => {
            const keep = (selection.parentClasses || [])
                .filter(c => !/^ed-ph--/.test(c) && !c.startsWith('__ed'));
            pending.push({ kind: 'attr', path: selection.parentPath,
                           name: 'class', value: [...keep, cls].join(' ') });
            toFrame('setAttr', { path: selection.parentPath, name: 'class', value: [...keep, cls].join(' ') });
            updateDirty();
            renderInspector();
        };
        seg.appendChild(b);
    }
    shapeRow.appendChild(seg);
    if (selection.parentPath && (selection.parentClasses || []).includes('ed-ph')) g.appendChild(shapeRow);

    // 폴더에 뭐가 있는지는 입력칸에서 자동완성으로 — 격자로 다 늘어놓으면
    // 인스펙터가 미디어 고르는 창이 되어 버린다. 여기 주인공은 간격이다.
    const list = el('datalist');
    list.id = 'mp-files';
    g.appendChild(list);
    loadMediaFiles().then(items => {
        for (const it of items) {
            const o = el('option');
            o.value = it.url;
            list.appendChild(o);
        }
    });

    // 폴더 밖의 것 (유튜브 등) 은 주소로
    const row = el('div', 'field');
    row.appendChild(el('label', null, 'Link'));
    inp.placeholder = 'media/… or a YouTube link';
    inp.setAttribute('list', 'mp-files');
    inp.addEventListener('change', () => pick(embedUrl(inp.value.trim())));
    row.appendChild(inp);
    g.appendChild(row);

    // 파일을 여기로 끌어다 놓아도 된다 (파인더에서)
    g.addEventListener('dragover', ev => { ev.preventDefault(); g.classList.add('is-over'); });
    g.addEventListener('dragleave', () => g.classList.remove('is-over'));
    g.addEventListener('drop', ev => {
        ev.preventDefault();
        g.classList.remove('is-over');
        const f = ev.dataTransfer.files?.[0];
        if (f) { pick('media/' + f.name); toast(`media/ 폴더에 ${f.name} 이 있어야 보입니다`, 'warn'); }
    });
    return g;
}

// 화면에 보여 줄 값. 186.234px 같은 계산 결과는 디자이너가 읽을 숫자가 아니다.
function prettyValue(v) {
    return String(v ?? '').replace(/(-?\d+\.\d+)px/g, (m, n) => Math.round(parseFloat(n)) + 'px');
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
        return { label: 'style="" (this element)', selector: null, kind: 'inline' };
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
        return { label: `Not set yet → a new line will be added to ${target.selector}`, selector: target.selector, kind: 'insert' };
    }
    return { label: 'Computed default (no rule)', selector: null, kind: 'none' };
}

/** 고른 요소의 글자를 그 자리에서 고친다 (자식 태그가 없는 잎 요소만) */
function textRow() {
    const g = document.createElement('div');
    g.className = 'group';
    g.innerHTML = '<h3>Content</h3>';

    const area = document.createElement('textarea');
    area.className = 'text-edit';
    area.rows = 2;
    area.value = selection.fullText || '';
    area.placeholder = 'Text shown here';

    let timer = null;
    const push = () => {
        const value = area.value;
        // 같은 요소를 연달아 고치면 마지막 값만 남긴다 (한 글자마다 쌓이지 않게)
        const last = pending[pending.length - 1];
        if (last && last.kind === 'text' && String(last.path) === String(selection.path)) last.value = value;
        else pending.push({ kind: 'text', path: selection.path, value });
        updateDirty();
        toFrame('textPreview', { path: selection.path, value });
    };
    area.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(push, 250); });
    area.addEventListener('blur', () => { clearTimeout(timer); push(); });

    g.appendChild(area);
    return g;
}

/**
 * 글자 정렬 — 다른 속성들과 같은 '라벨 + 컨트롤' 한 줄로 둔다.
 * 묶음(Text) 안에서 또 제목을 세우면 층이 하나 더 생겨 읽기 어렵다.
 */
function choiceRow(prop, label, options) {
    const row = document.createElement('div');
    row.className = 'field';
    row.appendChild(Object.assign(document.createElement('label'), { textContent: label }));

    const seg = document.createElement('div');
    seg.className = 'segRow';
    const cur = currentValue(prop);
    for (const [value, text] of options) {
        const b = document.createElement('button');
        b.textContent = text;
        b.className = cur === value ? 'on' : '';
        b.onclick = () => stageEdit(prop, value);
        seg.appendChild(b);
    }
    row.appendChild(seg);
    return row;
}

const alignRow = () => choiceRow('text-align', 'Align',
    [['left', 'Left'], ['center', 'Center'], ['right', 'Right']]);

// ---------------------------------------------------------------- 토큰 목록 (인스펙터용)
// 기본은 '디자인 시스템 안에서만' 고르게 한다. 임의 값이 필요하면 'Custom' 버튼으로 잠금을 푼다.
let insTokens = null;                 // { colors:[{label,name}], fs:[...], space:[...] }
const freeMode = new Set();           // 직접 입력 잠금을 푼 속성들

async function loadInsTokens() {
    try {
        const d = await (await fetch('/__api/designsystem')).json();
        // 갈래를 살려 둔다 — 60개를 한 덩어리로 늘어놓으면 아무것도 못 고른다
        const colorGroups = [
            { title: 'Gray',          items: d.ramp.map(g => ({ label: 'Gray ' + g.step, name: g.name, hex: g.hex })) },
            { title: 'Primary',       items: d.primary.map(g => ({ label: 'Primary ' + g.step, name: g.name, hex: g.hex })) },
            { title: 'Secondary 1',   items: d.purpleRamp.map(g => ({ label: 'Secondary 1 · ' + g.step, name: g.name, hex: g.hex })) },
            { title: 'Secondary 2',   items: d.tealRamp.map(g => ({ label: 'Secondary 2 · ' + g.step, name: g.name, hex: g.hex })) },
            { title: 'Black & white', items: d.primitives.map(x => ({ label: x.label, name: x.name, hex: x.hex })) },
        ].filter(g => g.items.length);
        insTokens = {
            colorGroups,
            // 이름 찾기용 전체 목록 — 역할 토큰(--bg-color 등)은 고르는 목록에선 뺐지만
            // 지금 값이 그 토큰이면 이름으로 보여 줘야 한다
            colors: [
                ...colorGroups.flatMap(g => g.items),
                ...d.roles.map(r => ({ label: r.label, name: r.name, hex: r.hex || r.lightHex })),
                ...d.surfaces.map(x => ({ label: x.label, name: x.name, hex: x.hex })),
            ],
            fs: d.typo.map(t => ({ label: `${t.label} (${t.basePx}px)`, name: t.name })),
            space: d.spacing.map(s => ({ label: `Step ${s.step} (${s.basePx}px)`, name: s.name })),
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
    // 색은 이름만 늘어놓으면 무슨 색인지 알 수 없다 — 견본을 보고 고르게 한다
    if (/color$/.test(prop)) return colorRow(prop);
    const choices = tokenChoicesFor(prop);
    if (choices && !freeMode.has(prop)) return tokenFieldRow(prop, choices);
    return freeFieldRow(prop);
}

/** rgb(a) 문자열 → #RRGGBB (투명하면 null) */
function toHex(v) {
    const m = String(v).match(/rgba?\(([^)]+)\)/);
    if (!m) return /^#[0-9a-f]{3,8}$/i.test(String(v).trim()) ? String(v).trim().toUpperCase() : null;
    const n = m[1].split(',').map(x => parseFloat(x));
    if (n.length > 3 && n[3] === 0) return null;                 // 완전 투명
    return '#' + n.slice(0, 3).map(x => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * 색 고르기 — 견본을 눌러 팔레트를 펴고, 거기서 고른다.
 * 디자인 시스템에 있는 색이면 그 이름을, 아니면 헥스코드를 보여준다.
 */
function colorRow(prop) {
    const wrap = document.createElement('div');
    const row = document.createElement('div');
    row.className = 'field';

    const label = document.createElement('label');
    label.textContent = LABEL[prop] || prop;
    row.appendChild(label);

    const cur = currentValue(prop);
    const curVar = (cur.match(/var\(\s*(--[\w-]+)\s*\)/) || [])[1] || null;
    const choices = tokenChoicesFor(prop) || [];
    const hit = curVar ? choices.find(c => c.name === curVar) : null;
    const hex = toHex(selection.computed?.[prop] || cur);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-btn' + (pendingFor(prop) ? ' changed' : '');
    btn.innerHTML =
        `<span class="color-chip" style="background:${hex || 'transparent'}"></span>` +
        `<span class="color-name">${hit ? hit.label : (hex || 'transparent')}</span>`;
    row.appendChild(btn);
    wrap.appendChild(row);

    // 팔레트 — 견본 격자. 토큰이면 이름이 함께 뜬다.
    const pop = document.createElement('div');
    pop.className = 'color-pop';
    pop.hidden = true;
    pop.appendChild(swatchGroups(
        c => stageEdit(prop, `var(${c.name})`),
        c => !!hit && hit.name === c.name,
    ));

    pop.appendChild(pickerBlock(hex, v => stageEdit(prop, v)));
    wrap.appendChild(pop);

    btn.addEventListener('click', () => openPopBeside(btn, pop));
    return wrap;
}

/** 토큰 중에서만 고르는 줄 */
function tokenFieldRow(prop, choices) {
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
        o.value = ''; o.textContent = prettyValue(cur) || '—';
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
    free.textContent = 'Other…';
    free.title = 'Use a value that is not in your design system';
    free.addEventListener('click', () => {
        if (!confirm('This value is outside your design system.\nIt will not follow when you change the system later.\nContinue?')) return;
        freeMode.add(prop);
        renderInspector();
    });
    row.appendChild(free);

    return row;
}

/**
 * 값 한 걸음의 크기. 무엇을 다루는 값인지에 따라 다르다 —
 * 투명도를 1씩 움직이면 0 아니면 1, 두 가지밖에 안 나온다.
 */
function scrubStep(prop, unit) {
    if (prop === 'opacity') return 0.01;
    if (!unit && (prop === 'line-height' || prop === 'flex-grow' || prop === 'flex-shrink')) return 0.01;
    if (unit === 'rem' || unit === 'em') return 0.01;
    if (unit === '%') return 0.5;
    return 1;
}

/**
 * 값 칸을 세로로 끌어 조절할 수 있게 한다.
 * 움직이지 않고 떼면 평범한 클릭이라 그대로 글자를 고칠 수 있다.
 */
function scrubInput(input, prop, commit) {
    input.classList.add('is-scrub');
    let armed = false, moved = false, fromY = 0, base = 0, unit = '', acc = 0;

    const onMove = ev => {
        if (!armed) return;
        const dy = fromY - ev.clientY;                       // 위로 끌면 커진다
        if (!moved) {
            if (Math.abs(dy) < 3) return;                     // 손떨림은 클릭으로 둔다
            moved = true;
            input.blur();
            document.body.classList.add('is-dragging-num');
        }
        ev.preventDefault();
        if (prop === 'font-weight') {
            // 굵기는 100 단위 사다리라 픽셀을 모아 한 칸씩 옮긴다
            const want = Math.trunc(dy / 8);
            while (acc < want) { input.value = stepFontWeight(input.value, 1); acc++; }
            while (acc > want) { input.value = stepFontWeight(input.value, -1); acc--; }
        } else {
            const step = scrubStep(prop, unit) * (ev.shiftKey ? 10 : 1);
            let next = base + dy * step;
            if (prop === 'opacity') next = Math.min(1, Math.max(0, next));
            input.value = +next.toFixed(3) + unit;
        }
        commit();
    };
    const onUp = () => {
        armed = false; moved = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('is-dragging-num');
    };
    input.addEventListener('mousedown', ev => {
        if (ev.button !== 0) return;
        const m = String(input.value).match(/^\s*(-?[\d.]+)\s*(px|rem|em|%|vw|vh)?\s*$/);
        if (!m && prop !== 'font-weight') return;             // calc(...) 같은 건 끌 수 없다
        armed = true; moved = false; acc = 0;
        fromY = ev.clientY;
        base = m ? parseFloat(m[1]) : 0;
        unit = m ? (m[2] || '') : '';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
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
    input.value = prettyValue(currentValue(prop));

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
            // 걸음은 값의 성격을 따른다 — 투명도를 1씩 올리면 0 아니면 1 밖에 안 나온다
            const unit = m[2] || '';
            const base = (prop === 'opacity') ? 0.05
                : (!unit && prop === 'line-height') ? 0.1
                    : (unit === 'rem' || unit === 'em') ? 0.1 : 1;
            const step = e.shiftKey ? base * 10 : base;
            let next = parseFloat(m[1]) + dir * step;
            if (prop === 'opacity') next = Math.min(1, Math.max(0, next));
            input.value = +next.toFixed(3) + unit;
        }
        stageEdit(prop, input.value);
    });
    row.appendChild(input);

    // 화살표 버튼 대신 칸을 그대로 끌어서 조절한다 (프레이머·피그마와 같은 방식)
    scrubInput(input, prop, () => stageEdit(prop, input.value));

    // 'Custom'으로 풀었던 속성은 다시 토큰 선택으로 돌아갈 수 있게
    if (freeMode.has(prop)) {
        const back = document.createElement('button');
        back.className = 'btn ghost tiny freeBtn';
        back.textContent = 'System';
        back.title = 'Go back to your design system values';
        back.addEventListener('click', () => { freeMode.delete(prop); renderInspector(); });
        row.appendChild(back);
    }

    return row;
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
            toast('This one can only be changed on its own.', 'err');
            setMode('inline');
            return stageEdit(prop, value);
        }
        if (!quietEdits) {
            if (org.media) toast('This value only applies at this screen size.');
        }
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
    // 구조를 바꾼 편집(넣기·옮기기·지우기·복제·파일 연결)은 순서대로 다시 튼다
    const steps = pending.filter(p => ['insert', 'move', 'remove', 'duplicate', 'link', 'text'].includes(p.kind));
    if (steps.length) toFrame('replay', { steps });
}

/** 미리보기를 처음부터 다시 그린 뒤, 저장 대기 중인 편집을 재생한다 */
function reloadPreview() {
    const f = $('#frame');
    if (!f) return;
    needsCenter = false;          // 보던 위치를 유지한다
    f.src = f.src;                // ready 가 다시 오고 applyPendingPreview 가 불린다
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
    // 편집이 늘었다면 되돌린 갈래는 더 이상 이어붙일 수 없다
    if (pending.length > lastPendingLen) redoStack = [];
    lastPendingLen = pending.length;
    const rb = $('#redoBtn'); if (rb) rb.disabled = !redoStack.length;
    const n = pending.reduce((s, p) => s + (p.kind === 'inline' ? Object.keys(p.changes).length : 1), 0);
    $('#dirty').hidden = n === 0;
    $('#dirtyCount').textContent = n;
    const dot = $('#crumbDot'); if (dot) dot.hidden = n === 0;   // 파일명 옆 '수정됨' 점
    $('#saveBtn').disabled = n === 0;
    $('#revertBtn').disabled = n === 0;
}

// ---------------------------------------------------------------- 저장 / 되돌리기
/**
 * 되돌리기 — Ctrl+Z 처럼 '마지막 한 걸음'만 취소한다.
 * 예전엔 전부 비우고 새로고침해서, 한 글자 고친 걸 취소하려다 작업을 통째로 잃었다.
 */
// 되돌린 편집을 쌓아 두는 곳 — 다시실행이 여기서 꺼내 쓴다.
// 새로 편집하면 갈래가 갈리므로 비운다 (흔한 되돌리기 규칙).
let redoStack = [];
let lastPendingLen = 0;

function updateHistoryButtons() {
    const r = $('#redoBtn'); if (r) r.disabled = !redoStack.length;
}

function redoLast() {
    if (!redoStack.length) return;
    pending.push(redoStack.pop());
    updateDirty();
    updateHistoryButtons();
    reloadPreview();              // 화면을 새로 그리고 전부 재생
    toast('Redone', 'ok');
}

function undoLast() {
    if (!pending.length) return;
    const last = pending[pending.length - 1];

    // 인라인 편집은 한 요소에 여러 속성이 쌓이므로, 그 중 마지막 속성만 뺀다
    if (last.kind === 'inline') {
        const keys = Object.keys(last.changes);
        const k = keys[keys.length - 1];
        delete last.changes[k];
        toFrame('clearPreview', { path: last.path, props: [k] });
        if (!Object.keys(last.changes).length) pending.pop();
        redoStack.push({ ...last, changes: { ...last.changes } });
    } else {
        redoStack.push(pending.pop());
        // 구조를 바꾼 편집은 거꾸로 되짚기보다 화면을 새로 그리고 남은 것만 재생하는 편이 정확하다
        if (['insert', 'motion', 'move', 'remove', 'duplicate', 'link', 'text'].includes(last.kind)) {
            updateDirty();
            updateHistoryButtons();
            reloadPreview();
            toast(pending.length ? 'Undid one step' : 'Undid everything', 'ok');
            return;
        }
    }

    updateDirty();
    updateHistoryButtons();
    applyPendingPreview();       // 남은 변경은 그대로 유지
    if (!selection) renderInspector();   // 페이지 설정의 값도 되돌린 값으로
    toast(pending.length ? 'Undid one step' : 'Undid everything', 'ok');
}
$('#revertBtn').addEventListener('click', undoLast);
$('#redoBtn')?.addEventListener('click', redoLast);
$('#reloadBtn')?.addEventListener('click', () => { reloadPreview(); toast('Preview redrawn', 'ok'); });

// Ctrl/Cmd + Z 로도 되돌리기
document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;   // 입력 중엔 기본 동작
    e.preventDefault();
    if (e.shiftKey) redoLast(); else undoLast();   // Shift 를 같이 누르면 다시 실행
});

// Ctrl/Cmd + D 로 복제
document.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey) || e.key !== 'd') return;   // Ctrl+D 복제
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    e.preventDefault();
    blockAction('duplicate');
});

$('#saveBtn').addEventListener('click', async () => {
    if (!pending.length) return;
    $('#saveBtn').disabled = true;
    $('#saveBtn').classList.add('is-saving');   // 아이콘 버튼이라 글자를 덮어쓰면 안 된다
    try {
        const res = await fetch('/__api/patch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: currentPage,
                edits: pending.map(p => {
                    if (p.kind === 'css') return { kind: 'css', selector: p.selector, prop: p.prop, value: p.value };
                    if (p.kind === 'insert') return { kind: 'insert', path: p.path, html: p.html, position: p.position };
                    if (p.kind === 'move') return { kind: 'move', path: p.path, dir: p.dir };
                    if (p.kind === 'text') return { kind: 'text', path: p.path, value: p.value };
                    if (p.kind === 'link') return { kind: 'link', assetKind: p.assetKind, url: p.url };
                    if (p.kind === 'remove') return { kind: 'remove', path: p.path };
                    if (p.kind === 'duplicate') return { kind: 'duplicate', path: p.path };
                    if (p.kind === 'attr') return { kind: 'attr', path: p.path, name: p.name, value: p.value };
                    if (p.kind === 'motion') return { kind: 'motion', path: p.path, className: p.className, css: p.css };
                    return { kind: 'inline', path: p.path, changes: p.changes };
                })
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        toast(`Saved — ${data.applied.length} change(s)`, 'ok');
        pending = [];
        updateDirty();
        needsCenter = true;
        frame.src = frame.src;      // 저장된 실제 파일을 다시 읽어온다
    } catch (err) {
        toast('Save failed: ' + err.message, 'err');
    } finally {
        $('#saveBtn').classList.remove('is-saving');
        updateDirty();
    }
});

// ---------------------------------------------------------------- 알림
let toastTimer;
/** 미리보기가 떠 준 덩어리를 이름 붙여 등록한다 */
async function onGrabbed(p) {
    if (!p || p.error) { toast(p?.error || 'Could not read the selection', 'warn'); return; }
    const guess = (p.className || '').split(/\s+/)[0] || p.tag;
    const name = prompt('Component name (same name overwrites)', guess);
    if (name === null) return;
    if (!name.trim()) { toast('A name is required', 'warn'); return; }

    // 마스터로 두면 스타일이 blocks/ 에 파일로 나가고, 페이지에는 링크만 걸린다.
    // 여러 페이지에서 같은 블록을 쓸 때 고칠 곳이 한 군데로 모인다.
    const master = confirm(
        `Make "${name.trim()}" a master block?\n\n` +
        `[OK]     Saved as a file in blocks/ — every page uses that same file.\n` +
        `            Edit it later and every page that uses it follows.\n\n` +
        `[Cancel] Plain component — its styles are copied into each page you drop it on.`
    );
    let slug = '', js = '';
    if (master) {
        slug = (prompt('Block file name (lowercase, digits, hyphen)',
            name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'block') || '').trim();
        if (!slug) return;
        js = (prompt(
            '이 블록에 필요한 JS 가 있으면 붙여 넣으세요.\n' +
            '(scroll effects, autoplay, and so on. Leave empty if none)', '') || '').trim();
    }
    try {
        const res = await fetch('/__api/components', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name.trim(), html: p.html, sketch: p.sketch, needs: p.needs,
                css: p.css, vars: p.vars, master, slug, js,
                note: p.text ? `"${p.text}"` : '', from: currentPage,
            }),
        });
        const out = await res.json();
        if (!res.ok) { toast(out.error || 'Could not save', 'warn'); return; }
        savedComps = out.items || [];
        loadComponentPatterns();
        selectTab('components');
        const saved = out.items.find(c => c.name === name.trim());
        const where = saved?.block
            ? ` · written to blocks/${saved.block.slug}.css${saved.block.js ? ' + .js' : ''}`
            : (p.cssCount ? ` · with ${p.cssCount} style rules` : '');
        toast((out.replaced ? `"${out.saved}" overwritten` : `"${out.saved}" saved`) + where, 'ok');
    } catch (e) { toast('Could not save: ' + e.message, 'warn'); }
}

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

    // 편집 전용인 것만 DS 모드에서 숨긴다: 중앙 뷰포트 제어와 우측 액션(되돌리기·저장).
    // 브랜드·경로(좌)와 모드 스위처(우)는 두 모드 공통이라 그대로 둔다.
    // ※ .bar-right 를 통째로 숨기면 모드 스위처까지 사라져 편집으로 돌아올 수 없다.
    document.querySelector('.bar-center').hidden = ds;
    document.getElementById('barActions').hidden = ds;
    leftPanel.hidden = ds;          // 디자인 시스템 모드에선 라이브러리 패널을 숨긴다

    document.querySelector('.layout').style.display = ds ? 'none' : '';
    document.getElementById('dsView').style.display = ds ? 'flex' : 'none';

    if (ds) {
        // 서버가 tokens.css 를 파싱해서 준다 (미리보기 iframe 과 무관)
        fetchDesignSystem();
    }
}

// ---------------------------------------------------------------- 좌측 컴포넌트 패널
const leftPanel = $('#leftPanel');
const TAB_TITLE = { components: 'Components', motion: 'Interactions' };
let activeTab = 'components';

function selectTab(name) {
    // 같은 탭을 다시 누르면 접었다 폈다
    if (name === activeTab && !leftPanel.classList.contains('is-closed')) {
        leftPanel.classList.add('is-closed');
        return;
    }
    activeTab = name;
    leftPanel.classList.remove('is-closed');
    document.querySelectorAll('.rail-btn').forEach(b => {
        const on = b.dataset.tab === name;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.lp-pane').forEach(p => { p.hidden = p.dataset.pane !== name; });
    const t = $('#lpTitle'); if (t) t.textContent = TAB_TITLE[name] || name;
}
document.querySelectorAll('.rail-btn').forEach(b =>
    b.addEventListener('click', () => selectTab(b.dataset.tab)));

// 컴포넌트 = vibra 에서 실제로 쓰는 구조. 텍스트 블록 + 레이아웃 패턴.
// 컴포넌트 = vibra 에서 실제로 쓰는 구조 그대로.
// 쓰지 않는 모양을 만들어 두면 넣어 봐야 사이트와 안 맞아 결국 지우게 된다.
// 링크가 비어 있어도 '자리'가 보이도록 감싼다 (빈 <img> 는 높이가 0 이라 화면에서 사라진다).
// .ed-ph 는 링크를 채우면 저절로 티가 안 나는 얇은 점선 자리표시다.
const MEDIA_HTML = {
    image:
`<div class="ed-ph ed-ph--4x3">
    <img src="" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:16px;">
</div>`,
    video:
`<div class="ed-ph ed-ph--16x9">
    <iframe src="" title="video" allow="autoplay; fullscreen" allowfullscreen style="width:100%;height:100%;border:0;display:block;border-radius:16px;"></iframe>
</div>`,
};
/** 넣고 나서 링크를 채워야 하는 것들 */
const NEEDS_LINK = new Set(Object.keys(MEDIA_HTML));

const COMPONENT_GROUPS = [
    {
        label: 'TEXT', items: [
            { key: 'sechead',   name: 'Section header',     desc: 'Label · title · text',    thumb: 'sechead' },
            { key: 'titledesc', name: 'Title + text',   desc: 'Subtitle + body',        thumb: 'titledesc' },
            { key: 'grouphead', name: 'Group header',     desc: 'A · Key Features',     thumb: 'grouphead' },
        ],
    },
    {
        label: 'MEDIA', items: [
            { key: 'image',   name: 'Image',   desc: 'Photo or GIF',    thumb: 'mImage' },
            { key: 'video',   name: 'Video',   desc: 'Paste a link',    thumb: 'mVideo' },
        ],
    },
    {
        label: 'LAYOUT', items: [
            { key: 'projectinfo', name: 'Project info', desc: 'Key–value table',        thumb: 'projectinfo' },
            { key: 'credits',     name: 'Credit logos',   desc: 'Produced with · logos', thumb: 'credits' },
            { key: 'mediadesc',   name: 'Image + text', desc: 'Large image, text below', thumb: 'mediadesc' },
            { key: 'carousel',    name: 'Media carousel', desc: 'Horizontal scroll cards',      thumb: 'row' },
            { key: 'cols3',       name: '3-column cards',      desc: 'Equal 3-column grid',       thumb: 'cols3' },
            { key: 'grid22',      name: 'Interaction grid', desc: '4-column cards',           thumb: 'grid' },
        ],
    },
];

// 개수가 유동적인 것만 드롭할 때 정한다 (카드에서 −/+ 로 조절)
const COMPONENT_COUNT = { carousel: 3, projectinfo: 4 };
const compCount = { ...COMPONENT_COUNT };

// 각 컴포넌트가 실제로 넣는 HTML — vibra 의 기존 클래스를 그대로 쓴다.
//
// 폭은 .vb-wrap(max-width: 1280px × --vb-s)이 정한다. vibra 의 블록은 전부 이 안에 있어서,
// 래퍼 없이 넣으면 .vb-wrap 밖에 떨어졌을 때 뷰포트 폭까지 퍼져 실제보다 크게 나온다
// (노트북 1536px 기준 1024px → 1536px, 1.5 배). 그래서 스스로 .vb-wrap 을 두른다.
// 이미 .vb-wrap 안에 떨어져 중첩되어도 max-width 가 같아 크기는 달라지지 않는다.
// 예외: .vb-carousel-block 은 자체 max-width(1120px × --vb-s)가 있어 두르지 않는다.
const COMPONENT_HTML = {
    // 섹션 머리 — 라벨·제목·설명. 게시물마다 반복해서 쓰는 기본 묶음이다.
    sechead:
`<div class="vb-wrap">
    <div class="bg-head">
        <span class="vb-eyebrow reveal">Label</span>
        <h2 class="vb-title reveal">제목을 여기에 씁니다</h2>
        <p class="bg-desc reveal">설명 문장을 여기에 씁니다.<br>줄을 나누고 싶으면 br 로 끊습니다.</p>
    </div>
</div>`,
    titledesc:
`<div class="vb-wrap">
    <div class="reveal">
        <h3 class="vb-subtitle">소제목</h3>
        <p class="vb-body">본문 설명을 여기에 씁니다.</p>
    </div>
</div>`,
    grouphead:
`<div class="vb-wrap">
    <div class="vb-group__head vb-group__head--lead reveal">
        <span class="vb-group__num">A</span>
        <span class="vb-group__name">Group Name</span>
    </div>
</div>`,

    // 프로젝트 정보 — 항목/값이 좌우로 갈리는 표. 행 수는 드롭할 때 정한다.
    // 프로젝트 정보 — 항목/값 표 + 접었다 펴는 역할별 기여도.
    // 드롭할 때 창이 떠서 항목과 역할을 직접 적는다 (rows·roles 로 넘어온다).
    projectinfo: (n = 4, opt = {}) => {
        const rows = opt.rows && opt.rows.length ? opt.rows : [
            ['Type', 'Team Project'],
            ['Duration', '2024.03 – 2024.11'],
            ['Members', '2'],
            ['Contribution', '70%'],
        ].slice(0, n);
        const roles = opt.roles || [];
        // 같은 페이지에 두 번 넣어도 서로 간섭하지 않게 매번 새 이름을 만든다
        // (id 가 겹치면 getElementById 가 늘 첫 번째만 찾아 두 번째 화살표가 먹지 않는다)
        const rid = 'roles-' + Math.random().toString(36).slice(2, 7);

        const roleBars = roles.map(([name, pct]) => `                                    <div class="vb-role">
                                        <div class="vb-role__head"><span class="vb-role__name">${name}</span><span class="vb-role__pct">${pct}%</span></div>
                                        <div class="vb-bar"><div class="vb-bar__fill" data-pct="${pct}"></div></div>
                                    </div>`).join('\n');

        const body = rows.map(([k, v], i) => {
            // 역할을 적었다면 마지막 행에 펼침 버튼을 붙인다
            const withToggle = roles.length && i === rows.length - 1;
            return `        <div class="vb-meta__row">
            <span class="vb-meta__key">${k}</span>
            <span class="vb-meta__val">${v}${withToggle ? `
                <button type="button" class="vb-toggle-btn hover-trigger"
                        aria-expanded="false" aria-controls="${rid}" aria-label="역할별 기여도 보기">
                    <span class="vb-toggle__icon" aria-hidden="true">▾</span>
                </button>` : ''}</span>
        </div>`;
        }).join('\n');

        return `<div class="vb-wrap">
<div class="vb-info-col reveal">
    <span class="vb-info-label">Project Info</span>
    <div class="vb-meta">
${body}
${roles.length ? `
        <div class="vb-roles-wrap" id="${rid}" role="region" aria-label="역할별 기여도">
            <div class="vb-roles-inner">
                <div class="vb-roles">
${roleBars}
                </div>
            </div>
        </div>` : ''}
    </div>
</div>
</div>`;
    },

    // 크레딧 — 로고는 '높이 64px · 폭은 이미지'라 비어 있으면 폭이 0 이 된다 → 자리표시로 비율을 준다
    credits:
`<div class="vb-wrap">
<div class="vb-credits reveal">
    <div class="vb-credit">
        <div class="vb-credit__label">Produced with</div>
        <div class="vb-logos">
            <span class="vb-logo ed-ph ed-ph--logo"><img src="" alt=""></span>
            <span class="vb-logo ed-ph ed-ph--logo"><img src="" alt=""></span>
        </div>
    </div>
    <div class="vb-credit">
        <div class="vb-credit__label">Featured by</div>
        <div class="vb-logos">
            <span class="vb-logo ed-ph ed-ph--logo"><img src="" alt=""></span>
        </div>
    </div>
</div>
</div>`,

    // 큰 이미지 한 장 + 그 아래 가운데 정렬 설명
    mediadesc:
`<div class="vb-wrap">
    <div class="ai-sec__below-media reveal ed-ph ed-ph--16x9"><img src="" alt="" loading="lazy"></div>
    <p class="ai-sec__below-desc reveal">이미지에 대한 설명을 여기에 씁니다.</p>
</div>`,

    // 캐러셀 — vibra 실제 구조: .vb-carousel-block(가운데 정렬) > .vb-carousel > __track
    // 미디어는 '높이는 CSS · 폭은 이미지'라 빈 이미지면 찌그러진다 → 자리표시에 비율을 준다.
    // vibra 실제 미디어가 3840×2160(16:9)이라, 높이 clamp 에 이 비율을 곱한 폭이 나온다.
    carousel: (n = 3) => {
        // 화살표가 트랙을 id 로 찾으므로 겹치지 않는 이름을 만든다
        const id = 'carousel-' + Math.random().toString(36).slice(2, 7);
        return `<div class="vb-carousel-block reveal">
    <div class="vb-group__head vb-group__head--lead" style="margin-top:0;">
        <span class="vb-group__num">A</span>
        <span class="vb-group__name">Key Features</span>
    </div>
    <div class="vb-carousel">
        <div class="vb-carousel__track" id="${id}">
${Array.from({ length: n }, (_, i) => `            <div class="vb-carousel__item">
                <div class="vb-carousel__media ed-ph ed-ph--16x9"><img src="" alt=""></div>
                <p class="vb-carousel__caption"><span class="vb-carousel__num">${i + 1}.</span><strong>제목</strong><br>설명을 여기에 씁니다.</p>
            </div>`).join('\n')}
        </div>
    </div>
    <div class="vb-carousel-nav">
        <button type="button" class="vb-carousel-nav__arrow" data-carousel-prev="${id}" aria-label="이전"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M18 18L9.5 12L18 6V18ZM8 6V18H6V6H8Z"/></svg></button>
        <button type="button" class="vb-carousel-nav__arrow" data-carousel-next="${id}" aria-label="다음"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M6 18L14.5 12L6 6V18ZM16 6V18H18V6H16Z"/></svg></button>
    </div>
</div>`;
    },
    // 3단 카드 — vibra 의 .sky-features (미디어 + 번호 캡션). 이름 그대로 3장 고정.
    cols3:
`<div class="vb-wrap">
<div class="sky-features">
${Array.from({ length: 3 }, (_, i) => `    <div class="sky-feature reveal">
        <div class="sky-feature__media ed-ph"><img src="" alt=""></div>
        <p class="sky-feature__caption"><span class="sky-feature__num">${i + 1}.</span>항목 이름</p>
    </div>`).join('\n')}
</div>
</div>`,
    // ig-card 의 이미지는 height:auto 라 비어 있으면 높이가 0 → 자리표시로 비율을 준다.
    // vibra 실제 미디어는 1080×1440 세로(3:4) 라서 16:9 를 쓰면 높이가 2 배 넘게 어긋난다.
    grid22:
`<div class="vb-wrap">
<div class="ig-grid">
${Array.from({ length: 4 }, (_, i) => `    <div class="ig-card reveal">
        <div class="ig-card__media ed-ph ed-ph--3x4"><img src="" alt=""></div>
        <p class="ig-card__cap"><span class="ig-card__num">${i + 1}.</span>항목</p>
    </div>`).join('\n')}
</div>
</div>`,
};
// 자리표시 스타일 — 삽입할 때 페이지에 한 번만 넣는다
const MEDIA_PH_CSS =
`/* 크기·모서리는 :where() 로 우선순위를 0 으로 둬서 원래 클래스가 이기게 한다.
   (.ig-card__media 8px, .vb-carousel__media 20px 같은 vibra 본래 값이 유지된다) */
:where(.ed-ph){width:100%;border-radius:16px}
:where(.ed-ph--16x9){aspect-ratio:16/9}
:where(.ed-ph--3x4){aspect-ratio:3/4}
:where(.ed-ph--4x3){aspect-ratio:4/3}
:where(.ed-ph--1x1){aspect-ratio:1}
/* 로고는 '높이 고정 · 폭 자동'이라 빈 이미지면 폭이 0 이 된다 */
:where(.ed-ph--logo){display:inline-block;width:120px;aspect-ratio:2/1}
/* 테두리는 outline — border 와 달리 박스 크기를 키우지 않는다 */
.ed-ph{position:relative;background:rgba(127,127,140,.08);overflow:hidden;outline:1px dashed rgba(127,127,140,.45);outline-offset:-1px}
.ed-ph::before{content:'+';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:200;line-height:1;color:rgba(127,127,140,.55);transform:translateY(-13px);pointer-events:none}
.ed-ph::after{content:'Drop a file here, or click to choose';position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center;padding-bottom:calc(50% - 34px);font-size:12px;color:rgba(127,127,140,.9);pointer-events:none}
.ed-ph--logo::before{font-size:20px;transform:translateY(-7px)}
.ed-ph--logo::after{font-size:10px;content:'Logo';padding-bottom:calc(50% - 20px)}
/* 링크가 채워지면 안내도 사라진다 */
.ed-ph:has(img[src]:not([src=""]))::after,.ed-ph:has(video[src]:not([src=""]))::after,.ed-ph:has(iframe[src]:not([src=""]))::after,
.ed-ph:has(img[src]:not([src=""]))::before,.ed-ph:has(video[src]:not([src=""]))::before,.ed-ph:has(iframe[src]:not([src=""]))::before{display:none}
.ed-ph:has(img[src]:not([src=""])),.ed-ph:has(video[src]:not([src=""])),.ed-ph:has(iframe[src]:not([src=""])){background:none;outline:none}
/* 링크가 비어 있는 동안은 이미지가 자리를 차지하지 않게 (0px 찌그러짐 방지) */
.ed-ph > img[src=""],.ed-ph > video:not([src]),.ed-ph > img:not([src]){position:absolute;inset:0;width:100%;height:100%}
`;

// 카드 썸네일 — 실제 배치를 네모로 옮겨 그린다 (140×54 기준)
const PATTERN_THUMB = {
    sechead:     '<rect x="52" y="10" width="36" height="4" rx="2" fill="currentColor" opacity=".45"/><rect x="30" y="21" width="80" height="9" rx="3" fill="currentColor" opacity=".6"/><rect x="26" y="36" width="88" height="4" rx="2" fill="currentColor" opacity=".25"/><rect x="40" y="44" width="60" height="4" rx="2" fill="currentColor" opacity=".25"/>',
    titledesc:   '<rect x="24" y="15" width="54" height="7" rx="3" fill="currentColor" opacity=".55"/><rect x="24" y="28" width="92" height="4" rx="2" fill="currentColor" opacity=".28"/><rect x="24" y="36" width="72" height="4" rx="2" fill="currentColor" opacity=".28"/>',
    grouphead:   '<circle cx="28" cy="27" r="8" fill="#3B82F6" opacity=".75"/><rect x="44" y="23" width="60" height="7" rx="3" fill="currentColor" opacity=".5"/>',
    projectinfo: '<rect x="26" y="8" width="34" height="4" rx="2" fill="currentColor" opacity=".4"/>' + [18, 28, 38, 48].map(y => `<rect x="26" y="${y}" width="26" height="4" rx="2" fill="currentColor" opacity=".3"/><rect x="86" y="${y}" width="28" height="4" rx="2" fill="currentColor" opacity=".55"/>`).join(''),
    credits:     '<rect x="26" y="10" width="30" height="4" rx="2" fill="currentColor" opacity=".4"/><rect x="26" y="20" width="26" height="14" rx="3" fill="currentColor" opacity=".3"/><rect x="58" y="20" width="26" height="14" rx="3" fill="currentColor" opacity=".3"/><rect x="26" y="42" width="30" height="4" rx="2" fill="currentColor" opacity=".4"/>',
    mediadesc:   '<rect x="20" y="8" width="100" height="30" rx="4" fill="currentColor" opacity=".32"/><rect x="38" y="44" width="64" height="4" rx="2" fill="currentColor" opacity=".28"/>',
    row:         '<rect x="18" y="14" width="42" height="26" rx="4" fill="currentColor" opacity=".35"/><rect x="66" y="14" width="42" height="26" rx="4" fill="currentColor" opacity=".28"/><rect x="114" y="14" width="20" height="26" rx="4" fill="currentColor" opacity=".18"/>',
    cols3:       '<rect x="16" y="14" width="32" height="26" rx="4" fill="currentColor" opacity=".32"/><rect x="54" y="14" width="32" height="26" rx="4" fill="currentColor" opacity=".32"/><rect x="92" y="14" width="32" height="26" rx="4" fill="currentColor" opacity=".32"/>',
    grid:        '<rect x="22" y="10" width="44" height="15" rx="3" fill="currentColor" opacity=".35"/><rect x="74" y="10" width="44" height="15" rx="3" fill="currentColor" opacity=".28"/><rect x="22" y="30" width="44" height="15" rx="3" fill="currentColor" opacity=".28"/><rect x="74" y="30" width="44" height="15" rx="3" fill="currentColor" opacity=".35"/>',
    // 미디어는 '자리'가 아니라 '무엇'을 고르는 것이라 꽉 찬 아이콘으로 그린다.
    // 안쪽 모양은 evenodd 로 뚫어 낸다 — 획을 쓰지 않아 크기가 변해도 두께가 안 흔들린다.
    mImage:
        '<path fill="currentColor" opacity=".38" fill-rule="evenodd" d="'
        + 'M56.5 15h27a3.5 3.5 0 0 1 3.5 3.5v17a3.5 3.5 0 0 1-3.5 3.5h-27a3.5 3.5 0 0 1-3.5-3.5v-17a3.5 3.5 0 0 1 3.5-3.5Z'
        + 'M60 19a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z'
        + 'M55.5 35.5 64 26.5l5.5 5.5 5-4 10 7.5Z" />',
    mVideo:
        '<path fill="currentColor" opacity=".38" fill-rule="evenodd" d="'
        + 'M56.5 15h27a3.5 3.5 0 0 1 3.5 3.5v17a3.5 3.5 0 0 1-3.5 3.5h-27a3.5 3.5 0 0 1-3.5-3.5v-17a3.5 3.5 0 0 1 3.5-3.5Z'
        + 'M65.5 21v12l10-6Z" />',
    // 인터랙션 — '가만히 있을 때' 를 옅게, '움직인 뒤' 를 진하게 겹쳐 그린다.
    // 한 장으로 움직임을 보이려면 전후를 같이 놓는 수밖에 없다 (프레이머·피그마도 같은 방식).
    xLift:
        // 원래 자리(옅음) 위로 떠오른 카드(진함) + 아래 그림자
        '<rect x="48" y="20" width="44" height="22" rx="4" fill="currentColor" opacity=".12"/>'
        + '<rect x="48" y="9" width="44" height="22" rx="4" fill="currentColor" opacity=".4"/>'
        + '<ellipse cx="70" cy="46" rx="19" ry="2.5" fill="currentColor" opacity=".16"/>',
    xGrow:
        // 작은 원래 크기(옅음) 에서 바깥으로 커진 카드(진함)
        '<rect x="56" y="17" width="28" height="20" rx="3" fill="currentColor" opacity=".14"/>'
        + '<rect x="44" y="10" width="52" height="34" rx="5" fill="currentColor" opacity=".38"/>',
    xPulse:
        // 원래 크기(옅은 테두리) 안으로 눌려 들어간 카드(진함)
        '<rect x="42" y="8" width="56" height="38" rx="5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 3" opacity=".28"/>'
        + '<rect x="48" y="12" width="44" height="30" rx="4" fill="currentColor" opacity=".38"/>'
        // 안쪽을 향한 표시 — 눌리는 방향
        + '<path d="M52 18 L56 22 M88 18 L84 22 M52 36 L56 32 M88 36 L84 32" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none" opacity=".5"/>',
    xFade:
        // 아래에서 올라오며 또렷해진다 — 지나온 자리를 옅게 남긴다
        '<rect x="50" y="36" width="40" height="10" rx="3" fill="currentColor" opacity=".1"/>'
        + '<rect x="50" y="24" width="40" height="10" rx="3" fill="currentColor" opacity=".22"/>'
        + '<rect x="50" y="12" width="40" height="10" rx="3" fill="currentColor" opacity=".45"/>'
        + '<path d="M70 8 L74 12 H66 Z" fill="currentColor" opacity=".5"/>',
};

// 자리표시 스타일 — 삽입할 때 페이지에 한 번만 넣는다

// ── 인터랙션: 요소에 끌어다 놓으면 클래스 + CSS 규칙이 붙는다 ──
const MOTION_ITEMS = [
    { key: 'hover-lift',  name: 'Lift on hover', desc: 'Rises slightly + shadow', thumb: 'xLift' },
    { key: 'hover-grow',  name: 'Grow on hover',   desc: 'Scales to 1.04',        thumb: 'xGrow' },
    { key: 'click-pulse', name: 'Press on click',   desc: 'Sinks in, springs back',    thumb: 'xPulse' },
    { key: 'fade-up',     name: 'Reveal on scroll',    desc: 'Rises from below',    thumb: 'xFade' },
];
// class 는 요소에 붙이고, css 는 페이지 <style> 에 한 번만 넣는다.
const MOTION_DEFS = {
    'hover-lift': {
        className: 'ed-hover-lift',
        css: `.ed-hover-lift{transition:transform .32s cubic-bezier(.2,.7,.3,1),box-shadow .32s ease}
.ed-hover-lift:hover{transform:translateY(-8px);box-shadow:0 16px 34px rgba(0,0,0,.10)}
@media (hover:none){.ed-hover-lift:hover{transform:none}}`,
    },
    'hover-grow': {
        className: 'ed-hover-grow',
        css: `.ed-hover-grow{transition:transform .3s cubic-bezier(.2,.7,.3,1)}
.ed-hover-grow:hover{transform:scale(1.04)}
@media (hover:none){.ed-hover-grow:hover{transform:none}}`,
    },
    'click-pulse': {
        className: 'ed-click-pulse',
        css: `.ed-click-pulse{transition:transform .18s ease}
.ed-click-pulse:active{transform:scale(.96)}
.ed-click-pulse:focus-visible{outline:2px solid var(--accent-color);outline-offset:3px}`,
    },
    'fade-up': {
        className: 'reveal',
        css: '',      // vibra 가 이미 .reveal 을 처리한다
    },
};

function loadSimpleList(hostId, items, dragType) {
    const host = $('#' + hostId);
    if (!host) return;
    host.innerHTML = '';
    for (const it of items) {
        const card = el('div', 'lp-card'); card.draggable = true;
        card.innerHTML =
            `<div class="lp-card__thumb"><svg viewBox="0 0 140 54" width="100%" height="54" aria-hidden="true">${PATTERN_THUMB[it.thumb] || ''}</svg></div>` +
            `<div class="lp-card__name">${it.name}</div>` +
            `<div class="lp-card__use">${it.desc}</div>`;
        card.addEventListener('dragstart', ev => {
            ev.dataTransfer.effectAllowed = 'copy';
            ev.dataTransfer.setData(dragType, it.key);
            ev.dataTransfer.setData('text/plain', it.key);
        });
        host.appendChild(card);
    }
}

// 유저가 등록한 컴포넌트 — 서버(components.json)에 쌓이고 페이지끼리 함께 쓴다
let savedComps = [];
let picks = null;               // Shift 로 여러 개 골랐을 때 { count, items, gaps }
let editingText = false;        // 미리보기에서 글자를 고치는 중인지
let emptyShown = false;         // '페이지 설정'이 이미 떠 있는지 (예외 목록을 한 번만 부르려고)
let pageTokens = null;          // 페이지 전체를 정하는 토큰들 { raw, now }
let pageBg = null;              // 배경을 실제로 칠하는 쪽 { selector, color, hasImage }
let pageClassSet = new Set();   // 지금 열린 페이지의 CSS 가 아는 클래스
let pageVarSet = new Set();     // 지금 열린 페이지가 정의한 CSS 변수(디자인 토큰)
let mainPath = null;            // 미리보기에서 최상위 블록을 담는 그릇(<main>)의 경로

/** 최상위 블록의 부모 경로 — 끌어서 옮길 때 자리 번호에 이 경로를 붙여 쓴다 */
function framePathOfMain() { return mainPath || []; }

/** 이 컴포넌트가 기대는데 지금 페이지엔 없는 클래스 (모양이 깨질 신호) */
function missingClasses(item) {
    if (!pageClassSet.size || !Array.isArray(item.needs)) return [];
    return item.needs.filter(c => !pageClassSet.has(c));
}

/** 뼈대 스케치를 카드 썸네일 SVG 로 (등록할 때 실제 비율을 떠 둔 것) */
function sketchSvg(sk) {
    if (!Array.isArray(sk) || !sk.length) {
        return '<rect x="20" y="16" width="100" height="8" rx="3" fill="currentColor" opacity=".35"/>' +
               '<rect x="20" y="30" width="72" height="8" rx="3" fill="currentColor" opacity=".2"/>';
    }
    return sk.map(r =>
        `<rect x="${r.x}" y="${r.y}" width="${Math.max(r.w, 2)}" height="${Math.max(r.h, 2)}" rx="2" fill="currentColor" opacity=".3"/>`
    ).join('');
}

async function loadSavedComponents() {
    try {
        const res = await fetch('/__api/components');
        savedComps = (await res.json()).items || [];
    } catch { savedComps = []; }
    loadComponentPatterns();
}

function loadComponentPatterns() {
    const host = $('#lpCards');
    if (!host) return;
    host.innerHTML = '';

    // 내가 등록한 것을 맨 위에 — 가장 자주 쓰게 되는 자산이다
    if (savedComps.length) {
        host.appendChild(el('div', 'lp-group-sub', 'My components'));
        for (const it of savedComps) {
            const card = el('div', 'lp-card'); card.draggable = true;
            card.dataset.saved = it.id;
            card.innerHTML =
                `<div class="lp-card__thumb"><svg viewBox="0 0 140 54" width="100%" height="54" aria-hidden="true">${sketchSvg(it.sketch)}</svg></div>` +
                `<div class="lp-card__name">${escapeHtml(it.name)}</div>` +
                `<div class="lp-card__use">${escapeHtml(it.note || it.from || 'Saved by you')}</div>` +
                `<button class="lp-card__del" title="Remove">×</button>`;
            card.addEventListener('dragstart', ev => {
                ev.dataTransfer.effectAllowed = 'copy';
                ev.dataTransfer.setData('text/x-hnkl-saved', it.id);
                ev.dataTransfer.setData('text/plain', it.name);
            });
            card.querySelector('.lp-card__del').addEventListener('click', async ev => {
                ev.stopPropagation();
                if (!confirm(`Remove "${it.name}" from the library?\n(Anything already placed on a page stays)`)) return;
                await fetch('/__api/components', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ remove: it.id }),
                });
                toast('Removed', 'ok');
                loadSavedComponents();
            });
            host.appendChild(card);
        }
    }

    for (const g of COMPONENT_GROUPS) {
        host.appendChild(el('div', 'lp-group-sub', g.label));
        for (const it of g.items) {
            const card = el('div', 'lp-card'); card.draggable = true;
            card.dataset.comp = it.key;
            card.innerHTML =
                `<div class="lp-card__thumb"><svg viewBox="0 0 140 54" width="100%" height="54" aria-hidden="true">${PATTERN_THUMB[it.thumb] || ''}</svg></div>` +
                `<div class="lp-card__name">${it.name}</div>` +
                `<div class="lp-card__use">${it.desc}</div>`;
            card.addEventListener('dragstart', ev => {
                ev.dataTransfer.effectAllowed = 'copy';
                ev.dataTransfer.setData('text/x-hnkl-component', it.key);
                ev.dataTransfer.setData('text/plain', it.key);
            });
            host.appendChild(card);
        }
    }
    applyCardOrder(host);
    enableCardReorder(host);
    enableCardFold(host);
}
loadComponentPatterns();
loadSavedComponents();
loadSimpleList('lpMotion', MOTION_ITEMS, 'text/x-hnkl-motion');

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
/** 사용자가 지은 이름을 카드에 넣을 때 — 이름에 <, & 가 있어도 깨지지 않게 */
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function currentScale() {
    const w = bp.w;
    return w < 1024 ? 1 : Math.min(1, Math.max(0.8, 0.5 + w / 5120));
}
const round1 = n => Math.round(n * 10) / 10;
const varName = name => Object.assign(el('span', 'ds-var'), { textContent: name });

// --panel 은 역할 토큰(gray-10 / dark gray-90)이라 팔레트에 따로 두지 않는다.
const PALETTE_SKIP = new Set(['--panel']);

let dsData = null;
let dsEdits = {};
let dsBaseHex = {}, dsDarkHex = {}, dsBasePx = {}, dsBaseLink = {}, dsBaseDarkLink = {};
let dsPalette = [];

// 역할 목록: 2층 토큰 전부. --panel 도 이제 역할(라이트 gray-100 / 다크 dark-800)이라 포함한다.
const ROLE_SKIP = new Set();

// 팔레트 그룹 (표시용 — tokens.css 는 그대로)
//   흰색 & 검정 / 회색 램프(단일) / Primary(10) / Secondary 퍼플·틸(각 5)
let dsGroups = { whites: [], ramp: [], primary: [], purple: [], teal: [] };

function buildDsBase(d) {
    dsBaseHex = {}; dsDarkHex = {}; dsBasePx = {}; dsBaseLink = {}; dsBaseDarkLink = {}; dsPalette = [];
    dsGroups = { whites: [], ramp: [], primary: [], purple: [], teal: [] };
    const add = (group, name, label, hex, darkHex) => {
        if (PALETTE_SKIP.has(name)) return;
        dsBaseHex[name] = hex;
        if (darkHex) dsDarkHex[name] = darkHex;
        dsPalette.push({ name, label });
        group.push({ name, label });
    };

    const byName = n => d.surfaces.find(s => s.name === n);

    // ① 흰색 & 검정 — 1층 원시값(--white / --black)을 그대로 노출한다.
    const whitePrim = d.primitives.find(p => p.name === '--white');
    if (whitePrim) add(dsGroups.whites, whitePrim.name, whitePrim.label, whitePrim.hex, null);
    const blackPrim = d.primitives.find(p => p.name === '--black');
    if (blackPrim) add(dsGroups.whites, blackPrim.name, blackPrim.label, blackPrim.hex, null);

    // ② 회색 램프 (단일 팔레트)
    for (const g of d.ramp) add(dsGroups.ramp, g.name, 'Gray ' + g.step, g.hex, g.darkHex);

    // ③ 포인트(Primary) · 서브(Secondary 퍼플·틸)
    for (const g of d.primary)    add(dsGroups.primary, g.name, 'Primary ' + g.step, g.hex, null);
    for (const g of d.purpleRamp) add(dsGroups.purple,  g.name, 'Purple ' + g.step, g.hex, null);
    for (const g of d.tealRamp)   add(dsGroups.teal,    g.name, 'Teal ' + g.step, g.hex, null);

    const panel = byName('--panel');
    if (panel) { dsBaseHex[panel.name] = panel.hex; if (panel.darkHex) dsDarkHex[panel.name] = panel.darkHex; }

    for (const r of d.roles) {
        if (r.darkHex) dsDarkHex[r.name] = r.darkHex;
        if (ROLE_SKIP.has(r.name)) continue;
        if (r.linked) dsBaseLink[r.name] = r.linked;
        if (r.darkLinked) dsBaseDarkLink[r.name] = r.darkLinked;   // .dark-mode 에 있는 역할만
    }
    for (const t of d.typo) dsBasePx[t.name] = t.basePx;
}
const effHex = n => (n in dsEdits && n in dsBaseHex) ? dsEdits[n] : dsBaseHex[n];
const effLink = r => (r in dsEdits) ? dsEdits[r] : dsBaseLink[r];
const effPx = n => (n in dsEdits && n in dsBasePx) ? +dsEdits[n] : dsBasePx[n];
const roleHex = r => effHex(effLink(r));

// 역할의 다크 매핑은 라이트와 별개로 고른다. 편집 키는 '<역할>|dark'.
const DK = '|dark';
const darkKey = r => r + DK;
const isDarkKey = k => k.endsWith(DK);
const roleOfDark = k => k.slice(0, -DK.length);
// 다크 오버라이드가 아직 없으면 라이트 링크를 따라간다(현재 CSS 동작과 동일).
const darkBaseLink = r => (r in dsBaseDarkLink) ? dsBaseDarkLink[r] : dsBaseLink[r];
const effDarkLink = r => (darkKey(r) in dsEdits) ? dsEdits[darkKey(r)] : darkBaseLink(r);
const roleDark = r => effHex(effDarkLink(r));

function isChanged(n) {
    if (!(n in dsEdits)) return false;
    if (isDarkKey(n)) return dsEdits[n] !== darkBaseLink(roleOfDark(n));
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
    canvas.innerHTML = '<div class="ds-loading">Reading design tokens…</div>';
    try {
        const res = await fetch('/__api/designsystem');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        dsData = await res.json();
        dsEdits = {};
        buildDsBase(dsData);
        renderDesignSystem(dsData);
    } catch (e) {
        canvas.innerHTML = '<div class="ds-loading">Could not load: ' + e.message + '</div>';
    }
}
function applyEdit(name, value) { dsEdits[name] = value; refresh(); }

function renderDesignSystem(d) {
    const canvas = document.getElementById('dsCanvas');
    canvas.innerHTML = '';
    const inner = el('div', 'ds-inner');
    inner.append(sectionPalette(d), sectionRoles(d), sectionFont(d), sectionTypo(d));
    canvas.appendChild(inner);
    refresh();
}
function dsSection(title, desc) {
    const s = el('section', 'ds3-section');
    s.appendChild(el('h2', 'ds3-title', title));
    if (desc) s.appendChild(el('p', 'ds3-desc', desc));
    return s;
}

// ── 칩 카드 (원래 카드형: 색 면 + 이름 + 헥스) ──
function chipCard(name, label) {
    const card = el('div', 'ds3-chip');
    card.dataset.cell = name;
    // 색 면 — 누르면 우리 고르개가 열린다 (브라우저 기본 창은 결이 완전히 다르다)
    const inp = el('button', 'ds3-chip-color');
    inp.type = 'button';
    inp.dataset.chip = name;
    inp.title = label;
    const meta = el('div', 'ds3-chip-meta');
    meta.append(el('div', 'ds3-chip-name', label), dEl('div', 'ds3-chip-hex', 'hex', name));
    card.append(inp, meta);

    const pop = el('div', 'color-pop');
    pop.hidden = true;
    pop.appendChild(pickerBlock(effHex(name) || '#808080', v => {
        applyEdit(name, v.toUpperCase());
        inp.style.background = v;
    }));
    card.appendChild(pop);
    inp.addEventListener('click', () => openPopBeside(inp, pop));
    const chg = el('span', 'ds3-chg'); chg.dataset.chg = name; card.appendChild(chg);
    return card;
}
function chipRow(items) {
    const row = el('div', 'ds3-chips');
    for (const it of items) row.appendChild(chipCard(it.name, it.label));
    return row;
}

// ① 팔레트
function sectionPalette(d) {
    const s = dsSection('Palette');

    s.appendChild(el('h3', 'ds3-sub', 'White & Black'));
    s.appendChild(chipRow(dsGroups.whites));

    s.appendChild(el('h3', 'ds3-sub', 'Gray'));
    s.appendChild(chipRow(dsGroups.ramp));

    s.appendChild(el('h3', 'ds3-sub', 'Primary'));
    s.appendChild(chipRow(dsGroups.primary));

    s.appendChild(el('h3', 'ds3-sub', 'Secondary · Purple'));
    s.appendChild(chipRow(dsGroups.purple));

    s.appendChild(el('h3', 'ds3-sub', 'Secondary · Teal'));
    s.appendChild(chipRow(dsGroups.teal));
    return s;
}

// ② 역할 — 역할마다 카드. 이름 아래 라이트·다크 버튼을 나란히. 버튼 = 스와치 + 색상 이름.
function sectionRoles(d) {
    const s = dsSection('Roles');
    // 라이트 한 벌, 다크 한 벌을 좌우로 나란히. 같은 역할이 가로로 마주 보게 둔다.
    const split = el('div', 'ds3-split');
    for (const m of ['light', 'dark']) {
        const isLight = m === 'light';
        const col = el('div', 'ds3-col');
        col.appendChild(el('div', 'ds3-sub', isLight ? 'LIGHT' : 'DARK'));

        for (const r of d.roles) {
            if (ROLE_SKIP.has(r.name) || !dsBaseLink[r.name]) continue;
            const key = isLight ? r.name : darkKey(r.name);

            // 이름 한 칸, 고르는 칸 한 칸 — 인스펙터의 값 줄과 같은 짜임
            const row = el('div', 'ds3-role');
            row.dataset.role = r.name;
            row.appendChild(el('div', 'ds3-role-name', r.label));

            const btn = el('div', 'ds3-mode-btn');
            btn.appendChild(dEl('span', 'ds3-mode-swatch', isLight ? 'rolechip' : 'rolechipdark', r.name));
            const sel = el('select', 'ds3-select');
            for (const o of dsPalette) {
                const opt = el('option'); opt.value = o.name; opt.textContent = o.label;
                sel.appendChild(opt);
            }
            sel.value = isLight ? effLink(r.name) : effDarkLink(r.name);
            sel.addEventListener('change', () => applyEdit(key, sel.value));
            btn.appendChild(sel);
            row.appendChild(btn);

            const chg = el('span', 'ds3-chg'); chg.dataset.chg = key; row.appendChild(chg);
            col.appendChild(row);
        }
        split.appendChild(col);
    }
    s.appendChild(split);
    return s;
}

// ③ 타이포
// 큰 묶음 구분선을 넣을 위치 (제목군 → 본문군)
const TYPO_GROUP_BREAK = new Set(['--fs-body']);

const WEIGHT_NAME = {
    100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium',
    600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black',
};

function sectionFont(d) {
    const s = dsSection('Font');
    if (!d.fontFamily) return s;

    const name = el('div', 'ds3-fontname', d.fontFamily);
    name.style.fontFamily = `'${d.fontFamily}', sans-serif`;
    s.appendChild(name);

    // 실제로 쓰이는 굵기만. 토큰에 있어도 아무 데도 안 쓰면 보여 줄 이유가 없다.
    const used = (d.weightTokens || []).filter(w => w.inCode > 0)
        .sort((a, b) => a.value - b.value);
    if (!used.length) return s;

    const grid = el('div', 'ds3-fontgrid');
    for (const w of used) {
        const card = el('div', 'ds3-fontcard');
        card.style.fontFamily = `'${d.fontFamily}', sans-serif`;

        card.appendChild(el('div', 'ds3-fontcap',
            `${w.value} ${WEIGHT_NAME[w.value] || ''}`.trim()));

        const aa = el('div', 'ds3-fontaa', 'Aa');
        aa.style.fontWeight = w.value;
        card.appendChild(aa);

        const sample = el('div', 'ds3-fontsample');
        sample.style.fontWeight = w.value;
        sample.innerHTML = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>abcdefghijklmnopqrstuvwxyz<br>가나다라마바사아자차카타파하<br>1234567890 !@#$%^&*()';
        card.appendChild(sample);

        grid.appendChild(card);
    }
    s.appendChild(grid);
    return s;
}

/**
 * 이 크기가 대략 어디에 쓰이고 있는지 — 붙어 있는 선택자 이름에서 성격을 읽는다.
 * .vb-closing__title 같은 이름을 그대로 보여 주는 대신 '제목' 이라고 부른다.
 */
const USE_KIND = [
    [/(^|[-_.])(h[1-6]|title|heading|headline|display)([-_]|$)/i, 'Titles'],
    [/(quote|lead)/i, 'Quotes'],
    [/(num|val|count|stat)/i, 'Numbers'],
    [/(label|eyebrow|chip|pill|tag|badge|cap$|caption)/i, 'Labels'],
    [/(sub|desc|note|hint|meta)/i, 'Sub text'],
    [/(body|text|para|^p$)/i, 'Body text'],
    [/(btn|button|link|nav|menu)/i, 'Buttons'],
];
function usageOf(selectors) {
    const hits = new Map();
    for (const sel of selectors) {
        for (const [re, name] of USE_KIND) {
            if (re.test(sel)) { hits.set(name, (hits.get(name) || 0) + 1); break; }
        }
    }
    const top = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
    if (!top.length) return `${selectors.length} place${selectors.length > 1 ? 's' : ''}`;
    return top.join(' · ');
}

function sectionTypo(d) {
    const s = dsSection('Type');

    const table = el('div', 'ds3-typo');
    const head = el('div', 'ds3-typo-row is-head');
    for (const h of ['Category', 'Size', 'Weight', 'Usage']) head.appendChild(el('div', 'ds3-th', h));
    table.appendChild(head);

    // 아직 아무 데도 안 쓰는 크기는, 눈금 안에서의 자리로 쓸 곳을 짐작해 적는다
    const sizes = d.typo.map(t => t.basePx).sort((a, b) => b - a);
    const guessUse = px => {
        const at = sizes.indexOf(px) / Math.max(1, sizes.length - 1);
        return at < .25 ? 'Titles' : at < .5 ? 'Sub titles'
            : at < .75 ? 'Body text' : 'Sub text · Labels';
    };

    for (const t of d.typo) {
        const row = el('div', 'ds3-typo-row');
        row.dataset.typo = t.name;
        if (TYPO_GROUP_BREAK.has(t.name)) row.classList.add('is-groupstart');

        // ① 카테고리 이름 — 그 이름 자체를 정의된 크기로 렌더
        const nameCell = el('div', 'ds3-tc');
        const nameSample = dEl('div', 'ds3-catname', 'sample', t.name);
        nameSample.textContent = t.label;
        nameCell.appendChild(nameSample);
        nameCell.appendChild(varName(t.name));
        const chg = el('span', 'ds3-chg'); chg.dataset.chg = t.name; nameCell.appendChild(chg);

        // ② 크기 — 정의된 px 숫자만
        const sizeCell = el('div', 'ds3-tc');
        sizeCell.appendChild(dEl('span', 'ds3-numbox', 'numbox', t.name));

        // ③ 굵기 — 쓰이는 굵기를 세로로 나열 / ④ 용도 — 각 굵기가 붙은 요소
        const wCell = el('div', 'ds3-tc');
        const useCell = el('div', 'ds3-tc');
        if (t.weightRows.length) {
            for (const r of t.weightRows) {
                const w = el('div', 'ds3-wline', String(r.weight));
                w.style.fontWeight = r.weight;
                wCell.appendChild(w);
                const line = el('div', 'ds3-useline', r.selectors.length ? usageOf(r.selectors) : '—');
                if (r.selectors.length) line.title = r.selectors.join(', ');
                useCell.appendChild(line);
            }
        } else {
            wCell.appendChild(el('div', 'ds3-wline is-none', '400'));
            useCell.appendChild(el('div', 'ds3-useline is-none', guessUse(t.basePx)));
        }

        row.append(nameCell, sizeCell, wCell, useCell);
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
    const SAMPLE = 'The quick brown fox';
    const q = s => document.querySelectorAll(s);

    // 색 면은 이제 버튼이다 — value 가 아니라 배경으로 칠한다
    q('[data-chip]').forEach(i => { const h = effHex(i.dataset.chip); if (h) i.style.background = h; });
    q('[data-hex]').forEach(e => e.textContent = effHex(e.dataset.hex) || '');

    q('[data-rolechip]').forEach(e => e.style.background = roleHex(e.dataset.rolechip) || 'transparent');
    q('[data-rolechipdark]').forEach(e => e.style.background = roleDark(e.dataset.rolechipdark) || 'transparent');

    // 카테고리 이름을 '정의된 크기 그대로' 보여준다 (화면 배율 계산은 표시하지 않음)
    q('[data-sample]').forEach(e => {
        const n = e.dataset.sample, px = effPx(n);
        const t = dsData.typo.find(x => x.name === n);
        if (px != null) e.style.fontSize = px + 'px';
        e.style.fontWeight = t?.defaultWeight || 400;
    });
    q('[data-numbox]').forEach(box => {
        if (box.querySelector('input')) return;      // 편집 중이면 건드리지 않는다
        box.innerHTML = `<b>${effPx(box.dataset.numbox)}</b>`;
    });

    const labelOf = link => dsPalette.find(p => p.name === link)?.label || link;
    q('[data-chg]').forEach(b => {
        const n = b.dataset.chg;
        if (isChanged(n)) {
            const orig = isDarkKey(n) ? labelOf(darkBaseLink(roleOfDark(n)))
                : n in dsBaseHex ? dsBaseHex[n]
                    : n in dsBaseLink ? labelOf(dsBaseLink[n])
                        : dsBasePx[n] + 'px';
            b.textContent = 'changed · was ' + orig;
            b.hidden = false;
        } else { b.hidden = true; b.textContent = ''; }
    });
    q('[data-cell]').forEach(c => c.classList.toggle('is-changed', isChanged(c.dataset.cell)));
    q('[data-role]').forEach(c => c.classList.toggle('is-changed', isChanged(c.dataset.role) || isChanged(darkKey(c.dataset.role))));
    q('[data-typo]').forEach(c => c.classList.toggle('is-changed', isChanged(c.dataset.typo)));

    updateDsToolbar();
    pushTokenPreview();
}

function editAsDecl(name) {
    if (isDarkKey(name)) return 'var(' + effDarkLink(roleOfDark(name)) + ')';
    if (name in dsBaseHex) return effHex(name);
    if (name in dsBaseLink) return 'var(' + effLink(name) + ')';
    if (name in dsBasePx) return `calc(${effPx(name)}px * var(--s))`;
    return null;
}
function pushTokenPreview() {
    const names = changedNames();
    const root = names.filter(n => !isDarkKey(n)).map(n => `  ${n}: ${editAsDecl(n)};`).join('\n');
    const dark = names.filter(isDarkKey).map(n => `  ${roleOfDark(n)}: ${editAsDecl(n)};`).join('\n');
    let css = '';
    if (root) css += `:root{\n${root}\n}`;
    if (dark) css += (css ? '\n' : '') + `.dark-mode{\n${dark}\n}`;
    toFrame('tokenPreview', { css });
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
        const isDk = isDarkKey(n);
        const label = isDk ? roleOfDark(n) + ' · dark' : n;
        const before = isDk ? `var(${darkBaseLink(roleOfDark(n))})`
            : n in dsBaseHex ? dsBaseHex[n]
                : n in dsBaseLink ? `var(${dsBaseLink[n]})`
                    : `calc(${dsBasePx[n]}px * var(--s))`;
        const row = el('div', 'ds-confirm-row');
        row.append(
            Object.assign(el('span', 'ds-confirm-name'), { textContent: label }),
            Object.assign(el('span', 'ds-confirm-before'), { textContent: before }),
            Object.assign(el('span', 'ds-confirm-arrow'), { textContent: '→' }),
            Object.assign(el('span', 'ds-confirm-after'), { textContent: editAsDecl(n) }),
        );
        list.appendChild(row);
    }
    $('#dsConfirm').hidden = false;
}
async function dsSaveCommit() {
    const edits = {}, darkEdits = {};
    for (const n of changedNames()) {
        if (isDarkKey(n)) darkEdits[roleOfDark(n)] = editAsDecl(n);
        else edits[n] = editAsDecl(n);
    }
    $('#dsConfirmOk').disabled = true;
    try {
        const res = await fetch('/__api/savetokens', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ edits, darkEdits }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        $('#dsConfirm').hidden = true;
        toast(`Saved — ${data.applied.length} change(s) · backup ${data.backup}`, 'ok');
        await fetchDesignSystem();
    } catch (e) {
        toast('Save failed: ' + e.message, 'err');
    } finally { $('#dsConfirmOk').disabled = false; }
}

$('#dsRevert')?.addEventListener('click', dsRevert);
$('#dsSave')?.addEventListener('click', dsSaveConfirm);
$('#dsConfirmCancel')?.addEventListener('click', () => { $('#dsConfirm').hidden = true; });
$('#dsConfirmOk')?.addEventListener('click', dsSaveCommit);

// ---------------------------------------------------------------- 칩 모양 조절 인스펙터





// ---------------------------------------------------------------- 시작
updateBpRes();
applyStage();
loadPages();
// 인스펙터가 '토큰 중에서만' 고르게 하려면 토큰 목록이 먼저 필요하다.
loadInsTokens().then(() => { if (selection) renderInspector(); });

// ---------------------------------------------------------------- 토글 알약
/**
 * 고른 쪽을 따라 미끄러지는 알약.
 * works 페이지의 dock-pill 과 같은 움직임 — GSAP 의 elastic.out(1, 0.4) 을
 * CSS linear() 로 옮겨 놓았다 (app.css 의 --spring).
 */
function slidingPill(group) {
    if (!group || group.querySelector(':scope > .tg-pill')) return;
    group.classList.add('has-pill');
    const pill = document.createElement('span');
    pill.className = 'tg-pill';
    group.prepend(pill);

    let first = true;
    const move = () => {
        const on = group.querySelector(':scope > .on');
        if (!on) { pill.style.opacity = '0'; return; }
        // 처음 자리를 잡을 때는 미끄러지지 않게 (화면이 뜨자마자 튀어나온다)
        if (first) pill.style.transition = 'none';
        pill.style.opacity = '1';
        pill.style.left = on.offsetLeft + 'px';
        pill.style.top = on.offsetTop + 'px';
        pill.style.width = on.offsetWidth + 'px';
        pill.style.height = on.offsetHeight + 'px';
        if (first) { requestAnimationFrame(() => { pill.style.transition = ''; }); first = false; }
    };

    // .on 은 여기저기서 붙였다 뗐다 한다 (클릭·단축키·프로그램). 속성을 지켜보는 편이 확실하다.
    new MutationObserver(move).observe(group, { attributes: true, attributeFilter: ['class'], subtree: true });
    window.addEventListener('resize', move);
    requestAnimationFrame(move);
}

for (const sel of ['.mode-switch', '.canvas-tools']) {
    document.querySelectorAll(sel).forEach(slidingPill);
}

// ---------------------------------------------------------------- 카드 순서
var CARD_ORDER_KEY = 'hnkl.cardOrder';

function savedCardOrder() {
    try { return JSON.parse(localStorage.getItem(CARD_ORDER_KEY)) || null; } catch { return null; }
}

/**
 * 카드와 갈래 제목(TEXT·MEDIA·LAYOUT)이 한 부모를 공유한다.
 * 그래서 순서는 '갈래별로' 기억해야 한다 — 통째로 이어 붙이면 제목이 전부 위로 밀린다.
 * 갈래를 옮긴 카드도 이 방식이면 저절로 새 갈래에 적힌다 (DOM 을 다시 읽어 담으므로).
 */
function groupOf(card) {
    for (let n = card.previousElementSibling; n; n = n.previousElementSibling) {
        if (n.classList.contains('lp-group-sub')) return n.textContent.trim();
    }
    return '';
}
/** 자리만 바뀌는 일이라 '저장' 을 따로 누르게 하지 않는다 */
function rememberCardOrder(host) {
    const byGroup = {};
    for (const c of host.querySelectorAll('.lp-card')) {
        if (!c.dataset.comp) continue;
        (byGroup[groupOf(c)] ||= []).push(c.dataset.comp);
    }
    try { localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(byGroup)); } catch { /* 저장 못 해도 지금 화면은 그대로 */ }
}
/** 지난번에 옮겨 둔 순서대로 다시 늘어놓는다 (갈래 안에서만) */
function applyCardOrder(host) {
    const saved = savedCardOrder();
    if (!saved || Array.isArray(saved)) return;      // 예전에 통째로 저장해 둔 것은 버린다
    const cards = new Map([...host.querySelectorAll('.lp-card')].map(c => [c.dataset.comp, c]));
    for (const label of host.querySelectorAll('.lp-group-sub')) {
        const order = saved[label.textContent.trim()];
        if (!order?.length) continue;
        let at = label;                              // 제목 바로 뒤부터 차례로 꽂는다
        for (const key of order) {
            const c = cards.get(key);
            if (!c) continue;
            at.after(c);
            at = c;
        }
    }
}

/** 목록 안에서 끌면 순서 바꾸기, 페이지로 끌면 넣기 — 둘을 가른다 */
function enableCardReorder(host) {
    if (!host || host.dataset.reorder) return;
    host.dataset.reorder = '1';
    let dragging = null;

    host.addEventListener('dragstart', ev => {
        dragging = ev.target.closest('.lp-card');
        if (dragging) dragging.classList.add('is-dragging');
    });
    host.addEventListener('dragend', () => {
        if (!dragging) return;
        dragging.classList.remove('is-dragging');
        dragging = null;
    });

    host.addEventListener('dragover', ev => {
        if (!dragging) return;                       // 바깥에서 온 것은 상관하지 않는다
        ev.preventDefault();
        // 갈래 제목 위로 끌면 그 갈래의 맨 앞으로 (빈 갈래로도 옮길 수 있게)
        const label = ev.target.closest('.lp-group-sub');
        if (label) { label.after(dragging); return; }

        const over = ev.target.closest('.lp-card');
        if (!over || over === dragging) return;
        const r = over.getBoundingClientRect();
        if (ev.clientY > r.top + r.height / 2) over.after(dragging);
        else over.before(dragging);
    });
    host.addEventListener('drop', ev => {
        if (!dragging) return;
        ev.preventDefault();
        ev.stopPropagation();                        // 미리보기에 넣지 않는다
        rememberCardOrder(host);
    });
}

// ---------------------------------------------------------------- 갈래 접기
var CARD_FOLD_KEY = 'hnkl.cardFold';

function foldedGroups() {
    try { return new Set(JSON.parse(localStorage.getItem(CARD_FOLD_KEY)) || []); } catch { return new Set(); }
}
/** 갈래 제목을 눌러 접었다 편다 — 카드가 열한 장이라 다 펴 두면 스크롤이 길다 */
function enableCardFold(host) {
    const folded = foldedGroups();

    const paint = label => {
        const on = folded.has(label.textContent.trim());
        label.classList.toggle('is-folded', on);
        // 제목과 제목 사이가 한 갈래다 (감싸는 상자가 없다)
        for (let n = label.nextElementSibling; n && !n.classList.contains('lp-group-sub'); n = n.nextElementSibling) {
            n.hidden = on;
        }
    };

    for (const label of host.querySelectorAll('.lp-group-sub')) {
        label.tabIndex = 0;
        paint(label);
        label.onclick = () => {
            const key = label.textContent.trim();
            folded.has(key) ? folded.delete(key) : folded.add(key);
            try { localStorage.setItem(CARD_FOLD_KEY, JSON.stringify([...folded])); } catch { /* 지금 화면은 그대로 */ }
            paint(label);
        };
        label.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); label.click(); } };
    }
}
