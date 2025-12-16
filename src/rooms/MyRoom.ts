import { Room, Client } from "@colyseus/core";
import { MyRoomState, Tile, Vertex, Edge, Structure, PlayerState } from "./schema/MyRoomState";


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

  private vertexIdToTileIds = new Map<number, number[]>();
  private tileIdToVertexIds = new Map<number, number[]>();


  private linkVertexTile(tileId: number, vId: number) {
    if (!this.vertexIdToTileIds.has(vId)) this.vertexIdToTileIds.set(vId, []);
    const arr = this.vertexIdToTileIds.get(vId)!;
    if (!arr.includes(tileId)) arr.push(tileId);
  }



  // Unityローカルに合わせる
  private hexSize = 1.0;
  private quantizeFactor = 100; // ローカルの Quantize と同じ

  private readonly ENABLE_CHEAT = true; // 本番では false


  onCreate(options: any) {

    // Initialize Colyseus state
    this.setState(new MyRoomState());

    // ゲーム開始時にボード生成
    this.generateBoardAndGraph();

    // rollDice / endTurn / build は後ろに（建設ルールで使う）
    this.registerHandlers();

  }

  // Lifecycle methods
  onJoin(client: Client) {
    this.players.push(client);
    const idx = this.players.length - 1;

    // PlayerState を追加
    const ps = new PlayerState();
    this.state.players.push(ps);

    this.state.playerCount = this.players.length;
    client.send("playerIndex", { index: idx });

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
      1, 1, 1, 1, // wood
      2, 2, 2,   // brick
      3, 3, 3, 3, // sheep
      4, 4, 4, 4, // wheat
      5, 5, 5    // ore
    ];
    const numbers = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
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

      this.tileIdToVertexIds.set(t.id, tileVertexIds);
      for (const vId of tileVertexIds) {
        this.linkVertexTile(t.id, vId);
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

  // ===== 資源分配ロジック =====
  // tile.resourceType: 0 desert, 1 wood, 2 brick, 3 sheep, 4 wheat, 5 ore
  private resourceIndexFromTileResourceType(rt: number): number | null {
    switch (rt) {
      case 1: return 0; // wood
      case 2: return 1; // brick
      case 3: return 2; // sheep
      case 4: return 3; // wheat
      case 5: return 4; // ore
      default: return null; // desert/unknown
    }
  }

  private addResourceToPlayer(playerIndex: number, resIdx: number, amount: number) {
    const p = this.state.players[playerIndex];
    if (!p) return;

    // ArraySchema の要素更新
    p.resources[resIdx] = (p.resources[resIdx] ?? 0) + amount;
  }

  private distributeResourcesByDice(sum: number) {
    if (sum === 7) return;

    for (let i = 0; i < this.state.tiles.length; i++) {
      const tile = this.state.tiles[i];
      if (tile.numberToken !== sum) continue;

      const resIdx = this.resourceIndexFromTileResourceType(tile.resourceType);
      if (resIdx == null) continue;

      const vIds = this.tileIdToVertexIds.get(tile.id) ?? [];
      for (const vId of vIds) {
        const s = this.state.settlements.get(String(vId));
        if (!s) continue;

        const owner = s.ownerIndex;
        const buildingType = s.type; // 2 settlement, 3 city
        const amount = (buildingType === 3) ? 2 : 1;

        this.addResourceToPlayer(owner, resIdx, amount);
      }
    }
  }

  private grantInitialResourcesForSecondSettlement(playerIndex: number, vertexId: number) {
    const tileIds = this.vertexIdToTileIds.get(vertexId) ?? [];
    for (const tileId of tileIds) {
      const tile = this.state.tiles[tileId];
      const resIdx = this.resourceIndexFromTileResourceType(tile.resourceType);
      if (resIdx == null) continue; // desert
      this.addResourceToPlayer(playerIndex, resIdx, 1);
      console.log(`Granted initial resource to P${playerIndex}: resourceType=${tile.resourceType} from Tile${tileId}`);
    }
  }

  // ===== 建設ロジック =====
  private canPay(playerIndex: number, cost: number[]): boolean {
    const p = this.state.players[playerIndex];
    for (let i = 0; i < 5; i++) {
      if ((p.resources[i] ?? 0) < cost[i]) return false;
    }
    return true;
  }

  private pay(playerIndex: number, cost: number[]) {
    const p = this.state.players[playerIndex];
    for (let i = 0; i < 5; i++) {
      p.resources[i] = (p.resources[i] ?? 0) - cost[i];
    }
  }

  private canUpgradeToCity(playerIndex: number, vId: number): { ok: boolean; reason?: string } {
    const key = String(vId);
    const s = this.state.settlements.get(key);
    if (!s) return { ok: false, reason: "そこに開拓地がありません" };
    if (s.ownerIndex !== playerIndex) return { ok: false, reason: "自分の開拓地ではありません" };
    if (s.type === 3) return { ok: false, reason: "既に都市です" };
    return { ok: true };
  }


  // [wood, brick, sheep, wheat, ore]
  private COST_ROAD = [1, 1, 0, 0, 0];
  private COST_SETTLEMENT = [1, 1, 1, 1, 0];
  private COST_CITY = [0, 0, 0, 2, 3];

  // ===== 盗賊ロジック =====
  private totalResources(pIndex: number): number {
    const p = this.state.players[pIndex];
    let sum = 0;
    for (let i = 0; i < 5; i++) sum += (p.resources[i] ?? 0);
    return sum;
  }

  private discardCountFor(pIndex: number): number {
    const t = this.totalResources(pIndex);
    return t >= 8 ? Math.floor(t / 2) : 0;
  }

  private startRobberFlow(moverIndex: number) {
    this.state.robberMoverIndex = moverIndex;

    // 誰か捨て札が必要か
    let anyDiscard = false;
    for (let i = 0; i < this.state.players.length; i++) {
      if (this.discardCountFor(i) > 0) { anyDiscard = true; break; }
    }

    this.state.robberStep = anyDiscard ? 1 : 2; // 1:捨て札 -> 2:移動待ち
    return anyDiscard;
  }

  private removeOneRandomResource(pIndex: number): boolean {
    const p = this.state.players[pIndex];

    // 手持ちがある資源indexを集める
    const available: number[] = [];
    for (let i = 0; i < 5; i++) {
      if ((p.resources[i] ?? 0) > 0) available.push(i);
    }
    if (available.length === 0) return false;

    const ri = available[Math.floor(Math.random() * available.length)];
    p.resources[ri] = (p.resources[ri] ?? 0) - 1;
    return true;
  }

  private autoDiscardAllRequired() {
    for (let i = 0; i < this.state.players.length; i++) {
      let need = this.discardCountFor(i);
      while (need > 0) {
        if (!this.removeOneRandomResource(i)) break;
        need--;
      }
    }
  }

  private getRobbableVictims(moverIndex: number, tileId: number): number[] {
    const vIds = this.tileIdToVertexIds.get(tileId) ?? [];
    const set = new Set<number>();

    for (const vId of vIds) {
      const s = this.state.settlements.get(String(vId));
      if (!s) continue;
      const owner = s.ownerIndex as any;
      if (owner === moverIndex) continue;

      // 資源が1枚以上ある相手だけ
      if (this.totalResources(owner) > 0) set.add(owner);
    }

    return [...set];
  }

  private stealOneRandomResource(victimIndex: number): number | null {
    const p = this.state.players[victimIndex];
    const bag: number[] = [];
    for (let i = 0; i < 5; i++) {
      const c = p.resources[i] ?? 0;
      for (let k = 0; k < c; k++) bag.push(i);
    }
    if (bag.length === 0) return null;

    const pick = bag[Math.floor(Math.random() * bag.length)];
    p.resources[pick] = (p.resources[pick] ?? 0) - 1;
    return pick;
  }

  private finishRobberFlow() {
    this.state.robberStep = 0;
    this.state.robberMoverIndex = -1;

    // ★重要：このターンはサイコロを振り終わった扱いにする
    this.state.turnStep = 1;
  }



  // ===== チートコマンド =====
  private forceEnterMainPhase(startPlayerIndex = 0) {
    // 初期配置中の一時情報をクリア
    this.pendingInitialSettlementByPlayer.clear();

    // フェーズを本番へ
    this.state.phase = 2;
    this.state.turnStep = 0; // サイコロ前
    this.state.currentPlayerIndex = Math.max(0, Math.min(startPlayerIndex, this.state.playerCount - 1));

    // 初期配置用の値も整えておく（デバッグ上の混乱を防ぐ）
    this.state.initialPlacementTurn = this.state.playerCount * 2;
    this.state.initialPlacementStep = 0;

    console.log(`[CHEAT] Force enter Main Phase. currentPlayerIndex=${this.state.currentPlayerIndex}`);
  }



  // ===== メッセージハンドラ登録 =====
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
        if (this.state.turnStep !== 1) { this.sendBuildError(client, "You must roll dice before building."); return; }
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

        // コストルールと支払い
        if (!isInitial) {
          if (!this.canPay(playerIndex, this.COST_SETTLEMENT)) {
            client.send("buildError", { reason: "資源が足りません（開拓地）" });
            return;
          }
          this.pay(playerIndex, this.COST_SETTLEMENT);
        }


        const s = new Structure();
        s.ownerIndex = playerIndex;
        s.type = 2;
        this.state.settlements.set(String(vId), s);

        if (isInitial) {
          this.pendingInitialSettlementByPlayer.set(playerIndex, vId);
          this.state.initialPlacementStep = 1;
        }
        if (isInitial && this.state.phase === 1) {
          console.log(`P${playerIndex} placed second initial settlement at V${vId}`);
          this.grantInitialResourcesForSecondSettlement(playerIndex, vId);
        }

        return;
      }
      if (data.structureType === "city") {
        const vId = Number(data.id);
        if (!Number.isInteger(vId) || vId < 0 || vId >= this.state.vertices.length) {
          client.send("buildError", { reason: "無効な頂点IDです" });
          return;
        }

        const isInitial = (this.state.phase === 0 || this.state.phase === 1);

        // 都市は本番のみ（初期配置では不可）
        if (isInitial) {
          client.send("buildError", { reason: "初期配置中は都市にできません" });
          return;
        }

        // 手番・サイコロ後チェック（あなたの運用に合わせて）
        if (playerIndex !== this.state.currentPlayerIndex) {
          client.send("buildError", { reason: "手番ではありません" });
          return;
        }
        if (this.state.turnStep !== 1) {
          client.send("buildError", { reason: "先にサイコロを振ってください" });
          return;
        }

        // ルールチェック
        const r = this.canUpgradeToCity(playerIndex, vId);
        if (!r.ok) {
          client.send("buildError", { reason: r.reason! });
          return;
        }

        // コストチェック＆支払い
        if (!this.canPay(playerIndex, this.COST_CITY)) {
          client.send("buildError", { reason: "資源が足りません（都市）" });
          return;
        }
        this.pay(playerIndex, this.COST_CITY);

        // 開拓地→都市（MapSchemaの同キーを更新）
        const key = String(vId);
        const old = this.state.settlements.get(key)!;
        const upgraded = new Structure();
        upgraded.ownerIndex = old.ownerIndex;
        upgraded.type = 3;
        this.state.settlements.set(key, upgraded);

        // MapSchemaは Value の中身を書き換えるだけでも同期されます（SDK差があるなら set し直す）
        // this.state.settlements.set(key, s);

        console.log(`P${playerIndex} upgraded settlement to city at V${vId}`);
        return;
      }


      if (data.structureType === "road") {
        const eId = Number(data.id);
        if (!Number.isInteger(eId) || eId < 0 || eId >= this.state.edges.length) { this.sendBuildError(client, "Invalid edge id."); return; }

        if (this.state.roads.has(String(eId))) { this.sendBuildError(client, "Edge already has a road."); return; }

        const endpoints = this.edgeIdToEndpoints.get(eId);
        if (!endpoints) { this.sendBuildError(client, "Edge endpoints not found."); return; }
        const { a, b } = endpoints;

        // 接続ルール
        if (isInitial) {
          // 初期配置：直前の開拓地に接続必須
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

        // コストルールと支払い
        if (!isInitial) {
          if (!this.canPay(playerIndex, this.COST_ROAD)) {
            client.send("buildError", { reason: "資源が足りません（道）" });
            return;
          }
          this.pay(playerIndex, this.COST_ROAD);
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
            // 1巡目(phase=0) / 2巡目(phase=1) の切り替え
            this.state.phase = (this.state.initialPlacementTurn >= this.state.playerCount) ? 1 : 0;

            // 次の人の「開拓地」から
            this.state.initialPlacementStep = 0;

            // 次の手番プレイヤーを更新（蛇行順）
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
      if (this.state.robberStep !== 0) return;

      // 1〜6の乱数を生成
      const d1 = Math.floor(Math.random() * 6) + 1;
      const d2 = Math.floor(Math.random() * 6) + 1;

      // Stateを更新 (自動的に全クライアントに同期されます)
      this.state.dice1 = d1;
      this.state.dice2 = d2;

      const sum = d1 + d2;

      if (sum === 7) {
        const anyDiscard = this.startRobberFlow(playerIndex);

        // ★まずは簡単に「捨て札は自動ランダム」でも動くようにする
        // （手動捨て札UIは後から）
        if (anyDiscard) {
          this.autoDiscardAllRequired();
          this.state.robberStep = 2; // 移動待ちへ
        }

        // mover に「盗賊を動かして」と通知（UI用）
        client.send("robberMoveRequired", true);
        console.log(`Player ${client.sessionId} rolled 7, starting robber flow.`);
        return;
      }

      this.distributeResourcesByDice(sum);

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

    this.onMessage("moveRobber", (client, data) => {
      const mover = this.players.indexOf(client);
      if (mover === -1) return;

      if (this.state.phase !== 2) return;
      if (this.state.robberStep !== 2) return; // 移動待ちのみ
      if (mover !== this.state.robberMoverIndex) return;

      const tileId = Number(data.tileId);
      if (!Number.isInteger(tileId) || tileId < 0 || tileId >= this.state.tiles.length) return;

      // 同じタイルには置けない（標準ルール）
      if (tileId === this.state.robberTileId) {
        client.send("buildError", { reason: "同じタイルには盗賊を移動できません" });
        return;
      }

      this.state.robberTileId = tileId;

      // 奪える相手がいるか
      const victims = this.getRobbableVictims(mover, tileId);
      if (victims.length === 0) {
        // 奪えないなら盗賊処理終了（建設など継続OK）
        this.finishRobberFlow();
        return;
      }

      // 次は奪う待ち
      this.state.robberStep = 3;

      // mover に候補を送る（UIで選べる）
      client.send("robberVictims", { victims });
    });

    this.onMessage("robPlayer", (client, data) => {
      const mover = this.players.indexOf(client);
      if (mover === -1) return;

      if (this.state.phase !== 2) return;
      if (this.state.robberStep !== 3) return; // 奪う待ち
      if (mover !== this.state.robberMoverIndex) return;

      const victim = Number(data.victimIndex);
      if (!Number.isInteger(victim) || victim < 0 || victim >= this.state.players.length) return;

      // いまの robberTile に隣接していて奪える相手かチェック
      const candidates = this.getRobbableVictims(mover, this.state.robberTileId);
      if (!candidates.includes(victim)) return;

      // victim からランダムで1枚奪う
      const stolenRes = this.stealOneRandomResource(victim);
      if (stolenRes != null) {
        this.addResourceToPlayer(mover, stolenRes, 1);
      }

      // 盗賊処理終了
      this.finishRobberFlow();
    });



    this.onMessage("cheatAddResource", (client, data) => {
      if (!this.ENABLE_CHEAT) return;

      const senderIndex = this.players.indexOf(client);
      if (senderIndex === -1) return;

      // 🔒 セーフティ：ホスト(P0)のみ許可（外したければ消してOK）
      if (senderIndex !== 0) {
        client.send("buildError", { reason: "チートはホストのみ使用できます" });
        return;
      }

      const targetPlayer = Number(data.playerIndex);
      const resourceIndex = Number(data.resourceIndex);
      const amount = Number(data.amount);

      if (
        !Number.isInteger(targetPlayer) ||
        !Number.isInteger(resourceIndex) ||
        !Number.isInteger(amount)
      ) return;

      if (targetPlayer < 0 || targetPlayer >= this.state.players.length) return;
      if (resourceIndex < 0 || resourceIndex > 4) return;

      const p = this.state.players[targetPlayer];
      p.resources[resourceIndex] = (p.resources[resourceIndex] ?? 0) + amount;

      console.log(
        `[CHEAT] Give P${targetPlayer} +${amount} resource(${resourceIndex})`
      );
    });

    this.onMessage("cheatForceMainPhase", (client, data) => {
      if (!this.ENABLE_CHEAT) return;

      const senderIndex = this.players.indexOf(client);
      if (senderIndex === -1) return;

      // 🔒 ホスト(P0)だけ許可（外したければ消してOK）
      if (senderIndex !== 0) {
        client.send("buildError", { reason: "チートはホストのみ使用できます" });
        return;
      }

      const startPlayerIndex =
        data && Number.isInteger(Number(data.startPlayerIndex))
          ? Number(data.startPlayerIndex)
          : 0;

      this.forceEnterMainPhase(startPlayerIndex);
    });
  }

}
