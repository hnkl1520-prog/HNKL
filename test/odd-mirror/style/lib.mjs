// 부품 라이브러리: 서로 어울리도록 설계된, 변형 가능한 부품과 그리는 규칙.
// 나중에 실제 측정값이 여기의 매개변수(얼굴 폭·턱 각짐·눈 크기·간격·코 길이·입 폭·헤어 덩어리)로 들어온다.
// 지금 단계의 예시는 전부 '디자인한 값'이고, 측정값은 하나도 없다.
//
// 공통 원칙 (모든 사람에게 유지)
//  · 머리·얼굴·헤어·목은 선 없는 단색 면. 선은 코·입·눈썹·귀 주름에만, 굵기는 하나.
//  · 그림자·볼터치·하이라이트·질감 없음. 코를 면으로 그릴 때만 피부보다 한 단계 어두운 색 하나.
//  · 눈은 한 가지 도형으로 읽힌다. 흰자와 눈동자를 쓰더라도 윤곽선·반짝임은 없다.
//  · 얼굴 윤곽은 위쪽(관자놀이)이 직선에 가깝고 아래쪽(턱)에서만 크게 돈다. 모서리 둥글기 값을 일괄로 쓰지 않는다.
//  · 헤어는 얼굴 실루엣을 이어받는 덩어리 하나. 앞머리 선은 흐름에 맞는 곡선이고, 작은 요철은 실제로 관측될 때만.
//  · 사람마다 두드러진 특징 한두 개만 과장하고 나머지는 보통 크기로 둔다.
//
// 사람에 따라 달라지는 것 (측정값이 고르는 범위)
//  · 얼굴: 폭·높이 비율, 턱이 둥근지 각진지, 볼이 나왔는지.
//  · 눈: 도형 종류(점 / 흰 원 / 눈꺼풀에 잘린 원 / 틈), 크기, 간격, 기울기.
//  · 눈썹: 가는 선 / 굵은 덩어리, 각도, 눈과의 거리.
//  · 코: 긴 꺾인 선 / 갈고리 선 / 짧은 쐐기 면 / 둥근 면 / 짧은 표시, 길이, 폭.
//  · 입: 폭, 곡률, 굵기.
//  · 헤어: 덩어리 종류(덮개 / 각진 블록 / 헬멧 / 단발 / 솟은 덩어리 / 짧게 붙은 / 없음), 두께, 앞머리 높이, 쓸어 넘긴 방향.
//  · 귀: 날개처럼 나옴 / 작게 / 헤어에 가림. 안경·수염의 유무.

