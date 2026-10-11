// 모델 없이 도는 계산 검증 (좌표·기본 형태·신뢰도·표정·헤어)
// 실행: node test/odd-mirror/logic.test.mjs
import { load } from './extract.mjs';
import { PEOPLE, shapeFace, project, observe, scanPerson, blendshapes, synthHairMasks, rng } from './synth.mjs';

const G = load(['STYLE', 'GEOM', 'SHAPE', 'EXPR', 'HAIR', 'GLASSES'], [
  'CANON_IMG', 'EYE_MID', 'U', 'LM', 'fitPose', 'frontalize', 'referenceFace', 'headToImage', 'headCropTransform',
  'createShapeScan', 'shapeAddSample', 'shapeFinalize', 'measureTraits', 'TRAITS', 'TEMPLATE', 'PARTS', 'identityDistance',
  'exprTarget', 'exprUpdate', 'neutralExpr', 'eyeMeasure',
  'HAIR', 'createHairModel', 'hairAddSample', 'hairProfile', 'hairCommit', 'hairDisplayStep', 'headOutline', 'polyRadius',
]);
const D = load(['STYLE', 'GEOM', 'SHAPE', 'EXPR', 'HAIR', 'DRAW'], ['mouthGeometry', 'eyeWhiteAmount']);

