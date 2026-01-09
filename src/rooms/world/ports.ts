// src/rooms/world/ports.ts
import type { MyRoomState } from "../schema/MyRoomState";
import { Port } from "../schema/MyRoomState";
import type { BoardGraph } from "./graph";
import { ResourceType } from "../schema/constants";
import { shuffle } from "../utils/shuffle";

type PortSpec =
  | { kind: 0; ratio: 3; resourceType: 0 }              // 3:1 汎用
  | { kind: 1; ratio: 2; resourceType: number };        // 2:1 指定

export function buildPorts(state: MyRoomState, graph: BoardGraph) {
  state.ports.clear();

  // 1) 境界辺を集める
  const boundaryEdgeIds: number[] = [];
  for (const [eId, c] of graph.edgeIdToTileCount.entries()) {
    if (c === 1) boundaryEdgeIds.push(eId);
  }
  if (boundaryEdgeIds.length === 0) return;

  // 2) 角度でソート（盤面中心(0,0)前提。ズレるなら中心を計算してもOK）
  const sorted = boundaryEdgeIds
    .map((eId) => {
      const e = state.edges[eId];
      const angle = Math.atan2(e.y, e.x);
      return { eId, angle };
    })
    .sort((a, b) => a.angle - b.angle)
    .map(x => x.eId);

  // 3') 角度を -π〜π に正規化
  const angled = sorted.map(eId => {
    const e = state.edges[eId];
    let a = Math.atan2(e.y, e.x);
    if (a < 0) a += Math.PI * 2;
    return { eId, angle: a };
  });

  // 3'') 理想角に最も近い辺を選ぶ
  const portCount = 9;
  const picked: number[] = [];

  for (let i = 0; i < portCount; i++) {
    const target = (Math.PI * 2 * i) / portCount;

    let best = angled[0];
    let bestDiff = Math.abs(angled[0].angle - target);

    for (const a of angled) {
      const diff = Math.abs(a.angle - target);
      if (diff < bestDiff) {
        best = a;
        bestDiff = diff;
      }
    }

    picked.push(best.eId);
  }


  // 4) 港種類（標準：3:1×4、2:1×5（木/レンガ/羊/麦/鉄））
  const specs: PortSpec[] = [
    { kind: 0, ratio: 3, resourceType: 0 },
    { kind: 0, ratio: 3, resourceType: 0 },
    { kind: 0, ratio: 3, resourceType: 0 },
    { kind: 0, ratio: 3, resourceType: 0 },
    { kind: 1, ratio: 2, resourceType: ResourceType.Wood },
    { kind: 1, ratio: 2, resourceType: ResourceType.Brick },
    { kind: 1, ratio: 2, resourceType: ResourceType.Sheep },
    { kind: 1, ratio: 2, resourceType: ResourceType.Wheat },
    { kind: 1, ratio: 2, resourceType: ResourceType.Ore },
  ];
  shuffle(specs);

  // 5) state.ports 生成（港は「辺」に置き、その両端頂点を持つ）
  for (let i = 0; i < portCount; i++) {
    const eId = picked[i];
    const e = state.edges[eId];

    const p = new Port();
    p.id = i;
    p.kind = specs[i].kind;
    p.resourceType = specs[i].resourceType;
    p.ratio = specs[i].ratio;
    p.vertexA = e.a;
    p.vertexB = e.b;
    p.x = e.x;
    p.y = e.y;

    state.ports.push(p);
  }
}
