// 캐릭터 스타일 검토용 정적 렌더러 (인식 코드와 무관. 스타일이 확정되면 측정값을 이 규격에 연결한다)
//
// 조형 원칙 (레퍼런스에서 뽑은 공통점)
//  1. 큰 면과 작은 선의 대비: 머리·얼굴·헤어·몸은 선 없는 면, 코·입·눈썹만 필요한 곳에 가는 선.
//  2. 부위마다 '남길 것'과 '버릴 것'을 고른다. 모든 부위를 조금씩 그리지 않는다.
//  3. 눈은 도형 하나(점·원·눈꺼풀에 잘린 원·틈)로 읽힌다. 흰자+눈동자+반짝임+윗선을 다 넣지 않는다.
//  4. 비율이 곧 개성: 머리 대 몸, 눈 사이 간격, 코 길이, 입 너비.
//  5. 색은 배경·피부·머리·옷 네 면. 그림자는 코 면 하나 정도만.
//
// 좌표: 머리 중심이 (0,0), y 아래가 +. 단위는 '머리 반폭이 대략 0.5' 인 임의 단위.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function hexRGB(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function mix(a, b, t) {
  const pa = hexRGB(a), pb = hexRGB(b);
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// 닫힌 곡선 (구심 캣멀롬)
function closedSpline(ctx, pts, per = 10) {
  const n = pts.length, knot = (a, b) => Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])) || 1e-4;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const t0 = 0, t1 = knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    for (let s = 0; s < per; s++) {
      const t = t1 + ((t2 - t1) * s) / per;
      const L = (a, b, ta, tb) => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      out.push(L(L(A1, A2, t0, t2), L(A2, A3, t1, t3), t1, t2));
    }
  }
  ctx.moveTo(out[0][0], out[0][1]);
  for (let i = 1; i < out.length; i++) ctx.lineTo(out[i][0], out[i][1]);
  ctx.closePath();
}
function roundPoly(ctx, pts, r) {
  const n = pts.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const s = mid(pts[n - 1], pts[0]);
  ctx.moveTo(s[0], s[1]);
  for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n], m = mid(p, q); ctx.arcTo(p[0], p[1], m[0], m[1], r); }
  ctx.closePath();
}
function openSplinePts(pts, per = 10) {
  const n = pts.length, out = [], knot = (a, b) => Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])) || 1e-4;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    const t0 = 0, t1 = knot(p0, p1) || 1e-4, t2 = t1 + knot(p1, p2), t3 = t2 + (knot(p2, p3) || 1e-4);
    for (let s = 0; s < per; s++) {
      const t = t1 + ((t2 - t1) * s) / per;
      const L = (a, b, ta, tb) => (tb - ta < 1e-9 ? a : [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)]);
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      out.push(L(L(A1, A2, t0, t2), L(A2, A3, t1, t3), t1, t2));
    }
  }
  out.push(pts[n - 1]);
  return out;
}
const mirror = (half) => [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y])];

// ── 머리 실루엣: 종류마다 조절점이 다르다 (같은 타원을 늘인 게 아님) ──
function headPath(ctx, H) {
  const { w, h } = H;  // 반폭, 반높이
  switch (H.shape) {
    case 'long':      // 위가 둥글고 턱으로 갈수록 좁아지는 긴 얼굴
      closedSpline(ctx, mirror([[0, -h], [w * 0.7, -h * 0.9], [w, -h * 0.3], [w * 0.9, h * 0.35], [w * 0.55, h * 0.88], [0, h]])); break;
    case 'angular':   // 각진 넓은 얼굴: 직선과 작은 모서리
      roundPoly(ctx, mirror([[0, -h], [w * 0.85, -h], [w, -h * 0.5], [w, h * 0.5], [w * 0.7, h], [0, h]]), 0.06); break;
    case 'round':     // 작은 둥근 머리
      closedSpline(ctx, mirror([[0, -h], [w * 0.75, -h * 0.75], [w, 0], [w * 0.75, h * 0.75], [0, h]])); break;
    case 'pear':      // 위가 좁고 아래(볼·턱)가 넓은 얼굴
      closedSpline(ctx, mirror([[0, -h], [w * 0.6, -h * 0.85], [w * 0.8, -h * 0.2], [w, h * 0.45], [w * 0.7, h * 0.95], [0, h]])); break;
    case 'tall':      // 위아래로 긴 직사각형에 가까운 얼굴
      roundPoly(ctx, mirror([[0, -h], [w * 0.9, -h], [w, -h * 0.6], [w, h * 0.55], [w * 0.75, h], [0, h]]), 0.22); break;
    default:          // 'oval'
      closedSpline(ctx, mirror([[0, -h], [w * 0.8, -h * 0.8], [w, -h * 0.1], [w * 0.85, h * 0.6], [w * 0.4, h], [0, h]]));
  }
}

