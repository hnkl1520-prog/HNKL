// 합성 얼굴: 표준 얼굴(CANON)을 비율·표정대로 변형하고, 카메라 원근으로 투영해 MediaPipe 와 같은 모양의 랜드마크를 만든다.
// 모델 없이 '측정 → 기본 형태 → 그림' 흐름을 확인하기 위한 도구. 실제 카메라 정확도와는 무관하다.
// G: extract.mjs 로 불러온 앱 구역들 (CANON_IMG, EYE_MID, U, LM ...)

const sm = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// 결정적 난수 (같은 씨앗 → 같은 흔들림)
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296); };
}
export function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }

// 사람 (형태) — 값은 머리 단위의 대략적 변형량
export const PEOPLE = {
  보통: {},
  둥근얼굴_큰눈: { fw: 0.12, jw: 0.1, cl: -0.12, es: 0.18, eo: 0.7, nw: -0.1, mw: -0.12 },
  긴얼굴_긴코: { fw: -0.08, jw: -0.12, cl: 0.25, fh: 0.12, nl: 0.1, nw: 0.08, es: -0.05, eo: -0.5, mw: 0.05, lt: -0.4 },
  각진턱_가는눈: { jw: 0.24, fw: 0.05, eo: -0.55, es: 0.02, bt: 0.04, by: 0.04, mw: 0.12, lt: 0.3 },
  작은턱_넓은미간: { jw: -0.2, cl: -0.05, eg: 0.07, es: 0.08, nw: -0.05, mw: -0.18, lt: 0.9, by: -0.05 },
  두꺼운입술_넓은코: { nw: 0.28, nl: -0.04, lt: 1.0, mw: 0.1, bt: 0.03, eo: 0.1 },
};

export function toHead(G) {
  const n = 468, H = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    H[3 * i] = G.CANON_IMG[3 * i] / G.U;
    H[3 * i + 1] = (G.CANON_IMG[3 * i + 1] - G.EYE_MID[1]) / G.U;
    H[3 * i + 2] = (G.CANON_IMG[3 * i + 2] - G.EYE_MID[2]) / G.U;
  }
  return H;
}

const LOWER_INNER = [14, 87, 178, 88, 95, 317, 402, 318, 324];
const UPPER_OUTER = [0, 37, 267, 39, 269, 40, 270, 185, 409];
const LOWER_OUTER = [17, 84, 314, 181, 405, 91, 321, 146, 375];
const CHEEK = [50, 280, 205, 425, 36, 266, 187, 411, 101, 330, 118, 347];

