# Node.js Task Queue API with Rate Limiting

This project implements a Node.js API cluster with user task queuing and rate limiting functionality. It addresses the requirements specified in the "Node Assignment: User Task Queuing with Rate Limiting" task.

## Features

- Node.js API cluster with two replica sets
- Rate limiting: 1 task per second and 20 tasks per minute per user ID
- Task queuing system for managing tasks exceeding rate limits
- Logging of task completions to a file
- Redis-based queueing between clusters
- Resilient to failures and edge cases

## Requirements

- Node.js (v14 or later recommended)
- Redis server

## Installation

1. Clone the repository:

   ```
   git clone https://github.com/NafiGit/node-task-queue-api.git
   cd node-task-queue-api
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Ensure Redis is installed and running on your system.

## Configuration

The application uses default configurations. If you need to modify any settings (e.g., Redis connection, rate limits), you can do so in the `app.js` file.

## Running the Application

To start the application, run:

```
node app.js
```

This will start two worker processes, listening on ports 3000 and 3001.

## API Usage

Send POST requests to `/process-task` with a JSON body containing a `user_id`:

```
POST http://localhost:3000/process-task
Content-Type: application/json

{
  "user_id": "123"
}
```

## Implementation Details

1. **Cluster Setup**: The application uses Node.js cluster module to create two worker processes, simulating two replica sets.

2. **Rate Limiting**: Implemented on a per-user basis, allowing 1 task per second and 20 tasks per minute for each user ID.

3. **Task Queuing**: Uses the `bull` library to queue tasks that exceed the rate limit. Queued tasks are processed as soon as the rate limit allows.

4. **Logging**: Task completions are logged to a `task.log` file in the project directory.

5. **Redis**: Used for inter-process communication and as a backend for the Bull queue.

6. **Error Handling**: The application includes basic error handling and logging for resilience.

## Testing

To test the application:

1. Start the application as described above.

2. Use a tool like cURL or Postman to send multiple POST requests to `http://localhost:3000/process-task` or `http://localhost:3001/process-task`.

3. Vary the `user_id` in your requests to test the per-user rate limiting.

4. Check the console output and the `task.log` file to verify task processing and rate limiting behavior.

## Assumptions and Design Decisions

1. In-memory storage is used for simplicity in tracking rate limits. For a production environment, consider using Redis for this as well.

2. The rate limit reset is implemented with a simple interval. For more precise timing, consider using a more sophisticated approach.

3. Error logging is minimal for this example. In a production environment, implement more robust error handling and logging.

4. The application assumes Redis is running on localhost with default settings. Adjust the Redis configuration as needed for your environment.

## Scalability and Future Improvements

- The current design can be easily scaled by increasing the number of worker processes.
- For higher availability, implement a load balancer in front of the worker processes.
- Consider implementing more sophisticated rate limiting algorithms for better fairness and efficiency.
- Implement monitoring and alerting for better observability in a production environment.

## Testing

This project includes a set of automated tests to verify the functionality of the API. To run the tests:

1. Ensure that the API is running (follow the "Running the Application" instructions above).

2. Install the additional testing dependency:
   ```
   npm install axios
   ```

3. Run the test scripts:
   ```
   node test-scripts.js
   ```

The test suite covers the following scenarios:

1. Basic functionality
2. Rate limiting (1 per second)
3. Rate limiting (20 per minute)
4. Multiple users
5. Queue processing

If all tests pass, you'll see "All tests passed successfully!" at the end of the output. If any test fails, an error message will be displayed, indicating which test failed and why.

These tests help ensure that the rate limiting, queueing, and task processing functionalities are working as expected. They can be expanded upon to cover more edge cases or additional features as needed.

## Conclusion

This implementation fulfills the requirements of the assignment, providing a scalable and efficient solution for task queuing with rate limiting. The code is organized for clarity and follows Node.js best practices. For any questions or issues, please open an issue in the repository.
