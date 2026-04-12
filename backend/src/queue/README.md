# BullMQ Queue Plan (Non-Breaking Adoption)

This project currently sends WhatsApp messages directly from the API process.

To preserve existing behavior, keep:

- `QUEUE_ENABLED=false`

## Why queue

A queue provides:

- controlled concurrency
- resilient retries across process restarts
- protection during traffic spikes
- better observability for failed jobs

## Recommended staged rollout

1. Deploy Redis + current backend (`QUEUE_ENABLED=false`)
2. Add BullMQ producer in `send-message` route (feature-flagged)
3. Add dedicated worker process that performs WhatsApp send
4. Enable `QUEUE_ENABLED=true` after worker is healthy

## Suggested queue settings

- queue name: `whatsapp-send`
- job attempts: `5`
- backoff: `exponential` with base delay `2000ms`
- removeOnComplete: keep last `1000` jobs
- removeOnFail: keep last `5000` jobs

## Producer example

```js
const { Queue } = require("bullmq");

const queue = new Queue(process.env.BULLMQ_QUEUE_NAME || "whatsapp-send", {
  connection: { url: process.env.REDIS_URL || "redis://redis:6379" },
});

await queue.add("send-whatsapp", payload, {
  attempts: 5,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
  jobId: payload.id || undefined,
});
```

## Worker example

```js
const { Worker } = require("bullmq");

const worker = new Worker(
  process.env.BULLMQ_QUEUE_NAME || "whatsapp-send",
  async (job) => {
    // Call existing sendMessageToWhatsApp logic here.
    // Keep the current validation and idempotency rules.
  },
  {
    connection: { url: process.env.REDIS_URL || "redis://redis:6379" },
    concurrency: 3,
  }
);

worker.on("failed", (job, err) => {
  // Log with Winston
});
```