// 형태 변형 + 표정. 반환: 머리 단위 478×3 (홍채 10점 포함)
export function shapeFace(G, shape = {}, expr = {}) {
  const H = toHead(G), n = 468;
  const g = (k) => shape[k] || 0, x = (k) => expr[k] || 0;
  const eyeC = [[-0.5, 0], [0.5, 0]];
  const all = (fn) => { for (let i = 0; i < n; i++) fn(i); };
  all((i) => {
    let X = H[3 * i], Y = H[3 * i + 1];
    const ax = Math.abs(X), sx = Math.sign(X) || 1;
    X *= 1 + g('fw') * sm(0.35, 1.1, ax) * (1 - sm(1.2, 1.9, Y));
    X *= 1 + g('jw') * sm(0.5, 1.3, Y) * sm(0.3, 0.9, ax);
    if (Y > 1.0) Y += g('cl') * sm(1.0, 1.9, Y) * ((Y - 1.0) / 0.9);
    if (Y < -0.4) Y -= g('fh') * sm(0.4, 0.9, -Y);
    for (const [cx, cy] of eyeC) {
      const d = Math.hypot(X - cx, Y - cy);
      if (d < 0.45 && Math.sign(X) === Math.sign(cx)) {
        const w = 1 - sm(0.25, 0.45, d);
        X = cx + (X - cx) * (1 + g('es') * w); Y = cy + (Y - cy) * (1 + g('es') * w);
        X += sx * g('eg') * w;
      }
    }
    if (ax < 0.45 && Y > 0.35 && Y < 0.85) X *= 1 + g('nw') * (1 - sm(0.2, 0.45, ax));
    if (ax < 0.4 && Y > 0.1 && Y < 1.0) Y += g('nl') * sm(0.1, 0.75, Y) * (1 - sm(0.8, 1.0, Y));
    if (ax < 0.65 && Y > 0.85 && Y < 1.4) X *= 1 + g('mw') * (1 - sm(0.45, 0.65, ax));
    H[3 * i] = X; H[3 * i + 1] = Y;
  });
  for (const E of [G.LM.eyeR, G.LM.eyeL]) {
    for (const i of E.up) H[3 * i + 1] -= g('eo') * 0.045;
    for (const i of E.lo) H[3 * i + 1] += g('eo') * 0.02;
  }
  for (const B of [G.LM.browR, G.LM.browL]) {
    for (const i of B.up) H[3 * i + 1] += g('by') - g('bt') / 2;
    for (const i of B.lo) H[3 * i + 1] += g('by') + g('bt') / 2;
  }
  for (const i of UPPER_OUTER) H[3 * i + 1] -= g('lt') * 0.025;
  for (const i of LOWER_OUTER) H[3 * i + 1] += g('lt') * 0.035;

  // 표정
  const s = x('smile'), o = x('open'), p = x('pucker');
  if (s) {
    all((i) => {
      const X = H[3 * i], Y = H[3 * i + 1];
      for (const c of [61, 291]) {
        const d = Math.hypot(X - H[3 * c], Y - H[3 * c + 1]);
        if (d < 0.3) { const w = 1 - sm(0.05, 0.3, d); H[3 * i + 1] -= s * 0.09 * w; H[3 * i] += Math.sign(X) * s * 0.05 * w; }
      }
    });
    for (const i of CHEEK) H[3 * i + 1] -= s * 0.04;
    for (const E of [G.LM.eyeR, G.LM.eyeL]) for (const i of E.lo) H[3 * i + 1] -= s * 0.018;
  }
  if (x('smileR')) for (const c of [61]) all((i) => { const d = Math.hypot(H[3 * i] - H[3 * c], H[3 * i + 1] - H[3 * c + 1]); if (d < 0.3) H[3 * i + 1] -= x('smileR') * 0.09 * (1 - sm(0.05, 0.3, d)); });
  if (o) {
    const upperInnerY = (H[3 * 13 + 1] + H[3 * 78 + 1]) / 2, lowerInner = new Set(LOWER_INNER);
    all((i) => {
      const X = H[3 * i], Y = H[3 * i + 1];
      if (!lowerInner.has(i) && (Y <= upperInnerY + 0.02 || Math.abs(X) > 1.25)) return;
      const w = (lowerInner.has(i) ? 1 : sm(upperInnerY + 0.02, upperInnerY + 0.07, Y)) * (1 - 0.6 * sm(0.5, 1.2, Math.abs(X)));
      H[3 * i + 1] += o * 0.42 * w;
    });
  }
  if (p) all((i) => { const X = H[3 * i], Y = H[3 * i + 1]; if (Math.abs(X) < 0.7 && Y > 0.85 && Y < 1.45) H[3 * i] = X * (1 - p * 0.32 * (1 - sm(0.4, 0.7, Math.abs(X)))); });
  for (const [E, side, key] of [[G.LM.eyeR, -1, 'blinkR'], [G.LM.eyeL, 1, 'blinkL']]) {
    const b = Math.max(x('blink'), x(key));
    if (!b) continue;
    for (let k = 0; k < E.up.length; k++) H[3 * E.up[k] + 1] = H[3 * E.up[k] + 1] + (H[3 * E.lo[k] + 1] - H[3 * E.up[k] + 1]) * b * 0.97;
  }
  if (x('brow')) for (const B of [G.LM.browR, G.LM.browL]) for (const i of [...B.up, ...B.lo]) H[3 * i + 1] -= x('brow') * 0.08;

  // 홍채 (468~472: 이미지 왼쪽 눈, 473~477: 오른쪽 눈) + 시선
  const out = new Float64Array(478 * 3);
  out.set(H);
  const irisOf = (E, base) => {
    let cx = 0, cy = 0, cz = 0;
    const ids = [E.outer, E.inner];
    for (const i of ids) { cx += H[3 * i] / 2; cy += H[3 * i + 1] / 2; cz += H[3 * i + 2] / 2; }
    const hw = Math.abs(H[3 * E.outer] - H[3 * E.inner]) / 2;
    cx += (expr.gazeX || 0) * hw * 0.3; cy += (expr.gazeY || 0) * hw * 0.2;
    const r = 0.09;
    const pts = [[cx, cy], [cx + r, cy], [cx, cy - r], [cx - r, cy], [cx, cy + r]];
    pts.forEach(([px, py], k) => { out[3 * (base + k)] = px; out[3 * (base + k) + 1] = py; out[3 * (base + k) + 2] = cz - 0.05; });
  };
  irisOf(G.LM.eyeR, 468); irisOf(G.LM.eyeL, 473);
  return out;
}

