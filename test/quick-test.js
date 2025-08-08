import aiAssistant from '../src/ai/assistant.js';
import knowledgeLoader from '../src/ai/knowledgeLoader.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function quickTest() {
  console.log('🧪 Quick Test - Knowledge Base Integration...\n');

  // Initialize knowledge
  await knowledgeLoader.loadAllKnowledgeBases();
  await aiAssistant.initializeKnowledge();

  // Test specific questions
  const testQuestions = [
    'apa itu ZM menu?',
    'bagaimana cara membuka shop?',
    'apa itu rat way?',
    'siapa itu Doc Jessica?',
    'bagaimana cara beli cosplay?',
    'apa itu airdrop?',
    'bagaimana cara enchant weapon?',
    'apa itu mystic orb?'
  ];

  console.log('🔍 Testing Improved Knowledge Search:\n');

  for (const question of testQuestions) {
    console.log(`Q: ${question}`);

    try {
      const response = await aiAssistant.generateResponse(question);

      // Show first 150 characters
      const preview = response.substring(0, 150) + (response.length > 150 ? '...' : '');
      console.log(`A: ${preview}`);

      // Check source
      if (response.includes('Source:')) {
        console.log('   📄 ✅ Found in External Knowledge Base');
      } else if (response.startsWith('**') && !response.includes('Maaf') && !response.includes('Hmm')) {
        console.log('   🧠 ✅ Found in Built-in Knowledge Base');
      } else {
        console.log('   🤖 ❌ Using Fallback Response');
      }

    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }

    console.log('');
  }

  console.log('✅ Quick test completed!');
}

// Run the test
quickTest().catch(console.error);
