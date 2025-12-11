import { Room, Client } from "@colyseus/core";
import { MyRoomState, Tile } from "./schema/MyRoomState";

export class MyRoom extends Room<MyRoomState> {
  maxClients = 4;
  state = new MyRoomState();

  onCreate(options: any) {

    // ゲーム開始時にボード生成
    this.generateBoard();

    this.onMessage("rollDice", (client, message) => {
      // 1〜6の乱数を生成
      const d1 = Math.floor(Math.random() * 6) + 1;
      const d2 = Math.floor(Math.random() * 6) + 1;

      // Stateを更新 (自動的に全クライアントに同期されます)
      this.state.dice1 = d1;
      this.state.dice2 = d2;

      console.log(`Player ${client.sessionId} rolled ${d1} + ${d2}`);
    });
  }

  generateBoard() {
    // 1. 資源の山札を作成 (カタン標準の内訳)
    // 0:Desert, 1:Wood, 2:Brick, 3:Sheep, 4:Wheat, 5:Ore
    const resources = [
      0, // Desert x1
      1, 1, 1, 1, // Wood x4
      2, 2, 2,    // Brick x3
      3, 3, 3, 3, // Sheep x4
      4, 4, 4, 4, // Wheat x4
      5, 5, 5     // Ore x3
    ];

    // 2. 数字チップの山札 (砂漠用の0を含む)
    const numbers = [
      0, // Desert用
      2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12
    ];

    // 3. シャッフル (フィッシャー–イェーツ法)
    this.shuffle(resources);
    this.shuffle(numbers);

    // ※砂漠(0)の場所には数字チップは置かないルールですが、
    // ここでは簡易的にランダム配置し、表示側で「0なら表示しない」等の制御をします。

    // 4. 座標定義 (Axial Coordinates: q, r)
    // 中心(0,0)から外側へ螺旋状、あるいは行ごとに定義
    const coords = [
      { x: 0, y: -2 }, { x: 1, y: -2 }, { x: 2, y: -2 },
      { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 2, y: -1 },
      { x: -2, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: -2, y: 1 }, { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
      { x: -2, y: 2 }, { x: -1, y: 2 }, { x: 0, y: 2 }
    ];
    // ※上記はあくまで例です。19個の座標があればOKです。

    // 5. Stateに登録
    for (let i = 0; i < coords.length && i < resources.length; i++) {
      const tile = new Tile();
      tile.x = coords[i].x;
      tile.y = coords[i].y;
      tile.resourceType = resources[i];
      tile.numberToken = numbers[i];

      this.state.tiles.push(tile);
    }
  }

  // 配列をシャッフルするヘルパー関数
  shuffle(array: number[]) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!");
  }

  onLeave(client: Client, consented: boolean) {
    console.log(client.sessionId, "left!");
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

}
