import { priceService } from "./priceService";
import {
  Player,
  Food,
  GameRoom,
  TokenBalance,
  LeaderboardEntry,
} from "../models/types";
import { relayerService } from "./relayerService";

export class GameService {
  private rooms: Map<string, GameRoom> = new Map();
  private mainRoomId = "main-room";

  private collisionCheckCounter = 0; // 프레임 스킵용
  private readonly COLLISION_CHECK_INTERVAL = 2; // 2프레임마다 체크
  private readonly GRID_SIZE = 200; // 그리드 크기 (픽셀)
  private readonly CHECK_RADIUS = 500; // 충돌 체크 반경
  private readonly SPAWN_ZONE_SIZE = 300; // 스폰 영역 크기 (충돌 무효 영역)
  private readonly MAP_CENTER = { x: 800, y: 400 }; // 맵 중앙 좌표

  constructor() {
    this.createMainRoom();
  }

  private createMainRoom() {
    this.rooms.set(this.mainRoomId, {
      id: this.mainRoomId,
      players: new Map(),
      foods: [],
      worldSize: { width: 4000, height: 2000 },
    });
    console.log("🎮 Main game room created");
  }

  distributeTokensToMap(tokens: TokenBalance[]): Food[] {
    const room = this.rooms.get(this.mainRoomId);
    if (!room) {
      console.error("Main room not found!");
      return [];
    }

    const foods: Food[] = [];
    const WORLD_SIZE = room.worldSize;
    const FOOD_UNIT_SIZE = 0.1; // 각 food 크기 (0.1 토큰)

    tokens.forEach((token) => {
      // ✅ 토큰 보존 법칙: 정확히 나누기
      const foodCount = Math.floor(token.amount / FOOD_UNIT_SIZE);
      let totalDistributed = 0;

      // 대부분의 food는 FOOD_UNIT_SIZE
      for (let i = 0; i < foodCount; i++) {
        const food: Food = {
          id: `food_${Date.now()}_${i}_${Math.random()
            .toString(36)
            .substr(2, 9)}`,
          position: {
            x: Math.random() * WORLD_SIZE.width - WORLD_SIZE.width / 2,
            y: Math.random() * WORLD_SIZE.height - WORLD_SIZE.height / 2,
          },
          token: {
            address: token.address,
            symbol: token.symbol,
            amount: FOOD_UNIT_SIZE,
            color: token.color,
          },
        };
        foods.push(food);
        totalDistributed += FOOD_UNIT_SIZE;
      }

      // 나머지 처리 (버림 방지)
      const remainder = token.amount - totalDistributed;
      if (remainder > 0.0001) {
        foods.push({
          id: `food_remainder_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`,
          position: {
            x: Math.random() * WORLD_SIZE.width - WORLD_SIZE.width / 2,
            y: Math.random() * WORLD_SIZE.height - WORLD_SIZE.height / 2,
          },
          token: {
            address: token.address,
            symbol: token.symbol,
            amount: remainder,
            color: token.color,
          },
        });
        totalDistributed += remainder;
      }

      // ✅ 검증: 총합 확인
      const diff = Math.abs(totalDistributed - token.amount);
      if (diff > 0.0001) {
        console.error(
          `⚠️ Token amount mismatch! ${totalDistributed.toFixed(
            6
          )} !== ${token.amount.toFixed(6)} (diff: ${diff.toFixed(6)})`
        );
      } else {
        console.log(
          `🍕 Token ${token.symbol}: ${token.amount.toFixed(6)} → ${
            foods.length
          } foods (total: ${totalDistributed.toFixed(6)}) ✅`
        );
      }
    });

    // 맵에 추가
    room.foods.push(...foods);
    return foods;
  }

