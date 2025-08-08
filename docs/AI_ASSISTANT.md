# AI Assistant Feature

## Overview
Fitur AI Assistant memungkinkan players untuk bertanya tentang server, gameplay, commands, dan troubleshooting melalui Discord bot. AI akan memberikan jawaban yang informatif dan membantu berdasarkan knowledge base yang tersedia.

## Features

### 1. Command-based Q&A
- `!ask [pertanyaan]` atau `!tanya [pertanyaan]` - Bertanya kepada AI assistant
- `!help` atau `!bantuan` - Menampilkan daftar command yang tersedia

### 2. Multi-Layer Knowledge System
AI assistant memiliki sistem pengetahuan berlapis:

#### Layer 1: External Knowledge Base (Priority)
- **File markdown** di folder `Knowledgebases/`
- **Auto-indexed** saat bot startup
- **Server-specific features** dan tutorials
- **Frequently updated** content

#### Layer 2: Built-in Knowledge Base
- **Core server features**: RCON, Discord integration, BattleMetrics
- **Basic commands**: Bot commands dengan penjelasan
- **General gameplay**: Project Zomboid tips dan troubleshooting
- **Fallback knowledge** jika external tidak tersedia

#### Layer 3: AI Integration (Optional)
- **OpenAI GPT models** untuk pertanyaan complex
- **Contextual responses** berdasarkan conversation
- **Fallback** jika knowledge base tidak memiliki jawaban

### 3. Knowledge Topics
#### Server Features dari External Knowledge
- **ZM Menu System** - Interface dan navigasi
- **Shop & Trading** - Player-to-player commerce
- **Rat Way System** - Fast travel mechanism
- **Tier System** - Player progression dan ranks
- **Cosplay Items** - Cosmetic system dengan Raid Points
- **Enchantment System** - Weapon enhancement dengan Mystic Orb
- **Hazard Zones** - Radiation dan protection systems
- **Doc Jessica Services** - Medical services dan quests
- **Airdrop System** - Loot distribution mechanism
- **Duplicate Detection** - Anti-cheat systems

#### Built-in Knowledge
- **Commands**: Semua command bot yang tersedia dengan penjelasan
- **Troubleshooting**: Connection issues, lag, crashes, bans
- **Basic Gameplay**: Survival tips, multiplayer, mods, events

### 4. Intelligent Search Algorithm
- **Keyword matching** dengan server-specific terms
- **Phrase detection** untuk pertanyaan natural language
- **Scoring system** untuk relevance ranking
- **Context-aware** responses berdasarkan user intent

## Configuration

### Environment Variables
```bash
# AI Assistant Configuration
AI_API_KEY=your_openai_api_key_here
AI_MODEL=gpt-3.5-turbo
AI_MAX_TOKENS=150
AI_TEMPERATURE=0.7
AI_ENABLED=true
```

### Knowledge Base Setup
1. **Tambah file markdown** ke folder `Knowledgebases/`
2. **Restart bot** untuk load knowledge baru
3. **Test dengan command** `!ask [pertanyaan]`

## Usage Examples

### Server Features Questions
```
!ask apa itu ZM menu?
→ Menjelaskan ZM Menu system dan cara mengaksesnya

!tanya bagaimana cara membuka shop?
→ Tutorial step-by-step untuk player trading

!ask apa itu rat way?
→ Penjelasan fast travel system dan risikonya

!tanya bagaimana cara beli cosplay?
→ Guide untuk cosmetic system dengan Raid Points
```

### Gameplay Questions
```
!ask tips bertahan hidup di Project Zomboid
→ Basic survival strategies

!tanya bagaimana cara join server?
→ Whitelist process dan requirements

!ask apa itu tier system?
→ Player progression explanation
```

### Troubleshooting
```
!ask kenapa tidak bisa connect ke server?
→ Connection troubleshooting steps

!tanya game saya lag, apa penyebabnya?
→ Performance optimization tips

!ask saya kena ban, bagaimana cara appeal?
→ Appeal process dan contact information
```

## Response Priority System

