// Text Utilities - Text processing and analysis functions
class TextUtils {
  // Sentence segmentation with improved accuracy
  static splitIntoSentences(text) {
    // Handle common abbreviations and edge cases
    const abbreviationMap = {
      'Dr.': 'Dr',
      'Mr.': 'Mr',
      'Mrs.': 'Mrs',
      'Ms.': 'Ms',
      'vs.': 'vs',
      'etc.': 'etc',
      'i.e.': 'ie',
      'e.g.': 'eg',
      'Jr.': 'Jr',
      'Sr.': 'Sr',
      'Inc.': 'Inc',
      'Ltd.': 'Ltd',
      'Corp.': 'Corp'
    };

    // Replace abbreviations temporarily
    let processedText = text;
    for (const [abbr, replacement] of Object.entries(abbreviationMap)) {
      processedText = processedText.replace(new RegExp(`\\b${this.escapeRegex(abbr)}\\b`, 'g'), replacement);
    }

    // Split on sentence endings
    const sentences = processedText.split(/[.!?]+/).filter(s => s.trim().length > 0);

    // Restore abbreviations in sentences
    const restoredSentences = sentences.map(sentence => {
      for (const [abbr, replacement] of Object.entries(abbreviationMap)) {
        sentence = sentence.replace(new RegExp(`\\b${this.escapeRegex(replacement)}\\b`, 'g'), abbr);
      }
      return sentence.trim();
    });

    return restoredSentences;
  }

