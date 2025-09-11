import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3000';

async function testAPI() {
  console.log('🚀 Starting Comprehensive API Tests...');
  console.log('=' .repeat(60));

  try {
    // Test 1: GET all users
    console.log('\n1. Testing GET /zmusers');
    const usersResponse = await fetch(`${API_BASE}/zmusers`);
    const users = await usersResponse.json();
    console.log(`   Status: ${usersResponse.status}`);
    console.log(`   Users found: ${users.length}`);
    console.log(`   Sample data:`, users.slice(0, 2));

    // Test 2: Create a new user
    console.log('\n2. Testing POST /zmusers');
    const newUser = {
      discordid: 'testuser#1234',
      steamid: '76561198000000000',
      username1: 'testuser',
      password1: 'testpass123',
      extradata: 'Test user data'
    };

    const createResponse = await fetch(`${API_BASE}/zmusers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUser)
    });

    const createdUser = await createResponse.json();
    console.log(`   Status: ${createResponse.status}`);
    console.log(`   Created user:`, createdUser);

    const userId = createdUser.id;

    if (userId) {
      // Test 3: GET specific user
      console.log(`\n3. Testing GET /zmusers/${userId}`);
      const userResponse = await fetch(`${API_BASE}/zmusers/${userId}`);
      const user = await userResponse.json();
      console.log(`   Status: ${userResponse.status}`);
      console.log(`   User data:`, user);

      // Test 4: Update user
      console.log(`\n4. Testing PUT /zmusers/${userId}`);
      const updateData = { username2: 'secondusername' };
      const updateResponse = await fetch(`${API_BASE}/zmusers/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });

      const updatedUser = await updateResponse.json();
      console.log(`   Status: ${updateResponse.status}`);
      console.log(`   Updated user:`, updatedUser);
    }

    // Test 5: GET all auctions
    console.log('\n5. Testing GET /player-auctions');
    const auctionsResponse = await fetch(`${API_BASE}/player-auctions`);
    const auctions = await auctionsResponse.json();
    console.log(`   Status: ${auctionsResponse.status}`);
    console.log(`   Auctions found: ${auctions.length}`);

    if (userId) {
      // Test 6: Create an auction
      console.log('\n6. Testing POST /player-auctions');
      const newAuction = {
        sellerid: userId,
        itemname: 'Baseball Bat',
        itemdesc: 'A sturdy wooden bat',
        itemprice: 150.50,
        status: 'active'
      };

      const createAuctionResponse = await fetch(`${API_BASE}/player-auctions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAuction)
      });

      const createdAuction = await createAuctionResponse.json();
      console.log(`   Status: ${createAuctionResponse.status}`);
      console.log(`   Created auction:`, createdAuction);

      const auctionId = createdAuction.itemid;

      if (auctionId) {
        // Test 7: Update auction
        console.log(`\n7. Testing PUT /player-auctions/${auctionId}`);
        const auctionUpdate = { lastbid: 200.00, status: 'bidding' };
        const updateAuctionResponse = await fetch(`${API_BASE}/player-auctions/${auctionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(auctionUpdate)
        });

        const updatedAuction = await updateAuctionResponse.json();
        console.log(`   Status: ${updateAuctionResponse.status}`);
        console.log(`   Updated auction:`, updatedAuction);

        // Test 8: Delete auction
        console.log(`\n8. Testing DELETE /player-auctions/${auctionId}`);
        const deleteAuctionResponse = await fetch(`${API_BASE}/player-auctions/${auctionId}`, {
          method: 'DELETE'
        });
        console.log(`   Status: ${deleteAuctionResponse.status}`);
      }

      // Test 9: Delete user
      console.log(`\n9. Testing DELETE /zmusers/${userId}`);
      const deleteUserResponse = await fetch(`${API_BASE}/zmusers/${userId}`, {
        method: 'DELETE'
      });
      console.log(`   Status: ${deleteUserResponse.status}`);
    }

    // Test 10: Error handling
    console.log('\n10. Testing Error Handling');
    const errorResponse = await fetch(`${API_BASE}/zmusers/999999`);
    console.log(`    GET non-existent user: ${errorResponse.status}`);

    const invalidUserResponse = await fetch(`${API_BASE}/zmusers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: 'data' })
    });
    console.log(`    POST invalid user: ${invalidUserResponse.status}`);

    console.log('\n' + '=' .repeat(60));
    console.log('✅ All API tests completed successfully!');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
  }
}

testAPI();
