export interface Player {
  id: string;
  socketId: string;
  name: string;
  walletAddress: string;
  position: { x: number; y: number };
  angle: number;
  score: number;
  length: number;
  alive: boolean;
  collectedTokens: TokenBalance[];
  stakedTokens: TokenBalance[];
  joinTime: number;
}

export interface TokenBalance {
  address: string;
  symbol: string;
  amount: number;
  color: string;
}

export interface Food {
  id: string;
  position: { x: number; y: number };
  token: TokenBalance;
}

export interface GameRoom {
  id: string;
  players: Map<string, Player>;
  foods: Food[];
  worldSize: { width: number; height: number };
}

export interface LeaderboardEntry {
  name: string;
  score: number;
  survivalTime: number;
}
