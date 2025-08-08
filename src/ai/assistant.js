import config from '../config/config.js';
import logger from '../utils/logger.js';
import knowledgeLoader from './knowledgeLoader.js';

class AIAssistant {
  constructor() {
    this.apiKey = config.get('ai.apiKey');
    this.model = config.get('ai.model');
    this.maxTokens = config.get('ai.maxTokens');
    this.temperature = config.get('ai.temperature');
    this.enabled = config.get('ai.enabled');
    this.externalKnowledge = {};

    // Initialize external knowledge base
    this.initializeKnowledge();

    // Knowledge base tentang Project Zomboid dan server
    this.knowledgeBase = {
      features: {
        rcon: "RCON adalah fitur Remote Console yang memungkinkan admin mengontrol server dari jarak jauh",
        discord: "Bot Discord yang terintegrasi dengan server Project Zomboid untuk monitoring dan kontrol",
        battlemetrics: "Integrasi dengan BattleMetrics untuk statistik server dan player tracking",
        voting: "Sistem voting untuk restart server atau keputusan komunitas lainnya",
        logging: "Sistem logging untuk mencatat aktivitas server dan player"
      },
      commands: {
        "!ping": "Mengecek apakah bot masih aktif",
        "!echo": "Bot akan mengulangi pesan yang Anda kirim",
        "!status": "Melihat status server saat ini",
        "!players": "Melihat daftar player yang sedang online",
        "!restart": "Memulai voting untuk restart server",
        "!help": "Menampilkan daftar command yang tersedia"
      },
      gameplay: {
        survival: "Project Zomboid adalah game survival zombie dengan fokus pada crafting, building, dan bertahan hidup",
        multiplayer: "Server multiplayer mendukung co-op gameplay dengan teman-teman",
        mods: "Server mendukung berbagai mod untuk meningkatkan pengalaman bermain",
        events: "Server mengadakan event khusus dan challenges untuk komunitas"
      },
      troubleshooting: {
        connection: "Jika tidak bisa connect ke server, cek koneksi internet dan pastikan server online",
        lag: "Lag bisa disebabkan oleh koneksi internet, server load, atau terlalu banyak mod aktif. Coba restart game atau cek koneksi internet",
        crash: "Jika game crash, restart game dan cek log untuk error messages",
        banned: "Jika terbanned, hubungi admin melalui Discord untuk appeal",
        whitelist: "Untuk join server, gunakan command !whitelistrequest <steamid> <username> <password> di support ticket channel"
      }
    };
  }

  async initializeKnowledge() {
    try {
      this.externalKnowledge = await knowledgeLoader.loadAllKnowledgeBases();
      logger.info('External knowledge base loaded successfully');
    } catch (error) {
      logger.error('Failed to load external knowledge base:', error);
      this.externalKnowledge = {};
    }
  }

  isEnabled() {
    return this.enabled && this.apiKey;
  }

  async generateResponse(question, context = {}) {
    try {
      // 1. Cari di external knowledge base (file markdown) terlebih dahulu
      const externalAnswer = this.searchExternalKnowledge(question);
      if (externalAnswer) {
        return externalAnswer;
      }

      // 2. Cari jawaban dari knowledge base built-in
      const localAnswer = this.searchKnowledgeBase(question);
      if (localAnswer) {
        return localAnswer;
      }

      // 3. Jika AI diaktifkan dan tidak ada di knowledge base, gunakan AI
      if (this.isEnabled()) {
        return await this.callAI(question, context);
      }

      // 4. Jika AI tidak aktif dan tidak ada di knowledge base, gunakan fallback
      return this.getFallbackResponse(question);
    } catch (error) {
      logger.error('Error generating AI response:', error);
      return this.getFallbackResponse(question);
    }
  }

  searchExternalKnowledge(question) {
    try {
      const searchResults = knowledgeLoader.searchKnowledge(question);
      if (searchResults && searchResults.length > 0) {
        return knowledgeLoader.getFormattedResponse(searchResults, 1900);
      }
      return null;
    } catch (error) {
      logger.error('Error searching external knowledge:', error);
      return null;
    }
  }

