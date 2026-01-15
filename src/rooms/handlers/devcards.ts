// src/rooms/handlers/devcards.ts
import type { Client } from "@colyseus/core";
import type { MyRoom } from "../MyRoom";
import { DevCard, Phase } from "../schema/constants";
import { fail, getPlayerIndex } from "../utils/guards";
import { checkWinAndEndIfNeeded } from "./victory";

export function registerDevCardHandlers(room: MyRoom) {
  initDevDeck(room);

  room.onMessage("buyDevCard", (client) => onBuyDevCard(room, client));
  room.onMessage("playDevCard", (client, data) => onPlayDevCard(room, client, data));
}

function initDevDeck(room: MyRoom) {
  const deck: number[] = [];
  for (let i = 0; i < 14; i++) deck.push(DevCard.Knight);
  for (let i = 0; i < 2; i++) deck.push(DevCard.RoadBuilding);
  for (let i = 0; i < 2; i++) deck.push(DevCard.YearOfPlenty);
  for (let i = 0; i < 2; i++) deck.push(DevCard.Monopoly);
  for (let i = 0; i < 5; i++) deck.push(DevCard.VictoryPoint);

  // roomのshuffleを使わず、簡易に
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  room.state.devDeck.clear();
  for (const c of deck) room.state.devDeck.push(c);
}

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

function onBuyDevCard(room: MyRoom, client: Client) {
  if (room.state.gameOver) return;

  const p = getPlayerIndex(room, client);
  if (p == null) return;

  if (room.state.phase !== Phase.Main) return;
  if (p !== room.state.currentPlayerIndex) return;
  if (room.state.turnStep !== 1) return;
  if (room.state.robberStep !== 0) return fail(client, "盗賊処理中は発展カードを買えません");

  if (room.state.devDeck.length <= 0) return fail(client, "発展カードの山札がありません");

  const ps = room.state.players[p];
  if (!tryConsume(ps.resources as any, { 2: 1, 3: 1, 4: 1 })) return fail(client, "資源が足りません（羊/麦/鉄）");

  const card = room.state.devDeck.pop();
  ps.devCards.push(card);
  ps.devBoughtThisTurn = 1;

  client.send("devCardBought", { cardType: card });
}

function onPlayDevCard(room: MyRoom, client: Client, data: any) {
  if (room.state.gameOver) return;

  const p = getPlayerIndex(room, client);
  if (p == null) return;

  if (room.state.phase !== Phase.Main) return;
  if (p !== room.state.currentPlayerIndex) return;
  if (room.state.turnStep !== 1) return;
  if (room.state.robberStep !== 0) return fail(client, "盗賊処理中は発展カードを使えません");

  const ps = room.state.players[p];

  if (ps.devPlayedThisTurn) return fail(client, "このターンは既に発展カードを使っています");

  const cardType = Number(data?.cardType);
  if (!Number.isInteger(cardType)) return;

  const idx = ps.devCards.findIndex((x) => x === cardType);
  if (idx < 0) return fail(client, "その発展カードを持っていません");

  const isVP = cardType === DevCard.VictoryPoint;
  if (!isVP && ps.devBoughtThisTurn) return fail(client, "このターン買った発展カードは使えません");

  ps.devCards.splice(idx, 1);
  if (!isVP) ps.devPlayedThisTurn = 1;

  switch (cardType) {
    case DevCard.Knight:
      ps.knightsPlayed++;
      updateLargestArmy(room);
      checkWinAndEndIfNeeded(room);
      room.state.robberStep = 2; // MoveWaiting
      client.send("robberMoveRequired", true);
      break;

    case DevCard.YearOfPlenty: {
      const a = Number(data?.a);
      const b = Number(data?.b);
      if (![a, b].every((x) => Number.isInteger(x) && x >= 0 && x <= 4)) return fail(client, "豊作の指定が不正です");
      const res = ps.resources;
      res[a] = (res[a] ?? 0) + 1;
      res[b] = (res[b] ?? 0) + 1;
      break;
    }

    case DevCard.Monopoly: {
      const r = Number(data?.resourceIndex);
      if (!Number.isInteger(r) || r < 0 || r > 4) return fail(client, "独占の指定が不正です");

      let total = 0;
      for (let i = 0; i < room.state.players.length; i++) {
        if (i === p) continue;
        const res = room.state.players[i].resources;
        const have = res[r] ?? 0;
        if (have > 0) {
          total += have;
          res[r] = 0;
        }
      }
      ps.resources[r] = (ps.resources[r] ?? 0) + total;
      break;
    }

    case DevCard.VictoryPoint:
      ps.devVictoryPoints++;
      checkWinAndEndIfNeeded(room);
      break;

    case DevCard.RoadBuilding:
      if (room.state.freeRoadsLeft > 0) return fail(client, "すでに街道建設が進行中です");
      room.state.freeRoadOwner = p;
      room.state.freeRoadsLeft = 2;
      client.send("roadBuildingStarted", { left: 2 });
      break;

    default:
      fail(client, "未実装の発展カードです");
      break;
  }
}

function updateLargestArmy(room: MyRoom) {
  const prevOwner = room.state.largestArmyOwner;
  const prevSize = room.state.largestArmySize;

  // まず全員のポイントを0に（小規模なので毎回リセットでOK）
  for (let i = 0; i < room.state.players.length; i++) {
    room.state.players[i].largestArmyPoints = 0;
  }

  // 最高騎士数を集計
  let bestSize = -1;
  let bestPlayers: number[] = [];
  for (let i = 0; i < room.state.players.length; i++) {
    const n = room.state.players[i].knightsPlayed;
    if (n < 3) continue; // 3未満は候補外

    if (n > bestSize) {
      bestSize = n;
      bestPlayers = [i];
    } else if (n === bestSize) {
      bestPlayers.push(i);
    }
  }

  // 候補がいない（誰も3未満）なら、保持者なし
  if (bestPlayers.length === 0) {
    room.state.largestArmyOwner = -1;
    room.state.largestArmySize = 0;
    return;
  }

  // 同点トップが複数いる場合：
  // - 既に保持者がいて、その保持者が同点トップに含まれるなら維持
  // - それ以外は「誰も獲得しない」
  if (bestPlayers.length >= 2) {
    if (prevOwner !== -1 && bestPlayers.includes(prevOwner) && prevSize === bestSize) {
      // 維持
      room.state.largestArmyOwner = prevOwner;
      room.state.largestArmySize = bestSize;
      room.state.players[prevOwner].largestArmyPoints = 2;
    } else {
      // 誰も獲得しない（保持者がいた場合も剥奪）
      room.state.largestArmyOwner = -1;
      room.state.largestArmySize = bestSize; // ここは0でもいいが、デバッグ用に残してOK
    }
    return;
  }

  // 単独トップ
  const candidate = bestPlayers[0];

  // ★カタン準拠：保持者がいる場合、"より多い" ときだけ奪える（同点では奪えない）
  if (prevOwner !== -1) {
    if (bestSize > prevSize) {
      room.state.largestArmyOwner = candidate;
      room.state.largestArmySize = bestSize;
      room.state.players[candidate].largestArmyPoints = 2;
    } else {
      // bestSize == prevSize のはず（knightsは減らない）
      room.state.largestArmyOwner = prevOwner;
      room.state.largestArmySize = prevSize;
      room.state.players[prevOwner].largestArmyPoints = 2;
    }
    return;
  }

  // 保持者なし → 単独トップなら付与
  room.state.largestArmyOwner = candidate;
  room.state.largestArmySize = bestSize;
  room.state.players[candidate].largestArmyPoints = 2;
}


