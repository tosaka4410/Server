// src/rooms/handlers/build.ts
import type { Client } from "@colyseus/core";
import type { MyRoom } from "../MyRoom";
import { Structure } from "../schema/MyRoomState";
import { Phase, StructureType } from "../schema/constants";
import { COST_CITY, COST_SETTLEMENT } from "../rules/costs";
import { fail, getPlayerIndex, assertTurnOrFail, assertInitialStepOrFail, assertFreeRoadModeOrFail, isInitialPhase } from "../utils/guards";

type BuildMessage =
  | { structureType: "settlement"; id: number }
  | { structureType: "city"; id: number }
  | { structureType: "road"; id: number };

export function registerBuildHandlers(room: MyRoom) {
  room.onMessage("build", (client, data: BuildMessage) => handleBuild(room, client, data));
}

function handleBuild(room: MyRoom, client: Client, data: BuildMessage) {
  const p = getPlayerIndex(room, client);
  if (p == null) return;

  if (!assertTurnOrFail(room, client, p)) return;
  if (!assertInitialStepOrFail(room, client, data.structureType)) return;
  if (!assertFreeRoadModeOrFail(room, client, p, data.structureType)) return;

  switch (data.structureType) {
    case "settlement":
      return buildSettlement(room, client, p, Number(data.id));
    case "city":
      return buildCity(room, client, p, Number(data.id));
    case "road":
      return buildRoad(room, client, p, Number(data.id));
  }
}

// ===== 共通：支払い =====
function canPay(room: MyRoom, p: number, cost: readonly number[]) {
  const ps = room.state.players[p];
  for (let i = 0; i < 5; i++) if ((ps.resources[i] ?? 0) < cost[i]) return false;
  return true;
}
function pay(room: MyRoom, p: number, cost: readonly number[]) {
  const ps = room.state.players[p];
  for (let i = 0; i < 5; i++) ps.resources[i] = (ps.resources[i] ?? 0) - cost[i];
}
function tryPayOrFail(room: MyRoom, client: Client, p: number, cost: readonly number[], msg: string) {
  if (!canPay(room, p, cost)) return (fail(client, msg), false);
  pay(room, p, cost);
  return true;
}

function hasMyRoadConnectedToVertex(room: MyRoom, p: number, vId: number): boolean {
  const edges = room.graph.vertexIdToEdges.get(vId);
  if (!edges) return false;
  for (const eId of edges) {
    const r = room.state.roads.get(String(eId));
    if (r && r.ownerIndex === p) return true;
  }
  return false;
}

// ===== Settlement =====
function buildSettlement(room: MyRoom, client: Client, p: number, vId: number) {
  if (!Number.isInteger(vId) || vId < 0 || vId >= room.state.vertices.length) return fail(client, "Invalid vertex id.");
  if (room.state.settlements.has(String(vId))) return fail(client, "Vertex already has a settlement.");

  // 距離ルール
  const neigh = room.graph.vertexIdToNeighbors.get(vId);
  if (neigh) {
    for (const n of neigh) {
      if (room.state.settlements.has(String(n))) return fail(client, "Adjacent settlement prevents building here.");
    }
  }

  const initial = isInitialPhase(room);

  if (!initial && !hasMyRoadConnectedToVertex(room, p, vId)) return fail(client, "Must connect to one of your roads.");
  if (!initial && !tryPayOrFail(room, client, p, COST_SETTLEMENT, "資源が足りません（開拓地）")) return;

  const s = new Structure();
  s.ownerIndex = p;
  s.type = StructureType.Settlement;
  room.state.settlements.set(String(vId), s);

  if (initial) {
    room.pendingInitialSettlementByPlayer.set(p, vId);
    room.state.initialPlacementStep = 1;

    // 2周目：資源付与（この関数は robber.ts 側に移してもOK。ここでは最小）
    if (room.state.phase === Phase.InitialPlacement2) {
      grantInitialResourcesForSecondSettlement(room, p, vId);
    }
  }
}

// ===== City =====
function canUpgradeToCity(room: MyRoom, p: number, vId: number): { ok: boolean; reason?: string } {
  const s = room.state.settlements.get(String(vId));
  if (!s) return { ok: false, reason: "そこに開拓地がありません" };
  if (s.ownerIndex !== p) return { ok: false, reason: "自分の開拓地ではありません" };
  if (s.type === StructureType.City) return { ok: false, reason: "既に都市です" };
  return { ok: true };
}

