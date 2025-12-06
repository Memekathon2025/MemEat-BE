import { Request, Response } from "express";

export const getTokenPrice = async (req: Request, res: Response) => {
  const { chainId, tokenAddress } = req.params;

  try {
    const url = `https://app.memex.xyz/api/service/public/price/latest/${chainId}/${tokenAddress}`;
    const response = await fetch(url);
    const data = await response.json();

    res.json(data);
  } catch (error) {
    console.error("Error fetching token price:", error);
    res.status(500).json({ error: "Failed to fetch token price" });
  }
};
