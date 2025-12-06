import dotenv from "dotenv";
dotenv.config();

import { ethers } from "ethers";
import WormGame_ABI from "../abis/WormGame.json";

const CONTRACT_ADDRESS =
  process.env.CONTRACT_ADDRESS || "0x04686e9284B54d8719A5a4DecaBE82158316C8f0";
const RPC_URL = process.env.RPC_URL || "https://rpc.formicarium.memecore.net";
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY!;

export class ContractService {
  private provider: ethers.JsonRpcProvider;
  private relayerWallet: ethers.Wallet;
  private contract: ethers.Contract;
  private contractWithRelayer: ethers.Contract;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
    this.relayerWallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, this.provider);

    // Read-only
    this.contract = new ethers.Contract(
      CONTRACT_ADDRESS,
      WormGame_ABI,
      this.provider
    );

    // Relayer 트랜잭션 전송
    this.contractWithRelayer = new ethers.Contract(
      CONTRACT_ADDRESS,
      WormGame_ABI,
      this.relayerWallet
    );
  }

  parseGameEnteredEvent(receipt: ethers.TransactionReceipt) {
    const iface = this.contract.interface;

    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({
          topics: [...log.topics],
          data: log.data,
        });

        if (parsed && parsed.name === "GameEntered") {
          return {
            player: parsed.args.player as string,
            token: parsed.args.token as string,
            amount: parsed.args.amount as bigint,
            gameId: parsed.args.gameId as bigint,
            timestamp: parsed.args.timestamp as bigint,
          };
        }
      } catch (e) {
        // 다른 컨트랙트의 로그일 수 있음
        continue;
      }
    }

    return null;
  }

  getProvider() {
    return this.provider;
  }

  // 상태
  async getPlayerStatus(playerAddress: string): Promise<number> {
    return await this.contract.getPlayerStatus(playerAddress);
  }

  // 보상
  async getPlayerReward(playerAddress: string): Promise<{
    tokens: string[];
    amounts: bigint[];
  }> {
    const [tokens, amounts] = await this.contract.getPlayerReward(
      playerAddress
    );
    return { tokens, amounts };
  }

  // 플레이어 상태 변경 (relayer only)
  async updateGameState(
    playerAddress: string,
    newStatus: number, // 2=Exited, 3=Dead
    rewardTokens: string[],
    rewardAmounts: bigint[]
  ): Promise<string> {
    console.log(`🔗 Updating game state for ${playerAddress}...`);

    const tx = await this.contractWithRelayer.updateGameState(
      playerAddress,
      newStatus,
      rewardTokens,
      rewardAmounts
    );

    console.log(`📤 Transaction sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`✅ Transaction confirmed at block ${receipt.blockNumber}`);

    return tx.hash;
  }

  // 입장료 - 수수료
  async calculateNetAmount(entryAmount: bigint): Promise<bigint> {
    const feeRate = await this.contract.feeRate(); // 500 = 5%
    const fee = (entryAmount * feeRate) / 10000n;
    return entryAmount - fee;
  }
}

export const contractService = new ContractService();
