import type { ApiModel, FrameworkAdapter } from '@devguard/core';
import { detectExpress } from './detector.js';
import { scanProject } from './scanner.js';

export class ExpressAdapter implements FrameworkAdapter {
  readonly name = 'adapter-express';

  /**
   * Detects if the given project root is an Express application.
   */
  async detect(projectRoot: string): Promise<boolean> {
    const result = await detectExpress(projectRoot);
    return result.detected;
  }

  /**
   * Static analysis scanner for Express applications.
   */
  async scan(projectRoot: string): Promise<ApiModel> {
    return scanProject(projectRoot);
  }
}
