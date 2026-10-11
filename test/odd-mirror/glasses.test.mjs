// 안경 판단의 기본 동작 확인 (합성 영상). 실제 카메라 정확도 검증이 아니다.
// 실행: node test/odd-mirror/glasses.test.mjs
import { load } from './extract.mjs';
import { shapeFace, project, observe, rng, gauss } from './synth.mjs';

const G = load(['STYLE', 'GEOM', 'SHAPE', 'EXPR', 'HAIR', 'GLASSES'], [
  'CANON_IMG', 'EYE_MID', 'U', 'LM', 'fitPose', 'frontalize', 'referenceFace', 'GL', 'glassesEvidence', 'glassesUpdate', 'createGlassesState', 'fitLensShape',
]);
const { GL } = G;
const F = observe(G, project(G, shapeFace(G, {}), {})).F;

function inPoly(px, py, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function segDist(px, py, pts, closed) {
  let best = 1e9;
  const n = pts.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n], ex = bx - ax, ey = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey || 1)));
    best = Math.min(best, Math.hypot(px - ax - t * ex, py - ay - t * ey));
  }
  return best;
}
const superPts = (cx, cy, a, b, nT, nB, n = 72) => Array.from({ length: n }, (_, i) => {
  const th = (i / n) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th), e = s < 0 ? nT : nB;
  return [cx + a * Math.sign(c) * Math.abs(c) ** (2 / e), cy + b * Math.sign(s) * Math.abs(s) ** (2 / e)];
});

// 얼굴 바탕(피부·눈·눈썹·쌍꺼풀 주름·눈밑 선·코 옆 그림자) + 선택: 안경, 조명 그림자
function scene({ glasses = null, shadow = false }) {
  const { w, h, ppu } = GL, img = new Float32Array(w * h);
  const eyes = [G.LM.eyeR, G.LM.eyeL].map((E) => {
    const poly = [E.outer, ...E.up, E.inner, ...E.lo.slice().reverse()].map((i) => [F[2 * i], F[2 * i + 1]]);
    const up = [E.outer, ...E.up, E.inner].map((i) => [F[2 * i], F[2 * i + 1]]);
    const cx = (F[2 * E.outer] + F[2 * E.inner]) / 2, cy = (F[2 * E.outer + 1] + F[2 * E.inner + 1]) / 2;
    return { poly, up, crease: up.map(([x, y]) => [x, y - 0.075]), bag: up.map(([x, y]) => [x, cy + (cy - y) + 0.13]), cx, cy };
  });
  const brows = [G.LM.browR, G.LM.browL].map((B) => [...B.up, ...B.lo.slice().reverse()].map((i) => [F[2 * i], F[2 * i + 1]]));
  let rims = [];
  if (glasses) {
    const g = glasses;
    for (const e of eyes) rims.push({ pts: superPts(e.cx + Math.sign(e.cx) * g.dx, e.cy + g.dy, g.a, g.b, g.nT, g.nB), closed: true });
    const inner = eyes.map((e) => [e.cx + Math.sign(e.cx) * g.dx - Math.sign(e.cx) * g.a, e.cy + g.dy - g.b * 0.3]);
    rims.push({ pts: Array.from({ length: 9 }, (_, i) => { const t = i / 8; return [inner[0][0] + (inner[1][0] - inner[0][0]) * t, inner[0][1] - Math.sin(Math.PI * t) * 0.05]; }), closed: false });
    for (const e of eyes) { const sx = Math.sign(e.cx); rims.push({ pts: [[e.cx + sx * (g.dx + g.a), e.cy + g.dy - g.b * 0.35], [sx * 1.3, e.cy - 0.12]], closed: false }); }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = GL.x0 + (x + 0.5) / ppu, Y = GL.y0 + (y + 0.5) / ppu;
    let v = 168 + X * 12;
    for (const e of eyes) {
      if (shadow) v -= 55 * Math.exp(-((X - e.cx) ** 2 + ((Y - e.cy + 0.05) / 0.8) ** 2) / (2 * 0.24 * 0.24));
      if (inPoly(X, Y, e.poly)) v = Math.hypot(X - e.cx, Y - e.cy) < 0.085 ? 45 : 205;
      const dl = segDist(X, Y, e.up, false); if (dl < 0.02) v = Math.min(v, 55);
      const dc = segDist(X, Y, e.crease, false); if (dc < 0.012) v -= 28;
      const db = segDist(X, Y, e.bag, false); if (db < 0.02) v -= 14;
    }
    for (const b of brows) if (inPoly(X, Y, b)) v = Math.min(v, 70);
    for (const sx of [-1, 1]) v -= 20 * Math.exp(-((X - sx * 0.2) ** 2) / (2 * 0.05 * 0.05)) * (Y > -0.1 ? 1 : 0.3);
    if (glasses) {
      const hw = glasses.width / 2;
      let d = 1e9;
      for (const r of rims) d = Math.min(d, segDist(X, Y, r.pts, r.closed));
      const cover = Math.max(0, Math.min(1, (hw - d) * ppu + 0.5));
      v = v * (1 - cover) + glasses.color * cover;
    }
    img[y * w + x] = v;
  }
  return img;
}