// ── 헤어: 덩어리 하나 + 앞머리 곡선 몇 개 ──
function drawHair(ctx, C, col, layer) {
  const H = C.head, { w, h } = H, S = C.hair;
  if (!S || S.kind === 'none') return;
  ctx.fillStyle = col;
  ctx.beginPath();
  if (S.kind === 'bowl' && layer === 'front') {
    // 바가지: 머리 위를 덮는 반구 + 직선에 가까운 앞머리 선. 옆은 귀 위까지
    const bang = S.bang ?? -h * 0.35, side = S.side ?? h * 0.05;
    const cap = openSplinePts([[-w * 1.05, side], [-w * 1.12, -h * 0.45], [-w * 0.78, -h * 1.05], [-w * 0.28, -h * 1.2], [w * 0.28, -h * 1.2], [w * 0.78, -h * 1.05], [w * 1.12, -h * 0.45], [w * 1.05, side]]);
    ctx.moveTo(cap[0][0], cap[0][1]);
    for (const p of cap) ctx.lineTo(p[0], p[1]);
    // 앞머리: 직선 한 줄, 가운데에 작은 V 하나만
    ctx.lineTo(w * 0.92, side); ctx.lineTo(w * 0.92, bang);
    if (S.notch) { ctx.lineTo(w * 0.1, bang); ctx.lineTo(0, bang + h * 0.09); ctx.lineTo(-w * 0.1, bang); }
    ctx.lineTo(-w * 0.92, bang); ctx.lineTo(-w * 0.92, side);
    ctx.closePath(); ctx.fill();
  } else if (S.kind === 'block' && layer === 'front') {
    // 각진 헤어: 평평한 윗면과 옆 블록, 앞머리는 한쪽으로 비스듬히
    const top = -h * (S.tall ?? 1.25);
    roundPoly(ctx, [[-w * 1.05, -h * 0.1], [-w * 1.08, top + h * 0.15], [-w * 0.75, top], [w * 0.95, top], [w * 1.1, top + h * 0.1], [w * 1.05, -h * 0.35],
      [w * 0.9, -h * 0.35], [w * 0.88, -h * 0.62], [-w * 0.3, -h * 0.5], [-w * 0.88, -h * 0.2], [-w * 0.88, -h * 0.1]], 0.03); ctx.fill();
  } else if (S.kind === 'helmet') {
    // 헬멧형: 머리 전체를 감싸 턱선까지 내려오는 큰 덩어리 (뒤) + 이마를 덮는 앞머리 (앞)
    if (layer === 'back') { roundPoly(ctx, [[-w * 1.15, h * 0.7], [-w * 1.15, -h * 1.05], [-w * 0.6, -h * 1.25], [w * 0.6, -h * 1.25], [w * 1.15, -h * 1.05], [w * 1.15, h * 0.7]], 0.08); ctx.fill(); }
    else { roundPoly(ctx, [[-w * 1.15, -h * 0.35], [-w * 1.15, -h * 1.05], [w * 1.15, -h * 1.05], [w * 1.15, -h * 0.35], [w * 0.85, -h * 0.35], [w * 0.85, -h * 0.58], [-w * 0.85, -h * 0.58], [-w * 0.85, -h * 0.35]], 0.03); ctx.fill(); }
  } else if (S.kind === 'bob') {
    // 단발: 뒤에서 어깨까지 내려오는 덩어리 + 앞머리 한 줄
    if (layer === 'back') { closedSpline(ctx, mirror([[0, -h * 1.25], [w * 0.95, -h * 1.05], [w * 1.3, -h * 0.2], [w * 1.28, h * 1.05], [w * 0.6, h * 1.1], [0, h * 1.1]])); ctx.fill(); }
    else { roundPoly(ctx, [[-w * 1.05, -h * 0.2], [-w * 1.08, -h * 0.95], [-w * 0.5, -h * 1.25], [w * 0.5, -h * 1.25], [w * 1.08, -h * 0.95], [w * 1.05, -h * 0.2], [w * 0.9, -h * 0.2], [w * 0.9, -h * 0.55], [w * 0.2, -h * 0.42], [-w * 0.35, -h * 0.55], [-w * 0.9, -h * 0.45], [-w * 0.9, -h * 0.2]], 0.03); ctx.fill(); }
  } else if (S.kind === 'pomp' && layer === 'front') {
    // 위로 솟은 덩어리: 한쪽으로 쓸어 넘긴 사다리꼴
    const top = -h * (S.tall ?? 1.7);
    roundPoly(ctx, [[-w * 1.0, -h * 0.6], [-w * 0.95, top + h * 0.35], [-w * 0.2, top], [w * 0.95, top + h * 0.05], [w * 1.05, -h * 0.5], [w * 0.8, -h * 0.75], [0, -h * 0.7], [-w * 0.7, -h * 0.8]], 0.05); ctx.fill();
  }
}

