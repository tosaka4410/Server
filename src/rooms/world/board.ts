// src/rooms/world/board.ts
import type { MyRoomState, Tile, Vertex, Edge } from "../../schema/MyRoomState";
import { Tile as TileSchema, Vertex as VertexSchema, Edge as EdgeSchema } from "../../schema/MyRoomState";
import { ResourceType } from "../../schema/constants";
import { shuffle } from "../utils/shuffle";
import { BoardGraph } from "./graph";
import { CORNER_OFFSETS, generateCatanCoords, createAxialToWorld, quantizeKey, makeEdgeKey } from "./coords";

export type BoardConfig = {
  hexSize: number;
  quantizeFactor: number;
  desertIndex: number;
};

export function buildBoardAndGraph(state: MyRoomState, graph: BoardGraph, config: BoardConfig) {
  const { hexSize, quantizeFactor, desertIndex } = config;

  const axialToWorld = createAxialToWorld(hexSize);
  const coords = generateCatanCoords();

  // 資源・数字（あなたの既存と同じ）
  const resources = [
    ResourceType.Wood, ResourceType.Wood, ResourceType.Wood, ResourceType.Wood,
    ResourceType.Brick, ResourceType.Brick, ResourceType.Brick,
    ResourceType.Sheep, ResourceType.Sheep, ResourceType.Sheep, ResourceType.Sheep,
    ResourceType.Wheat, ResourceType.Wheat, ResourceType.Wheat, ResourceType.Wheat,
    ResourceType.Ore, ResourceType.Ore, ResourceType.Ore
  ];
  const numbers = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
  shuffle(resources);
  shuffle(numbers);

  let resIdx = 0;
  let numIdx = 0;

  // state / graph をクリア
  state.tiles.clear();
  state.vertices.clear();
  state.edges.clear();
  graph.clear();

  for (let i = 0; i < coords.length; i++) {
    const { q, r } = coords[i];
    const p = axialToWorld(q, r);

    const t = new TileSchema();
    t.id = i;
    t.q = q;
    t.r = r;
    t.x = p.x;
    t.y = p.y;

    if (i === desertIndex) {
      t.resourceType = ResourceType.Desert;
      t.numberToken = 0;
    } else {
      t.resourceType = resources[resIdx++];
      t.numberToken = numbers[numIdx++];
    }
    state.tiles.push(t);

    // タイル周り6頂点
    const tileVertexIds: number[] = [];
    for (let k = 0; k < 6; k++) {
      const cx = p.x + CORNER_OFFSETS[k].x * hexSize;
      const cy = p.y + CORNER_OFFSETS[k].y * hexSize;

      const vKey = quantizeKey(cx, cy, quantizeFactor);
      let vId = graph.vertexKeyToId.get(vKey);

      if (vId == null) {
        vId = state.vertices.length;
        graph.vertexKeyToId.set(vKey, vId);
        graph.vertexIdToKey.set(vId, vKey);

        const v = new VertexSchema();
        v.id = vId;
        v.x = cx;
        v.y = cy;
        state.vertices.push(v);

        graph.vertexIdToNeighbors.set(vId, new Set());
        graph.vertexIdToEdges.set(vId, new Set());
      }
      tileVertexIds.push(vId);
    }

    graph.tileIdToVertexIds.set(t.id, tileVertexIds);
    for (const vId of tileVertexIds) graph.linkVertexTile(t.id, vId);

    // 6辺（重複排除）
    for (let k = 0; k < 6; k++) {
      const a = tileVertexIds[k];
      const b = tileVertexIds[(k + 1) % 6];

      const aKey = graph.vertexIdToKey.get(a)!;
      const bKey = graph.vertexIdToKey.get(b)!;
      const eKey = makeEdgeKey(aKey, bKey);

      let eId = graph.edgeKeyToId.get(eKey);
      if (eId == null) {
        eId = state.edges.length;
        graph.edgeKeyToId.set(eKey, eId);

        const va = state.vertices[a];
        const vb = state.vertices[b];

        const e = new EdgeSchema();
        e.id = eId;
        e.a = a;
        e.b = b;
        e.x = (va.x + vb.x) / 2;
        e.y = (va.y + vb.y) / 2;
        state.edges.push(e);

        graph.edgeIdToEndpoints.set(eId, { a, b });
        graph.vertexIdToEdges.get(a)!.add(eId);
        graph.vertexIdToEdges.get(b)!.add(eId);
        graph.vertexIdToNeighbors.get(a)!.add(b);
        graph.vertexIdToNeighbors.get(b)!.add(a);
      }
    }
  }
}
