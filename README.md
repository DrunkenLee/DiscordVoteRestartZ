# Zomboid Discord RCON

## Overview
Zomboid Discord RCON is a Node.js application that integrates Project Zomboid's RCON (Remote Console) with Discord. This project allows you to manage your Project Zomboid server directly from a Discord channel, enabling seamless interaction and command execution.

## Features
- 🎮 Connects to a Project Zomboid server via RCON
- 🤖 **AI Assistant** - Menjawab pertanyaan players tentang server dan gameplay
- 💬 Responds to commands issued in a Discord channel
- 📊 Integration with BattleMetrics for server statistics
- 🔄 Automated restart and update checking
- 📝 Comprehensive logging for debugging and monitoring
- ⚙️ Configurable settings for easy setup
- 👥 Whitelist management system
- 🏆 Killboard and playtime tracking

## AI Assistant Feature 🤖
Bot dilengkapi dengan AI assistant yang dapat membantu players dengan:
- **Server Commands**: Penjelasan tentang command yang tersedia
- **Gameplay Tips**: Tips bertahan hidup di Project Zomboid
- **Troubleshooting**: Solusi untuk masalah umum
- **Server Features**: Informasi tentang fitur-fitur server

### 🎯 Channel Khusus AI
AI Assistant hanya aktif di channel tertentu untuk pengalaman yang lebih terfokus:
- **Channel ID**: `1403231225430413383`
- **Auto-Response**: Bot merespon otomatis tanpa perlu command prefix
- **Command Mode**: Gunakan `!ask` atau `!tanya` untuk pertanyaan spesifik

### Cara Menggunakan AI Assistant
```
# Di AI Channel - Auto Response (tanpa prefix)
apa itu ZM menu?
bagaimana cara membuka shop?
siapa itu Doc Jessica?

# Di AI Channel - Command Mode (dengan prefix)
!ask [pertanyaan]     - Bertanya kepada AI assistant
!tanya [pertanyaan]   - Alias untuk !ask

# Di Channel Lain
!help                 - Menampilkan daftar command
# (AI commands akan redirect ke AI channel)
```

**Contoh Pertanyaan:**
- `apa itu rat way?`
- `bagaimana cara restart server?`
- `tips bertahan hidup di zomboid`
- `!ask apa itu tier system?`
- `jelaskan sistem enchantment senjata` (akan dijawab dengan multiple messages jika panjang)

**Multi-Message Support:**
- Untuk konten panjang (>1900 karakter), AI akan otomatis membagi response menjadi beberapa pesan
- Setiap pesan lanjutan ditandai dengan "(lanjutan)"
- Sumber informasi ditampilkan di pesan terakhir

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/zomboid-discord-rcon.git
   ```

2. Navigate to the project directory:
   ```
   cd zomboid-discord-rcon
   ```

3. Install the dependencies:
   ```
   npm install
   ```

4. Create a `.env` file based on the `.env.example` file and fill in your credentials:
   ```bash
   # Required
   DISCORD_BOT_TOKEN=your_discord_bot_token
   RCON_HOST=your_rcon_host
   RCON_PORT=27015
   RCON_PASSWORD=your_rcon_password

   # Optional - AI Assistant
   AI_API_KEY=your_openai_api_key
   AI_ENABLED=true
   ```

## Usage

1. Start the application:
   ```
   npm start
   ```

2. The bot will log in to Discord and connect to the RCON server. You can now issue commands in the designated Discord channel.

## Available Commands

### General Commands
- `!ping` - Check bot response time
- `!players` - Show online players
- `!help` - Show all available commands
- `!ask [question]` - Ask AI assistant (NEW!)

### Server Management
- `!restart` - Initiate server restart (requires confirmations)
- `!checkupdate` - Check for mod updates
- `!serverinfo` - Display server information

### Statistics
- `!killboard` - Top 10 kill leaderboard
- `!topplaytime` - Top 10 players by playtime

### Admin Commands
- `!adduser <username> <password>` - Add user to whitelist
- `!removeuserfromwhitelist <username>` - Remove from whitelist
- `!devmode` - Toggle development mode

## Configuration

### Environment Variables
Configuration is handled through environment variables in `.env` file:

```bash
# Discord Configuration
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_PREFIX=!

# RCON Configuration
RCON_HOST=localhost
RCON_PORT=27015
RCON_PASSWORD=your_rcon_password

# AI Assistant (Optional)
AI_API_KEY=your_openai_api_key
AI_MODEL=gpt-3.5-turbo
AI_ENABLED=true

# Other configurations...
```

### AI Assistant Setup
1. Dapatkan API key dari [OpenAI](https://platform.openai.com/api-keys)
2. Tambahkan `AI_API_KEY` ke file `.env`
3. Set `AI_ENABLED=true`
4. Restart bot

Jika AI tidak tersedia, bot akan tetap berfungsi dengan knowledge base lokal.

## File Structure
```
src/
├── ai/
│   └── assistant.js      # AI Assistant logic
├── config/
│   ├── config.js         # Configuration management
│   └── constants.js      # Application constants
├── discord/
│   ├── bot.js           # Main Discord bot logic
│   ├── commands.js      # Command definitions
│   └── events.js        # Event handlers
├── rcon/
│   ├── client.js        # RCON client
│   └── parser.js        # Response parser
└── utils/
    ├── battlemetrics.js # BattleMetrics integration
    ├── helpers.js       # Utility functions
    ├── logger.js        # Logging system
    └── ...
```

## Contributing

Contributions are welcome! Please submit a pull request or open an issue for any enhancements or bug fixes.

### Development Setup
1. Fork the repository
2. Create feature branch: `git checkout -b feature/ai-assistant`
3. Make changes and test thoroughly
4. Submit pull request

## License

This project is licensed under the ISC License. See the LICENSE file for more details.

## Support

Untuk bantuan dan pertanyaan:
- Gunakan AI assistant: `!ask [pertanyaan]`
- Buka issue di GitHub
- Contact admin di Discord server