import { Server, Socket } from "socket.io";
import { gameService } from "../services/gameService";
import { relayerService } from "../services/relayerService";
import { supabase } from "../services/supabaseService";

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

          await supabase
            .from("game_sessions")
            .update({
              status: "ACTIVE",
              updated_at: new Date(),
            })
            .eq("player_address", data.walletAddress.toLowerCase())
            .eq("status", "PENDING")
            .order("created_at", { ascending: false })
            .limit(1);

          // 입장한 플레이어에게 자신의 정보 전송
          socket.emit("player-joined", player);

          // 다른 플레이어들에게 새 플레이어 알림
          socket.broadcast.emit("player-joined", player);

          // 현재 게임 상태 전송
          socket.emit("game-state", await gameService.getGameState());

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

    socket.on("eat-food", async (foodId: string) => {
      const success = await gameService.eatFood(socket.id, foodId);

      if (success) {
        // 모든 플레이어에게 Food가 먹혔음을 알림
        io.emit("food-eaten", { foodId, playerId: socket.id });

        // 탈출 가능 여부 확인
        if (await gameService.canEscape(socket.id)) {
          socket.emit("can-escape", true);
        }

        // 업데이트된 플레이어 정보 전송
        const player = gameService.getPlayer(socket.id);
        if (player) {
          socket.emit("player-updated", player);
        }
      }
    });

    socket.on("player-escape", async () => {
      const player = gameService.getPlayer(socket.id);

      if (!player) {
        socket.emit("escape-failed", { message: "Player not found" });
        return;
      }

      console.log(`🚪 ${player.name} requested to exit game`);

      const playerSnapshot = { ...player };

      try {
        // handlePlayerDeath가 알아서 Dead/Exited 판단
        const result = await gameService.handlePlayerDeath(socket.id);
        io.to(socket.id).emit("blockchain-update-complete", {
          success: result.success,
          playerAddress: playerSnapshot.walletAddress,
        });

        if (result.success) {
          if (result.status === "EXITED") {
            // 탈출 성공
            io.to(socket.id).emit("escape-success", {
              player: playerSnapshot,
            });
            console.log(`🚀 ${playerSnapshot.name} escaped!`);
          } else {
            // 탈출 실패 (가치 부족)
            io.to(socket.id).emit("escape-failed", {
              message: "Not enough value to escape. Tokens returned to map.",
              player: playerSnapshot,
            });
            console.log(
              `💀 ${playerSnapshot.name} exit failed. Not enough value.`
            );
          }
        } else {
          socket.emit("escape-failed", {
            message: "Failed to update blockchain state",
          });
        }
      } catch (error) {
        console.error("Error handling escape:", error);
        socket.emit("escape-failed", {
          message: "Escape failed. Please try again.",
        });
      }
    });

    socket.on("disconnect", async () => {
      const player = gameService.getPlayer(socket.id);
      if (player) {
        console.log(`🔌 Player ${player.name} disconnected. Saving session...`);

        // DB에 현재 상태 저장 (스냅샷)
        await supabase
          .from("game_sessions")
          .update({
            last_snapshot: {
              score: player.score,
              length: player.length,
              collectedTokens: player.collectedTokens,
              position: player.position,
              timestamp: Date.now(),
            },
            updated_at: new Date(),
          })
          .eq("player_address", player.walletAddress.toLowerCase())
          .eq("status", "ACTIVE");

        console.log(`💾 Session saved for ${player.name}`);
      }

      await gameService.handlePlayerDisconnect(socket.id);
      io.emit("player-left", socket.id);
    });
  });

  // 주기적으로 게임 상태 브로드캐스트 (30fps)
  setInterval(async () => {
    // 1. 충돌 체크 (최적화됨)
    const deadPlayers = gameService.checkCollisions();

    // 게임 상태 업데이트 (플레이어 위치 포함)
    const gameState = gameService.getGameState();
    io.emit("game-state", gameState);

    // 게임 상태 업데이트
    io.emit("game-state-update", {
      leaderboard: gameState.leaderboard,
      playerCount: gameState.players.length,
      foodCount: gameState.foods.length,
    });

    // 죽은 플레이어 처리
    if (deadPlayers.length > 0) {
      // 즉시 게임오버 알림 전송 (UX)
      deadPlayers.forEach((socketId) => {
        const deadPlayer = gameService.getPlayer(socketId);
        if (deadPlayer) {
          io.to(socketId).emit("player-died-collision", deadPlayer);
        }
      });

      // 백그라운드에서 컨트랙트 업데이트 (비동기)
      (async () => {
        for (const socketId of deadPlayers) {
          const deadPlayer = gameService.getPlayer(socketId);
          if (deadPlayer) {
            const playerSnapshot = { ...deadPlayer };

            try {
              // 컨트랙트 상태 업데이트 (시간이 걸림)
              const result = await gameService.handlePlayerDeath(socketId);

              // 완료 알림 (rejoin 가능 상태)
              io.to(socketId).emit("blockchain-update-complete", {
                success: result.success,
                status: result.status,
                playerAddress: playerSnapshot.walletAddress,
              });

              console.log(`✅ Blockchain updated for ${playerSnapshot.name}`);
            } catch (error) {
              console.error(`Error handling death for ${socketId}:`, error);
              io.to(socketId).emit("blockchain-update-complete", {
                success: false,
                playerAddress: playerSnapshot.walletAddress,
                error: "Failed to update blockchain",
              });
            }
          }
        }
      })();
    }
  }, 1000 / 30);

  // 주기적으로 모든 플레이어 상태 저장 (30초마다)
  setInterval(async () => {
    const gameState = gameService.getGameState();

    for (const player of gameState.players) {
      try {
        await supabase
          .from("game_sessions")
          .update({
            last_snapshot: {
              score: player.score,
              length: player.length,
              collectedTokens: player.collectedTokens,
              position: player.position,
              timestamp: Date.now(),
            },
            updated_at: new Date(),
          })
          .eq("player_address", player.walletAddress.toLowerCase())
          .eq("status", "ACTIVE");
      } catch (error) {
        console.error(`Error saving snapshot for ${player.name}:`, error);
      }
    }

    console.log(`💾 Auto-saved ${gameState.players.length} player sessions`);
  }, 30000); // 30초
}