let fails = 0;
const ok = (cond, name, info = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info ? `  — ${info}` : ''}`); if (!cond) fails++; };
const f3 = (v) => (typeof v === 'number' ? v.toFixed(3) : v);

console.log('\n[1] 좌표: 고개 각도가 달라도 같은 사람은 같은 기본 형태');
{
  const s = PEOPLE.긴얼굴_긴코;
  const a = scanPerson(G, s, { seed: 1 });
  const scanTurned = G.createShapeScan(), r = rng(5), Hd = shapeFace(G, s);
  for (let k = 0; k < 24; k++) {
    const lm = project(G, Hd, { yaw: 0.18 + (r() - 0.5) * 0.04, pitch: -0.12, roll: 0.25, dist: 70, offX: 8, noisePx: 0.6, r });
    const o = observe(G, lm);
    G.shapeAddSample(scanTurned, o.P, o.F, o.pose, o.ref, {}, 1280, 720, k * 100);
  }
  const b = G.shapeFinalize(scanTurned);
  let worst = 0, worstK = '';
  for (const k in G.TRAITS) { const d = Math.abs(a.traits[k].dev - b.traits[k].dev) / G.TRAITS[k][1]; if (d > worst) { worst = d; worstK = k; } }
  ok(worst < 1, '정면(55cm) vs 옆 18°·위 7°·기울기 14°(70cm) 차이가 모든 수치에서 "보이기 시작하는 차이" 미만', `최대 ${worstK} ${f3(worst)} JND`);
}

console.log('\n[2] 기본 형태: 사람별 특징 방향');
const expect = {
  둥근얼굴_큰눈: { faceW: 1, eyeW: 1, eyeOpen: 1, chinY: -1 },
  긴얼굴_긴코: { chinY: 1, noseY: 1, jawW: -1, eyeOpen: -1 },
  각진턱_가는눈: { jawW: 1, eyeOpen: -1, mouthW: 1 },
  작은턱_넓은미간: { jawW: -1, eyeGap: 1, mouthW: -1, loLip: 1 },
  두꺼운입술_넓은코: { noseW: 1, loLip: 1, upLip: 1 },
};
const shapes = {};
for (const name in PEOPLE) {
  const sh = (shapes[name] = scanPerson(G, PEOPLE[name], { seed: name.length * 13 }));
  const exp = expect[name] || {};
  const wrong = Object.entries(exp).filter(([k, sgn]) => Math.sign(sh.traits[k].dev) !== sgn || sh.traits[k].sal < 1);
  const provs = G.PARTS.map((p) => `${p}:${sh.parts[p].c.toFixed(2)}`).join(' ');
  ok(wrong.length === 0, `${name}: 특징 방향과 크기`, wrong.length ? `틀림 ${wrong.map(([k]) => `${k}=${f3(sh.traits[k].dev)}`).join(', ')}` : `강조 ${sh.emphasis.join(',') || '-'} | ${provs}`);
  const notObs = G.PARTS.filter((p) => sh.parts[p].prov !== 'observed');
  ok(notObs.length === 0, `${name}: 깨끗한 조건에서 모든 부위 '관측'`, `부분추정 ${Math.round(sh.estimatedShare * 100)}%` + notObs.map((p) => ` ${p} ${f3(sh.parts[p].c)} ${JSON.stringify(Object.fromEntries(Object.entries(sh.parts[p].f).map(([k, v]) => [k, +(+v).toFixed(2)])))}`).join(''));
}
{
  const n = shapes.보통;
  const maxSal = Math.max(...Object.keys(G.TRAITS).map((k) => n.traits[k].sal));
  const top = Object.keys(G.TRAITS).sort((a, b) => n.traits[b].sal - n.traits[a].sal)[0];
  ok(maxSal < 1.5, '보통 얼굴은 두드러진 특징 없음', `최대 ${top} ${f3(maxSal)} JND`);
}

console.log('\n[3] 신뢰도: 흔들림만이 아니라 잘림·가림·각도·부위 관계로도 낮아짐');
{
  // 턱이 화면 아래로 잘림
  const clipped = scanPerson(G, PEOPLE.보통, { seed: 3, dist: 28 });
  const clipped2 = (() => {
    const scan = G.createShapeScan(), r = rng(9), Hd = shapeFace(G, PEOPLE.보통);
    for (let k = 0; k < 24; k++) { const o = observe(G, project(G, Hd, { dist: 40, offY: 13, noisePx: 0.6, r })); G.shapeAddSample(scan, o.P, o.F, o.pose, o.ref, {}, 1280, 720, k * 100); }
    return G.shapeFinalize(scan);
  })();
  ok(clipped2.parts.face.c < 0.6 && clipped2.parts.face.prov !== 'observed', '턱이 화면 밖: 얼굴형 신뢰도 낮음, 관측으로 표시 안 함', `얼굴형 ${f3(clipped2.parts.face.c)} ${clipped2.parts.face.prov} (${clipped2.parts.face.why}), 입 ${f3(clipped2.parts.mouth.c)}`);
  ok(clipped2.parts.eyes.c > 0.6, '턱이 잘려도 눈은 관측 유지', f3(clipped2.parts.eyes.c));
  void clipped;

  // 안정적으로 틀린 결과: 매 프레임 같은 방향으로 입 랜드마크가 코 쪽에 붙음 (가림으로 인한 추적 실패 흉내)
  const scan = G.createShapeScan(), r = rng(11), Hd = shapeFace(G, PEOPLE.보통);
  const mouthIds = new Set([...G.LM.mouthOuter, ...G.LM.mouthInner]);
  for (const i of mouthIds) Hd[3 * i + 1] -= 0.38;
  for (let k = 0; k < 24; k++) { const o = observe(G, project(G, Hd, { noisePx: 0.3, r })); G.shapeAddSample(scan, o.P, o.F, o.pose, o.ref, {}, 1280, 720, k * 100); }
  const wrong = G.shapeFinalize(scan);
  ok(wrong.parts.mouth.c < 0.3, '흔들림 없이 일관되게 틀린 입 위치: 신뢰도 낮음', `입 ${f3(wrong.parts.mouth.c)} (${wrong.parts.mouth.why}), 안정성 ${f3(wrong.parts.mouth.f.stability)}`);
  ok(Math.abs(wrong.traits.mouthY.draw) < Math.abs(wrong.traits.mouthY.dev) * 0.5, '틀린 값은 보통 얼굴 쪽으로 당겨서 그림', `측정 ${f3(wrong.traits.mouthY.dev)} → 그림 ${f3(wrong.traits.mouthY.draw)}`);

  // 분할 지도로 본 가림 (손이 입을 가림)
  const occ = scanPerson(G, PEOPLE.보통, { seed: 4, occlusion: (p) => (p === 'mouth' ? 0.1 : 1) });
  ok(occ.parts.mouth.prov === 'estimated' && occ.parts.eyes.prov === 'observed', '입이 가려짐: 입만 추정', `입 ${f3(occ.parts.mouth.c)} ${occ.parts.mouth.prov}, 부분추정 ${Math.round(occ.estimatedShare * 100)}%`);

  // 흔들림 큼
  const noisy = scanPerson(G, PEOPLE.보통, { seed: 5, noisePx: 6, frames: 10 });
  ok(G.PARTS.some((p) => noisy.parts[p].c < 0.6), '추적 흔들림이 크면 신뢰도 낮음', G.PARTS.map((p) => `${p}:${f3(noisy.parts[p].c)}`).join(' '));

  // 고개를 돌린 표본만
  const turned = (() => {
    const scan = G.createShapeScan(), r = rng(21), Hd = shapeFace(G, PEOPLE.보통);
    for (let k = 0; k < 24; k++) { const o = observe(G, project(G, Hd, { yaw: 0.22, noisePx: 0.6, r })); G.shapeAddSample(scan, o.P, o.F, o.pose, o.ref, {}, 1280, 720, k * 100); }
    return G.shapeFinalize(scan);
  })();
  ok(turned.parts.face.c < shapes.보통.parts.face.c, '옆으로 돌린 표본: 얼굴형 신뢰도가 정면보다 낮음', `${f3(turned.parts.face.c)} < ${f3(shapes.보통.parts.face.c)}`);

  // 표본이 하나도 없으면 전부 추정
  const none = G.shapeFinalize(G.createShapeScan());
  ok(none.estimatedShare === 1 && G.PARTS.every((p) => none.parts[p].prov === 'estimated'), '표본 없음: 전부 추정으로 표시');
}

console.log('\n[4] 표정은 기본 형태를 바꾸지 않음');
{
  const scan = G.createShapeScan(), r = rng(31), Hd0 = shapeFace(G, PEOPLE.보통), HdS = shapeFace(G, PEOPLE.보통, { smile: 1, open: 0.5 });
  for (let k = 0; k < 30; k++) {
    const smiling = k % 2 === 1;
    const o = observe(G, project(G, smiling ? HdS : Hd0, { noisePx: 0.5, r }));
    G.shapeAddSample(scan, o.P, o.F, o.pose, o.ref, smiling ? blendshapes({ smile: 1, open: 0.5 }) : {}, 1280, 720, k * 100);
  }
  const sh = G.shapeFinalize(scan);
  ok(scan.samples.length <= 15 && Math.abs(sh.traits.mouthW.dev - shapes.보통.traits.mouthW.dev) < 0.02, '웃는 프레임은 표본에서 빠짐', `표본 ${scan.samples.length}/30, 입폭 차 ${f3(sh.traits.mouthW.dev - shapes.보통.traits.mouthW.dev)}`);
}

console.log('\n[5] 입: 벌림은 잡음 기준을 넘는 만큼부터 연속으로');
{
  const base = shapes.보통, r = rng(41), steps = [];
  for (let i = 0; i <= 100; i++) {
    const o = observe(G, project(G, shapeFace(G, PEOPLE.보통, { open: i / 100 }), { noisePx: 0, r }));
    const t = G.exprTarget(o.F, base, blendshapes({ open: i / 100 }), o.pose);
    steps.push(D.mouthGeometry(base.geo, base.asym, t.mouth).open);
  }
  const firstOpen = steps.findIndex((v) => v > 0);
  let maxJump = 0;
  for (let i = 1; i < steps.length; i++) maxJump = Math.max(maxJump, Math.abs(steps[i] - steps[i - 1]));
  ok(firstOpen > 3 && steps[firstOpen] < 0.02, '조금 벌리면 가는 틈부터 시작', `벌림 ${firstOpen / 100}부터 열림, 첫 틈 ${f3(steps[firstOpen])}`);
  ok(maxJump < 0.02, '0.01 단계당 변화가 작고 끊김 없음', `최대 변화 ${f3(maxJump)}, 끝 ${f3(steps[100])}`);
  // 다문 입 + 추적 흔들림: 열리지 않아야
  let falseOpen = 0;
  for (let k = 0; k < 40; k++) {
    const o = observe(G, project(G, shapeFace(G, PEOPLE.보통), { noisePx: 0.8, r }));
    if (G.exprTarget(o.F, base, {}, o.pose).mouth.open > 0.004) falseOpen++;
  }
  ok(falseOpen <= 4, '다문 입의 흔들림은 벌림으로 안 봄', `${falseOpen}/40 프레임에서 미세하게 열림`);
  const sm = (e) => { const o = observe(G, project(G, shapeFace(G, PEOPLE.보통, e), {})); return G.exprTarget(o.F, base, blendshapes(e), o.pose); };
  const smile = sm({ smile: 1 }), smileOpen = sm({ smile: 1, open: 0.4 }), blink = sm({ blink: 1 }), pucker = sm({ pucker: 1 }), side = sm({ smileR: 1 });
  ok(smile.mouth.smile > 0.3 && smile.mouth.teeth < 0.05, '미소(다문 입): 입꼬리 올라가고 치아 없음', `smile ${f3(smile.mouth.smile)} teeth ${f3(smile.mouth.teeth)}`);
  ok(smileOpen.mouth.teeth > 0.5, '웃으며 벌림: 치아', `teeth ${f3(smileOpen.mouth.teeth)}`);
  ok(blink.eyeR.open < 0.1 && blink.eyeL.open < 0.1, '눈 감음', `뜬 정도 ${f3(blink.eyeR.open)} / ${f3(blink.eyeL.open)}`);
  const half = sm({ blink: 0.5 });
  ok(half.eyeR.open > 0.3 && half.eyeR.open < 0.75, '반쯤 감음은 중간값', f3(half.eyeR.open));
  ok(smile.eyeR.lift > blink.eyeR.lift, '웃으면 아랫눈꺼풀이 올라감', `${f3(smile.eyeR.lift)} > ${f3(blink.eyeR.lift)}`);
  const pg = D.mouthGeometry(base.geo, base.asym, pucker.mouth), pw = (pg.cL[0] - pg.cR[0]) / 2;
  ok(pucker.mouth.pucker > 0.5 && pw < base.geo.mouthW * 0.8, '오므림: 그려지는 입폭(입꼬리 사이) 줄어듦', `${f3(pw)} / 무표정 ${f3(base.geo.mouthW)}`);
  ok(side.mouth.cR[1] < -0.03 && Math.abs(side.mouth.cL[1]) < 0.02, '한쪽 입꼬리만', `오른쪽 ${f3(side.mouth.cR[1])}, 왼쪽 ${f3(side.mouth.cL[1])}`);
}

console.log('\n[5-2] 검토에서 나온 경우들');
{
  const base = shapes.보통;
  // 윙크: 블렌드셰이프 이름(좌우)에 기대지 않고 랜드마크로 한쪽만 감김
  const o = observe(G, project(G, shapeFace(G, PEOPLE.보통, { blinkR: 1 }), {}));
  const wink = G.exprTarget(o.F, base, { eyeBlinkRight: 0.9, eyeBlinkLeft: 0.05 }, o.pose);
  const winkSwapped = G.exprTarget(o.F, base, { eyeBlinkRight: 0.05, eyeBlinkLeft: 0.9 }, o.pose);
  ok(wink.eyeR.open < 0.15 && wink.eyeL.open > 0.8 && winkSwapped.eyeR.open < 0.15 && winkSwapped.eyeL.open > 0.8, '한쪽 눈 감기: 점수 이름의 좌우가 바뀌어도 감긴 쪽만 감김', `오른눈 ${f3(wink.eyeR.open)} 왼눈 ${f3(wink.eyeL.open)} / 이름 바꿈 ${f3(winkSwapped.eyeR.open)} ${f3(winkSwapped.eyeL.open)}`);
  // 표본 없이 끝난 기본 형태로도 표정 계산이 멈추지 않음
  const empty = G.shapeFinalize(G.createShapeScan());
  let threw = null;
  try { G.exprTarget(o.F, empty, {}, o.pose); } catch (e) { threw = e.message; }
  ok(!threw && Array.isArray(empty.emphasis), '표본 0개 기본 형태: 표정 계산이 오류 없이 무표정', threw || '');
  // 다문 입에서 가장자리만 살짝 벌어질 때 입 선 모양이 튀지 않음
  const m0 = { ...G.neutralExpr().mouth, smile: 0.6, cR: [0, -0.03], cL: [0, -0.03] };
  const spreads = [0, 0.001, 0.003, 0.006, 0.01].map((q) => D.mouthGeometry(base.geo, base.asym, { ...m0, openQ: q }).upper[1][0]);
  const jump = Math.max(...spreads.slice(1).map((v, i) => Math.abs(v - spreads[i])));
  ok(jump < 0.02, '입 가장자리만 미세하게 벌어질 때 윗입술 곡선이 튀지 않음', `조절점 이동 최대 ${f3(jump)}`);
}

console.log('\n[6] 눈: 흰 면은 기본 눈 모양과 화면 크기로만');
{
  const narrow = { ...G.TEMPLATE, eyeOpen: G.TEMPLATE.eyeOpen - 0.1 }, round = { ...G.TEMPLATE, eyeOpen: G.TEMPLATE.eyeOpen + 0.12 }, avg = { ...G.TEMPLATE };
  const row = (g) => [40, 70, 100, 140, 200].map((s) => D.eyeWhiteAmount(g, s).toFixed(2)).join(' ');
  ok([40, 70, 100, 140, 200].every((s) => D.eyeWhiteAmount(narrow, s) === 0), '가는 눈: 모든 크기에서 흰 면 없음', row(narrow));
  const rw = [40, 70, 100, 140, 200].map((s) => D.eyeWhiteAmount(round, s));
  ok(rw.every((v, i) => i === 0 || v >= rw[i - 1]) && rw[0] < 0.2 && rw[4] > 0.8, '둥근 눈: 작게 그리면 적게, 크게 그리면 흰 면', row(round));
  ok([40, 70, 100, 140, 200].every((sc) => D.eyeWhiteAmount(avg, sc) === 0), '보통 눈: 크게 그려도 흰 면 없음 (놀란 표정 방지)', row(avg));
}

console.log('\n[7] 헤어: 정렬·누적·잘림·전환');
{
  const geo = shapes.보통.geo;
  // 크롭 변환과 머리좌표→이미지 변환이 서로 맞는지
  const o = observe(G, project(G, shapeFace(G, {}), { yaw: 0.12, pitch: -0.08, roll: 0.3, dist: 60, offX: -6 }));
  const M = G.headCropTransform(o.pose, G.HAIR.x0, G.HAIR.x1, G.HAIR.y0, G.HAIR.y1, 256, 256, G.HAIR.zcm);
  let worst = 0;
  for (const [X, Y] of [[0, 0], [1.2, -2], [-2.5, 2.2], [3, 2.7]]) {
    const [px, py] = G.headToImage(o.pose, X, Y, G.HAIR.zcm);
    const cx = M[0] * px + M[2] * py + M[4], cy = M[1] * px + M[3] * py + M[5];
    const ex = ((X - G.HAIR.x0) / (G.HAIR.x1 - G.HAIR.x0)) * 256, ey = ((Y - G.HAIR.y0) / (G.HAIR.y1 - G.HAIR.y0)) * 256;
    worst = Math.max(worst, Math.hypot(cx - ex, cy - ey));
  }
  ok(worst < 0.01, '분할 입력 크롭 = 머리 좌표 (고개 기울기·돌림 포함)', `최대 오차 ${worst.toExponential(1)}px`);

  const run = (samples) => {
    const m = G.createHairModel();
    m.weights = [];
    for (const s of samples) { G.hairAddSample(m, s.masks, s.valid, null, 0); m.weights.push(m.lastWeight); }
    G.hairCommit(m, G.hairProfile(m, geo));
    return m;
  };
  const good = synthHairMasks(G, geo, 'short');
  const aligned = run([good, good, good, good]);
  // 어긋난 표본(정렬 안 된 마스크 흉내: 0.4단위 위로 밀림)을 섞음
  const shifted = (() => {
    const s = synthHairMasks(G, geo, 'short'), S = 256, k = Math.round(0.4 / ((G.HAIR.x1 - G.HAIR.x0) / S));
    const h = new Float32Array(S * S), fc = new Float32Array(S * S);
    for (let y = 0; y < S - k; y++) for (let x = 0; x < S; x++) { h[y * S + x] = s.masks.hair[(y + k) * S + x]; fc[y * S + x] = s.masks.face[(y + k) * S + x]; }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { h[y * S + x] = Math.max(h[y * S + x], s.masks.hair[y * S + x]); }
    return { masks: { ...s.masks, hair: h, face: fc }, valid: s.valid };
  })();
  const mixed = run([good, good, good, shifted, good]);
  const top = (m) => m.target.radii[0];
  ok(Math.abs(top(mixed) - top(aligned)) < 0.08, '어긋난 표본은 약하게 반영 → 머리가 부풀지 않음', `정수리 반지름 ${f3(top(aligned))} vs 섞음 ${f3(top(mixed))}, 표본별 반영 ${mixed.weights.map(f3).join(' ')}`);

  // 잘림 → 추정, 확정 헤어로 저장 안 함 → 전체가 보이면 관측으로 갱신 → 다시 잘리면 이전 확정값
  const m = G.createHairModel(), clipped = synthHairMasks(G, geo, 'short', { clipAboveY: -1.2 });
  for (let i = 0; i < 3; i++) G.hairAddSample(m, clipped.masks, clipped.valid, null, i);
  G.hairCommit(m, G.hairProfile(m, geo));
  const topProv = () => Array.from(m.target.prov.slice(0, 4)).concat(Array.from(m.target.prov.slice(-3)));
  ok(topProv().every((p) => p === 3) && !m.confirmed, '윗머리가 화면 밖: 추정으로 표시, 확정 헤어 없음', `정수리 방향 출처 ${topProv().join('')}, 추정 ${Math.round(m.target.estimatedShare * 100)}%`);
  for (let i = 0; i < 6; i++) G.hairAddSample(m, good.masks, good.valid, null, 10 + i);
  G.hairCommit(m, G.hairProfile(m, geo));
  ok(topProv().every((p) => p === 1) && !!m.confirmed, '전체가 보이면 관측으로 갱신되고 확정', `출처 ${topProv().join('')}`);
  const m2 = G.createHairModel();
  for (let i = 0; i < 4; i++) G.hairAddSample(m2, good.masks, good.valid, null, i);
  G.hairCommit(m2, G.hairProfile(m2, geo));
  const conf = m2.confirmed.radii[0];
  // 새 표본들로 지도를 덮어 잘린 상태가 되게 (확정은 남아 있음)
  for (let i = 0; i < 25; i++) G.hairAddSample(m2, clipped.masks, clipped.valid, null, 10 + i);
  G.hairCommit(m2, G.hairProfile(m2, geo));
  const p2 = Array.from(m2.target.prov.slice(0, 3));
  ok(p2.every((p) => p === 2) && Math.abs(m2.target.radii[0] - conf) < 0.05, '다시 잘리면 이전에 본 확정 윤곽을 씀 (추정으로 덮지 않음)', `출처 ${p2.join('')}`);

  // 잔조각: 머리와 떨어진 머리카락 덩어리는 무시
  const blob = synthHairMasks(G, geo, 'short'), S = 256;
  for (let y = 10; y < 40; y++) for (let x = 200; x < 240; x++) blob.masks.hair[y * S + x] = 1;
  const withBlob = run([blob, blob, blob]);
  let maxDiff = 0;
  for (let k = 0; k < G.HAIR.K; k++) maxDiff = Math.max(maxDiff, Math.abs(withBlob.target.radii[k] - aligned.target.radii[k]));
  ok(maxDiff < 0.05, '떨어진 잔조각은 윤곽에 안 들어감', `최대 반지름 차 ${f3(maxDiff)}`);

  // 전환: 짧은 머리 → 긴 머리, 방향별 보간이라 반지름이 항상 양수·순서 유지
  const longM = run([synthHairMasks(G, geo, 'long'), synthHairMasks(G, geo, 'long'), synthHairMasks(G, geo, 'long')]);
  aligned.target = longM.target;
  let minR = 9, bad = 0;
  for (let t = 0; t < 30; t++) { G.hairDisplayStep(aligned, 100); for (let k = 0; k < G.HAIR.K; k++) { minR = Math.min(minR, aligned.display.radii[k]); if (!(aligned.display.radii[k] > 0)) bad++; } }
  ok(bad === 0 && minR > 0.5, '윤곽 전환 중 꼬임 없음 (방향별 반지름이 양수로 연속)', `최소 반지름 ${f3(minR)}`);
  ok(longM.target.earsCovered.every(Boolean) && !aligned.target.bald, '긴 머리: 귀 가림', String(longM.target.earsCovered));
  const shortEars = run([good, good, good]).target.earsCovered;
  ok(shortEars.every((c) => !c), '짧은 머리: 귀 보임', String(shortEars));
  const bald = run([synthHairMasks(G, geo, 'bald'), synthHairMasks(G, geo, 'bald')]);
  ok(bald.target.bald, '민머리 판정');
}

console.log(`\n${fails ? `실패 ${fails}개` : '모두 통과'}`);
process.exitCode = fails ? 1 : 0;