export const INK = '#1B1446';
function hexRGB(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function mix(a, b, t) { const pa = hexRGB(a), pb = hexRGB(b); return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// ── 얼굴 실루엣 ──
// w 반폭, h 반높이, jaw 0(둥근 턱)~1(각진 턱), cheek 볼 돌출(0~1), top 정수리 둥글기(0 납작~1 둥긂)
export function facePath(ctx, F) {
  const { w, h } = F, jaw = F.jaw ?? 0, cheek = F.cheek ?? 0.3, top = F.top ?? 0.8;
  const chinHalf = w * lerp(0.28, 0.62, jaw);           // 턱 밑면 반폭: 각질수록 넓다
  const jawY = h * lerp(0.995, 0.8, jaw);               // 각진 턱은 옆선이 더 아래까지 수직으로 내려온다
  const cheekX = w * (1 + 0.06 * cheek), cheekY = h * lerp(0.05, 0.25, cheek);
  ctx.beginPath();
  ctx.moveTo(0, -h);
  const side = (s) => {
    // 정수리 → 관자놀이 (짧고 팽팽)
    if (s > 0) {
      ctx.bezierCurveTo(s * w * lerp(0.9, 0.6, top), -h, s * w * 0.97, -h * lerp(0.98, 0.86, top), s * w * 0.97, -h * 0.55);
      ctx.bezierCurveTo(s * w * 0.985, -h * 0.3, s * cheekX, cheekY - h * 0.25, s * cheekX, cheekY);   // 관자놀이 → 볼
      if (jaw > 0.5) {  // 각진 턱: 볼에서 수직으로 내려와 턱 모서리에서 짧게 꺾임
        ctx.bezierCurveTo(s * cheekX, cheekY + h * 0.3, s * w * 0.98, jawY - h * 0.15, s * w * 0.93, jawY);
        ctx.bezierCurveTo(s * w * 0.9, jawY + h * 0.06, s * chinHalf * 1.15, h * 0.99, s * chinHalf, h);
      } else {          // 둥근 턱: 볼에서 턱까지 길고 완만한 곡선 하나
        ctx.bezierCurveTo(s * cheekX, cheekY + h * 0.4, s * w * 0.78, h * 0.94, s * chinHalf, h);
      }
    } else {
      if (jaw > 0.5) {
        ctx.bezierCurveTo(s * chinHalf * 1.15, h * 0.99, s * w * 0.9, jawY + h * 0.06, s * w * 0.93, jawY);
        ctx.bezierCurveTo(s * w * 0.98, jawY - h * 0.15, s * cheekX, cheekY + h * 0.3, s * cheekX, cheekY);
      } else {
        ctx.bezierCurveTo(s * w * 0.78, h * 0.94, s * cheekX, cheekY + h * 0.4, s * cheekX, cheekY);
      }
      ctx.bezierCurveTo(s * cheekX, cheekY - h * 0.25, s * w * 0.985, -h * 0.3, s * w * 0.97, -h * 0.55);
      ctx.bezierCurveTo(s * w * 0.97, -h * lerp(0.98, 0.86, top), s * w * lerp(0.9, 0.6, top), -h, 0, -h);
    }
  };
  side(1);
  // 턱 밑면: 각진 턱은 거의 직선, 둥근 턱은 볼록
  ctx.bezierCurveTo(chinHalf * 0.6, h * (1 + 0.01 * (1 - jaw)), -chinHalf * 0.6, h * (1 + 0.01 * (1 - jaw)), -chinHalf, h);
  side(-1);
  ctx.closePath();
}

// ── 헤어 덩어리 ──
// kind: cap(덮개) | block(각진 블록) | helmet(헬멧) | bob(단발) | up(솟은 덩어리) | crop(짧게 붙은) | none
// thick 두께(정수리 위), bang 앞머리 선 높이(-1 정수리 … 0 눈 높이), sweep 쓸어 넘긴 방향(-1~1, 0이면 대칭)
export function hairPath(ctx, F, Hr, layer) {
  const { w, h } = F, t = Hr.thick ?? 0.15, bang = Hr.bang ?? -0.5, sw = Hr.sweep ?? 0;
  const top = -h * (1 + t), bangY = h * bang;
  ctx.beginPath();
  if (Hr.kind === 'cap' && layer === 'front') {
    const sideX = w * 1.04, sideBot = h * (bang + 0.14);
    ctx.moveTo(w * 0.985, sideBot);
    ctx.bezierCurveTo(w * 1.01, sideBot - h * 0.14, sideX, -h * 0.62, sideX, -h * 0.8);
    ctx.bezierCurveTo(sideX, -h * 0.98, w * 0.58, top, 0, top);
    ctx.bezierCurveTo(-w * 0.58, top, -sideX, -h * 0.98, -sideX, -h * 0.8);
    ctx.bezierCurveTo(-sideX, -h * 0.62, -w * 1.01, sideBot - h * 0.14, -w * 0.985, sideBot);
    // 앞머리 선: 옆머리 끝에서 한 흐름으로 올라와 완만하게 건너감 (쓸어 넘기면 한쪽이 낮다)
    ctx.bezierCurveTo(-w * 0.86, bangY + h * 0.12, -w * 0.6, bangY + h * 0.05 * (1 - sw), 0, bangY + h * 0.03 * -sw);
    ctx.bezierCurveTo(w * 0.6, bangY + h * 0.05 * (1 + sw), w * 0.86, bangY + h * 0.12, w * 0.985, sideBot);
    ctx.closePath();
  } else if (Hr.kind === 'block' && layer === 'front') {
    // 각진 블록: 평평한 윗면, 옆은 수직, 앞머리는 한쪽으로 비스듬히 내려오는 직선에 가까운 선
    const L = -w * 1.05, R = w * 1.05, topY = top;
    const lEnd = h * (bang + 0.22 + 0.1 * sw), rEnd = h * (bang + 0.22 - 0.1 * sw);   // 옆머리 끝: 쓸어 넘긴 쪽이 더 짧다
    ctx.moveTo(-w * 0.97, lEnd);
    ctx.bezierCurveTo(L, lEnd - h * 0.2, L, topY + h * 0.25, L + w * 0.05, topY + h * 0.1);
    ctx.quadraticCurveTo(L + w * 0.08, topY + h * 0.02, L + w * 0.35, topY + h * 0.01);   // 윗면: 거의 평평하되 모서리만 둥글게
    ctx.lineTo(R - w * 0.35, topY + h * 0.01);
    ctx.quadraticCurveTo(R - w * 0.08, topY + h * 0.02, R - w * 0.05, topY + h * 0.1);
    ctx.bezierCurveTo(R, topY + h * 0.25, R, rEnd - h * 0.2, w * 0.97, rEnd);
    // 앞머리: 한쪽으로 비스듬한 직선. 옆머리 끝에서 짧게 꺾여 들어간다
    ctx.lineTo(w * 0.88, rEnd); ctx.lineTo(w * 0.88, bangY - h * 0.12 * sw);
    ctx.lineTo(-w * 0.88, bangY + h * 0.12 * sw); ctx.lineTo(-w * 0.88, lEnd);
    ctx.closePath();
  } else if (Hr.kind === 'helmet') {
    // 헬멧: 뒤에서 턱선까지 내려오는 큰 덩어리 (뒤), 이마를 덮는 앞머리 (앞)
    const X = w * 1.16;
    if (layer === 'back') {
      ctx.moveTo(-X, h * 0.75); ctx.lineTo(-X, -h * 0.7);
      ctx.bezierCurveTo(-X, -h * (1 + t * 0.9), -w * 0.55, top, 0, top);
      ctx.bezierCurveTo(w * 0.55, top, X, -h * (1 + t * 0.9), X, -h * 0.7);
      ctx.lineTo(X, h * 0.75); ctx.quadraticCurveTo(X, h * 0.85, X - w * 0.1, h * 0.85); ctx.lineTo(-X + w * 0.1, h * 0.85); ctx.quadraticCurveTo(-X, h * 0.85, -X, h * 0.75);
    } else {
      ctx.moveTo(-X, bangY + h * 0.2); ctx.lineTo(-X, -h * 0.7);
      ctx.bezierCurveTo(-X, -h * 0.95, -w * 0.5, -h * 1.0, 0, -h * 1.0);
      ctx.bezierCurveTo(w * 0.5, -h * 1.0, X, -h * 0.95, X, -h * 0.7);
      ctx.lineTo(X, bangY + h * 0.2); ctx.lineTo(w * 0.88, bangY + h * 0.2); ctx.lineTo(w * 0.88, bangY);
      ctx.quadraticCurveTo(0, bangY - h * 0.03, -w * 0.88, bangY); ctx.lineTo(-w * 0.88, bangY + h * 0.2);
    }
    ctx.closePath();
  } else if (Hr.kind === 'bob') {
    const X = w * 1.3;
    if (layer === 'back') {
      ctx.moveTo(-X * 0.98, h * 1.15); ctx.bezierCurveTo(-X, h * 0.4, -X, -h * 0.4, -w * 0.95, -h * 0.95);
      ctx.bezierCurveTo(-w * 0.6, top, w * 0.6, top, w * 0.95, -h * 0.95);
      ctx.bezierCurveTo(X, -h * 0.4, X, h * 0.4, X * 0.98, h * 1.15);
      ctx.quadraticCurveTo(0, h * 1.25, -X * 0.98, h * 1.15);
    } else {
      const sideX = w * 1.06;
      ctx.moveTo(sideX, bangY + h * 0.3);
      ctx.bezierCurveTo(sideX, -h * 0.5, sideX, -h * 0.85, w * 0.7, -h * 1.0);
      ctx.bezierCurveTo(w * 0.4, top, -w * 0.4, top, -w * 0.7, -h * 1.0);
      ctx.bezierCurveTo(-sideX, -h * 0.85, -sideX, -h * 0.5, -sideX, bangY + h * 0.3);
      ctx.bezierCurveTo(-w * 0.92, bangY + h * 0.05, -w * 0.5, bangY + h * 0.08 * (1 - sw), 0, bangY - h * 0.04 * sw);
      ctx.bezierCurveTo(w * 0.5, bangY + h * 0.08 * (1 + sw), w * 0.92, bangY + h * 0.05, sideX, bangY + h * 0.3);
    }
    ctx.closePath();
  } else if (Hr.kind === 'up' && layer === 'front') {
    // 위로 솟은 덩어리: 한쪽으로 쓸려 올라간 사다리꼴, 아래는 이마선과 맞물림
    const T = -h * (1 + t * 2.2);
    ctx.moveTo(-w * 1.0, bangY + h * 0.15);
    ctx.bezierCurveTo(-w * 1.03, -h * 0.9, -w * 0.9, T + h * 0.35, -w * 0.3 * (1 - sw), T);
    ctx.bezierCurveTo(w * 0.4, T - h * 0.02, w * 0.95, T + h * 0.15, w * 1.02, -h * 0.7);
    ctx.bezierCurveTo(w * 1.03, -h * 0.55, w * 0.95, bangY + h * 0.1, w * 0.9, bangY + h * 0.12);
    ctx.bezierCurveTo(w * 0.5, bangY - h * 0.02, -w * 0.5, bangY, -w * 0.9, bangY + h * 0.12);
    ctx.closePath();
  } else if (Hr.kind === 'crop' && layer === 'front') {
    // 두상에 붙은 얇은 층: 얼굴선을 그대로 따라가고 이마 위에서 끝남
    const X = w * 1.01;
    ctx.moveTo(-X, bangY + h * 0.05); ctx.bezierCurveTo(-X, -h * 0.75, -w * 0.6, top, 0, top);
    ctx.bezierCurveTo(w * 0.6, top, X, -h * 0.75, X, bangY + h * 0.05);
    ctx.lineTo(w * 0.86, bangY + h * 0.05);
    ctx.bezierCurveTo(w * 0.7, bangY - h * 0.02, -w * 0.7, bangY - h * 0.02, -w * 0.86, bangY + h * 0.05);
    ctx.closePath();
  } else return false;
  return true;
}

// ── 귀 ──
export function earPath(ctx, F, E, sx) {
  const { w, h } = F, y = h * (E.y ?? 0.1);
  ctx.beginPath();
  if (E.kind === 'wing') {
    const out = sx * (w + E.size), top = y - E.size * 0.55, bot = y + E.size * 0.65, x0 = sx * w * 0.9;
    ctx.moveTo(x0, top + 0.02);
    ctx.bezierCurveTo(sx * (w + E.size * 0.3), top - 0.01, sx * (w + E.size * 0.8), top, out, top + E.size * 0.35);
    ctx.bezierCurveTo(sx * (w + E.size * 1.05), top + E.size * 0.7, sx * (w + E.size * 0.9), bot, sx * (w + E.size * 0.4), bot);
    ctx.bezierCurveTo(sx * (w + E.size * 0.15), bot + 0.01, x0, bot - 0.02, x0, bot - 0.05);
  } else {
    // 작은 귀: 얼굴 옆에 반쯤 묻힌 타원
    ctx.ellipse(sx * (w + E.size * 0.25), y, E.size * 0.55, E.size, 0, 0, Math.PI * 2);
  }
  ctx.closePath();
}

// ── 눈 ──
// kind: ring(흰 원+눈동자) | dot(점) | lid(눈꺼풀에 잘린 흰 원) | slit(틈)
export function drawEyes(ctx, F, Ey, col, expr, line) {
  const blink = clamp(expr.blink ?? 0, 0, 1), smile = clamp(expr.smile ?? 0, 0, 1);
  for (const sx of [-1, 1]) {
    ctx.save(); ctx.translate(sx * Ey.gap / 2, F.h * Ey.y); ctx.rotate(-(Ey.tilt || 0) * sx);
    const R = Ey.size;
    if (Ey.kind === 'dot') {
      const ry = Math.max(R * (1 - blink) * (1 - 0.3 * smile), R * 0.18);
      ctx.beginPath(); ctx.ellipse(0, 0, R * (1 + 0.1 * blink), ry, 0, 0, Math.PI * 2); ctx.fillStyle = col.ink; ctx.fill();
    } else if (Ey.kind === 'ring' || Ey.kind === 'lid') {
      const base = Ey.kind === 'lid' ? (Ey.lid ?? 0.45) : 0, cover = clamp(lerp(base, 1, blink) + 0.25 * smile * (1 - blink), 0, 1);
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fillStyle = col.white; ctx.fill();
      const pr = R * (Ey.pupil ?? 0.5);
      ctx.beginPath(); ctx.arc((Ey.gaze || 0) * (R - pr) * 0.8, R * 0.06, pr, 0, Math.PI * 2); ctx.fillStyle = col.ink; ctx.fill();
      if (cover > 0.01) {
        const lidY = -R + 2 * R * cover;
        ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R + 0.002, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = col.skin; ctx.fillRect(-R - 0.01, -R - 0.01, 2 * R + 0.02, lidY + R + 0.01);
        ctx.beginPath(); ctx.moveTo(-R - 0.01, lidY); ctx.lineTo(R + 0.01, lidY); ctx.lineWidth = line; ctx.strokeStyle = col.ink; ctx.stroke();
        ctx.restore();
      }
    } else if (Ey.kind === 'slit') {
      const hh = (Ey.h ?? R * 0.32) * (1 - blink) * (1 - 0.4 * smile);
      ctx.beginPath();
      if (hh > R * 0.05) { ctx.moveTo(-R, 0); ctx.quadraticCurveTo(0, -hh * 2, R, 0); ctx.quadraticCurveTo(0, hh * 1.2, -R, 0); ctx.fillStyle = col.ink; ctx.fill(); }
      else { ctx.moveTo(-R, 0); ctx.quadraticCurveTo(0, R * 0.2, R, 0); ctx.lineWidth = line; ctx.strokeStyle = col.ink; ctx.lineCap = 'round'; ctx.stroke(); }
    }
    ctx.restore();
  }
}

// ── 눈썹: thin(가는 선) | block(굵은 덩어리) ──
export function drawBrows(ctx, F, B, col, expr, line) {
  if (!B || B.kind === 'none') return;
  const raise = ((expr.open ?? 0) * 0.35 + (expr.smile ?? 0) * 0.15) * 0.05;
  for (const sx of [-1, 1]) {
    ctx.save(); ctx.translate(sx * B.gap / 2, F.h * B.y - raise); ctx.scale(sx, 1);
    ctx.strokeStyle = col.brow; ctx.fillStyle = col.brow; ctx.lineCap = 'round';
    ctx.beginPath();
    if (B.kind === 'thin') { ctx.moveTo(-B.w, B.angle * B.w * 0.5); ctx.quadraticCurveTo(0, -B.arch, B.w, -B.angle * B.w * 0.5); ctx.lineWidth = B.thick ?? line * 0.85; ctx.stroke(); }
    else { // block: 안쪽이 두껍고 바깥으로 갈수록 살짝 얇아지는 덩어리
      const t = B.thick;
      ctx.moveTo(-B.w, t * 0.5 + B.angle * B.w * 0.5); ctx.lineTo(-B.w, -t * 0.5 + B.angle * B.w * 0.5);
      ctx.quadraticCurveTo(0, -t * 0.6 - B.arch, B.w, -t * 0.35 - B.angle * B.w * 0.5);
      ctx.lineTo(B.w, t * 0.3 - B.angle * B.w * 0.5);
      ctx.quadraticCurveTo(0, t * 0.5 - B.arch * 0.6, -B.w, t * 0.5 + B.angle * B.w * 0.5);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
}

// ── 코: bent(긴 선, 끝에서 꺾임) | hook(갈고리 선) | wedge(짧은 쐐기 면) | bulb(둥근 면) | mark(짧은 표시) ──
export function drawNose(ctx, F, N, col, line) {
  const y0 = F.h * N.top, y1 = F.h * N.bottom, L = y1 - y0, s = N.side ?? -1;   // side: 꺾이는 방향
  ctx.save(); ctx.lineWidth = line; ctx.strokeStyle = col.ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  if (N.kind === 'bent') {
    ctx.moveTo(-s * 0.012, y0); ctx.bezierCurveTo(-s * 0.02, y0 + L * 0.4, -s * 0.026, y1 - L * 0.15, -s * 0.02, y1);
    ctx.bezierCurveTo(-s * 0.014, y1 + 0.03, s * 0.02, y1 + 0.03, s * N.w, y1 + 0.012); ctx.stroke();
  } else if (N.kind === 'hook') {
    ctx.moveTo(0, y0); ctx.quadraticCurveTo(-s * N.w * 0.5, y0 + L * 0.7, -s * N.w * 0.45, y1);
    ctx.quadraticCurveTo(-s * N.w * 0.35, y1 + N.w * 0.5, s * N.w * 0.5, y1 + N.w * 0.35); ctx.stroke();
  } else if (N.kind === 'wedge') {
    ctx.moveTo(0, y0); ctx.lineTo(-s * N.w, y1); ctx.lineTo(s * N.w * 0.35, y1); ctx.closePath(); ctx.fillStyle = col.shade; ctx.fill();
  } else if (N.kind === 'bulb') {
    ctx.ellipse(0, y1 - N.w * 0.7, N.w, N.w * 0.8, 0, 0, Math.PI * 2); ctx.fillStyle = col.shade; ctx.fill();
  } else if (N.kind === 'mark') {
    ctx.moveTo(0, y0); ctx.lineTo(0, y1); ctx.stroke();
  }
  ctx.restore();
}

// ── 입: 한 줄. w 반폭, curve(+ 미소, − 처짐), thick ──
export function drawMouth(ctx, F, M, col, expr, line) {
  const smile = clamp(expr.smile ?? 0, 0, 1), open = clamp(expr.open ?? 0, 0, 1);
  const w = M.w * (1 + 0.12 * smile), curve = (M.curve ?? 0) + smile * 0.8, y = F.h * M.y;
  ctx.save(); ctx.lineWidth = M.thick ?? line; ctx.strokeStyle = col.ink; ctx.fillStyle = col.ink; ctx.lineCap = 'round';
  ctx.beginPath();
  if (open > 0.03) {
    const hh = (M.openH ?? 0.12) * open;
    ctx.moveTo(-w, y); ctx.quadraticCurveTo(0, y - curve * w * 0.2, w, y); ctx.quadraticCurveTo(w * 0.9, y + hh, 0, y + hh * 1.15); ctx.quadraticCurveTo(-w * 0.9, y + hh, -w, y); ctx.closePath(); ctx.fill();
  } else { ctx.moveTo(-w, y); ctx.quadraticCurveTo(0, y + curve * w * 0.45, w, y); ctx.stroke(); }
  ctx.restore();
}

export function drawGlasses(ctx, F, G, col, line) {
  if (!G) return;
  ctx.save(); ctx.lineWidth = G.rim ?? line * 1.5; ctx.strokeStyle = col.ink; ctx.fillStyle = G.tint ? mix(col.skin, col.white, 0.4) : 'transparent'; ctx.lineJoin = 'round';
  const y = F.h * G.y;
  for (const sx of [-1, 1]) {
    ctx.save(); ctx.translate(sx * G.gap / 2, y); ctx.scale(sx, 1); ctx.beginPath();
    if (G.kind === 'round') ctx.arc(0, 0, G.w, 0, Math.PI * 2);
    else if (G.kind === 'square') ctx.roundRect(-G.w, -G.h, 2 * G.w, 2 * G.h, G.w * 0.25);
    else { ctx.moveTo(-G.w, -G.h * 0.9); ctx.lineTo(G.w, -G.h); ctx.quadraticCurveTo(G.w, G.h * 0.7, G.w * 0.35, G.h); ctx.quadraticCurveTo(-G.w * 0.6, G.h, -G.w, G.h * 0.5); ctx.closePath(); }
    if (G.tint) ctx.fill(); ctx.stroke(); ctx.restore();
  }
  ctx.beginPath(); ctx.moveTo(-(G.gap / 2 - G.w), y - (G.h ?? G.w) * 0.4); ctx.lineTo(G.gap / 2 - G.w, y - (G.h ?? G.w) * 0.4); ctx.stroke();
  ctx.restore();
}

export function drawMustache(ctx, F, M, col) {
  if (!M) return;
  const y = F.h * M.y, w = M.w, hh = M.h;
  ctx.fillStyle = col.hair; ctx.beginPath();
  ctx.moveTo(0, y - hh * 0.2);
  ctx.bezierCurveTo(w * 0.5, y - hh * 0.6, w * 0.95, y - hh * 0.2, w, y + hh * 0.5);
  ctx.bezierCurveTo(w * 0.75, y + hh * 0.75, w * 0.35, y + hh * 0.6, 0, y + hh * 0.85);
  ctx.bezierCurveTo(-w * 0.35, y + hh * 0.6, -w * 0.75, y + hh * 0.75, -w, y + hh * 0.5);
  ctx.bezierCurveTo(-w * 0.95, y - hh * 0.2, -w * 0.5, y - hh * 0.6, 0, y - hh * 0.2);
  ctx.closePath(); ctx.fill();
}

// 목: 턱 뒤로 들어가는 짧은 기둥. 폭은 턱 폭에 비례
function drawNeck(ctx, F, Nk, col) {
  const { w, h } = F, nw = w * (Nk?.w ?? 0.42), len = Nk?.len ?? 0.6;
  ctx.fillStyle = col.skin; ctx.beginPath();
  ctx.moveTo(-nw, h * 0.72); ctx.lineTo(nw, h * 0.72);
  ctx.bezierCurveTo(nw * 1.02, h * 1.0, nw * 1.06, h * (1 + len * 0.6), nw * 1.1, h * (1 + len));
  ctx.lineTo(-nw * 1.1, h * (1 + len));
  ctx.bezierCurveTo(-nw * 1.06, h * (1 + len * 0.6), -nw * 1.02, h * 1.0, -nw, h * 0.72);
  ctx.closePath(); ctx.fill();
}

// 캐릭터 하나. spec = { face, hair, ears, eyes, brows, nose, mouth, glasses, mustache, neck, line }
export function drawHead(ctx, spec, pal, expr = {}, x = 0, y = 0, scale = 100) {
  const F = spec.face, line = spec.line ?? 0.026;
  const col = { skin: pal.skin, hair: pal.hair, ink: pal.ink || INK, white: '#FFFFFF', brow: pal.brow || pal.hair, shade: mix(pal.skin, pal.ink || INK, 0.22) };
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  drawNeck(ctx, F, spec.neck, col);
  ctx.fillStyle = col.hair; if (hairPath(ctx, F, spec.hair || {}, 'back')) ctx.fill();
  if (spec.ears && spec.ears.kind !== 'hidden') { ctx.fillStyle = col.skin; for (const sx of [-1, 1]) { earPath(ctx, F, spec.ears, sx); ctx.fill(); } }
  facePath(ctx, F); ctx.fillStyle = col.skin; ctx.fill();
  if (spec.ears && spec.ears.kind === 'wing' && spec.ears.fold !== false) {
    ctx.strokeStyle = col.ink; ctx.lineWidth = line;
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * (F.w + spec.ears.size * 0.2), F.h * spec.ears.y + spec.ears.size * 0.1); ctx.lineTo(sx * (F.w + spec.ears.size * 0.7), F.h * spec.ears.y + spec.ears.size * 0.06); ctx.stroke(); }
  }
  ctx.fillStyle = col.hair; if (hairPath(ctx, F, spec.hair || {}, 'front')) ctx.fill();
  drawBrows(ctx, F, spec.brows, col, expr, line);
  drawEyes(ctx, F, spec.eyes, col, expr, line);
  drawNose(ctx, F, spec.nose, col, line);
  drawMustache(ctx, F, spec.mustache, col);
  drawMouth(ctx, F, spec.mouth, col, expr, line);
  drawGlasses(ctx, F, spec.glasses, col, line);
  ctx.restore();
}
