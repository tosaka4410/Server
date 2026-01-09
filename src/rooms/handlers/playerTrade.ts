// src/rooms/handlers/playerTrade.ts
import type { Client } from "@colyseus/core";
import type { MyRoom } from "../MyRoom";
import { Phase, TurnStep, RobberStep } from "../schema/constants";
import { fail, getPlayerIndex } from "../utils/guards";

type TradeOfferPayload = {
  to: number;            // 相手プレイヤーindex
  giveRes: number;       // 0..4
  giveCount: number;     // >=1
  receiveRes: number;    // 0..4
  receiveCount: number;  // >=1
};

type TradeRespondPayload = {
  offerId: number;
  accept: boolean;
};

type PendingOffer = {
  id: number;
  from: number;
  to: number;
  giveRes: number;
  giveCount: number;
  receiveRes: number;
  receiveCount: number;
  createdAt: number;
};

export function registerPlayerTradeHandlers(room: MyRoom) {
  room.onMessage("playerTradeOffer", (client, data: TradeOfferPayload) => onOffer(room, client, data));
  room.onMessage("playerTradeRespond", (client, data: TradeRespondPayload) => onRespond(room, client, data));
  room.onMessage("playerTradeCancel", (client, data: { offerId: number }) => onCancel(room, client, data));
}

function onOffer(room: MyRoom, client: Client, data: TradeOfferPayload) {
  const from = getPlayerIndex(room, client);
  if (from == null) return;

  // 手番の人だけがオファーを出せる（標準カタン寄せ）
  if (room.state.phase !== Phase.Main) return;
  if (from !== room.state.currentPlayerIndex) return fail(client, "手番ではありません");
  if (room.state.turnStep !== TurnStep.AfterRoll) return fail(client, "先にサイコロを振ってください");
  if (room.state.robberStep !== RobberStep.None) return fail(client, "盗賊処理中は交易できません");
  if (room.state.freeRoadsLeft > 0) return fail(client, "街道建設（無料道路）を完了してください");

  const to = Number(data?.to);
  const giveRes = Number(data?.giveRes);
  const giveCount = Number(data?.giveCount);
  const receiveRes = Number(data?.receiveRes);
  const receiveCount = Number(data?.receiveCount);

  if (![to, giveRes, giveCount, receiveRes, receiveCount].every(Number.isInteger)) return;
  if (to < 0 || to >= room.state.players.length) return fail(client, "to が不正です");
  if (to === from) return fail(client, "自分とは取引できません");
  if (giveRes < 0 || giveRes > 4) return fail(client, "giveRes が不正です");
  if (receiveRes < 0 || receiveRes > 4) return fail(client, "receiveRes が不正です");
  if (giveRes === receiveRes) return fail(client, "同じ資源同士は交換できません");
  if (giveCount <= 0 || receiveCount <= 0) return fail(client, "枚数が不正です");

  // オファー時点で「自分が出せる」だけはチェック（相手は承諾時点でチェック）
  if (!hasResource(room, from, giveRes, giveCount)) return fail(client, "提示する資源が足りません");

  // オファー作成
  const offerId = room.nextTradeOfferId++;
  const offer: PendingOffer = {
    id: offerId,
    from,
    to,
    giveRes,
    giveCount,
    receiveRes,
    receiveCount,
    createdAt: Date.now(),
  };
  room.pendingTradeOffers.set(offerId, offer);

  // 相手へ通知（client index -> Client）
  const targetClient = room.players[to];
  if (!targetClient) {
    room.pendingTradeOffers.delete(offerId);
    return fail(client, "相手プレイヤーが見つかりません");
  }

  // 送信（相手）
  targetClient.send("playerTradeOfferReceived", {
    offerId,
    from,
    to,
    giveRes,
    giveCount,
    receiveRes,
    receiveCount,
  });

  // 送信（自分：送ったよ）
  client.send("playerTradeOfferSent", { offerId, to });
}

