import aiAssistant from '../src/ai/assistant.js';
import knowledgeLoader from '../src/ai/knowledgeLoader.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testKnowledgeIntegration() {
  console.log('🧪 Testing Knowledge Base Integration...\n');

  // Test loading knowledge bases
  console.log('📚 Loading Knowledge Bases...');
  const knowledge = await knowledgeLoader.loadAllKnowledgeBases();
  console.log(`Loaded files: ${Object.keys(knowledge).join(', ')}\n`);

  // Test questions about server features from knowledge base
  const testQuestions = [
    // Questions that should match external knowledge
    'apa itu ZM menu?',
    'bagaimana cara membuka shop?',
    'apa itu rat way?',
    'bagaimana cara clear corpse?',
    'apa itu tier system?',
    'bagaimana cara dapat raid points?',
    'apa itu hazard zone?',
    'siapa itu Doc Jessica?',
    'bagaimana cara beli cosplay?',
    'apa itu airdrop?',
    'bagaimana cara enchant weapon?',
    'apa itu mystic orb?',

    // Questions that should match built-in knowledge
    'apa itu RCON?',
    'bagaimana cara restart server?',
    'command apa saja yang tersedia?',

    // Questions that should not match anything
    'cuaca hari ini bagaimana?',
    'siapa presiden Indonesia?'
  ];

  console.log('🔍 Testing AI Assistant with Knowledge Base:\n');

  for (const question of testQuestions) {
    console.log(`Q: ${question}`);

    try {
      const response = await aiAssistant.generateResponse(question);
      console.log(`A: ${response.substring(0, 200)}${response.length > 200 ? '...' : ''}`);

      // Check source of answer
      if (response.includes('Source:')) {
        console.log('   📄 Source: External Knowledge Base');
      } else if (response.startsWith('**') && !response.includes('Maaf')) {
        console.log('   🧠 Source: Built-in Knowledge Base');
      } else {
        console.log('   🤖 Source: Fallback/AI');
      }

    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }

    console.log('─'.repeat(80));
  }

  console.log('\n✅ Testing completed!');

  // Test direct knowledge loader search
  console.log('\n🔍 Testing Direct Knowledge Loader Search:');

  const directSearchTests = [
    'shop',
    'tier',
    'radiation',
    'jessica',
    'cosplay',
    'enchantment'
  ];

  for (const searchTerm of directSearchTests) {
    const results = knowledgeLoader.searchKnowledge(searchTerm);
    console.log(`Search "${searchTerm}": ${results.length} results found`);

    if (results.length > 0) {
      const response = knowledgeLoader.getFormattedResponse(results, 150);
      console.log(`  → ${response?.substring(0, 100)}...`);
    }
  }

  console.log('\n📊 Knowledge Base Statistics:');
  for (const [fileName, data] of Object.entries(knowledge)) {
    console.log(`- ${fileName}: ${Object.keys(data.sections).length} sections, ${data.keywords.length} keywords`);
  }
}

// Run the test
testKnowledgeIntegration().catch(console.error);
