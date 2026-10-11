// Normalized screen coordinates keep the ball inside any viewport size.
export function stepBall(ball, bounds, delta) {
    const step = Math.min(Math.max(delta, 0), .05) * 60;
    for (const [axis, velocity, acceleration, min, max] of [
        ['x', 'vx', 'ax', bounds.minX, bounds.maxX],
        ['y', 'vy', 'ay', bounds.minY, bounds.maxY]
    ]) {
        ball[velocity] = (ball[velocity] + ball[acceleration] * .00055 * step) * Math.pow(.975, step);
        ball[axis] += ball[velocity] * step;
        if (ball[axis] < min || ball[axis] > max) {
            ball[axis] = Math.max(min, Math.min(max, ball[axis]));
            ball[velocity] *= -.65;
        }
    }
}

export function screenTilt(beta, gamma, neutral, degrees) {
    const angle = degrees * Math.PI / 180;
    // Avoid a sudden kick when a reported angle wraps from +180 to -180.
    const difference = (a, b) => ((a - b + 540) % 360) - 180;
    const x = difference(gamma, neutral.gamma) / 25;
    const y = difference(beta, neutral.beta) / 25;
    const clamp = value => Math.max(-1, Math.min(1, value));
    return {
        ax: clamp(x * Math.cos(angle) + y * Math.sin(angle)),
        ay: clamp(y * Math.cos(angle) - x * Math.sin(angle))
    };
}

// On iOS start() must be called directly from an existing user gesture.
// Permission-free browsers can start immediately. Slow sensor delivery must not
// revoke a permission that the user has already granted.
export function createTiltInput(target, onTilt, isActive = () => true) {
    let state = 'idle';
    let neutral = null;
    let lastReading = 0;
    let request = null;
    const needsGesture = typeof target.DeviceOrientationEvent?.requestPermission === 'function';
    function reset() {
        neutral = null;
        lastReading = 0;
        onTilt({ ax: 0, ay: 0 });
    }
    target.addEventListener('deviceorientation', event => {
        if (state !== 'enabled' || !isActive() || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
        neutral ??= { beta: event.beta, gamma: event.gamma };
        lastReading = Date.now();
        onTilt(screenTilt(event.beta, event.gamma, neutral, target.screen?.orientation?.angle ?? target.orientation ?? 0));
    });
    target.addEventListener('orientationchange', reset);
    return {
        get needsGesture() { return needsGesture && state === 'idle'; },
        get hasData() { return state === 'enabled' && lastReading > 0 && Date.now() - lastReading < 1500; },
        get state() { return state; },
        start() {
            if (request) return request;
            if (state !== 'idle') return Promise.resolve(state === 'enabled');
            if (!target.isSecureContext || !target.DeviceOrientationEvent) {
                state = 'unavailable';
                return Promise.resolve(false);
            }
            if (!needsGesture) {
                state = 'enabled';
                return Promise.resolve(true);
            }
            state = 'requesting';
            try {
                // Do not defer this call: Safari requires transient activation.
                const permission = target.DeviceOrientationEvent.requestPermission();
                request = Promise.resolve(permission).then(result => {
                    state = result === 'granted' ? 'enabled' : 'denied';
                    return state === 'enabled';
                }).catch(() => {
                    state = 'denied';
                    return false;
                });
            } catch {
                state = 'denied';
                request = Promise.resolve(false);
            }
            return request;
        }
    };
}
