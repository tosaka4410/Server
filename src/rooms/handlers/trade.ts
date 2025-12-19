// src/rooms/handlers/trade.ts
import type { Client } from "@colyseus/core";
import type { MyRoom } from "../MyRoom";
import { Phase, TurnStep, StructureType } from "../schema/constants";
import { fail, getPlayerIndex } from "../utils/guards";

type TradeMessage = {
  giveRes: number;      // 0..4 (wood..ore index)
  receiveRes: number;   // 0..4
  giveCount?: number;   // 省略ならサーバが必要数を返す運用も可。今回は必須扱い。
};

export function registerTradeHandlers(room: MyRoom) {
  room.onMessage("trade", (client, data: TradeMessage) => onTrade(room, client, data));
}

// resIndex(0..4) -> tile resourceType(1..5)
function resIndexToResourceType(resIndex: number): number {
  return resIndex + 1;
}

function onTrade(room: MyRoom, client: Client, data: TradeMessage) {
  const p = getPlayerIndex(room, client);
  if (p == null) return;

  // 本番のみ＆手番＆サイコロ後（運用に合わせて調整OK）
  if (room.state.phase !== Phase.Main) return;
  if (p !== room.state.currentPlayerIndex) return fail(client, "手番ではありません");
  if (room.state.turnStep !== TurnStep.AfterRoll) return fail(client, "先にサイコロを振ってください");
  if (room.state.robberStep !== 0) return fail(client, "盗賊処理中は交易できません");

  const giveRes = Number(data?.giveRes);
  const receiveRes = Number(data?.receiveRes);
  const giveCount = Number(data?.giveCount);

  if (![giveRes, receiveRes, giveCount].every(Number.isInteger)) return;
  if (giveRes < 0 || giveRes > 4) return fail(client, "giveRes が不正です");
  if (receiveRes < 0 || receiveRes > 4) return fail(client, "receiveRes が不正です");
  if (giveRes === receiveRes) return fail(client, "同じ資源同士は交換できません");

  const ratio = getBestTradeRatio(room, p, giveRes); // 2 / 3 / 4
  if (giveCount !== ratio) {
    return fail(client, `必要枚数が違います（必要: ${ratio}）`);
  }

  const ps = room.state.players[p];
  if ((ps.resources[giveRes] ?? 0) < ratio) return fail(client, "資源が足りません");

  // 支払い
  ps.resources[giveRes] = (ps.resources[giveRes] ?? 0) - ratio;
  // 受け取り
  ps.resources[receiveRes] = (ps.resources[receiveRes] ?? 0) + 1;

  client.send("tradeResult", { ok: true, ratio });
}

// プレイヤーpが giveRes を出すときに使える最良比率を返す
// 2:1(指定) > 3:1(汎用) > 4:1(銀行)
function getBestTradeRatio(room: MyRoom, p: number, giveResIndex: number): 2 | 3 | 4 {
  const giveType = resIndexToResourceType(giveResIndex); // 1..5

  const myPortRatios: number[] = [];

  // 自分の建物がある頂点を列挙
  const myVertices = new Set<number>();
  for (const [k, s] of room.state.settlements.entries()) {
    const vId = Number(k);
    if (!Number.isInteger(vId)) continue;
    if (s.ownerIndex === p && (s.type === StructureType.Settlement || s.type === StructureType.City)) {
      myVertices.add(vId);
    }
  }

  // 港の両端どちらかに建物があれば港利用可能
  for (const port of room.state.ports) {
    if (!myVertices.has(port.vertexA) && !myVertices.has(port.vertexB)) continue;

    if (port.kind === 0) {
      myPortRatios.push(3);
    } else {
      if (port.resourceType === giveType) myPortRatios.push(2);
    }
  }

  const best = myPortRatios.length ? Math.min(...myPortRatios) : 4;
  if (best <= 2) return 2;
  if (best === 3) return 3;
  return 4;
}