// ── 눈: 구조가 다르면 깜빡임도 그 구조 안에서 움직인다 ──
function drawEyes(ctx, C, col, expr) {
  const E = C.eyes, ink = col.ink, skin = col.skin;
  const blink = clamp(expr.blink, 0, 1), smile = clamp(expr.smile, 0, 1);
  for (const sx of [-1, 1]) {
    const x = sx * E.gap, y = E.y + (E.tiltY || 0) * sx;
    ctx.save(); ctx.translate(x, y);
    if (E.kind === 'dot') {
      // 점눈: 감으면 납작해지다가 짧은 선이 된다
      const r = E.size, ry = Math.max(r * (1 - blink) * (1 - 0.35 * smile), r * 0.18);
      ctx.beginPath(); ctx.ellipse(0, blink * r * 0.4, r * (1 + 0.15 * blink), ry, 0, 0, Math.PI * 2); ctx.fillStyle = ink; ctx.fill();
    } else if (E.kind === 'ring' || E.kind === 'lidcut') {
      // 흰 원 + 눈동자. 눈꺼풀(살색 면)이 위에서 내려와 가린다 — 졸린 눈은 처음부터 내려와 있다
      const R = E.size, base = E.kind === 'lidcut' ? (E.lid ?? 0.45) : 0;
      const cover = lerp(base, 1, blink) + 0.25 * smile * (1 - blink);
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fillStyle = '#FFFFFF'; ctx.fill();
      const pr = R * (E.pupil ?? 0.42), px = (E.gaze || 0) * (R - pr) * 0.8;
      ctx.beginPath(); ctx.arc(px, R * 0.05, pr, 0, Math.PI * 2); ctx.fillStyle = ink; ctx.fill();
      const lidY = -R + 2 * R * clamp(cover, 0, 1);
      ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R + 0.001, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = skin; ctx.fillRect(-R - 0.01, -R - 0.01, 2 * R + 0.02, lidY + R + 0.01);
      if (cover > 0.02) { ctx.beginPath(); ctx.moveTo(-R, lidY); ctx.lineTo(R, lidY); ctx.lineWidth = C.line; ctx.strokeStyle = ink; ctx.lineCap = 'round'; ctx.stroke(); }
      ctx.restore();
      if (cover >= 0.98) { ctx.beginPath(); ctx.moveTo(-R, R * 0.05); ctx.quadraticCurveTo(0, R * 0.25, R, R * 0.05); ctx.lineWidth = C.line; ctx.strokeStyle = ink; ctx.stroke(); }
    } else if (E.kind === 'slit') {
      // 틈눈: 어두운 렌즈 하나. 감으면 선
      const w = E.size, h = (E.h ?? w * 0.35) * (1 - blink) * (1 - 0.4 * smile);
      ctx.beginPath();
      if (h > w * 0.06) { ctx.moveTo(-w, 0); ctx.quadraticCurveTo(0, -h * 2, w, 0); ctx.quadraticCurveTo(0, h * 2 * 0.6, -w, 0); ctx.fillStyle = ink; ctx.fill(); }
      else { ctx.moveTo(-w, 0); ctx.quadraticCurveTo(0, w * 0.25, w, 0); ctx.lineWidth = C.line; ctx.strokeStyle = ink; ctx.lineCap = 'round'; ctx.stroke(); }
    } else if (E.kind === 'oval') {
      // 세로 타원 눈동자 (안경 뒤 등): 감으면 가로선
      const rx = E.size, ry = (E.h ?? rx * 1.6) * (1 - blink);
      ctx.beginPath();
      if (ry > rx * 0.25) { ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = ink; ctx.fill(); }
      else { ctx.moveTo(-rx * 1.3, 0); ctx.lineTo(rx * 1.3, 0); ctx.lineWidth = C.line; ctx.strokeStyle = ink; ctx.lineCap = 'round'; ctx.stroke(); }
    }
    ctx.restore();
  }
}

