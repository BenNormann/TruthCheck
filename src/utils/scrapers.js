// Scrapers - Web scraping utilities for academic and fact-checking sites
import logger from '../foundation/logger.js';

class Scrapers {
  // Generic scraper with retry logic and rate limiting
  static async scrape(url, options = {}) {
    const {
      timeout = 10000,
      retries = 3,
      delay = 1000,
      headers = {},
      selector = null
    } = options;

    logger.log(`Scraping: ${url}`);

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            ...headers
          },
          signal: AbortSignal.timeout(timeout)
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const html = await response.text();

        if (selector) {
          return this.extractWithSelector(html, selector);
        }

        return html;

      } catch (error) {
        logger.error(`Scraping attempt ${attempt + 1} failed for ${url}:`, error);

        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt)));
        } else {
          throw new Error(`Failed to scrape ${url} after ${retries + 1} attempts: ${error.message}`);
        }
      }
    }
  }

  // Extract data using CSS selectors
  static extractWithSelector(html, selector) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    if (typeof selector === 'string') {
      const elements = doc.querySelectorAll(selector);
      return Array.from(elements).map(el => ({
        text: el.textContent?.trim() || '',
        html: el.outerHTML,
        attributes: this.extractAttributes(el)
      }));
    }

    if (typeof selector === 'object') {
      const results = {};

      for (const [key, sel] of Object.entries(selector)) {
        const elements = doc.querySelectorAll(sel);
        results[key] = Array.from(elements).map(el => ({
          text: el.textContent?.trim() || '',
          html: el.outerHTML,
          attributes: this.extractAttributes(el)
        }));
      }

      return results;
    }

    return [];
  }

  // Extract attributes from an element
  static extractAttributes(element) {
    const attributes = {};
    for (const attr of element.attributes) {
      attributes[attr.name] = attr.value;
    }
    return attributes;
  }

  // Google Scholar scraper
  static async scrapeGoogleScholar(query, options = {}) {
    const url = `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`;

    try {
      const html = await this.scrape(url, { ...options, timeout: 15000 });

      const results = this.extractWithSelector(html, {
        titles: 'h3.gs_rt a',
        snippets: 'div.gs_rs',
        citations: 'div.gs_fl a[href*="cites"]',
        years: 'div.gs_a',
        authors: 'div.gs_a'
      });

      // Parse and structure the results
      const papers = [];

      for (let i = 0; i < Math.min(results.titles.length, 10); i++) {
        const titleEl = results.titles[i];
        const snippetEl = results.snippets[i];
        const yearEl = results.years[i];

        if (titleEl) {
          papers.push({
            title: titleEl.text,
            url: titleEl.attributes.href,
            snippet: snippetEl?.text || '',
            year: this.extractYearFromText(yearEl?.text || ''),
            authors: this.extractAuthorsFromText(yearEl?.text || ''),
            source: 'Google Scholar',
            query
          });
        }
      }

      return papers;

    } catch (error) {
      logger.error('Google Scholar scraping failed:', error);
      return [];
    }
  }

  // PubMed scraper
  static async scrapePubMed(query, options = {}) {
    const url = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query)}`;

    try {
      const html = await this.scrape(url, { ...options, timeout: 15000 });

      const results = this.extractWithSelector(html, {
        titles: '.docsum-title',
        snippets: '.docsum-content .full-view-snippet',
        authors: '.docsum-authors',
        journals: '.docsum-journal-citation'
      });

      const papers = [];

      for (let i = 0; i < Math.min(results.titles.length, 10); i++) {
        const titleEl = results.titles[i];
        const snippetEl = results.snippets[i];
        const journalEl = results.journals[i];

        if (titleEl) {
          papers.push({
            title: titleEl.text,
            url: `https://pubmed.ncbi.nlm.nih.gov${titleEl.attributes.href}`,
            snippet: snippetEl?.text || '',
            journal: journalEl?.text || '',
            source: 'PubMed',
            query
          });
        }
      }

      return papers;

    } catch (error) {
      logger.error('PubMed scraping failed:', error);
      return [];
    }
  }

  // Britannica scraper
  static async scrapeBritannica(query, options = {}) {
    const url = `https://www.britannica.com/search?query=${encodeURIComponent(query)}`;

    try {
      const html = await this.scrape(url, options);

      const results = this.extractWithSelector(html, {
        titles: '.search-result h3 a',
        snippets: '.search-result .search-result-content',
        categories: '.search-result .search-result-category'
      });

      const articles = [];

      for (let i = 0; i < Math.min(results.titles.length, 5); i++) {
        const titleEl = results.titles[i];
        const snippetEl = results.snippets[i];

        if (titleEl) {
          articles.push({
            title: titleEl.text,
            url: titleEl.attributes.href.startsWith('http') ? titleEl.attributes.href : `https://www.britannica.com${titleEl.attributes.href}`,
            snippet: snippetEl?.text || '',
            source: 'Britannica',
            query
          });
        }
      }

      return articles;

    } catch (error) {
      logger.error('Britannica scraping failed:', error);
      return [];
    }
  }

  // arXiv scraper
  static async scrapearXiv(query, options = {}) {
    const url = `https://arxiv.org/search/?query=${encodeURIComponent(query)}&searchtype=all`;

    try {
      const html = await this.scrape(url, { ...options, timeout: 12000 });

      const results = this.extractWithSelector(html, {
        titles: '.title a',
        authors: '.authors a',
        abstracts: '.abstract',
        dates: '.submitted'
      });

      const papers = [];

      for (let i = 0; i < Math.min(results.titles.length, 10); i++) {
        const titleEl = results.titles[i];
        const authorEl = results.authors[i];
        const abstractEl = results.abstracts[i];
        const dateEl = results.dates[i];

        if (titleEl) {
          papers.push({
            title: titleEl.text.trim(),
            url: `https://arxiv.org${titleEl.attributes.href}`,
            authors: authorEl ? authorEl.text.split(',').map(a => a.trim()) : [],
            abstract: abstractEl?.text.trim() || '',
            date: dateEl?.text.trim() || '',
            source: 'arXiv',
            query
          });
        }
      }

      return papers;

    } catch (error) {
      logger.error('arXiv scraping failed:', error);
      return [];
    }
  }

  // Batch scraping with rate limiting
  static async scrapeBatch(urls, options = {}) {
    const {
      batchSize = 3,
      delay = 2000,
      ...scrapeOptions
    } = options;

    const results = [];

    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        batch.map(url => this.scrape(url, scrapeOptions))
      );

      results.push(...batchResults.map((result, index) => ({
        url: batch[index],
        success: result.status === 'fulfilled',
        data: result.status === 'fulfilled' ? result.value : null,
        error: result.status === 'rejected' ? result.reason : null
      })));

      // Delay between batches
      if (i + batchSize < urls.length) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return results;
  }

  // Extract year from text (used by multiple scrapers)
  static extractYearFromText(text) {
    const yearRegex = /(\d{4})/;
    const match = text.match(yearRegex);
    return match ? parseInt(match[1]) : null;
  }

  // Extract authors from text
  static extractAuthorsFromText(text) {
    // Simple author extraction - looks for patterns like "Author1, Author2"
    const authorRegex = /([A-Z][a-z]+(?:\s+[A-Z]\.)?(?:\s*,\s*[A-Z][a-z]+(?:\s+[A-Z]\.)?)*)/;
    const match = text.match(authorRegex);
    return match ? match[1].split(',').map(a => a.trim()) : [];
  }

  // Handle CAPTCHA detection and retry
  static async handleCaptcha(url, response) {
    // Check if response contains CAPTCHA indicators
    const captchaIndicators = [
      'captcha',
      'blocked',
      'access denied',
      'rate limit',
      'too many requests'
    ];

    const responseText = response.toLowerCase();

    for (const indicator of captchaIndicators) {
      if (responseText.includes(indicator)) {
        logger.warn(`CAPTCHA/rate limit detected for ${url}`);

        // Wait longer before retry
        await new Promise(resolve => setTimeout(resolve, 10000));

        return false; // Indicates retry should happen
      }
    }

    return true; // No CAPTCHA detected
  }

  // Clean and normalize scraped text
  static cleanScrapedText(text) {
    return text
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[\u00A0\u2000-\u200B\u2028\u2029\u3000]/g, ' ') // Remove special spaces
      .trim();
  }

  // Extract structured data from JSON-LD
  static extractJsonLd(html) {
    try {
      const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
      const jsonLdData = [];

      let match;
      while ((match = jsonLdRegex.exec(html)) !== null) {
        try {
          const data = JSON.parse(match[1]);
          jsonLdData.push(data);
        } catch (error) {
          logger.warn('Failed to parse JSON-LD:', error);
        }
      }

      return jsonLdData;
    } catch (error) {
      logger.error('Error extracting JSON-LD:', error);
      return [];
    }
  }

  // Extract meta tags
  static extractMetaTags(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const metaTags = {};
    const metaElements = doc.querySelectorAll('meta');

    for (const meta of metaElements) {
      const name = meta.getAttribute('name') || meta.getAttribute('property');
      const content = meta.getAttribute('content');

      if (name && content) {
        metaTags[name] = content;
      }
    }

    return metaTags;
  }

  // Get page title from HTML
  static extractTitle(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return doc.querySelector('title')?.textContent?.trim() || '';
  }

  // Extract main content (article body)
  static extractMainContent(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Try common selectors for main content
    const contentSelectors = [
      'article',
      '[class*="article"]',
      '[class*="content"]',
      'main',
      '.post-content',
      '.entry-content',
      '#content',
      '.content'
    ];

    for (const selector of contentSelectors) {
      const element = doc.querySelector(selector);
      if (element) {
        // Remove unwanted elements
        element.querySelectorAll('script, style, nav, header, footer, aside, .advertisement, .ads, .social-share').forEach(el => el.remove());

        const text = element.textContent?.trim();
        if (text && text.length > 100) {
          return text;
        }
      }
    }

    return '';
  }
}

export default Scrapers;
