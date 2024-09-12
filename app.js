const express = require("express");
const cluster = require("cluster");
const Redis = require("ioredis");
const Queue = require("bull");
const winston = require("winston");
const { createBullBoard } = require("@bull-board/api");
const { BullAdapter } = require("@bull-board/api/bullAdapter");
const { ExpressAdapter } = require("@bull-board/express");

const numCPUs = require("os").cpus().length;

const app = express();
app.use(express.json());

// Configure Winston logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});

// Create Redis client
const redisClient = new Redis({
  host: "localhost", // or your Redis host
  port: 6379, // default Redis port
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisClient.on("error", (error) => {
  logger.error("Redis error:", error);
});

redisClient.on("connect", () => {
  logger.info("Connected to Redis");
});

class TokenBucketRateLimiter {
  constructor(redisClient) {
    this.redisClient = redisClient;
  }

  async init() {
    // Ensure Redis connection is established
    await this.redisClient.ping();
  }

  async canProcess(userId) {
    const now = Date.now();
    const userKey = `user:${userId}`;

    const secondBucketKey = `${userKey}:second`;
    const minuteBucketKey = `${userKey}:minute`;

    const multi = this.redisClient.multi();
    multi.hgetall(secondBucketKey);
    multi.hgetall(minuteBucketKey);
    const [[, secondBucket], [, minuteBucket]] = await multi.exec();

    const secondTokens = this._refillBucket(secondBucket, 1, 1000, now);
    const minuteTokens = this._refillBucket(minuteBucket, 20, 60000, now);

    if (secondTokens > 0 && minuteTokens > 0) {
      const multi = this.redisClient.multi();
      multi.hmset(secondBucketKey, {
        tokens: secondTokens - 1,
        lastRefill: now,
      });
      multi.hmset(minuteBucketKey, {
        tokens: minuteTokens - 1,
        lastRefill: now,
      });
      multi.expire(secondBucketKey, 2);
      multi.expire(minuteBucketKey, 61);
      await multi.exec();
      return true;
    }

    return false;
  }

  _refillBucket(bucket, capacity, interval, now) {
    const { tokens = capacity, lastRefill = now } = bucket;
    const elapsedTime = now - parseInt(lastRefill);
    const tokensToAdd = Math.floor(elapsedTime / interval) * capacity;
    return Math.min(parseInt(tokens) + tokensToAdd, capacity);
  }
}

const rateLimiter = new TokenBucketRateLimiter(redisClient);

// Configure Bull with the Redis client
const taskQueue = new Queue("taskQueue", {
  createClient: (type) => {
    switch (type) {
      case "client":
        return redisClient;
      case "subscriber":
        return redisClient.duplicate();
      case "bclient":
        return redisClient.duplicate();
      default:
        return redisClient;
    }
  },
});

// Add error handling for the queue
taskQueue.on("error", (error) => {
  logger.error("Queue error:", error);
});

// Set up Bull Board
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

const { addQueue, removeQueue, setQueues, replaceQueues } = createBullBoard({
  queues: [new BullAdapter(taskQueue)],
  serverAdapter: serverAdapter,
});

// Add Bull Board routes
app.use("/admin/queues", serverAdapter.getRouter());

async function task(userId) {
  const logMessage = `${userId}-task completed at-${Date.now()}`;
  logger.info(logMessage);
  // Simulating task execution time
  await new Promise((resolve) => setTimeout(resolve, 50));
}

app.post("/process-task", async (req, res) => {
  const { user_id } = req.body;

  if (!user_id) {
    logger.warn("Request received without user_id");
    return res.status(400).json({ error: "User ID is required" });
  }

  try {
    logger.info(`Processing request for user ${user_id}`);
    if (await rateLimiter.canProcess(user_id)) {
      await task(user_id);
      logger.info(`Task processed successfully for user ${user_id}`);
      res.json({ message: "Task processed successfully" });
    } else {
      await taskQueue.add({ user_id });
      logger.info(`Task queued for processing for user ${user_id}`);
      res.json({ message: "Task queued for processing" });
    }
  } catch (error) {
    logger.error(`Error processing task for user ${user_id}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function processQueue() {
  while (true) {
    try {
      const job = await taskQueue.getNextJob();
      if (job) {
        const { user_id } = job.data;
        logger.info(`Processing queued job for user ${user_id}`);
        if (await rateLimiter.canProcess(user_id)) {
          await task(user_id);
          await job.remove();
          logger.info(`Queued job processed successfully for user ${user_id}`);
        } else {
          await taskQueue.add({ user_id }, { delay: 100 });
          await job.remove();
          logger.info(`Queued job requeued for user ${user_id}`);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    } catch (error) {
      logger.error("Error in queue processing:", error);
    }
  }
}

if (cluster.isMaster) {
  logger.info(`Master ${process.pid} is running`);

  rateLimiter
    .init()
    .then(() => {
      logger.info("Rate limiter initialized");

      for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
      }

      cluster.on("exit", (worker, code, signal) => {
        logger.warn(`Worker ${worker.process.pid} died`);
        cluster.fork();
      });

      processQueue().catch((error) =>
        logger.error("Queue processor error:", error)
      );
    })
    .catch((error) => {
      logger.error("Failed to initialize rate limiter:", error);
      process.exit(1);
    });
} else {
  const port = 3000;
  app.listen(port, () => {
    logger.info(`Worker ${process.pid} listening on port ${port}`);
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, closing HTTP server and queue");
  await taskQueue.close();
  await redisClient.quit();
  process.exit(0);
});

module.exports = app;
