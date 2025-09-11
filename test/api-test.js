#!/usr/bin/env node

import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3000';

// Helper function to make API requests
async function apiRequest(method, endpoint, data = null) {
  const url = `${API_BASE}${endpoint}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  if (data) {
    options.body = JSON.stringify(data);
  }

  try {
    const response = await fetch(url, options);
    const result = {
      status: response.status,
      statusText: response.statusText,
      data: null
    };

    if (response.status !== 204) {
      try {
        result.data = await response.json();
      } catch (e) {
        result.data = await response.text();
      }
    }

    return result;
  } catch (error) {
    return {
      status: 'ERROR',
      statusText: error.message,
      data: null
    };
  }
}

// Test functions
async function testZMUsersAPI() {
  console.log('\n🧪 Testing ZMUsers API...\n');

  // Test GET all users
  console.log('1. GET /zmusers - Get all users');
  const getAllUsers = await apiRequest('GET', '/zmusers');
  console.log(`   Status: ${getAllUsers.status} ${getAllUsers.statusText}`);
  console.log(`   Data: ${JSON.stringify(getAllUsers.data, null, 2)}`);

  // Test POST - Create a new user
  console.log('\n2. POST /zmusers - Create new user');
  const newUser = {
    discordid: 'test#1234',
    steamid: '76561198000000000',
    username1: 'testuser',
    password1: 'testpass123',
    extradata: { test: true }
  };
  const createUser = await apiRequest('POST', '/zmusers', newUser);
  console.log(`   Status: ${createUser.status} ${createUser.statusText}`);
  console.log(`   Data: ${JSON.stringify(createUser.data, null, 2)}`);

  const userId = createUser.data?.userid;

  if (userId) {
    // Test GET specific user
    console.log(`\n3. GET /zmusers/${userId} - Get specific user`);
    const getUser = await apiRequest('GET', `/zmusers/${userId}`);
    console.log(`   Status: ${getUser.status} ${getUser.statusText}`);
    console.log(`   Data: ${JSON.stringify(getUser.data, null, 2)}`);

    // Test PUT - Update user
    console.log(`\n4. PUT /zmusers/${userId} - Update user`);
    const updateData = {
      username1: 'updateduser',
      username2: 'seconduser'
    };
    const updateUser = await apiRequest('PUT', `/zmusers/${userId}`, updateData);
    console.log(`   Status: ${updateUser.status} ${updateUser.statusText}`);
    console.log(`   Data: ${JSON.stringify(updateUser.data, null, 2)}`);

    // Test DELETE user
    console.log(`\n5. DELETE /zmusers/${userId} - Delete user`);
    const deleteUser = await apiRequest('DELETE', `/zmusers/${userId}`);
    console.log(`   Status: ${deleteUser.status} ${deleteUser.statusText}`);
    console.log(`   Data: ${JSON.stringify(deleteUser.data, null, 2)}`);
  }

  // Test GET non-existent user
  console.log('\n6. GET /zmusers/999999 - Get non-existent user');
  const getNonExistent = await apiRequest('GET', '/zmusers/999999');
  console.log(`   Status: ${getNonExistent.status} ${getNonExistent.statusText}`);
  console.log(`   Data: ${JSON.stringify(getNonExistent.data, null, 2)}`);
}

async function testPlayerAuctionsAPI() {
  console.log('\n🏺 Testing Player Auctions API...\n');

  // First, create a user to use as seller
  console.log('0. Creating test user for auction seller...');
  const testUser = {
    discordid: 'auctiontest#1234',
    steamid: '76561198000000001',
    username1: 'auctionseller',
    password1: 'testpass123'
  };
  const createSeller = await apiRequest('POST', '/zmusers', testUser);
  const sellerId = createSeller.data?.userid;
  console.log(`   Created user with ID: ${sellerId}`);

  // Test GET all auctions
  console.log('\n1. GET /player-auctions - Get all auctions');
  const getAllAuctions = await apiRequest('GET', '/player-auctions');
  console.log(`   Status: ${getAllAuctions.status} ${getAllAuctions.statusText}`);
  console.log(`   Data: ${JSON.stringify(getAllAuctions.data, null, 2)}`);

  if (sellerId) {
    // Test POST - Create a new auction
    console.log('\n2. POST /player-auctions - Create new auction');
    const newAuction = {
      sellerid: sellerId,
      itemname: 'Baseball Bat',
      itemdesc: 'A sturdy wooden baseball bat with some wear',
      itemprice: 150.50,
      status: 'active'
    };
    const createAuction = await apiRequest('POST', '/player-auctions', newAuction);
    console.log(`   Status: ${createAuction.status} ${createAuction.statusText}`);
    console.log(`   Data: ${JSON.stringify(createAuction.data, null, 2)}`);

    const auctionId = createAuction.data?.itemid;

    if (auctionId) {
      // Test GET specific auction
      console.log(`\n3. GET /player-auctions/${auctionId} - Get specific auction`);
      const getAuction = await apiRequest('GET', `/player-auctions/${auctionId}`);
      console.log(`   Status: ${getAuction.status} ${getAuction.statusText}`);
      console.log(`   Data: ${JSON.stringify(getAuction.data, null, 2)}`);

      // Test PUT - Update auction
      console.log(`\n4. PUT /player-auctions/${auctionId} - Update auction`);
      const updateData = {
        lastbid: 200.00,
        status: 'bidding'
      };
      const updateAuction = await apiRequest('PUT', `/player-auctions/${auctionId}`, updateData);
      console.log(`   Status: ${updateAuction.status} ${updateAuction.statusText}`);
      console.log(`   Data: ${JSON.stringify(updateAuction.data, null, 2)}`);

      // Test DELETE auction
      console.log(`\n5. DELETE /player-auctions/${auctionId} - Delete auction`);
      const deleteAuction = await apiRequest('DELETE', `/player-auctions/${auctionId}`);
      console.log(`   Status: ${deleteAuction.status} ${deleteAuction.statusText}`);
      console.log(`   Data: ${JSON.stringify(deleteAuction.data, null, 2)}`);
    }

    // Clean up - delete test user
    console.log(`\nCleanup: Deleting test user ${sellerId}`);
    await apiRequest('DELETE', `/zmusers/${sellerId}`);
  }

  // Test GET non-existent auction
  console.log('\n6. GET /player-auctions/999999 - Get non-existent auction');
  const getNonExistent = await apiRequest('GET', '/player-auctions/999999');
  console.log(`   Status: ${getNonExistent.status} ${getNonExistent.statusText}`);
  console.log(`   Data: ${JSON.stringify(getNonExistent.data, null, 2)}`);
}

async function testErrorHandling() {
  console.log('\n❌ Testing Error Handling...\n');

  // Test POST with invalid data
  console.log('1. POST /zmusers - Invalid data (missing required fields)');
  const invalidUser = { discordid: 'invalid' }; // Missing required fields
  const createInvalid = await apiRequest('POST', '/zmusers', invalidUser);
  console.log(`   Status: ${createInvalid.status} ${createInvalid.statusText}`);
  console.log(`   Data: ${JSON.stringify(createInvalid.data, null, 2)}`);

  // Test POST auction with invalid seller ID
  console.log('\n2. POST /player-auctions - Invalid seller ID');
  const invalidAuction = {
    sellerid: 999999, // Non-existent user
    itemname: 'Test Item',
    itemprice: 100,
    status: 'active'
  };
  const createInvalidAuction = await apiRequest('POST', '/player-auctions', invalidAuction);
  console.log(`   Status: ${createInvalidAuction.status} ${createInvalidAuction.statusText}`);
  console.log(`   Data: ${JSON.stringify(createInvalidAuction.data, null, 2)}`);

  // Test PUT on non-existent resource
  console.log('\n3. PUT /zmusers/999999 - Update non-existent user');
  const updateNonExistent = await apiRequest('PUT', '/zmusers/999999', { username1: 'test' });
  console.log(`   Status: ${updateNonExistent.status} ${updateNonExistent.statusText}`);
  console.log(`   Data: ${JSON.stringify(updateNonExistent.data, null, 2)}`);
}

// Main test runner
async function runAllTests() {
  console.log('🚀 Starting API Tests...');
  console.log('=' .repeat(50));

  try {
    await testZMUsersAPI();
    await testPlayerAuctionsAPI();
    await testErrorHandling();

    console.log('\n' + '=' .repeat(50));
    console.log('✅ All API tests completed!');

  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
  }
}

// Check if we can install node-fetch if not available
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Run tests
runAllTests().catch(console.error);
