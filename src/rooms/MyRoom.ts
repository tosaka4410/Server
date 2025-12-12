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
      const playerIndex = this.players.indexOf(client);
      if (playerIndex === -1) return;

      if (this.state.phase !== 2) {
        console.log("rollDice ignored: not in main phase.");
        return;
      }
      if (playerIndex !== this.state.currentPlayerIndex) {
        console.log("rollDice ignored: not your turn.");
        return;
      }
      if (this.state.turnStep !== 0) {
        console.log("rollDice ignored: already rolled.");
        return;
      }

      // 1〜6の乱数を生成
      const d1 = Math.floor(Math.random() * 6) + 1;
      const d2 = Math.floor(Math.random() * 6) + 1;

      // Stateを更新 (自動的に全クライアントに同期されます)
      this.state.dice1 = d1;
      this.state.dice2 = d2;

      this.state.turnStep = 1;

      console.log(`Player ${client.sessionId} rolled ${d1} + ${d2}`);
    });

    this.onMessage("endTurn", (client, message) => {
      const playerIndex = this.players.indexOf(client);
      if (playerIndex === -1) return;

      // 本番フェーズのみ
      if (this.state.phase !== 2) {
        console.log("endTurn ignored: not in main phase.");
        return;
      }
      // 自分の番のみ
      if (playerIndex !== this.state.currentPlayerIndex) {
        console.log("endTurn ignored: not your turn.");
        return;
      }
      // サイコロを振っていないなら終了させない（任意）
      if (this.state.turnStep === 0) {
        console.log("endTurn ignored: dice not rolled yet.");
        return;
      }

      // 次のプレイヤーへ
      const n = this.state.playerCount;
      this.state.currentPlayerIndex = (this.state.currentPlayerIndex + 1) % n;
      this.state.turnStep = 0; // 次のプレイヤーはサイコロ前

      console.log(`Turn ended. Next player: ${this.state.currentPlayerIndex}`);
    });

    // 建物や道の建設リクエストを処理
    // data = { id: "123_456", structureType: "road" or "settlement" }
    this.onMessage("build", (client, data) => {
      const playerIndex = this.players.indexOf(client);
      if (playerIndex === -1) return;

      console.log(`build request from P${playerIndex}`, data);

      // ★ 初期配置中の処理
      if (this.state.phase === 0 || this.state.phase === 1) {
        this.handleInitialPlacementBuild(playerIndex, data);
        return;
      }

      // ★ ここからは本番フェーズのみ通る
      if (this.state.phase === 2 && playerIndex !== this.state.currentPlayerIndex) {
        console.log(`build ignored: not player ${playerIndex}'s turn`);
        return;
      }

      const structure = new Structure();
      structure.ownerIndex = playerIndex;

      if (data.structureType === "settlement") {
        structure.type = 2;
        this.state.settlements.set(data.id, structure);
      }
      else if (data.structureType === "road") {
        structure.type = 1;
        this.state.roads.set(data.id, structure);
      }

      console.log(`(Main) P${playerIndex} built ${data.structureType} at ${data.id}`);
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
      { x: 0, y: -2 }, { x: 1, y: -2 }, { x: 2, y: -2 },
      { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 2, y: -1 },
      { x: -2, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: -2, y: 1 }, { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
      { x: -2, y: 2 }, { x: -1, y: 2 }, { x: 0, y: 2 }
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

  startInitialPlacement() {
    this.state.phase = 0;               // 初期配置1巡目
    this.state.initialPlacementTurn = 0;
    this.state.initialPlacementStep = 0; // 0: 開拓地
    this.state.currentPlayerIndex = 0;   // プレイヤー0からスタート
    console.log("Initial placement started");
  }

  // 今の initialPlacementTurn から、何番プレイヤーの手番かを計算
  getCurrentInitialPlacementPlayer(): number {
    const turn = this.state.initialPlacementTurn;
    const n = this.state.playerCount;

    if (turn < n) {
      // 1巡目: 0 → 1 → 2 → 3
      return turn;
    } else {
      // 2巡目: 3 → 2 → 1 → 0
      return (n * 2 - 1) - turn;
    }
  }

  handleInitialPlacementBuild(playerIndex: number, data: any) {
    const expectedPlayer = this.getCurrentInitialPlacementPlayer();

    if (playerIndex !== expectedPlayer) {
      console.log(`It's not player ${playerIndex}'s turn (expected ${expectedPlayer})`);
      return; // 手番じゃないので無視
    }

    // 0: 開拓地, 1: 道
    if (this.state.initialPlacementStep === 0) {
      // 開拓地フェーズ以外のものは弾く
      if (data.structureType !== "settlement") {
        console.log("You must place a settlement first in initial placement.");
        return;
      }

      const structure = new Structure();
      structure.ownerIndex = playerIndex;
      structure.type = 2;
      this.state.settlements.set(data.id, structure);

      console.log(`Initial placement: P${playerIndex} placed settlement at ${data.id}`);

      // 次は道
      this.state.initialPlacementStep = 1;
    }
    else {
      // 道フェーズ
      if (data.structureType !== "road") {
        console.log("You must place a road after the settlement in initial placement.");
        return;
      }

      const structure = new Structure();
      structure.ownerIndex = playerIndex;
      structure.type = 1;
      this.state.roads.set(data.id, structure);

      console.log(`Initial placement: P${playerIndex} placed road at ${data.id}`);

      // このプレイヤーの「開拓地＋道」セット完了 → 次の turn へ
      this.state.initialPlacementTurn++;

      const totalTurns = this.state.playerCount * 2;
      if (this.state.initialPlacementTurn >= totalTurns) {
        // 初期配置終了 → 本番フェーズへ
        this.state.phase = 2; // MainGame
        this.state.currentPlayerIndex = 0; // 本番の先攻プレイヤー（とりあえず0番に）
        this.state.turnStep = 0;           // サイコロ前
        console.log("Initial placement finished. Entering main game.");
      } else {
        // まだ初期配置中 → 次のプレイヤーへ
        const nextPlayer = this.getCurrentInitialPlacementPlayer();
        this.state.currentPlayerIndex = nextPlayer;
        this.state.initialPlacementStep = 0; // 再び「開拓地」から
      }
    }
  }

  onJoin(client: Client, options: any) {
    this.players.push(client);
    const index = this.players.length - 1;
    console.log(client.sessionId, "joined as Player", this.players.length - 1);
    this.state.playerCount = this.players.length;
    client.send("playerIndex", { index });

    // 全員揃ったら初期配置開始（前回のロジック）
    if (this.players.length === this.maxClients) {
      this.startInitialPlacement();
    }
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
