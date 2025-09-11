# Whitelist Command Space Handling Fix

## Problem Description
The `!whitelistrequest` command was incorrectly parsing usernames that contain spaces. For example:

```
!whitelistrequest 76545865897456412 My Name password123
```

Was being parsed as:
- SteamID: `76545865897456412`
- Username: `My` (incorrect!)
- Password: `Name` (incorrect!)

This caused usernames to be truncated and passwords to be set incorrectly in the database.

## Solution Implemented
Modified the parsing logic in `src/discord/bot.js` to handle usernames with spaces properly:

### Old Logic (Broken)
```javascript
const [steamid, username1, password1] = args;
```

### New Logic (Fixed)
```javascript
const steamid = args[0];                        // First argument: SteamID
const password1 = args[args.length - 1];        // Last argument: Password
const username1 = args.slice(1, -1).join(' '); // Everything in between: Username
```

## How It Works Now

### Command Format
```
!whitelistrequest <steamid> <username> <password>
```

### Examples That Now Work Correctly

1. **Single word username:**
   ```
   !whitelistrequest 76561198000000000 SingleName password123
   ```
   - SteamID: `76561198000000000`
   - Username: `SingleName`
   - Password: `password123`

2. **Username with spaces:**
   ```
   !whitelistrequest 76561198000000000 My Name password123
   ```
   - SteamID: `76561198000000000`
   - Username: `My Name`
   - Password: `password123`

3. **Username with multiple spaces:**
   ```
   !whitelistrequest 76561198000000000 My Game Name With Spaces password123
   ```
   - SteamID: `76561198000000000`
   - Username: `My Game Name With Spaces`
   - Password: `password123`

## Validation Added
- Ensures SteamID is valid (17 digits)
- Ensures username is not empty after parsing
- Provides better error messages with examples

## Updated Help Messages
The `!help` command now includes an example for usernames with spaces:

```
3. For usernames with spaces: !whitelistrequest 76561198000000000 My Game Name MyPassword
```

## Testing
A test script (`test/test-whitelist-parsing.js`) has been created to verify the parsing logic works correctly for various scenarios.

## Files Modified
- `src/discord/bot.js` - Updated whitelistrequest command parsing and help messages
- `test/test-whitelist-parsing.js` - New test script for validation

## Backward Compatibility
This fix is fully backward compatible. All existing single-word usernames continue to work exactly as before, while usernames with spaces now work correctly.
