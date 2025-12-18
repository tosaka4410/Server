// src/rooms/handlers/robber.ts
import type { Client } from "@colyseus/core";
import type { MyRoom } from "../MyRoom";
import { Phase, RobberStep } from "../schema/constants";
import { fail, getPlayerIndex } from "../utils/guards";
import { getRobbableVictims, stealOneRandomResource, addResourceToPlayer, finishRobberFlow } from "./robber_logic";

export function registerRobberHandlers(room: MyRoom) {
  room.onMessage("moveRobber", (client, data) => onMoveRobber(room, client, data));
  room.onMessage("robPlayer", (client, data) => onRobPlayer(room, client, data));
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
