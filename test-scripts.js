// test-scripts.js

const axios = require("axios");
const assert = require("assert");

const API_URL = "http://localhost:3000/process-task";

// Utility function to sleep for a given number of milliseconds
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Test 1: Basic functionality
async function testBasicFunctionality() {
  console.log("Test 1: Basic functionality");
  const response = await axios.post(API_URL, { user_id: "1" });
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.data.message, "Task processed successfully");
  console.log("Test 1 passed");
}

// Test 2: Rate limiting (1 per second)
async function testRateLimitingPerSecond() {
  console.log("Test 2: Rate limiting (1 per second)");
  const userId = "2";
  const response1 = await axios.post(API_URL, { user_id: userId });
  const response2 = await axios.post(API_URL, { user_id: userId });

  assert.strictEqual(response1.data.message, "Task processed successfully");
  assert.strictEqual(response2.data.message, "Task queued for processing");

  await sleep(1100); // Wait for more than 1 second

  const response3 = await axios.post(API_URL, { user_id: userId });
  assert.strictEqual(response3.data.message, "Task processed successfully");

  console.log("Test 2 passed");
}

// Test 3: Rate limiting (20 per minute)
async function testRateLimitingPerMinute() {
  console.log("Test 3: Rate limiting (20 per minute)");
  const userId = "3";
  const results = [];

  for (let i = 0; i < 25; i++) {
    const response = await axios.post(API_URL, { user_id: userId });
    results.push(response.data.message);
    await sleep(100); // Small delay to avoid hitting the per-second rate limit
  }

  const processedCount = results.filter(
    (r) => r === "Task processed successfully"
  ).length;
  const queuedCount = results.filter(
    (r) => r === "Task queued for processing"
  ).length;

  console.log(`Processed: ${processedCount}, Queued: ${queuedCount}`);

  assert.strictEqual(
    processedCount,
    20,
    `Expected 20 processed tasks, but got ${processedCount}`
  );
  assert.strictEqual(
    queuedCount,
    5,
    `Expected 5 queued tasks, but got ${queuedCount}`
  );

  console.log("Test 3 passed");
}

// Test 4: Multiple users
async function testMultipleUsers() {
  console.log("Test 4: Multiple users");
  const users = ["4", "5", "6"];
  const promises = users.map((userId) =>
    axios.post(API_URL, { user_id: userId })
  );

  const responses = await Promise.all(promises);
  responses.forEach((response) => {
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.data.message, "Task processed successfully");
  });

  console.log("Test 4 passed");
}

// Test 5: Queue processing
async function testQueueProcessing() {
  console.log("Test 5: Queue processing");
  const userId = "7";
  const results = [];

  // Send 5 requests quickly
  for (let i = 0; i < 5; i++) {
    const response = await axios.post(API_URL, { user_id: userId });
    results.push(response.data.message);
  }

  assert.strictEqual(results[0], "Task processed successfully");
  assert.strictEqual(
    results.slice(1).every((r) => r === "Task queued for processing"),
    true
  );

  // Wait for the queue to process
  await sleep(5000);

  // Send another request
  const finalResponse = await axios.post(API_URL, { user_id: userId });
  assert.strictEqual(finalResponse.data.message, "Task processed successfully");

  console.log("Test 5 passed");
}

// Run all tests
async function runAllTests() {
  try {
    await testBasicFunctionality();
    // await testRateLimitingPerSecond();
    await testRateLimitingPerMinute();
    await testMultipleUsers();
    await testQueueProcessing();
    console.log("All tests passed successfully!");
  } catch (error) {
    console.error("Test failed:", error.message);
  }
}

runAllTests();