function buildCity(room: MyRoom, client: Client, p: number, vId: number) {
  if (!Number.isInteger(vId) || vId < 0 || vId >= room.state.vertices.length) return fail(client, "無効な頂点IDです");
  if (isInitialPhase(room)) return fail(client, "初期配置中は都市にできません");

  const r = canUpgradeToCity(room, p, vId);
  if (!r.ok) return fail(client, r.reason!);

  if (!tryPayOrFail(room, client, p, COST_CITY, "資源が足りません（都市）")) return;

  const key = String(vId);
  const old = room.state.settlements.get(key)!;
  const upgraded = new Structure();
  upgraded.ownerIndex = old.ownerIndex;
  upgraded.type = StructureType.City;
  room.state.settlements.set(key, upgraded);
}

// ===== Road =====
function buildRoad(room: MyRoom, client: Client, p: number, eId: number) {
  if (!Number.isInteger(eId) || eId < 0 || eId >= room.state.edges.length) return fail(client, "無効な辺IDです");

  const key = String(eId);
  if (room.state.roads.has(key)) return fail(client, "そこには既に道があります");

  const initial = isInitialPhase(room);
  const freeMode = room.state.freeRoadsLeft > 0 && p === room.state.freeRoadOwner;

  // 支払い（本番＆無料道路でない）
  if (!initial && !freeMode) {
    const ps = room.state.players[p];
    // wood(0) brick(1)
    if (!tryConsume(ps.resources as any, { 0: 1, 1: 1 })) return fail(client, "資源が足りません（木/レンガ）");
  }

  const s = new Structure();
  s.ownerIndex = p;
  s.type = StructureType.Road;
  room.state.roads.set(key, s);

  if (initial) advanceInitialPlacementAfterRoad(room, p);
  if (freeMode) advanceFreeRoadMode(room, client);
}

// tryConsume は元ロジックそのまま
function tryConsume(resources: any, cost: Record<number, number>) {
  for (const kStr of Object.keys(cost)) {
    const k = Number(kStr);
    if ((resources[k] ?? 0) < cost[k]) return false;
  }
  for (const kStr of Object.keys(cost)) {
    const k = Number(kStr);
    resources[k] = (resources[k] ?? 0) - cost[k];
  }
  return true;
}

function advanceInitialPlacementAfterRoad(room: MyRoom, p: number) {
  room.pendingInitialSettlementByPlayer.delete(p);
  room.state.initialPlacementStep = 0;
  room.state.initialPlacementTurn++;

  if (room.state.initialPlacementTurn >= room.state.playerCount * 2) {
    room.state.phase = Phase.Main;
    room.state.turnStep = 0; // BeforeRoll
    room.state.currentPlayerIndex = 0;
  } else {
    // 1周目→2周目への切り替えは必要ならここで（あなたの運用に合わせて）
    // 例：turn === playerCount で phase=InitialPlacement2
    if (room.state.initialPlacementTurn === room.state.playerCount) {
      room.state.phase = Phase.InitialPlacement2;
    }
  }
}

function advanceFreeRoadMode(room: MyRoom, client: Client) {
  room.state.freeRoadsLeft--;
  if (room.state.freeRoadsLeft <= 0) {
    room.state.freeRoadsLeft = 0;
    room.state.freeRoadOwner = -1;
    client.send("roadBuildingFinished", {});
  } else {
    client.send("roadBuildingProgress", { left: room.state.freeRoadsLeft });
  }
}

function resourceIndexFromTileResourceType(rt: number): number | null {
  // tile.resourceType: 0 desert, 1 wood, 2 brick, 3 sheep, 4 wheat, 5 ore
  switch (rt) {
    case 1: return 0;
    case 2: return 1;
    case 3: return 2;
    case 4: return 3;
    case 5: return 4;
    default: return null;
  }
}
function addResourceToPlayer(room: MyRoom, p: number, resIdx: number, amount: number) {
  const ps = room.state.players[p];
  ps.resources[resIdx] = (ps.resources[resIdx] ?? 0) + amount;
}
function grantInitialResourcesForSecondSettlement(room: MyRoom, p: number, vertexId: number) {
  const tileIds = room.graph.vertexIdToTileIds.get(vertexId) ?? [];
  for (const tileId of tileIds) {
    const tile = room.state.tiles[tileId];
    const resIdx = resourceIndexFromTileResourceType(tile.resourceType);
    if (resIdx == null) continue;
    addResourceToPlayer(room, p, resIdx, 1);
  }
}
