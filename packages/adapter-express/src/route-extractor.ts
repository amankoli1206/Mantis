import _traverse, { type NodePath, type Binding, type TraverseOptions } from '@babel/traverse';
import type {
  File,
  Node,
  MemberExpression,
  ImportDeclaration,
  VariableDeclarator,
  CallExpression,
} from '@babel/types';
import {
  createDiagnostic,
  generateEndpointId,
  normalizePath,
  type Diagnostic,
  type Endpoint,
  type Effect,
  type HttpMethod,
} from '@devguard/core';
import type { ModuleGraph } from './module-graph.js';

type TraverseFn = (parent: Node | Node[], opts?: TraverseOptions) => void;

const traverse: TraverseFn =
  typeof _traverse === 'function'
    ? (_traverse as unknown as TraverseFn)
    : ((_traverse as unknown as { default: TraverseFn }).default ?? (_traverse as unknown as TraverseFn));

const SUPPORTED_HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);

function getEffectForMethod(method: string): Effect {
  switch (method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
    case 'OPTIONS':
      return 'read';
    case 'POST':
    case 'PUT':
    case 'PATCH':
      return 'write';
    case 'DELETE':
      return 'destructive';
    default:
      return 'unknown';
  }
}

/**
 * Joins a mount prefix with a route path and normalizes slashes.
 *
 * Examples:
 * - joinPaths('/api', '/users') -> '/api/users'
 * - joinPaths('/api/', '/users') -> '/api/users'
 * - joinPaths('/', '/items/:id') -> '/items/:id'
 * - joinPaths('', '/orphan') -> '/orphan'
 */
export function joinPaths(prefix: string, routePath: string): string {
  const cleanPrefix = prefix.trim();
  const cleanRoute = routePath.trim();

  if (!cleanPrefix || cleanPrefix === '/') {
    return cleanRoute.startsWith('/') ? cleanRoute : '/' + cleanRoute;
  }

  const p = (cleanPrefix.startsWith('/') ? cleanPrefix : '/' + cleanPrefix).replace(/\/+$/, '');
  const r = cleanRoute.startsWith('/') ? cleanRoute : '/' + cleanRoute;

  return `${p}${r}`.replace(/\/+/g, '/');
}

export interface ExtractRoutesResult {
  endpoints: Endpoint[];
  diagnostics: Diagnostic[];
}

export interface PendingRouterRoute {
  method: string;
  routePath: string;
  startLine: number;
  startCol?: number;
  snippet?: string;
  isDynamic: boolean;
  rawExpr?: string;
}

export interface ExtractedMount {
  prefix: string;
  line: number;
  column?: number;
  mountFilePath: string;
  sourceRouterId?: string;
  target:
    | { type: 'identifier'; name: string }
    | { type: 'member'; objectName: string; propertyName: string }
    | { type: 'require'; specifier: string };
}

export interface ExtractedRouter {
  id: string;
  relFile: string;
  filePathForProvenance: string;
  varName: string;
  declLine: number;
  declCol?: number;
  routes: PendingRouterRoute[];
  mounts: Array<{ prefix: string; line: number; mountFilePath: string }>;
}

export interface FileDeclarations {
  relFile: string;
  filePathForProvenance: string;
  directEndpoints: Endpoint[];
  routers: Map<string, ExtractedRouter>;
  mounts: ExtractedMount[];
  diagnostics: Diagnostic[];
}

function getRawExpressionText(node: Node, code: string): string {
  if (typeof node.start === 'number' && typeof node.end === 'number') {
    return code.slice(node.start, node.end);
  }
  return node.type;
}

/**
 * Extracts Express app declarations, direct routes, router instances, and app.use mounts
 * from a single file's AST.
 */
