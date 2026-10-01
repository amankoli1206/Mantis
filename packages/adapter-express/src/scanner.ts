import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  sortEndpoints,
  validateModel,
  type ApiModel,
  type Endpoint,
  type Diagnostic,
} from '@devguard/core';
import { walkProjectFiles } from './file-walker.js';
import { parseFile } from './parser.js';
import { extractDirectRoutes } from './route-extractor.js';

export interface ScanOptions {
  projectName?: string;
}

/**
 * Scans an Express project directory by discovering JavaScript files, parsing ASTs,
 * and extracting direct route definitions.
 */
export async function scanProject(projectRoot: string, options: ScanOptions = {}): Promise<ApiModel> {
  const resolvedRoot = path.resolve(projectRoot);

  // 1. Determine project name
  let projectName = options.projectName;
  if (!projectName) {
    try {
      const rawPkg = await fs.readFile(path.join(resolvedRoot, 'package.json'), 'utf8');
      const pkg = JSON.parse(rawPkg) as { name?: string };
      if (pkg.name) {
        projectName = pkg.name;
      }
    } catch {
      // package.json missing or invalid, fallback to directory name
    }
  }
  if (!projectName) {
    projectName = path.basename(resolvedRoot);
  }

  // 2. Walk project files deterministically
  const { files } = await walkProjectFiles(resolvedRoot);

  const endpoints: Endpoint[] = [];
  const diagnostics: Diagnostic[] = [];

  // Compute root-relative path for project display
  const relativeRoot = path.relative(process.cwd(), resolvedRoot).split(path.sep).join('/') || '.';

  // 3. Process each discovered source file
  for (const relFile of files) {
    const fullPath = path.join(resolvedRoot, relFile);
    let code: string;
    try {
      code = await fs.readFile(fullPath, 'utf8');
    } catch {
      continue;
    }

    // Relative path used for provenance
    const filePathForProvenance =
      relativeRoot && relativeRoot !== '.'
        ? path.join(relativeRoot, relFile).split(path.sep).join('/')
        : relFile;

    // Parse file to AST
    const parseResult = parseFile(code, filePathForProvenance);
    if (parseResult.diagnostics.length > 0) {
      diagnostics.push(...parseResult.diagnostics);
    }

    if (parseResult.ast) {
      // Extract direct routes
      const extractResult = extractDirectRoutes(parseResult.ast, filePathForProvenance, code);
      endpoints.push(...extractResult.endpoints);
      diagnostics.push(...extractResult.diagnostics);
    }
  }

  // 4. Sort endpoints deterministically
  const sortedEndpoints = sortEndpoints(endpoints);

  // 5. Construct final ApiModel
  const model: ApiModel = {
    modelVersion: '1.0.0',
    project: {
      name: projectName,
      framework: 'express',
      language: 'javascript',
      root: relativeRoot,
    },
    endpoints: sortedEndpoints,
    diagnostics,
  };

  // 6. Validate model against core schema
  const validationResult = validateModel(model);
  if (!validationResult.success) {
    throw new Error(
      `Generated ApiModel failed schema validation:\n${validationResult.errors.map((e) => `  - ${e.path}: ${e.message}`).join('\n')}`
    );
  }

  return model;
}
