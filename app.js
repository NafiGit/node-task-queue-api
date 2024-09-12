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
  host: "localhost",
  port: 6379,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisClient.on("error", (error) => {
  logger.error("Redis error:", error);
});

redisClient.on("connect", () => {
  logger.info("Connected to Redis");
});

// Sliding Window Rate Limiter
class SlidingWindowRateLimiter {
  constructor(redisClient) {
    this.redisClient = redisClient;
    this.minuteLimit = 20;
  }

  async init() {
    await this.redisClient.ping();
  }

  async canProcess(userId) {
    const now = Date.now();
    const minuteKey = `rate_limit:${userId}:minute`;

    const multi = this.redisClient.multi();

    // Add current timestamp to sorted set
    multi.zadd(minuteKey, now, now);

    // Remove old entries
    multi.zremrangebyscore(minuteKey, 0, now - 60000);

    // Count entries in the current window
    multi.zcard(minuteKey);

    // Set expiration for key
    multi.expire(minuteKey, 61);

    const results = await multi.exec();
    const minuteCount = results[2][1];

    return minuteCount <= this.minuteLimit;
  }
}

const rateLimiter = new SlidingWindowRateLimiter(redisClient);

// Configure Bull with the Redis client and additional options
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
  limiter: {
    max: 1, // Max number of jobs processed per minute
    duration: 3000, // 3 sec
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: false,
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

// Modify the task function
async function task(userId) {
  const logMessage = `Task: Your task is to build a Node.js API cluster with two replica sets and create a route to handle a simple task. The task has a rate limit of 1 task per second and 20 tasks per minute for each user ID. Users will hit the route to process tasks multiple times. You need to implement a queueing system to ensure that tasks are processed according to the rate limit for each user ID. User ID: ${userId}, Timestamp: ${new Date().toISOString()}`;
  logger.info(logMessage);
  // Simulating task execution time
  await new Promise((resolve) => setTimeout(resolve, 50));
}

// Modify the queue processing function
function setupQueueProcessor() {
  taskQueue.process(10, async (job) => {
    // Process 10 jobs concurrently
    const { user_id } = job.data;
    try {
      logger.info(`Processing job ${job.id} for user ${user_id}`);
      await task(user_id);
      logger.info(`Job ${job.id} processed successfully for user ${user_id}`);
    } catch (error) {
      logger.error(
        `Error processing job ${job.id} for user ${user_id}:`,
        error
      );
      throw error; // Rethrow the error to trigger job retry
    }
  });

  // Handle failed jobs
  taskQueue.on("failed", (job, err) => {
    logger.error(`Job ${job.id} failed with error: ${err.message}`);
  });

  // Handle completed jobs
  taskQueue.on("completed", (job) => {
    logger.info(`Job ${job.id} completed successfully`);
  });
}

// Modify the /process-task endpoint
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
      const job = await taskQueue.add({ user_id });
      logger.info(
        `Task queued for processing for user ${user_id}, job ID: ${job.id}`
      );
      res.json({ message: "Task queued for processing" });
    }
  } catch (error) {
    logger.error(`Error processing task for user ${user_id}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Function to clear stuck jobs
async function clearStuckJobs() {
  const stuckJobs = await taskQueue.getActive();
  for (const job of stuckJobs) {
    if (Date.now() - job.processedOn > 60000) {
      // If job has been processing for more than 1 minute
      await job.moveToFailed({ message: "Job stuck in active state" }, true);
      logger.info(`Moved stuck job ${job.id} to failed state`);
    }
  }
}

// Set up periodic job to clear stuck jobs
setInterval(clearStuckJobs, 60000); // Run every minute

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
    })
    .catch((error) => {
      logger.error("Failed to initialize rate limiter:", error);
      process.exit(1);
    });
} else {
  setupQueueProcessor();
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