export function extractFileDeclarations(
  ast: File,
  relFile: string,
  filePathForProvenance: string,
  code: string
): FileDeclarations {
  const directEndpoints: Endpoint[] = [];
  const diagnostics: Diagnostic[] = [];
  const routers = new Map<string, ExtractedRouter>();
  const mounts: ExtractedMount[] = [];

  const codeLines = code.split('\n');

  const expressFactoryBindings = new Set<Binding>();
  const expressRouterFactoryBindings = new Set<Binding>();
  const expressAppBindings = new Set<Binding>();
  const expressRouterBindings = new Map<Binding, ExtractedRouter>();

  // Phase 1: Identify Express factory and Router imports / requires
  traverse(ast, {
    ImportDeclaration(pathNode: NodePath<ImportDeclaration>) {
      if (pathNode.node.source.value === 'express') {
        for (const specifier of pathNode.node.specifiers) {
          if (specifier.type === 'ImportDefaultSpecifier' || specifier.type === 'ImportNamespaceSpecifier') {
            const binding = pathNode.scope.getBinding(specifier.local.name);
            if (binding) {
              expressFactoryBindings.add(binding);
            }
          } else if (specifier.type === 'ImportSpecifier') {
            const importedName =
              specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value;
            if (importedName === 'Router') {
              const binding = pathNode.scope.getBinding(specifier.local.name);
              if (binding) {
                expressRouterFactoryBindings.add(binding);
              }
            }
          }
        }
      }
    },

    VariableDeclarator(pathNode: NodePath<VariableDeclarator>) {
      const init = pathNode.node.init;
      if (!init) return;

      // require('express')
      if (
        init.type === 'CallExpression' &&
        init.callee.type === 'Identifier' &&
        init.callee.name === 'require' &&
        init.arguments.length > 0 &&
        init.arguments[0]?.type === 'StringLiteral' &&
        init.arguments[0].value === 'express'
      ) {
        if (pathNode.node.id.type === 'Identifier') {
          const binding = pathNode.scope.getBinding(pathNode.node.id.name);
          if (binding) {
            expressFactoryBindings.add(binding);
          }
        } else if (pathNode.node.id.type === 'ObjectPattern') {
          for (const prop of pathNode.node.id.properties) {
            if (prop.type === 'ObjectProperty') {
              const keyName =
                prop.key.type === 'Identifier'
                  ? prop.key.name
                  : prop.key.type === 'StringLiteral'
                    ? prop.key.value
                    : null;
              if (keyName === 'Router' && prop.value.type === 'Identifier') {
                const binding = pathNode.scope.getBinding(prop.value.name);
                if (binding) {
                  expressRouterFactoryBindings.add(binding);
                }
              }
            }
          }
        }
      }

      // Direct instantiation: const app = require('express')()
      if (
        init.type === 'CallExpression' &&
        init.callee.type === 'CallExpression' &&
        init.callee.callee.type === 'Identifier' &&
        init.callee.callee.name === 'require' &&
        init.callee.arguments.length > 0 &&
        init.callee.arguments[0]?.type === 'StringLiteral' &&
        init.callee.arguments[0].value === 'express'
      ) {
        if (pathNode.node.id.type === 'Identifier') {
          const binding = pathNode.scope.getBinding(pathNode.node.id.name);
          if (binding) {
            expressAppBindings.add(binding);
          }
        }
      }
    },
  });

  // Phase 2: Identify Express app and Router instance declarations
  traverse(ast, {
    VariableDeclarator(pathNode: NodePath<VariableDeclarator>) {
      const init = pathNode.node.init;
      if (!init || init.type !== 'CallExpression') return;

      const varName = pathNode.node.id.type === 'Identifier' ? pathNode.node.id.name : null;
      if (!varName) return;

      const declLine = pathNode.node.loc?.start.line ?? 1;
      const declCol = pathNode.node.loc?.start.column;

      // 1. Check: const app = express()
      let isExpressAppCall = false;
      if (init.callee.type === 'Identifier') {
        const calleeBinding = pathNode.scope.getBinding(init.callee.name);
        if (calleeBinding && expressFactoryBindings.has(calleeBinding)) {
          isExpressAppCall = true;
        }
      }
      if (isExpressAppCall) {
        const appBinding = pathNode.scope.getBinding(varName);
        if (appBinding) {
          expressAppBindings.add(appBinding);
        }
        return;
      }

      // 2. Check: const r = express.Router()
      let isExpressRouterCall = false;
      if (
        init.callee.type === 'MemberExpression' &&
        init.callee.property.type === 'Identifier' &&
        init.callee.property.name === 'Router' &&
        init.callee.object.type === 'Identifier'
      ) {
        const objBinding = pathNode.scope.getBinding(init.callee.object.name);
        if (objBinding && expressFactoryBindings.has(objBinding)) {
          isExpressRouterCall = true;
        }
      }

      // 3. Check: const r = Router() (from const { Router } = require('express'))
      if (init.callee.type === 'Identifier') {
        const routerBinding = pathNode.scope.getBinding(init.callee.name);
        if (routerBinding && expressRouterFactoryBindings.has(routerBinding)) {
          isExpressRouterCall = true;
        }
      }

      // 4. Check: const r = require('express').Router()
      if (
        init.callee.type === 'MemberExpression' &&
        init.callee.property.type === 'Identifier' &&
        init.callee.property.name === 'Router' &&
        init.callee.object.type === 'CallExpression' &&
        init.callee.object.callee.type === 'Identifier' &&
        init.callee.object.callee.name === 'require' &&
        init.callee.object.arguments.length > 0 &&
        init.callee.object.arguments[0]?.type === 'StringLiteral' &&
        init.callee.object.arguments[0].value === 'express'
      ) {
        isExpressRouterCall = true;
      }

      if (isExpressRouterCall) {
        const routerBinding = pathNode.scope.getBinding(varName);
        if (routerBinding) {
          const routerRecord: ExtractedRouter = {
            id: `${relFile}:${varName}`,
            relFile,
            filePathForProvenance,
            varName,
            declLine,
            declCol,
            routes: [],
            mounts: [],
          };
          expressRouterBindings.set(routerBinding, routerRecord);
          routers.set(varName, routerRecord);
        }
      }
    },
  });

  // Phase 3: Extract direct route definitions on app & router instances, and app.use() mounts
  traverse(ast, {
    CallExpression(pathNode: NodePath<CallExpression>) {
      const node = pathNode.node;
      if (node.callee.type !== 'MemberExpression') return;

      const memberExpr = node.callee as MemberExpression;
      if (memberExpr.property.type !== 'Identifier') return;

      const methodName = memberExpr.property.name.toLowerCase();

      // Check if callee object is an App or Router
      let appBinding: Binding | null = null;
      let routerRecord: ExtractedRouter | null = null;

      if (memberExpr.object.type === 'Identifier') {
        const bound = pathNode.scope.getBinding(memberExpr.object.name);
        if (bound) {
          if (expressAppBindings.has(bound)) {
            appBinding = bound;
          }
          if (expressRouterBindings.has(bound)) {
            routerRecord = expressRouterBindings.get(bound)!;
          }
        }
      }

      // 1. Check for app.use('/prefix', ...) or router.use(...) mounts
      if ((appBinding || routerRecord) && methodName === 'use' && node.arguments.length > 0) {
        const firstArg = node.arguments[0];
        let prefix = '/';
        let candidateArgs = node.arguments;

        if (firstArg && firstArg.type === 'StringLiteral') {
          prefix = firstArg.value;
          candidateArgs = node.arguments.slice(1);
        }

        for (const arg of candidateArgs) {
          const line = arg.loc?.start.line ?? node.loc?.start.line ?? 1;
          const column = arg.loc?.start.column ?? node.loc?.start.column;
          const sourceRouterId = routerRecord ? routerRecord.id : undefined;

          if (arg.type === 'Identifier') {
            mounts.push({
              prefix,
              line,
              column,
              mountFilePath: relFile,
              sourceRouterId,
              target: { type: 'identifier', name: arg.name },
            });
          } else if (arg.type === 'MemberExpression' && arg.object.type === 'Identifier') {
            const propName =
              arg.property.type === 'Identifier'
                ? arg.property.name
                : arg.property.type === 'StringLiteral'
                  ? arg.property.value
                  : null;
            if (propName) {
              mounts.push({
                prefix,
                line,
                column,
                mountFilePath: relFile,
                sourceRouterId,
                target: { type: 'member', objectName: arg.object.name, propertyName: propName },
              });
            }
          } else if (
            arg.type === 'CallExpression' &&
            arg.callee.type === 'Identifier' &&
            arg.callee.name === 'require' &&
            arg.arguments.length > 0 &&
            arg.arguments[0]?.type === 'StringLiteral'
          ) {
            mounts.push({
              prefix,
              line,
              column,
              mountFilePath: relFile,
              sourceRouterId,
              target: { type: 'require', specifier: arg.arguments[0].value },
            });
          }
        }
        return;
      }

      // 2. Check for HTTP method calls: get, post, put, delete, etc.
      if (!SUPPORTED_HTTP_METHODS.has(methodName)) return;

      let isLiteralPath = false;
      let routePath = '';
      let rawExpr = '';
      
      let effectiveAppBinding = appBinding;
      let effectiveRouterRecord = routerRecord;
      let isChainedRoute = false;

      // Handle route chaining: e.g. router.route('/users').get(...)
      let currentObj = memberExpr.object;
      while (currentObj.type === 'CallExpression') {
        const callee = currentObj.callee;
        if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          const propName = callee.property.name.toLowerCase();
          if (SUPPORTED_HTTP_METHODS.has(propName)) {
             // It's another HTTP method in the chain, keep going up
             currentObj = callee.object;
             continue;
          } else if (propName === 'route') {
             // Found .route(...)
             isChainedRoute = true;
             if (currentObj.arguments.length > 0) {
               const routeArg = currentObj.arguments[0];
               if (routeArg && routeArg.type === 'StringLiteral') {
                 isLiteralPath = true;
                 routePath = routeArg.value;
               } else if (routeArg) {
                 isLiteralPath = false;
                 rawExpr = getRawExpressionText(routeArg, code);
               }
             }
             // Determine if the base of .route() is an app or router
             if (callee.object.type === 'Identifier') {
               const bound = pathNode.scope.getBinding(callee.object.name);
               if (bound) {
                 if (expressAppBindings.has(bound)) effectiveAppBinding = bound;
                 if (expressRouterBindings.has(bound)) effectiveRouterRecord = expressRouterBindings.get(bound)!;
               }
             }
             break;
          }
        }
        break;
      }

      let firstArg: Node | undefined = undefined;
      if (!isChainedRoute) {
        if (node.arguments.length === 0) return;
        firstArg = node.arguments[0];
        if (firstArg && firstArg.type === 'StringLiteral') {
          isLiteralPath = true;
          routePath = firstArg.value;
        } else if (firstArg) {
          isLiteralPath = false;
          rawExpr = getRawExpressionText(firstArg, code);
        }
      }

      if (!effectiveAppBinding && !effectiveRouterRecord) return;

      const startLine = memberExpr.property.loc?.start.line ?? node.loc?.start.line ?? 1;
      const startCol = memberExpr.property.loc?.start.column ?? node.loc?.start.column;
      const snippet = codeLines[startLine - 1]?.trim();

      // Direct app route
      if (effectiveAppBinding) {
        const methodUpper = methodName.toUpperCase() as HttpMethod;
        const effect = getEffectForMethod(methodName);

        if (isLiteralPath) {
          const paramMatches = [...routePath.matchAll(/:([a-zA-Z0-9_]+)/g)];
          const params = paramMatches.map((match) => ({
            name: match[1] ?? '',
            in: 'path' as const,
            required: true,
            description: `User identifier extracted from path segment :${match[1]}.`,
            provenance: {
              kind: 'literal' as const,
              filePath: filePathForProvenance,
              line: startLine,
            },
          }));

          directEndpoints.push({
            id: generateEndpointId(methodUpper, routePath),
            method: methodUpper,
            path: routePath,
            auth: { type: 'unknown' },
            effect,
            params,
            responses: [],
            middleware: [],
            provenance: {
              kind: 'literal',
              filePath: filePathForProvenance,
              line: startLine,
              ...(startCol !== undefined ? { column: startCol } : {}),
              ...(snippet ? { snippet } : {}),
            },
            confidence: 'confirmed',
            confidenceReason: null,
          });
        } else if (firstArg) {
          diagnostics.push(
            createDiagnostic(
              'DG-R003',
              { rawExpression: rawExpr },
              { file: filePathForProvenance, line: startLine, column: startCol }
            )
          );

          const placeholderPath = `/<uncertain:${rawExpr}>`;
          directEndpoints.push({
            id: generateEndpointId(methodUpper, placeholderPath),
            method: methodUpper,
            path: placeholderPath,
            auth: { type: 'unknown' },
            effect,
            params: [],
            responses: [],
            middleware: [],
            provenance: {
              kind: 'unresolved',
              filePath: filePathForProvenance,
              line: startLine,
              ...(startCol !== undefined ? { column: startCol } : {}),
              ...(snippet ? { snippet } : {}),
            },
            confidence: 'uncertain',
            confidenceReason: 'DG-R003',
          });
        }
      }

      // Route defined on router instance (to be resolved with mount prefix)
      if (effectiveRouterRecord) {
        effectiveRouterRecord.routes.push({
          method: methodName,
          routePath,
          startLine,
          startCol,
          snippet,
          isDynamic: !isLiteralPath,
          rawExpr,
        });
      }
    },
  });

  return {
    relFile,
    filePathForProvenance,
    directEndpoints,
    routers,
    mounts,
    diagnostics,
  };
}

