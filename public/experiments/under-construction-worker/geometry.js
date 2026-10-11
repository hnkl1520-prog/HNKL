const DEFAULT_BOUNDS = { left: 32, top: 30, right: 868, bottom: 630 };
const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const validRect = rect => rect && ['left', 'top', 'right', 'bottom'].every(key => Number.isFinite(rect[key])) && rect.right >= rect.left && rect.bottom >= rect.top;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function resizeRect(rect, index, target, {
  minWidth = 170,
  minHeight = 190,
  maxWidth = Infinity,
  maxHeight = Infinity,
  bounds = DEFAULT_BOUNDS,
} = {}) {
  const result = { ...rect };
  if (!validRect(rect) || !validRect(bounds) || !finitePoint(target) || !Number.isInteger(index) || index < 0 || index > 3) return result;
  if (!Number.isFinite(minWidth) || !Number.isFinite(minHeight) || minWidth <= 0 || minHeight <= 0 ||
      !(maxWidth >= minWidth) || !(maxHeight >= minHeight)) return result;
  const movesLeft = index === 0 || index === 3;
  const movesTop = index === 0 || index === 1;
  const anchorX = movesLeft ? rect.right : rect.left;
  const anchorY = movesTop ? rect.bottom : rect.top;
  if (anchorX < bounds.left || anchorX > bounds.right || anchorY < bounds.top || anchorY > bounds.bottom) return result;
  const xMin = movesLeft ? Math.max(bounds.left, rect.right - maxWidth) : rect.left + minWidth;
  const xMax = movesLeft ? rect.right - minWidth : Math.min(bounds.right, rect.left + maxWidth);
  const yMin = movesTop ? Math.max(bounds.top, rect.bottom - maxHeight) : rect.top + minHeight;
  const yMax = movesTop ? rect.bottom - minHeight : Math.min(bounds.bottom, rect.top + maxHeight);
  // Opposite corner stays fixed, so infeasible options cannot be repaired by this drag.
  if (xMin > xMax || yMin > yMax) return result;
  result[movesLeft ? 'left' : 'right'] = clamp(target.x, xMin, xMax);
  result[movesTop ? 'top' : 'bottom'] = clamp(target.y, yMin, yMax);
  return result;
}

// Reposition a joint, never stretch its two rigid segments. Unreachable goals
// move the end to the nearest point on the chain's reachable annulus.
export function solveTwoBone(root, target, lengthA, lengthB, bendSign = 1) {
  if (!finitePoint(root) || !finitePoint(target)) throw new TypeError('Root and target must be finite points.');
  if (!Number.isFinite(lengthA) || !Number.isFinite(lengthB) || lengthA <= 0 || lengthB <= 0) {
    throw new RangeError('Bone lengths must be finite and positive.');
  }
  if (!Number.isFinite(bendSign) || bendSign === 0) throw new RangeError('Bend sign must be finite and nonzero.');
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const distance = Math.hypot(dx, dy);
  const ux = distance > 0 ? dx / distance : 1;
  const uy = distance > 0 ? dy / distance : 0;
  const epsilon = Math.min(lengthA, lengthB) * 1e-6;
  const reach = clamp(distance, Math.abs(lengthA - lengthB) + epsilon, lengthA + lengthB - epsilon);
  const along = (lengthA * lengthA - lengthB * lengthB + reach * reach) / (2 * reach);
  const perpendicular = Math.sqrt(Math.max(0, lengthA * lengthA - along * along)) * Math.sign(bendSign);
  return {
    joint: { x: root.x + ux * along - uy * perpendicular, y: root.y + uy * along + ux * perpendicular },
    end: { x: root.x + ux * reach, y: root.y + uy * reach },
  };
}
