import { sequelize } from '../src/models/index.js';
import { AuctionLogMonitor } from '../src/services/auctionLogMonitor.js';

async function run() {
  const monitor = new AuctionLogMonitor(null);
  try {
    console.log('[ManualScan] Connecting to database...');
    await sequelize.authenticate();
    console.log('[ManualScan] Database connected.');

    console.log('[ManualScan] Performing single auction log scan...');
    await monitor.manualScan();
    console.log('[ManualScan] Scan complete.');
  } catch (err) {
    console.error('[ManualScan] Error during manual scan:', err);
  } finally {
    try { await sequelize.close(); } catch {}
    // Give any pending log flushes a moment
    setTimeout(() => process.exit(0), 250);
  }
}

run();

