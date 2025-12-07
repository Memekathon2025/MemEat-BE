import { ethers } from "ethers";

export class PriceService {
  private readonly MEMEX_BASE_URL =
    "https://app.memex.xyz/api/service/public/price/latest";
  private priceCache: Map<string, { price: number; timestamp: number }> =
    new Map();
  private readonly CACHE_TTL = 10000; // 10초 캐시

  private isNativeToken(address: string): boolean {
    return (
      !address ||
      address === ethers.ZeroAddress ||
      address.toLowerCase() === "0x0000000000000000000000000000000000000000"
    );
  }

  async getTokenPriceData(
    tokenAddress: string,
    chainId: number = 4352
  ): Promise<any> {
    const url = `${this.MEMEX_BASE_URL}/${chainId}/${tokenAddress}`;
    const response = await fetch(url);
    return await response.json();
  }

  // 단일 토큰 가격 조회 (M 기준)
  async getTokenPrice(
    tokenAddress: string,
    chainId: number = 43521
  ): Promise<number> {
    if (this.isNativeToken(tokenAddress)) {
      return 1;
    }

    const cacheKey = `${chainId}:${tokenAddress.toLowerCase()}`;

    const cached = this.priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.price;
    }

    try {
      const url = `${this.MEMEX_BASE_URL}/${chainId}/${tokenAddress}`;
      const response = await fetch(url);

      if (!response.ok) {
        console.warn(
          `Failed to fetch price for ${tokenAddress}: ${response.status}`
        );
        return 0.1;
      }

      const data = await response.json();
      const price = parseFloat((data as any)?.chainToken?.priceNow || "0");

      // 캐시 저장
      this.priceCache.set(cacheKey, { price, timestamp: Date.now() });

      return price;
    } catch (error) {
      console.error(`Error fetching token price for ${tokenAddress}:`, error);
      return 0;
    }
  }

  // 여러 토큰의 총 가치 계산 (M 기준)
  async calculateTotalValue(
    tokens: Array<{ address: string; amount: number }>,
    chainId: number = 4352
  ): Promise<number> {
    let totalValue = 0;

    // 네이티브 토큰과 MRC-20 토큰 분리
    const nativeTokens = tokens.filter((t) => this.isNativeToken(t.address));
    const mrc20Tokens = tokens.filter((t) => !this.isNativeToken(t.address));

    // 네이티브 M 토큰 계산 (가격 = 1)
    const nativeValue = nativeTokens.reduce(
      (sum, token) => sum + token.amount * 1,
      0
    );

    // MRC-20 토큰 가격 조회 (병렬)
    let mrc20Value = 0;
    if (mrc20Tokens.length > 0) {
      const pricePromises = mrc20Tokens.map((token) =>
        this.getTokenPrice(token.address, chainId)
      );

      const prices = await Promise.all(pricePromises);

      mrc20Tokens.forEach((token, index) => {
        mrc20Value += token.amount * prices[index];
      });
    }

    totalValue = nativeValue + mrc20Value;

    console.log(
      `💵 Total value: ${nativeValue} M (native) + ${mrc20Value} M (MRC-20) = ${totalValue} M`
    );
    return totalValue;
  }

  clearCache() {
    this.priceCache.clear();
  }
}

export const priceService = new PriceService();
