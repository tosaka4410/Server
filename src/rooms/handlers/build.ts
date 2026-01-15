// src/rooms/handlers/build.ts
import type { Client } from "@colyseus/core";
import type { MyRoom } from "../MyRoom";
import { Structure } from "../schema/MyRoomState";
import { Phase, StructureType } from "../schema/constants";
import { COST_CITY, COST_SETTLEMENT } from "../rules/costs";
import { fail, getPlayerIndex, assertTurnOrFail, assertInitialStepOrFail, assertFreeRoadModeOrFail, isInitialPhase } from "../utils/guards";
import { recomputeLongestRoad } from "./longestRoad";
import { MAX_CITIES, MAX_ROADS, MAX_SETTLEMENTS } from "../rules/pieceLimits";
import { checkWinAndEndIfNeeded } from "./victory";


type BuildMessage =
  | { structureType: "settlement"; id: number }
  | { structureType: "city"; id: number }
  | { structureType: "road"; id: number };

export function registerBuildHandlers(room: MyRoom) {
  room.onMessage("build", (client, data: BuildMessage) => handleBuild(room, client, data));
}

function handleBuild(room: MyRoom, client: Client, data: BuildMessage) {
  if (room.state.gameOver) return fail(client, "ゲームは終了しています");

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

function countMyRoads(room: MyRoom, p: number): number {
  let n = 0;
  for (const s of room.state.roads.values()) {
    if (s.ownerIndex === p) n++;
  }
  return n;
}

function countMySettlements(room: MyRoom, p: number): number {
  let n = 0;
  for (const s of room.state.settlements.values()) {
    if (s.ownerIndex === p && s.type === StructureType.Settlement) n++;
  }
  return n;
}

function countMyCities(room: MyRoom, p: number): number {
  let n = 0;
  for (const s of room.state.settlements.values()) {
    if (s.ownerIndex === p && s.type === StructureType.City) n++;
  }
  return n;
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
  if (countMySettlements(room, p) >= MAX_SETTLEMENTS) {
    return fail(client, "開拓地の在庫がありません（上限）");
  }
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
  recomputeLongestRoad(room);
  checkWinAndEndIfNeeded(room);

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

  if (countMyCities(room, p) >= MAX_CITIES) {
    return fail(client, "都市の在庫がありません（上限）");
  }

  const r = canUpgradeToCity(room, p, vId);
  if (!r.ok) return fail(client, r.reason!);

  if (!tryPayOrFail(room, client, p, COST_CITY, "資源が足りません（都市）")) return;

  const key = String(vId);
  const old = room.state.settlements.get(key)!;
  const upgraded = new Structure();
  upgraded.ownerIndex = old.ownerIndex;
  upgraded.type = StructureType.City;
  room.state.settlements.set(key, upgraded);
  recomputeLongestRoad(room);
  checkWinAndEndIfNeeded(room);
}

// ===== helper functions =====
function isMyBuildingAtVertex(room: MyRoom, p: number, vId: number): boolean {
  const s = room.state.settlements.get(String(vId));
  if (!s) return false;
  return s.ownerIndex === p && (s.type === StructureType.Settlement || s.type === StructureType.City);
}

function isOpponentBuildingAtVertex(room: MyRoom, p: number, vId: number): boolean {
  const s = room.state.settlements.get(String(vId));
  if (!s) return false;
  return s.ownerIndex !== p && (s.type === StructureType.Settlement || s.type === StructureType.City);
}

function hasMyRoadAtVertex(room: MyRoom, p: number, vId: number): boolean {
  const edges = room.graph.vertexIdToEdges.get(vId);
  if (!edges) return false;
  for (const eId of edges) {
    const r = room.state.roads.get(String(eId));
    if (r && r.ownerIndex === p) return true;
  }
  return false;
}

/**
 * 通常時（初期配置以外）の「道路接続」判定
 * - 端点vが相手建物なら、その端点を使っての接続は不可（自分建物があるなら可）
 * - 接続は「自分建物」または「自分の既存道路」
 */
function canConnectRoadFromVertex(room: MyRoom, p: number, vId: number): boolean {
  if (isOpponentBuildingAtVertex(room, p, vId) && !isMyBuildingAtVertex(room, p, vId)) {
    return false; // 相手建物でブロック
  }
  if (isMyBuildingAtVertex(room, p, vId)) return true;
  if (hasMyRoadAtVertex(room, p, vId)) return true;
  return false;
}



// ===== Road =====
function buildRoad(room: MyRoom, client: Client, p: number, eId: number) {
  if (!Number.isInteger(eId) || eId < 0 || eId >= room.state.edges.length) return fail(client, "無効な辺IDです");

  const key = String(eId);
  if (room.state.roads.has(key)) return fail(client, "そこには既に道があります");

  const e = room.state.edges[eId];
  const a = e.a;
  const b = e.b;

  const initial = isInitialPhase(room);
  const freeMode = room.state.freeRoadsLeft > 0 && p === room.state.freeRoadOwner;

  // ===== 置ける場所チェック（カタン準拠） =====
  if (initial) {
    // 初期配置の道路は、直前に置いた自分の開拓地に隣接している必要がある
    const pendingV = room.pendingInitialSettlementByPlayer.get(p);
    if (pendingV == null) return fail(client, "初期配置: 先に開拓地を置いてください");
    if (a !== pendingV && b !== pendingV) return fail(client, "初期配置: 道は置いた開拓地に隣接している必要があります");
  } else {
    // 通常時（本番/街道建設カード含む）は「自分のネットワークに接続」している必要
    const okA = canConnectRoadFromVertex(room, p, a);
    const okB = canConnectRoadFromVertex(room, p, b);
    if (!okA && !okB) return fail(client, "道は自分の道/建物に接続している必要があります（相手建物でブロックされる場合もあります）");
  }

  // ===== 支払い（初期配置は無料、街道建設カード中も無料） =====
  if (!initial && !freeMode) {
    const ps = room.state.players[p];
    // wood(0) brick(1)
    if (!tryConsume(ps.resources as any, { 0: 1, 1: 1 })) return fail(client, "資源が足りません（木/レンガ）");
  }

  // ===== 設置 =====
  const s = new Structure();
  s.ownerIndex = p;
  s.type = StructureType.Road;
  room.state.roads.set(key, s);

  recomputeLongestRoad(room);
  checkWinAndEndIfNeeded(room);

  // ===== フロー更新 =====
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
