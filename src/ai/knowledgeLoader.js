import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class KnowledgeBaseLoader {
  constructor() {
    this.knowledgeBasePath = path.resolve(__dirname, '../../Knowledgebases');
    this.loadedKnowledge = {};
  }

  async loadAllKnowledgeBases() {
    try {
      if (!fs.existsSync(this.knowledgeBasePath)) {
        console.log('Knowledge base directory not found:', this.knowledgeBasePath);
        return {};
      }

      const files = fs.readdirSync(this.knowledgeBasePath);
      const mdFiles = files.filter(file => file.endsWith('.md'));

      for (const file of mdFiles) {
        const filePath = path.join(this.knowledgeBasePath, file);
        const content = fs.readFileSync(filePath, 'utf-8');

        // Parse and organize content
        const parsedContent = this.parseMarkdownContent(content, file);
        this.loadedKnowledge[file.replace('.md', '')] = parsedContent;
      }

      console.log(`✅ Loaded ${mdFiles.length} knowledge base files`);
      return this.loadedKnowledge;
    } catch (error) {
      console.error('Error loading knowledge bases:', error);
      return {};
    }
  }

  parseMarkdownContent(content, filename) {
    const sections = {};
    const lines = content.split('\n');
    let currentSection = 'general';
    let currentContent = [];

    for (const line of lines) {
      const trimmedLine = line.trim();

      // Detect headings
      if (line.startsWith('###')) {
        // Save previous section
        if (currentContent.length > 0) {
          sections[currentSection] = currentContent.join('\n').trim();
        }

        // Start new section
        currentSection = line.replace(/#{1,6}\s*/, '').toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, '_');
        currentContent = [];
      } else if (line.startsWith('##')) {
        // Major section header
        if (currentContent.length > 0) {
          sections[currentSection] = currentContent.join('\n').trim();
        }

        currentSection = line.replace(/#{1,6}\s*/, '').toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, '_');
        currentContent = [];
      } else if (trimmedLine.match(/^\*\*[^*]+\*\*$/)) {
        // Bold text as section header (e.g., **JESICA SUPLY RUN MISSION**)
        if (currentContent.length > 0) {
          sections[currentSection] = currentContent.join('\n').trim();
        }

        currentSection = trimmedLine.replace(/\*\*/g, '').toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, '_');
        currentContent = [];
      } else {
        currentContent.push(line);
      }
    }

    // Save last section
    if (currentContent.length > 0) {
      sections[currentSection] = currentContent.join('\n').trim();
    }

    return {
      filename,
      fullContent: content,
      sections,
      keywords: this.extractKeywords(content)
    };
  }

  extractKeywords(content) {
    const keywords = new Set();
    const text = content.toLowerCase();

    // Extract common game terms and server-specific terms
    const gameTerms = [
      'zomboid', 'zombie', 'server', 'player', 'character', 'item', 'weapon',
      'food', 'medicine', 'building', 'craft', 'skill', 'level', 'experience',
      'community', 'pvp', 'pve', 'raid', 'quest', 'mission', 'shop', 'store',
      'points', 'currency', 'tier', 'rank', 'survival', 'death', 'respawn',
      'vehicle', 'car', 'helicopter', 'boat', 'extraction', 'safe zone',
      'danger zone', 'hazard', 'radiation', 'infection', 'cure', 'heal',
      'menu', 'zm', 'rat way', 'cosplay', 'airdrop', 'enchant', 'mystic',
      'orb', 'jessica', 'jesica', 'doc', 'supplies', 'supply', 'corpse', 'clear', 'grab',
      'numpad', 'price', 'sell', 'buy', 'dagang', 'ijin', 'surat',
      'tier system', 'player tier', 'bhx', 'rad', 'raven creek',
      'enchantment', 'duplicate', 'detection', 'supply run', 'suply run'
    ];

    for (const term of gameTerms) {
      if (text.includes(term)) {
        keywords.add(term);
      }
    }

    // Extract quoted text and commands
    const quotes = content.match(/"([^"]+)"/g);
    if (quotes) {
      quotes.forEach(quote => {
        keywords.add(quote.replace(/"/g, '').toLowerCase());
      });
    }

    // Extract important phrases
    const phrases = [
      'zm menu', 'rat way', 'clear corpse', 'tier system', 'doc jessica',
      'raid points', 'server points', 'hazard zone', 'cosplay item',
      'mystic orb', 'player tier', 'surat ijin dagang', 'airdrop',
      'extraction zone', 'community center', 'raven creek'
    ];

    for (const phrase of phrases) {
      if (text.includes(phrase)) {
        keywords.add(phrase);
      }
    }

    // Extract numbers that might be important (costs, levels, etc.)
    const numbers = content.match(/(\d+)\s*(points?|days?|kills?|minutes?|hours?)/gi);
    if (numbers) {
      numbers.forEach(num => keywords.add(num.toLowerCase()));
    }

    return Array.from(keywords);
  }

  searchKnowledge(query) {
    const lowerQuery = query.toLowerCase();
    const results = [];

    for (const [fileName, knowledge] of Object.entries(this.loadedKnowledge)) {
      // Find most relevant section
      let bestSection = null;
      let bestScore = 0;

      for (const [sectionName, sectionContent] of Object.entries(knowledge.sections)) {
        const sectionLower = sectionContent.toLowerCase();
        let score = 0;

        // Enhanced scoring for specific topics
        const queryWords = lowerQuery.split(' ').filter(word => word.length > 2);

        // Special handling for specific topics
        if (lowerQuery.includes('jessica') && lowerQuery.includes('supply')) {
          if (sectionLower.includes('jessica') && sectionLower.includes('supply')) {
            score += 50; // High priority for Jessica Supply Run
          }
        }

        if (lowerQuery.includes('tier') && lowerQuery.includes('system')) {
          if (sectionLower.includes('tier') && sectionLower.includes('system')) {
            score += 50; // High priority for Tier System
          }
        }

        if (lowerQuery.includes('rat') && lowerQuery.includes('way')) {
          if (sectionLower.includes('rat') && sectionLower.includes('way')) {
            score += 50; // High priority for Rat Way
          }
        }

        // Score based on query word matches
        for (const word of queryWords) {
          const matches = (sectionLower.match(new RegExp(word, 'g')) || []).length;
          score += matches * 2;
        }

        // Check phrase matches
        const phraseMatches = this.checkPhraseMatches(lowerQuery, sectionLower);
        for (const phrase of phraseMatches) {
          if (sectionLower.includes(phrase)) {
            score += 10;
          }
        }

        // Bonus for keywords in this section
        for (const keyword of knowledge.keywords) {
          if (lowerQuery.includes(keyword) && sectionLower.includes(keyword)) {
            score += 5;
          }
        }

        if (score > bestScore) {
          bestScore = score;
          bestSection = { name: sectionName, content: sectionContent };
        }
      }

      // Only include results with reasonable score
      if (bestSection && bestScore > 5) {
        results.push({
          file: fileName,
          section: bestSection.name,
          content: bestSection.content,
          score: bestScore
        });
      }
    }

    // Sort by relevance score
    return results.sort((a, b) => b.score - a.score);
  }

  checkPhraseMatches(query, content) {
    const commonPhrases = [
      'zm menu', 'rat way', 'clear corpse', 'tier system', 'doc jessica',
      'raid points', 'server points', 'hazard zone', 'cosplay item',
      'mystic orb', 'player tier', 'surat ijin dagang', 'airdrop',
      'cara membuka', 'cara beli', 'cara dapat', 'bagaimana cara',
      'apa itu', 'siapa itu', 'enchant weapon', 'duplicate item'
    ];

    const matches = [];
    for (const phrase of commonPhrases) {
      if (query.includes(phrase) && content.includes(phrase)) {
        matches.push(phrase);
      }
    }

    return matches;
  }

  getFormattedResponse(searchResults, maxLength = 1900) {
    if (!searchResults || searchResults.length === 0) {
      return null;
    }

    const topResult = searchResults[0];
    let title = `${topResult.file.replace(/_/g, ' ')}\n\n`;

    // Special handling for specific sections to extract only relevant content
    let content = topResult.content;

    if (topResult.section === 'jesica_suply_run_mission') {
      // For Jessica section, use the content as-is since it's already filtered by section
      // Just clean up any extra whitespace
      content = content.trim();
    }

    // Clean and format content - remove markdown formatting
    content = content
      .replace(/^\s*\n+/gm, '') // Remove empty lines at start
      .replace(/\n{3,}/g, '\n\n') // Reduce multiple newlines
      // Temporarily disable other cleaning to debug
      // .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1') // Remove bold formatting
      // .replace(/#{1,6}\s*/g, '') // Remove headers
      // .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove markdown links
      // .replace(/`([^`]+)`/g, '$1') // Remove code formatting
      .trim();

    const source = `\n\nSumber: ${topResult.file}.md`;

    // If content fits in one message, return as single message
    if ((title + content + source).length <= maxLength) {
      return title + content + source;
    }

    // Split into multiple messages
    const messages = [];
    const availableLength = maxLength - title.length - source.length - 20; // Buffer for "...(lanjutan)"

    // First message with title
    let currentContent = content.substring(0, availableLength);

    // Find last complete sentence or paragraph
    let lastBreak = Math.max(
      currentContent.lastIndexOf('\n\n'),
      currentContent.lastIndexOf('. '),
      currentContent.lastIndexOf('.\n')
    );

    if (lastBreak > availableLength * 0.7) { // If break point is reasonable
      currentContent = content.substring(0, lastBreak + 1);
    }

    messages.push(title + currentContent + '...(lanjutan)');

    // Remaining content
    let remainingContent = content.substring(currentContent.length);

    // Split remaining content into chunks
    while (remainingContent.length > 0) {
      const isLastChunk = remainingContent.length <= (maxLength - source.length - 20);
      const chunkLength = isLastChunk ? remainingContent.length : maxLength - 20;

      let chunk = remainingContent.substring(0, chunkLength);

      if (!isLastChunk) {
        // Find good break point
        let lastBreak = Math.max(
          chunk.lastIndexOf('\n\n'),
          chunk.lastIndexOf('. '),
          chunk.lastIndexOf('.\n')
        );

        if (lastBreak > chunkLength * 0.7) {
          chunk = remainingContent.substring(0, lastBreak + 1);
        }
      }

      if (isLastChunk) {
        messages.push(chunk + source);
      } else {
        messages.push(chunk + '...(lanjutan)');
      }

      remainingContent = remainingContent.substring(chunk.length);
    }

    return messages;
  }
}

export default new KnowledgeBaseLoader();
