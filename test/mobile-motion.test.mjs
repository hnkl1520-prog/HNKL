import test from 'node:test';
import assert from 'node:assert/strict';
import { stepBall, screenTilt, createTiltInput } from '../public/mobile-motion.mjs';

test('sustained tilt stays inside the usable screen, including a resized viewport', () => {
    const ball = { x: .5, y: .65, vx: 0, vy: 0, ax: 1, ay: 1 };
    for (const bounds of [
        { minX: .15, maxX: .85, minY: .35, maxY: .9 },
        { minX: .37, maxX: .63, minY: .6, maxY: .6 },
    ]) {
        for (let frame = 0; frame < 3600; frame++) {
            if (frame === 1800) ball.ax = ball.ay = -1;
            stepBall(ball, bounds, 1 / 60);
            assert.ok(ball.x >= bounds.minX && ball.x <= bounds.maxX);
            assert.ok(ball.y >= bounds.minY && ball.y <= bounds.maxY);
        }
    }
});

test('edge collisions bounce inward and idle time is capped', () => {
    const bounds = { minX: .1, maxX: .9, minY: .2, maxY: .8 };
    const ball = { x: .89, y: .79, vx: .1, vy: .1, ax: 0, ay: 0 };
    stepBall(ball, bounds, 20);
    assert.equal(ball.x, .9);
    assert.equal(ball.y, .8);
    assert.ok(ball.vx < 0 && ball.vy < 0);
    stepBall(ball, bounds, 1 / 60);
    assert.ok(ball.x < .9 && ball.y < .8);
});

test('neutral calibration, landscape rotation, and angle wrap preserve direction', () => {
    assert.deepEqual(screenTilt(45, 10, { beta: 45, gamma: 10 }, 0), { ax: 0, ay: 0 });
    const landscape = screenTilt(25, 0, { beta: 0, gamma: 0 }, 90);
    assert.equal(landscape.ax, 1);
    assert.ok(Math.abs(landscape.ay) < 1e-12);
    assert.ok(Math.abs(screenTilt(-179, 0, { beta: 179, gamma: 0 }, 0).ay - .08) < 1e-12);
});

function device(requestPermission) {
    const target = new EventTarget();
    target.isSecureContext = true;
    target.DeviceOrientationEvent = requestPermission ? { requestPermission } : {};
    target.screen = { orientation: { angle: 0 } };
    target.read = (beta, gamma) => {
        const event = new Event('deviceorientation');
        Object.assign(event, { beta, gamma });
        target.dispatchEvent(event);
    };
    return target;
}

test('iOS permission is requested synchronously from the gesture; delayed data still moves the ball', async t => {
    let calls = 0, grant;
    const target = device(() => { calls++; return new Promise(resolve => { grant = resolve; }); });
    const ball = { x: .5, y: .65, vx: 0, vy: 0, ax: 0, ay: 0 };
    const input = createTiltInput(target, tilt => Object.assign(ball, tilt));
    assert.equal(input.needsGesture, true);
    const pending = input.start();
    assert.equal(calls, 1);
    assert.equal(input.start(), pending);
    target.read(45, 25);
    assert.equal(input.hasData, false);
    grant('granted');
    assert.equal(await pending, true);
    // A first sample arriving later than the removed 2.5-second cutoff is valid.
    t.mock.method(Date, 'now', () => 10000);
    target.read(45, 0);
    target.read(45, 20);
    assert.equal(input.hasData, true);
    for (let frame = 0; frame < 30; frame++) {
        stepBall(ball, { minX: .15, maxX: .85, minY: .3, maxY: .9 }, 1 / 60);
    }
    assert.ok(ball.x > .6);
    target.dispatchEvent(new Event('orientationchange'));
    assert.equal(input.hasData, false);
    assert.equal(ball.ax, 0);
});

test('permission-free devices start automatically and ignore null readings', async () => {
    const target = device();
    const readings = [];
    const input = createTiltInput(target, tilt => readings.push(tilt));
    assert.equal(input.needsGesture, false);
    await input.start();
    target.read(null, null);
    assert.equal(readings.length, 0);
    target.read(45, 0);
    target.read(35, -20);
    assert.ok(readings.at(-1).ax < 0 && readings.at(-1).ay < 0);
});

test('denied or unavailable sensors do not block the existing touch interaction', async () => {
    const target = device(() => Promise.resolve('denied'));
    const input = createTiltInput(target, () => assert.fail('must not receive denied input'));
    assert.equal(await input.start(), false);
    assert.equal(input.needsGesture, false);
    assert.equal(input.hasData, false);
    target.read(10, 20);
    const unavailable = device();
    unavailable.DeviceOrientationEvent = undefined;
    assert.equal(await createTiltInput(unavailable, () => {}).start(), false);
});
