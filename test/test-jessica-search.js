import knowledgeLoader from '../src/ai/knowledgeLoader.js';

async function testJessicaSearch() {
  console.log('🧪 Testing Jessica Supply Run Search\n');

  try {
    await knowledgeLoader.loadAllKnowledgeBases();
    console.log('✅ Knowledge base loaded\n');

    // Test different variations of Jessica Supply Run query
    const testQueries = [
      'apa itu jessica supply run',
      'jessica supply run',
      'supply run jessica',
      'jesica supply run mission'
    ];

    for (const query of testQueries) {
      console.log(`🔍 Testing: "${query}"`);
      console.log('─'.repeat(50));

      const results = knowledgeLoader.searchKnowledge(query);

      if (results && results.length > 0) {
        console.log(`Found ${results.length} results:`);
        results.forEach((result, i) => {
          console.log(`\n${i + 1}. File: ${result.file}`);
          console.log(`   Section: ${result.section}`);
          console.log(`   Score: ${result.score}`);
          console.log(`   Content preview: ${result.content.substring(0, 150)}...`);
        });
      } else {
        console.log('❌ No results found');
      }

      console.log('\n' + '='.repeat(60) + '\n');
    }

    // Test the formatted response
    console.log('🔍 Testing formatted response for: "apa itu jessica supply run"');
    console.log('─'.repeat(50));
    const results = knowledgeLoader.searchKnowledge('apa itu jessica supply run');
    const formatted = knowledgeLoader.getFormattedResponse(results, 1900);

    if (Array.isArray(formatted)) {
      console.log(`✅ Multi-message response (${formatted.length} parts):`);
      formatted.forEach((msg, i) => {
        console.log(`\nMessage ${i + 1}:`);
        console.log(msg);
      });
    } else if (formatted) {
      console.log('✅ Single message response:');
      console.log(formatted);
    } else {
      console.log('❌ No formatted response');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testJessicaSearch();
