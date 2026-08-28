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
        toFrame('setPicking', pickOn);
        toFrame('setMoving', tool === 'move');
        applyPendingPreview();
    }
    else if (msg.type === 'blockDone') {
        const p = msg.payload || {};
        if (p.error) { toast(p.error, 'warn'); return; }
        pending.push({ kind: p.act === 'remove' ? 'remove' : 'duplicate', path: p.path });
        updateDirty();
        if (p.act === 'remove') { selection = null; renderInspector(); }
        toast(p.act === 'remove' ? '지웠습니다 — 저장해야 파일에 반영됩니다'
                                 : '하나 더 만들었습니다 — 저장해야 파일에 반영됩니다', 'ok');
    }
    else if (msg.type === 'grabbed') {
        onGrabbed(msg.payload);
    }
    else if (msg.type === 'moved') {
        // 미리보기에서는 이미 옮겨졌다. 파일에 반영할 내용만 쌓아 둔다.
        // 경로는 '옮기기 전' 기준이고 서버가 순서대로 적용하므로, 여러 번 눌러도 어긋나지 않는다.
        pending.push({ kind: 'move', path: msg.payload.path, dir: msg.payload.dir });
        updateDirty();
        toast('섹션을 옮겼습니다 — 저장해야 파일에 반영됩니다', 'ok');
    }
    else if (msg.type === 'selected' || msg.type === 'previewApplied') {
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
    else if (msg.type === 'scrollToY') {
        // 미리보기 안 좌표 → 캔버스 이동 (화면 가운데에 오도록)
        const stageEl = document.getElementById('stage');
        const target = msg.payload.y * zoom;
        canvasY = -(target - stageEl.clientHeight / 2 + (msg.payload.h * zoom) / 2);
        applyStage();
    }
});

// 라이브러리에서 미리보기로 떨어뜨렸을 때: 화면에 바로 넣고, 저장 대기열에 쌓는다.
function onComponentDropped({ key, kind, path, position }) {
    // ① 인터랙션 — 그 요소에 클래스를 붙이고, 필요한 CSS 를 페이지에 넣는다
    if (kind === 'motion') {
        const def = MOTION_DEFS[key];
        if (!def) return;
        pending.push({ kind: 'motion', path, className: def.className, css: def.css });
        toFrame('motionPreview', { path, className: def.className, css: def.css });
        updateDirty();
        toast(`인터랙션 적용 — ${def.className}`, 'ok');
        return;
    }
    // ② 내가 등록한 컴포넌트 — 저장해 둔 HTML 을 그대로 넣는다
    if (kind === 'saved') {
        const it = savedComps.find(c => c.id === key);
        if (!it) return;
        const missing = missingClasses(it);

        // 이 페이지에 없는 클래스가 있으면, 등록할 때 같이 떠 둔 스타일을 함께 넣는다.
        // (이미 있는 페이지에는 넣지 않는다 — 같은 규칙을 두 벌 만들면 나중 것이 이기며 헷갈린다)
        if (missing.length && it.css) {
            pending.push({ kind: 'motion', path, className: '', css: it.css });
            toFrame('motionPreview', { path, className: '', css: it.css });
        }
        pending.push({ kind: 'insert', path, html: it.html, position });
        toFrame('insertPreview', { path, html: it.html, position });
        updateDirty();

        const missingVars = (it.vars || []).filter(v => !pageVarSet.has(v));
        if (missing.length && it.css) {
            toast(missingVars.length
                ? `${it.name} — 스타일도 함께 넣었습니다. 다만 토큰 ${missingVars.length}개가 이 페이지에 없습니다 (${missingVars.slice(0, 3).join(', ')}…)`
                : `${it.name} — 이 페이지에 없던 스타일도 함께 넣었습니다`,
                missingVars.length ? 'warn' : 'ok');
        } else if (missing.length) {
            toast(`${it.name} — 없는 클래스 ${missing.length}개인데 저장된 스타일이 없습니다 (다시 등록하면 함께 저장됩니다)`, 'warn');
        } else {
            toast(`${it.name} 을(를) 넣었습니다 — 저장해야 파일에 반영됩니다`, 'ok');
        }
        return;
    }
    // ③ 미디어 / 기본 컴포넌트 — HTML 조각을 삽입
    let src = kind === 'media' ? MEDIA_HTML[key] : COMPONENT_HTML[key];
    if (!src) return;
    // 개수를 고를 수 있는 컴포넌트는 카드에서 고른 값을 쓴다 (카드 안 −/+ 로 조절)
    const n = (typeof src === 'function')
        ? (compCount[key] || COMPONENT_COUNT[key] || 3)
        : 0;
    const html = (typeof src === 'function') ? src(n) : src;
    // 자리표시(ed-ph) 스타일은 미디어·컴포넌트 둘 다 필요하다.
    // (캐러셀·카드 안의 빈 이미지가 0px 로 찌그러지는 걸 막는다)
    if (html.includes('ed-ph')) {
        pending.push({ kind: 'motion', path, className: '', css: MEDIA_PH_CSS });
        toFrame('motionPreview', { path, className: '', css: MEDIA_PH_CSS });
    }
    pending.push({ kind: 'insert', path, html, position });
    toFrame('insertPreview', { path, html, position });
    updateDirty();
    toast(kind === 'media' ? '미디어를 넣었습니다 — 링크는 인스펙터에서' : '넣었습니다 — 저장해야 파일에 반영됩니다', 'ok');
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
    renderCrumb(rel);
    // 브릿지가 100vh 를 '기기 높이' 기준으로 굳히도록 알려준다 (iframe 은 전체 높이로 늘어나므로)
    frame.src = '/preview/' + rel + '?__edvh=' + bp.h;
}

