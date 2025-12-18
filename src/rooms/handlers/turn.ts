// src/rooms/handlers/turn.ts
import type { Client } from "@colyseus/core";
import type { MyRoom } from "../MyRoom";
import { Phase, TurnStep, RobberStep } from "../schema/constants";
import { fail, getPlayerIndex } from "../utils/guards";
import { distributeResourcesByDice } from "./turn_resources";
import { startRobberFlow, autoDiscardAllRequired } from "./robber_logic";

export function registerTurnHandlers(room: MyRoom) {
  room.onMessage("rollDice", (client) => onRollDice(room, client));
  room.onMessage("endTurn", (client) => onEndTurn(room, client));
}

function onRollDice(room: MyRoom, client: Client) {
  const p = getPlayerIndex(room, client);
  if (p == null) return;

  if (room.state.phase !== Phase.Main) return;
  if (p !== room.state.currentPlayerIndex) return;
  if (room.state.turnStep !== TurnStep.BeforeRoll) return;
  if (room.state.robberStep !== RobberStep.None) return;

  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;

  room.state.dice1 = d1;
  room.state.dice2 = d2;

  const sum = d1 + d2;

  if (sum === 7) {
    const anyDiscard = startRobberFlow(room, p);

    if (anyDiscard) {
      autoDiscardAllRequired(room);
      room.state.robberStep = RobberStep.MoveWaiting;
    }

    client.send("robberMoveRequired", true);
    return;
  }

  distributeResourcesByDice(room, sum);
  room.state.turnStep = TurnStep.AfterRoll;
}

function onEndTurn(room: MyRoom, client: Client) {
  const p = getPlayerIndex(room, client);
  if (p == null) return;

  if (room.state.phase !== Phase.Main) return;
  if (p !== room.state.currentPlayerIndex) return;
  if (room.state.turnStep === TurnStep.BeforeRoll) return;

  if (room.state.freeRoadsLeft > 0) return fail(client, "街道建設（無料道路）を完了してください");

  const next = (room.state.currentPlayerIndex + 1) % room.state.playerCount;
  room.state.currentPlayerIndex = next;
  room.state.turnStep = TurnStep.BeforeRoll;

  const ps = room.state.players[next];
  ps.devPlayedThisTurn = 0;
  ps.devBoughtThisTurn = 0;
}
