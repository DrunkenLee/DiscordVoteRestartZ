#!/bin/bash

# API Test Script for zomboid-discord-rcon
# Tests all exposed API endpoints

API_BASE="http://localhost:3000"

echo "🚀 Starting API Tests..."
echo "=================================================="

# Function to test API endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4

    echo ""
    echo "$description"
    echo "Request: $method $endpoint"

    if [ "$method" == "GET" ] || [ "$method" == "DELETE" ]; then
        curl -s -w "\nStatus: %{http_code}\n" -X $method "$API_BASE$endpoint"
    else
        curl -s -w "\nStatus: %{http_code}\n" -X $method "$API_BASE$endpoint" \
             -H "Content-Type: application/json" \
             -d "$data"
    fi
    echo ""
    echo "----------------------------------------"
}

echo ""
echo "🧪 Testing ZMUsers API..."

# Test GET all users
test_endpoint "GET" "/zmusers" "" "1. GET /zmusers - Get all users"

# Test POST - Create a new user
test_endpoint "POST" "/zmusers" '{
    "discordid": "test#1234",
    "steamid": "76561198000000000",
    "username1": "testuser",
    "password1": "testpass123",
    "extradata": {"test": true}
}' "2. POST /zmusers - Create new user"

# Get the user ID from the previous response (manual step)
echo ""
echo "NOTE: Please check the user ID from the previous response and update the following tests manually if needed."

# Test GET specific user (using ID 1 as example)
test_endpoint "GET" "/zmusers/1" "" "3. GET /zmusers/1 - Get specific user"

# Test PUT - Update user
test_endpoint "PUT" "/zmusers/1" '{
    "username1": "updateduser",
    "username2": "seconduser"
}' "4. PUT /zmusers/1 - Update user"

# Test GET non-existent user
test_endpoint "GET" "/zmusers/999999" "" "5. GET /zmusers/999999 - Get non-existent user"

echo ""
echo "🏺 Testing Player Auctions API..."

# Test GET all auctions
test_endpoint "GET" "/player-auctions" "" "1. GET /player-auctions - Get all auctions"

# Test POST - Create a new auction
test_endpoint "POST" "/player-auctions" '{
    "sellerid": 1,
    "itemname": "Baseball Bat",
    "itemdesc": "A sturdy wooden baseball bat with some wear",
    "itemprice": 150.50,
    "status": "active"
}' "2. POST /player-auctions - Create new auction"

# Test GET specific auction
test_endpoint "GET" "/player-auctions/1" "" "3. GET /player-auctions/1 - Get specific auction"

# Test PUT - Update auction
test_endpoint "PUT" "/player-auctions/1" '{
    "lastbid": 200.00,
    "status": "bidding"
}' "4. PUT /player-auctions/1 - Update auction"

# Test GET non-existent auction
test_endpoint "GET" "/player-auctions/999999" "" "5. GET /player-auctions/999999 - Get non-existent auction"

echo ""
echo "❌ Testing Error Handling..."

# Test POST with invalid data
test_endpoint "POST" "/zmusers" '{
    "discordid": "invalid"
}' "1. POST /zmusers - Invalid data (missing required fields)"

# Test POST auction with invalid seller ID
test_endpoint "POST" "/player-auctions" '{
    "sellerid": 999999,
    "itemname": "Test Item",
    "itemprice": 100,
    "status": "active"
}' "2. POST /player-auctions - Invalid seller ID"

# Test PUT on non-existent resource
test_endpoint "PUT" "/zmusers/999999" '{
    "username1": "test"
}' "3. PUT /zmusers/999999 - Update non-existent user"

echo ""
echo "=================================================="
echo "✅ All API tests completed!"
echo ""
echo "NOTE: To clean up test data, you may want to delete test records:"
echo "curl -X DELETE $API_BASE/zmusers/1"
echo "curl -X DELETE $API_BASE/player-auctions/1"
