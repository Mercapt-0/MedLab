const config = require('./config');
const { createApp } = require('./app');
const { migrate } = require('./db/migrate');
const escalation = require('./services/escalation');

async function main() {
  await migrate(); // idempotent
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`MedLab API listening on http://localhost:${config.port}`);
    console.log(`Panic escalation: ack window ${config.panic.ackWindowSeconds}s, on-call window ${config.panic.onCallWindowSeconds}s`);
  });
  escalation.startScheduler();
}

main().catch((err) => {
  console.error('Failed to start MedLab API:', err.message);
  process.exit(1);
});