function drawBrows(ctx, C, col, expr) {
  const B = C.brows;
  if (!B || B.kind === 'none') return;
  const raise = (expr.open * 0.35 + expr.smile * 0.15) * 0.06;
  for (const sx of [-1, 1]) {
    ctx.save(); ctx.translate(sx * B.gap, B.y - raise); ctx.scale(sx, 1);
    ctx.fillStyle = col.hair === col.skin ? col.ink : col.brow; ctx.strokeStyle = ctx.fillStyle;
    ctx.beginPath();
    if (B.kind === 'line') { ctx.moveTo(-B.w, B.angle * B.w); ctx.lineTo(B.w, -B.angle * B.w); ctx.lineWidth = B.thick; ctx.lineCap = 'round'; ctx.stroke(); }
    else if (B.kind === 'block') { ctx.roundRect(-B.w, -B.thick / 2, B.w * 2, B.thick, B.thick / 2); ctx.fill(); }
    else if (B.kind === 'wedge') { ctx.moveTo(-B.w, B.thick * 0.3); ctx.lineTo(B.w, -B.thick * 0.7 - B.angle * B.w); ctx.lineTo(B.w, B.thick * 0.5 - B.angle * B.w); ctx.lineTo(-B.w, B.thick * 0.9); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }
}

function drawNose(ctx, C, col) {
  const N = C.nose, ink = col.ink, shade = mix(col.skin, col.ink, 0.22);
  ctx.save(); ctx.translate(0, N.y);
  ctx.lineWidth = C.line; ctx.strokeStyle = ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  if (N.kind === 'bent') {          // 길게 내려와 한 번 꺾이는 선
    ctx.moveTo(N.w * 0.15, -N.len); ctx.lineTo(N.w * 0.15, 0); ctx.lineTo(-N.w, N.len * 0.06); ctx.stroke();
  } else if (N.kind === 'hook') {   // 코끝에서 반대쪽으로 도는 갈고리
    ctx.moveTo(0, -N.len); ctx.quadraticCurveTo(N.w * 0.5, -N.len * 0.3, N.w * 0.45, 0); ctx.quadraticCurveTo(N.w * 0.35, N.w * 0.5, -N.w * 0.5, N.w * 0.35); ctx.stroke();
  } else if (N.kind === 'wedge') {  // 짧은 쐐기 면
    ctx.moveTo(0, -N.len); ctx.lineTo(N.w, 0); ctx.lineTo(-N.w * 0.35, 0); ctx.closePath(); ctx.fillStyle = shade; ctx.fill();
  } else if (N.kind === 'bulb') {   // 둥근 돌출 면
    ctx.ellipse(0, 0, N.w, N.w * 0.8, 0, 0, Math.PI * 2); ctx.fillStyle = shade; ctx.fill();
  } else if (N.kind === 'mark') {   // 작은 표시: 짧은 세로선
    ctx.moveTo(0, -N.len); ctx.lineTo(0, 0); ctx.stroke();
  } else if (N.kind === 'tri') {    // 큰 삼각 면 (수염 위)
    ctx.moveTo(0, -N.len); ctx.lineTo(N.w, 0); ctx.lineTo(-N.w, 0); ctx.closePath(); ctx.fillStyle = shade; ctx.fill();
  }
  ctx.restore();
}

function drawMouth(ctx, C, col, expr) {
  const M = C.mouth, ink = col.ink, smile = clamp(expr.smile, 0, 1), open = clamp(expr.open, 0, 1);
  const w = M.w * (1 + 0.15 * smile), curve = (M.curve || 0) + smile * 0.9;
  ctx.save(); ctx.translate(M.x || 0, M.y);
  ctx.lineWidth = M.thick || C.line; ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (open > 0.03) {
    // 벌린 입: 한 덩어리 (가로 폭은 입 너비, 세로는 벌림)
    const h = M.openH * open;
    ctx.beginPath(); ctx.moveTo(-w, 0); ctx.quadraticCurveTo(0, -curve * w * 0.25, w, 0); ctx.quadraticCurveTo(w * 0.9, h, 0, h * 1.15); ctx.quadraticCurveTo(-w * 0.9, h, -w, 0); ctx.closePath(); ctx.fill();
    if (M.teeth && smile > 0.3) { ctx.save(); ctx.clip(); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(-w, -0.05, 2 * w, 0.05 + h * 0.3); ctx.restore(); }
    ctx.restore(); return;
  }
  ctx.beginPath();
  if (M.kind === 'bar') {           // 굵은 한 덩어리
    ctx.roundRect(-w, -M.thick / 2, 2 * w, M.thick, M.thick / 2); ctx.fill();
  } else if (M.kind === 'wide') {   // 넓고 얇은 한 줄, 끝이 살짝 처지거나 올라감
    ctx.moveTo(-w, -curve * 0.04); ctx.quadraticCurveTo(0, curve * 0.08, w, -curve * 0.04); ctx.stroke();
  } else {                          // 'line': 짧은 한 줄
    ctx.moveTo(-w, 0); ctx.quadraticCurveTo(0, curve * w * 0.5, w, 0); ctx.stroke();
  }
  ctx.restore();
}

function drawGlasses(ctx, C, col) {
  const G = C.glasses;
  if (!G) return;
  ctx.save();
  ctx.lineWidth = G.rim ?? C.line * 1.6; ctx.strokeStyle = G.color || col.ink; ctx.fillStyle = G.lens || mix(col.skin, '#FFFFFF', 0.4); ctx.lineJoin = 'round';
  for (const sx of [-1, 1]) {
    ctx.save(); ctx.translate(sx * G.gap, G.y); ctx.scale(sx, 1);
    ctx.beginPath();
    if (G.kind === 'aviator') roundPoly(ctx, [[-G.w, -G.h * 0.9], [G.w, -G.h], [G.w * 0.95, G.h * 0.6], [G.w * 0.3, G.h], [-G.w * 0.8, G.h * 0.8]], 0.06);
    else ctx.arc(0, 0, G.w, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath(); ctx.moveTo(-(G.gap - G.w), G.y - G.h * 0.5); ctx.lineTo(G.gap - G.w, G.y - G.h * 0.5); ctx.stroke();
  ctx.restore();
}

function drawMustache(ctx, C, col) {
  const M = C.mustache;
  if (!M) return;
  ctx.fillStyle = col.hair;
  ctx.beginPath();
  closedSpline(ctx, [[0, M.y - M.h * 0.3], [M.w * 0.45, M.y - M.h * 0.45], [M.w, M.y + M.h * 0.3], [M.w * 0.8, M.y + M.h * 0.8], [M.w * 0.35, M.y + M.h * 0.55], [0, M.y + M.h * 0.9], [-M.w * 0.35, M.y + M.h * 0.55], [-M.w * 0.8, M.y + M.h * 0.8], [-M.w, M.y + M.h * 0.3], [-M.w * 0.45, M.y - M.h * 0.45]]);
  ctx.fill();
}

function drawEars(ctx, C, col) {
  const E = C.ears;
  if (!E) return;
  const { w } = C.head;
  ctx.fillStyle = col.skin;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    if (E.kind === 'wing') { ctx.save(); ctx.translate(sx * (w + E.size * 0.6), E.y); ctx.scale(sx, 1); roundPoly(ctx, [[-E.size * 0.7, -E.size * 0.55], [E.size * 0.6, -E.size * 0.7], [E.size * 0.9, E.size * 0.2], [E.size * 0.2, E.size * 0.6], [-E.size * 0.7, E.size * 0.35]], 0.05); ctx.fill(); ctx.restore(); }
    else { ctx.ellipse(sx * (w + E.size * 0.35), E.y, E.size * 0.55, E.size, 0, 0, Math.PI * 2); ctx.fill(); }
  }
}

function drawBody(ctx, C, col) {
  const B = C.body, { h } = C.head, chin = h;
  const neckTop = chin - 0.05, neckBot = chin + B.neckLen;
  // 몸: 종류별 한 덩어리
  ctx.fillStyle = col.cloth;
  ctx.beginPath();
  if (B.kind === 'dome') { ctx.ellipse(0, neckBot + B.h, B.w, B.h, 0, Math.PI, 0); ctx.lineTo(B.w, neckBot + 3); ctx.lineTo(-B.w, neckBot + 3); ctx.closePath(); }
  else if (B.kind === 'block') roundPoly(ctx, [[-B.w, neckBot + 0.02], [B.w, neckBot + 0.02], [B.w, neckBot + 3], [-B.w, neckBot + 3]], 0.08);
  else if (B.kind === 'slope') roundPoly(ctx, [[-B.neckW * 1.4, neckBot], [B.neckW * 1.4, neckBot], [B.w, neckBot + B.h], [B.w, neckBot + 3], [-B.w, neckBot + 3], [-B.w, neckBot + B.h]], 0.1);
  else if (B.kind === 'square') roundPoly(ctx, [[-B.neckW * 1.2, neckBot], [B.neckW * 1.2, neckBot], [B.w, neckBot + B.h * 0.4], [B.w, neckBot + 3], [-B.w, neckBot + 3], [-B.w, neckBot + B.h * 0.4]], 0.05);
  ctx.fill();
  // 목: 살색 사각. 길이 0 이면 안 그림
  if (B.neckLen > 0) { ctx.fillStyle = col.skin; ctx.fillRect(-B.neckW, neckTop, B.neckW * 2, B.neckLen + 0.06); }
  if (B.collar) { ctx.fillStyle = B.collar === 'white' ? '#FFFFFF' : col.skin; ctx.beginPath(); ctx.moveTo(-B.neckW * 1.6, neckBot); ctx.lineTo(0, neckBot + 0.22); ctx.lineTo(B.neckW * 1.6, neckBot); ctx.closePath(); ctx.fill(); }
}

// 캐릭터 하나. x,y = 머리 중심의 화면 위치(px), scale = 단위당 px
export function drawCharacter(ctx, C, pal, expr = {}, x = 0, y = 0, scale = 100) {
  const e = { smile: 0, open: 0, blink: 0, ...expr };
  const col = { skin: pal.skin, hair: pal.hair, cloth: pal.cloth, ink: pal.ink || '#1B1446', brow: pal.brow || pal.hair };
  ctx.save();
  ctx.translate(x, y); ctx.scale(scale, scale);
  drawBody(ctx, C, col);
  drawHair(ctx, C, col.hair, 'back');
  if (C.ears && !C.ears.front) drawEars(ctx, C, col);
  ctx.beginPath(); headPath(ctx, C.head); ctx.fillStyle = col.skin; ctx.fill();
  if (C.ears && C.ears.front) drawEars(ctx, C, col);
  drawHair(ctx, C, col.hair, 'front');
  drawBrows(ctx, C, col, e);
  drawEyes(ctx, C, col, e);
  drawNose(ctx, C, col);
  drawMustache(ctx, C, col);
  drawMouth(ctx, C, col, e);
  drawGlasses(ctx, C, col);
  ctx.restore();
}

// ── 6명 (정적 검토용. 실제 사람에게 배정하는 프리셋이 아님) ──
export const CHARACTERS = [
  {
    name: '긴 얼굴 · 작은 원눈 · 긴 꺾인 코 · 짧은 입',
    line: 0.028,
    head: { shape: 'long', w: 0.5, h: 0.78 },
    hair: { kind: 'bowl', bang: -0.34, side: 0.0, notch: true },
    ears: { kind: 'wing', size: 0.16, y: 0.02 },
    eyes: { kind: 'ring', gap: 0.22, y: -0.12, size: 0.085, pupil: 0.5 },
    brows: { kind: 'line', gap: 0.22, y: -0.3, w: 0.09, thick: 0.025, angle: 0.04 },
    nose: { kind: 'bent', y: 0.22, len: 0.4, w: 0.1 },
    mouth: { kind: 'line', y: 0.46, w: 0.14, curve: 0, openH: 0.18 },
    body: { kind: 'slope', neckLen: 0.16, neckW: 0.14, w: 0.75, h: 0.28 },
    fit: { scale: 150, y: 0.42 },
  },
  {
    name: '넓고 각진 얼굴 · 반쯤 감긴 눈 · 짧은 면 코 · 넓고 얇은 입',
    line: 0.026,
    head: { shape: 'angular', w: 0.62, h: 0.6 },
    hair: { kind: 'block', tall: 1.2 },
    ears: null,
    eyes: { kind: 'lidcut', gap: 0.27, y: -0.1, size: 0.1, lid: 0.5, pupil: 0.4 },
    brows: { kind: 'block', gap: 0.27, y: -0.28, w: 0.16, thick: 0.06 },
    nose: { kind: 'wedge', y: 0.2, len: 0.22, w: 0.1 },
    mouth: { kind: 'wide', y: 0.4, w: 0.3, curve: -0.6, openH: 0.14 },
    body: { kind: 'square', neckLen: 0.0, neckW: 0.28, w: 1.15, h: 0.3, collar: 'white' },
    fit: { scale: 140, y: 0.42 },
  },
  {
    name: '작은 둥근 머리 · 모인 눈 · 코 생략 · 아주 큰 상반신',
    line: 0.03,
    head: { shape: 'round', w: 0.42, h: 0.46 },
    hair: { kind: 'none' },
    ears: { kind: 'round', size: 0.08, y: 0.05 },
    eyes: { kind: 'ring', gap: 0.11, y: -0.04, size: 0.075, pupil: 0.55 },
    brows: { kind: 'block', gap: 0.12, y: -0.22, w: 0.08, thick: 0.05 },
    nose: { kind: 'mark', y: 0.12, len: 0.0, w: 0 },
    mouth: { kind: 'line', y: 0.2, w: 0.07, curve: 0.8, openH: 0.12 },
    body: { kind: 'dome', neckLen: 0.1, neckW: 0.2, w: 1.7, h: 0.95 },
    fit: { scale: 120, y: 0.3 },
  },
  {
    name: '헤어·안경·코·수염의 큰 형태',
    line: 0.026,
    head: { shape: 'pear', w: 0.55, h: 0.66 },
    hair: { kind: 'helmet' },
    ears: null,
    eyes: { kind: 'oval', gap: 0.24, y: -0.1, size: 0.03, h: 0.05 },
    brows: { kind: 'wedge', gap: 0.26, y: -0.33, w: 0.17, thick: 0.06, angle: 0.15 },
    nose: { kind: 'tri', y: 0.22, len: 0.3, w: 0.13 },
    mustache: { y: 0.34, w: 0.26, h: 0.12 },
    mouth: { kind: 'line', y: 0.5, w: 0.1, curve: 0, openH: 0.12 },
    glasses: { kind: 'aviator', gap: 0.26, y: -0.08, w: 0.22, h: 0.15 },
    body: { kind: 'block', neckLen: 0.06, neckW: 0.26, w: 1.0, h: 0.2 },
    fit: { scale: 140, y: 0.4 },
  },
  {
    name: '둥근 얼굴 · 큰 원눈 · 코 표시 · 넓은 미소',
    line: 0.03,
    head: { shape: 'oval', w: 0.55, h: 0.6 },
    hair: { kind: 'bob' },
    ears: null,
    eyes: { kind: 'ring', gap: 0.24, y: -0.05, size: 0.14, pupil: 0.38, gaze: 0.2 },
    brows: { kind: 'none' },
    nose: { kind: 'mark', y: 0.22, len: 0.09 },
    mouth: { kind: 'wide', y: 0.4, w: 0.24, curve: 1.2, openH: 0.16, teeth: true },
    body: { kind: 'slope', neckLen: 0.08, neckW: 0.16, w: 0.85, h: 0.25 },
    fit: { scale: 140, y: 0.43 },
  },
  {
    name: '길고 좁은 머리 · 눈꺼풀에 잘린 눈 · 긴 코 · 오므린 입 · 솟은 머리',
    line: 0.026,
    head: { shape: 'tall', w: 0.4, h: 0.72 },
    hair: { kind: 'pomp', tall: 1.75 },
    ears: { kind: 'round', size: 0.09, y: 0.0 },
    eyes: { kind: 'lidcut', gap: 0.17, y: -0.15, size: 0.11, lid: 0.55, pupil: 0.35 },
    brows: { kind: 'line', gap: 0.18, y: -0.36, w: 0.1, thick: 0.03, angle: -0.2 },
    nose: { kind: 'hook', y: 0.28, len: 0.45, w: 0.11 },
    mouth: { kind: 'bar', y: 0.5, w: 0.05, thick: 0.05, openH: 0.1 },
    body: { kind: 'slope', neckLen: 0.3, neckW: 0.11, w: 0.6, h: 0.3 },
    fit: { scale: 130, y: 0.43 },
  },
];

export const SHARED_PALETTE = { bg: '#FFB23F', skin: '#3440F0', hair: '#1B1446', cloth: '#1B1446', ink: '#1B1446' };
export const PALETTES = [
  { bg: '#E8563B', skin: '#3440F0', hair: '#1B1446', cloth: '#F4EDE0', ink: '#1B1446' },
  { bg: '#B9B6C4', skin: '#EE5E43', hair: '#F2B64C', cloth: '#1B1446', ink: '#1B1446', brow: '#F2B64C' },
  { bg: '#FFE66D', skin: '#FF8A3D', hair: '#FF8A3D', cloth: '#111111', ink: '#111111' },
  { bg: '#F2B64C', skin: '#EE5E43', hair: '#1B1446', cloth: '#43BEA7', ink: '#1B1446' },
  { bg: '#F7D6E0', skin: '#43BEA7', hair: '#3A2A1E', cloth: '#3440F0', ink: '#1B1446' },
  { bg: '#8E6CEF', skin: '#B8F2C9', hair: '#1B1446', cloth: '#FFB23F', ink: '#1B1446' },
];