$('#pageSelect').addEventListener('change', e => openPage(e.target.value));
$('#reloadBtn')?.addEventListener('click', () => {
    if (pending.length && !confirm('저장하지 않은 변경이 사라집니다. 계속할까요?')) return;
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
    $('#stageInfo').textContent =
        `${bp.w}px 기준 렌더링 · ${Math.round(zoom * 100)}% · Ctrl+휠로 확대`;
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
    canvasX = Math.max(40, (sw - scaledW) / 2);
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
    if (e.key === 'Delete' || e.key === 'Backspace') { if (selection) { e.preventDefault(); blockAction('remove'); } }
});
$('#parentBtn')?.addEventListener('click', () => toFrame('selectParent'));
$('#dupBtn')?.addEventListener('click', () => blockAction('duplicate'));
$('#delBtn')?.addEventListener('click', () => blockAction('remove'));

/** 고른 덩어리를 지우거나 복제한다 — 미리보기가 먼저 반영하고, 결과를 받아 대기열에 쌓는다 */
function blockAction(act) {
    if (!selection) { toast('먼저 미리보기에서 덩어리를 고르세요', 'warn'); return; }
    toFrame(act === 'remove' ? 'removeElement' : 'duplicateElement', {});
}

$('#saveCompBtn')?.addEventListener('click', () => {
    if (!selection) { toast('먼저 미리보기에서 덩어리를 고르세요', 'warn'); return; }
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
// 여백 블록을 펼치면 예외 목록을 불러온다 (표시를 안 켜도 확인 가능)
$('#spBlock')?.addEventListener('toggle', e => {
    if (e.target.open) setTimeout(refreshGapExceptions, 200);
});

/**
 * 토큰을 따르지 않는 섹션 목록.
 * 이게 있으면 슬라이더가 일부에만 먹혀 '왜 얘만 안 움직이지?' 가 된다 → 눈에 보이게 알린다.
 */
function renderGapExceptions({ base, list }) {
    const box = $('#gapExc'), host = $('#gapExcList'), cnt = $('#gapExcCount');
    const applied = $('#gapApplyCount');
    const total = (dsData && 0) || null;   // 총 개수는 아래에서 목록으로 계산
    if (applied) applied.textContent = list.length ? `(${list.length}개 제외)` : '';
    if (!box || !host) return;
    if (!list.length) { box.hidden = true; return; }
    box.hidden = false;
    cnt.textContent = list.length;
    host.innerHTML = '';
    for (const it of list) {
        const row = el('button', 'sp-exc__item');
        row.type = 'button';
        const 값 = it.top === it.bottom ? `${it.top}px` : `↑${it.top} ↓${it.bottom}`;
        row.innerHTML =
            `<span class="sp-exc__name">섹션 ${it.index} · ${it.name}</span>` +
            `<span class="sp-exc__val">${값}</span>`;
        row.title = `기본값 ${base}px 과 다릅니다 — 눌러서 위치 보기`;
        row.addEventListener('click', () => {
            toFrame('focusSection', { path: it.path });
            toast(`섹션 ${it.index} 로 이동`, 'ok');
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
        toast(`모든 섹션 여백 ${px}px — 저장해야 반영됩니다`, 'ok');
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
        toast(`이 경계 여백 ${px}px (양쪽)`, 'ok');
    }
    updateDirty();
}

// ---------------------------------------------------------------- 속성 정의
// 인스펙터 그룹.
//   when : 어떤 요소일 때 보여줄지 (없으면 항상)
//   adv  : 고급 — 기본은 접어 두고 '고급 속성 보기'로 펼친다
// 선택한 게 무엇이든 24개를 다 쏟아내면 정작 필요한 값을 못 찾는다.
const GROUPS = [
    { key: 'typo',    title: '텍스트',  props: ['font-size', 'line-height', 'font-weight', 'color'], when: s => s.hasText },
    { key: 'margin',  title: '바깥 여백',  props: ['margin-top', 'margin-bottom'] },
    { key: 'padding', title: '안쪽 여백',  props: ['padding-top', 'padding-bottom'] },
    { key: 'margin2', title: '바깥 여백 (좌·우)', props: ['margin-left', 'margin-right'], adv: true },
    { key: 'padding2',title: '안쪽 여백 (좌·우)', props: ['padding-left', 'padding-right'], adv: true },
    { key: 'layout',  title: '배치',    props: ['gap', 'justify-content', 'align-items'], when: s => s.isFlexOrGrid },
    { key: 'size',    title: '크기',    props: ['width', 'height', 'max-width', 'min-width'], adv: true },
    { key: 'look',    title: '모양',    props: ['background-color', 'border-radius', 'opacity'] },
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

    // 선택한 요소가 어떤 성격인지 — 이걸로 보여줄 항목을 고른다
    const ctx = {
        hasText: !!(selection.text && selection.text.trim()) || /^(H1|H2|H3|H4|H5|H6|P|SPAN|A|LI|BUTTON|EM|STRONG)$/i.test(selection.tag),
        isFlexOrGrid: /flex|grid/.test(selection.computed?.display || ''),
        isMedia: /^(IMG|VIDEO|IFRAME|SOURCE)$/i.test(selection.tag),
    };

    // 이미지·영상이면 링크(src)부터 — 제일 자주 바꾸는 값
    if (ctx.isMedia) box.appendChild(mediaRow());

    // 위/아래 이웃과의 간격 — 가장 자주 만지는 값이라 맨 앞에 둔다
    const nb = neighborRow();
    if (nb) box.appendChild(nb);

    // 박스 모델 시각화
    box.appendChild(boxModelWidget());

    // 텍스트 요소일 때만 정렬 버튼
    if (ctx.hasText) box.appendChild(alignRow());

    for (const g of GROUPS) {
        if (g.when && !g.when(ctx)) continue;
        if (g.adv && !inspShowAdvanced) continue;
        const wrap = document.createElement('div');
        wrap.className = 'group';
        const h = document.createElement('h3');
        h.textContent = g.title;
        h.addEventListener('click', () => wrap.classList.toggle('is-collapsed'));
        wrap.appendChild(h);
        for (const prop of g.props) wrap.appendChild(fieldRow(prop));
        box.appendChild(wrap);
    }

    const moreBtn = $('#inspMore');
    if (moreBtn) {
        moreBtn.textContent = inspShowAdvanced ? '고급 속성 접기' : '고급 속성 보기';
        moreBtn.setAttribute('aria-expanded', inspShowAdvanced ? 'true' : 'false');
    }
}

let inspShowAdvanced = false;
$('#inspMore')?.addEventListener('click', () => {
    inspShowAdvanced = !inspShowAdvanced;
    renderInspector();
});

/**
 * 위·아래 이웃과의 간격을 한 줄로 조절한다.
 *
 * 텍스트 사이 간격은 '위 요소의 margin-bottom + 아래 요소의 margin-top'이라,
 * 예전엔 두 요소를 각각 선택해 서로 다른 항목을 찾아야 했다.
 * 여기서는 지금 보이는 간격을 그대로 보여주고, 조절하면 '이 요소 쪽' 값만 바꾼다.
 */
function neighborRow() {
    const nb = selection.neighbors;
    if (!nb || (!nb.up && !nb.down)) return null;
    const SPACE_TOKENS = selection.spaceTokens || [];

    const g = el('div', 'group');
    const h = el('h3', null, '위·아래 간격');
    h.addEventListener('click', () => g.classList.toggle('is-collapsed'));
    g.appendChild(h);

    const mk = (side, info) => {
        if (!info) return;
        const row = el('div', 'field nb-row');
        row.appendChild(el('label', null, side === 'up' ? '위 사이' : '아래 사이'));

        // 간격도 디자인 시스템 안에서 고른다 (다른 여백 항목과 같은 규칙).
        // 이 요소가 가진 몫(margin)만 바꾸고, 상대 요소는 건드리지 않는다.
        const prop = side === 'up' ? 'margin-top' : 'margin-bottom';
        const mine = side === 'up' ? info.myTop : info.myBottom;
        const sel = el('select', 'tokenSel');
        // 지금 값이 토큰과 맞는지 표시
        const hit = SPACE_TOKENS.find(t => Math.abs(t.px - info.gap) <= 1);
        sel.appendChild(Object.assign(el('option'), {
            value: '', textContent: hit ? `지금: ${info.gap}px (${hit.label})` : `지금: ${info.gap}px (토큰 아님)`,
        }));
        for (const t of SPACE_TOKENS) {
            sel.appendChild(Object.assign(el('option'), {
                value: t.name, textContent: `${t.label} · ${t.px}px`,
            }));
        }
        sel.addEventListener('change', () => {
            const t = SPACE_TOKENS.find(x => x.name === sel.value);
            if (!t) return;
            // 목표 간격(t.px)이 되도록 내 margin 을 맞춘다
            stageEdit(prop, Math.max(0, Math.round(mine + (t.px - info.gap))) + 'px');
        });
        row.appendChild(sel);

        const who = el('span', 'nb-who', info.name);
        who.title = '이 요소를 선택합니다';
        who.addEventListener('click', () => toFrame('reselect', { path: info.path }));
        row.appendChild(who);
        g.appendChild(row);
    };
    mk('up', nb.up);
    mk('down', nb.down);

    const note = el('p', 'nb-note', '눈에 보이는 간격입니다. 디자인 시스템의 간격 단계에서 고릅니다.');
    g.appendChild(note);
    return g;
}

/** 이미지·영상 링크 편집 줄 (src 를 직접 고친다) */
function mediaRow() {
    const g = el('div', 'group');
    g.innerHTML = '<h3>미디어</h3>';
    const row = el('div', 'field');
    const label = el('label', null, '링크(src)');
    const inp = el('input');
    inp.type = 'text';
    inp.value = selection.attrs?.src || '';
    inp.placeholder = 'media/…';
    inp.addEventListener('change', () => {
        const v = inp.value.trim();
        pending.push({ kind: 'attr', path: selection.path, name: 'src', value: v });
        toFrame('setAttr', { path: selection.path, name: 'src', value: v });
        updateDirty();
        toast('링크를 바꿨습니다 — 저장해야 반영됩니다', 'ok');
    });
    row.append(label, inp);
    g.appendChild(row);
    return g;
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
            ...d.primary.map(g => ({ label: 'Primary ' + g.step, name: g.name })),
            ...d.purpleRamp.map(g => ({ label: '퍼플 ' + g.step, name: g.name })),
            ...d.tealRamp.map(g => ({ label: '틸 ' + g.step, name: g.name })),
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
    const dot = $('#crumbDot'); if (dot) dot.hidden = n === 0;   // 파일명 옆 '수정됨' 점
    $('#saveBtn').disabled = n === 0;
    $('#revertBtn').disabled = n === 0;
}

// ---------------------------------------------------------------- 저장 / 되돌리기
/**
 * 되돌리기 — Ctrl+Z 처럼 '마지막 한 걸음'만 취소한다.
 * 예전엔 전부 비우고 새로고침해서, 한 글자 고친 걸 취소하려다 작업을 통째로 잃었다.
 */
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
    } else {
        pending.pop();
        // 삽입·인터랙션은 화면에서 되돌리기 어려우니 그 요소만 지우고 다시 그린다
        if (last.kind === 'insert' || last.kind === 'motion') toFrame('undoInserts', {});
        // 섹션 이동은 화면에서도 제자리로 돌려놓는다
        if (last.kind === 'move') toFrame('undoMove', {});
        // 지우기·복제도 화면에서 제자리로 돌려놓는다
        if (last.kind === 'remove' || last.kind === 'duplicate') toFrame('undoBlock', {});
    }

    updateDirty();
    applyPendingPreview();       // 남은 변경은 그대로 유지
    toast(pending.length ? '한 단계 되돌림' : '모두 되돌림', 'ok');
}
$('#revertBtn').addEventListener('click', undoLast);

// Ctrl/Cmd + Z 로도 되돌리기
document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;   // 입력 중엔 기본 동작
    e.preventDefault();
    undoLast();
});

