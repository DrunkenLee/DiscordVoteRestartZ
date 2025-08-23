// Test script to verify whitelist command parsing logic
console.log('🧪 Testing Whitelist Command Parsing Logic\n');

function testWhitelistParsing(command) {
  console.log(`Input: "${command}"`);

  // Simulate how Discord.js splits the command
  const parts = command.split(' ');
  const commandName = parts[0].substring(1); // Remove the ! prefix
  const args = parts.slice(1);

  console.log(`Command: ${commandName}`);
  console.log(`Args array: [${args.map(arg => `"${arg}"`).join(', ')}]`);

  if (args.length < 3) {
    console.log('❌ Error: Not enough arguments');
    return;
  }

  // New parsing logic
  const steamid = args[0];
  const password1 = args[args.length - 1]; // Last argument is always password
  const username1 = args.slice(1, -1).join(' '); // Everything between steamid and password

  console.log(`Parsed SteamID: "${steamid}"`);
  console.log(`Parsed Username: "${username1}"`);
  console.log(`Parsed Password: "${password1}"`);

  // Validate
  const isValidSteamID = /^\d{17}$/.test(steamid);
  const isValidUsername = username1.trim() !== '';

  console.log(`Valid SteamID: ${isValidSteamID}`);
  console.log(`Valid Username: ${isValidUsername}`);

  if (isValidSteamID && isValidUsername) {
    console.log('✅ Parsing successful!');
  } else {
    console.log('❌ Parsing failed!');
  }

  console.log('─────────────────────────────────────────────────\n');
}

// Test cases
const testCases = [
  '!whitelistrequest 76561198000000000 SingleName password123',
  '!whitelistrequest 76561198000000000 My Name password123',
  '!whitelistrequest 76561198000000000 My Game Name With Spaces password123',
  '!whitelistrequest 76561198000000000 Player123 simplepass',
  '!whitelistrequest 76561198000000000 Another Player Name complex_password_123',
  '!whitelistrequest invalidsteamid My Name password123',
  '!whitelistrequest 76561198000000000 password123', // Missing username
  '!whitelistrequest 76561198000000000', // Missing username and password
];

testCases.forEach(testCase => {
  testWhitelistParsing(testCase);
});

console.log('🎯 Summary:');
console.log('- The new parsing logic handles usernames with spaces correctly');
console.log('- SteamID is always the first argument');
console.log('- Password is always the last argument');
console.log('- Username is everything in between (joined with spaces)');
console.log('- Validation ensures SteamID format and non-empty username');
