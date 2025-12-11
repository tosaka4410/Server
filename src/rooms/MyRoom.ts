import { Room, Client } from "@colyseus/core";
import { MyRoomState } from "./schema/MyRoomState";

export class MyRoom extends Room<MyRoomState> {
  maxClients = 4;
  state = new MyRoomState();

  onCreate (options: any) {
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

  onJoin (client: Client, options: any) {
    console.log(client.sessionId, "joined!");
  }

  onLeave (client: Client, consented: boolean) {
    console.log(client.sessionId, "left!");
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

}
