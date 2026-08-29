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
        toast('Text changed — save to write it to the file', 'ok');
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
        toast(p.act === 'remove' ? 'Deleted — save to write it to the file'
                                 : 'Duplicated — save to write it to the file', 'ok');
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
        toast(`Moved ${steps} step(s) — save to write it to the file`, 'ok');
    }
    else if (msg.type === 'moved') {
        // 미리보기에서는 이미 옮겨졌다. 파일에 반영할 내용만 쌓아 둔다.
        // 경로는 '옮기기 전' 기준이고 서버가 순서대로 적용하므로, 여러 번 눌러도 어긋나지 않는다.
        pending.push({ kind: 'move', path: msg.payload.path, dir: msg.payload.dir });
        updateDirty();
        toast('Section moved — save to write it to the file', 'ok');
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
function onComponentDropped({ key, kind, path, position }) {
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
            toast(`${it.name} inserted — save to write it to the file`, 'ok');
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
    // 표처럼 '무엇을 적을지'가 정해져야 뜻이 생기는 컴포넌트는 넣을 때 물어본다.
    // 값이 비면 기본 예시가 들어가고, 나머지는 인스펙터에서 고치면 된다.
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
    toast(kind === 'media' ? 'Media added — set the link in the inspector' : 'Inserted — save to write it to the file', 'ok');
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
    $('#stageInfo').textContent =
        `Rendering at ${bp.w}px · ${Math.round(zoom * 100)}% · Ctrl+wheel to zoom`;
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
    const box = $('#gapExc'), host = $('#gapExcList'), cnt = $('#gapExcCount');
    const applied = $('#gapApplyCount');
    const total = (dsData && 0) || null;   // 총 개수는 아래에서 목록으로 계산
    if (applied) applied.textContent = list.length ? `(${list.length} hidden)` : '';
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
        row.title = `Differs from the ${base}px default — click to locate`;
        row.addEventListener('click', () => {
            toFrame('focusSection', { path: it.path });
            toast(`Go to section ${it.index}`, 'ok');
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
        toast(`All sections ${px}px — save to write it to the file`, 'ok');
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
const GROUPS = [
    { key: 'typo',    title: 'Text',  props: ['font-size', 'line-height', 'font-weight', 'color'], when: s => s.hasText },
    { key: 'margin',  title: 'Margin',  props: ['margin-top', 'margin-bottom'] },
    { key: 'padding', title: 'Padding',  props: ['padding-top', 'padding-bottom'] },
    { key: 'margin2', title: 'Margin (left/right)', props: ['margin-left', 'margin-right'], adv: true },
    { key: 'padding2',title: 'Padding (left/right)', props: ['padding-left', 'padding-right'], adv: true },
    { key: 'layout',  title: 'Layout',    props: ['gap', 'justify-content', 'align-items'], when: s => s.isFlexOrGrid },
    { key: 'size',    title: 'Size',    props: ['width', 'height', 'max-width', 'min-width'], adv: true },
    { key: 'look',    title: 'Appearance',    props: ['background-color', 'border-radius', 'opacity'] },
];
const LABEL = {
    'font-size': 'Font size', 'line-height': 'Line height', 'font-weight': 'Weight', 'color': 'Color',
    'margin-top': 'Top', 'margin-right': 'Right', 'margin-bottom': 'Bottom', 'margin-left': 'Left',
    'padding-top': 'Top', 'padding-right': 'Right', 'padding-bottom': 'Bottom', 'padding-left': 'Left',
    'width': 'Width', 'max-width': 'Max width', 'min-width': 'Min width', 'height': 'Height',
    'gap': 'Gap', 'justify-content': 'Justify', 'align-items': 'Align',
    'border-radius': 'Radius', 'background-color': 'Background', 'opacity': 'Opacity',
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

    const raw = currentValue(prop) || '0px';
    const startPx = Math.round(parseFloat(raw)) || 0;
    const hit = nearestStep(startPx);
    const onToken = hit && Math.abs(hit.px - startPx) < 1;

    el.innerHTML =
        `<span class="sp-edge__label">${label}</span>` +
        `<span class="sp-edge__val${pendingFor(prop) ? ' is-changed' : ''}">${startPx}</span>` +
        `<span class="sp-edge__unit">px</span>` +
        // 0 은 '값이 없음'이지 '시스템 밖'이 아니다 — 굳이 경고처럼 보이지 않게 비운다
        (startPx === 0 ? `<span class="sp-edge__tok"></span>`
            : onToken ? `<span class="sp-edge__tok">${hit.name.replace('--space-', 'S')}</span>`
                : `<span class="sp-edge__tok is-off" title="Not one of the system steps">·</span>`);

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
        stageEdit(prop, valEl.textContent + 'px');
        renderInspector();                            // 끌기가 끝났으니 이제 다시 그린다
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

    const outer = ring('margin', 'MARGIN',
        ['margin-top', 'margin-right', 'margin-bottom', 'margin-left']);
    const inner = ring('padding', 'PADDING',
        ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']);

    const core = document.createElement('div');
    core.className = 'sp-core';
    core.textContent = `${selection.rect.w} × ${selection.rect.h}`;

    inner.appendChild(core);
    outer.appendChild(inner);
    wrap.appendChild(outer);

    // 어느 부분인지 미리보기에서 색으로 알려 준다 (판을 떠나면 지운다)
    for (const el of [outer, inner]) {
        el.addEventListener('mouseenter', () => toFrame('boxHint', { path: selection.path, part: el.dataset.part }));
    }
    wrap.addEventListener('mouseleave', () => toFrame('boxHint', { path: null }));

    const hint = document.createElement('p');
    hint.className = 'sp-hint';
    hint.textContent = 'Drag a number to change it — it snaps to the system steps. Alt to go off-system, double-click to type.';
    wrap.appendChild(hint);
    return wrap;
}

/**
 * "값은 바꿨는데 왜 화면이 그대로지?" 를 미리 알려 준다.
 * 도구가 조용히 있으면 사용자는 도구가 고장 난 줄 안다.
 */
function blockedNote(prop) {
    const c = selection.computed || {};
    const px = v => parseFloat(v) || 0;
    let msg = '';

    if (prop === 'width' && c['max-width'] && c['max-width'] !== 'none' && px(c['max-width']) <= px(c.width)) {
        msg = `Capped by max-width (${c['max-width']}). Raise that first.`;
    } else if (prop === 'height' && /auto/.test(c.height || '')) {
        msg = 'Height follows the content right now.';
    } else if (prop === 'text-align' && selection.childCount > 0) {
        msg = 'Children that set their own alignment will keep it.';
    }
    if (!msg) return null;

    const n = document.createElement('p');
    n.className = 'blocked-note';
    n.textContent = msg;
    return n;
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
    if (save) save.disabled = !selection;
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
    if (draggingEdge) return;          // 값을 끌고 있는 중엔 화면을 갈아엎지 않는다
    syncSelectionButtons();
    const empty = $('#emptyState'), insp = $('#inspector');
    if (!selection) {
        // 고른 게 없으면 이 패널은 '페이지 전체'를 다룬다
        const meta = $('#pageMeta');
        if (meta) meta.textContent = currentPage || '';
        empty.hidden = false; insp.hidden = true; syncSelectionButtons();
        // 토큰을 안 따르는 섹션이 몇인지 — 슬라이더가 일부에만 먹히는 이유가 된다
        if (!emptyShown) { emptyShown = true; setTimeout(refreshGapExceptions, 200); }
        return;
    }
    empty.hidden = true; insp.hidden = false; emptyShown = false;

    $('#selTag').textContent = friendlyName(selection);
    // 코드 이름은 필요할 때만 (마우스를 올리면 보인다)
    $('#selTag').title = selection.tag.toLowerCase() +
        (selection.classes.length ? '.' + selection.classes.filter(c => !c.startsWith('__ed')).join('.') : '');
    $('#selMeta').textContent = `${selection.rect.w} × ${selection.rect.h}`;
    $('#modeHelp').textContent = mode === 'css'
        ? 'Every element using this selector changes. Edits the CSS rule itself.'
        : 'Adds style="…" to this element only. Use it for a one-off exception.';

    const box = $('#fields');
    box.innerHTML = '';

    // 무엇을 골랐느냐에 따라 보여줄 것이 다르다.
    // 특히 '글자 속성'은 자식 태그가 없을 때만 뜻이 있다 — 제목과 설명이 묶인
    // 덩어리를 고르고 글자 크기를 하나로 정할 수는 없기 때문이다.
    const ctx = {
        isLeafText: !!selection.textOnly,
        isMedia: /^(IMG|VIDEO|IFRAME|SOURCE)$/i.test(selection.tag),
        isFlexOrGrid: /flex|grid/.test(selection.computed?.display || ''),
        isContainer: selection.childCount > 0,
    };

    // ① 값을 채우는 일이 먼저 (글자·링크)
    if (ctx.isLeafText) box.appendChild(textRow());
    if (ctx.isMedia) box.appendChild(mediaRow());

    // ② 주인공 — 이 덩어리가 만드는 공간
    box.appendChild(spacingBoard());

    // ③ 이웃과의 실제 간격 (내 여백 + 이웃 여백이 겹쳐 만든 값)
    const nb = neighborRow();
    if (nb) box.appendChild(nb);

    // ④ 나머지는 고른 것에 맞는 것만, 그것도 접어서
    if (ctx.isLeafText) {
        // 글자 하나짜리 — 크기·굵기·색이 하나로 정해지므로 뜻이 있다
        box.appendChild(foldGroup('Text', b => {
            b.appendChild(alignRow());
            for (const prop of ['font-size', 'line-height', 'font-weight', 'color']) b.appendChild(fieldRow(prop));
        }));
    } else if (ctx.isContainer) {
        // 덩어리 — 안에 여러 크기가 섞여 있어 '글자 크기' 하나를 정할 수 없다.
        box.appendChild(foldGroup('Text', b => {
            b.appendChild(alignRow());   // 정렬은 덩어리 단위로도 뜻이 있다
            const warn = blockedNote('text-align');
            if (warn) b.appendChild(warn);
        }));
    }
    if (ctx.isFlexOrGrid) {
        box.appendChild(foldGroup('Layout', b => {
            for (const prop of ['gap', 'justify-content', 'align-items']) b.appendChild(fieldRow(prop));
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
            for (const prop of ['width', 'height', 'max-width', 'min-width']) {
                b.appendChild(fieldRow(prop));
                const warn = blockedNote(prop);
                if (warn) b.appendChild(warn);
            }
        }));
    }

    const moreBtn = $('#inspMore');
    if (moreBtn) moreBtn.hidden = true;    // 접기로 갈음한다
}

// ── 이전 인스펙터 ────────────────────────────────────────────────
// 속성을 종류별로 전부 늘어놓던 방식. 무엇을 고르든 컨트롤이 38개쯤 떠서
// 정작 제일 자주 쓰는 '간격'이 그 안에 파묻혔다.
// 새 인스펙터(renderInspector)로 대체했고, 되돌릴 일이 있을까 봐 남겨 둔다.
function renderInspectorLegacy() {
    const empty = $('#emptyState'), insp = $('#inspector');
    if (!selection) {
        // 고른 게 없으면 이 패널은 '페이지 전체'를 다룬다
        const meta = $('#pageMeta');
        if (meta) meta.textContent = currentPage || '';
        empty.hidden = false; insp.hidden = true; syncSelectionButtons();
        // 토큰을 안 따르는 섹션이 몇인지 — 슬라이더가 일부에만 먹히는 이유가 된다
        if (!emptyShown) { emptyShown = true; setTimeout(refreshGapExceptions, 200); }
        return;
    }
    empty.hidden = true; insp.hidden = false; emptyShown = false;

    $('#selTag').textContent = friendlyName(selection);
    // 코드 이름은 필요할 때만 (마우스를 올리면 보인다)
    $('#selTag').title = selection.tag.toLowerCase() +
        (selection.classes.length ? '.' + selection.classes.filter(c => !c.startsWith('__ed')).join('.') : '');
    $('#selMeta').textContent = `${selection.rect.w} × ${selection.rect.h}`;

    $('#modeHelp').textContent = mode === 'css'
        ? 'Every element using this selector changes. Edits the CSS rule itself.'
        : 'Adds style="…" to this element only. Use it for a one-off exception.';

    const box = $('#fields');
    box.innerHTML = '';

    // 선택한 요소가 어떤 성격인지 — 이걸로 보여줄 항목을 고른다
    const ctx = {
        hasText: !!(selection.text && selection.text.trim()) || /^(H1|H2|H3|H4|H5|H6|P|SPAN|A|LI|BUTTON|EM|STRONG)$/i.test(selection.tag),
        isFlexOrGrid: /flex|grid/.test(selection.computed?.display || ''),
        isMedia: /^(IMG|VIDEO|IFRAME|SOURCE)$/i.test(selection.tag),
    };

    // 글자만 든 요소라면 내용부터 — 값을 채우는 게 먼저다
    if (selection.textOnly) box.appendChild(textRow());
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
        moreBtn.textContent = inspShowAdvanced ? 'Hide advanced' : 'Show advanced';
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
    const h = el('h3', null, 'Vertical spacing');
    h.addEventListener('click', () => g.classList.toggle('is-collapsed'));
    g.appendChild(h);

    const mk = (side, info) => {
        if (!info) return;
        const row = el('div', 'field nb-row');
        row.appendChild(el('label', null, side === 'up' ? 'Above' : 'Below'));

        // 간격도 디자인 시스템 안에서 고른다 (다른 여백 항목과 같은 규칙).
        // 이 요소가 가진 몫(margin)만 바꾸고, 상대 요소는 건드리지 않는다.
        const prop = side === 'up' ? 'margin-top' : 'margin-bottom';
        const mine = side === 'up' ? info.myTop : info.myBottom;
        const sel = el('select', 'tokenSel');
        // 지금 값이 토큰과 맞는지 표시
        const hit = SPACE_TOKENS.find(t => Math.abs(t.px - info.gap) <= 1);
        sel.appendChild(Object.assign(el('option'), {
            value: '', textContent: hit ? `now: ${info.gap}px (${hit.label})` : `now: ${info.gap}px (not a token)`,
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
        who.title = 'Select this element';
        who.addEventListener('click', () => toFrame('reselect', { path: info.path }));
        row.appendChild(who);
        g.appendChild(row);
    };
    mk('up', nb.up);
    mk('down', nb.down);

    const note = el('p', 'nb-note', 'The spacing you actually see. Pick from the design system steps.');
    g.appendChild(note);
    return g;
}

/** 이미지·영상 링크 편집 줄 (src 를 직접 고친다) */
function mediaRow() {
    const g = el('div', 'group');
    g.innerHTML = '<h3>Media</h3>';
    const row = el('div', 'field');
    const label = el('label', null, 'Link (src)');
    const inp = el('input');
    inp.type = 'text';
    inp.value = selection.attrs?.src || '';
    inp.placeholder = 'media/…';
    inp.addEventListener('change', () => {
        const v = inp.value.trim();
        pending.push({ kind: 'attr', path: selection.path, name: 'src', value: v });
        toFrame('setAttr', { path: selection.path, name: 'src', value: v });
        updateDirty();
        toast('Link changed — save to write it to the file', 'ok');
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
    const note = document.createElement('p');
    note.className = 'modeHelp';
    note.textContent = 'Edits the text in place. Save to write it to the file.';
    g.appendChild(note);
    return g;
}

function alignRow() {
    const g = document.createElement('div');
    g.className = 'group';
    g.innerHTML = '<h3>Text align</h3>';
    const row = document.createElement('div');
    row.className = 'segRow';
    const cur = currentValue('text-align');
    for (const v of ALIGN_OPTIONS) {
        const b = document.createElement('button');
        b.textContent = { left: 'Left', center: 'Center', right: 'Right' }[v];
        b.className = cur === v ? 'on' : '';
        b.onclick = () => stageEdit('text-align', v);
        row.appendChild(b);
    }
    g.appendChild(row);
    const o = document.createElement('div');
    o.className = 'origin';
    o.innerHTML = `Current <b>${cur || '-'}</b> · ${originOf('text-align').label}`;
    o.style.marginLeft = '0';
    g.appendChild(o);
    return g;
}

// ---------------------------------------------------------------- 토큰 목록 (인스펙터용)
// 기본은 '디자인 시스템 안에서만' 고르게 한다. 임의 값이 필요하면 'Custom' 버튼으로 잠금을 푼다.
let insTokens = null;                 // { colors:[{label,name}], fs:[...], space:[...] }
const freeMode = new Set();           // 직접 입력 잠금을 푼 속성들

async function loadInsTokens() {
    try {
        const d = await (await fetch('/__api/designsystem')).json();
        const colors = [
            ...d.roles.map(r => ({ label: r.label, name: r.name, hex: r.hex || r.lightHex })),
            ...d.ramp.map(g => ({ label: 'Gray ' + g.step, name: g.name, hex: g.hex })),
            ...d.primary.map(g => ({ label: 'Primary ' + g.step, name: g.name, hex: g.hex })),
            ...d.purpleRamp.map(g => ({ label: 'Purple ' + g.step, name: g.name, hex: g.hex })),
            ...d.tealRamp.map(g => ({ label: 'Teal ' + g.step, name: g.name, hex: g.hex })),
            ...d.surfaces.map(s => ({ label: s.label, name: s.name, hex: s.hex })),
            ...d.primitives.map(p => ({ label: p.label, name: p.name, hex: p.hex })),
        ];
        insTokens = {
            colors,
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
    const grid = document.createElement('div');
    grid.className = 'color-grid';
    for (const c of choices) {
        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'color-sw' + (hit && hit.name === c.name ? ' is-on' : '');
        sw.title = `${c.label}  ${c.hex || ''}`.trim();
        sw.style.background = c.hex || `var(${c.name})`;
        sw.addEventListener('click', () => { stageEdit(prop, `var(${c.name})`); });
        grid.appendChild(sw);
    }
    pop.appendChild(grid);

    // 시스템 밖 색이 필요할 때 — 헥스로 직접
    const free = document.createElement('div');
    free.className = 'color-free';
    free.innerHTML = '<span>Custom</span>';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'color-hex'; inp.placeholder = '#000000';
    inp.value = hex || '';
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); stageEdit(prop, inp.value.trim()); } });
    inp.addEventListener('blur', () => { if (inp.value.trim() && inp.value.trim() !== hex) stageEdit(prop, inp.value.trim()); });
    free.appendChild(inp);
    pop.appendChild(free);
    wrap.appendChild(pop);

    btn.addEventListener('click', () => { pop.hidden = !pop.hidden; });
    return wrap;
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
        o.value = ''; o.textContent = `now: ${cur || 'none'} (not a token)`;
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
    free.textContent = 'Custom';
    free.title = 'Type a value outside the design system (not recommended)';
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

    // 'Custom'으로 풀었던 속성은 다시 토큰 선택으로 돌아갈 수 있게
    if (freeMode.has(prop)) {
        const back = document.createElement('button');
        back.className = 'btn ghost tiny freeBtn';
        back.textContent = 'Token';
        back.title = 'Go back to picking a design system value';
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
            toast('No CSS rule targets this element, so it switches to “This element”.', 'err');
            setMode('inline');
            return stageEdit(prop, value);
        }
        if (!quietEdits) {
            if (org.media) toast(`This value comes from @${org.media}. That rule will be edited.`);
            else if (org.kind === 'insert') toast(`${prop} will be added to the ${org.selector} rule.`);
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
    $('#saveBtn').textContent = 'Saving…';
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
        $('#saveBtn').textContent = 'Save to file';
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
const TAB_TITLE = { components: 'Components', media: 'Media', motion: 'Interactions' };
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
const COMPONENT_GROUPS = [
    {
        label: 'TEXT', items: [
            { key: 'sechead',   name: 'Section header',     desc: 'Label · title · text',    thumb: 'sechead' },
            { key: 'titledesc', name: 'Title + text',   desc: 'Subtitle + body',        thumb: 'titledesc' },
            { key: 'grouphead', name: 'Group header',     desc: 'A · Key Features',     thumb: 'grouphead' },
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
};
// 자리표시 스타일 — 삽입할 때 페이지에 한 번만 넣는다
const MEDIA_PH_CSS =
`/* 크기·모서리는 :where() 로 우선순위를 0 으로 둬서 원래 클래스가 이기게 한다.
   (.ig-card__media 8px, .vb-carousel__media 20px 같은 vibra 본래 값이 유지된다) */
:where(.ed-ph){width:100%;border-radius:16px}
:where(.ed-ph--16x9){aspect-ratio:16/9}
:where(.ed-ph--3x4){aspect-ratio:3/4}
/* 로고는 '높이 고정 · 폭 자동'이라 빈 이미지면 폭이 0 이 된다 */
:where(.ed-ph--logo){display:inline-block;width:120px;aspect-ratio:2/1}
/* 테두리는 outline — border 와 달리 박스 크기를 키우지 않는다 */
.ed-ph{position:relative;background:rgba(127,127,140,.08);overflow:hidden;outline:1px dashed rgba(127,127,140,.45);outline-offset:-1px}
.ed-ph::after{content:'Add a media link';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:rgba(127,127,140,.9);pointer-events:none}
.ed-ph--logo::after{font-size:11px;content:'Logo'}
.ed-ph:has(img[src]:not([src=""]))::after,.ed-ph:has(video[src]:not([src=""]))::after,.ed-ph:has(iframe[src]:not([src=""]))::after{display:none}
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
};

const MEDIA_ITEMS = [
    { key: 'image',   name: 'Image',        desc: 'A single image',        thumb: 'mImage' },
    { key: 'video',   name: 'Video',        desc: 'Autoplay · loop',     thumb: 'mVideo' },
    { key: 'youtube', name: 'YouTube',       desc: 'Embedded external video',    thumb: 'mYoutube' },
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

// ── 인터랙션: 요소에 끌어다 놓으면 클래스 + CSS 규칙이 붙는다 ──
const MOTION_ITEMS = [
    { key: 'hover-lift',  name: 'Lift on hover', desc: 'Rises slightly + shadow', thumb: 'xLift' },
    { key: 'hover-grow',  name: 'Grow on hover',   desc: 'Scales to 1.04',        thumb: 'xGrow' },
    { key: 'click-pulse', name: 'Pulse on click',   desc: 'Presses in, springs back',    thumb: 'xPulse' },
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
let editingText = false;        // 미리보기에서 글자를 고치는 중인지
let emptyShown = false;         // '페이지 설정'이 이미 떠 있는지 (예외 목록을 한 번만 부르려고)
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
    // 무엇을 기준으로 무엇을 훑었는지 실제 값으로 보여준다 (설정에 따라 달라진다)
    const srcEl = document.getElementById('dsSrc');
    if (srcEl && dsData?.meta) {
        const list = (dsData.meta.scanned || []);
        const shown = list.slice(0, 3).join(', ') + (list.length > 3 ? ` +${list.length - 3} more` : '');
        srcEl.innerHTML = `Source: <b>${dsData.meta.source}</b> · scanned: ${shown}`;
    }
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
    inp.title = label + ' — click to pick a color';
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
            col.appendChild(el('span', 'ds3-mode-cap', isLight ? 'Light' : 'Dark'));

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
    const s = dsSection('Type');

    const table = el('div', 'ds3-typo');
    const head = el('div', 'ds3-typo-row is-head');
    for (const h of ['Category', 'Size', 'Weight', 'Usage']) head.appendChild(el('div', 'ds3-th', h));
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
            useCell.appendChild(el('div', 'ds3-useline is-none', 'Not used yet'));
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
$('#dsShowVars')?.addEventListener('change', e => {
    document.getElementById('dsView').classList.toggle('show-vars', e.target.checked);
});

// ---------------------------------------------------------------- 칩 모양 조절 인스펙터
// 칩 크기·색 면적·아래 텍스트 여백을 직접 만져볼 수 있는 작은 창.
// CSS 변수만 바꾸므로 파일에는 아무 영향이 없다.
const CHIP_VARS = [
    { v: '--chip-w', label: 'Chip width', min: 60, max: 200, def: 96 },
    { v: '--chip-h', label: 'Swatch height', min: 40, max: 180, def: 96 },
    { v: '--chip-px', label: 'Text padding X', min: 0, max: 24, def: 10 },
    { v: '--chip-pt', label: 'Text padding top', min: 0, max: 24, def: 8 },
    { v: '--chip-pb', label: 'Text padding bottom', min: 0, max: 24, def: 8 },
    { v: '--chip-gap', label: 'Name–code gap', min: 0, max: 16, def: 0 },
    { v: '--chip-radius', label: 'Radius', min: 0, max: 24, def: 10 },
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
