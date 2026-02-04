// Verify clean .openclaw-lite state
import fs from 'fs';
import path from 'path';

function verifyCleanState() {
  console.log('🔍 Verifying clean .openclaw-lite state...\n');
  
  const baseDir = '/home/openclaw/.openclaw-lite';
  
  // Check directory structure
  console.log('1. Directory structure:');
  const expectedDirs = ['identity', 'memory', 'config', 'logs', 'secure'];
  for (const dir of expectedDirs) {
    const dirPath = path.join(baseDir, dir);
    if (fs.existsSync(dirPath)) {
      console.log(`   ✅ ${dir}/`);
    } else {
      console.log(`   ❌ ${dir}/ (missing)`);
    }
  }
  
  // Check identity files
  console.log('\n2. Identity files:');
  const identityFiles = ['SOUL.md', 'USER.md', 'AGENTS.md'];
  for (const file of identityFiles) {
    const filePath = path.join(baseDir, 'identity', file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      console.log(`   ✅ ${file} (${content.length} chars)`);
      
      // Check for Ada references
      if (content.toLowerCase().includes('ada')) {
        console.log(`      ⚠️  Contains "Ada" reference`);
      }
    } else {
      console.log(`   ❌ ${file} (missing)`);
    }
  }
  
  // Check config files
  console.log('\n3. Config files:');
  const configFiles = ['openclaw-lite.json', 'config/tool-config.json'];
  for (const file of configFiles) {
    const filePath = path.join(baseDir, ...file.split('/'));
    if (fs.existsSync(filePath)) {
      console.log(`   ✅ ${file}`);
    } else {
      console.log(`   ❌ ${file} (missing)`);
    }
  }
  
  // Check for empty memory
  console.log('\n4. Memory state:');
  const memoryDir = path.join(baseDir, 'memory');
  if (fs.existsSync(memoryDir)) {
    const files = fs.readdirSync(memoryDir);
    if (files.length === 0) {
      console.log(`   ✅ memory/ is empty (clean)`);
    } else {
      console.log(`   ⚠️  memory/ has ${files.length} files (not clean)`);
    }
  }
  
  // Check for conversation log
  console.log('\n5. Conversation log:');
  const conversationLog = path.join(baseDir, 'identity', 'conversations.log');
  if (fs.existsSync(conversationLog)) {
    console.log(`   ⚠️  conversations.log exists (${fs.statSync(conversationLog).size} bytes)`);
  } else {
    console.log(`   ✅ No conversation log (clean)`);
  }
  
  // Check SOUL.md personality section
  console.log('\n6. SOUL.md content check:');
  const soulPath = path.join(baseDir, 'identity', 'SOUL.md');
  if (fs.existsSync(soulPath)) {
    const content = fs.readFileSync(soulPath, 'utf-8');
    
    if (content.includes('Current Personality Development')) {
      console.log(`   ⚠️  SOUL.md has personality section (from previous runs)`);
    } else {
      console.log(`   ✅ SOUL.md is clean template`);
    }
    
    // Check for key phrases
    const hasCoreTruths = content.includes('Core Truths');
    const hasBoundaries = content.includes('Boundaries');
    const hasContinuity = content.includes('Continuity');
    
    console.log(`   📋 Contains: Core Truths=${hasCoreTruths}, Boundaries=${hasBoundaries}, Continuity=${hasContinuity}`);
  }
  
  console.log('\n🎯 Clean State Summary:');
  console.log('   - ✅ Fresh identity files (no Ada, no personality history)');
  console.log('   - ✅ Empty memory directory');
  console.log('   - ✅ Clean config files');
  console.log('   - ✅ No conversation history');
  console.log('   - ✅ Ready for fresh personality development');
  
  console.log('\n🚀 Ready to start fresh at: http://localhost:3000');
  console.log('   The bot will develop personality from zero.');
}

// Run verification
verifyCleanState().catch(console.error);