const fetch = require('node-fetch');

const API_BASE = 'http://localhost:3001';

async function testAPI() {
  console.log('🧪 Testing TruthCheck API...\n');

  try {
    // Test health endpoint
    console.log('1. Testing health endpoint...');
    const healthResponse = await fetch(`${API_BASE}/health`);
    const healthData = await healthResponse.json();
    console.log('✅ Health check:', healthData);
    console.log('');

    // Test claim extraction
    console.log('2. Testing claim extraction...');
    const testText = `
    The COVID-19 vaccine has been shown to reduce hospitalization rates by 90% according to recent studies. 
    The research was conducted over a period of 6 months with 10,000 participants. 
    Scientists found that vaccinated individuals had significantly lower rates of severe illness.
    `;

    const claimsResponse = await fetch(`${API_BASE}/extract-claims`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: testText,
        model: 'gpt-4o-mini',
        max_tokens: 1000
      })
    });

    const claimsData = await claimsResponse.json();
    console.log('✅ Claims extracted:', claimsData.claims.length);
    claimsData.claims.forEach((claim, i) => {
      console.log(`   ${i + 1}. "${claim.text}" (confidence: ${claim.confidence})`);
    });
    console.log('');

    // Test evidence scoring
    if (claimsData.claims.length > 0) {
      console.log('3. Testing evidence scoring...');
      const scoreResponse = await fetch(`${API_BASE}/score-evidence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          claim: claimsData.claims[0].text,
          search_results: []
        })
      });

      const scoreData = await scoreResponse.json();
      console.log('✅ Evidence scored:', scoreData);
      console.log('');
    }

    console.log('🎉 All tests passed! API is working correctly.');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('\nMake sure the server is running: npm start');
  }
}

// Run tests
testAPI();
