const Queue = require("bull");
const Redis = require("ioredis");

// Create Redis client (use the same configuration as in your main app)
const redisClient = new Redis({
  host: "localhost", // or your Redis host
  port: 6379, // default Redis port
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Create a Bull queue instance (use the same configuration as in your main app)
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

async function deleteActiveJobs() {
  try {
    // Get all active jobs
    const activeJobs = await taskQueue.getActive();
    console.log(`Found ${activeJobs.length} active jobs`);

    // Remove each active job
    for (const job of activeJobs) {
      await job.remove();
      console.log(`Removed job ${job.id}`);
    }

    console.log("All active jobs have been removed");
  } catch (error) {
    console.error("Error removing active jobs:", error);
  } finally {
    // Close the queue and Redis connections
    await taskQueue.close();
    await redisClient.quit();
  }
}

// Run the function
deleteActiveJobs();