  // Entity extraction from text
  static extractEntities(text) {
    const entities = [];

    // Extract numbers and statistics
    const numberRegex = /(\d+(?:\.\d+)?)\s*(%|percent|million|billion|thousand|k|m|b)?/gi;
    let match;
    while ((match = numberRegex.exec(text)) !== null) {
      entities.push({
        type: 'number',
        value: match[1],
        unit: match[2] || '',
        text: match[0],
        start: match.index,
        end: match.index + match[0].length
      });
    }

    // Extract quoted phrases
    const quoteRegex = /"([^"]{3,100})"/g;
    while ((match = quoteRegex.exec(text)) !== null) {
      entities.push({
        type: 'quote',
        value: match[1],
        text: match[0],
        start: match.index,
        end: match.index + match[0].length
      });
    }

    // Extract capitalized words (potential proper nouns)
    const capitalRegex = /\b([A-Z][a-z]{2,})\b/g;
    while ((match = capitalRegex.exec(text)) !== null) {
      const word = match[1];
      if (!this.isCommonWord(word)) {
        entities.push({
          type: 'proper_noun',
          value: word,
          text: word,
          start: match.index,
          end: match.index + word.length
        });
      }
    }

    // Extract scientific/medical terms
    const scientificTerms = /\b(vaccine|virus|COVID|coronavirus|pandemic|epidemic|clinical|trial|study|research|data|statistics|analysis)\b/gi;
    while ((match = scientificTerms.exec(text)) !== null) {
      entities.push({
        type: 'scientific',
        value: match[0],
        text: match[0],
        start: match.index,
        end: match.index + match[0].length
      });
    }

    // Sort entities by position
    entities.sort((a, b) => a.start - b.start);

    return entities;
  }

  // Text normalization for better search
  static normalizeText(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s\-+%$]/g, ' ') // Remove punctuation except for important chars
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  // Calculate similarity between two texts
  static calculateSimilarity(text1, text2) {
    const words1 = new Set(this.normalizeText(text1).split(/\s+/));
    const words2 = new Set(this.normalizeText(text2).split(/\s+/));

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  // Find similar sentences in a text
  static findSimilarSentences(text, targetSentence, threshold = 0.3) {
    const sentences = this.splitIntoSentences(text);
    const similar = [];

    for (const sentence of sentences) {
      const similarity = this.calculateSimilarity(sentence, targetSentence);
      if (similarity >= threshold) {
        similar.push({
          sentence,
          similarity
        });
      }
    }

    return similar.sort((a, b) => b.similarity - a.similarity);
  }

  // Extract keywords from text
  static extractKeywords(text, maxKeywords = 10) {
    const sentences = this.splitIntoSentences(text);
    const wordFreq = new Map();

    // Count word frequencies
    for (const sentence of sentences) {
      const words = this.normalizeText(sentence).split(/\s+/).filter(word => word.length > 2);

      for (const word of words) {
        if (!this.isStopWord(word)) {
          wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
        }
      }
    }

    // Filter and sort by frequency
    const keywords = Array.from(wordFreq.entries())
      .filter(([word, freq]) => freq >= 2) // Must appear at least twice
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxKeywords)
      .map(([word]) => word);

    return keywords;
  }

  // Check if word is a common stop word
  static isStopWord(word) {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can',
      'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them'
    ]);

    return stopWords.has(word.toLowerCase());
  }

  // Check if word is a common non-entity word
  static isCommonWord(word) {
    const commonWords = new Set([
      'The', 'This', 'That', 'These', 'Those', 'What', 'Which', 'Who', 'When', 'Where', 'Why', 'How',
      'Very', 'Really', 'Quite', 'Some', 'Any', 'Many', 'Much', 'Few', 'Little', 'Big', 'Small',
      'Good', 'Bad', 'Right', 'Wrong', 'New', 'Old', 'First', 'Last', 'Next', 'Previous'
    ]);

    return commonWords.has(word);
  }

  // Clean HTML from text
  static stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  // Extract text from specific HTML elements
  static extractFromElements(html, selectors) {
    const results = [];

    for (const selector of selectors) {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const elements = doc.querySelectorAll(selector);

        for (const element of elements) {
          const text = element.textContent || element.innerText || '';
          if (text.trim()) {
            results.push({
              selector,
              text: text.trim(),
              element: element.outerHTML.substring(0, 200)
            });
          }
        }
      } catch (error) {
        console.warn(`Error extracting from selector ${selector}:`, error);
      }
    }

    return results;
  }

  // Generate text summary
  static generateSummary(text, maxLength = 200) {
    const sentences = this.splitIntoSentences(text);

    if (sentences.length === 0) return '';

    // Simple extractive summarization - take first and important sentences
    let summary = sentences[0];

    // Add more sentences if they're not too long
    for (let i = 1; i < sentences.length && summary.length < maxLength; i++) {
      const sentence = sentences[i];
      if (summary.length + sentence.length + 1 < maxLength) {
        summary += '. ' + sentence;
      } else {
        break;
      }
    }

    return summary.substring(0, maxLength) + (summary.length > maxLength ? '...' : '');
  }

  // Count words in text
  static countWords(text) {
    return this.normalizeText(text).split(/\s+/).filter(word => word.length > 0).length;
  }

  // Calculate reading time (words per minute)
  static calculateReadingTime(text, wordsPerMinute = 200) {
    const wordCount = this.countWords(text);
    const minutes = Math.ceil(wordCount / wordsPerMinute);
    return {
      words: wordCount,
      minutes,
      time: `${minutes} min read`
    };
  }

  // Escape special regex characters
  static escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Find all occurrences of a pattern
  static findAll(text, pattern, flags = 'g') {
    const regex = new RegExp(pattern, flags);
    const matches = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
      matches.push({
        text: match[0],
        index: match.index,
        groups: match.slice(1)
      });
    }

    return matches;
  }

  // Replace all occurrences with context
  static replaceWithContext(text, pattern, replacement, contextLength = 50) {
    const matches = this.findAll(text, pattern);
    let result = text;
    let offset = 0;

    for (const match of matches) {
      const start = Math.max(0, match.index - contextLength);
      const end = Math.min(text.length, match.index + match.text.length + contextLength);
      const context = text.substring(start, end);

      const replacementWithContext = replacement(match.text, context, match.index);
      const before = result.substring(0, match.index + offset);
      const after = result.substring(match.index + match.text.length + offset);

      result = before + replacementWithContext + after;
      offset += replacementWithContext.length - match.text.length;
    }

    return result;
  }

  // Calculate text complexity (simplified Flesch reading ease)
  static calculateComplexity(text) {
    const sentences = this.splitIntoSentences(text);
    const words = this.normalizeText(text).split(/\s+/).length;
    const syllables = this.countSyllables(text);

    if (sentences.length === 0 || words === 0) {
      return { score: 0, level: 'unknown' };
    }

    const avgWordsPerSentence = words / sentences.length;
    const avgSyllablesPerWord = syllables / words;

    // Simplified Flesch Reading Ease score
    const score = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);

    let level;
    if (score >= 90) level = 'very_easy';
    else if (score >= 80) level = 'easy';
    else if (score >= 70) level = 'fairly_easy';
    else if (score >= 60) level = 'standard';
    else if (score >= 50) level = 'fairly_difficult';
    else if (score >= 30) level = 'difficult';
    else level = 'very_difficult';

    return {
      score: Math.round(score),
      level,
      avg_words_per_sentence: Math.round(avgWordsPerSentence * 10) / 10,
      avg_syllables_per_word: Math.round(avgSyllablesPerWord * 10) / 10
    };
  }

  // Count syllables (simplified)
  static countSyllables(text) {
    const words = this.normalizeText(text).split(/\s+/);
    let totalSyllables = 0;

    for (const word of words) {
      totalSyllables += this.countSyllablesInWord(word);
    }

    return totalSyllables;
  }

  static countSyllablesInWord(word) {
    word = word.toLowerCase();
    if (word.length <= 3) return 1;

    // Remove common endings
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');

    // Count vowel groups
    const matches = word.match(/[aeiouy]{1,2}/g);
    let syllables = matches ? matches.length : 0;

    // Adjust for silent e
    if (word.endsWith('e')) syllables--;

    // Ensure at least one syllable
    return Math.max(1, syllables);
  }

  // Get text statistics
  static getTextStats(text) {
    const sentences = this.splitIntoSentences(text);
    const words = this.normalizeText(text).split(/\s+/).filter(w => w.length > 0);
    const characters = text.length;
    const complexity = this.calculateComplexity(text);

    return {
      characters,
      words: words.length,
      sentences: sentences.length,
      paragraphs: text.split(/\n\s*\n/).length,
      avg_words_per_sentence: sentences.length > 0 ? words.length / sentences.length : 0,
      avg_characters_per_word: words.length > 0 ? characters / words.length : 0,
      complexity
    };
  }
}

export default TextUtils;
