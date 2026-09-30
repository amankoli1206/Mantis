import type { ApiModel } from '../schema/model.js';

/**
 * Common interface that framework-specific adapters (e.g., Express, Fastify, NestJS)
 * must implement to scan codebases and produce an ApiModel.
 */
export interface FrameworkAdapter {
  /**
   * The unique identifier name of the adapter (e.g. 'adapter-express').
   */
  readonly name: string;

  /**
   * Detects whether the target project repository matches this framework.
   * @param projectRoot Absolute or relative path to the root of the project to analyze.
   * @returns Promise resolving to true if the adapter can handle the project.
   */
  detect(projectRoot: string): Promise<boolean>;

  /**
   * Performs static analysis on the project root and extracts the unified ApiModel.
   * @param projectRoot Absolute or relative path to the root of the project to analyze.
   * @returns Promise resolving to the extracted ApiModel.
   */
  scan(projectRoot: string): Promise<ApiModel>;
}
