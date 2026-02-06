import packageJson from '../package.json' assert { type: 'json' };

export const APP_NAME = packageJson.name ?? 'openclaw-lite';
export const APP_VERSION = packageJson.version ?? '0.0.0';
