import { Rcon } from 'rcon-client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const RCON_HOST = process.env.RCON_HOST;
const RCON_PORT = parseInt(process.env.RCON_PORT);
const RCON_PASSWORD = process.env.RCON_PASSWORD;

console.log('=== RCON Connection Test ===');
console.log(`Host: ${RCON_HOST}`);
console.log(`Port: ${RCON_PORT}`);
console.log(`Password: ${RCON_PASSWORD ? '***' + RCON_PASSWORD.slice(-4) : 'NOT SET'}`);
console.log('');

async function testRconConnection() {
    let client = null;

    try {
        console.log('Attempting to connect...');

        client = await Rcon.connect({
            host: RCON_HOST,
            port: RCON_PORT,
            password: RCON_PASSWORD,
            timeout: 10000
        });

        console.log('✅ Successfully connected to RCON!');
        console.log('');

        // Test sending a command
        console.log('Testing command: servermsg "RCON Test"');
        const response = await client.send('servermsg "RCON Test"');
        console.log('Command response:', response);
        console.log('');

        // Get server info
        console.log('Getting players list...');
        const players = await client.send('players');
        console.log('Players response:', players);

    } catch (error) {
        console.error('❌ RCON connection failed!');
        console.error('Error type:', error.constructor.name);
        console.error('Error message:', error.message);
        console.error('');
        console.error('Full error:', error);

        if (error.code) {
            console.error('Error code:', error.code);
        }

        process.exit(1);
    } finally {
        if (client) {
            console.log('');
            console.log('Disconnecting...');
            await client.end();
            console.log('Disconnected.');
        }
    }
}

testRconConnection();