  async addPlayer(
    socketId: string,
    name: string,
    walletAddress: string,
    stakedTokens: TokenBalance[]
  ): Promise<Player> {
    const room = this.rooms.get(this.mainRoomId)!;

    const existingPlayer = Array.from(room.players.values()).find(
      (p) => p.walletAddress.toLowerCase() === walletAddress.toLowerCase()
    );

    if (existingPlayer) {
      console.log(
        `🔄 Removing old session for ${name} (${existingPlayer.socketId})`
      );

      // 수집한 토큰이 있으면 맵에 재배치
      if (existingPlayer.collectedTokens.length > 0) {
        this.distributeTokensToMap(existingPlayer.collectedTokens);
        console.log(
          `🍕 Redistributed ${existingPlayer.collectedTokens.length} tokens from old session`
        );
      }

      room.players.delete(existingPlayer.socketId);
    }

    const spawnOffset = 50; // 중앙에서 최대 50픽셀 오프셋
    const player: Player = {
      id: `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      socketId,
      name,
      walletAddress,
      position: {
        x: this.MAP_CENTER.x + (Math.random() - 0.5) * spawnOffset,
        y: this.MAP_CENTER.y + (Math.random() - 0.5) * spawnOffset,
      },
      angle: Math.random() * Math.PI * 2,
      score: 0,
      length: 1,
      alive: true,
      collectedTokens: [],
      stakedTokens,
      joinTime: Date.now(),
    };

    room.players.set(socketId, player);
    console.log(`👤 Player ${name} joined (${socketId})`);
    return player;
  }

  updatePlayerPosition(
    socketId: string,
    position: { x: number; y: number; angle: number }
  ) {
    const room = this.rooms.get(this.mainRoomId)!;
    const player = room.players.get(socketId);

    if (player && player.alive) {
      player.position = { x: position.x, y: position.y };
      player.angle = position.angle;
    }
  }

  async eatFood(socketId: string, foodId: string): Promise<boolean> {
    const room = this.rooms.get(this.mainRoomId)!;
    const player = room.players.get(socketId);
    const foodIndex = room.foods.findIndex((f) => f.id === foodId);

    if (player && foodIndex !== -1 && player.alive) {
      const food = room.foods[foodIndex];

      // 토큰 수집
      const existingToken = player.collectedTokens.find(
        (t) => t.symbol === food.token.symbol
      );

      if (existingToken) {
        existingToken.amount += food.token.amount;
      } else {
        player.collectedTokens.push({ ...food.token });
      }

      const tokenValue = await priceService.calculateTotalValue(
        [{ address: food.token.address, amount: food.token.amount }],
        43521
      );
      player.score += tokenValue;
      player.length++;

      // Food 제거
      room.foods.splice(foodIndex, 1);

      console.log(`🍕 ${player.name} ate food. Score: ${player.score}`);
      return true;
    }

    return false;
  }

  private createSpatialGrid(players: Player[]): Map<string, Player[]> {
    const grid = new Map<string, Player[]>();

    players.forEach((player) => {
      if (!player.alive) return;

      // 플레이어가 속한 그리드 셀 계산
      const gridX = Math.floor(player.position.x / this.GRID_SIZE);
      const gridY = Math.floor(player.position.y / this.GRID_SIZE);
      const key = `${gridX},${gridY}`;

      if (!grid.has(key)) {
        grid.set(key, []);
      }
      grid.get(key)!.push(player);

      // 인접한 8개 셀에도 추가 (경계 충돌 감지)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const neighborKey = `${gridX + dx},${gridY + dy}`;
          if (!grid.has(neighborKey)) {
            grid.set(neighborKey, []);
          }
          grid.get(neighborKey)!.push(player);
        }
      }
    });

    return grid;
  }

  // 플레이어가 스폰 영역 안에 있는지 확인
  private isInSpawnZone(position: { x: number; y: number }): boolean {
    const dx = Math.abs(position.x - this.MAP_CENTER.x);
    const dy = Math.abs(position.y - this.MAP_CENTER.y);
    return dx <= this.SPAWN_ZONE_SIZE / 2 && dy <= this.SPAWN_ZONE_SIZE / 2;
  }

  // 플레이어의 몸 위치를 근사적으로 계산 (angle과 length 기반)
  private getApproximateBodyPositions(
    player: Player,
    samples: number = 5
  ): { x: number; y: number }[] {
    const positions = [{ ...player.position }]; // 머리
    const segmentLength = 3.5; // 각 세그먼트 길이 (size/2)

    // 최대 samples 또는 player.length 중 작은 값만큼 샘플링
    const actualSamples = Math.min(player.length, samples);

    for (let i = 1; i < actualSamples; i++) {
      positions.push({
        x: player.position.x - segmentLength * i * Math.cos(player.angle),
        y: player.position.y - segmentLength * i * Math.sin(player.angle),
      });
    }

    return positions;
  }

  checkCollisions(): string[] {
    // 프레임 스킵
    this.collisionCheckCounter++;
    if (this.collisionCheckCounter % this.COLLISION_CHECK_INTERVAL !== 0) {
      return [];
    }

    const room = this.rooms.get(this.mainRoomId);
    if (!room) return [];

    const players = Array.from(room.players.values()).filter((p) => p.alive);
    if (players.length < 2) return [];

    // 공간 분할 그리드 생성
    const grid = this.createSpatialGrid(players);
    const deadPlayers: string[] = [];
    const checkedPairs = new Set<string>();

    // 각 플레이어에 대해 충돌 체크
    for (const player1 of players) {
      if (deadPlayers.includes(player1.socketId)) continue;

      // 플레이어가 속한 그리드 셀의 다른 플레이어들만 체크
      const gridX = Math.floor(player1.position.x / this.GRID_SIZE);
      const gridY = Math.floor(player1.position.y / this.GRID_SIZE);
      const key = `${gridX},${gridY}`;
      const nearbyPlayers = grid.get(key) || [];

      for (const player2 of nearbyPlayers) {
        if (player1.socketId === player2.socketId) continue;
        if (deadPlayers.includes(player2.socketId)) continue;

        // 이미 체크한 쌍은 건너뛰기
        const pairKey = [player1.socketId, player2.socketId].sort().join("-");
        if (checkedPairs.has(pairKey)) continue;
        checkedPairs.add(pairKey);

        // 거리 기반 사전 필터링 (빠른 체크)
        const dx = player1.position.x - player2.position.x;
        const dy = player1.position.y - player2.position.y;
        const distanceSquared = dx * dx + dy * dy;

        // 거리가 CHECK_RADIUS보다 멀면 건너뛰기 (제곱근 계산 생략)
        if (distanceSquared > this.CHECK_RADIUS * this.CHECK_RADIUS) continue;

        // 스폰 영역 보호: 둘 다 스폰 영역에 있으면 충돌 무시
        const player1InSpawn = this.isInSpawnZone(player1.position);
        const player2InSpawn = this.isInSpawnZone(player2.position);

        if (player1InSpawn && player2InSpawn) {
          // 둘 다 스폰 영역에 있으면 충돌 체크 안함
          continue;
        }

        // 실제 충돌 체크 (머리와 몸통)
        const collisionRadius = 15; // 충돌 반경
        const collisionRadiusSquared = collisionRadius * collisionRadius;

        // 몸 위치 근사 계산 (5개 샘플)
        const body1 = this.getApproximateBodyPositions(player1, 5);
        const body2 = this.getApproximateBodyPositions(player2, 5);

        // 디버깅: 몸 샘플 정보 (10초마다)
        if (
          this.collisionCheckCounter % 300 === 0 &&
          (body1.length > 1 || body2.length > 1)
        ) {
          console.log(`🐍 Body collision check:`, {
            player1: {
              name: player1.name,
              length: player1.length,
              bodySamples: body1.length,
              angle: player1.angle.toFixed(2),
            },
            player2: {
              name: player2.name,
              length: player2.length,
              bodySamples: body2.length,
              angle: player2.angle.toFixed(2),
            },
            distance: Math.sqrt(distanceSquared).toFixed(2),
          });
        }

        let hasCollision = false;
        let collisionType = "";

        // 1. player1 머리 vs player2 몸 (player2의 머리 제외)
        for (let i = 1; i < body2.length; i++) {
          const dx = player1.position.x - body2[i].x;
          const dy = player1.position.y - body2[i].y;
          if (dx * dx + dy * dy < collisionRadiusSquared) {
            hasCollision = true;
            collisionType = "head-to-body";
            break;
          }
        }

        // 2. player2 머리 vs player1 몸 (player1의 머리 제외)
        if (!hasCollision) {
          for (let i = 1; i < body1.length; i++) {
            const dx = player2.position.x - body1[i].x;
            const dy = player2.position.y - body1[i].y;
            if (dx * dx + dy * dy < collisionRadiusSquared) {
              hasCollision = true;
              collisionType = "head-to-body";
              break;
            }
          }
        }

        // 3. 머리 vs 머리 (기존 로직)
        if (!hasCollision && distanceSquared < collisionRadiusSquared) {
          hasCollision = true;
          collisionType = "head-to-head";
        }

        if (hasCollision) {
          // 충돌 발생! 작은 쪽이 죽음
          let victim: Player;
          let killer: Player;

          if (player1.score < player2.score) {
            victim = player1;
            killer = player2;
          } else if (player2.score < player1.score) {
            victim = player2;
            killer = player1;
          } else {
            // 점수가 같으면 먼저 들어온 사람이 살아남음
            victim = player1.joinTime > player2.joinTime ? player1 : player2;
            killer = victim === player1 ? player2 : player1;
          }

          console.log(
            `💥 Collision (${collisionType})! ${victim.name} (${victim.score}) killed by ${killer.name} (${killer.score})`
          );
          deadPlayers.push(victim.socketId);
          break; // 이미 죽었으므로 더 이상 체크 안함
        }
      }
    }

    return deadPlayers;
  }

  getCollisionStats(): {
    totalPlayers: number;
    gridCells: number;
    checksPerformed: number;
  } {
    const room = this.rooms.get(this.mainRoomId);
    if (!room) return { totalPlayers: 0, gridCells: 0, checksPerformed: 0 };

    const players = Array.from(room.players.values()).filter((p) => p.alive);
    const grid = this.createSpatialGrid(players);

    return {
      totalPlayers: players.length,
      gridCells: grid.size,
      checksPerformed: this.collisionCheckCounter,
    };
  }

  async handlePlayerDeath(socketId: string): Promise<{
    success: boolean;
    status: "DEAD" | "EXITED";
  }> {
    const room = this.rooms.get(this.mainRoomId)!;
    const player = room.players.get(socketId);

    if (!player) {
      return { success: false, status: "DEAD" };
    }

    player.alive = false;

    // relayer를 통해 컨트랙트 상태 업데이트 (Dead or Exited)
    const result = await relayerService.handlePlayerDeath(player);

    // 🔥 Dead일 때만 토큰 재배치
    if (result.status === "DEAD" && player.collectedTokens.length > 0) {
      const redistributedFoods = this.distributeTokensToMap(
        player.collectedTokens
      );
      console.log(
        `💀 ${player.name} died. Redistributed ${redistributedFoods.length} foods`
      );
    } else if (result.status === "EXITED") {
      console.log(`🚀 ${player.name} escaped! Tokens reserved for claim.`);
    }

    room.players.delete(socketId);
    return result;
  }

  async handlePlayerDisconnect(socketId: string) {
    const room = this.rooms.get(this.mainRoomId)!;
    const player = room.players.get(socketId);

    if (player) {
      // 수집한 토큰을 다시 맵에 뿌림 (재접속 전까지)
      if (player.collectedTokens.length > 0) {
        const redistributedFoods = this.distributeTokensToMap(
          player.collectedTokens
        );
        console.log(
          `🔄 Redistributed ${redistributedFoods.length} foods (disconnect)`
        );
      }

      room.players.delete(socketId);
    }
  }

  getGameState() {
    const room = this.rooms.get(this.mainRoomId)!;

    // 맵에 있는 토큰별 집계
    const tokenSummary = new Map<
      string,
      {
        symbol: string;
        address: string;
        amount: number;
        count: number;
        color: string;
      }
    >();

    room.foods.forEach((food) => {
      const key = food.token.symbol;
      const existing = tokenSummary.get(key);

      if (existing) {
        existing.amount += food.token.amount;
        existing.count += 1;
      } else {
        tokenSummary.set(key, {
          symbol: food.token.symbol,
          address: food.token.address,
          amount: food.token.amount,
          count: 1,
          color: food.token.color || "#fff",
        });
      }
    });

    return {
      players: Array.from(room.players.values()),
      foods: room.foods,
      leaderboard: this.getLeaderboard(),
      mapTokens: Array.from(tokenSummary.values()),
    };
  }

  getLeaderboard(): LeaderboardEntry[] {
    const room = this.rooms.get(this.mainRoomId)!;

    const result = Array.from(room.players.values())
      .filter((p) => p.alive)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((p) => ({
        name: p.name,
        score: p.score,
        survivalTime: Math.floor((Date.now() - p.joinTime) / 1000),
      }));

    return result;
  }

  async canEscape(socketId: string): Promise<boolean> {
    const player = this.getPlayer(socketId);
    if (!player) return false;

    const totalValue = await priceService.calculateTotalValue(
      player.collectedTokens.map((t) => ({
        address: t.address,
        amount: t.amount,
      }))
    );
    return totalValue >= 1;
  }

  getPlayer(socketId: string): Player | undefined {
    const room = this.rooms.get(this.mainRoomId)!;
    return room.players.get(socketId);
  }
}

export const gameService = new GameService();
