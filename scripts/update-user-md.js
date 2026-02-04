#!/usr/bin/env node
/**
 * Script to update USER.md based on conversation analysis
 * Can be called from PersonalityUpdater or manually
 */

import { OllamaIntegration } from '../dist/ollama/integration.js';
import fs from 'fs';
import path from 'path';

async function updateUserMd() {
  console.log('👤 Updating USER.md based on conversation analysis...\n');
  
  const workspaceDir = path.join(process.env.HOME || '/home/openclaw', '.openclaw-lite');
  const userPath = path.join(workspaceDir, 'identity', 'USER.md');
  const conversationLog = path.join(workspaceDir, 'identity', 'conversations.log');
  
  // Create OllamaIntegration
  const integration = new OllamaIntegration({
    url: 'http://atlas.lan:11434',
    defaultModel: 'Qwen3-4B-Instruct-2507:latest'
  });
  
  // Read current USER.md
  let currentUserContent = '';
  if (fs.existsSync(userPath)) {
    currentUserContent = fs.readFileSync(userPath, 'utf-8');
  } else {
    console.log('❌ USER.md not found');
    return false;
  }
  
  // Read recent conversations
  if (!fs.existsSync(conversationLog)) {
    console.log('❌ No conversation log found');
    return false;
  }
  
  const logContent = fs.readFileSync(conversationLog, 'utf-8');
  const entries = logContent
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(entry => entry !== null)
    .slice(-20); // Last 20 conversations
  
  if (entries.length < 5) {
    console.log('📝 Not enough conversations for analysis');
    return false;
  }
  
  // Prepare conversation context
  const conversationContext = entries.map(entry => 
    `User: ${entry.userMessage}\nAssistant: ${entry.assistantMessage}`
  ).join('\n\n');
  
  // Ask agent to analyze
  const systemPrompt = `You are updating USER.md based on conversations.

## Current USER.md:
${currentUserContent}

## Recent Conversations:
${conversationContext}

## Task:
What important user information from conversations should be added to USER.md?
Focus on missing: interests, preferences, important facts.
Respond with JSON: {"suggestions": [{"field": "field", "value": "value", "reason": "reason"}]}`;

  try {
    const result = await integration.complete(
      [{ role: 'user', content: 'Analyze for USER.md updates', timestamp: new Date() }],
      systemPrompt,
      undefined,
      'Qwen3-4B-Instruct-2507:latest',
      { temperature: 0.3 }
    );
    
    console.log('🤖 Agent analysis complete');
    
    // Try to parse suggestions
    const jsonMatch = result.response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        
        if (parsed.suggestions && parsed.suggestions.length > 0) {
          console.log(`\n📋 ${parsed.suggestions.length} suggestions:`);
          
          // Apply suggestions
          let updatedContent = currentUserContent;
          let changesMade = false;
          
          for (const suggestion of parsed.suggestions) {
            console.log(`   💡 ${suggestion.field}: ${suggestion.value} (${suggestion.reason})`);
            
            // Simple update logic
            if (suggestion.field === 'interests') {
              const lines = updatedContent.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('**Interests:**')) {
                  const current = lines[i].replace('**Interests:**', '').trim();
                  if (!current.toLowerCase().includes(suggestion.value.toLowerCase())) {
                    if (current === '') {
                      lines[i] = `- **Interests:** ${suggestion.value}`;
                    } else {
                      lines[i] = `- **Interests:** ${current}, ${suggestion.value}`;
                    }
                    changesMade = true;
                    console.log(`     ✅ Added to interests`);
                  }
                  break;
                }
              }
            }
          }
          
          if (changesMade) {
            // Create backup
            const backupPath = userPath + '.backup-' + Date.now();
            fs.writeFileSync(backupPath, currentUserContent, 'utf-8');
            
            // Save updated content
            fs.writeFileSync(userPath, updatedContent, 'utf-8');
            
            // Add update note
            const note = `\n\n<!-- Updated by agent on ${new Date().toISOString()} -->`;
            fs.appendFileSync(userPath, note, 'utf-8');
            
            console.log('\n✅ USER.md updated successfully!');
            return true;
          } else {
            console.log('\n📝 No new information to add');
            return false;
          }
        }
      } catch (e) {
        console.log('⚠️  Could not parse agent response:', e.message);
      }
    }
    
    console.log('\n📝 Agent found no updates needed');
    return false;
    
  } catch (error) {
    console.log('❌ Agent analysis failed:', error.message);
    return false;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updateUserMd().catch(console.error);
}

export { updateUserMd };