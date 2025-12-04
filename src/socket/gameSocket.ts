import { Server, Socket } from "socket.io";
import { gameService } from "../services/gameService";

export function setupGameSocket(io: Server) {
  io.on("connection", (socket: Socket) => {
    console.log("🔌 Player connected:", socket.id);

    socket.on(
      "join-game",
      async (data: {
        name: string;
        walletAddress: string;
        stakedTokens: any[];
      }) => {
        try {
          const player = await gameService.addPlayer(
            socket.id,
            data.name,
            data.walletAddress,
            data.stakedTokens
          );

          // 입장한 플레이어에게 자신의 정보 전송
          socket.emit("player-joined", player);

          // 다른 플레이어들에게 새 플레이어 알림
          socket.broadcast.emit("player-joined", player);

          // 현재 게임 상태 전송
          socket.emit("game-state", gameService.getGameState());

          console.log(`✅ ${data.name} joined the game`);
        } catch (error) {
          console.error("❌ Error joining game:", error);
          socket.emit("error", { message: "Failed to join game" });
        }
      }
    );

    socket.on(
      "player-move",
      (position: { x: number; y: number; angle: number }) => {
        gameService.updatePlayerPosition(socket.id, position);

        // 다른 플레이어들에게 위치 업데이트 브로드캐스트
        socket.broadcast.emit("player-moved", {
          socketId: socket.id,
          position,
        });
      }
    );

    socket.on("eat-food", (foodId: string) => {
      const success = gameService.eatFood(socket.id, foodId);

      if (success) {
        // 모든 플레이어에게 Food가 먹혔음을 알림
        io.emit("food-eaten", { foodId, playerId: socket.id });

        // 탈출 가능 여부 확인
        if (gameService.canEscape(socket.id)) {
          socket.emit("can-escape", true);
        }

        // 업데이트된 플레이어 정보 전송
        const player = gameService.getPlayer(socket.id);
        if (player) {
          socket.emit("player-updated", player);
        }
      }
    });

    socket.on("player-died", async () => {
      await gameService.handlePlayerDeath(socket.id);
      io.emit("player-left", socket.id);
      console.log(`💀 Player ${socket.id} died`);
    });

    socket.on("player-escape", async () => {
      const success = await gameService.handlePlayerEscape(socket.id);

      if (success) {
        socket.emit("escape-success");
        io.emit("player-left", socket.id);
        console.log(`🚀 Player ${socket.id} escaped`);
      } else {
        socket.emit("escape-failed", { message: "Not enough score to escape" });
      }
    });

    socket.on("disconnect", async () => {
      await gameService.handlePlayerDeath(socket.id);
      io.emit("player-left", socket.id);
      console.log("🔌 Player disconnected:", socket.id);
    });
  });

  // 주기적으로 게임 상태 브로드캐스트 (30fps)
  let frameCount = 0;
  setInterval(() => {
    frameCount++;

    // 충돌 체크 (최적화됨)
    const deadPlayers = gameService.checkCollisions();

    // 죽은 플레이어들에게 알림
    deadPlayers.forEach((socketId) => {
      io.to(socketId).emit("player-died-collision");
    });

    // 게임 상태 업데이트
    io.emit("game-state-update", {
      leaderboard: gameService.getGameState().leaderboard,
      playerCount: gameService.getGameState().players.length,
      foodCount: gameService.getGameState().foods.length,
    });

    // 10초마다 성능 통계 출력
    if (frameCount % 300 === 0) {
      const stats = gameService.getCollisionStats();
      console.log("🔍 Collision Stats:", stats);
    }
  }, 1000 / 30);
}
