import { z } from 'zod';

// Environment variable schema
const envSchema = z.object({
  // Ollama configuration
  OLLAMA_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_DEFAULT_MODEL: z.string().default('llama3.1:8b'),
  OLLAMA_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
  OLLAMA_MAX_TOKENS: z.coerce.number().positive().default(2048),
  
  // Context management
  CONTEXT_MAX_TOKENS: z.coerce.number().positive().default(4000),
  CONTEXT_COMPRESSION_STRATEGY: z.enum(['truncate', 'selective', 'hybrid']).default('hybrid'),
  CONTEXT_KEEP_FIRST_LAST: z.coerce.boolean().default(true),
  
  // Memory system
  MEMORY_ENABLED: z.coerce.boolean().default(false),
  MEMORY_STORAGE_PATH: z.string().default('.openclaw-lite/memory'),
  MEMORY_MAX_SESSIONS: z.coerce.number().positive().default(100),
  MEMORY_PRUNE_DAYS: z.coerce.number().positive().default(30),
  
  // Model selection
  MODEL_DEFAULT_PRIORITY: z.enum(['local', 'cost', 'speed', 'quality']).default('local'),
  MODEL_FALLBACK_MODEL: z.string().default('llama3.1:8b'),
  
  // Web server
  WEB_PORT: z.coerce.number().min(1).max(65535).default(3000),
  WEB_ENABLE_CORS: z.coerce.boolean().default(true),
  WEB_MAX_CONTEXT_TOKENS: z.coerce.number().positive().default(8192),
  
  // Workspace
  OPENCLAW_WORKSPACE: z.string().default('.'),
});

// Parsed environment variables
export type EnvConfig = z.infer<typeof envSchema>;

// Parse and validate environment variables
export function parseEnv(): EnvConfig {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.warn('⚠️  Environment variable validation errors:');
      error.errors.forEach((err) => {
        console.warn(`   ${err.path.join('.')}: ${err.message}`);
      });
      console.warn('   Using default values for invalid environment variables.');
    }
    
    // Return defaults for invalid env vars
    return envSchema.parse({});
  }
}

// Singleton instance
let envConfig: EnvConfig | null = null;

export function getEnvConfig(): EnvConfig {
  if (!envConfig) {
    envConfig = parseEnv();
  }
  return envConfig;
}

// Helper functions
export function getOllamaConfig() {
  const env = getEnvConfig();
  return {
    baseUrl: env.OLLAMA_URL,
    defaultModel: env.OLLAMA_DEFAULT_MODEL,
    temperature: env.OLLAMA_TEMPERATURE,
    maxTokens: env.OLLAMA_MAX_TOKENS,
  };
}

export function getContextConfig() {
  const env = getEnvConfig();
  return {
    maxContextTokens: env.CONTEXT_MAX_TOKENS,
    compressionStrategy: env.CONTEXT_COMPRESSION_STRATEGY,
    keepFirstLast: env.CONTEXT_KEEP_FIRST_LAST,
  };
}

export function getMemoryConfig() {
  const env = getEnvConfig();
  return {
    enabled: env.MEMORY_ENABLED,
    storagePath: env.MEMORY_STORAGE_PATH,
    maxSessions: env.MEMORY_MAX_SESSIONS,
    pruneDays: env.MEMORY_PRUNE_DAYS,
  };
}

export function getModelSelectionConfig() {
  const env = getEnvConfig();
  return {
    defaultPriority: env.MODEL_DEFAULT_PRIORITY,
    fallbackModel: env.MODEL_FALLBACK_MODEL,
  };
}

export function getWebConfig() {
  const env = getEnvConfig();
  return {
    port: env.WEB_PORT,
    enableCors: env.WEB_ENABLE_CORS,
    maxContextTokens: env.WEB_MAX_CONTEXT_TOKENS,
  };
}

// Load .env file if it exists
export async function loadEnvFile() {
  try {
    const fs = await import('fs');
    const path = await import('path');
    
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      const lines = content.split('\n');
      
      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          const value = valueParts.join('=').trim();
          
          if (key && !process.env[key]) {
            process.env[key] = value;
          }
        }
      });
      
      console.log('✅ Loaded environment variables from .env file');
    }
  } catch (error) {
    // Silently ignore if .env file doesn't exist or can't be read
  }
}

// Initialize on import
loadEnvFile();