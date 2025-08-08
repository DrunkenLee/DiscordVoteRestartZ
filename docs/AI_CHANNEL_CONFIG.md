# AI Assistant Channel Configuration

## 📋 Overview
AI Assistant telah dikonfigurasi untuk hanya bekerja di channel Discord tertentu untuk menghindari spam dan memberikan pengalaman yang lebih terfokus.

## 🎯 Channel yang Ditentukan
- **Channel ID**: `1403231225430413383`
- **Channel URL**: https://discord.com/channels/1341572597271236618/1403231225430413383

## 🔧 Konfigurasi

### Environment Variables
```bash
# AI Channel Configuration
AI_CHANNEL_ID=1403231225430413383
```

### Behavior dalam AI Channel
1. **Command Mode** - Dengan prefix `!`
   ```
   !ask apa itu ZM menu?
   !tanya bagaimana cara restart server?
   ```

2. **Auto-Response Mode** - Tanpa prefix
   ```
   apa itu rat way?
   bagaimana cara membuka shop?
   siapa itu Doc Jessica?
   ```

## 🚫 Behavior di Channel Lain

Jika user mencoba menggunakan AI commands di channel selain yang ditentukan:

```
User: !ask apa itu RCON?
Bot: 🤖 AI Assistant hanya tersedia di #ai-assistance

Silakan gunakan command AI di channel tersebut untuk mendapatkan bantuan tentang server dan gameplay.
```

## ⏱️ Cooldown System

### Command Cooldown (dengan prefix)
- **Durasi**: 2 menit per user
- **Berlaku**: Semua command bot
- **Exception**: Admin bebas cooldown

### Auto-Response Cooldown (tanpa prefix)
- **Durasi**: 30 detik per user
- **Berlaku**: Hanya di AI channel
- **Tujuan**: Mencegah spam auto-response

## 🎨 Response Format

### Command Response
```
[Jawaban dari knowledge base atau AI]
```

### Auto-Response
```
[Jawaban dari knowledge base atau AI]
```

## 📊 Message Filtering

### Pesan yang Direspon (Auto-Mode)
✅ **Akan direspon**:
- "apa itu ZM menu?"
- "bagaimana cara membuka shop?"
- "tips bertahan hidup"
- "cara restart server"

❌ **Tidak akan direspon**:
- "hi" (terlalu pendek)
- "😀👍" (hanya emoji)
- "<@bot_mention>" (hanya mention)
- "!!!" (hanya simbol)

### Algoritma Filtering
```javascript
// Skip jika pesan terlalu pendek
if (messageContent.length < 3) return;

// Skip jika hanya simbol/emoji
if (/^[!@#$%^&*()_+=\[\]{}|;':",./<>?`~\s]*$/.test(messageContent)) return;

// Skip jika hanya mention
if (/^<[@#&!][^>]*>+\s*$/.test(messageContent)) return;
```

## 🔄 Testing

### Test Configuration
```bash
node test/test-channel-config.js
```

### Manual Testing di Discord

#### 1. Test di AI Channel
```
# Command mode
!ask apa itu ZM menu?

# Auto-response mode
bagaimana cara membuka shop?
```

#### 2. Test di Channel Lain
```
# Harus dapat redirect message
!ask apa itu RCON?
```

#### 3. Test Cooldown
```
# Kirim 2 pesan berturut-turut di AI channel
apa itu rat way?
apa itu tier system?  # Harus skip karena cooldown
```

## 🛠️ Troubleshooting

### AI Tidak Merespon di Channel yang Benar
1. **Check Channel ID** di `.env`
2. **Restart bot** setelah update config
3. **Check bot permissions** di channel
4. **Verify AI is enabled** (`AI_ENABLED=true`)

### Auto-Response Tidak Bekerja
1. **Check message length** (minimal 3 karakter)
2. **Check cooldown** (30 detik per user)
3. **Check message format** (tidak boleh hanya emoji/simbol)
4. **Check console logs** untuk error

### Redirect Message Tidak Muncul
1. **Check bot permissions** untuk send messages
2. **Check channel exists** dan bot dapat access
3. **Check command format** (harus pakai prefix)

## 📈 Monitoring & Analytics

### Log yang Dapat Dimonitor
```javascript
// Successful AI responses
[INFO] AI Assistant responded to user123 in channel AI_CHANNEL

// Redirects from other channels
[INFO] AI command redirected: user123 tried !ask in WRONG_CHANNEL

// Cooldown triggers
[DEBUG] Auto-response cooldown active for user123

// Filtering triggers
[DEBUG] Message filtered out: too short/invalid format
```

### Usage Statistics
- **Total AI responses** per day
- **Command vs Auto-response** ratio
- **Most asked questions**
- **Channel redirect count**

## 🚀 Future Enhancements

### Planned Features
1. **Multiple AI Channels** - Support untuk beberapa channel
2. **Role-based Access** - AI untuk role tertentu saja
3. **Time-based Restrictions** - AI aktif pada jam tertentu
4. **Custom Responses** - Response berbeda per channel
5. **Analytics Dashboard** - Web interface untuk monitoring

### Configuration Options
```bash
# Multiple channels (future)
AI_CHANNEL_IDS=1403231225430413383,1234567890123456789

# Role restrictions (future)
AI_ALLOWED_ROLES=Member,VIP,Premium

# Time restrictions (future)
AI_ACTIVE_HOURS=08:00-22:00
AI_TIMEZONE=Asia/Jakarta
```

Dengan konfigurasi ini, AI Assistant akan memberikan pengalaman yang lebih terfokus dan terorganisir untuk users Anda! 🤖✨
