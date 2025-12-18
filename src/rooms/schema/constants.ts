// src/schema/constants.ts
export const ResourceType = {
  Desert: 0,
  Wood: 1,
  Brick: 2,
  Sheep: 3,
  Wheat: 4,
  Ore: 5,
} as const;
export type ResourceType = (typeof ResourceType)[keyof typeof ResourceType];

export const StructureType = {
  Road: 1,
  Settlement: 2,
  City: 3,
} as const;
export type StructureType = (typeof StructureType)[keyof typeof StructureType];

export const Phase = {
  InitialPlacement1: 0,
  InitialPlacement2: 1,
  Main: 2,
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

export const TurnStep = {
  BeforeRoll: 0,
  AfterRoll: 1,
} as const;
export type TurnStep = (typeof TurnStep)[keyof typeof TurnStep];

export const RobberStep = {
  None: 0,
  Discarding: 1,
  MoveWaiting: 2,
  RobWaiting: 3,
} as const;
export type RobberStep = (typeof RobberStep)[keyof typeof RobberStep];

export const DevCard = {
  Knight: 0,
  RoadBuilding: 1,
  YearOfPlenty: 2,
  Monopoly: 3,
  VictoryPoint: 4,
} as const;
export type DevCardType = (typeof DevCard)[keyof typeof DevCard];