interface MountLocationInfo {
  file: string;
  line: number;
  column?: number;
  prefix: string;
}

/**
 * Resolves an exported symbol from targetFile to its underlying ExtractedRouter,
 * following re-exports across file boundaries with cycle protection.
 */
function resolveExportedRouter(
  targetFile: string,
  exportedName: string,
  moduleGraph: ModuleGraph,
  routersByFile: Map<string, Map<string, ExtractedRouter>>,
  diagnostics: Diagnostic[],
  visited: Set<string>,
  mountLocation: MountLocationInfo
): ExtractedRouter | null {
  const visitKey = `${targetFile}:${exportedName}`;
  if (visited.has(visitKey)) {
    // Cycle detected!
    diagnostics.push(
      createDiagnostic(
        'DG-R002',
        { mountPath: mountLocation.prefix, routerIdentifier: `<cyclic: ${targetFile}:${exportedName}>` },
        { file: mountLocation.file, line: mountLocation.line, column: mountLocation.column }
      )
    );
    return null;
  }
  visited.add(visitKey);

  const node = moduleGraph.nodes.get(targetFile);
  if (!node) {
    diagnostics.push(
      createDiagnostic(
        'DG-R002',
        { mountPath: mountLocation.prefix, routerIdentifier: targetFile },
        { file: mountLocation.file, line: mountLocation.line, column: mountLocation.column }
      )
    );
    return null;
  }

  // Find matching export in targetFile
  const exp = node.exports.find(
    (e) => e.exportedName === exportedName || (exportedName !== 'default' && e.exportedName === '*')
  );

  if (!exp) {
    diagnostics.push(
      createDiagnostic(
        'DG-R002',
        { mountPath: mountLocation.prefix, routerIdentifier: `${targetFile}:${exportedName}` },
        { file: mountLocation.file, line: mountLocation.line, column: mountLocation.column }
      )
    );
    return null;
  }

  // Case A: exp has a localName (e.g. module.exports = router, export default router, exports.foo = router)
  if (exp.localName) {
    // 1. Is it a router declared directly in targetFile?
    const router = routersByFile.get(targetFile)?.get(exp.localName);
    if (router) {
      return router;
    }

    // 2. Is it a re-export of an import in targetFile? (e.g. const admin = require('./admin'); module.exports = admin;)
    const imp = node.imports.find((i) => i.localName === exp.localName);
    if (imp) {
      if (imp.isExternal || !imp.sourcePath) {
        diagnostics.push(
          createDiagnostic(
            'DG-R002',
            { mountPath: mountLocation.prefix, routerIdentifier: imp.specifier },
            { file: mountLocation.file, line: mountLocation.line, column: mountLocation.column }
          )
        );
        return null;
      }
      return resolveExportedRouter(
        imp.sourcePath,
        imp.importedName === '*' ? exportedName : imp.importedName,
        moduleGraph,
        routersByFile,
        diagnostics,
        visited,
        mountLocation
      );
    }
  }

  // Case B: exp.localName is null (e.g. module.exports = require('./admin'))
  // Find import in targetFile matching exp.line
  const lineImp = node.imports.find((i) => i.line === exp.line);
  if (lineImp) {
    if (lineImp.isExternal || !lineImp.sourcePath) {
      diagnostics.push(
        createDiagnostic(
          'DG-R002',
          { mountPath: mountLocation.prefix, routerIdentifier: lineImp.specifier },
          { file: mountLocation.file, line: mountLocation.line, column: mountLocation.column }
        )
      );
      return null;
    }
    return resolveExportedRouter(
      lineImp.sourcePath,
      lineImp.importedName === '*' ? exportedName : lineImp.importedName,
      moduleGraph,
      routersByFile,
      diagnostics,
      visited,
      mountLocation
    );
  }

  // Export found, but target is not an Express router (e.g. a plain middleware function or constant)
  // Non-routers don't emit DG-R002 unless explicitly unresolvable
  return null;
}