function onRespond(room: MyRoom, client: Client, data: TradeRespondPayload) {
  const responder = getPlayerIndex(room, client);
  if (responder == null) return;

  const offerId = Number(data?.offerId);
  const accept = !!data?.accept;
  if (!Number.isInteger(offerId)) return;

  const offer = room.pendingTradeOffers.get(offerId);
  if (!offer) return fail(client, "その取引提案は存在しません");

  // 承諾/拒否できるのは「宛先(to)」だけ
  if (responder !== offer.to) return fail(client, "あなた宛の提案ではありません");

  // もうこの時点で無効（手番が変わった等）を弾く：成立は「今もメインフェーズ＆手番後」
  if (room.state.phase !== Phase.Main) return invalidate(room, offer, "取引できない状態です");
  if (offer.from !== room.state.currentPlayerIndex) return invalidate(room, offer, "手番が変わったため取引できません");
  if (room.state.turnStep !== TurnStep.AfterRoll) return invalidate(room, offer, "サイコロ前には取引できません");
  if (room.state.robberStep !== RobberStep.None) return invalidate(room, offer, "盗賊処理中は取引できません");
  if (room.state.freeRoadsLeft > 0) return invalidate(room, offer, "街道建設（無料道路）中は取引できません");

  const fromClient = room.players[offer.from];
  const toClient = room.players[offer.to];

  // 拒否
  if (!accept) {
    room.pendingTradeOffers.delete(offerId);
    fromClient?.send("playerTradeOfferDeclined", { offerId, by: responder });
    toClient?.send("playerTradeOfferDeclined", { offerId, by: responder });
    return;
  }

  // 承諾：両者の資源を再検証
  if (!hasResource(room, offer.from, offer.giveRes, offer.giveCount)) {
    return invalidate(room, offer, "提案者の資源が不足しました");
  }
  if (!hasResource(room, offer.to, offer.receiveRes, offer.receiveCount)) {
    return invalidate(room, offer, "承諾者の資源が不足しています");
  }

  // 資源移動（同時決済）
  removeResource(room, offer.from, offer.giveRes, offer.giveCount);
  addResource(room, offer.to, offer.giveRes, offer.giveCount);

  removeResource(room, offer.to, offer.receiveRes, offer.receiveCount);
  addResource(room, offer.from, offer.receiveRes, offer.receiveCount);

  room.pendingTradeOffers.delete(offerId);

  // 成立通知（両者）
  const result = {
    offerId,
    from: offer.from,
    to: offer.to,
    giveRes: offer.giveRes,
    giveCount: offer.giveCount,
    receiveRes: offer.receiveRes,
    receiveCount: offer.receiveCount,
  };
  fromClient?.send("playerTradeCompleted", result);
  toClient?.send("playerTradeCompleted", result);
}

function onCancel(room: MyRoom, client: Client, data: { offerId: number }) {
  const p = getPlayerIndex(room, client);
  if (p == null) return;

  const offerId = Number(data?.offerId);
  if (!Number.isInteger(offerId)) return;

  const offer = room.pendingTradeOffers.get(offerId);
  if (!offer) return;

  // キャンセルできるのは提案者(from)
  if (offer.from !== p) return fail(client, "提案者以外はキャンセルできません");

  room.pendingTradeOffers.delete(offerId);

  const fromClient = room.players[offer.from];
  const toClient = room.players[offer.to];
  fromClient?.send("playerTradeOfferCanceled", { offerId });
  toClient?.send("playerTradeOfferCanceled", { offerId });
}

function invalidate(room: MyRoom, offer: PendingOffer, reason: string) {
  room.pendingTradeOffers.delete(offer.id);
  const fromClient = room.players[offer.from];
  const toClient = room.players[offer.to];
  fromClient?.send("playerTradeInvalidated", { offerId: offer.id, reason });
  toClient?.send("playerTradeInvalidated", { offerId: offer.id, reason });
}

function hasResource(room: MyRoom, p: number, res: number, count: number): boolean {
  const ps = room.state.players[p];
  return (ps.resources[res] ?? 0) >= count;
}
function removeResource(room: MyRoom, p: number, res: number, count: number) {
  const ps = room.state.players[p];
  ps.resources[res] = (ps.resources[res] ?? 0) - count;
}
function addResource(room: MyRoom, p: number, res: number, count: number) {
  const ps = room.state.players[p];
  ps.resources[res] = (ps.resources[res] ?? 0) + count;
}
