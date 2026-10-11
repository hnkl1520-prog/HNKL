// 레퍼런스(파란 얼굴) 한 캐릭터의 완성도 검토. 윤곽은 전부 손으로 잡은 베지어.
//
// 레퍼런스에서 읽은 비례 (얼굴 폭 = 1 기준)
//  · 얼굴: 폭 1 : 높이 약 1.45. 관자놀이에서 볼까지 거의 수직, 귀 높이에서 가장 넓고, 볼→턱은 길고 완만한 한 곡선. 턱은 넓고 둥글다.
//  · 헤어: 바깥 실루엣은 얼굴보다 관자놀이에서 약간 넓고(+4%), 옆머리는 눈썹 높이까지 내려와 얼굴에 붙는다. 앞머리 선은 거의 직선, 가운데 작은 V 하나.
//  · 눈: 지름 ≈ 0.16, 중심 간격 ≈ 0.44, 앞머리 선에서 눈 중심까지 ≈ 0.28. 눈썹은 눈 지름만큼 짧고 눈에 가깝다(≈ 0.14 위).
//  · 코: 눈썹 사이에서 시작해 얼굴 높이의 약 60% 지점까지 내려오는 한 줄. 끝에서 짧게 꺾인다. 굵기는 입과 같다.
//  · 입: 얼굴 높이 약 78% 지점, 폭 ≈ 0.42, 직선. 코끝과 입 사이 여백 ≈ 눈 지름.
//  · 귀: 눈 아래에서 코 중간 높이. 얼굴 밖으로 ≈ 0.24 튀어나오고, 위 가장자리는 거의 수평, 아래는 둥글다. 안에 짧은 가로선 하나.

export const BLUE_PALETTE = { bg: '#E8563B', skin: '#3440F0', hair: '#1B1446', ink: '#1B1446', white: '#FFFFFF' };

// 시안 3개: 같은 디자인에서 폭·턱·눈 간격·헤어 볼륨만 조율
export const VARIANTS = [
  { name: 'A 기준', note: '레퍼런스 비례 그대로: 폭 1 : 높이 1.45, 눈 간격 0.44, 넓고 둥근 턱.', faceW: 1.0, chinRound: 1.0, eyeGap: 0.44, hairVol: 1.0 },
  { name: 'B 좁게', note: '얼굴 폭 −6%, 턱을 조금 더 둥글게, 눈 간격 0.40으로 모아 얼굴이 더 길어 보이게.', faceW: 0.94, chinRound: 1.15, eyeGap: 0.40, hairVol: 0.96 },
  { name: 'C 넓게', note: '얼굴 폭 +6%, 턱을 평평하게, 눈 간격 0.48, 헤어 볼륨을 키워 머리가 묵직하게.', faceW: 1.06, chinRound: 0.8, eyeGap: 0.48, hairVol: 1.12 },
];

const mirror = (ctx, fn) => { fn(1); fn(-1); };