/**
 * Resolves a mount candidate to an ExtractedRouter instance.
 */
function resolveMountToRouter(
  mount: ExtractedMount,
  moduleGraph: ModuleGraph,
  routersByFile: Map<string, Map<string, ExtractedRouter>>,
  diagnostics: Diagnostic[],
  visited: Set<string>,
  mountFileForProvenance: string
): ExtractedRouter | null {
  const mountFilePath = mount.mountFilePath;
  const target = mount.target;

  // 1. Target is a local identifier in the same file or imported identifier
  if (target.type === 'identifier') {
    // Check if target is a local router in the same file
    const localRouter = routersByFile.get(mountFilePath)?.get(target.name);
    if (localRouter) {
      return localRouter;
    }

    // Check if target is an imported binding in mountFilePath
    const node = moduleGraph.nodes.get(mountFilePath);
    const imp = node?.imports.find((i) => i.localName === target.name);
    if (imp) {
      if (imp.isExternal || !imp.sourcePath) {
        diagnostics.push(
          createDiagnostic(
            'DG-R002',
            { mountPath: mount.prefix, routerIdentifier: target.name },
            { file: mountFileForProvenance, line: mount.line, column: mount.column }
          )
        );
        return null;
      }

      return resolveExportedRouter(
        imp.sourcePath,
        imp.importedName,
        moduleGraph,
        routersByFile,
        diagnostics,
        visited,
        { file: mountFileForProvenance, line: mount.line, column: mount.column, prefix: mount.prefix }
      );
    }

    // Target is not a recognized router or import
    // If mount prefix is not root, it might be an unresolvable mount
    if (mount.prefix !== '/') {
      diagnostics.push(
        createDiagnostic(
          'DG-R002',
          { mountPath: mount.prefix, routerIdentifier: target.name },
          { file: mountFileForProvenance, line: mount.line, column: mount.column }
        )
      );
    }
    return null;
  }

  // 2. Target is member expression on imported namespace/module (e.g. ordersMod.ordersRouter)
  if (target.type === 'member') {
    const node = moduleGraph.nodes.get(mountFilePath);
    const imp = node?.imports.find((i) => i.localName === target.objectName);
    if (imp) {
      if (imp.isExternal || !imp.sourcePath) {
        diagnostics.push(
          createDiagnostic(
            'DG-R002',
            { mountPath: mount.prefix, routerIdentifier: `${target.objectName}.${target.propertyName}` },
            { file: mountFileForProvenance, line: mount.line, column: mount.column }
          )
        );
        return null;
      }

      return resolveExportedRouter(
        imp.sourcePath,
        target.propertyName,
        moduleGraph,
        routersByFile,
        diagnostics,
        visited,
        { file: mountFileForProvenance, line: mount.line, column: mount.column, prefix: mount.prefix }
      );
    }

    diagnostics.push(
      createDiagnostic(
        'DG-R002',
        { mountPath: mount.prefix, routerIdentifier: `${target.objectName}.${target.propertyName}` },
        { file: mountFileForProvenance, line: mount.line, column: mount.column }
      )
    );
    return null;
  }

  // 3. Target is direct require call: require('./admin')
  if (target.type === 'require') {
    const node = moduleGraph.nodes.get(mountFilePath);
    const imp = node?.imports.find((i) => i.specifier === target.specifier && i.line === mount.line);
    if (imp && imp.sourcePath) {
      return resolveExportedRouter(
        imp.sourcePath,
        'default',
        moduleGraph,
        routersByFile,
        diagnostics,
        visited,
        { file: mountFileForProvenance, line: mount.line, column: mount.column, prefix: mount.prefix }
      );
    }

    diagnostics.push(
      createDiagnostic(
        'DG-R002',
        { mountPath: mount.prefix, routerIdentifier: `require('${target.specifier}')` },
        { file: mountFileForProvenance, line: mount.line, column: mount.column }
      )
    );
    return null;
  }

  return null;
}

