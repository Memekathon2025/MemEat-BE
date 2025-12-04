import { TokenBalance, Food } from "../models/types";

// Mock 블록체인 서비스
export class MockBlockchainService {
  private stakedBalances: Map<string, TokenBalance[]> = new Map();

  async verifyStaking(
    walletAddress: string,
    tokens: TokenBalance[]
  ): Promise<boolean> {
    // Mock 스테이킹 검증
    console.log(`✅ Verifying stake for ${walletAddress}:`, tokens);
    this.stakedBalances.set(walletAddress, tokens);
    return true;
  }

  async distributeTokensToMap(tokens: TokenBalance[]): Promise<Food[]> {
    // 스테이킹된 토큰을 맵의 Food로 변환
    const foods: Food[] = [];
    const WORLD_SIZE = { width: 4000, height: 2000 };

    tokens.forEach((token) => {
      const foodCount = Math.max(1000, Math.floor(token.amount / 5)); // TODO: 알맞게 변경

      for (let i = 0; i < foodCount; i++) {
        foods.push({
          id: `food_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          position: {
            x: Math.random() * WORLD_SIZE.width - 1200,
            y: Math.random() * WORLD_SIZE.height - 600,
          },
          token: {
            symbol: token.symbol,
            amount: 10,
            color: this.getTokenColor(token.symbol),
          },
        });
      }
    });

    console.log(`🍕 Distributed ${foods.length} foods to map`);
    return foods;
  }

  async withdrawTokens(
    walletAddress: string,
    tokens: TokenBalance[]
  ): Promise<boolean> {
    // Mock 출금 처리
    console.log(`💰 Withdrawing to ${walletAddress}:`, tokens);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return true;
  }

  private getTokenColor(symbol: string): string {
    const colors: { [key: string]: string } = {
      MEME1: "#FFD700",
      MEME2: "#00FF00",
      MEME3: "#FF1493",
      MEME4: "#00CED1",
      MEME5: "#FF4500",
    };
    return colors[symbol] || "#FFFFFF";
  }
}

export const mockBlockchain = new MockBlockchainService();