### 1. External Knowledge Base (Highest Priority)
- **File-based content** dari `Knowledgebases/`
- **Server-specific information**
- **Regularly updated** dengan content baru
- **Response format**: `**FileName** + Content + *Source: filename.md*`

### 2. Built-in Knowledge Base
- **Hardcoded knowledge** dalam assistant.js
- **Core functionality** dan basic information
- **Response format**: `**Topic**: Description`

### 3. AI Integration (If enabled)
- **OpenAI API** untuk complex queries
- **Contextual understanding**
- **Response format**: Natural language response

### 4. Fallback Responses
- **Random friendly messages** jika tidak ada match
- **Redirect** ke admin atau help channels
- **Encouragement** untuk mencoba pertanyaan lain

## Knowledge Base Management

### Adding New Knowledge
```bash
# 1. Create new markdown file
touch Knowledgebases/NewFeature.md

# 2. Add content with proper formatting
# See KNOWLEDGE_BASE_GUIDE.md for details

# 3. Restart bot to load new knowledge
npm start

# 4. Test the new knowledge
!ask [pertanyaan tentang feature baru]
```

### Updating Existing Knowledge
```bash
# 1. Edit existing .md file
nano Knowledgebases/BasicFeature.md

# 2. Restart bot untuk reload
npm start

# 3. Test updated content
!ask [pertanyaan yang di-update]
```

### Knowledge Categories
1. **Server Features**: Unique server mechanics
2. **Gameplay Guides**: How-to tutorials
3. **Troubleshooting**: Problem solving
4. **Rules & Policies**: Server rules dan guidelines
5. **Events & Updates**: Temporary events dan announcements

## Performance Considerations

### Response Time
- **External Knowledge**: ~100-200ms (file read + processing)
- **Built-in Knowledge**: ~50ms (memory lookup)
- **AI API**: ~1-3 seconds (network + processing)
- **Fallback**: ~10ms (instant response)

### Memory Usage
- **Knowledge files**: ~1-5MB total (depends on content)
- **Indexed keywords**: ~100KB (in memory)
- **Search cache**: ~50KB (temporary)

### Rate Limiting
- **Bot cooldown**: 2 minutes per user per command
- **AI API limits**: Based on OpenAI tier
- **Knowledge search**: No limits (local processing)

## Security & Privacy

### Data Handling
- **No personal data** stored in knowledge base
- **No user query logging** (kecuali error logs)
- **API keys** secured in environment variables

### Content Safety
- **Knowledge base** controlled oleh admin
- **No user-generated content** in knowledge base
- **AI responses** filtered untuk inappropriate content

## Analytics & Monitoring

### Bot Statistics
```javascript
// Knowledge Base Stats
📊 Knowledge Base Statistics:
- BasicFeature: 9 sections, 32 keywords
- Tutorials: 34 sections, 15 keywords
- Total: 43 sections, 47 unique keywords

// Response Sources
📈 Response Sources (Last 100 queries):
- External Knowledge: 65%
- Built-in Knowledge: 25%
- AI Integration: 8%
- Fallback: 2%
```

### Error Tracking
- **Knowledge loading errors** logged dengan details
- **Search failures** tracked untuk improvement
- **AI API errors** handled gracefully dengan fallbacks

## Future Enhancements

### Version 2.0 Roadmap
1. **Hot-reload knowledge** tanpa restart bot
2. **Admin commands** untuk manage knowledge via Discord
3. **User feedback system** untuk improve responses
4. **Multi-language support** (Indonesian + English)
5. **Voice integration** untuk Discord voice channels
6. **Knowledge versioning** dengan Git integration
7. **Analytics dashboard** untuk admin monitoring
8. **Custom AI training** dengan server-specific data

### Integration Plans
1. **Webhook integration** untuk auto-update dari external sources
2. **Database integration** untuk dynamic content
3. **Player statistics** integration untuk personalized responses
4. **Event system** untuk temporary knowledge updates
5. **API endpoints** untuk external knowledge management

Sistem knowledge base ini memberikan flexibility maksimal untuk menambah dan update informasi server sesuai kebutuhan, sambil tetap maintain performance dan user experience yang baik!