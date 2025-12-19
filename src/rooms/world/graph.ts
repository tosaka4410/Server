// src/rooms/world/graph.ts
import type { EKey, VKey } from "./coords";

export type EdgeEndpoints = { a: number; b: number };

export class BoardGraph {
  // key<->id
  vertexKeyToId = new Map<VKey, number>();
  vertexIdToKey = new Map<number, VKey>(); // ★逆引きを持って find() 排除
  edgeKeyToId = new Map<EKey, number>();

  // adjacency
  vertexIdToNeighbors = new Map<number, Set<number>>();
  vertexIdToEdges = new Map<number, Set<number>>();
  edgeIdToEndpoints = new Map<number, EdgeEndpoints>();

  // tile-vertex link
  vertexIdToTileIds = new Map<number, number[]>();
  tileIdToVertexIds = new Map<number, number[]>();

  // edgeが何枚のタイルに接しているか（境界辺は 1）
  edgeIdToTileCount = new Map<number, number>();

  clear() {
    this.vertexKeyToId.clear();
    this.vertexIdToKey.clear();
    this.edgeKeyToId.clear();
    this.vertexIdToNeighbors.clear();
    this.vertexIdToEdges.clear();
    this.edgeIdToEndpoints.clear();
    this.vertexIdToTileIds.clear();
    this.tileIdToVertexIds.clear();
    this.edgeIdToTileCount.clear();
  }

  linkVertexTile(tileId: number, vId: number) {
    if (!this.vertexIdToTileIds.has(vId)) this.vertexIdToTileIds.set(vId, []);
    const arr = this.vertexIdToTileIds.get(vId)!;
    if (!arr.includes(tileId)) arr.push(tileId);
  }
}
