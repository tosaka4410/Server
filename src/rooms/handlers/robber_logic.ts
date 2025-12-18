// src/rooms/handlers/robber_logic.ts
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

function removeOneRandomResource(room: MyRoom, p: number): boolean {
  const ps = room.state.players[p];
  const available: number[] = [];
  for (let i = 0; i < 5; i++) if ((ps.resources[i] ?? 0) > 0) available.push(i);
  if (available.length === 0) return false;

  const ri = available[Math.floor(Math.random() * available.length)];
  ps.resources[ri] = (ps.resources[ri] ?? 0) - 1;
  return true;
}

export function startRobberFlow(room: MyRoom, moverIndex: number): boolean {
  room.state.robberMoverIndex = moverIndex;

  let anyDiscard = false;
  for (let i = 0; i < room.state.players.length; i++) {
    if (discardCountFor(room, i) > 0) { anyDiscard = true; break; }
  }

  room.state.robberStep = anyDiscard ? RobberStep.Discarding : RobberStep.MoveWaiting;
  return anyDiscard;
}

export function autoDiscardAllRequired(room: MyRoom) {
  for (let i = 0; i < room.state.players.length; i++) {
    let need = discardCountFor(room, i);
    while (need > 0) {
      if (!removeOneRandomResource(room, i)) break;
      need--;
    }
  }
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
