import http from 'http';

async function testWebTools() {
  console.log('Testing web tool endpoints...\n');
  
  // Test 1: List tools
  console.log('1. Listing available tools...');
  const toolsRes = await fetch('http://localhost:3000/api/tools');
  const toolsData = await toolsRes.json();
  console.log(`Available tools: ${toolsData.tools.length}`);
  toolsData.tools.forEach(tool => {
    console.log(`  - ${tool.name}: ${tool.description} ${tool.dangerous ? '⚠️' : ''}`);
  });
  
  // Test 2: Read a file
  console.log('\n2. Testing read tool...');
  const readRes = await fetch('http://localhost:3000/api/tools/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tool: 'read',
      args: { path: 'package.json' },
      sessionId: 'test-session-123'
    })
  });
  const readData = await readRes.json();
  console.log(`Read success: ${readData.success}`);
  if (readData.success) {
    const pkg = JSON.parse(readData.result);
    console.log(`Package: ${pkg.name} v${pkg.version}`);
  } else {
    console.log(`Error: ${readData.error}`);
  }
  
  // Test 3: List directory
  console.log('\n3. Testing list tool...');
  const listRes = await fetch('http://localhost:3000/api/tools/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tool: 'list',
      args: { path: '.', recursive: false },
      sessionId: 'test-session-123'
    })
  });
  const listData = await listRes.json();
  console.log(`List success: ${listData.success}`);
  if (listData.success) {
    console.log(`Found ${listData.result.length} entries`);
  }
  
  // Test 4: Check tool logs
  console.log('\n4. Checking tool logs...');
  const logsRes = await fetch('http://localhost:3000/api/tools/logs?limit=5');
  const logsData = await logsRes.json();
  console.log(`Recent tool calls: ${logsData.logs.length}`);
  logsData.logs.forEach(log => {
    console.log(`  ${log.call.tool}: ${log.result.success ? '✅' : '❌'} (${log.result.duration}ms)`);
  });
  
  // Test 5: Check health endpoint includes tools
  console.log('\n5. Checking health endpoint...');
  const healthRes = await fetch('http://localhost:3000/api/health');
  const healthData = await healthRes.json();
  console.log(`Tools enabled: ${healthData.tools.enabled}`);
  console.log(`Tool count: ${healthData.tools.count}`);
  
  console.log('\n✅ All tests completed!');
}

// Check if server is running
async function checkServer() {
  try {
    const res = await fetch('http://localhost:3000/api/health', { timeout: 2000 });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const serverRunning = await checkServer();
  if (!serverRunning) {
    console.log('⚠️  Server not running. Starting server...');
    // In a real test, we'd start the server here
    console.log('Please start the server with: npm run dev');
    process.exit(1);
  }
  
  await testWebTools();
}

main().catch(console.error);