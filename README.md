# DevGuard Core

DevGuard Core is an engine that statically analyzes Node.js + Express backend codebases, produces a trustworthy **API Model** of every endpoint, and tests the running API, linking findings back to exact source lines.

---

## 📖 Documentation & Tracking

- 📋 **[Build Plan](file:///Users/amankoli/Desktop/DevGuard/docs/PLAN.md)**: Full 13-step architecture and implementation roadmap.
- 📅 **[Daily Progress Tracker](file:///Users/amankoli/Desktop/DevGuard/docs/daily-tracking.md)**: Dated log tracking daily activities, completed tasks, and testing results.
- 📐 **[API Model Specification](file:///Users/amankoli/Desktop/DevGuard/docs/api-model.md)**: Details on every field in the versioned API Model schema (`v1.0.0`).
- 💡 **[Learning Log](file:///Users/amankoli/Desktop/DevGuard/docs/learning-log.md)**: Architectural and tooling decisions explained in plain language.

---

## Monorepo Packages

The repository is structured as a `pnpm` monorepo containing the following packages under `packages/`:

| Package                     | Path                       | Purpose                                                              |
| :-------------------------- | :------------------------- | :------------------------------------------------------------------- |
| `@devguard/core`            | `packages/core`            | Core shared data models, schema definitions, diagnostics, and engine |
| `@devguard/adapter-express` | `packages/adapter-express` | Express.js AST parser and route extractor                            |
| `@devguard/runner`          | `packages/runner`          | Test runner and HTTP client executor                                 |
| `@devguard/cli`             | `packages/cli`             | Command-line interface for running scans and test suites             |

---

## Prerequisites

- **Node.js**: `>= 20.0.0`
- **pnpm**: `>= 9.0.0`

---

## Getting Started

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Generate JSON Schema

```bash
pnpm run gen:schema
```

### 3. Build All Packages

```bash
pnpm build
```

### 4. Run Tests

```bash
pnpm test
```

### 5. Typecheck Codebase

```bash
pnpm typecheck
```

### 6. Lint and Format Code

```bash
# Check lint rules
pnpm lint

# Fix lint issues automatically
pnpm lint:fix

# Format code with Prettier
pnpm format

# Verify formatting
pnpm format:check
```