/**
 * Resolves routes across multiple files by attaching mounts to routers and
 * generating fully qualified endpoint objects.
 */
export function resolveCrossFileRoutes(
  fileDeclarations: Map<string, FileDeclarations>,
  moduleGraph: ModuleGraph
): ExtractRoutesResult {
  const endpoints: Endpoint[] = [];
  const diagnostics: Diagnostic[] = [];

  // 1. Collect direct app endpoints from all files
  for (const decl of fileDeclarations.values()) {
    endpoints.push(...decl.directEndpoints);
    diagnostics.push(...decl.diagnostics);
  }

  // 2. Group routers by relFile and global map
  const routersByFile = new Map<string, Map<string, ExtractedRouter>>();
  const allRouters = new Map<string, ExtractedRouter>();
  for (const [relFile, decl] of fileDeclarations) {
    routersByFile.set(relFile, decl.routers);
    for (const router of decl.routers.values()) {
      allRouters.set(router.id, router);
    }
  }

  // 3. Resolve each mount to its target router
  interface ResolvedMount {
    prefix: string;
    targetRouter: ExtractedRouter;
    line: number;
    column?: number;
    mountFilePath: string;
  }
  
  const appMounts: ResolvedMount[] = [];
  const routerMounts = new Map<string, ResolvedMount[]>();

  for (const [, decl] of fileDeclarations) {
    for (const mount of decl.mounts) {
      const visited = new Set<string>();
      const targetRouter = resolveMountToRouter(
        mount,
        moduleGraph,
        routersByFile,
        diagnostics,
        visited,
        decl.filePathForProvenance
      );
      
      if (targetRouter) {
        const resolved: ResolvedMount = {
          prefix: mount.prefix,
          targetRouter,
          line: mount.line,
          column: mount.column,
          mountFilePath: decl.filePathForProvenance,
        };
        
        if (mount.sourceRouterId) {
          if (!routerMounts.has(mount.sourceRouterId)) {
            routerMounts.set(mount.sourceRouterId, []);
          }
          routerMounts.get(mount.sourceRouterId)!.push(resolved);
        } else {
          appMounts.push(resolved);
        }
      }
    }
  }

  // 4. DFS from app mounts to generate full prefixes for each router
  const resolvedPrefixes = new Map<string, string[]>();
  
  function dfs(
    currentRouter: ExtractedRouter, 
    currentPrefix: string, 
    visitedPath: Set<string>, 
    mountLine: number, 
    mountCol: number | undefined, 
    mountFile: string
  ) {
    if (visitedPath.has(currentRouter.id)) {
      diagnostics.push(
        createDiagnostic(
          'DG-R002',
          { mountPath: currentPrefix, routerIdentifier: `<cyclic: ${currentRouter.id}>` },
          { file: mountFile, line: mountLine, column: mountCol }
        )
      );
      return;
    }

    if (!resolvedPrefixes.has(currentRouter.id)) {
      resolvedPrefixes.set(currentRouter.id, []);
    }
    resolvedPrefixes.get(currentRouter.id)!.push(currentPrefix);

    const nextVisited = new Set(visitedPath);
    nextVisited.add(currentRouter.id);

    const children = routerMounts.get(currentRouter.id) || [];
    for (const childMount of children) {
      const nextPrefix = joinPaths(currentPrefix, childMount.prefix);
      dfs(childMount.targetRouter, nextPrefix, nextVisited, childMount.line, childMount.column, childMount.mountFilePath);
    }
  }

  for (const am of appMounts) {
    dfs(am.targetRouter, am.prefix, new Set(), am.line, am.column, am.mountFilePath);
  }

  // 5. Generate endpoints for all routers
  for (const router of allRouters.values()) {
    const prefixes = resolvedPrefixes.get(router.id);
    
    if (!prefixes || prefixes.length === 0) {
      // Unmounted router: emit DG-R002 and mark all its routes as uncertain
      diagnostics.push(
        createDiagnostic(
          'DG-R002',
          { mountPath: '<unmounted>', routerIdentifier: router.varName },
          { file: router.filePathForProvenance, line: router.declLine, column: router.declCol }
        )
      );

      for (const route of router.routes) {
        const methodUpper = route.method.toUpperCase() as HttpMethod;
        const effect = getEffectForMethod(route.method);
        const finalPath = route.isDynamic ? `/<uncertain:${route.rawExpr}>` : normalizePath(route.routePath);

        endpoints.push({
          id: generateEndpointId(methodUpper, finalPath),
          method: methodUpper,
          path: finalPath,
          auth: { type: 'unknown' },
          effect,
          params: [],
          responses: [],
          middleware: [],
          provenance: {
            kind: 'unresolved',
            filePath: router.filePathForProvenance,
            line: route.startLine,
            ...(route.startCol !== undefined ? { column: route.startCol } : {}),
            ...(route.snippet ? { snippet: route.snippet } : {}),
          },
          confidence: 'uncertain',
          confidenceReason: 'DG-R002',
        });
      }
    } else {
      // Mounted router: emit resolved endpoints for each mount prefix
      for (const prefix of prefixes) {
        for (const route of router.routes) {
          const methodUpper = route.method.toUpperCase() as HttpMethod;
          const effect = getEffectForMethod(route.method);

          if (route.isDynamic) {
            diagnostics.push(
              createDiagnostic(
                'DG-R003',
                { rawExpression: route.rawExpr! },
                { file: router.filePathForProvenance, line: route.startLine, column: route.startCol }
              )
            );

            const placeholderPath = joinPaths(prefix, `<uncertain:${route.rawExpr}>`);
            endpoints.push({
              id: generateEndpointId(methodUpper, placeholderPath),
              method: methodUpper,
              path: placeholderPath,
              auth: { type: 'unknown' },
              effect,
              params: [],
              responses: [],
              middleware: [],
              provenance: {
                kind: 'unresolved',
                filePath: router.filePathForProvenance,
                line: route.startLine,
                ...(route.startCol !== undefined ? { column: route.startCol } : {}),
                ...(route.snippet ? { snippet: route.snippet } : {}),
              },
              confidence: 'uncertain',
              confidenceReason: 'DG-R003',
            });
          } else {
            const finalPath = joinPaths(prefix, route.routePath);
            const paramMatches = [...finalPath.matchAll(/:([a-zA-Z0-9_]+)/g)];
            const params = paramMatches.map((match) => ({
              name: match[1] ?? '',
              in: 'path' as const,
              required: true,
              description: `User identifier extracted from path segment :${match[1]}.`,
              provenance: {
                kind: 'literal' as const,
                filePath: router.filePathForProvenance,
                line: route.startLine,
              },
            }));

            endpoints.push({
              id: generateEndpointId(methodUpper, finalPath),
              method: methodUpper,
              path: finalPath,
              auth: { type: 'unknown' },
              effect,
              params,
              responses: [],
              middleware: [],
              provenance: {
                kind: 'resolved',
                filePath: router.filePathForProvenance,
                line: route.startLine,
                ...(route.startCol !== undefined ? { column: route.startCol } : {}),
                ...(route.snippet ? { snippet: route.snippet } : {}),
              },
              confidence: 'confirmed',
              confidenceReason: null,
            });
          }
        }
      }
    }
  }

  return {
    endpoints,
    diagnostics,
  };
}

/**
 * Extracts Express routes from a single file's AST using scope-aware identifier binding.
 * Retained for backwards compatibility with single-file callers.
 */
export function extractDirectRoutes(
  ast: File,
  filePath: string,
  code: string
): ExtractRoutesResult {
  const fileDecl = extractFileDeclarations(ast, filePath, filePath, code);
  const fileDeclarations = new Map<string, FileDeclarations>([[filePath, fileDecl]]);
  const emptyGraph: ModuleGraph = {
    nodes: new Map(),
    diagnostics: [],
  };
  return resolveCrossFileRoutes(fileDeclarations, emptyGraph);
}
