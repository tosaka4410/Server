import { Room, Client } from "@colyseus/core";
import { MyRoomState, Tile, Structure } from "./schema/MyRoomState";

export class MyRoom extends Room<MyRoomState> {
  maxClients = 4;

  // 接続中のクライアントを配列で管理 (順序をプレイヤー番号とする)
  players: Client[] = [];

  // Colyseus Room state must be initialized via `this.setState()`
  // to ensure the internal serializer is aware of the Schema instance.

  onCreate(options: any) {

    // Initialize Colyseus state
    this.setState(new MyRoomState());

    // ゲーム開始時にボード生成
    this.generateBoard();

    // サイコロを振るリクエストを処理
    this.onMessage("rollDice", (client, message) => {
      // 1〜6の乱数を生成
      const d1 = Math.floor(Math.random() * 6) + 1;
      const d2 = Math.floor(Math.random() * 6) + 1;

      // Stateを更新 (自動的に全クライアントに同期されます)
      this.state.dice1 = d1;
      this.state.dice2 = d2;

      console.log(`Player ${client.sessionId} rolled ${d1} + ${d2}`);
    });

    // 建物や道の建設リクエストを処理
    // data = { id: "123_456", structureType: "road" or "settlement" }
    this.onMessage("build", (client, data) => {
      const playerIndex = this.players.indexOf(client);
      if (playerIndex === -1) return;

      const structure = new Structure();
      structure.ownerIndex = playerIndex;

      if (data.structureType === "settlement") {
        structure.type = 2; // 開拓地
        // すでに建物がないかチェックすべきですが、今回は省略（上書き許可）
        this.state.settlements.set(data.id, structure);
      }
      else if (data.structureType === "road") {
        structure.type = 1; // 道
        this.state.roads.set(data.id, structure);
      }

      console.log(`P${playerIndex} built ${data.structureType} at ${data.id}`);
    });
  }

generateBoard() {
    // 1. 資源リスト（砂漠＝0 は除外）
    // 1:Wood, 2:Brick, 3:Sheep, 4:Wheat, 5:Ore
    const resources = [
        1, 1, 1, 1, // Wood x4
        2, 2, 2,    // Brick x3
        3, 3, 3, 3, // Sheep x4
        4, 4, 4, 4, // Wheat x4
        5, 5, 5     // Ore x3
    ];

    // 2. 数字リスト（砂漠用の 0 は除外）
    const numbers = [
        2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12
    ];

    // 3. シャッフル
    this.shuffle(resources);
    this.shuffle(numbers);

    // 4. 座標定義 (19タイル)
    const coords = [
        {x:0, y:-2}, {x:1, y:-2}, {x:2, y:-2},
        {x:-1, y:-1}, {x:0, y:-1}, {x:1, y:-1}, {x:2, y:-1},
        {x:-2, y:0}, {x:-1, y:0}, {x:0, y:0}, {x:1, y:0}, {x:2, y:0},
        {x:-2, y:1}, {x:-1, y:1}, {x:0, y:1}, {x:1, y:1},
        {x:-2, y:2}, {x:-1, y:2}, {x:0, y:2}
    ];

    // 5. 割り当て用インデックス
    let resIndex = 0;
    let numIndex = 0;

    for (let i = 0; i < coords.length; i++) {
        const tile = new Tile();
        tile.x = coords[i].x;
        tile.y = coords[i].y;

        if (tile.x === 0 && tile.y === 0) {
            tile.resourceType = 0; // 砂漠
            tile.numberToken = 0;  // 数字なし
        } 
        else {
            // 中心以外ならリストから取り出す
            if (resIndex < resources.length) {
                tile.resourceType = resources[resIndex++];
            }
            if (numIndex < numbers.length) {
                tile.numberToken = numbers[numIndex++];
            }
        }

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
    this.players.push(client);
    console.log(client.sessionId, "joined as Player", this.players.length - 1);
  }

  onLeave(client: Client, consented: boolean) {
    const idx = this.players.indexOf(client);
    if (idx !== -1) this.players.splice(idx, 1);
    console.log(client.sessionId, "left!");
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

}