// Ctrl/Cmd + D 로 복제
document.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey) || e.key !== 'd') return;
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    e.preventDefault();
    blockAction('duplicate');
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
                edits: pending.map(p => {
                    if (p.kind === 'css') return { kind: 'css', selector: p.selector, prop: p.prop, value: p.value };
                    if (p.kind === 'insert') return { kind: 'insert', path: p.path, html: p.html, position: p.position };
                    if (p.kind === 'move') return { kind: 'move', path: p.path, dir: p.dir };
                    if (p.kind === 'remove') return { kind: 'remove', path: p.path };
                    if (p.kind === 'duplicate') return { kind: 'duplicate', path: p.path };
                    if (p.kind === 'attr') return { kind: 'attr', path: p.path, name: p.name, value: p.value };
                    if (p.kind === 'motion') return { kind: 'motion', path: p.path, className: p.className, css: p.css };
                    return { kind: 'inline', path: p.path, changes: p.changes };
                })
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '저장 실패');
        toast(`저장 완료 — ${data.applied.length}건`, 'ok');
        pending = [];
        updateDirty();
        needsCenter = true;
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
/** 미리보기가 떠 준 덩어리를 이름 붙여 등록한다 */
async function onGrabbed(p) {
    if (!p || p.error) { toast(p?.error || '가져오지 못했습니다', 'warn'); return; }
    const guess = (p.className || '').split(/\s+/)[0] || p.tag;
    const name = prompt('컴포넌트 이름 (같은 이름이면 덮어씁니다)', guess);
    if (name === null) return;
    if (!name.trim()) { toast('이름이 필요합니다', 'warn'); return; }
    try {
        const res = await fetch('/__api/components', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name.trim(), html: p.html, sketch: p.sketch, needs: p.needs,
                css: p.css, vars: p.vars,
                note: p.text ? `"${p.text}"` : '', from: currentPage,
            }),
        });
        const out = await res.json();
        if (!res.ok) { toast(out.error || '등록 실패', 'warn'); return; }
        savedComps = out.items || [];
        loadComponentPatterns();
        selectTab('components');
        const css = p.cssCount ? ` · 스타일 ${p.cssCount}줄 포함` : '';
        toast((out.replaced ? `"${out.saved}" 을(를) 덮어썼습니다` : `"${out.saved}" 등록 완료`) + css, 'ok');
    } catch (e) { toast('등록 실패: ' + e.message, 'warn'); }
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
const TAB_TITLE = { components: '컴포넌트', media: '미디어', motion: '인터랙션' };
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
const COMPONENT_GROUPS = [
    {
        label: 'TEXT', items: [
            { key: 'sechead',   name: '섹션 헤더',     desc: '라벨 + 제목 2줄',      thumb: 'sechead' },
            { key: 'lead',      name: '리드 문단',     desc: '번호 강조 본문',        thumb: 'lead' },
            { key: 'titledesc', name: '제목 + 설명',   desc: '소제목 + 본문',        thumb: 'titledesc' },
            { key: 'grouphead', name: '그룹 헤더',     desc: 'A · Key Features',     thumb: 'grouphead' },
        ],
    },
    {
        label: 'LAYOUT', items: [
            { key: 'carousel',  name: '미디어 캐러셀', desc: '가로 스크롤 카드',      thumb: 'row' },
            { key: 'cols3',     name: '3단 카드',      desc: '균등 3열 그리드',       thumb: 'cols3' },
            { key: 'grid22',    name: '인터랙션 그리드', desc: '2×2 카드',           thumb: 'grid' },
            { key: 'flow',      name: '가로 플로우',   desc: '단계 → 단계',          thumb: 'flow' },
            { key: 'timeline',  name: '타임라인',      desc: '단계별 항목 나열',      thumb: 'timeline' },
            { key: 'media',     name: '이미지 + 캡션', desc: '미디어와 설명',         thumb: 'media' },
        ],
    },
];

