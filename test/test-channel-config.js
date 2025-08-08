import config from '../src/config/config.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

function testChannelConfiguration() {
  console.log('🧪 Testing AI Channel Configuration...\n');

  // Test configuration loading
  console.log('📋 Configuration Check:');
  console.log(`- Discord Token: ${config.get('discord.token') ? '***' + config.get('discord.token').slice(-4) : 'Not set'}`);
  console.log(`- Discord Prefix: ${config.get('discord.prefix')}`);
  console.log(`- AI Channel ID: ${config.get('discord.aiChannelId')}`);
  console.log(`- AI Enabled: ${config.get('ai.enabled')}`);
  console.log(`- AI API Key: ${config.get('ai.apiKey') ? '***' + config.get('ai.apiKey').slice(-4) : 'Not set'}\n`);

  // Validate channel ID format
  const aiChannelId = config.get('discord.aiChannelId');
  const isValidChannelId = /^\d{17,20}$/.test(aiChannelId);

  console.log('🔍 Channel ID Validation:');
  console.log(`- Channel ID: ${aiChannelId}`);
  console.log(`- Valid Format: ${isValidChannelId ? '✅' : '❌'}`);
  console.log(`- Length: ${aiChannelId.length} characters`);

  if (!isValidChannelId) {
    console.log('❌ Invalid Discord Channel ID format!');
    console.log('   Discord Channel IDs should be 17-20 digits long.');
    return false;
  }

  console.log('\n🎯 Expected Behavior:');
  console.log(`1. AI Commands (!ask, !tanya) only work in channel ${aiChannelId}`);
  console.log('2. Auto-response to any message in AI channel (without command prefix)');
  console.log('3. Other channels will get redirect message to AI channel');
  console.log('4. Cooldown: 30 seconds for auto-responses, 2 minutes for commands');

  console.log('\n📝 Usage Examples:');
  console.log('In AI Channel:');
  console.log('  User: "apa itu ZM menu?"');
  console.log('  Bot: [Auto-response with AI Assistant embed]');
  console.log('');
  console.log('  User: "!ask bagaimana cara restart server?"');
  console.log('  Bot: [Command response with AI Assistant embed]');
  console.log('');
  console.log('In Other Channels:');
  console.log('  User: "!ask apa itu RCON?"');
  console.log('  Bot: "🤖 AI Assistant hanya tersedia di #ai-channel"');

  console.log('\n✅ Configuration test completed!');
  return true;
}

// Mock message simulation
function simulateChannelBehavior() {
  console.log('\n🎭 Simulating Channel Behavior...\n');

  const aiChannelId = config.get('discord.aiChannelId');
  const scenarios = [
    {
      channelId: aiChannelId,
      message: '!ask apa itu ZM menu?',
      expected: 'AI Command Response in AI Channel'
    },
    {
      channelId: aiChannelId,
      message: 'bagaimana cara membuka shop?',
      expected: 'Auto AI Response in AI Channel'
    },
    {
      channelId: '123456789012345678', // Different channel
      message: '!ask apa itu RCON?',
      expected: 'Redirect to AI Channel'
    },
    {
      channelId: '123456789012345678', // Different channel
      message: 'hello bot',
      expected: 'No Response (not AI channel, no command)'
    }
  ];

  for (const scenario of scenarios) {
    console.log(`Channel: ${scenario.channelId === aiChannelId ? 'AI Channel' : 'Other Channel'}`);
    console.log(`Message: "${scenario.message}"`);
    console.log(`Expected: ${scenario.expected}`);
    console.log('─'.repeat(50));
  }

  console.log('\n✅ Simulation completed!');
}

// Run tests
console.log('🤖 AI Channel Configuration Test\n');
const configValid = testChannelConfiguration();

if (configValid) {
  simulateChannelBehavior();
} else {
  console.log('\n❌ Please fix configuration issues before proceeding.');
}
