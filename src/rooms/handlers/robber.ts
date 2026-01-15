// src/rooms/handlers/robber.ts
import type { Client } from "@colyseus/core";
import type { MyRoom } from "../MyRoom";
import { Phase, RobberStep } from "../schema/constants";
import { fail, getPlayerIndex } from "../utils/guards";
import { isDiscardPhaseComplete, getRobbableVictims, stealOneRandomResource, addResourceToPlayer, finishRobberFlow } from "./robber_logic";



export function registerRobberHandlers(room: MyRoom) {
  room.onMessage("moveRobber", (client, data) => onMoveRobber(room, client, data));
  room.onMessage("robPlayer", (client, data) => onRobPlayer(room, client, data));
  room.onMessage("discardRobber", (client, data) => onDiscardRobber(room, client, data));
}

function onMoveRobber(room: MyRoom, client: Client, data: any) {
  const mover = getPlayerIndex(room, client);
  if (mover == null) return;

  if (room.state.phase !== Phase.Main) return;
  if (room.state.robberStep !== RobberStep.MoveWaiting) return;
  if (mover !== room.state.robberMoverIndex) return;

  const tileId = Number(data?.tileId);
  if (!Number.isInteger(tileId) || tileId < 0 || tileId >= room.state.tiles.length) return;

  if (tileId === room.state.robberTileId) return fail(client, "同じタイルには盗賊を移動できません");

  room.state.robberTileId = tileId;

  const victims = getRobbableVictims(room, mover, tileId);
  if (victims.length === 0) {
    finishRobberFlow(room);
    return;
  }

  room.state.robberStep = RobberStep.RobWaiting;
  client.send("robberVictims", { victims });
}

function onRobPlayer(room: MyRoom, client: Client, data: any) {
  const mover = getPlayerIndex(room, client);
  if (mover == null) return;

  if (room.state.phase !== Phase.Main) return;
  if (room.state.robberStep !== RobberStep.RobWaiting) return;
  if (mover !== room.state.robberMoverIndex) return;

  const victim = Number(data?.victimIndex);
  if (!Number.isInteger(victim) || victim < 0 || victim >= room.state.players.length) return;

  const candidates = getRobbableVictims(room, mover, room.state.robberTileId);
  if (!candidates.includes(victim)) return;

  const stolenRes = stealOneRandomResource(room, victim);
  if (stolenRes != null) addResourceToPlayer(room, mover, stolenRes, 1);

  finishRobberFlow(room);
}

function onDiscardRobber(room: MyRoom, client: Client, data: any) {
  const p = getPlayerIndex(room, client);
  if (p == null) return;

  if (room.state.phase !== Phase.Main) return;
  if (room.state.robberStep !== RobberStep.Discarding) return;

  const need = room.state.robberDiscardRemaining[p] ?? 0;
  if (need <= 0) return fail(client, "捨て札は不要です");

  const r = Number(data?.resourceIndex);
  if (!Number.isInteger(r) || r < 0 || r > 4) return fail(client, "resourceIndex が不正です");

  const ps = room.state.players[p];
  if ((ps.resources[r] ?? 0) <= 0) return fail(client, "その資源を持っていません");

  ps.resources[r] = (ps.resources[r] ?? 0) - 1;
  room.state.robberDiscardRemaining[p] = need - 1;

  client.send("robberDiscardProgress", { left: room.state.robberDiscardRemaining[p] });

  // 全員が捨て終わったら、盗賊移動へ
  if (isDiscardPhaseComplete(room)) {
    room.state.robberStep = RobberStep.MoveWaiting;

    const mover = room.state.robberMoverIndex;
    if (mover >= 0 && mover < room.clients.length) {
      room.clients[mover]?.send?.("robberMoveRequired", true);
    }
    // 全体通知（任意）
    room.broadcast("robberDiscardFinished", {});
  }
}