function frame(base, r, gain = 1) {
  const out = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) out[i] = Math.max(0, Math.min(255, base[i] * gain + gauss(r) * 4));
  return out;
}

const CASES = {
  '안경 없음': null,
  '안경 없음 + 눈 주변 그림자': { shadowOnly: true },
  '둥근 테': { a: 0.34, b: 0.3, nT: 2, nB: 2, dx: 0.02, dy: 0.02, width: 0.04, color: 40 },
  '사각 테': { a: 0.4, b: 0.26, nT: 5, nB: 5, dx: 0.04, dy: 0.03, width: 0.045, color: 35 },
  '낮은 사각 테': { a: 0.38, b: 0.19, nT: 5, nB: 5, dx: 0.02, dy: 0.02, width: 0.03, color: 55 },
  '얇은 테(금속, 밝음)': { a: 0.36, b: 0.28, nT: 3, nB: 3, dx: 0.02, dy: 0.02, width: 0.017, color: 225 },
  '사각 테 + 그림자': { a: 0.4, b: 0.26, nT: 5, nB: 5, dx: 0.04, dy: 0.03, width: 0.045, color: 35, shadow: true },
};

const STEP = 120;
const results = [];
for (const [name, c] of Object.entries(CASES)) {
  const r = rng(name.length * 7 + 1);
  const shadow = !!(c && (c.shadow || c.shadowOnly));
  const hasGlasses = !!(c && !c.shadowOnly);
  const bare = scene({ shadow });
  const worn = hasGlasses ? scene({ glasses: c, shadow }) : null;
  const st = G.createGlassesState();
  const seq = hasGlasses ? [...Array(10).fill(bare), ...Array(50).fill(worn), ...Array(60).fill(bare)] : Array(80).fill(bare);
  let t = 0, onAt = null, offAt = null, shapeAt = null, maxScoreBare = 0, lastShape = null, statusAtEnd = '', lastFitWhy = '';
  const details = [];
  seq.forEach((img, k) => {
    t += STEP;
    const ev = G.glassesEvidence(frame(img, r, 0.95 + r() * 0.1), F, null);
    G.glassesUpdate(st, ev, STEP, t, true);
    const phase = !hasGlasses ? 'bare' : k < 10 ? 'before' : k < 60 ? 'worn' : 'after';
    if (phase !== 'worn') maxScoreBare = Math.max(maxScoreBare, ev.score);
    if (phase === 'worn' && st.worn && onAt == null) onAt = t - 10 * STEP;
    if (phase === 'worn' && st.shape && shapeAt == null) shapeAt = t - 10 * STEP;
    if (phase === 'worn' && k === 59) { lastShape = st.shape && { ...st.shape }; statusAtEnd = st.status; lastFitWhy = st.lastFit && !st.lastFit.ok ? st.lastFit.why : ''; }
    if (phase === 'after' && !st.worn && offAt == null) offAt = t - 60 * STEP;
    if (k === 0 || k === 30 || k === 90) details.push({ k, score: +ev.score.toFixed(2), ...Object.fromEntries(Object.entries(ev.detail).map(([a, v]) => [a, v == null ? v : +v.toFixed(2)])) });
  });
  results.push({ name, hasGlasses, c, onAt, offAt, shapeAt, maxScoreBare, lastShape, statusAtEnd, lastFitWhy, wornAtEnd: st.worn, details });
}

