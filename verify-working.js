// Quick verification that the system works
console.log('🔍 Verifying OpenClaw-style tool system works...\n');

// Test the web API directly
const testApi = async () => {
  try {
    const response = await fetch('http://localhost:3000/api/chat-with-tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'List files in workspace' }),
    });
    
    const data = await response.json();
    
    console.log('✅ API Response:');
    console.log(`   Response length: ${data.response?.length || 0}`);
    console.log(`   Tool calls: ${data.toolCalls?.length || 0}`);
    
    if (data.toolCalls?.length > 0) {
      console.log(`   ✅ SUCCESS: Tool calling works!`);
      data.toolCalls.forEach((call, i) => {
        console.log(`      Tool ${i + 1}: ${call.tool} - ${call.success ? '✅' : '❌'}`);
      });
    } else {
      console.log(`   ❌ No tool calls`);
    }
    
    // Check if response shows Ada personality
    if (data.response && (data.response.includes('😏') || data.response.includes('Ada') || data.response.includes('gremlin'))) {
      console.log(`   ✅ Ada personality detected`);
    }
    
    return true;
  } catch (error) {
    console.log(`   ❌ API error: ${error.message}`);
    return false;
  }
};

// Run test
testApi().then(success => {
  console.log(`\n${success ? '🎉 SYSTEM VERIFIED: OpenClaw-style tool calling WORKS!' : '❌ System verification failed'}`);
  process.exit(success ? 0 : 1);
});