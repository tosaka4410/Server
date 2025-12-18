// src/rooms/handlers/longestRoad.ts
import type { MyRoom } from "../MyRoom";
import { StructureType } from "../schema/constants";

const MIN_LONGEST_ROAD = 5;
const BONUS_POINTS = 2;

export function recomputeLongestRoad(room: MyRoom) {
  const n = room.state.playerCount;

  // プレイヤーごとの最長長さ
  const lengths = new Array<number>(n).fill(0);
  for (let p = 0; p < n; p++) {
    lengths[p] = computeLongestRoadForPlayer(room, p);
  }

  const bestLen = Math.max(...lengths);
  const winners = lengths
    .map((len, p) => ({ len, p }))
    .filter(x => x.len === bestLen)
    .map(x => x.p);

  const prevOwner = room.state.longestRoadOwner;
  const prevLen = room.state.longestRoadLength;

  // 5未満ならボーナスなし
  if (bestLen < MIN_LONGEST_ROAD) {
    if (prevOwner !== -1) setLongestRoadOwner(room, -1, 0);
    return;
  }

  // 同点処理：保持者が同点トップにいれば維持、いなければ（新規付与はしない）
  if (winners.length >= 2) {
    if (prevOwner !== -1 && winners.includes(prevOwner) && prevLen === bestLen) {
      // 維持（長さだけ更新しておく）
      room.state.longestRoadLength = bestLen;
      return;
    }
    // 保持者が同点トップに含まれない/保持者なし → 誰も獲得しない（標準寄せ）
    if (prevOwner !== -1) setLongestRoadOwner(room, -1, 0);
    return;
  }

  // 単独トップ
  const newOwner = winners[0];
  if (newOwner === prevOwner && prevLen === bestLen) return;

  setLongestRoadOwner(room, newOwner, bestLen);
}

function setLongestRoadOwner(room: MyRoom, owner: number, length: number) {
  const prevOwner = room.state.longestRoadOwner;

  // 旧保持者から剥奪
  if (prevOwner !== -1) {
    room.state.players[prevOwner].longestRoadPoints = 0;
  }

  room.state.longestRoadOwner = owner;
  room.state.longestRoadLength = length;

  // 新保持者に付与
  if (owner !== -1) {
    room.state.players[owner].longestRoadPoints = BONUS_POINTS;
  }
}

/**
 * プレイヤーpの最長交易路長をDFSで計算
 * - 道（edge）を二度通らない（edgeベースのDFS）
 * - 相手の開拓地/都市がある頂点は「通過不可」（そこへ入ったらそこで止める）
 */
function computeLongestRoadForPlayer(room: MyRoom, p: number): number {
  const myRoadEdges = getPlayerRoadEdges(room, p);
  if (myRoadEdges.length === 0) return 0;

  // 頂点 -> 自分の道路edge集合
  const vToEdges = new Map<number, number[]>();
  for (const eId of myRoadEdges) {
    const e = room.state.edges[eId];
    push(vToEdges, e.a, eId);
    push(vToEdges, e.b, eId);
  }

  const blocked = buildBlockedVertexSet(room, p);

  let best = 0;
  const used = new Set<number>();

  // すべての頂点を開始点にしてDFS（小規模なので全探索でOK）
  for (const vStart of vToEdges.keys()) {
    best = Math.max(best, dfsFromVertex(vStart, used, 0));
  }
  return best;

  function dfsFromVertex(v: number, usedEdges: Set<number>, len: number): number {
    let localBest = len;
    const edges = vToEdges.get(v) ?? [];
    for (const eId of edges) {
      if (usedEdges.has(eId)) continue;

      usedEdges.add(eId);

      const e = room.state.edges[eId];
      const nextV = e.a === v ? e.b : e.a;
      const nextLen = len + 1;

      // nextV が相手建物でブロックされてたら、そこで止まる（通過しない）
      if (blocked.has(nextV)) {
        localBest = Math.max(localBest, nextLen);
      } else {
        localBest = Math.max(localBest, dfsFromVertex(nextV, usedEdges, nextLen));
      }

      usedEdges.delete(eId);
    }
    return localBest;
  }
}

function getPlayerRoadEdges(room: MyRoom, p: number): number[] {
  const out: number[] = [];
  for (const [k, s] of room.state.roads.entries()) {
    if (s.ownerIndex !== p) continue;
    const eId = Number(k);
    if (Number.isInteger(eId)) out.push(eId);
  }
  return out;
}

function buildBlockedVertexSet(room: MyRoom, p: number): Set<number> {
  const blocked = new Set<number>();
  for (const [k, s] of room.state.settlements.entries()) {
    const vId = Number(k);
    if (!Number.isInteger(vId)) continue;

    // 相手の開拓地/都市はブロック。自分のはブロックしない。
    if (s.ownerIndex !== p && (s.type === StructureType.Settlement || s.type === StructureType.City)) {
      blocked.add(vId);
    }
  }
  return blocked;
}

function push(map: Map<number, number[]>, key: number, value: number) {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}
