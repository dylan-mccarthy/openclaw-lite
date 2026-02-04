import { ToolManager } from './dist/tools/tool-manager.js';

async function testTools() {
  console.log('Testing ToolManager...\n');
  
  const toolManager = new ToolManager({
    workspacePath: process.cwd(),
    requireApprovalForDangerous: false,
    maxLogSize: 1000
  });

  // List available tools
  console.log('Available tools:');
  const tools = toolManager.listTools();
  tools.forEach(tool => {
    console.log(`  - ${tool.name}: ${tool.description}`);
  });

  console.log('\n--- Testing read tool ---');
  try {
    const result = await toolManager.callTool('read', {
      path: 'package.json'
    }, {
      sessionId: 'test-session',
      workspacePath: process.cwd()
    });
    
    console.log('Read successful:', result.success);
    if (result.success) {
      const pkg = JSON.parse(result.result);
      console.log('Package name:', pkg.name);
    } else {
      console.log('Error:', result.error);
    }
  } catch (error) {
    console.error('Read failed:', error);
  }

  console.log('\n--- Testing list tool ---');
  try {
    const result = await toolManager.callTool('list', {
      path: '.',
      recursive: false
    }, {
      sessionId: 'test-session',
      workspacePath: process.cwd()
    });
    
    console.log('List successful:', result.success);
    if (result.success) {
      console.log(`Found ${result.result.length} entries`);
      result.result.slice(0, 5).forEach(entry => {
        console.log(`  ${entry.type === 'directory' ? '📁' : '📄'} ${entry.name}`);
      });
      if (result.result.length > 5) {
        console.log(`  ... and ${result.result.length - 5} more`);
      }
    } else {
      console.log('Error:', result.error);
    }
  } catch (error) {
    console.error('List failed:', error);
  }

  console.log('\n--- Testing usage log ---');
  const logs = await toolManager.getUsageLog();
  console.log(`Total tool calls: ${logs.length}`);
  logs.forEach(log => {
    console.log(`  ${log.call.tool}: ${log.result.success ? '✅' : '❌'} (${log.result.duration}ms)`);
  });
}

testTools().catch(console.error);