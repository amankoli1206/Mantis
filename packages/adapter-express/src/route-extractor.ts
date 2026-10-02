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

interface PendingRouterRoute {
  method: string;
  routePath: string;
  startLine: number;
  startCol?: number;
  snippet?: string;
  isDynamic: boolean;
  rawExpr?: string;
}

interface SingleFileRouterRecord {
  binding: Binding;
  varName: string;
  declLine: number;
  declCol?: number;
  routes: PendingRouterRoute[];
  mounts: Array<{ prefix: string; line: number }>;
}

/**
 * Extracts Express routes from an AST using scope-aware identifier binding.
 *
 * Supports:
 * - Direct app routes: `app.get('/path', ...)`
 * - Single-file router instances: `const r = express.Router()`, `r.get('/path', ...)`, `app.use('/prefix', r)`
 * - Unmounted routers (flagged as uncertain with DG-R002)
 */
export function extractDirectRoutes(
  ast: File,
  filePath: string,
  code: string
): ExtractRoutesResult {
  const endpoints: Endpoint[] = [];
  const diagnostics: Diagnostic[] = [];

  const codeLines = code.split('\n');

  // Track bindings that represent the express module/factory function
  const expressFactoryBindings = new Set<Binding>();

  // Track bindings that represent the Router factory function (e.g. const { Router } = require('express'))
  const expressRouterFactoryBindings = new Set<Binding>();

  // Track bindings that represent instantiated Express application objects (e.g. `const app = express()`)
  const expressAppBindings = new Set<Binding>();

  // Track bindings that represent instantiated Express router objects (e.g. `const r = express.Router()`)
  const expressRouterBindings = new Map<Binding, SingleFileRouterRecord>();

  // Phase 1: Identify Express factory and Router imports / requires
  traverse(ast, {
    // ESM: import express, { Router } from 'express'
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

    // CJS: const express = require('express'), const { Router } = require('express')
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
          expressRouterBindings.set(routerBinding, {
            binding: routerBinding,
            varName,
            declLine,
            declCol,
            routes: [],
            mounts: [],
          });
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
      let routerRecord: SingleFileRouterRecord | null = null;

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

      // 1. Check for app.use('/prefix', router) or app.use(router)
      if (appBinding && methodName === 'use' && node.arguments.length > 0) {
        const firstArg = node.arguments[0];
        const secondArg = node.arguments[1];
        const line = node.loc?.start.line ?? 1;

        if (firstArg && firstArg.type === 'StringLiteral' && secondArg && secondArg.type === 'Identifier') {
          const mountedBinding = pathNode.scope.getBinding(secondArg.name);
          if (mountedBinding && expressRouterBindings.has(mountedBinding)) {
            const mountedRouter = expressRouterBindings.get(mountedBinding)!;
            mountedRouter.mounts.push({
              prefix: firstArg.value,
              line,
            });
          }
        } else if (firstArg && firstArg.type === 'Identifier') {
          // app.use(router) -> mounted at root '/'
          const mountedBinding = pathNode.scope.getBinding(firstArg.name);
          if (mountedBinding && expressRouterBindings.has(mountedBinding)) {
            const mountedRouter = expressRouterBindings.get(mountedBinding)!;
            mountedRouter.mounts.push({
              prefix: '/',
              line,
            });
          }
        }
        return;
      }

      // 2. Check for HTTP method calls: get, post, put, delete, etc.
      if (!SUPPORTED_HTTP_METHODS.has(methodName)) return;
      if (!appBinding && !routerRecord) return;
      if (node.arguments.length === 0) return;

      const firstArg = node.arguments[0];
      const startLine = node.loc?.start.line ?? 1;
      const startCol = node.loc?.start.column;
      const snippet = codeLines[startLine - 1]?.trim();

      const isLiteralPath = firstArg && firstArg.type === 'StringLiteral';
      const routePath = isLiteralPath ? firstArg.value : '';
      const rawExpr = !isLiteralPath && firstArg ? getRawExpressionText(firstArg, code) : '';

      // Direct app route
      if (appBinding) {
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
              filePath,
              line: startLine,
              ...(snippet ? { snippet } : {}),
            },
          }));

          endpoints.push({
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
              filePath,
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
              { file: filePath, line: startLine, column: startCol }
            )
          );

          const placeholderPath = `/<uncertain:${rawExpr}>`;
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
              filePath,
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
      if (routerRecord) {
        routerRecord.routes.push({
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

  // Phase 4: Process router instance routes (mounted vs unmounted)
  for (const router of expressRouterBindings.values()) {
    if (router.mounts.length === 0) {
      // Unmounted router: emit DG-R002 and mark all its routes as uncertain
      diagnostics.push(
        createDiagnostic(
          'DG-R002',
          { mountPath: '<unmounted>', routerIdentifier: router.varName },
          { file: filePath, line: router.declLine, column: router.declCol }
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
            filePath,
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
      for (const mount of router.mounts) {
        for (const route of router.routes) {
          const methodUpper = route.method.toUpperCase() as HttpMethod;
          const effect = getEffectForMethod(route.method);

          if (route.isDynamic) {
            diagnostics.push(
              createDiagnostic(
                'DG-R003',
                { rawExpression: route.rawExpr! },
                { file: filePath, line: route.startLine, column: route.startCol }
              )
            );

            const placeholderPath = joinPaths(mount.prefix, `<uncertain:${route.rawExpr}>`);
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
                filePath,
                line: route.startLine,
                ...(route.startCol !== undefined ? { column: route.startCol } : {}),
                ...(route.snippet ? { snippet: route.snippet } : {}),
              },
              confidence: 'uncertain',
              confidenceReason: 'DG-R003',
            });
          } else {
            const finalPath = joinPaths(mount.prefix, route.routePath);
            const paramMatches = [...finalPath.matchAll(/:([a-zA-Z0-9_]+)/g)];
            const params = paramMatches.map((match) => ({
              name: match[1] ?? '',
              in: 'path' as const,
              required: true,
              description: `User identifier extracted from path segment :${match[1]}.`,
              provenance: {
                kind: 'literal' as const,
                filePath,
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
                filePath,
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

function getRawExpressionText(node: Node, code: string): string {
  if (typeof node.start === 'number' && typeof node.end === 'number') {
    return code.slice(node.start, node.end);
  }
  return node.type;
}
