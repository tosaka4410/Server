import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

// import your "app.config.ts" file here.
import appConfig from "../src/app.config";
import { MyRoomState } from "../src/rooms/schema/MyRoomState";

describe("testing your Colyseus app", () => {
  let colyseus: ColyseusTestServer;

  before(async () => colyseus = await boot(appConfig));
  after(async () => colyseus.shutdown());

  beforeEach(async () => await colyseus.cleanup());

  it("connecting into a room", async () => {
    // `room` is the server-side Room instance reference.
    const room = await colyseus.createRoom<MyRoomState>("my_room", {});

    // `client1` is the client-side `Room` instance reference (same as JavaScript SDK)
    const client1 = await colyseus.connectTo(room);

    // make your assertions
    assert.strictEqual(client1.sessionId, room.clients[0].sessionId);

    // wait for state sync (wait until tiles are populated)
    const waitFor = async (pred: () => boolean, timeout = 2000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (pred()) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("timeout waiting for state");
    };

    await waitFor(() => (client1.state as any).tiles && (client1.state as any).tiles.length > 0);
    // Verify board was generated
    assert.strictEqual((client1.state as any).tiles.length, 19);
  });
});
