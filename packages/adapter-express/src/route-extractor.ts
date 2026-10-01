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

export interface ExtractRoutesResult {
  endpoints: Endpoint[];
  diagnostics: Diagnostic[];
}

/**
 * Extracts direct Express routes from an AST using scope-aware identifier binding.
 *
 * Direct routes: `app.get('/path', ...)`, `app.post('/path', ...)`, etc.
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

  // Track bindings that represent instantiated Express application objects (e.g. `const app = express()`)
  const expressAppBindings = new Set<Binding>();

  // Phase 1: Identify Express factory imports / requires
  traverse(ast, {
    // ESM: import express from 'express'
    ImportDeclaration(path: NodePath<ImportDeclaration>) {
      if (path.node.source.value === 'express') {
        for (const specifier of path.node.specifiers) {
          if (specifier.type === 'ImportDefaultSpecifier' || specifier.type === 'ImportNamespaceSpecifier') {
            const binding = path.scope.getBinding(specifier.local.name);
            if (binding) {
              expressFactoryBindings.add(binding);
            }
          }
        }
      }
    },

    // CJS: const express = require('express')
    VariableDeclarator(path: NodePath<VariableDeclarator>) {
      const init = path.node.init;
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
        if (path.node.id.type === 'Identifier') {
          const binding = path.scope.getBinding(path.node.id.name);
          if (binding) {
            expressFactoryBindings.add(binding);
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
        if (path.node.id.type === 'Identifier') {
          const binding = path.scope.getBinding(path.node.id.name);
          if (binding) {
            expressAppBindings.add(binding);
          }
        }
      }
    },
  });

  // Phase 2: Identify Express app instance declarations: `const app = express()`
  traverse(ast, {
    VariableDeclarator(path: NodePath<VariableDeclarator>) {
      const init = path.node.init;
      if (!init || init.type !== 'CallExpression') return;

      let isExpressCall = false;

      if (init.callee.type === 'Identifier') {
        const calleeBinding = path.scope.getBinding(init.callee.name);
        if (calleeBinding && expressFactoryBindings.has(calleeBinding)) {
          isExpressCall = true;
        }
      }

      if (isExpressCall && path.node.id.type === 'Identifier') {
        const appBinding = path.scope.getBinding(path.node.id.name);
        if (appBinding) {
          expressAppBindings.add(appBinding);
        }
      }
    },
  });

  // Phase 3: Extract direct route definitions on express app instances
  traverse(ast, {
    CallExpression(path: NodePath<CallExpression>) {
      const node = path.node;
      if (node.callee.type !== 'MemberExpression') return;

      const memberExpr = node.callee as MemberExpression;
      if (memberExpr.property.type !== 'Identifier') return;

      const methodName = memberExpr.property.name.toLowerCase();
      if (!SUPPORTED_HTTP_METHODS.has(methodName)) return;

      // Verify the object is a bound Express app instance
      let isExpressAppInstance = false;
      if (memberExpr.object.type === 'Identifier') {
        const objectBinding = path.scope.getBinding(memberExpr.object.name);
        if (objectBinding && expressAppBindings.has(objectBinding)) {
          isExpressAppInstance = true;
        }
      }

      if (!isExpressAppInstance) return;

      // Route requires at least a path argument
      if (node.arguments.length === 0) return;

      const firstArg = node.arguments[0];
      const startLine = node.loc?.start.line ?? 1;
      const startCol = node.loc?.start.column;
      const snippet = codeLines[startLine - 1]?.trim();

      const methodUpper = methodName.toUpperCase() as HttpMethod;
      const effect = getEffectForMethod(methodName);

      if (firstArg && firstArg.type === 'StringLiteral') {
        const routePath = firstArg.value;

        // Extract path parameters from route path string (e.g. /users/:id)
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
        // Non-literal dynamic path expression -> uncertain route + DG-R003
        const rawExpr = getRawExpressionText(firstArg, code);
        const dynamicDiag = createDiagnostic(
          'DG-R003',
          { rawExpression: rawExpr },
          {
            file: filePath,
            line: startLine,
            column: startCol,
          }
        );
        diagnostics.push(dynamicDiag);

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
    },
  });

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
