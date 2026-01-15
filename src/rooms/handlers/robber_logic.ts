import type { MyRoom } from "../MyRoom";
import { RobberStep, TurnStep } from "../schema/constants";

function totalResources(room: MyRoom, p: number): number {
  const ps = room.state.players[p];
  let sum = 0;
  for (let i = 0; i < 5; i++) sum += (ps.resources[i] ?? 0);
  return sum;
}

function discardCountFor(room: MyRoom, p: number): number {
  const t = totalResources(room, p);
  return t >= 8 ? Math.floor(t / 2) : 0;
}

// ★ 7が出た時：捨て札が必要なら robberStep=Discarding にして remaining をセット
export function startRobberFlowInteractive(room: MyRoom, moverIndex: number): boolean {
  room.state.robberMoverIndex = moverIndex;

  // 配列サイズを合わせる
  while (room.state.robberDiscardRemaining.length < room.state.players.length) {
    room.state.robberDiscardRemaining.push(0);
  }

  let anyDiscard = false;
  for (let i = 0; i < room.state.players.length; i++) {
    const need = discardCountFor(room, i);
    room.state.robberDiscardRemaining[i] = need;
    if (need > 0) anyDiscard = true;
  }

  room.state.robberStep = anyDiscard ? RobberStep.Discarding : RobberStep.MoveWaiting;
  return anyDiscard;
}

// ★ 全員が捨て終わったか
export function isDiscardPhaseComplete(room: MyRoom): boolean {
  for (let i = 0; i < room.state.players.length; i++) {
    if ((room.state.robberDiscardRemaining[i] ?? 0) > 0) return false;
  }
  return true;
}

export function getRobbableVictims(room: MyRoom, moverIndex: number, tileId: number): number[] {
  const vIds = room.graph.tileIdToVertexIds.get(tileId) ?? [];
  const set = new Set<number>();

  for (const vId of vIds) {
    const s = room.state.settlements.get(String(vId));
    if (!s) continue;

    const owner = s.ownerIndex;
    if (owner === moverIndex) continue;
    if (totalResources(room, owner) > 0) set.add(owner);
  }

  return [...set];
}

export function stealOneRandomResource(room: MyRoom, victimIndex: number): number | null {
  const ps = room.state.players[victimIndex];
  const bag: number[] = [];
  for (let i = 0; i < 5; i++) {
    const c = ps.resources[i] ?? 0;
    for (let k = 0; k < c; k++) bag.push(i);
  }
  if (bag.length === 0) return null;

  const pick = bag[Math.floor(Math.random() * bag.length)];
  ps.resources[pick] = (ps.resources[pick] ?? 0) - 1;
  return pick;
}

export function addResourceToPlayer(room: MyRoom, p: number, resIdx: number, amount: number) {
  const ps = room.state.players[p];
  ps.resources[resIdx] = (ps.resources[resIdx] ?? 0) + amount;
}

export function finishRobberFlow(room: MyRoom) {
  room.state.robberStep = RobberStep.None;
  room.state.robberMoverIndex = -1;

  // このターンはサイコロ後扱い
  room.state.turnStep = TurnStep.AfterRoll;
}
