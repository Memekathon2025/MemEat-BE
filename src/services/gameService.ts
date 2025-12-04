import {
  Player,
  Food,
  GameRoom,
  TokenBalance,
  LeaderboardEntry,
} from "../models/types";
import { mockBlockchain } from "./mockBlockchain";

export class GameService {
  private rooms: Map<string, GameRoom> = new Map();
  private mainRoomId = "main-room";
  private ESCAPE_THRESHOLD = 100; // 탈출 가능 점수

  private collisionCheckCounter = 0; // 프레임 스킵용
  private readonly COLLISION_CHECK_INTERVAL = 2; // 2프레임마다 체크
  private readonly GRID_SIZE = 200; // 그리드 크기 (픽셀)
  private readonly CHECK_RADIUS = 500; // 충돌 체크 반경

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

  async addPlayer(
    socketId: string,
    name: string,
    walletAddress: string,
    stakedTokens: TokenBalance[]
  ): Promise<Player> {
    const room = this.rooms.get(this.mainRoomId)!;

    // 스테이킹 검증
    await mockBlockchain.verifyStaking(walletAddress, stakedTokens);

    // 스테이킹된 토큰을 맵에 배치
    const newFoods = await mockBlockchain.distributeTokensToMap(stakedTokens);
    room.foods.push(...newFoods);

    // 플레이어 생성
    const player: Player = {
      id: `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      socketId,
      name,
      walletAddress,
      position: {
        x: Math.random() * room.worldSize.width - 1200,
        y: Math.random() * room.worldSize.height - 600,
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

  eatFood(socketId: string, foodId: string): boolean {
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

      player.score += food.token.amount;
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

        // 실제 충돌 체크 (머리와 몸통)
        const collisionRadius = 15; // 충돌 반경
        const distance = Math.sqrt(distanceSquared);

        if (distance < collisionRadius) {
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
            `💥 Collision! ${victim.name} (${victim.score}) killed by ${killer.name} (${killer.score})`
          );
          deadPlayers.push(victim.socketId);
          break; // 이미 죽었으므로 더 이상 체크 안함
        }
      }
    }

    // 죽은 플레이어들 처리
    deadPlayers.forEach((socketId) => {
      this.handlePlayerDeath(socketId);
    });

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

  async handlePlayerDeath(socketId: string) {
    const room = this.rooms.get(this.mainRoomId)!;
    const player = room.players.get(socketId);

    if (player) {
      player.alive = false;

      // 수집한 토큰을 다시 맵에 뿌림
      if (player.collectedTokens.length > 0) {
        const redistributedFoods = await mockBlockchain.distributeTokensToMap(
          player.collectedTokens
        );
        room.foods.push(...redistributedFoods);
        console.log(
          `💀 ${player.name} died. Redistributed ${redistributedFoods.length} foods`
        );
      }

      room.players.delete(socketId);
    }
  }

  async handlePlayerEscape(socketId: string): Promise<boolean> {
    const room = this.rooms.get(this.mainRoomId)!;
    const player = room.players.get(socketId);

    if (player && player.score >= this.ESCAPE_THRESHOLD) {
      // 출금 처리
      await mockBlockchain.withdrawTokens(
        player.walletAddress,
        player.collectedTokens
      );

      console.log(`🚀 ${player.name} escaped with ${player.score} score!`);
      room.players.delete(socketId);
      return true;
    }

    return false;
  }

  getGameState() {
    const room = this.rooms.get(this.mainRoomId)!;

    return {
      players: Array.from(room.players.values()),
      foods: room.foods,
      leaderboard: this.getLeaderboard(),
    };
  }

  getLeaderboard(): LeaderboardEntry[] {
    const room = this.rooms.get(this.mainRoomId)!;

    return Array.from(room.players.values())
      .filter((p) => p.alive)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((p) => ({
        name: p.name,
        score: p.score,
        survivalTime: Math.floor((Date.now() - p.joinTime) / 1000),
      }));
  }

  canEscape(socketId: string): boolean {
    const room = this.rooms.get(this.mainRoomId)!;
    const player = room.players.get(socketId);

    return player ? player.score >= this.ESCAPE_THRESHOLD : false;
  }

  getPlayer(socketId: string): Player | undefined {
    const room = this.rooms.get(this.mainRoomId)!;
    return room.players.get(socketId);
  }
}

export const gameService = new GameService();