// 머리 단위 → 카메라 랜드마크(MediaPipe 형식 {x,y,z} 정규화)
export function project(G, Hd, { yaw = 0, pitch = 0, roll = 0, dist = 55, offX = 0, offY = 0, vw = 1280, vh = 720, fov = 55, noisePx = 0, r = null } = {}) {
  const f = vh / 2 / Math.tan((fov * Math.PI) / 360);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const mul = (A, B) => { const C = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[3 * i + j] += A[3 * i + k] * B[3 * k + j]; return C; };
  const R = mul([cr, -sr, 0, sr, cr, 0, 0, 0, 1], mul([1, 0, 0, 0, cp, -sp, 0, sp, cp], [cy, 0, sy, 0, 1, 0, -sy, 0, cy]));
  const n = Hd.length / 3, lm = [], s0 = f / dist;
  for (let i = 0; i < n; i++) {
    const qx = Hd[3 * i] * G.U, qy = Hd[3 * i + 1] * G.U + G.EYE_MID[1], qz = Hd[3 * i + 2] * G.U + G.EYE_MID[2];
    const rx = R[0] * qx + R[1] * qy + R[2] * qz, ry = R[3] * qx + R[4] * qy + R[5] * qz, rz = R[6] * qx + R[7] * qy + R[8] * qz;
    const Z = dist + rz;
    let px = vw / 2 + (f * (rx + offX)) / Z, py = vh / 2 + (f * (ry + offY)) / Z, pz = s0 * rz;
    if (noisePx && r) { px += gauss(r) * noisePx; py += gauss(r) * noisePx; pz += gauss(r) * noisePx * 2; }
    lm.push({ x: px / vw, y: py / vh, z: pz / vw });
  }
  return lm;
}

export function blendshapes(expr = {}) {
  const b = Math.max(expr.blink || 0);
  return {
    jawOpen: (expr.open || 0) * 0.8, mouthSmileLeft: expr.smile || 0, mouthSmileRight: (expr.smile || 0) + (expr.smileR || 0) * 0.8,
    eyeBlinkLeft: Math.max(b, expr.blinkL || 0), eyeBlinkRight: Math.max(b, expr.blinkR || 0), mouthPucker: expr.pucker || 0, browInnerUp: (expr.brow || 0) * 0.7,
    eyeSquintLeft: (expr.smile || 0) * 0.4, eyeSquintRight: (expr.smile || 0) * 0.4,
  };
}