  searchKnowledgeBase(question) {
    const lowerQuestion = question.toLowerCase();

    // Cek pertanyaan tentang commands
    for (const [command, description] of Object.entries(this.knowledgeBase.commands)) {
      if (lowerQuestion.includes(command.replace('!', '')) ||
          lowerQuestion.includes('command') ||
          lowerQuestion.includes('perintah')) {
        if (lowerQuestion.includes(command.replace('!', ''))) {
          return `${command}: ${description}`;
        }
      }
    }

    // Cek pertanyaan umum tentang commands
    if (lowerQuestion.includes('command') || lowerQuestion.includes('perintah') ||
        lowerQuestion.includes('tersedia') || lowerQuestion.includes('available')) {
      return `Daftar Command Bot:\n${this.getAvailableCommands()}\n\nGunakan !help untuk informasi lebih lengkap.`;
    }

    // Cek pertanyaan tentang restart
    if (lowerQuestion.includes('restart') || lowerQuestion.includes('reboot')) {
      return `Restart Server: Gunakan !restart untuk memulai voting restart server. Membutuhkan 5 konfirmasi dari user yang berbeda. Admin dapat restart langsung tanpa voting.`;
    }

    // Cek pertanyaan tentang features
    for (const [feature, description] of Object.entries(this.knowledgeBase.features)) {
      if (lowerQuestion.includes(feature)) {
        return `${feature.toUpperCase()}: ${description}`;
      }
    }

    // Cek pertanyaan tentang gameplay
    for (const [topic, description] of Object.entries(this.knowledgeBase.gameplay)) {
      if (lowerQuestion.includes(topic) ||
          (topic === 'survival' && (lowerQuestion.includes('bertahan') || lowerQuestion.includes('survive') || lowerQuestion.includes('tips'))) ||
          (topic === 'multiplayer' && (lowerQuestion.includes('coop') || lowerQuestion.includes('bersama'))) ||
          (topic === 'mods' && lowerQuestion.includes('mod')) ||
          (topic === 'events' && (lowerQuestion.includes('event') || lowerQuestion.includes('acara')))) {
        return `${topic.toUpperCase()}: ${description}`;
      }
    }

    // Cek pertanyaan troubleshooting
    if (lowerQuestion.includes('tidak bisa') || lowerQuestion.includes('gak bisa') ||
        lowerQuestion.includes('error') || lowerQuestion.includes('masalah') ||
        lowerQuestion.includes('problem') || lowerQuestion.includes('help') ||
        lowerQuestion.includes('banget') || lowerQuestion.includes('kenapa') ||
        lowerQuestion.includes('gimana') || lowerQuestion.includes('cara')) {

      for (const [issue, solution] of Object.entries(this.knowledgeBase.troubleshooting)) {
        if ((issue === 'connection' && (lowerQuestion.includes('connect') || lowerQuestion.includes('koneksi') || lowerQuestion.includes('join'))) ||
            (issue === 'lag' && (lowerQuestion.includes('lag') || lowerQuestion.includes('lemot') || lowerQuestion.includes('patah'))) ||
            (issue === 'crash' && lowerQuestion.includes('crash')) ||
            (issue === 'banned' && (lowerQuestion.includes('ban') || lowerQuestion.includes('banned') || lowerQuestion.includes('kena ban'))) ||
            (issue === 'whitelist' && (lowerQuestion.includes('whitelist') || lowerQuestion.includes('daftar') || lowerQuestion.includes('register')))) {
          return `Solusi ${issue.toUpperCase()}: ${solution}`;
        }
      }
    }

    // Cek pertanyaan spesifik tentang player
    if (lowerQuestion.includes('player') && (lowerQuestion.includes('online') || lowerQuestion.includes('cek'))) {
      return `CEK PLAYER ONLINE: Gunakan command !players untuk melihat daftar player yang sedang online saat ini.`;
    }

    return null;
  }

  async callAI(question, context) {
    const systemPrompt = `Kamu adalah AI assistant untuk server Project Zomboid Discord bot.
    Bantu menjawab pertanyaan player tentang:
    - Fitur-fitur server dan bot Discord
    - Command yang tersedia
    - Gameplay tips untuk Project Zomboid
    - Troubleshooting masalah umum

    Jawab dalam bahasa Indonesia dengan ramah dan informatif. Maksimal 150 kata.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question }
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature
      })
    });

    if (!response.ok) {
      throw new Error(`AI API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || this.getFallbackResponse(question);
  }

  getFallbackResponse(question) {
    const fallbackResponses = [
      "Maaf, saya tidak bisa menjawab pertanyaan itu saat ini. Silakan hubungi admin untuk bantuan lebih lanjut.",
      "Pertanyaan yang menarik! Sayangnya saya belum punya informasi lengkap tentang itu. Coba tanya di channel general atau hubungi admin.",
      "Saya sedang belajar untuk memberikan jawaban yang lebih baik. Sementara itu, silakan cek #help-channel atau tanya player lain.",
      "Hmm, saya butuh informasi lebih lanjut untuk menjawab pertanyaan itu. Admin atau moderator mungkin bisa membantu lebih baik."
    ];

    return fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
  }

  // Method untuk menambah pengetahuan baru
  addKnowledge(category, key, value) {
    if (this.knowledgeBase[category]) {
      this.knowledgeBase[category][key] = value;
      logger.info(`Added new knowledge: ${category}.${key}`);
    }
  }

  // Method untuk mendapatkan daftar command yang tersedia
  getAvailableCommands() {
    return Object.entries(this.knowledgeBase.commands)
      .map(([command, description]) => `${command}: ${description}`)
      .join('\n');
  }
}

export default new AIAssistant();
