import { Schema, type } from "@colyseus/schema";

export class MyRoomState extends Schema {

  @type("string") mySynchronizedProperty: string = "Hello world";

  @type("number") dice1: number = 1;
  @type("number") dice2: number = 1;

}
