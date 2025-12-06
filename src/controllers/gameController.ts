import { Request, Response } from "express";
import { ethers } from "ethers";
import { contractService } from "../services/contractService";
import { gameService } from "../services/gameService";
import { supabase } from "../services/supabaseService";
import type { TokenBalance } from "../models/types";

export async function enterGame(req: Request, res: Response) {
  try {
    const { name, walletAddress, txHash } = req.body;

    // 입력 검증
    if (!name || !walletAddress || !txHash) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: name, walletAddress, txHash",
      });
    }

    console.log(`🎫 Processing entry for ${name} (${walletAddress})...`);

    // 1. 트랜잭션 영수증 대기 (이미 전송됨)
    const provider = contractService.getProvider();
    const txResponse = await provider.getTransaction(txHash);

    if (!txResponse) {
      throw new Error("Transaction not found");
    }

    console.log(`⏳ Waiting for confirmation...`);
    const receipt = await txResponse.wait();

    if (!receipt) {
      throw new Error("Transaction receipt is null");
    }
    console.log(`✅ Transaction confirmed at block ${receipt.blockNumber}`);

    if (receipt.status !== 1) {
      throw new Error("Transaction failed");
    }

    // 3. GameEntered 이벤트 파싱
    const gameEnteredEvent = contractService.parseGameEnteredEvent(receipt);

    if (!gameEnteredEvent) {
      throw new Error("GameEntered event not found in transaction");
    }

    // 검증: 플레이어 주소 일치
    if (gameEnteredEvent.player.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new Error("Player address mismatch");
    }

    // 4. 수수료 제외한 금액 계산
    const netAmount = await contractService.calculateNetAmount(
      gameEnteredEvent.amount
    );

    console.log(
      `💰 Entry: ${ethers.formatEther(
        gameEnteredEvent.amount
      )} → Net: ${ethers.formatEther(netAmount)}`
    );

    // 5. 토큰 정보 조회
    const tokenSymbol = await getTokenSymbol(gameEnteredEvent.token);
    const tokenColor = getTokenColor(gameEnteredEvent.token);

    const tokenBalance: TokenBalance = {
      address: gameEnteredEvent.token,
      symbol: tokenSymbol,
      amount: Number(ethers.formatEther(netAmount)),
      color: tokenColor,
    };

    // 6. Food 생성 및 맵에 배치
    const newFoods = gameService.distributeTokensToMap([tokenBalance]);
    console.log(
      `🍕 Created ${newFoods.length} foods (${tokenBalance.amount} ${tokenBalance.symbol})`
    );

    // 7. DB 저장
    await supabase.from("game_sessions").insert({
      player_address: walletAddress.toLowerCase(),
      player_name: name,
      status: "PENDING", // socket join하면 ACTIVE로
      entry_token: gameEnteredEvent.token,
      entry_amount: gameEnteredEvent.amount.toString(),
      entry_tx_hash: txResponse.hash,
      game_id: Number(gameEnteredEvent.gameId),
      created_at: new Date(),
    });

    // 8. 성공 응답
    res.json({
      success: true,
      txHash: txResponse.hash,
      gameId: Number(gameEnteredEvent.gameId),
      foodsCreated: newFoods.length,
      netAmount: ethers.formatEther(netAmount),
    });
  } catch (error: any) {
    console.error("❌ Error entering game:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to enter game",
    });
  }
}

async function getTokenSymbol(tokenAddress: string): Promise<string> {
  if (tokenAddress === ethers.ZeroAddress) {
    return "M";
  }

  try {
    const ERC20_ABI = ["function symbol() view returns (string)"];
    const provider = contractService.getProvider();
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ERC20_ABI,
      provider
    );
    return await tokenContract.symbol();
  } catch (error) {
    console.warn(`Failed to get symbol for ${tokenAddress}, using address`);
    return tokenAddress.slice(0, 8);
  }
}

function getTokenColor(tokenAddress: string): string {
  const colorMap: { [key: string]: string } = {
    [ethers.ZeroAddress.toLowerCase()]: "#FFD700", // Gold for M
  };

  const normalized = tokenAddress.toLowerCase();
  if (colorMap[normalized]) {
    return colorMap[normalized];
  }

  // 주소 기반 색상 생성 (일관성 있게)
  const hash = tokenAddress.slice(2, 8);
  return `#${hash}`;
}

