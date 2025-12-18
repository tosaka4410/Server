// src/rooms/world/coords.ts
export function generateCatanCoords(): Array<{ q: number; r: number }> {
  // 3-4-5-4-3
  const coords: Array<{ q: number; r: number }> = [];
  for (let r = -2; r <= 2; r++) {
    const rowLength = 5 - Math.abs(r);
    const qStart = -Math.floor(rowLength / 2);
    for (let i = 0; i < rowLength; i++) coords.push({ q: qStart + i, r });
  }
  return coords;
}

export function createAxialToWorld(hexSize: number) {
  return (q: number, r: number) => {
    let x = hexSize * (Math.sqrt(3) * q);
    if (r % 2 !== 0) x += (Math.sqrt(3) / 2) * hexSize; // Unityローカルと一致
    const y = hexSize * (1.5 * r);
    return { x, y };
  };
}

export const CORNER_OFFSETS = [
  { x: 0, y: 1 },
  { x: Math.sqrt(3) / 2, y: 0.5 },
  { x: Math.sqrt(3) / 2, y: -0.5 },
  { x: 0, y: -1 },
  { x: -Math.sqrt(3) / 2, y: -0.5 },
  { x: -Math.sqrt(3) / 2, y: 0.5 },
] as const;

export type VKey = string; // "ix_iy"
export type EKey = string; // "a|b"

export function quantizeKey(x: number, y: number, quantizeFactor: number): VKey {
  const ix = Math.round(x * quantizeFactor);
  const iy = Math.round(y * quantizeFactor);
  return `${ix}_${iy}`;
}

export function makeEdgeKey(aKey: VKey, bKey: VKey): EKey {
  return aKey <= bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
}