// 얼굴 윤곽: 오른쪽 절반을 그린 뒤 거울 (좌우 대칭은 의도. 흔들림 없음)
function facePath(ctx, V) {
  const w = 0.5 * V.faceW, h = 0.725, cr = V.chinRound;   // w = 반폭, h = 반높이
  const chinY = h, chinHalf = 0.30 * w * (2 - cr);        // 턱이 둥글수록 턱 밑면이 좁다
  ctx.beginPath();
  ctx.moveTo(0, -h);
  // 정수리 → 관자놀이: 짧고 팽팽한 곡선 (헤어에 가려짐)
  ctx.bezierCurveTo(w * 0.62, -h, w * 0.96, -h * 0.86, w * 0.97, -h * 0.55);
  // 관자놀이 → 볼(귀 높이): 거의 수직, 살짝 바깥으로
  ctx.bezierCurveTo(w * 0.98, -h * 0.3, w * 1.0, -h * 0.05, w * 1.0, h * 0.12);
  // 볼 → 턱: 길고 완만한 한 곡선
  ctx.bezierCurveTo(w * 1.0, h * 0.55, w * (0.62 + 0.14 * cr), h * (0.97 - 0.02 * cr), chinHalf, h * 0.995);
  // 턱 밑면
  ctx.bezierCurveTo(chinHalf * 0.55, chinY, -chinHalf * 0.55, chinY, -chinHalf, h * 0.995);
  ctx.bezierCurveTo(-w * (0.62 + 0.14 * cr), h * (0.97 - 0.02 * cr), -w * 1.0, h * 0.55, -w * 1.0, h * 0.12);
  ctx.bezierCurveTo(-w * 1.0, -h * 0.05, -w * 0.98, -h * 0.3, -w * 0.97, -h * 0.55);
  ctx.bezierCurveTo(-w * 0.96, -h * 0.86, -w * 0.62, -h, 0, -h);
  ctx.closePath();
}

// 헤어: 두상 위에 얹은 모자가 아니라, 얼굴 실루엣을 이어받아 관자놀이에서 살짝 넓어지고 옆머리 끝에서 얼굴에 붙는다
function hairPath(ctx, V) {
  const w = 0.5 * V.faceW, h = 0.725, v = V.hairVol;
  const top = -h * (1.08 + 0.13 * v);           // 정수리 위 두께
  const sideX = w * (1.02 + 0.04 * v);          // 관자놀이에서 얼굴보다 넓은 만큼
  const sideBot = -h * 0.36;                    // 옆머리 끝이 얼굴에 붙는 높이 (눈썹 조금 위)
  const bang = -h * 0.5;                        // 앞머리 선
  ctx.beginPath();
  ctx.moveTo(w * 0.985, sideBot);
  // 옆머리 끝 → 관자놀이 → 정수리: 얼굴선에서 살짝 벌어졌다가 크게 도는 한 흐름
  ctx.bezierCurveTo(w * 1.01, -h * 0.5, sideX, -h * 0.62, sideX, -h * 0.8);
  // 정수리: 각진 상자가 아니라 둥근 돔 (관자놀이에서 바로 돌기 시작)
  ctx.bezierCurveTo(sideX, -h * (0.97 + 0.06 * v), w * 0.58, top, 0, top);
  ctx.bezierCurveTo(-w * 0.58, top, -sideX, -h * (0.97 + 0.06 * v), -sideX, -h * 0.8);
  ctx.bezierCurveTo(-sideX, -h * 0.62, -w * 1.01, -h * 0.5, -w * 0.985, sideBot);
  // 앞머리 선: 옆머리 끝에서 한 번에 올라와 거의 직선으로 건너가고, 가운데 작은 V
  ctx.bezierCurveTo(-w * 0.86, -h * 0.38, -w * 0.72, bang, -w * 0.5, bang);
  ctx.lineTo(-w * 0.08, bang);
  ctx.lineTo(0, bang + h * 0.07);
  ctx.lineTo(w * 0.08, bang);
  ctx.lineTo(w * 0.5, bang);
  ctx.bezierCurveTo(w * 0.72, bang, w * 0.86, -h * 0.38, w * 0.985, sideBot);
  ctx.closePath();
}

// 귀: 얼굴 뒤에서 나오는 날개. 위 가장자리는 거의 수평, 바깥 끝은 둥글고, 아래는 볼로 돌아온다
function earPath(ctx, V, sx) {
  const w = 0.5 * V.faceW, h = 0.725;
  const x0 = sx * w * 0.9, top = -h * 0.04, bot = h * 0.3, out = sx * (w + 0.21);
  ctx.beginPath();
  ctx.moveTo(x0, top + 0.02);
  ctx.bezierCurveTo(sx * (w + 0.06), top - 0.01, sx * (w + 0.17), top - 0.005, out, top + 0.07);
  ctx.bezierCurveTo(sx * (w + 0.225), top + 0.15, sx * (w + 0.19), bot - 0.01, sx * (w + 0.09), bot);
  ctx.bezierCurveTo(sx * (w + 0.03), bot + 0.01, x0, bot - 0.02, x0, bot - 0.04);
  ctx.closePath();
}