export async function checkActiveSession(req: Request, res: Response) {
  try {
    const { walletAddress } = req.query;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: "Wallet address required",
      });
    }

    // DB에서 Active 세션 조회
    const { data: activeSessions, error } = await supabase
      .from("game_sessions")
      .select("*")
      .eq("player_address", (walletAddress as string).toLowerCase())
      .eq("status", "ACTIVE")
      .order("created_at", { ascending: false })
      .limit(1);

    console.log(activeSessions);

    if (error) throw error;

    if (activeSessions && activeSessions.length > 0) {
      const session = activeSessions[0];

      // 컨트랙트에서도 확인 (이중 체크)
      const playerStatus = await contractService.getPlayerStatus(
        walletAddress as string
      );
      console.log(playerStatus);

      // 컨트랙트에서도 Active면 재입장 가능
      if (Number(playerStatus) === 1) {
        // 1 = Active
        return res.json({
          success: true,
          hasActiveSession: true,
          session: {
            gameId: session.game_id,
            entryToken: session.entry_token,
            entryAmount: session.entry_amount,
            lastSnapshot: session.last_snapshot,
          },
        });
      } else if (Number(playerStatus) === 2) {
        await supabase
          .from("game_sessions")
          .update({ status: "EXITED" })
          .eq("session_id", session.session_id);
      } else if (Number(playerStatus) === 3) {
        await supabase
          .from("game_sessions")
          .update({ status: "DEAD" })
          .eq("session_id", session.session_id);
      } else if (Number(playerStatus) === 4) {
        await supabase
          .from("game_sessions")
          .update({ status: "CLAIMED" })
          .eq("session_id", session.session_id);
      }
    }

    return res.json({
      success: true,
      hasActiveSession: false,
    });
  } catch (error: any) {
    console.error("❌ Error checking active session:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to check session",
    });
  }
}

export async function rejoinGame(req: Request, res: Response) {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
      });
    }

    // DB에서 Active 세션 조회
    const { data: activeSessions } = await supabase
      .from("game_sessions")
      .select("*")
      .eq("player_address", walletAddress.toLowerCase())
      .eq("status", "ACTIVE")
      .limit(1);

    if (!activeSessions || activeSessions.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No active session found",
      });
    }

    const session = activeSessions[0];

    const playerName = session.player_name;

    // 컨트랙트 상태 확인
    const playerStatus = await contractService.getPlayerStatus(walletAddress);
    console.log(
      "🔍 Contract player status:",
      playerStatus,
      typeof playerStatus
    );

    if (Number(playerStatus) !== 1) {
      // Active가 아니면
      return res.status(400).json({
        success: false,
        error: "Session expired on contract",
      });
    }

    // 스냅샷이 있으면 복원
    if (session.last_snapshot && session.last_snapshot.collectedTokens) {
      // 수집했던 토큰들을 다시 맵에 배치
      const foods = gameService.distributeTokensToMap(
        session.last_snapshot.collectedTokens
      );
      console.log(`🔄 Restored ${foods.length} foods`);
    }

    res.json({
      success: true,
      message: "Rejoined successfully",
      playerName: playerName,
      session: {
        gameId: session.game_id,
        lastSnapshot: session.last_snapshot,
      },
    });
  } catch (error: any) {
    console.error("❌ Error rejoining game:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to rejoin",
    });
  }
}

export async function checkPendingClaim(req: Request, res: Response) {
  try {
    const { walletAddress } = req.query;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: "Wallet address required",
      });
    }

    // EXITED 상태의 세션 조회 (claim 안한 것)
    const { data: exitedSessions, error } = await supabase
      .from("game_sessions")
      .select("*")
      .eq("player_address", (walletAddress as string).toLowerCase())
      .eq("status", "EXITED")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) throw error;

    if (exitedSessions && exitedSessions.length > 0) {
      const session = exitedSessions[0];

      // 컨트랙트 상태 확인 (혹시 이미 claim했는지)
      const playerStatus = await contractService.getPlayerStatus(
        walletAddress as string
      );

      if (Number(playerStatus) === 2) {
        // 여전히 Exited (claim 안함)
        return res.json({
          success: true,
          hasPendingClaim: true,
          session: {
            gameId: session.game_id,
            finalScore: session.final_score,
            rewardTokens: session.reward_tokens,
            rewardAmounts: session.reward_amounts,
            survivalTime: session.survival_time,
          },
        });
      } else if (Number(playerStatus) === 4) {
        // 이미 Claimed (DB만 업데이트 안된 경우)
        await supabase
          .from("game_sessions")
          .update({ status: "CLAIMED" })
          .eq("session_id", session.session_id);
      }
    }

    return res.json({
      success: true,
      hasPendingClaim: false,
    });
  } catch (error: any) {
    console.error("❌ Error checking pending claim:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to check pending claim",
    });
  }
}
