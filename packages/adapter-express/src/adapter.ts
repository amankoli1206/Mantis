import type { ApiModel, FrameworkAdapter } from '@devguard/core';
import { detectExpress } from './detector.js';

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
   * Static analysis scanner for Express applications (implemented in Step 5+).
   */
  async scan(projectRoot: string): Promise<ApiModel> {
    void projectRoot;
    throw new Error('ExpressAdapter.scan is not implemented yet (scheduled for Step 5).');
  }
}