export function drawBlue(ctx, V, x, y, scale, pal = BLUE_PALETTE) {
  const w = 0.5 * V.faceW, h = 0.725, lw = 0.026;
  ctx.save();
  ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // 목: 턱 뒤로 들어가는 짧은 기둥. 턱선보다 좁고 위쪽이 살짝 좁아진다
  ctx.fillStyle = pal.skin;
  ctx.beginPath();
  ctx.moveTo(-w * 0.42, h * 0.75); ctx.lineTo(w * 0.42, h * 0.75);
  ctx.bezierCurveTo(w * 0.43, h * 1.0, w * 0.45, h * 1.2, w * 0.46, h * 1.6);
  ctx.lineTo(-w * 0.46, h * 1.6);
  ctx.bezierCurveTo(-w * 0.45, h * 1.2, -w * 0.43, h * 1.0, -w * 0.42, h * 0.75);
  ctx.closePath(); ctx.fill();

  // 귀 (얼굴 뒤) + 귀 안 가로선
  for (const sx of [-1, 1]) { earPath(ctx, V, sx); ctx.fill(); }
  facePath(ctx, V); ctx.fill();
  ctx.strokeStyle = pal.ink; ctx.lineWidth = lw;
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * (w + 0.045), h * 0.12); ctx.lineTo(sx * (w + 0.15), h * 0.11); ctx.stroke(); }

  ctx.fillStyle = pal.hair; hairPath(ctx, V); ctx.fill();

  // 눈: 흰 원 + 눈동자. 중심은 앞머리 선에서 0.28 아래
  const eyeY = -h * 0.5 + 0.28, R = 0.08, gap = V.eyeGap / 2;
  for (const sx of [-1, 1]) {
    ctx.beginPath(); ctx.arc(sx * gap, eyeY, R, 0, Math.PI * 2); ctx.fillStyle = pal.white; ctx.fill();
    ctx.beginPath(); ctx.arc(sx * gap, eyeY + 0.006, R * 0.5, 0, Math.PI * 2); ctx.fillStyle = pal.ink; ctx.fill();
  }
  // 눈썹: 눈 지름만큼 짧고, 바깥쪽이 조금 높다
  ctx.lineWidth = lw * 0.85;
  for (const sx of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(sx * (gap - R * 0.85), eyeY - 0.15); ctx.quadraticCurveTo(sx * gap, eyeY - 0.168, sx * (gap + R * 0.9), eyeY - 0.157); ctx.stroke();
  }
  // 코: 눈썹 사이에서 시작해 얼굴 높이 60% 까지, 끝에서 짧게 꺾임
  ctx.lineWidth = lw;
  const noseTop = eyeY - 0.12, noseEnd = h * 0.24;
  ctx.beginPath();
  ctx.moveTo(0.012, noseTop);
  ctx.bezierCurveTo(0.02, noseTop + (noseEnd - noseTop) * 0.4, 0.026, noseEnd - 0.08, 0.02, noseEnd);
  ctx.bezierCurveTo(0.014, noseEnd + 0.03, -0.03, noseEnd + 0.03, -0.075, noseEnd + 0.012);
  ctx.stroke();
  // 입: 코끝 아래 눈 지름만큼 띄우고, 폭 0.42 의 직선
  const mouthY = noseEnd + 0.19, mw = 0.21 * (0.9 + 0.1 * V.faceW);
  ctx.beginPath(); ctx.moveTo(-mw, mouthY); ctx.lineTo(mw, mouthY); ctx.stroke();
  ctx.restore();
}
