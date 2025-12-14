import { Room, Client } from "@colyseus/core";
import { MyRoomState, Tile, Vertex, Edge, Structure } from "./schema/MyRoomState";


type VKey = string;           // "x_y" (quantized int)
type EKey = string;           // "x1_y1|x2_y2" (sorted)

export class MyRoom extends Room<MyRoomState> {
  maxClients = 4;

  // 接続中のクライアントを配列で管理 (順序をプレイヤー番号とする)
  players: Client[] = [];

  // ===== サーバ内部のグラフ（判定用）=====
  private vertexKeyToId = new Map<VKey, number>();
  private edgeKeyToId = new Map<EKey, number>();

  private vertexIdToNeighbors = new Map<number, Set<number>>();
  private vertexIdToEdges = new Map<number, Set<number>>();
  private edgeIdToEndpoints = new Map<number, { a: number; b: number }>();

  private pendingInitialSettlementByPlayer = new Map<number, number>(); // player -> vertexId

  // Unityローカルに合わせる
  private hexSize = 1.0;
  private quantizeFactor = 100; // ローカルの Quantize と同じ


  onCreate(options: any) {

    // Initialize Colyseus state
    this.setState(new MyRoomState());

    // ゲーム開始時にボード生成
    this.generateBoardAndGraph();

    // rollDice / endTurn / build は後ろに（建設ルールで使う）
    this.registerHandlers();

  }

    // Lifecycle methods
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

  // ====== ローカルの AxialToWorld を再現（超重要）======
  private axialToWorld(q: number, r: number) {
    let x = this.hexSize * (Math.sqrt(3) * q);
    if (r % 2 !== 0) x += (Math.sqrt(3) / 2) * this.hexSize; // ★ローカルと一致
    const y = this.hexSize * (1.5 * r);
    return { x, y };
  }

  private quantize(x: number, y: number): VKey {
    const ix = Math.round(x * this.quantizeFactor);
    const iy = Math.round(y * this.quantizeFactor);
    return `${ix}_${iy}`;
  }

  // pointy-top corner offsets（ローカルと同じ）
  private cornerOffsets = [
    { x: 0, y: 1 },
    { x: Math.sqrt(3) / 2, y: 0.5 },
    { x: Math.sqrt(3) / 2, y: -0.5 },
    { x: 0, y: -1 },
    { x: -Math.sqrt(3) / 2, y: -0.5 },
    { x: -Math.sqrt(3) / 2, y: 0.5 },
  ];

  private makeEdgeKey(aKey: VKey, bKey: VKey): EKey {
    // ローカルの (keyA,keyB) をソートするのと同じ
    return aKey <= bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
  }

