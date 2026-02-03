import { FileLoader } from './dist/identity/file-loader.js';

async function test() {
  const loader = new FileLoader('/home/openclaw/.openclaw/workspace');
  const identity = await loader.loadIdentity();
  console.log('SOUL exists:', !!identity.soul);
  console.log('SOUL length:', identity.soul?.length);
  console.log('SOUL first 200 chars:', identity.soul?.substring(0, 200));
  
  const prompt = await loader.constructSystemPrompt();
  console.log('\nSystem prompt length:', prompt.length);
  console.log('System prompt first 300 chars:', prompt.substring(0, 300));
}

test().catch(console.error);
