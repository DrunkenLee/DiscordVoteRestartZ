import aiAssistant from '../ai/assistant.js';
import config from '../config/config.js';

export const pingCommand = {
  name: 'ping',
  description: 'Replies with Pong!',
  execute(message) {
    message.channel.send('Pong!');
  },
};

export const echoCommand = {
  name: 'echo',
  description: 'Replies with the message you send.',
  execute(message, args) {
    const response = args.join(' ') || 'You didn\'t provide a message!';
    message.channel.send(response);
  },
};

export const askCommand = {
  name: 'ask',
  description: 'Ask AI assistant about server features, commands, or gameplay',
  aliases: ['tanya', 'bantuan'],
  async execute(message, args) {
    // Check if message is in the designated AI channel
    const aiChannelId = config.get('discord.aiChannelId');
    if (message.channel.id !== aiChannelId) {
      const aiChannel = message.guild.channels.cache.get(aiChannelId);
      const channelMention = aiChannel ? `<#${aiChannelId}>` : `channel dengan ID ${aiChannelId}`;

      return message.channel.send(
        `🤖 **AI Assistant hanya tersedia di ${channelMention}**\n\n` +
        `Silakan gunakan command AI di channel tersebut untuk mendapatkan bantuan tentang server dan gameplay.`
      );
    }

    if (args.length === 0) {
      return message.channel.send('❓ **Cara menggunakan**: `!ask [pertanyaan]` atau `!tanya [pertanyaan]`\n\nContoh:\n- `!ask bagaimana cara restart server?`\n- `!tanya apa itu RCON?`\n- `!ask command apa saja yang tersedia?`');
    }

    const question = args.join(' ');

    // Tampilkan typing indicator
    await message.channel.sendTyping();

    try {
      const response = await aiAssistant.generateResponse(question, {
        userId: message.author.id,
        userName: message.author.username,
        channelId: message.channel.id
      });

      // Send response(s) - can be single string or array of strings
      if (Array.isArray(response)) {
        for (let i = 0; i < response.length; i++) {
          await message.channel.send(response[i]);
          // Add small delay between multiple messages
          if (i < response.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      } else {
        await message.channel.send(response);
      }
    } catch (error) {
      console.error('Error in ask command:', error);
      message.channel.send('❌ Maaf, terjadi kesalahan saat memproses pertanyaan Anda. Silakan coba lagi nanti.');
    }
  },
};

export const helpCommand = {
  name: 'help',
  description: 'Shows available commands',
  aliases: ['bantuan', 'commands'],
  execute(message) {
    const helpText = `📋 **Daftar Command Bot**

🏓 **Basic Commands**
\`!ping\` - Cek status bot
\`!echo [pesan]\` - Bot mengulangi pesan

🤖 **AI Assistant**
\`!ask [pertanyaan]\` - Tanya AI tentang server/gameplay
\`!tanya [pertanyaan]\` - Alias untuk !ask

❓ **Help & Info**
\`!help\` - Tampilkan pesan ini
\`!commands\` - Alias untuk !help

Project Zomboid Discord Bot`;

    message.channel.send(helpText);
  },
};

// Add more commands as needed
export const commands = [pingCommand, echoCommand, askCommand, helpCommand];