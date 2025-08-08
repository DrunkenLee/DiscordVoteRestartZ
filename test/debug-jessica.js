import knowledgeLoader from '../src/ai/knowledgeLoader.js';

async function debugJessica() {
  console.log('🔍 Debugging Jessica Section\n');

  try {
    await knowledgeLoader.loadAllKnowledgeBases();

    const results = knowledgeLoader.searchKnowledge('jessica supply run');

    if (results && results.length > 0) {
      const topResult = results[0];
      console.log('File:', topResult.file);
      console.log('Section:', topResult.section);
      console.log('Score:', topResult.score);
      console.log('\nRaw content length:', topResult.content.length);
      console.log('\nRaw content:');
      console.log('---START---');
      console.log(topResult.content);
      console.log('---END---');

      // Test formatted response
      const formatted = knowledgeLoader.getFormattedResponse(results, 1900);
      console.log('\nFormatted response:');
      if (Array.isArray(formatted)) {
        formatted.forEach((msg, i) => {
          console.log(`\nMessage ${i + 1}:`);
          console.log(msg);
        });
      } else {
        console.log(formatted);
      }
    } else {
      console.log('No results found');
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

debugJessica();