let fails = 0;
const ok = (cond, label, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${info ? `  — ${info}` : ''}`); if (!cond) fails++; };
for (const R of results) {
  console.log(`\n[${R.name}]`);
  for (const d of R.details) console.log(`      프레임 ${d.k}: 점수 ${d.score}  아래테 ${d.lower} 바깥테 ${d.outer} 위테 ${d.upper} 연속 ${d.run} 좌우 ${d.lr} 브리지 ${d.bridge}`);
  if (!R.hasGlasses) {
    ok(!R.wornAtEnd && R.onAt == null, '안경으로 오인하지 않음', `최고 점수 ${R.maxScoreBare.toFixed(2)} (켜짐 기준 ${GL.onScore})`);
    continue;
  }
  ok(R.onAt != null && R.onAt <= 800, '착용 인식', R.onAt == null ? '인식 못 함' : `${R.onAt}ms`);
  const s = R.lastShape, c = R.c;
  const cls = (n) => (n < 2.8 ? 0 : n < 4.2 ? 1 : 2);  // 둥근 / 부드러운 사각 / 각진
  const sizeOk = s && Math.abs(s.a - c.a) < 0.07 && Math.abs(s.b - c.b) < 0.07;
  const cornerOk = s && cls(s.nB) === cls(c.nB) && (s.topGuessed || cls(s.nT) === cls(c.nT));
  ok(!!sizeOk, '렌즈 크기·비율 (가로·세로 ±0.07)', s ? `${s.a.toFixed(2)}×${s.b.toFixed(2)} / 실제 ${c.a}×${c.b}` : `형태 없음 — ${R.statusAtEnd} ${R.lastFitWhy}`);
  ok(!!cornerOk, '모서리 둥글기 (둥근/부드러운/각진 3단계, 윗테가 안 보이면 추정 표시)', s ? `추정 가로 ${s.a.toFixed(2)}/${c.a} 세로 ${s.b.toFixed(2)}/${c.b} 위모서리 ${s.nT.toFixed(1)}/${c.nT} 아래 ${s.nB.toFixed(1)}/${c.nB} ${s.thick ? '굵은' : '얇은'} ${s.dark ? '어두운' : '밝은'} 테${s.topGuessed ? ', 위 모서리는 추정' : ''}, ${R.shapeAt}ms에 확정` : `형태 없음 — ${R.statusAtEnd} ${R.lastFitWhy}`);
  ok(!R.wornAtEnd && R.offAt != null && R.offAt <= 1500, '벗으면 해제되고 이전 형태가 남지 않음', R.offAt == null ? `벗은 뒤 ${60 * STEP / 1000}초가 지나도 착용 상태` : `${R.offAt}ms 뒤 해제`);
  ok(R.maxScoreBare < GL.onScore, '안경 전/후 맨얼굴 점수가 켜짐 기준 아래', R.maxScoreBare.toFixed(2));
}
console.log(`\n${fails ? `실패 ${fails}개` : '모두 통과'} (합성 영상 기본 동작 확인 — 실제 카메라 정확도는 검증하지 않음)`);
process.exitCode = fails ? 1 : 0;
