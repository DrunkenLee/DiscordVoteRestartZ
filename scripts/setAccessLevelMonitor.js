import { RconClient } from '../src/rcon/client.js';
import config from '../src/config/config.js';
import logger from '../src/utils/logger.js';

/**
 * Parse the "players" command response to extract player usernames
 * Example response format:
 * Players connected (3):
 * 1. "Mono" (id=12345)
 * 2. "NenekLincah" (id=67890)
 */
function parsePlayersResponse(response) {
    const players = [];
    const lines = response.split('\n');

    for (const line of lines) {
        // Match pattern: number. "username" (id=...)
        const match = line.match(/^\d+\.\s+"([^"]+)"/);
        if (match && match[1]) {
            players.push(match[1]);
        }
    }

    return players;
}

/**
 * Main function to fetch players and set their access levels
 */
async function setAccessLevelsForOnlinePlayers() {
    let rconClient = null;

    try {
        logger.info('[Access Level Monitor] Starting access level check...');

        // Connect to RCON
        rconClient = new RconClient(
            config.rcon.host,
            config.rcon.port,
            config.rcon.password
        );

        await rconClient.connect();

        // Get list of online players
        logger.info('[Access Level Monitor] Fetching online players...');
        const playersResponse = await rconClient.send('players');

        // Parse the response to get player usernames
        const players = parsePlayersResponse(playersResponse);
        logger.info(`[Access Level Monitor] Found ${players.length} online players`);

        if (players.length === 0) {
            logger.info('[Access Level Monitor] No players online, skipping access level updates');
            return;
        }

        // Set access level for each player
        let successCount = 0;
        let failCount = 0;

        for (const username of players) {
            try {
                const command = `setaccesslevel "${username}" user`;
                logger.info(`[Access Level Monitor] Executing: ${command}`);
                await rconClient.send(command);
                successCount++;

                // Small delay between commands to avoid overwhelming the server
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                logger.error(`[Access Level Monitor] Failed to set access level for ${username}:`, error.message);
                failCount++;
            }
        }

        logger.info(`[Access Level Monitor] Completed: ${successCount} successful, ${failCount} failed`);

    } catch (error) {
        logger.error('[Access Level Monitor] Error:', error.message);
    } finally {
        // Always disconnect
        if (rconClient) {
            try {
                await rconClient.disconnect();
            } catch (error) {
                logger.error('[Access Level Monitor] Error disconnecting:', error.message);
            }
        }
    }
}

/**
 * Start the monitor with a 5-minute interval
 */
function startMonitor() {
    const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes in milliseconds

    logger.info('[Access Level Monitor] Starting monitor...');
    logger.info(`[Access Level Monitor] Will run every ${INTERVAL_MS / 1000} seconds`);

    // Run immediately on start
    setAccessLevelsForOnlinePlayers();

    // Then run every 5 minutes
    setInterval(() => {
        setAccessLevelsForOnlinePlayers();
    }, INTERVAL_MS);
}

// Start the monitor if this script is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    startMonitor();
}

export { setAccessLevelsForOnlinePlayers, startMonitor };
