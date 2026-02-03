#!/usr/bin/env node

import { ToolManager } from './dist/tools/tool-manager.js';

async function testTools() {
  console.log('🧪 Testing OpenClaw Lite Tools...\n');
  
  const toolManager = new ToolManager({
    workspacePath: process.cwd(),
    requireApprovalForDangerous: false
  });
  
  await toolManager.initialize();
  
  // Test 1: List tools
  console.log('📋 Test 1: List available tools');
  const tools = toolManager.listTools();
  console.log(`Found ${tools.length} tools:`);
  tools.forEach(tool => {
    console.log(`  - ${tool.name} (${tool.category})`);
  });
  
  // Test 2: Read file
  console.log('\n📄 Test 2: Read package.json');
  try {
    const result = await toolManager.callTool('read', {
      path: 'package.json'
    }, {
      sessionId: 'test',
      userId: 'test'
    });
    
    if (result.success) {
      const pkg = JSON.parse(result.result);
      console.log(`✅ Package: ${pkg.name} v${pkg.version}`);
    } else {
      console.log(`❌ Failed: ${result.error}`);
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
  
  // Test 3: List files
  console.log('\n📁 Test 3: List files in workspace');
  try {
    const result = await toolManager.callTool('list', {
      path: '.',
      recursive: false
    }, {
      sessionId: 'test',
      userId: 'test'
    });
    
    if (result.success) {
      console.log(`✅ Found ${result.result.length} files/directories`);
      result.result.slice(0, 5).forEach(item => {
        console.log(`  - ${item.name} (${item.type})`);
      });
      if (result.result.length > 5) {
        console.log(`  ... and ${result.result.length - 5} more`);
      }
    } else {
      console.log(`❌ Failed: ${result.error}`);
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
  
  // Test 4: Get environment variables
  console.log('\n🌍 Test 4: Read environment variables');
  try {
    const result = await toolManager.callTool('env', {}, {
      sessionId: 'test',
      userId: 'test'
    });
    
    if (result.success) {
      const envVars = result.result;
      console.log(`✅ Found ${Object.keys(envVars).length} environment variables`);
      console.log(`  - HOME: ${envVars.HOME || 'Not set'}`);
      console.log(`  - USER: ${envVars.USER || 'Not set'}`);
      console.log(`  - PWD: ${envVars.PWD || 'Not set'}`);
    } else {
      console.log(`❌ Failed: ${result.error}`);
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
  
  // Test 5: Create and execute a script
  console.log('\n🛠️ Test 5: Create and execute script');
  try {
    // Create script
    const createResult = await toolManager.callTool('create_script', {
      path: 'test-script.sh',
      content: 'echo "Hello from OpenClaw Lite!"\necho "Current directory: $(pwd)"\necho "User: $(whoami)"',
      interpreter: 'bash'
    }, {
      sessionId: 'test',
      userId: 'test'
    });
    
    if (createResult.success) {
      console.log('✅ Script created');
      
      // Execute script
      const execResult = await toolManager.callTool('exec', {
        command: './test-script.sh'
      }, {
        sessionId: 'test',
        userId: 'test'
      });
      
      if (execResult.success) {
        console.log('✅ Script executed:');
        console.log(execResult.result.stdout);
      } else {
        console.log(`❌ Script execution failed: ${execResult.error}`);
      }
      
      // Clean up
      const deleteResult = await toolManager.callTool('delete', {
        path: 'test-script.sh'
      }, {
        sessionId: 'test',
        userId: 'test'
      });
      
      if (deleteResult.success) {
        console.log('✅ Script cleaned up');
      }
    } else {
      console.log(`❌ Script creation failed: ${createResult.error}`);
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
  
  console.log('\n✅ All tests completed!');
}

// Run tests
testTools().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});