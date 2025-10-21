// error handlers Node.js level errors.
process.on('uncaughtException', (error) => {
  console.error('----->  UNCAUGHT EXCEPTION - App will exit!');
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('----->  UNHANDLED REJECTION - App will exit!');
  console.error('Promise:', promise);
  console.error('Reason:', reason);
  process.exit(1);
});

console.log('-----> Error handlers registered, starting app...');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const crypto = require('crypto');
require('dotenv').config();

const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const codeRoutes = require('./routes/code');
const ingestRoutes = require('./routes/ingest');
const swaggerUi = require('swagger-ui-express');
const { logRequest } = require('./utils/logger');

const AUTH_DISABLED = String(process.env.DISABLE_AUTH || "true").toLowerCase() === "true";

if (!process.env.JWT_SECRET) {
  if (AUTH_DISABLED) {
    process.env.JWT_SECRET = crypto.randomBytes(24).toString("hex");
    console.warn("Auth disabled and JWT_SECRET missing. Using ephemeral JWT secret for this runtime.");
  } else {
    console.error("----->  JWT_SECRET is missing in .env file. Please set it before running the server.");
    process.exit(1);
  }
}

// Load Swagger YAML safely
let swaggerDocument = {};
try {
  const yamlPath = path.join(__dirname, "docs", "openapi.yaml");
  const file = fs.readFileSync(yamlPath, "utf8");
  swaggerDocument = yaml.load(file);
} catch (err) {
  console.warn("Swagger YAML not loaded:", err.message);
}

// Initialize Express app
const app = express();
const server = createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true
  }
});

// Connect to MongoDB (async IIFE)
(async () => {
  try {
    await connectDB();

    // Security Middleware with Helmet and CSP
    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"]
          }
        }
      })
    );

    // CORS middleware
    app.use(
      cors({
        origin: process.env.CLIENT_URL || "http://localhost:5173",
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"]
      })
    );

    // Global Rate Limiting
    const limiter = rateLimit({
      windowMs: Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
      max: Number.parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
      message: { error: "Too many requests from this IP, please try again later." },
      standardHeaders: true,
      legacyHeaders: false
    });
    app.use("/api/", limiter);

    // Request logging middleware
    app.use(logRequest);

    // Body parsers
    app.use(express.json({ limit: "10mb" }));
    app.use(express.urlencoded({ extended: true, limit: "10mb" }));

    // HTTP Logging
    if (process.env.NODE_ENV === "development") {
      app.use(morgan("dev"));
    } else {
      app.use(morgan("combined"));
    }

    // API Docs
    if (swaggerDocument && Object.keys(swaggerDocument).length) {
      app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
    }

    // Socket.IO Rooms
    io.on("connection", (socket) => {
      socket.on("join-user-room", (userId) => {
        socket.join(`user-${userId}`);
      });
    });

    // Attach io instance to app
    app.set("io", io);

    // Routes
    app.use("/api/auth", authRoutes);
    app.use("/api/chat", chatRoutes);
    app.use("/api/code", codeRoutes);
    app.use("/api/ingest", ingestRoutes);

    // Health endpoint
    app.get("/api/health", (req, res) => {
      res.status(200).json({
        success: true,
        message: "----->   Synaptron Backend is running smoothly!",
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        version: "1.1.0"
      });
    });

    // Root welcome endpoint
    app.get("/", (req, res) => {
      res.status(200).json({
        success: true,
        message: "----->  Welcome to Synaptron AI Backend API",
        version: "1.1.0",
        documentation: "/api-docs",
        endpoints: {
          auth: "/api/auth",
          chat: "/api/chat",
          code: "/api/code",
          ingest: "/api/ingest",
          health: "/api/health"
        }
      });
    });

    // 404 handler
    app.use("*", (req, res) => {
      res.status(404).json({
        success: false,
        message: `----->  Route ${req.originalUrl} not found`,
        availableRoutes: ["/api/auth", "/api/chat", "/api/code", "/api/ingest", "/api/health"]
      });
    });

    // Global error handling middleware
    app.use((err, req, res, next) => {
      console.error("----->  Global Error:", err.stack);
      res.status(err.status || 500).json({
        success: false,
        message: err.message || "Internal Server Error",
        ...(process.env.NODE_ENV === "development" && { stack: err.stack })
      });
    });

    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`
|-*-*-*-  ================================= 
         SYNAPTRON BACKEND STARTED 
|-*-*-*-  ================================= 
|-*-*-*-  Server: http://localhost:${PORT} 
|-*-*-*-  Environment: ${process.env.NODE_ENV} 
|-*-*-*-  Database: ${process.env.MONGODB_URI ? "Connected" : "Not configured"} 
|-*-*-*-  AI: ${process.env.OPENAI_API_KEY ? "Enabled" : "Not configured"} 
|-*-*-*-  Socket.IO: Enabled 
|-*-*-*-  Ingestion: /api/ingest/start 
|-*-*-*-  Robots: ${String(process.env.RESPECT_ROBOTS || "true")} 
|-*-*-*-  Models: domain=${process.env.AI_DOMAIN_MODEL}, extraction=${process.env.AI_EXTRACTION_MODEL}, roadmap=${process.env.AI_ROADMAP_MODEL} 
|-*-*-*-  =================================
      `);
    });

  } catch (error) {
    console.error('----->  Failed to start server:', error);
    process.exit(1);
  }
})();

module.exports = app;
