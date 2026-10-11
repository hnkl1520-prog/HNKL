import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/experiments/under-construction-worker/geometry.js', import.meta.url), 'utf8');
const { resizeRect, solveTwoBone } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('rectangle resize anchors the opposite corner and stops before inversion', () => {
  const rect = { left: 280, top: 80, right: 620, bottom: 580 };
  const examples = [
    [0, { x: 900, y: 700 }, { left: 450, top: 390, right: 620, bottom: 580 }],
    [1, { x: 0, y: 700 }, { left: 280, top: 390, right: 450, bottom: 580 }],
    [2, { x: 0, y: 0 }, { left: 280, top: 80, right: 450, bottom: 270 }],
    [3, { x: 900, y: 0 }, { left: 450, top: 80, right: 620, bottom: 270 }],
    [0, { x: -100, y: -100 }, { left: 32, top: 30, right: 620, bottom: 580 }],
    [2, { x: 1000, y: 1000 }, { left: 280, top: 80, right: 868, bottom: 630 }],
  ];
  for (const [index, target, expected] of examples) assert.deepEqual(resizeRect(rect, index, target), expected);
});

test('rectangle resize respects custom limits without moving an opposite edge', () => {
  const rect = { left: 120, top: 100, right: 800, bottom: 600 };
  assert.deepEqual(resizeRect(rect, 2, { x: -500, y: -500 }, { minWidth: 220, minHeight: 260 }),
    { left: 120, top: 100, right: 340, bottom: 360 });
  assert.deepEqual(resizeRect(rect, 0, { x: NaN, y: 10 }), rect);
});


test('invalid pointer coordinates and corner indexes leave the rectangle unchanged', () => {
  const rect = { left: 280, top: 80, right: 620, bottom: 580 };
  for (const target of [{ x: Infinity, y: 10 }, { x: 100, y: NaN }, null]) {
    assert.deepEqual(resizeRect(rect, 0, target), rect);
  }
  for (const index of [-1, 4, 1.5]) {
    assert.deepEqual(resizeRect(rect, index, { x: 100, y: 100 }), rect);
  }
});

test('all resize corners obey minimum, maximum, and viewport limits with a fixed opposite corner', () => {
  const rect = { left: 280, top: 120, right: 620, bottom: 540 };
  const limits = {
    minWidth: 240, maxWidth: 420, minHeight: 300, maxHeight: 500,
    bounds: { left: 180, top: 60, right: 720, bottom: 600 },
  };
  for (let index = 0; index < 4; index++) {
    const movesLeft = index === 0 || index === 3;
    const movesTop = index === 0 || index === 1;
    for (const target of [{ x: -1000, y: -1000 }, { x: 2000, y: 2000 }, { x: 450, y: 300 }, { x: -1000, y: 2000 }, { x: 2000, y: -1000 }]) {
      const next = resizeRect(rect, index, target, limits);
      const width = next.right - next.left, height = next.bottom - next.top;
      assert.ok(width >= limits.minWidth && width <= limits.maxWidth);
      assert.ok(height >= limits.minHeight && height <= limits.maxHeight);
      assert.ok(next.left >= limits.bounds.left && next.right <= limits.bounds.right);
      assert.ok(next.top >= limits.bounds.top && next.bottom <= limits.bounds.bottom);
      assert.equal(next[movesLeft ? 'right' : 'left'], rect[movesLeft ? 'right' : 'left']);
      assert.equal(next[movesTop ? 'bottom' : 'top'], rect[movesTop ? 'bottom' : 'top']);
    }
  }
});

test('invalid and infeasible resize constraints are a no-op', () => {
  const rect = { left: 280, top: 120, right: 620, bottom: 540 };
  for (const limits of [
    { minWidth: -1 }, { minHeight: NaN }, { maxWidth: 100 }, { maxHeight: NaN },
    { minWidth: Infinity }, { maxWidth: -Infinity }, { minHeight: 1000 },
    { bounds: { left: 700, top: 0, right: 900, bottom: 800 } },
    { bounds: { left: 0, top: NaN, right: 900, bottom: 800 } },
  ]) assert.deepEqual(resizeRect(rect, 0, { x: 100, y: 100 }, limits), rect);
});

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const near = (actual, expected, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} differs from ${expected}`);

test('two-bone chains keep both segment lengths for reachable, unreachable, and coincident targets', () => {
  const root = { x: 60, y: -20 };
  let seed = 0x12345678;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 0x100000000; };
  const targets = [root, { x: 90, y: 30 }, { x: -1000, y: -1000 }, { x: 60.000001, y: -20 }];
  for (let i = 0; i < 250; i++) targets.push({ x: random() * 600 - 300, y: random() * 600 - 300 });
  for (const [a, b] of [[80, 80], [100, 65], [35, 115]]) {
    for (const target of targets) {
      for (const bend of [-1, 1]) {
        const result = solveTwoBone(root, target, a, b, bend);
        near(distance(root, result.joint), a);
        near(distance(result.joint, result.end), b);
        const reach = distance(root, result.end);
        assert.ok(reach >= Math.abs(a - b) - 1e-7 && reach <= a + b + 1e-7);
        const requested = distance(root, target);
        if (requested > Math.abs(a - b) + .001 && requested < a + b - .001) near(distance(result.end, target), 0);
      }
    }
  }
});

test('changing the bend sign mirrors the joint across the target axis', () => {
  const root = { x: 10, y: 20 }, target = { x: 110, y: 120 };
  const positive = solveTwoBone(root, target, 100, 80, 1);
  const negative = solveTwoBone(root, target, 100, 80, -1);
  assert.deepEqual(positive.end, negative.end);
  const cross = point => (point.x - root.x) * (target.y - root.y) - (point.y - root.y) * (target.x - root.x);
  near(cross(positive.joint), -cross(negative.joint));
  assert.ok(cross(positive.joint) * cross(negative.joint) < 0);
});

test('invalid IK input fails explicitly instead of propagating NaN coordinates', () => {
  const root = { x: 0, y: 0 }, target = { x: 10, y: 10 };
  for (const point of [null, { x: Infinity, y: 0 }, { x: 0, y: NaN }]) {
    assert.throws(() => solveTwoBone(point, target, 10, 10), TypeError);
    assert.throws(() => solveTwoBone(root, point, 10, 10), TypeError);
  }
  for (const length of [0, -1, Infinity, NaN]) {
    assert.throws(() => solveTwoBone(root, target, length, 10), RangeError);
    assert.throws(() => solveTwoBone(root, target, 10, length), RangeError);
  }
  for (const bend of [0, NaN, Infinity]) assert.throws(() => solveTwoBone(root, target, 10, 10, bend), RangeError);
});
