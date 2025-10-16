// Content script for Truth Check extension
console.log('Truth Check: Content script loaded');
console.log('Truth Check: Current URL:', window.location.href);
console.log('Truth Check: Current domain:', window.location.hostname);

// Import foundation modules when available
let CONFIG, Cache, Logger, ClaimExtractor, ClaimNormalizer, Scorer, OverrideEngine, Highlighter, Tooltip;

async function initializeExtension() {
  try {
    console.log('Truth Check: Initializing extension...');

    // Load CONFIG from background script
    console.log('Truth Check: Loading configuration...');
    CONFIG = await getConfig();

    // Initialize foundation layer
    console.log('Truth Check: Initializing foundation layer...');
    Cache = await import('./src/foundation/cache.js');
    Logger = await import('./src/foundation/logger.js');
    console.log('Truth Check: Foundation layer initialized');

    // Initialize pipeline layer
    console.log('Truth Check: Initializing pipeline layer...');
    ClaimExtractor = await import('./src/pipeline/claimExtractor.js');
    ClaimNormalizer = await import('./src/pipeline/normalizer.js');
    Scorer = await import('./src/pipeline/scorer.js');
    OverrideEngine = await import('./src/pipeline/overrideEngine.js');
    console.log('Truth Check: Pipeline layer initialized');

    // Initialize UI layer
    console.log('Truth Check: Initializing UI layer...');
    Highlighter = await import('./src/ui/highlighter.js');
    Tooltip = await import('./src/ui/tooltip.js');
    console.log('Truth Check: UI layer initialized');

    console.log('Truth Check: Extension initialized successfully');
    startProcessing();

  } catch (error) {
    console.error('Truth Check: Failed to initialize extension:', error);
  }
}

async function getConfig() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (response) => {
      resolve(response || {});
    });
  });
}

async function startProcessing() {
  console.log('Truth Check: Checking if should process page...');

  // Only process if we're on a news site and content is ready
  if (!isNewsSite() || document.readyState !== 'complete') {
    if (document.readyState !== 'complete') {
      console.log('Truth Check: Waiting for page to load completely...');
      document.addEventListener('DOMContentLoaded', startProcessing);
    }
    return;
  }

  try {
    console.log('Truth Check: Starting claim extraction and scoring...');
    Logger.log('Starting claim extraction and scoring...');

    // Extract article content
    console.log('Truth Check: Extracting article content...');
    const articleContent = extractArticleContent();
    console.log('Truth Check: Article content length:', articleContent?.length || 0);

    if (!articleContent || articleContent.length < CONFIG.min_content_length) {
      console.log('Truth Check: Article too short or no content found');
      Logger.log('Article too short or no content found');
      return;
    }

    console.log('Truth Check: Article content extracted successfully');

    // Extract claims from article
    console.log('Truth Check: Extracting claims from article...');
    const claims = await ClaimExtractor.extractClaims(articleContent);
    console.log('Truth Check: Claims found:', claims.length);

    if (claims.length === 0) {
      console.log('Truth Check: No claims found in article');
      Logger.log('No claims found in article');
      return;
    }

    console.log('Truth Check: Claims extracted successfully');
    console.log('Truth Check: Found', claims.length, 'claims to analyze');

    // Process claims in batches to avoid overwhelming the page
    console.log('Truth Check: Processing claims in batches...');
    await processClaimsInBatches(claims);

  } catch (error) {
    console.error('Truth Check: Error in main processing:', error);
    Logger.error('Error in main processing:', error);
  }
}

function isNewsSite() {
  // Basic heuristic to detect news sites
  const newsDomains = ['news', 'cnn', 'bbc', 'foxnews', 'nytimes', 'washingtonpost', 'reuters', 'apnews', 'bloomberg'];
  const currentDomain = window.location.hostname.toLowerCase();

  console.log('Truth Check: Checking if news site...');
  console.log('Truth Check: Domain:', currentDomain);
  console.log('Truth Check: Has article tag:', document.querySelector('article') !== null);
  console.log('Truth Check: Has article class:', document.querySelector('[class*="article"]') !== null);

  const result = newsDomains.some(domain => currentDomain.includes(domain)) ||
         document.querySelector('article') !== null ||
         document.querySelector('[class*="article"]') !== null;

  console.log('Truth Check: Is news site:', result);
  return result;
}

function extractArticleContent() {
  // Extract main article content, filtering out boilerplate
  const articleSelectors = [
    'article',
    '[class*="article"]',
    '[class*="content"]',
    'main',
    '.post-content',
    '.entry-content'
  ];

  for (const selector of articleSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      // Remove script and style elements
      const cloned = element.cloneNode(true);
      cloned.querySelectorAll('script, style, nav, header, footer, aside, .advertisement, .ads').forEach(el => el.remove());

      const text = cloned.textContent || cloned.innerText || '';
      if (text.trim().length > CONFIG.min_content_length) {
        return text.trim();
      }
    }
  }

  // Fallback: get all paragraph text
  const paragraphs = Array.from(document.querySelectorAll('p')).map(p => p.textContent || p.innerText || '');
  return paragraphs.join(' ').trim();
}

async function processClaimsInBatches(claims) {
  const batchSize = 5; // Process 5 claims at a time

  for (let i = 0; i < claims.length; i += batchSize) {
    const batch = claims.slice(i, i + batchSize);

    try {
      // Process batch in parallel
      const results = await Promise.allSettled(
        batch.map(async (claim) => {
          // Normalize claim
          const normalized = await ClaimNormalizer.normalize(claim);

          // Score claim from all sources
          const scores = await Scorer.scoreClaim(normalized);

          // Check for overrides
          const override = await OverrideEngine.checkOverride(normalized);

          // Apply override if valid
          const finalScore = override ? override.score : scores.final;

          return {
            claim,
            normalized,
            scores,
            override,
            finalScore,
            positions: findClaimPositions(claim)
          };
        })
      );

      // Render highlights for successful results
      results.forEach(result => {
        if (result.status === 'fulfilled') {
          renderClaimHighlight(result.value);
        }
      });

      // Small delay between batches to avoid overwhelming
      if (i + batchSize < claims.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

    } catch (error) {
      Logger.error('Error processing batch:', error);
    }
  }
}

function findClaimPositions(claim) {
  // Find positions of claim text in the DOM
  const positions = [];
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  let node;
  while (node = walker.nextNode()) {
    const text = node.textContent;
    const index = text.toLowerCase().indexOf(claim.toLowerCase());

    if (index !== -1 && text.length < 1000) { // Avoid very long text nodes
      positions.push({
        node,
        startIndex: index,
        endIndex: index + claim.length,
        fullText: text
      });
    }
  }

  return positions;
}

function renderClaimHighlight(result) {
  const { claim, finalScore, positions } = result;

  // Determine highlight color based on score
  let color;
  if (finalScore >= CONFIG.scoring.high_trust) {
    color = CONFIG.display.colors.high;
  } else if (finalScore >= CONFIG.scoring.medium_trust) {
    color = CONFIG.display.colors.medium;
  } else {
    color = CONFIG.display.colors.low;
  }

  // Apply highlights to all positions
  positions.forEach(pos => {
    Highlighter.highlightText(pos.node, pos.startIndex, pos.endIndex, color, result);
  });
}

// Initialize when DOM is ready
console.log('Truth Check: Setting up initialization...');
if (document.readyState === 'loading') {
  console.log('Truth Check: Waiting for DOM to be ready...');
  document.addEventListener('DOMContentLoaded', initializeExtension);
} else {
  console.log('Truth Check: DOM already ready, initializing...');
  initializeExtension();
}