// 관측 프레임 하나를 앱과 같은 순서로 처리
export function observe(G, lm, vw = 1280, vh = 720) {
  const P = new Float64Array(478 * 3);
  lm.forEach((p, i) => { P[3 * i] = p.x * vw; P[3 * i + 1] = p.y * vh; P[3 * i + 2] = p.z * vw; });
  const pose = G.fitPose(P);
  const F = G.frontalize(P, lm.length, pose, new Float32Array(lm.length * 2));
  const ref = G.referenceFace(pose, vw, vh, 55);
  return { P, pose, F, ref };
}

// 한 사람을 스캔: 정면 근처에서 조금씩 흔들리는 프레임들
export function scanPerson(G, shape, { seed = 7, frames = 24, noisePx = 0.6, jitterAngle = 0.05, dist = 55, clipTop = 0, occlusion = null } = {}) {
  const r = rng(seed), scan = G.createShapeScan();
  const Hd = shapeFace(G, shape, {});
  for (let k = 0; k < frames; k++) {
    const lm = project(G, Hd, { yaw: gauss(r) * jitterAngle, pitch: gauss(r) * jitterAngle, roll: gauss(r) * 0.05, dist, offY: clipTop, noisePx, r });
    const o = observe(G, lm);
    G.shapeAddSample(scan, o.P, o.F, o.pose, o.ref, {}, 1280, 720, k * 100);
  }
  return G.shapeFinalize(scan, occlusion || (() => null));
}

// 합성 분할 지도 (머리 좌표 정사각형 segPx²). style: short | bowl | long | bald | side
export function synthHairMasks(G, geo, style, { clipAboveY = null, seed = 3 } = {}) {
  const S = G.HAIR.segPx, cs = (G.HAIR.x1 - G.HAIR.x0) / S, r = rng(seed);
  const head = G.headOutline(geo);
  const hair = new Float32Array(S * S), face = new Float32Array(S * S), body = new Float32Array(S * S), others = new Float32Array(S * S), valid = new Uint8Array(S * S);
  const inPoly = (px, py, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const skullR = (X, Y, grow) => ((X / (geo.foreW + grow)) ** 2 + ((Y - (head.skullTop + 1.25)) / (1.25 + grow * 1.1)) ** 2) < 1;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const X = G.HAIR.x0 + (x + 0.5) * cs, Y = G.HAIR.y0 + (y + 0.5) * cs, i = y * S + x;
    valid[i] = clipAboveY != null && Y < clipAboveY ? 0 : 1;
    const inHead = inPoly(X, Y, head.poly);
    let h = 0;
    const ax = Math.abs(X);
    if (style === 'short') h = skullR(X, Y, 0.18) && Y < -0.55 - 0.25 * (ax / geo.foreW) ** 2 ? 1 : 0;
    if (style === 'bowl') h = skullR(X, Y, 0.28) && Y < -0.3 + (ax > geo.foreW * 0.8 ? 0.35 : 0) ? 1 : 0;
    if (style === 'side') h = skullR(X, Y, 0.3) && Y < -0.7 + (X < 0 ? 0.45 * sm(-1.1, -0.2, X) : 0) && !(X > 0.2 && Y > -0.9 && inHead) ? 1 : 0;
    if (style === 'long') h = (skullR(X, Y, 0.22) && Y < -0.62 - 0.2 * (ax / geo.foreW) ** 2) || (ax > geo.faceW - 0.1 && ax < geo.faceW + 0.32 && Y > -1.2 && Y < 2.7) ? 1 : 0;
    if (h && inHead && style === 'long' && Y > -0.6) h = 0;
    const noise = (r() - 0.5) * 0.15;
    hair[i] = Math.min(1, Math.max(0, h * 0.95 + noise * (h ? 1 : 0.3)));
    face[i] = inHead && !h ? 0.9 : 0;
    body[i] = !inHead && !h && Y > geo.chinY - 0.1 && ax < 0.5 ? 0.9 : 0;
  }
  return { masks: { hair, face, body, others }, valid };
}
