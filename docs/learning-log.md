# DevGuard Learning Log

## Step 1: Repo Skeleton & Tooling Setup

### Overview

In Step 1, we established a foundational TypeScript monorepo workspace for DevGuard Core. The setup prepares 4 core packages (`core`, `adapter-express`, `runner`, `cli`) with unified formatting, linting, type-checking, building, testing, and continuous integration.

---

### Tooling Choices & Rationale

#### 1. Package Manager: `pnpm` Monorepo Workspaces

- **Why pnpm?**
  - **Fast and storage-efficient**: Uses a content-addressable store and hard links on your machine so the same package version is never duplicated across packages.
  - **Strict isolation**: Unlike npm or yarn classic, pnpm does not allow phantom dependencies (importing packages not declared in that specific package's `package.json`). This ensures clean modular boundaries between `@devguard/core`, `@devguard/adapter-express`, `@devguard/runner`, and `@devguard/cli`.
  - **Native workspace support**: Configured via `pnpm-workspace.yaml`, allowing us to execute commands across all packages using `pnpm -r <command>`.

#### 2. Compiler & Type Checker: TypeScript Strict Mode (`tsconfig.base.json`)

- **Strict Mode (`"strict": true`)**: Enables all strict type-checking options (`noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, etc.), eliminating entire categories of runtime bugs before code is ever run.
- **Module System (`"module": "NodeNext"`, `"moduleResolution": "NodeNext"`)**: Modern standard for ECMAScript modules in Node.js, ensuring seamless import/export interoperability.
- **Project References (`tsc -b`)**: Root `tsconfig.json` references individual package `tsconfig.json` files. `tsc -b` builds and typechecks packages in topological dependency order incrementally.

#### 3. Code Quality: ESLint Flat Config (`eslint.config.js`) + Prettier (`.prettierrc`)

- **ESLint (Flat Config format)**: We used the modern flat configuration standard (`eslint.config.js`), combining `@eslint/js` recommended rules and `typescript-eslint` recommended rules.
- **Prettier Integration**: Used `eslint-config-prettier` to disable any ESLint rules that might conflict with Prettier, keeping linting focused purely on code correctness and Prettier focused purely on code formatting.

#### 4. Bundler: `tsup`

- **Why tsup?**
  - Powered by `esbuild`, making compilation nearly instantaneous.
  - Generates both ESM (`.js`) and CommonJS (`.cjs`) outputs alongside TypeScript declaration files (`.d.ts` and `.d.cts`) without requiring complex rollup or webpack configs.

#### 5. Testing Framework: `Vitest`

- **Why Vitest?**
  - Native ESM and TypeScript execution with zero build/transpilation step needed during tests.
  - Fast execution with multi-threaded runners.
  - Jest-compatible API (`describe`, `it`, `expect`).

#### 6. Continuous Integration: GitHub Actions (`.github/workflows/ci.yml`)

- Triggers on every pull request and push to the `main` branch.
- Validates the complete pipeline: dependency installation (`pnpm install --frozen-lockfile`), linting (`pnpm lint`), type checking (`pnpm typecheck`), unit testing (`pnpm test`), and bundling (`pnpm build`).

---

## Step 2: Core API Model & Diagnostics (`@devguard/core`)

### Overview

In Step 2, we designed and implemented the central **API Model** (`ApiModel`) schema, diagnostic registry, adapter interface, deterministic endpoint helpers, and automated JSON Schema generation inside `@devguard/core` aligned with `docs/PLAN.md`.

---

### New Dependencies & Rationale

- `zod`: Provides runtime schema validation and automated TypeScript static type inference for `ApiModel` without type duplication.
- `zod-to-json-schema`: Converts our TypeScript/Zod models into standard draft-07 JSON Schema files for language-agnostic consumers.
- `tsx`: Lightweight TypeScript execution CLI to run our automated build script (`pnpm run gen:schema`) directly.
- `@types/node`: Standard Node.js TypeScript ambient type definitions for built-in modules (`node:fs`, `node:path`, `node:url`) and runtime globals.

---

### 🧠 Core Concept to Understand: Why Provenance Matters

In static analysis and developer tooling, **provenance** refers to recording _where a fact came from_ (`filePath`, `line`, `column`, `snippet`) and _how it was determined_ (`kind`: `'literal'`, `'resolved'`, `'inferred'`, or `'unresolved'`).

**Why is Provenance essential?**

1. **Pillar 1: Evidence-Carrying Model**: Nothing is asserted without evidence. A route or query parameter doesn't just exist in the abstract; the model carries proof of the exact source file and line where it was declared or read.
2. **Actionable Developer Feedback**: When DevGuard identifies a bug (e.g. `500 on POST /users`), it links the finding directly back to `src/routes/users.js:42`, allowing developers to click straight to the source line in their IDE.
3. **Distinguishing Direct vs Inferred Facts**:
   - `literal`: Statically written as a constant (e.g. `router.get('/users', ...)`).
   - `resolved`: Computed deterministically (e.g. `const BASE = '/api'`, router prefix concatenation).
   - `inferred`: Deduced by observing variable usage (e.g. `req.body.email` read in handler body).
   - `unresolved`: Ambiguous runtime patterns that the static scanner could not fully trace.
4. **Transparent Resolution & Confidence**: When an endpoint has `confidence: "uncertain"`, provenance and the required `confidenceReason` (e.g. `DG-R002` for unresolved router mounts) provide full transparency into analyzer limitations rather than silently dropping or guessing routes.

---

### Model Schema Highlights

- **`confidence`**: Strict binary status (`'confirmed' | 'uncertain'`). If `uncertain`, a `confidenceReason` referencing a registered Diagnostic Code is strictly required.
- **`effect`**: Classified as `'read' | 'write' | 'destructive' | 'unknown'`. Safe mode will only test `'read'` endpoints by default.
- **Deterministic Helpers**:
  - `generateEndpointId(method, path)` produces stable uppercase `"METHOD /path"`.
  - `sortEndpoints()` performs strictly locale-independent code-point sorting (`compareStrings`) ensuring identical output regardless of system environment or input permutation.

---

### Diagnostic Registry

We established the initial set of structured diagnostic codes:

- `DG-P001` (`error`): Parse error when an input source file has syntax errors.
- `DG-R001` (`warning`): Unresolved import when a route/controller file cannot be found on disk.
- `DG-R002` (`warning`): Unresolved router mount when a middleware or router identifier cannot be bound.
- `DG-R003` (`info`): Dynamic path notice when a route uses runtime string variables instead of string literals.

Every diagnostic captures `code`, `severity`, `message`, and source location (`file`, `line`).

---

### Verification Summary

- `pnpm lint` ✅
- `pnpm typecheck` ✅
- `pnpm test` ✅ (8 test suites, 23 passing tests)
- `pnpm run gen:schema` ✅ (Generated `packages/core/api-model.schema.json`)
- `pnpm build` ✅

---

### Next Step Preview (Per `docs/PLAN.md`)

- **Step 3: Fixtures first**: Build `fixtures/simple` and `fixtures/nested-routers` with hand-written `expected.model.json` files and validate them against the schema.

---

## Step 3: Fixtures First — Writing Expected Output Before the Code

### Overview

In Step 3, we did **no scanner work**. Instead, we built two human-readable Express fixture apps and hand-wrote their expected API Model output (`expected.model.json`) *before* any parsing code exists. We also wrote two test files that verify the golden files are internally consistent.

---

### 🧠 Core Concept: Why Write Expected Output Before the Code?

This is the **golden-file discipline**: write down exactly what a correct implementation must produce, *before building the implementation*, for several compounding reasons:

1. **Forces clarity on the contract.** You cannot hand-write a golden file without having resolved every ambiguous schema question (what does `provenance.kind` mean for a chained route? what does `path` contain when the expression is a variable?). The act of writing the golden file is itself a design activity.

2. **Makes tests falsifiable.** A test written *after* the code is working tends to assert whatever the code already returns. A test written from a golden file written *before* the code asserts what the code *should* return — it can actually fail when the implementation is wrong.

3. **Baseline for regression.** Once the scanner exists and produces output for a fixture, diffing against the golden file is the primary signal that something changed. If the diff is expected (schema bump, new field), a human reviews and approves the update. If it's unexpected, the CI gate fails.

4. **Documentation that stays in sync.** Unlike a doc comment that can drift, a golden file is *executed* on every CI run against real fixture code. The provenance line-check test even verifies that every `line` field in the golden file refers to a real, non-empty line in the fixture source — so the golden file cannot silently become wrong as the fixture code changes.

5. **Step 4 can be developed incrementally.** The scanner team (or the next AI step) can run `pnpm test` immediately and see 0/44 fixture endpoints matching — then incrementally reach 44/44 without needing to invent the "correct answer" themselves.

---

### Fixture Design Decisions

#### `fixtures/simple` — Single file, 6 routes

- All routes use `app.get/post/put/delete` with **literal** string paths → `provenance.kind: "literal"`.
- `effect` is inferred from the HTTP verb: GET → `read`, POST/PUT → `write`, DELETE → `destructive`.
- `auth` is always `{ type: "unknown" }` — no middleware is visible.
- `requestBody.provenance` is `kind: "inferred"` because we read from `req.body.email` (not from a schema declaration).

#### `fixtures/nested-routers` — 3 files, 5 routes

- Routes declared on a `express.Router()` and mounted with `app.use('/api', router)` → full path is concatenated at analysis time → `provenance.kind: "resolved"`.
- `router.route('/users').get(...).post(...)` chaining: each `.get()` and `.post()` call is a separate endpoint; the provenance `line` points to the line of the `.get(` or `.post(` call (not the `router` or `.route(` line).
- One route uses a **runtime variable** as the path argument (`router.get(PRODUCT_DETAIL_PATH, ...)`). This is the uncertain case:
  - `confidence: "uncertain"`, `confidenceReason: "DG-R003"`
  - `provenance.kind: "unresolved"`
  - `path` stores the placeholder `"/api/products/<PRODUCT_DETAIL_PATH>"` so the endpoint is still representable in the model.
  - A `DG-R003` diagnostic is emitted pointing to the exact line.

#### Provenance Line Integrity

The `provenance-line-check.test.ts` test walks every `provenance` entry (endpoint, params, requestBody) in every golden file and:
1. Asserts the referenced file exists on disk.
2. Asserts `line` is within the file's total line count.
3. Asserts the line is non-empty.
4. If `snippet` is provided, asserts it matches the actual line (trimmed).

This means updating a fixture file and forgetting to update the golden file will cause a test failure — exactly the intended behaviour.

---

### Configuration Notes

- **ESLint**: `fixtures/*/app/**` added to the ignore list. Fixture apps are plain CJS JavaScript with intentional "undefined" references (e.g. `getDetailSegment()`) that would fail `no-undef`.
- **TypeScript** (`tsc -b`): Fixture apps are plain `.js` files with no `tsconfig.json`, so they are never visited by `tsc -b` (which only traverses the project references in the root `tsconfig.json`).
- **Vitest**: Added `vitest.config.ts` at the workspace root to exclude `.kilo/worktrees/**` (Kilo Code git worktrees) from test discovery. Without this, Vitest would try to run tests from a worktree whose `node_modules` is incomplete.

---

### Verification Summary

- `pnpm lint` ✅
- `pnpm typecheck` ✅
- `pnpm test` ✅ (10 test files, 44 tests — 20 new fixture tests)
- `pnpm build` ✅
- Both golden files validate against `validateModel()` ✅
- All provenance line references verified against real fixture code ✅

---

### Next Step Preview (Per `docs/PLAN.md`)

- **Step 4: Express detection and file walking**: Detect Express via `package.json` and imports; walk files respecting ignore rules. Done when detection works on all fixtures and a non-Express folder is rejected cleanly.
