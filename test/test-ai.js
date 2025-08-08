import aiAssistant from '../src/ai/assistant.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testAIAssistant() {
  console.log('🧪 Testing AI Assistant...\n');

  console.log('📋 AI Configuration:');
  console.log(`- Enabled: ${aiAssistant.isEnabled()}`);
  console.log(`- API Key: ${aiAssistant.apiKey ? '***' + aiAssistant.apiKey.slice(-4) : 'Not set'}`);
  console.log(`- Model: ${aiAssistant.model}`);
  console.log(`- Max Tokens: ${aiAssistant.maxTokens}`);
  console.log(`- Temperature: ${aiAssistant.temperature}\n`);

  // Test knowledge base search directly first
  console.log('🔍 Testing Knowledge Base Search directly:\n');

  const directSearchTests = [
    'rcon',
    'command apa tersedia',
    'bagaimana restart server',
    'tips survival',
    'tidak bisa connect',
    'lag',
    'battlemetrics'
  ];

  for (const search of directSearchTests) {
    const result = aiAssistant.searchKnowledgeBase(search);
    console.log(`Direct search "${search}": ${result || 'No result found'}`);
  }

  console.log('\n─'.repeat(80));

  // Test questions
  const testQuestions = [
    'apa itu RCON?',
    'bagaimana cara restart server?',
    'command apa saja yang tersedia?',
    'tips bertahan hidup di Project Zomboid',
    'saya tidak bisa connect ke server',
    'game saya lag, kenapa ya?'
  ];

  console.log('\n🔍 Testing Full AI Response:\n');

  for (const question of testQuestions) {
    console.log(`Q: ${question}`);

    try {
      const response = await aiAssistant.generateResponse(question);
      console.log(`A: ${response}`);
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }

    console.log('─'.repeat(50));
  }

  console.log('\n✅ Testing completed!');
}

// Run the test
testAIAssistant().catch(console.error);
