import { createClient } from "@supabase/supabase-js";
import { TokenBalance } from "../models/types";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

// 타입 정의
export interface GameSessionRow {
  session_id: string;
  game_id: number | null;
  player_address: string;
  entry_token: string;
  entry_amount: string;
  entry_tx_hash: string | null;
  status: "PENDING" | "ACTIVE" | "EXITED" | "DEAD" | "CLAIMED";
  last_snapshot: {
    score: number;
    length: number;
    collectedTokens: TokenBalance[];
    position: { x: number; y: number };
    timestamp: number;
  } | null;
  reward_tokens: string[] | null;
  reward_amounts: string[] | null;
}

export interface BlockchainEventRow {
  id: string;
  event_type: "GameEntered" | "GameStateUpdated" | "RewardClaimed";
  tx_hash: string;
  block_number: number;
  player_address: string;
  game_id: number | null;
  event_data: any;
  processed: boolean;
}
