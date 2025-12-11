import { Schema, ArraySchema, type } from "@colyseus/schema";

// タイル1枚の定義
export class Tile extends Schema {
    @type("number") x: number = 0; // 六角形グリッドのX座標 (q)
    @type("number") y: number = 0; // 六角形グリッドのY座標 (r)
    @type("number") resourceType: number = 0; // 0:砂漠, 1:木, 2:レンガ...
    @type("number") numberToken: number = 0;  // 2〜12の数字
}

export class MyRoomState extends Schema {

  @type("string") mySynchronizedProperty: string = "Hello world";

  @type("number") dice1: number = 1;
  @type("number") dice2: number = 1;
  @type([Tile]) tiles = new ArraySchema<Tile>();

}