  private generateBoardAndGraph() {
    // 1) 座標（3-4-5-4-3）
    const coords: Array<{ q: number; r: number }> = [];
    for (let r = -2; r <= 2; r++) {
      const rowLength = 5 - Math.abs(r);
      const qStart = -Math.floor(rowLength / 2);
      for (let i = 0; i < rowLength; i++) coords.push({ q: qStart + i, r });
    }

    // 2) 資源・数字（あなたの既存と同じでOK）
    const resources = [
      1,1,1,1, // wood
      2,2,2,   // brick
      3,3,3,3, // sheep
      4,4,4,4, // wheat
      5,5,5    // ore
    ];
    const numbers = [2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12];
    this.shuffle(resources);
    this.shuffle(numbers);

    // 3) tiles 生成（desertIndex=9 を踏襲）
    const desertIndex = 9;
    let resIdx = 0;
    let numIdx = 0;

    this.state.tiles.clear();
    this.state.vertices.clear();
    this.state.edges.clear();

    this.vertexKeyToId.clear();
    this.edgeKeyToId.clear();
    this.vertexIdToNeighbors.clear();
    this.vertexIdToEdges.clear();
    this.edgeIdToEndpoints.clear();

    // Tileオブジェクトを先に作る（tile->vertices/edgesはstateには持たせない最小構成）
    for (let i = 0; i < coords.length; i++) {
      const { q, r } = coords[i];
      const p = this.axialToWorld(q, r);

      const t = new Tile();
      t.id = i;
      t.q = q; t.r = r;
      t.x = p.x; t.y = p.y;

      if (i === desertIndex) {
        t.resourceType = 0;
        t.numberToken = 0;
      } else {
        t.resourceType = resources[resIdx++];
        t.numberToken = numbers[numIdx++];
      }
      this.state.tiles.push(t);

      // 4) このタイル周りの6頂点を作る（重複排除）
      const tileVertexIds: number[] = [];
      for (let k = 0; k < 6; k++) {
        const cx = p.x + this.cornerOffsets[k].x * this.hexSize;
        const cy = p.y + this.cornerOffsets[k].y * this.hexSize;

        const vKey = this.quantize(cx, cy);
        let vId = this.vertexKeyToId.get(vKey);
        if (vId == null) {
          vId = this.state.vertices.length;
          this.vertexKeyToId.set(vKey, vId);

          const v = new Vertex();
          v.id = vId;
          v.x = cx; v.y = cy;
          this.state.vertices.push(v);

          this.vertexIdToNeighbors.set(vId, new Set());
          this.vertexIdToEdges.set(vId, new Set());
        }
        tileVertexIds.push(vId);
      }

      // 5) 6辺（0-1,1-2,...,5-0）を生成（重複排除）
      for (let k = 0; k < 6; k++) {
        const a = tileVertexIds[k];
        const b = tileVertexIds[(k + 1) % 6];

        // edgeKeyは「頂点の量子化キー」で作る（ローカルのedgeMapキーと同型）
        const aKey = [...this.vertexKeyToId.entries()].find(([_, id]) => id === a)![0];
        const bKey = [...this.vertexKeyToId.entries()].find(([_, id]) => id === b)![0];
        const eKey = this.makeEdgeKey(aKey, bKey);

        let eId = this.edgeKeyToId.get(eKey);
        if (eId == null) {
          eId = this.state.edges.length;
          this.edgeKeyToId.set(eKey, eId);

          const va = this.state.vertices[a];
          const vb = this.state.vertices[b];

          const e = new Edge();
          e.id = eId;
          e.a = a;
          e.b = b;
          e.x = (va.x + vb.x) / 2;
          e.y = (va.y + vb.y) / 2;
          this.state.edges.push(e);

          this.edgeIdToEndpoints.set(eId, { a, b });
          this.vertexIdToEdges.get(a)!.add(eId);
          this.vertexIdToEdges.get(b)!.add(eId);
          this.vertexIdToNeighbors.get(a)!.add(b);
          this.vertexIdToNeighbors.get(b)!.add(a);
        }
      }
    }

    // ※上で vertexKeyToId の逆引きを毎回 find してるのは重いので、
    // 本番では vId->vKey Mapも持たせてください（ここでは分かりやすさ優先）

    console.log(`Graph built: tiles=${this.state.tiles.length}, vertices=${this.state.vertices.length}, edges=${this.state.edges.length}`);
  }

  private shuffle(array: number[]) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

    // ===== 初期配置開始 =====
  private startInitialPlacement() {
    this.state.phase = 0;
    this.state.initialPlacementTurn = 0;
    this.state.initialPlacementStep = 0;
    this.state.currentPlayerIndex = 0;
    this.pendingInitialSettlementByPlayer.clear();
  }

  private getCurrentInitialPlacementPlayer(): number {
    const turn = this.state.initialPlacementTurn;
    const n = this.state.playerCount;
    if (turn < n) return turn;
    return (n * 2 - 1) - turn;
  }


  private sendBuildError(client: Client, reason: string) {
    client.send("buildError", { reason });
  }




