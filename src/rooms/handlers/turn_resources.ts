// src/rooms/handlers/turn_resources.ts
import type { MyRoom } from "../MyRoom";

function resourceIndexFromTileResourceType(rt: number): number | null {
  switch (rt) {
    case 1: return 0; // wood
    case 2: return 1; // brick
    case 3: return 2; // sheep
    case 4: return 3; // wheat
    case 5: return 4; // ore
    default: return null;
  }
}

function addResourceToPlayer(room: MyRoom, pIndex: number, resIdx: number, amount: number) {
  const p = room.state.players[pIndex];
  p.resources[resIdx] = (p.resources[resIdx] ?? 0) + amount;
}

export function distributeResourcesByDice(room: MyRoom, sum: number) {
  if (sum === 7) return;

  for (let i = 0; i < room.state.tiles.length; i++) {
    const tile = room.state.tiles[i];
    if (tile.numberToken !== sum) continue;

    // 盗賊がいるタイルは産出しない
    if (tile.id === room.state.robberTileId) continue;


    const resIdx = resourceIndexFromTileResourceType(tile.resourceType);
    if (resIdx == null) continue;

    const vIds = room.graph.tileIdToVertexIds.get(tile.id) ?? [];
    for (const vId of vIds) {
      const s = room.state.settlements.get(String(vId));
      if (!s) continue;

      const owner = s.ownerIndex;
      const amount = (s.type === 3) ? 2 : 1; // city=2, settlement=1
      addResourceToPlayer(room, owner, resIdx, amount);
    }
  }
}
