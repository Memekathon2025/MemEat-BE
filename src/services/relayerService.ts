import { ethers } from "ethers";
import { contractService } from "./contractService";
import { supabase } from "./supabaseService";
import { Player } from "../models/types";
import { priceService } from "./priceService";

export class RelayerService {
  private readonly BASE_ENTRY_FEE_M = 1; // 기본 입장료 (1 M 고정)

  async handlePlayerDeath(player: Player): Promise<{
    success: boolean;
    status: "DEAD" | "EXITED";
  }> {
    console.log(`🚀 Checking escape condition for ${player.name}...`);

    // 수집한 토큰의 총 M 가치 계산
    const totalValue = await priceService.calculateTotalValue(
      player.collectedTokens.map(({ address, amount }) => ({ address, amount }))
    );

    let newStatus;
    let dbStatus: "DEAD" | "EXITED";
    if (totalValue < this.BASE_ENTRY_FEE_M) {
      newStatus = 3; // Dead
      dbStatus = "DEAD";
    } else {
      newStatus = 2; // Exited
      dbStatus = "EXITED";
    }

    try {
      const rewardTokens = player.collectedTokens.map(
        (t) => t.address || ethers.ZeroAddress
      );
      const rewardAmounts = player.collectedTokens.map((t) =>
        ethers.parseEther(t.amount.toString())
      );

      const txHash = await contractService.updateGameState(
        player.walletAddress,
        newStatus,
        rewardTokens,
        rewardAmounts
      );

      // DB 업데이트
      const { data: updatedSession, error: updateError } = await supabase
        .from("game_sessions")
        .update({
          status: dbStatus,
          reward_tokens: dbStatus === "EXITED" ? rewardTokens : [],
          reward_amounts:
            dbStatus === "EXITED" ? rewardAmounts.map((a) => a.toString()) : [],
          update_tx_hash: txHash,
          final_score: player.score,
          final_length: player.length,
          survival_time: Math.floor((Date.now() - player.joinTime) / 1000),
          updated_at: new Date(),
        })
        .eq("player_address", player.walletAddress.toLowerCase())
        .eq("status", "ACTIVE")
        .select();

      if (updateError) {
        console.error("❌ Failed to update session:", updateError);
      }

      const statusText = newStatus === 2 ? "Exited" : "Dead";
      console.log(`✅ Game ended (${statusText})! TX: ${txHash}`);
      return { success: true, status: dbStatus };
    } catch (error) {
      console.error("Error handling player escape:", error);
      return { success: false, status: "DEAD" };
    }
  }
}

export const relayerService = new RelayerService();
