import type { MyRoom } from "../MyRoom";
import { StructureType } from "../schema/constants";

const WIN_POINTS = 10;

export function recomputeVictoryPoints(room: MyRoom) {
  for (let p = 0; p < room.state.players.length; p++) {
    room.state.players[p].victoryPoints = computePoints(room, p);
  }
}

// 10点到達をチェックし、到達していたらゲーム終了を確定
export function checkWinAndEndIfNeeded(room: MyRoom) {
  if (room.state.gameOver) return;

  // 先に点数を最新化
  recomputeVictoryPoints(room);

  let winner = -1;
  let best = -1;

  for (let p = 0; p < room.state.players.length; p++) {
    const vp = room.state.players[p].victoryPoints;
    if (vp >= WIN_POINTS && vp > best) {
      best = vp;
      winner = p;
    }
  }

  if (winner !== -1) {
    room.state.gameOver = 1;
    room.state.gameOverWinner = winner;

    room.broadcast("gameOver", { winnerIndex: winner, points: best });
  }
}

function computePoints(room: MyRoom, p: number): number {
  let settlementPoints = 0;

  // 開拓地/都市
  for (const s of room.state.settlements.values()) {
    if (s.ownerIndex !== p) continue;
    if (s.type === StructureType.Settlement) settlementPoints += 1;
    else if (s.type === StructureType.City) settlementPoints += 2;
  }

  // 発展カード（勝利点）
  const devVP = room.state.players[p].devVictoryPoints ?? 0;

  // 最長交易路（2 or 0）
  const lr = room.state.players[p].longestRoadPoints ?? 0;

  // 最大騎士力（2 or 0）
  const la = room.state.players[p].largestArmyPoints ?? 0;

  return settlementPoints + devVP + lr + la;
}
