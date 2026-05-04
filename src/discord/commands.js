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
    void args;
    const aiChannelId = config.get('discord.aiChannelId');
    const aiChannel = message.guild?.channels?.cache?.get(aiChannelId);
    const channelMention = aiChannel ? `<#${aiChannelId}>` : 'channel AI';

    return message.channel.send(
      `🚫 Fitur AI di project ini sedang dinonaktifkan.\n` +
      `Auto-reply di ${channelMention} dan command !ask / !tanya / !bantuan sudah dimatikan.`
    );
  },
};

// Add more commands as needed
export const commands = [pingCommand, echoCommand, askCommand];