import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the actual page's input handlers; the GPU hit point is stubbed.
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const handlers = html.slice(html.indexOf('        const sceneInput ='), html.indexOf('        const linkItems ='));
function harness() {
    const listeners = {}, mouseListeners = {};
    class Canvas { closest() { return true; } }
    const trail = new Float32Array(160);
    let chatCount = 0;
    const raycaster = {
        setFromCamera() {},
        intersectObject() { return [{ point: { x: .3, y: .5, z: 1 } }]; }
    };
    const canvas = new Canvas();
    const context = vm.createContext({
        HTMLCanvasElement: Canvas,
        window: { innerWidth: 390, innerHeight: 844, addEventListener: (name, handler) => { listeners[name] = handler; } },
        document: { addEventListener: (name, handler) => { mouseListeners[name] = handler; }, getElementById: () => ({}) },
        currentTheme: 2, isCompact: () => true, touchQuery: { matches: true },
        heroMouse: {}, heroRaycaster: raycaster, heroCamera: {}, heroSphere: {},
        trailData: trail, heroTrailIndex: 0, TRAIL_SIZE: 40,
        pointer: {}, camera: {}, character: {}, raycaster,
        getComputedStyle: () => ({ display: 'none' }),
        restoreChat: () => { chatCount++; }, minimizeChat() {},
        isHoveringBall: false, updateCursorState() {},
    });
    vm.runInContext(handlers, context);
    const event = (type, overrides = {}) => listeners[type]({
        target: canvas, button: 0, pointerId: 1, pointerType: 'touch', clientX: 190, clientY: 420, ...overrides
    });
    return { event, trail, context, chatCount: () => chatCount };
}

test('touch-down and dragging feed the original ripple trail without moving the second sphere or opening chat', () => {
    const h = harness();
    h.event('pointerdown');
    assert.equal(h.trail[3], 1);
    h.event('pointermove', { clientX: 230 });
    assert.equal(h.trail[7], 1);
    h.event('pointerup', { clientX: 230 });
    assert.equal(h.chatCount(), 0);
    assert.deepEqual(Object.keys(h.context.heroSphere), []);
});

test('a tap retains chat; pressing an overlaid button never triggers a ripple or chat', () => {
    const h = harness();
    h.event('pointerdown');
    h.event('pointerup');
    assert.equal(h.chatCount(), 1);
    h.trail.fill(0);
    h.event('pointerdown', { target: {} });
    h.event('pointerup', { target: {} });
    assert.ok(h.trail.every(value => value === 0));
    assert.equal(h.chatCount(), 1);
});

test('cancelled touches cannot open chat', () => {
    const h = harness();
    h.event('pointerdown');
    h.event('pointercancel');
    h.event('pointerup');
    assert.equal(h.chatCount(), 0);
});

test('mouse hover retains the ripple even in a narrow preview', () => {
    const h = harness();
    h.event('pointermove', { pointerType: 'mouse' });
    assert.equal(h.trail[3], 1);
    assert.equal(h.chatCount(), 0);
});
