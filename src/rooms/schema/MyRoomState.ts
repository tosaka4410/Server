import { Schema, ArraySchema, type, MapSchema } from "@colyseus/schema";

// タイル1枚の定義
export class Tile extends Schema {
  @type("number") x: number = 0; // 六角形グリッドのX座標 (q)
  @type("number") y: number = 0; // 六角形グリッドのY座標 (r)
  @type("number") resourceType: number = 0; // 0:砂漠, 1:木, 2:レンガ...
  @type("number") numberToken: number = 0;  // 2〜12の数字
}

export class Structure extends Schema {
  @type("number") ownerIndex: number = -1; // 所有プレイヤーID (0~3)
  @type("number") type: number = 0; // 1:道, 2:開拓地, 3:都市
}

export class MyRoomState extends Schema {

  @type("string") mySynchronizedProperty: string = "Hello world";

  @type("number") dice1: number = 1;
  @type("number") dice2: number = 1;
  @type([Tile]) tiles = new ArraySchema<Tile>();

  // キーは座標ID (例: "x_y")
  @type({ map: Structure }) settlements = new MapSchema<Structure>();
  @type({ map: Structure }) roads = new MapSchema<Structure>();

  // 0: 初期配置1巡目, 1: 初期配置2巡目, 2: 本番
  @type("number") phase: number = 0;

  // 「今誰のターンか」をクライアントにも知らせる
  @type("number") currentPlayerIndex: number = 0;

  // 0〜(playerCount*2 - 1) のカウンタ
  @type("number") initialPlacementTurn: number = 0;

  // 今の手番で「開拓地」か「道」か
  // 0: 開拓地, 1: 道
  @type("number") initialPlacementStep: number = 0;

  // プレイヤー人数（とりあえず 4 で固定でも可）
  @type("number") playerCount: number = 4;
  // 0: サイコロ前, 1: サイコロ後
  @type("number") turnStep: number = 0;

}
