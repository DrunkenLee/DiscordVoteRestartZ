import knowledgeLoader from '../src/ai/knowledgeLoader.js';
import aiAssistant from '../src/ai/assistant.js';

async function testMultiMessage() {
  console.log('🧪 Testing Multi-Message Response System\n');

  try {
    // Load knowledge base
    await knowledgeLoader.loadAllKnowledgeBases();
    console.log('✅ Knowledge base loaded\n');

    // Test search for enchantment system
    const testQueries = [
      'Sistem Enchantment Senjata',
      'enchantment',
      'mystic orb',
      'cara enchant senjata'
    ];

    for (const query of testQueries) {
      console.log(`🔍 Testing query: "${query}"`);
      console.log('─'.repeat(50));

      const response = await aiAssistant.generateResponse(query);

      if (Array.isArray(response)) {
        console.log(`📄 Multi-message response (${response.length} parts):`);
        response.forEach((msg, i) => {
          console.log(`\n--- Part ${i + 1} (${msg.length} chars) ---`);
          console.log(msg);
        });
      } else {
        console.log(`📄 Single message response (${response.length} chars):`);
        console.log(response);
      }

      console.log('\n' + '='.repeat(60) + '\n');
    }

  } catch (error) {
    console.error('❌ Error in test:', error);
  }
}

testMultiMessage();
