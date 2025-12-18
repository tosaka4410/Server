import { Schema, ArraySchema, type, MapSchema } from "@colyseus/schema";

export class Tile extends Schema {
  @type("number") id: number = 0;

  @type("number") q: number = 0;  // axial
  @type("number") r: number = 0;

  @type("number") x: number = 0;  // world
  @type("number") y: number = 0;

  @type("number") resourceType: number = 0; // 0:Desert, 1.. (あなたの定義でOK)
  @type("number") numberToken: number = 0;
}

export class Vertex extends Schema {
  @type("number") id: number = 0;
  @type("number") x: number = 0;
  @type("number") y: number = 0;
}

export class Edge extends Schema {
  @type("number") id: number = 0;
  @type("number") a: number = 0; // vertexId
  @type("number") b: number = 0; // vertexId

  // 表示用に中心座標も持たせる（UnityでedgeSpotの位置に使う）
  @type("number") x: number = 0;
  @type("number") y: number = 0;
}

export class Structure extends Schema {
  @type("number") ownerIndex: number = -1;
  @type("number") type: number = 0; // 1:Road 2:Settlement 3:City
}

export class PlayerState extends Schema {
  // resource[0..4] = wood, brick, sheep, wheat, ore
  @type(["number"]) resources = new ArraySchema<number>(0, 0, 0, 0, 0);
  @type(["number"]) devCards = new ArraySchema<number>();  // card types
  @type("number") devBoughtThisTurn = 0;
  @type("number") devPlayedThisTurn = 0;
  @type("number") knightsPlayed = 0;
  @type("number") devVictoryPoints = 0;
}

export class MyRoomState extends Schema {
  @type([Tile]) tiles = new ArraySchema<Tile>();
  @type([Vertex]) vertices = new ArraySchema<Vertex>();
  @type([Edge]) edges = new ArraySchema<Edge>();

  // 建設結果は「頂点ID」「辺ID」をキーにする
  @type({ map: Structure }) settlements = new MapSchema<Structure>(); // key = vertexId string
  @type({ map: Structure }) roads = new MapSchema<Structure>();       // key = edgeId string

  @type("number") dice1: number = 1;
  @type("number") dice2: number = 1;

  // フェーズ・手番
  @type("number") phase: number = 0;              // 0/1/2
  @type("number") currentPlayerIndex: number = 0;
  @type("number") initialPlacementTurn: number = 0;
  @type("number") initialPlacementStep: number = 0;
  @type("number") playerCount: number = 4;
  @type("number") turnStep: number = 0;           // 本番：0サイコロ前/1後

  // プレイヤー状態配列
  @type([PlayerState]) players = new ArraySchema<PlayerState>();

  @type("number") bankWood: number = 19;
  @type("number") bankBrick: number = 19;
  @type("number") bankSheep: number = 19;
  @type("number") bankWheat: number = 19;
  @type("number") bankOre: number = 19;

  // 盗賊関連
  @type("number") robberTileId: number = 9;          // 盗賊がいるタイル（初期は砂漠など）
  @type("number") robberStep: number = 0;            // 0:なし 1:捨て札中 2:移動待ち 3:奪う待ち
  @type("number") robberMoverIndex: number = -1;     // 盗賊を動かすプレイヤー（基本は手番）

  // 発展カード関連
  @type(["number"]) devDeck = new ArraySchema<number>(); // 山札（シャッフル済みのカードタイプ配列）
  @type("number") largestArmyOwner = -1;
  @type("number") largestArmySize = 0;

  @type("number") freeRoadOwner = -1;   // 無料道路モードのプレイヤー
  @type("number") freeRoadsLeft = 0;    // 残り何本無料で置けるか（0/1/2）

}