// 이름에 개수가 박힌 것(3단 카드·2×2 그리드)은 고정.
// 개수가 유동적인 것만 드롭할 때 정한다.
const COMPONENT_COUNT = { carousel: 3, flow: 3, timeline: 3 };
const compCount = { ...COMPONENT_COUNT };

// 각 컴포넌트가 실제로 넣는 HTML — vibra 의 기존 클래스를 그대로 쓴다.
//
// 폭은 .vb-wrap(max-width: 1280px × --vb-s)이 정한다. vibra 의 블록은 전부 이 안에 있어서,
// 래퍼 없이 넣으면 .vb-wrap 밖에 떨어졌을 때 뷰포트 폭까지 퍼져 실제보다 크게 나온다
// (노트북 1536px 기준 1024px → 1536px, 1.5 배). 그래서 스스로 .vb-wrap 을 두른다.
// 이미 .vb-wrap 안에 떨어져 중첩되어도 max-width 가 같아 크기는 달라지지 않는다.
// 예외: .vb-carousel-block 은 자체 max-width(1120px × --vb-s)가 있어 두르지 않는다.
const COMPONENT_HTML = {
    sechead:
`<div class="vb-wrap">
    <span class="vb-eyebrow reveal">00 — Label</span>
    <h2 class="vb-title reveal">제목<br><span style="color:var(--vb-muted);font-weight:500;">부제목</span></h2>
</div>`,
    // 리드 문단은 vibra 에서 늘 --vb-lead-gap 만큼 아래를 벌린다 (기본 여백의 4 배)
    lead:
`<div class="vb-wrap">
    <p class="vb-body reveal" style="margin-bottom:var(--vb-lead-gap);">설명 문장을 여기에 씁니다. <span class="sky-lead__n">1.</span> <span class="sky-lead__k">첫 번째 강조</span>, <span class="sky-lead__n">2.</span> <span class="sky-lead__k">두 번째 강조</span> 할 수 있습니다.</p>
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
        <button type="button" class="vb-carousel-nav__arrow" data-carousel-prev="${id}" aria-label="이전">‹</button>
        <button type="button" class="vb-carousel-nav__arrow" data-carousel-next="${id}" aria-label="다음">›</button>
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
    // 가로 플로우 — 단계 사이에 화살표가 들어간다 (vibra .bg-flow)
    flow: (n = 3) => {
        const arrow = '<div class="bg-arrow"><svg viewBox="0 0 22 22" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 11h13M13 6l5 5-5 5"/></svg></div>';
        const step = i => `    <div class="bg-step"><div class="bg-step__year">연도</div><div class="bg-step__label">단계 ${i + 1}</div></div>`;
        const parts = [];
        for (let i = 0; i < n; i++) { if (i) parts.push('    ' + arrow); parts.push(step(i)); }
        return `<div class="vb-wrap">\n<div class="bg-flow reveal">\n${parts.join('\n')}\n</div>\n</div>`;
    },
    // 타임라인 — 한 단계(열) 안에 항목들이 쌓인다 (vibra .tl-col)
    timeline: (n = 3) =>
`<div class="vb-wrap">
<div class="tl-grid">
<div class="tl-col reveal">
    <div class="tl-col__head"><div class="tl-col__title">STEP</div></div>
${Array.from({ length: n }, () => `    <div class="tl-item">
        <div class="tl-item__name">항목 이름</div>
        <div class="tl-item__desc">짧은 설명</div>
    </div>`).join('\n')}
</div>
</div>
</div>`,
    media:
`<div class="vb-wrap">
    <div class="reveal">
        <img src="" alt="" loading="lazy" style="width:100%;height:auto;display:block;border-radius:16px;border:1px solid var(--vb-line);">
        <p class="vb-cap">이미지 설명</p>
    </div>
</div>`,
};
const PATTERN_THUMB = {
    sechead:   '<rect x="46" y="12" width="26" height="4" rx="2" fill="#3B82F6" opacity=".8"/><rect x="30" y="24" width="80" height="8" rx="3" fill="currentColor" opacity=".55"/><rect x="44" y="37" width="52" height="6" rx="3" fill="currentColor" opacity=".3"/>',
    lead:      '<rect x="20" y="16" width="8" height="5" rx="2" fill="#3B82F6"/><rect x="32" y="16" width="88" height="5" rx="2.5" fill="currentColor" opacity=".4"/><rect x="20" y="26" width="8" height="5" rx="2" fill="#3B82F6"/><rect x="32" y="26" width="76" height="5" rx="2.5" fill="currentColor" opacity=".4"/><rect x="20" y="36" width="8" height="5" rx="2" fill="#3B82F6"/><rect x="32" y="36" width="60" height="5" rx="2.5" fill="currentColor" opacity=".4"/>',
    titledesc: '<rect x="24" y="15" width="54" height="7" rx="3" fill="currentColor" opacity=".55"/><rect x="24" y="28" width="92" height="4" rx="2" fill="currentColor" opacity=".28"/><rect x="24" y="36" width="72" height="4" rx="2" fill="currentColor" opacity=".28"/>',
    grouphead: '<circle cx="28" cy="27" r="8" fill="#3B82F6" opacity=".75"/><rect x="44" y="23" width="60" height="7" rx="3" fill="currentColor" opacity=".5"/>',
    row:       '<rect x="18" y="16" width="30" height="22" rx="4" fill="currentColor" opacity=".5"/><rect x="55" y="16" width="30" height="22" rx="4" fill="currentColor" opacity=".3"/><rect x="92" y="16" width="30" height="22" rx="4" fill="currentColor" opacity=".2"/>',
    cols3:     '<rect x="16" y="14" width="32" height="26" rx="4" fill="currentColor" opacity=".45"/><rect x="54" y="14" width="32" height="26" rx="4" fill="currentColor" opacity=".45"/><rect x="92" y="14" width="32" height="26" rx="4" fill="currentColor" opacity=".45"/>',
    grid:      '<rect x="40" y="10" width="26" height="15" rx="3" fill="currentColor" opacity=".45"/><rect x="74" y="10" width="26" height="15" rx="3" fill="currentColor" opacity=".3"/><rect x="40" y="29" width="26" height="15" rx="3" fill="currentColor" opacity=".3"/><rect x="74" y="29" width="26" height="15" rx="3" fill="currentColor" opacity=".2"/>',
    flow:      '<rect x="24" y="18" width="20" height="18" rx="3" fill="currentColor" opacity=".45"/><path d="M48 27h9" stroke="currentColor" stroke-width="1.5" opacity=".5"/><rect x="60" y="18" width="20" height="18" rx="3" fill="currentColor" opacity=".3"/><path d="M84 27h9" stroke="currentColor" stroke-width="1.5" opacity=".5"/><rect x="96" y="18" width="20" height="18" rx="3" fill="#3B82F6" opacity=".6"/>',
    timeline:  '<line x1="46" y1="8" x2="46" y2="46" stroke="currentColor" stroke-width="2" opacity=".4"/><circle cx="46" cy="14" r="4" fill="#3B82F6"/><rect x="60" y="18" width="40" height="18" rx="4" fill="currentColor" opacity=".3"/>',
    media:     '<rect x="26" y="10" width="88" height="26" rx="4" fill="currentColor" opacity=".4"/><rect x="26" y="41" width="56" height="4" rx="2" fill="currentColor" opacity=".25"/>',

    // 미디어 전용
    mImage:    '<rect x="34" y="10" width="72" height="34" rx="4" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".55"/><circle cx="49" cy="21" r="4" fill="currentColor" opacity=".5"/><path d="M38 40l16-14 12 10 8-6 12 10" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".55"/>',
    mVideo:    '<rect x="30" y="10" width="66" height="34" rx="4" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".55"/><path d="M56 20l14 7-14 7z" fill="#3B82F6"/><rect x="100" y="16" width="10" height="22" rx="2" fill="currentColor" opacity=".25"/>',
    mYoutube:  '<rect x="32" y="12" width="76" height="30" rx="7" fill="#3B82F6" opacity=".18"/><rect x="32" y="12" width="76" height="30" rx="7" fill="none" stroke="#3B82F6" stroke-width="1.5" opacity=".6"/><path d="M64 20l14 7-14 7z" fill="#3B82F6"/>',
    mFigure:   '<rect x="34" y="8" width="72" height="26" rx="4" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".55"/><path d="M38 30l14-11 10 8 7-5 11 8" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".5"/><rect x="34" y="40" width="48" height="4" rx="2" fill="currentColor" opacity=".3"/>',

    // 인터랙션 전용
    xLift:     '<rect x="44" y="26" width="52" height="20" rx="4" fill="currentColor" opacity=".18"/><rect x="44" y="14" width="52" height="20" rx="4" fill="#3B82F6" opacity=".55"/><path d="M70 12V4M70 4l-4 4M70 4l4 4" stroke="#3B82F6" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
    xGrow:     '<rect x="52" y="18" width="36" height="18" rx="4" fill="currentColor" opacity=".2"/><rect x="44" y="12" width="52" height="30" rx="5" fill="none" stroke="#3B82F6" stroke-width="1.7" opacity=".8"/><path d="M100 8l6-4-1 6M40 46l-6 4 1-6" stroke="#3B82F6" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
    xPulse:    '<circle cx="70" cy="27" r="16" fill="none" stroke="#3B82F6" stroke-width="1.3" opacity=".35"/><circle cx="70" cy="27" r="10" fill="#3B82F6" opacity=".55"/><path d="M70 41v5M70 8v5M84 27h5M51 27h5" stroke="#3B82F6" stroke-width="1.4" stroke-linecap="round" opacity=".6"/>',
    xFade:     '<rect x="46" y="30" width="48" height="14" rx="3" fill="#3B82F6" opacity=".55"/><rect x="46" y="18" width="48" height="9" rx="3" fill="currentColor" opacity=".28"/><rect x="46" y="9" width="48" height="6" rx="3" fill="currentColor" opacity=".12"/>',
};
// ── 미디어: 끌어다 놓으면 그 자리에 이미지·영상 자리를 만든다 (링크는 인스펙터에서) ──
const MEDIA_ITEMS = [
    { key: 'image',   name: '이미지',        desc: '단일 이미지',        thumb: 'mImage' },
    { key: 'video',   name: '동영상',        desc: '자동재생 · 반복',     thumb: 'mVideo' },
    { key: 'youtube', name: 'YouTube',       desc: '외부 영상 임베드',    thumb: 'mYoutube' },
    { key: 'figure',  name: '이미지 + 캡션', desc: '설명이 붙는 미디어',  thumb: 'mFigure' },
];
// 링크가 비어 있어도 '자리'가 보이도록 감싼다 (빈 <img> 는 높이가 0 이라 화면에서 사라진다).
// .ed-ph 는 링크를 채우면 저절로 티가 안 나는 얇은 점선 자리표시다.
const MEDIA_HTML = {
    image:
`<div class="ed-ph ed-ph--16x9">
    <img src="" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:16px;">
</div>`,
    video:
`<div class="ed-ph ed-ph--16x9">
    <video src="" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;display:block;border-radius:16px;"></video>
</div>`,
    youtube:
`<div class="ed-ph ed-ph--16x9">
    <iframe src="" title="video" allow="autoplay; fullscreen" allowfullscreen style="width:100%;height:100%;border:0;display:block;border-radius:16px;"></iframe>
</div>`,
    figure:
`<div class="reveal">
    <div class="ed-ph ed-ph--16x9">
        <img src="" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:16px;">
    </div>
    <p class="vb-cap">이미지 설명</p>
</div>`,
};
// 자리표시 스타일 — 삽입할 때 페이지에 한 번만 넣는다
const MEDIA_PH_CSS =
`/* 크기·모서리는 :where() 로 우선순위를 0 으로 둬서 원래 클래스가 이기게 한다.
   (.ig-card__media 8px, .vb-carousel__media 20px 같은 vibra 본래 값이 유지된다) */
:where(.ed-ph){width:100%;border-radius:16px}
:where(.ed-ph--16x9){aspect-ratio:16/9}
:where(.ed-ph--3x4){aspect-ratio:3/4}
/* 테두리는 outline — border 와 달리 박스 크기를 키우지 않는다 */
.ed-ph{position:relative;background:rgba(127,127,140,.08);overflow:hidden;outline:1px dashed rgba(127,127,140,.45);outline-offset:-1px}
.ed-ph::after{content:'미디어 링크를 넣어주세요';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:rgba(127,127,140,.9);pointer-events:none}
.ed-ph:has(img[src]:not([src=""]))::after,.ed-ph:has(video[src]:not([src=""]))::after,.ed-ph:has(iframe[src]:not([src=""]))::after{display:none}
.ed-ph:has(img[src]:not([src=""])),.ed-ph:has(video[src]:not([src=""])),.ed-ph:has(iframe[src]:not([src=""])){background:none;outline:none}
/* 링크가 비어 있는 동안은 이미지가 자리를 차지하지 않게 (0px 찌그러짐 방지) */
.ed-ph > img[src=""],.ed-ph > video:not([src]),.ed-ph > img:not([src]){position:absolute;inset:0;width:100%;height:100%}
`;

// ── 인터랙션: 요소에 끌어다 놓으면 클래스 + CSS 규칙이 붙는다 ──
const MOTION_ITEMS = [
    { key: 'hover-lift',  name: '호버 시 떠오름', desc: '살짝 위로 + 그림자', thumb: 'xLift' },
    { key: 'hover-grow',  name: '호버 시 커짐',   desc: '1.04배 확대',        thumb: 'xGrow' },
    { key: 'click-pulse', name: '클릭 시 펄스',   desc: '눌렀다 튀어오름',    thumb: 'xPulse' },
    { key: 'fade-up',     name: '스크롤 등장',    desc: '아래에서 떠오름',    thumb: 'xFade' },
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
let pageClassSet = new Set();   // 지금 열린 페이지의 CSS 가 아는 클래스
let pageVarSet = new Set();     // 지금 열린 페이지가 정의한 CSS 변수(디자인 토큰)

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
        host.appendChild(el('div', 'lp-group-sub', '내 컴포넌트'));
        for (const it of savedComps) {
            const card = el('div', 'lp-card'); card.draggable = true;
            card.dataset.saved = it.id;
            card.innerHTML =
                `<div class="lp-card__thumb"><svg viewBox="0 0 140 54" width="100%" height="54" aria-hidden="true">${sketchSvg(it.sketch)}</svg></div>` +
                `<div class="lp-card__name">${escapeHtml(it.name)}</div>` +
                `<div class="lp-card__use">${escapeHtml(it.note || it.from || '내가 등록함')}</div>` +
                `<button class="lp-card__del" title="등록 취소">×</button>`;
            card.addEventListener('dragstart', ev => {
                ev.dataTransfer.effectAllowed = 'copy';
                ev.dataTransfer.setData('text/x-hnkl-saved', it.id);
                ev.dataTransfer.setData('text/plain', it.name);
            });
            card.querySelector('.lp-card__del').addEventListener('click', async ev => {
                ev.stopPropagation();
                if (!confirm(`"${it.name}" 등록을 취소할까요?\n(이미 페이지에 넣은 것은 그대로 남습니다)`)) return;
                await fetch('/__api/components', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ remove: it.id }),
                });
                toast('등록을 취소했습니다', 'ok');
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
}
loadComponentPatterns();
loadSavedComponents();
loadSimpleList('lpMedia', MEDIA_ITEMS, 'text/x-hnkl-media');
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
    for (const g of d.ramp) add(dsGroups.ramp, g.name, '회색 ' + g.step, g.hex, g.darkHex);

    // ③ 포인트(Primary) · 서브(Secondary 퍼플·틸)
    for (const g of d.primary)    add(dsGroups.primary, g.name, 'Primary ' + g.step, g.hex, null);
    for (const g of d.purpleRamp) add(dsGroups.purple,  g.name, '퍼플 ' + g.step, g.hex, null);
    for (const g of d.tealRamp)   add(dsGroups.teal,    g.name, '틸 ' + g.step, g.hex, null);

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

// ── 칩 카드 (원래 카드형: 색 면 + 이름 + 헥스) ──
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

// ① 팔레트
function sectionPalette(d) {
    const s = dsSection('팔레트');

    s.appendChild(el('h3', 'ds3-sub', '흰색 & 검정'));
    s.appendChild(chipRow(dsGroups.whites));

    s.appendChild(el('h3', 'ds3-sub', '회색'));
    s.appendChild(chipRow(dsGroups.ramp));

    s.appendChild(el('h3', 'ds3-sub', 'Primary'));
    s.appendChild(chipRow(dsGroups.primary));

    s.appendChild(el('h3', 'ds3-sub', 'Secondary · 퍼플'));
    s.appendChild(chipRow(dsGroups.purple));

    s.appendChild(el('h3', 'ds3-sub', 'Secondary · 틸'));
    s.appendChild(chipRow(dsGroups.teal));
    return s;
}

// ② 역할 — 역할마다 카드. 이름 아래 라이트·다크 버튼을 나란히. 버튼 = 스와치 + 색상 이름.
function sectionRoles(d) {
    const s = dsSection('역할');
    const grid = el('div', 'ds3-roles');
    for (const r of d.roles) {
        if (ROLE_SKIP.has(r.name) || !dsBaseLink[r.name]) continue;
        const card = el('div', 'ds3-role'); card.dataset.role = r.name;

        const nameEl = el('div', 'ds3-role-name', r.label);
        nameEl.appendChild(varName(r.name));
        card.appendChild(nameEl);

        const modes = el('div', 'ds3-role-modes');
        for (const m of ['light', 'dark']) {
            const isLight = m === 'light';
            const key = isLight ? r.name : darkKey(r.name);
            const col = el('div', 'ds3-mode-col');
            col.appendChild(el('span', 'ds3-mode-cap', isLight ? '라이트' : '다크'));

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
            col.appendChild(btn);

            const chg = el('span', 'ds3-chg'); chg.dataset.chg = key; col.appendChild(chg);
            modes.appendChild(col);
        }
        card.appendChild(modes);
        grid.appendChild(card);
    }
    s.appendChild(grid);
    return s;
}

// ③ 타이포
// 큰 묶음 구분선을 넣을 위치 (제목군 → 본문군)
const TYPO_GROUP_BREAK = new Set(['--fs-body']);

function sectionTypo(d) {
    const s = dsSection('타이포');

    const table = el('div', 'ds3-typo');
    const head = el('div', 'ds3-typo-row is-head');
    for (const h of ['카테고리', '크기', '굵기', '용도']) head.appendChild(el('div', 'ds3-th', h));
    table.appendChild(head);

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
                useCell.appendChild(el('div', 'ds3-useline', r.selectors.slice(0, 3).join(', ') || '—'));
            }
        } else {
            wCell.appendChild(el('div', 'ds3-wline is-none', '—'));
            useCell.appendChild(el('div', 'ds3-useline is-none', '아직 쓰이지 않음'));
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
    const SAMPLE = '다람쥐 헌 쳇바퀴';
    const q = s => document.querySelectorAll(s);

    q('[data-chip]').forEach(i => { const h = effHex(i.dataset.chip); if (h) i.value = h.toLowerCase(); });
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
            b.textContent = '바뀜 · 원래 ' + orig;
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
        const label = isDk ? roleOfDark(n) + ' · 다크' : n;
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
    { v: '--chip-w', label: '칩 너비', min: 60, max: 200, def: 96 },
    { v: '--chip-h', label: '색 높이', min: 40, max: 180, def: 96 },
    { v: '--chip-px', label: '글자 좌우 여백', min: 0, max: 24, def: 10 },
    { v: '--chip-pt', label: '글자 위 여백', min: 0, max: 24, def: 8 },
    { v: '--chip-pb', label: '글자 아래 여백', min: 0, max: 24, def: 8 },
    { v: '--chip-gap', label: '이름 ↔ 코드 간격', min: 0, max: 16, def: 0 },
    { v: '--chip-radius', label: '모서리', min: 0, max: 24, def: 10 },
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
