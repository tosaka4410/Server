// src/rooms/utils/guards.ts
import type { Client } from "@colyseus/core";
import type { MyRoom } from "../MyRoom";
import { Phase, TurnStep } from "../schema/constants";

export function fail(client: Client, reason: string) {
  client.send("buildError", { reason });
}

export function getPlayerIndex(room: MyRoom, client: Client): number | null {
  const idx = room.players.indexOf(client);
  return idx >= 0 ? idx : null;
}

export function isInitialPhase(room: MyRoom): boolean {
  return room.state.phase === Phase.InitialPlacement1 || room.state.phase === Phase.InitialPlacement2;
}

export function assertInitialStepOrFail(room: MyRoom, client: Client, structureType: string): boolean {
  if (!isInitialPhase(room)) return true;

  const step = room.state.initialPlacementStep;
  if (step === 0 && structureType !== "settlement") return (fail(client, "Invalid structure for initial placement."), false);
  if (step === 1 && structureType !== "road") return (fail(client, "Invalid structure for initial placement."), false);
  return true;
}

export function assertTurnOrFail(room: MyRoom, client: Client, p: number): boolean {
  if (isInitialPhase(room)) {
    const expected = room.getCurrentInitialPlacementPlayer();
    if (p !== expected) return (fail(client, "Not your initial placement turn."), false);
    return true;
  }

  if (p !== room.state.currentPlayerIndex) return (fail(client, "Not your turn."), false);
  if (room.state.turnStep !== TurnStep.AfterRoll) return (fail(client, "You must roll dice before building."), false);
  return true;
}

export function assertFreeRoadModeOrFail(room: MyRoom, client: Client, p: number, structureType: string): boolean {
  const isFreeRoadMode = room.state.freeRoadsLeft > 0;
  if (!isFreeRoadMode) return true;

  if (p !== room.state.freeRoadOwner) return (fail(client, "他プレイヤーの街道建設中です"), false);
  if (structureType !== "road") return (fail(client, "街道建設中は道だけ置けます"), false);
  return true;
}
