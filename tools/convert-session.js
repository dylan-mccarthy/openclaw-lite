#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function convertSessionToConversation(sessionPath, outputPath = null) {
  console.log(`📂 Converting session: ${path.basename(sessionPath)}`);
  
  try {
    const content = fs.readFileSync(sessionPath, 'utf-8');
    const lines = content.trim().split('\n');
    
    const messages = [];
    let currentUserMessage = null;
    let currentAssistantMessage = null;
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        
        if (entry.type === 'message' && entry.message) {
          const msg = entry.message;
          
          // Extract text from content (could be array or string)
          let text = '';
          if (Array.isArray(msg.content)) {
            text = msg.content
              .filter(item => item.type === 'text')
              .map(item => item.text)
              .join('\n');
          } else if (typeof msg.content === 'string') {
            text = msg.content;
          }
          
          // Clean up metadata
          text = text.replace(/\[message_id: [^\]]+\]/g, '');
          text = text.replace(/A new session was started via \/new or \/reset\.[^]*Do not mention internal steps, files, tools, or reasoning\./g, '');
          text = text.trim();
          
          if (!text) continue;
          
          if (msg.role === 'user') {
            messages.push({
              role: 'user',
              content: text,
              timestamp: new Date(entry.timestamp || Date.now())
            });
          } else if (msg.role === 'assistant') {
            messages.push({
              role: 'assistant', 
              content: text,
              timestamp: new Date(entry.timestamp || Date.now())
            });
          }
        }
      } catch (parseError) {
        // Skip invalid JSON lines
        continue;
      }
    }
    
    console.log(`   Found ${messages.length} messages`);
    
    // Save if output path provided
    if (outputPath) {
      fs.writeFileSync(outputPath, JSON.stringify(messages, null, 2));
      console.log(`   Saved to: ${outputPath}`);
    }
    
    return messages;
    
  } catch (error) {
    console.error(`❌ Error converting session: ${error.message}`);
    return [];
  }
}

function analyzeConversation(messages) {
  console.log('\n📊 Conversation Analysis:');
  console.log('─'.repeat(40));
  
  const userMessages = messages.filter(m => m.role === 'user');
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  
  console.log(`Total messages: ${messages.length}`);
  console.log(`User messages: ${userMessages.length}`);
  console.log(`Assistant messages: ${assistantMessages.length}`);
  
  // Calculate token estimates (rough)
  const totalChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
  const estimatedTokens = Math.ceil(totalChars / 4);
  
  console.log(`Total characters: ${totalChars}`);
  console.log(`Estimated tokens: ${estimatedTokens}`);
  
  // Show message length distribution
  const lengths = messages.map(m => m.content.length);
  const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const maxLength = Math.max(...lengths);
  
  console.log(`Avg message length: ${avgLength.toFixed(0)} chars`);
  console.log(`Longest message: ${maxLength} chars`);
  
  // Show sample
  console.log('\n📝 Message Samples:');
  messages.slice(0, 3).forEach((msg, i) => {
    const preview = msg.content.length > 60 
      ? msg.content.substring(0, 57) + '...' 
      : msg.content;
    console.log(`  ${i + 1}. [${msg.role}] ${preview}`);
  });
  
  if (messages.length > 3) {
    console.log(`  ... and ${messages.length - 3} more messages`);
  }
  
  return {
    totalMessages: messages.length,
    estimatedTokens,
    avgLength,
    maxLength
  };
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node convert-session.js <session-file> [output-file]');
    console.log('\nExample:');
    console.log('  node convert-session.js ../.openclaw/agents/main/sessions/*.jsonl conversation.json');
    console.log('\nAvailable sessions:');
    
    const sessionsDir = path.join(__dirname, '../../.openclaw/agents/main/sessions');
    if (fs.existsSync(sessionsDir)) {
      const files = fs.readdirSync(sessionsDir)
        .filter(f => f.endsWith('.jsonl') && !f.includes('.deleted'))
        .slice(0, 10);
      
      files.forEach(file => {
        const size = fs.statSync(path.join(sessionsDir, file)).size;
        console.log(`  - ${file} (${(size / 1024).toFixed(1)} KB)`);
      });
    }
    
    return;
  }
  
  const sessionPath = args[0];
  const outputPath = args[1] || null;
  
  if (!fs.existsSync(sessionPath)) {
    console.error(`File not found: ${sessionPath}`);
    return;
  }
  
  const messages = convertSessionToConversation(sessionPath, outputPath);
  
  if (messages.length > 0) {
    const analysis = analyzeConversation(messages);
    
    console.log('\n🎯 OpenClaw Lite Context Analysis:');
    console.log('─'.repeat(40));
    
    const contextLimits = [
      { name: '4K model', tokens: 4000, usable: 3000 },
      { name: '8K model', tokens: 8000, usable: 7000 },
      { name: '32K model', tokens: 32000, usable: 31000 }
    ];
    
    contextLimits.forEach(limit => {
      const fits = analysis.estimatedTokens <= limit.usable;
      const icon = fits ? '✅' : '⚠️ ';
      const percent = (analysis.estimatedTokens / limit.usable * 100).toFixed(1);
      
      console.log(`${icon} ${limit.name}: ${analysis.estimatedTokens} / ${limit.usable} tokens (${percent}%)`);
      
      if (!fits) {
        const compressionNeeded = analysis.estimatedTokens - limit.usable;
        console.log(`   Would need to compress by ~${compressionNeeded} tokens`);
      }
    });
    
    console.log('\n💡 Recommendation:');
    if (analysis.estimatedTokens <= 3000) {
      console.log('  Use 4K model (llama3.1:8b) - fits perfectly');
    } else if (analysis.estimatedTokens <= 7000) {
      console.log('  Use 8K model (llama3.1:8b) - fits well');
    } else if (analysis.estimatedTokens <= 31000) {
      console.log('  Use 32K model (qwen2.5-coder:7b) - needed for long context');
    } else {
      console.log('  ⚠️  Conversation too long even for 32K model');
      console.log('  Would need significant compression or summarization');
    }
  }
}

main().catch(console.error);