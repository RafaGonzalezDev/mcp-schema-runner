import type { McpServerConfig } from '../../../shared/types.js';
import { projectPath, projectRoot } from './projectPaths.js';

/** Resolve cwd only. Arguments belong to the executable and remain literal. */
export function withAbsolutePaths(config: McpServerConfig): McpServerConfig {
  return { ...config, cwd: config.cwd ? projectPath(config.cwd) : projectRoot };
}
