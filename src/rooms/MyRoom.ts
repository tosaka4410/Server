// src/rooms/MyRoom.ts
import { Room, Client } from "@colyseus/core";
import { MyRoomState, PlayerState } from "./schema/MyRoomState";
import { Phase } from "./schema/constants";

import { BoardGraph } from "./world/graph";
import { buildBoardAndGraph } from "./world/board";
import { buildPorts } from "./world/ports";

import { registerBuildHandlers } from "./handlers/build";
import { registerTurnHandlers } from "./handlers/turn";
import { registerRobberHandlers } from "./handlers/robber";
import { registerDevCardHandlers } from "./handlers/devcards";
import { registerTradeHandlers } from "./handlers/trade";

export class MyRoom extends Room<MyRoomState> {
  maxClients = 4;

  // プレイヤーの接続順=playerIndex
  players: Client[] = [];

  // Board & Graph
  graph = new BoardGraph();
  hexSize = 1.0;
  quantizeFactor = 100;
  desertIndex = 9;

  // 初期配置の一時情報
  pendingInitialSettlementByPlayer = new Map<number, number>();

  readonly ENABLE_CHEAT = true;

  onCreate(options: any) {
    this.setState(new MyRoomState());

    // 盤面生成
    buildBoardAndGraph(this.state, this.graph, {
      hexSize: this.hexSize,
      quantizeFactor: this.quantizeFactor,
      desertIndex: this.desertIndex,
    });

    buildPorts(this.state, this.graph);

    // ハンドラ登録（機能ごと）
    registerBuildHandlers(this);
    registerTurnHandlers(this);
    registerRobberHandlers(this);
    registerDevCardHandlers(this);
    registerTradeHandlers(this);

    // 開始時の盗賊初期位置（必要なら）
    // this.state.robberTileId = this.desertIndex;
  }

  onJoin(client: Client) {
    this.players.push(client);
    const idx = this.players.length - 1;

    const ps = new PlayerState();
    this.state.players.push(ps);

    this.state.playerCount = this.players.length;
    client.send("playerIndex", { index: idx });

    if (this.players.length === this.maxClients) {
      this.startInitialPlacement();
    }
  }

  onLeave(client: Client) {
    const idx = this.players.indexOf(client);
    if (idx !== -1) this.players.splice(idx, 1);
  }

  // ===== 初期配置 =====
  startInitialPlacement() {
    this.state.phase = Phase.InitialPlacement1;
    this.state.initialPlacementTurn = 0;
    this.state.initialPlacementStep = 0;
    this.state.currentPlayerIndex = 0;
    this.pendingInitialSettlementByPlayer.clear();
  }

  getCurrentInitialPlacementPlayer(): number {
    const turn = this.state.initialPlacementTurn;
    const n = this.state.playerCount;
    if (turn < n) return turn;
    return (n * 2 - 1) - turn;
  }
}
