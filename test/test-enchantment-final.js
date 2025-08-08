import aiAssistant from '../src/ai/assistant.js';

async function testEnchantmentQuery() {
  console.log('🧪 Final Test: Multi-Message for Enchantment System\n');

  const testQuery = 'jelaskan mengenai Sistem Enchantment Senjata';
  console.log(`Query: "${testQuery}"`);
  console.log('─'.repeat(60));

  try {
    const response = await aiAssistant.generateResponse(testQuery);

    if (Array.isArray(response)) {
      console.log(`✅ SUCCESS: Multi-message response (${response.length} parts)`);
      console.log(`📊 Character distribution:`);

      let totalChars = 0;
      response.forEach((msg, i) => {
        totalChars += msg.length;
        console.log(`   Part ${i + 1}: ${msg.length} chars`);
      });

      console.log(`📈 Total: ${totalChars} characters`);
      console.log(`📱 Average: ${Math.round(totalChars / response.length)} chars per message`);

      console.log('\n🔍 Message Content Preview:');
      response.forEach((msg, i) => {
        const preview = msg.substring(0, 100) + (msg.length > 100 ? '...' : '');
        console.log(`   Part ${i + 1}: ${preview}`);
      });

      console.log('\n✅ Multi-message system working correctly!');

    } else {
      console.log('❌ UNEXPECTED: Single message response');
      console.log(`Length: ${response.length} chars`);
      console.log('Preview:', response.substring(0, 200) + '...');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testEnchantmentQuery();
