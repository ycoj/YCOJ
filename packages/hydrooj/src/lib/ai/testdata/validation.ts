import { validateAiModelRuntimeConfig } from '../validation';
import type { AiTestdataRuntimeConfig } from './runtime';

export function validateAiTestdataConfig(config: AiTestdataRuntimeConfig) {
    validateAiModelRuntimeConfig(config, 'AI test-data generation is disabled.');
    if (!/^https?:\/\//.test(config.sandboxHost)) throw new Error('Invalid go-judge Session API host.');
}
