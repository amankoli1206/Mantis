# DevGuard Core — Daily Progress & Activity Tracker

This document tracks all day-by-day work, architecture decisions, testing results, and feature additions across the DevGuard project.

---

## 📅 2026-09-30 — Step 2: Core API Model, Diagnostics & JSON Schema

### 🎯 Goal

Implement the central framework-agnostic `ApiModel` Zod schema, diagnostic registry, deterministic endpoint helpers, adapter interface, automated JSON Schema generation script, and comprehensive unit tests aligned with `docs/plan.md`.

### 🛠️ Work Done

- **Schema Design & Validation (`@devguard/core`)**:
  - Implemented [`ProvenanceSchema`](file:///Users/amankoli/Desktop/DevGuard/packages/core/src/schema/provenance.ts) with `kind` (`literal`, `resolved`, `inferred`, `unresolved`), `filePath`, `line`, `column`, `snippet`.
  - Implemented [`ConfidenceSchema`](file:///Users/amankoli/Desktop/DevGuard/packages/core/src/schema/provenance.ts) (`confirmed`, `uncertain`) with required `confidenceReason` for any uncertain endpoints.
  - Implemented [`EndpointSchema`](file:///Users/amankoli/Desktop/DevGuard/packages/core/src/schema/endpoint.ts) supporting methods, path, auth, effect (`read`, `write`, `destructive`, `unknown`), parameters, request body, responses, and middleware.
  - Implemented [`ApiModelSchema`](file:///Users/amankoli/Desktop/DevGuard/packages/core/src/schema/model.ts) (`modelVersion: "1.0.0"`, `project`, `metadata`, `endpoints`, `diagnostics`) and `validateModel()`.
- **Diagnostic Registry & Templates**:
  - Implemented [`DiagnosticSchema`](file:///Users/amankoli/Desktop/DevGuard/packages/core/src/schema/diagnostics.ts) with `file` and `line`, registry, and factory helper `createDiagnostic()` for `DG-P001` (parse error), `DG-R001` (unresolved import), `DG-R002` (unresolved router mount), and `DG-R003` (dynamic path).
- **Framework Adapter Interface**:
  - Defined [`FrameworkAdapter`](file:///Users/amankoli/Desktop/DevGuard/packages/core/src/adapter/index.ts) with `name`, `detect(projectRoot)`, and `scan(projectRoot)`.
- **Deterministic Helpers**:
  - Implemented [`generateEndpointId`](file:///Users/amankoli/Desktop/DevGuard/packages/core/src/helpers/endpoint-helpers.ts) (`"METHOD /path"`) and [`sortEndpoints`](file:///Users/amankoli/Desktop/DevGuard/packages/core/src/helpers/endpoint-helpers.ts) using locale-independent code-point string comparison (`compareStrings`).
- **Automated JSON Schema Export**:
  - Created [`packages/core/scripts/generate-schema.ts`](file:///Users/amankoli/Desktop/DevGuard/packages/core/scripts/generate-schema.ts) generating [`packages/core/api-model.schema.json`](file:///Users/amankoli/Desktop/DevGuard/packages/core/api-model.schema.json) via `pnpm run gen:schema`.
- **Documentation**:
  - Created [`docs/api-model.md`](file:///Users/amankoli/Desktop/DevGuard/docs/api-model.md) explaining all fields in plain language.
  - Updated [`docs/learning-log.md`](file:///Users/amankoli/Desktop/DevGuard/docs/learning-log.md) covering why provenance matters.

### 🧪 Test & Command Verification Status

| Command               | Purpose                             | Status  | Output Details                                   |
| :-------------------- | :---------------------------------- | :-----: | :----------------------------------------------- |
| `pnpm run gen:schema` | Generate `api-model.schema.json`    | ✅ PASS | Created valid Draft-07 JSON Schema               |
| `pnpm lint`           | ESLint check                        | ✅ PASS | 0 errors / 0 warnings                            |
| `pnpm typecheck`      | TypeScript project check (`tsc -b`) | ✅ PASS | 0 type errors across all packages                |
| `pnpm test`           | Vitest test runner                  | ✅ PASS | 8 test suites passed (24/24 tests)               |
| `pnpm build`          | `tsup` compile ESM + CJS + DTS      | ✅ PASS | Built clean bundles without test/script emission |

---

## 📅 2026-09-30 — Step 1: Repo Skeleton, Tooling & Verification Tests

### 🎯 Goal

Initialize the clean TypeScript monorepo workspace for DevGuard Core with strict typechecking, linting, formatting, testing, dual-format building (ESM/CJS), CI workflow, and initial smoke tests.

### 🛠️ Work Done

- **Monorepo Structure (`pnpm`)**:
  - Created [`pnpm-workspace.yaml`](file:///Users/amankoli/Desktop/DevGuard/pnpm-workspace.yaml) linking `packages/*`.
  - Initialized 4 empty packages: `@devguard/core`, `@devguard/adapter-express`, `@devguard/runner`, `@devguard/cli`.
- **TypeScript Strict Setup**:
  - Created [`tsconfig.base.json`](file:///Users/amankoli/Desktop/DevGuard/tsconfig.base.json) and root [`tsconfig.json`](file:///Users/amankoli/Desktop/DevGuard/tsconfig.json).
- **Linting & Code Formatting**:
  - Configured modern ESLint Flat Config [`eslint.config.js`](file:///Users/amankoli/Desktop/DevGuard/eslint.config.js) and Prettier.
- **Dual Builds & Bundling**:
  - Configured `tsup` across all packages for ESM/CJS/DTS outputs.
- **Unit Testing**:
  - Configured Vitest across all packages with smoke tests.
- **Automation & CI**:
  - Configured GitHub Actions CI workflow [`.github/workflows/ci.yml`](file:///Users/amankoli/Desktop/DevGuard/.github/workflows/ci.yml).
- **Documentation**:
  - Created [`README.md`](file:///Users/amankoli/Desktop/DevGuard/README.md) and [`docs/learning-log.md`](file:///Users/amankoli/Desktop/DevGuard/docs/learning-log.md).

### 🧪 Test & Command Verification Status

| Command          | Purpose                             | Status  | Output Details                   |
| :--------------- | :---------------------------------- | :-----: | :------------------------------- |
| `pnpm install`   | Install workspace packages          | ✅ PASS | Synced 5 workspace projects      |
| `pnpm lint`      | ESLint check                        | ✅ PASS | 0 errors / 0 warnings            |
| `pnpm typecheck` | TypeScript project check (`tsc -b`) | ✅ PASS | No type issues                   |
| `pnpm test`      | Vitest test runner                  | ✅ PASS | 4 test suites passed (4/4 tests) |
| `pnpm build`     | tsup compile ESM + CJS + DTS        | ✅ PASS | All 4 packages generated `dist/` |

---

## 📌 Daily Log Template for Future Entries

```markdown
## 📅 YYYY-MM-DD — [Milestone / Feature Name]

### 🎯 Goal

[Brief 1-line description of the day's objective]

### 🛠️ Work Done

- [Task 1]
- [Task 2]

### 🧪 Test & Command Verification Status

| Command          | Purpose    | Status  | Output Details |
| :--------------- | :--------- | :-----: | :------------- |
| `pnpm test`      | Run tests  | ✅ PASS | [Summary]      |
| `pnpm typecheck` | Typecheck  | ✅ PASS | [Summary]      |
| `pnpm lint`      | Lint check | ✅ PASS | [Summary]      |
| `pnpm build`     | Build      | ✅ PASS | [Summary]      |
```
