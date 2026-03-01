import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const PORT = 3000;

  app.use(express.json());

  // Mock Auth API
  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body;
    // In a real app, validate against DB
    res.json({ 
      success: true, 
      user: { 
        id: Date.now().toString(), 
        email, 
        name: email.split('@')[0] 
      } 
    });
  });

  // Socket.io logic for private chat
  const rooms = new Map(); // roomId -> { users: [], messages: [], aiEnabled: false, name: string }

  // Initialize global room
  rooms.set("global_tigrinya_wegi", { 
    users: [], 
    messages: [], 
    aiEnabled: false, 
    name: "ትግርኛ ወግዒ" 
  });

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-room", ({ roomId, user }) => {
      socket.join(roomId);
      if (!rooms.has(roomId)) {
        rooms.set(roomId, { users: [], messages: [], aiEnabled: false, name: roomId });
      }
      const room = rooms.get(roomId);
      if (!room.users.find((u: any) => u.id === user.id)) {
        room.users.push({ ...user, socketId: socket.id });
      }
      
      io.to(roomId).emit("room-update", room);
      console.log(`User ${user.name} joined room ${roomId}`);
    });

    socket.on("send-message", ({ roomId, message }) => {
      const room = rooms.get(roomId);
      if (room) {
        // Handle image messages if any (message.image will be base64)
        room.messages.push(message);
        io.to(roomId).emit("new-message", message);
      }
    });

    socket.on("toggle-ai", ({ roomId, enabled }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.aiEnabled = enabled;
        io.to(roomId).emit("ai-status-update", enabled);
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      // Cleanup rooms
      rooms.forEach((room, roomId) => {
        room.users = room.users.filter((u: any) => u.socketId !== socket.id);
        io.to(roomId).emit("room-update", room);
      });
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
