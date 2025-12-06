import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

import { setupGameSocket } from "./socket/gameSocket";
import { gameService } from "./services/gameService";
import { getTokenPrice } from "./controllers/priceController";
import {
  checkActiveSession,
  checkPendingClaim,
  enterGame,
  rejoinGame,
} from "./controllers/gameController";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173", // Vite 기본 포트
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.use(cors());
app.use(express.json());

// REST API 엔드포인트
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Server is running" });
});

app.get("/api/leaderboard", (req, res) => {
  const leaderboard = gameService.getLeaderboard();
  res.json({ leaderboard });
});

app.get("/api/game-state", (req, res) => {
  const gameState = gameService.getGameState();
  res.json(gameState);
});

app.get("/api/price/:chainId/:tokenAddress", getTokenPrice);

app.post("/api/enter-game", enterGame);
app.get("/api/check-session", checkActiveSession);
app.post("/api/rejoin-game", rejoinGame);
app.get("/api/check-pending-claim", checkPendingClaim);

// Socket.IO 설정
setupGameSocket(io);

const PORT = process.env.PORT || 3333;

httpServer.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   🐍 Snake Game Server Running         ║
║                                        ║
║   Port: ${PORT}                        ║
║   Socket.IO: ✅ Ready                  ║
║   Mock Blockchain: ✅ Active           ║
╚════════════════════════════════════════╝
  `);
});
