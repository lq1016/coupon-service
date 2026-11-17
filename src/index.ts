import config from './config/index.js';
import { createApp } from './app.js';
import { startExpireScanner } from './jobs/expireScanner.js';

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  console.log(`[coupon-service] listening on http://${config.host}:${config.port}`);
  console.log(`[coupon-service] health: http://localhost:${config.port}/api/health`);
  startExpireScanner(config.expireScanIntervalMs);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