  private registerHandlers() {
    this.onMessage("build", (client, data) => {
      const playerIndex = this.players.indexOf(client);
      if (playerIndex === -1) { this.sendBuildError(client, "Player not in game."); return; }

      const isInitial = (this.state.phase === 0 || this.state.phase === 1);

      // 手番チェック
      if (isInitial) {
        const expected = this.getCurrentInitialPlacementPlayer();
        if (playerIndex !== expected) { this.sendBuildError(client, "Not your initial placement turn."); return; }
        if (this.state.initialPlacementStep === 0 && data.structureType !== "settlement") { this.sendBuildError(client, "Invalid structure for initial placement."); return; }
        if (this.state.initialPlacementStep === 1 && data.structureType !== "road") { this.sendBuildError(client, "Invalid structure for initial placement."); return; }
      } else {
        if (playerIndex !== this.state.currentPlayerIndex) { this.sendBuildError(client, "Not your turn."); return; }
      }

      if (data.structureType === "settlement") {
        const vId = Number(data.id);
        if (!Number.isInteger(vId) || vId < 0 || vId >= this.state.vertices.length) { this.sendBuildError(client, "Invalid vertex id."); return; }

        // 既に占有
        if (this.state.settlements.has(String(vId))) {
          this.sendBuildError(client, "Vertex already has a settlement.");
          return;
        }

        // 距離ルール（隣接頂点に建物があればNG）
        const neigh = this.vertexIdToNeighbors.get(vId);
        if (neigh) {
          for (const n of neigh) {
            if (this.state.settlements.has(String(n))) { this.sendBuildError(client, "Adjacent settlement prevents building here."); return; }
          }
        }

        // 本番なら「自分の道に接続」必須
        if (!isInitial) {
          const edges = this.vertexIdToEdges.get(vId);
          let ok = false;
          if (edges) {
            for (const eId of edges) {
              const r = this.state.roads.get(String(eId));
              if (r && r.ownerIndex === playerIndex) { ok = true; break; }
            }
          }
          if (!ok) { this.sendBuildError(client, "Must connect to one of your roads."); return; }
        }

        const s = new Structure();
        s.ownerIndex = playerIndex;
        s.type = 2;
        this.state.settlements.set(String(vId), s);

        if (isInitial) {
          this.pendingInitialSettlementByPlayer.set(playerIndex, vId);
          this.state.initialPlacementStep = 1;
        }
        return;
      }

      if (data.structureType === "road") {
        const eId = Number(data.id);
        if (!Number.isInteger(eId) || eId < 0 || eId >= this.state.edges.length) { this.sendBuildError(client, "Invalid edge id."); return; }

        if (this.state.roads.has(String(eId))) { this.sendBuildError(client, "Edge already has a road."); return; }

        const endpoints = this.edgeIdToEndpoints.get(eId);
        if (!endpoints) { this.sendBuildError(client, "Edge endpoints not found."); return; }
        const { a, b } = endpoints;

        if (isInitial) {
          const pending = this.pendingInitialSettlementByPlayer.get(playerIndex);
          if (pending == null) { this.sendBuildError(client, "No pending initial settlement found."); return; }
          if (pending !== a && pending !== b) { this.sendBuildError(client, "Road must connect to your last initial settlement."); return; } // 直前の開拓地に接続必須
        } else {
          // 本番：自分の建物 or 自分の道に接続
          const aMineBuilding = this.state.settlements.get(String(a))?.ownerIndex === playerIndex;
          const bMineBuilding = this.state.settlements.get(String(b))?.ownerIndex === playerIndex;

          const hasMyRoadAt = (v: number) => {
            const edges = this.vertexIdToEdges.get(v);
            if (!edges) return false;
            for (const eid of edges) {
              const rr = this.state.roads.get(String(eid));
              if (rr && rr.ownerIndex === playerIndex) return true;
            }
            return false;
          };

          if (!(aMineBuilding || bMineBuilding || hasMyRoadAt(a) || hasMyRoadAt(b))) { this.sendBuildError(client, "Road must connect to your road or building."); return; }
        }

        const r = new Structure();
        r.ownerIndex = playerIndex;
        r.type = 1;
        this.state.roads.set(String(eId), r);

        if (isInitial) {
          this.pendingInitialSettlementByPlayer.delete(playerIndex);

          // 初期配置ターン進行（家→道完了）
          this.state.initialPlacementTurn++;
          const totalTurns = this.state.playerCount * 2;
          if (this.state.initialPlacementTurn >= totalTurns) {
            this.state.phase = 2;
            this.state.currentPlayerIndex = 0;
            this.state.turnStep = 0;
          } else {
            this.state.initialPlacementStep = 0;
            this.state.currentPlayerIndex = this.getCurrentInitialPlacementPlayer();
          }
        }
      }
    });

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
  }

}
