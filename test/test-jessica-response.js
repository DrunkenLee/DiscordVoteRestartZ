import aiAssistant from '../src/ai/assistant.js';

async function testJessicaResponse() {
  console.log('🧪 Testing: apa itu jessica supply run\n');

  try {
    const response = await aiAssistant.generateResponse('apa itu jessica supply run');

    console.log('Response type:', Array.isArray(response) ? 'Array' : 'String');
    console.log('Response:');

    if (Array.isArray(response)) {
      response.forEach((msg, i) => {
        console.log(`\n--- Message ${i + 1} ---`);
        console.log(msg);
      });
    } else {
      console.log(response);
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

testJessicaResponse();
