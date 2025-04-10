import { DiscordBot } from './discord/bot.js';
import { RconClient } from './rcon/client.js';
import config from './config/config.js';

const discordBot = new DiscordBot(config.discord.token);
const rconClient = new RconClient(config.rcon.host, config.rcon.port, config.rcon.password);

discordBot.login()
    .then(() => {
        console.log('Discord bot logged in successfully.');
        rconClient.connect()
            .then(() => {
                console.log('Connected to RCON server.');
                discordBot.setupEventListeners(rconClient);
            })
            .catch(err => {
                console.error('Failed to connect to RCON server:', err);
            });
    })
    .catch(err => {
        console.error('Failed to log in to Discord:', err);
    });