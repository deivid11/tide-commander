/**
 * Test Runner Service
 *
 * Detects test projects and runs their suites, streaming console output and
 * parsing framework result reports into a structured tree.
 *
 * Only Java/Maven (JUnit surefire) is implemented today, but detection is driven
 * by a registry of `RunnerDetector`s so additional runners (gradle, node, pytest…)
 * can be added without touching the routes, transport, or UI.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { createLogger } from '../utils/index.js';
import type {
  DetectRunnerResult,
  TestRunnerType,
  TestRunResult,
  TestSuiteResult,
  TestCaseResult,
  TestCaseStatus,
  TestRunStatus,
  TestRunTotals,
  TestScanResult,
  ScannedTestClass,
  ScannedTestMethod,
} from '../../shared/types.js';

const log = createLogger('TestRunner');

// ============================================================================
// Detection registry
// ============================================================================

interface RunnerMatch {
  runnerType: TestRunnerType;
  moduleRoot: string; // directory the runner is invoked in
  label: string;
  command: string;
}

interface FileScope {
  testFilter: string; // e.g. simple class name for Maven `-Dtest=`
  command: string; // display command
}

interface RunnerDetector {
  type: TestRunnerType;
  /** Return a match if `dirPath` (or an ancestor) is a runnable test project. */
  detect(dirPath: string): RunnerMatch | null;
  /** For a single file inside a matched project, scope the run to that one test
   *  class. Return null if the file is not a runnable test source. */
  fileFilter?(filePath: string, moduleRoot: string): FileScope | null;
}

/**
 * Heuristic gate (cheap, name-only) matching surefire's default test class
 * patterns, so the tree only probes plausible test files (avoids a filesystem
 * walk per source file).
 */
export function mightBeTestFile(fileName: string): boolean {
  if (!/\.(java|kt)$/.test(fileName)) return false;
  const base = fileName.replace(/\.(java|kt)$/, '');
  return /(Test|Tests|TestCase|IT|ITCase)$/.test(base) || /^(Test|IT)/.test(base);
}

/**
 * Walk up from `startDir` looking for the nearest directory that contains
 * `marker`, stopping at the filesystem root. Returns the directory or null.
 */
function findNearestDirWith(startDir: string, marker: string): string | null {
  let current = path.resolve(startDir);
  // Guard against symlink loops / pathological depth.
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(path.join(current, marker))) return current;
    const parent = path.dirname(current);
    if (parent === current) break; // reached filesystem root
    current = parent;
  }
  return null;
}

// --- Maven (Java / JUnit) ---------------------------------------------------
const mavenDetector: RunnerDetector = {
  type: 'maven',
  detect(dirPath: string): RunnerMatch | null {
    // The nearest pom.xml walking up IS the module root to run in — this
    // naturally scopes the run to the clicked submodule in a multi-module repo.
    const moduleRoot = findNearestDirWith(dirPath, 'pom.xml');
    if (!moduleRoot) return null;
    // Require a JUnit test source directory so we don't offer "Run Tests" on
    // projects that have no tests at all.
    if (!fs.existsSync(path.join(moduleRoot, 'src', 'test'))) return null;
    return { runnerType: 'maven', moduleRoot, label: 'Maven', command: 'mvn test' };
  },
  fileFilter(filePath: string, moduleRoot: string): FileScope | null {
    const fileName = path.basename(filePath);
    if (!mightBeTestFile(fileName)) return null;
    // Must live under the module's src/test tree.
    const testRoot = path.join(moduleRoot, 'src', 'test');
    const rel = path.relative(testRoot, filePath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    const className = fileName.replace(/\.(java|kt)$/, '');
    return { testFilter: className, command: `mvn test -Dtest=${className}` };
  },
};

// --- Vitest (TypeScript/JavaScript) ------------------------------------------

/** Name-only gate for vitest test sources (foo.test.ts / foo.spec.tsx / …). */
export function mightBeVitestFile(fileName: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(fileName);
}

function packageJsonUsesVitest(pkgPath: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return !!(pkg.devDependencies?.vitest || pkg.dependencies?.vitest);
  } catch {
    return false;
  }
}

const VITEST_CONFIG_FILES = [
  'vitest.config.ts', 'vitest.config.js', 'vitest.config.mts', 'vitest.config.mjs',
  'vitest.workspace.ts', 'vitest.workspace.js',
];

const vitestDetector: RunnerDetector = {
  type: 'vitest',
  detect(dirPath: string): RunnerMatch | null {
    const moduleRoot = findNearestDirWith(dirPath, 'package.json');
    if (!moduleRoot) return null;
    const hasConfig = VITEST_CONFIG_FILES.some((f) => fs.existsSync(path.join(moduleRoot, f)));
    if (!hasConfig && !packageJsonUsesVitest(path.join(moduleRoot, 'package.json'))) return null;
    return { runnerType: 'vitest', moduleRoot, label: 'Vitest', command: 'vitest run' };
  },
  fileFilter(filePath: string, moduleRoot: string): FileScope | null {
    if (!mightBeVitestFile(path.basename(filePath))) return null;
    const rel = path.relative(moduleRoot, filePath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return { testFilter: rel, command: `vitest run ${rel}` };
  },
};

// --- PHPUnit (PHP / Symfony) --------------------------------------------------

/** Name-only gate for PHPUnit test sources (FooTest.php). */
export function mightBePhpTestFile(fileName: string): boolean {
  return /Test\.php$/.test(fileName);
}

function composerUsesPhpUnit(composerPath: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(composerPath, 'utf8')) as {
      require?: Record<string, string>;
      'require-dev'?: Record<string, string>;
    };
    const deps = { ...pkg.require, ...pkg['require-dev'] };
    return !!(deps['phpunit/phpunit'] || deps['symfony/phpunit-bridge']);
  } catch {
    return false;
  }
}

const phpunitDetector: RunnerDetector = {
  type: 'phpunit',
  detect(dirPath: string): RunnerMatch | null {
    const moduleRoot = findNearestDirWith(dirPath, 'composer.json');
    if (!moduleRoot) return null;
    const hasConfig =
      fs.existsSync(path.join(moduleRoot, 'phpunit.xml')) ||
      fs.existsSync(path.join(moduleRoot, 'phpunit.xml.dist'));
    if (!hasConfig && !composerUsesPhpUnit(path.join(moduleRoot, 'composer.json'))) return null;
    return { runnerType: 'phpunit', moduleRoot, label: 'PHPUnit', command: 'phpunit' };
  },
  fileFilter(filePath: string, moduleRoot: string): FileScope | null {
    if (!mightBePhpTestFile(path.basename(filePath))) return null;
    const rel = path.relative(moduleRoot, filePath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return { testFilter: rel, command: `phpunit ${rel}` };
  },
};

const DETECTORS: RunnerDetector[] = [mavenDetector, vitestDetector, phpunitDetector];

/**
 * Detect whether `dirPath` can run tests. Returns the first matching runner.
 * Files (non-directories) are treated by their containing directory upstream.
 */
export function detectRunner(targetPath: string): DetectRunnerResult {
  try {
    if (!targetPath || !fs.existsSync(targetPath)) return { testable: false };
    const stat = fs.statSync(targetPath);
    const isDir = stat.isDirectory();
    const dir = isDir ? targetPath : path.dirname(targetPath);
    for (const detector of DETECTORS) {
      const match = detector.detect(dir);
      if (!match) continue;
      if (isDir) {
        return {
          testable: true,
          runnerType: match.runnerType,
          moduleRoot: match.moduleRoot,
          label: match.label,
          command: match.command,
        };
      }
      // A single file: only testable if it maps to a runnable test class.
      const scope = detector.fileFilter?.(targetPath, match.moduleRoot);
      if (!scope) return { testable: false };
      return {
        testable: true,
        runnerType: match.runnerType,
        moduleRoot: match.moduleRoot,
        label: match.label,
        command: scope.command,
        testFilter: scope.testFilter,
      };
    }
  } catch (err) {
    log.error('detectRunner failed:', err);
  }
  return { testable: false };
}

/**
 * Lightweight runner-type probe used to annotate file-tree directory nodes.
 * Returns the runner type (e.g. 'maven') or undefined. Accepts an optional memo
 * to avoid repeated upward walks while enriching a whole tree.
 */
export function detectRunnerType(
  dirPath: string,
  memo?: Map<string, TestRunnerType | undefined>,
): TestRunnerType | undefined {
  if (memo && memo.has(dirPath)) return memo.get(dirPath);
  const result = detectRunner(dirPath);
  const type = result.testable ? result.runnerType : undefined;
  memo?.set(dirPath, type);
  return type;
}

// ============================================================================
// Test source scanning (for the tests-building browser — no execution)
// ============================================================================

// JUnit 4/5 (+ TestNG's @Test) annotations that mark a method as runnable.
const TEST_ANNOTATION_RE = /^\s*@(?:org\.junit\.[\w.]*)?(Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b/;
// Java method declaration, e.g. `public void shouldDoX() {` / `void x(int a) {`.
const JAVA_METHOD_RE = /^\s*(?:(?:public|protected|private|static|final|synchronized|abstract|default)\s+)*[\w$<>[\],.?\s]+?\s+([\w$]+)\s*\(/;
// Kotlin function declaration, incl. backticked names: fun `does the thing`().
const KOTLIN_METHOD_RE = /^\s*(?:(?:public|internal|private|protected|open|override|suspend)\s+)*fun\s+(?:`([^`]+)`|([\w$]+))\s*\(/;

/**
 * Extract the test methods declared in a Java/Kotlin test source file using a
 * line-based annotation scan (dependency-free — no real parser). A method
 * counts when a test annotation appears above its declaration; annotation
 * arguments and stacked annotations in between are tolerated.
 */
export function extractTestMethods(source: string, fileName: string): ScannedTestMethod[] {
  const isKotlin = fileName.endsWith('.kt');
  const methodRe = isKotlin ? KOTLIN_METHOD_RE : JAVA_METHOD_RE;
  const methods: ScannedTestMethod[] = [];
  const lines = source.split('\n');
  let pendingAnnotation = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (TEST_ANNOTATION_RE.test(line)) {
      pendingAnnotation = true;
      // The declaration may share the line: `@Test void x() {}`.
      const sameLine = line.replace(/^\s*@\w+(\([^)]*\))?\s*/, '');
      const m = sameLine.match(isKotlin ? /fun\s+(?:`([^`]+)`|([\w$]+))\s*\(/ : /[\w$<>[\],.?\s]+?\s+([\w$]+)\s*\(/);
      if (m) {
        methods.push({ name: (m[1] ?? m[2])!, line: i + 1 });
        pendingAnnotation = false;
      }
      continue;
    }
    if (!pendingAnnotation) continue;
    if (trimmed.startsWith('@')) continue; // stacked annotations (@DisplayName, …)
    const m = line.match(methodRe);
    if (m) {
      const name = (m[1] ?? m[2]) as string | undefined;
      // Guard against control-flow keywords sneaking through the loose regex.
      if (name && !['if', 'for', 'while', 'switch', 'catch', 'return', 'new'].includes(name)) {
        methods.push({ name, line: i + 1 });
      }
      pendingAnnotation = false;
    } else if (trimmed === '' || trimmed === '}') {
      pendingAnnotation = false; // annotation block ended without a declaration
    }
  }
  return methods;
}

/** Extract the `package` declaration ('' when none). */
export function extractPackageName(source: string): string {
  const m = source.match(/^\s*package\s+([\w.]+)/m);
  return m ? m[1] : '';
}

/**
 * Suite/runner classes that carry no own @Test methods but are runnable as a
 * whole class via `-Dtest=Class`: Cucumber TestNG/JUnit4 runners and JUnit 5
 * platform suites.
 */
export function isRunnerClass(source: string): boolean {
  return (
    /@CucumberOptions\b/.test(source) ||
    /extends\s+AbstractTestNGCucumberTests\b/.test(source) ||
    /@RunWith\s*\(\s*Cucumber/.test(source) ||
    /^\s*@Suite\b/m.test(source)
  );
}

// Max step lines captured per scenario for the human-readable detail.
const GHERKIN_DETAIL_MAX_LINES = 14;

const GHERKIN_SCENARIO_RE =
  /^\s*(?:Scenario(?: Outline| Template)?|Example|Escenario|Esquema del escenario|Ejemplo)\s*:\s*(.+?)\s*$/;
const GHERKIN_SECTION_RE =
  /^\s*(?:Feature|Background|Rule|Scenario(?: Outline| Template)?|Example|Examples|Característica|Antecedentes|Regla|Escenario|Esquema del escenario|Ejemplos?)\s*:/;

/**
 * Extract Gherkin scenario names (+ line numbers) from a .feature source.
 * Covers `Scenario:` / `Scenario Outline:` / `Example:` and their Spanish
 * keywords. Each scenario's step lines (Given/When/Then…) are captured as its
 * human-readable `detail`.
 */
export function extractGherkinScenarios(source: string): ScannedTestMethod[] {
  const methods: ScannedTestMethod[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(GHERKIN_SCENARIO_RE);
    if (!m) continue;
    // Collect the scenario body (steps + examples) until the next section.
    const detailLines: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j].trim();
      if (GHERKIN_SECTION_RE.test(lines[j])) break;
      if (line === '' || line.startsWith('#') || line.startsWith('@')) continue;
      detailLines.push(line);
      if (detailLines.length >= GHERKIN_DETAIL_MAX_LINES) {
        detailLines.push('…');
        break;
      }
    }
    methods.push({
      name: m[1],
      line: i + 1,
      detail: detailLines.length > 0 ? detailLines.join('\n') : undefined,
    });
  }
  return methods;
}

/**
 * Extract the `Background:` block (title line + steps). It runs before every
 * scenario, so the UI shows it alongside each scenario's own steps.
 */
export function extractGherkinBackground(source: string): string | undefined {
  const lines = source.split('\n');
  const idx = lines.findIndex((l) => /^\s*(?:Background|Antecedentes)\s*:/.test(l));
  if (idx === -1) return undefined;
  const out: string[] = [lines[idx].trim()];
  for (let j = idx + 1; j < lines.length; j++) {
    if (GHERKIN_SECTION_RE.test(lines[j])) break;
    const line = lines[j].trim();
    if (line === '' || line.startsWith('#') || line.startsWith('@')) continue;
    out.push(line);
    if (out.length > GHERKIN_DETAIL_MAX_LINES) {
      out.push('…');
      break;
    }
  }
  return out.join('\n');
}

/**
 * Extract the `Feature:` title plus its free-text description block (the lines
 * between the Feature line and the first Background/Rule/Scenario).
 */
export function extractGherkinFeatureDescription(source: string): string | undefined {
  const lines = source.split('\n');
  const idx = lines.findIndex((l) => /^\s*(?:Feature|Característica)\s*:/.test(l));
  if (idx === -1) return undefined;
  const title = lines[idx].trim();
  const desc: string[] = [];
  for (let j = idx + 1; j < lines.length; j++) {
    if (GHERKIN_SECTION_RE.test(lines[j])) break;
    const line = lines[j].trim();
    if (line === '' || line.startsWith('#') || line.startsWith('@')) continue;
    desc.push(line);
    if (desc.length >= 8) break;
  }
  return desc.length > 0 ? `${title}\n${desc.join('\n')}` : title;
}

/**
 * A maven test filter of the form `path/to/File.feature[:line]` targets a
 * Cucumber feature (whole file or one scenario) instead of a `-Dtest=` class.
 */
export function parseCucumberFilter(filter: string): { feature: string; line?: number } | null {
  const m = filter.match(/^([\w\-./ ]+\.feature)(?::(\d+))?$/);
  if (!m) return null;
  return { feature: m[1], line: m[2] ? parseInt(m[2], 10) : undefined };
}

interface CucumberRunnerInfo {
  className: string;
  features: string[]; // entries of @CucumberOptions(features = {...})
  hasTags: boolean;
}

/**
 * Pick the runner class to execute a given feature file with: the runner that
 * explicitly lists the feature (or a parent folder) in @CucumberOptions wins;
 * otherwise prefer an untagged runner (tag filters would silently exclude the
 * scenarios); otherwise the first runner found. Null when the module has none.
 */
export function findCucumberRunner(moduleRoot: string, featureRelPath: string): string | null {
  const testRoot = path.join(moduleRoot, 'src', 'test');
  const runners: CucumberRunnerInfo[] = [];
  let visited = 0;

  const walk = (dir: string, depth: number): void => {
    if (depth > SCAN_MAX_DEPTH || visited > SCAN_MAX_FILES || runners.length > 50) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (visited++ > SCAN_MAX_FILES) return;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SCAN_SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && /\.(java|kt)$/.test(entry.name)) {
        try {
          const source = fs.readFileSync(path.join(dir, entry.name), 'utf8');
          if (!/@CucumberOptions\b/.test(source)) continue;
          const features: string[] = [];
          const block = source.match(/features\s*=\s*(?:\{([\s\S]*?)\}|"([^"]*)")/);
          if (block) {
            const body = block[1] ?? block[2] ?? '';
            const strRe = /"([^"]*)"/g;
            let sm: RegExpExecArray | null;
            while ((sm = strRe.exec(body)) !== null) features.push(sm[1]);
            if (block[2] !== undefined) features.push(block[2]);
          }
          const tagsMatch = source.match(/tags\s*=\s*"([^"]*)"/);
          runners.push({
            className: entry.name.replace(/\.(java|kt)$/, ''),
            features,
            hasTags: !!tagsMatch && tagsMatch[1].trim() !== '',
          });
        } catch {
          // unreadable — skip
        }
      }
    }
  };
  walk(testRoot, 0);
  if (runners.length === 0) return null;

  const target = featureRelPath.replace(/\\/g, '/');
  // 1) a runner that lists the exact file
  const exact = runners.find((r) => r.features.some((f) => f.replace(/\\/g, '/') === target));
  if (exact) return exact.className;
  // 2) a runner whose features entry is a parent folder of the file
  const byDir = runners.find((r) =>
    r.features.some((f) => {
      const dir = f.replace(/\\/g, '/').replace(/\/+$/, '');
      return dir.length > 0 && target.startsWith(`${dir}/`);
    }),
  );
  if (byDir) return byDir.className;
  // 3) an untagged runner (tag filters would exclude foreign scenarios)
  const untagged = runners.find((r) => !r.hasTags);
  if (untagged) return untagged.className;
  return runners[0].className;
}

/**
 * Extract vitest/jest-style test names via a line-based scan: `it('…')`,
 * `test("…")`, incl. modifier chains (`it.only`, `test.skip`, …). `it.each`
 * table names aren't statically resolvable — those files still surface as
 * file-level runnables (see scanTests).
 */
export function extractVitestTests(source: string): ScannedTestMethod[] {
  const methods: ScannedTestMethod[] = [];
  const lines = source.split('\n');
  const re = /^\s*(?:it|test)(?:\.(?:only|skip|todo|fails|concurrent|sequential|runIf|skipIf))*\s*\(\s*(['"`])((?:\\.|(?!\1).)+)\1/;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    const m = lines[i].match(re);
    if (m) methods.push({ name: m[2], line: i + 1 });
  }
  return methods;
}

/**
 * Extract PHPUnit test method names via a line-based scan: `public function
 * testX()` plus methods marked with the `#[Test]` attribute or a `@test`
 * docblock annotation.
 */
export function extractPhpTestMethods(source: string): ScannedTestMethod[] {
  const methods: ScannedTestMethod[] = [];
  const lines = source.split('\n');
  let pendingMarker = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^#\[\s*Test\b/.test(trimmed) || /^\*\s*@test\b/.test(trimmed)) {
      pendingMarker = true;
      continue;
    }
    const m = lines[i].match(/^\s*(?:(?:public|final|static)\s+)*function\s+&?(\w+)\s*\(/);
    if (m) {
      const name = m[1];
      if (name.startsWith('test') || pendingMarker) {
        methods.push({ name, line: i + 1 });
      }
      pendingMarker = false;
    } else if (trimmed === '' || trimmed === '}') {
      pendingMarker = false;
    }
  }
  return methods;
}

/** Extract the PHP `namespace` declaration ('' when none). */
export function extractPhpNamespace(source: string): string {
  const m = source.match(/^\s*namespace\s+([\w\\]+)\s*;/m);
  return m ? m[1] : '';
}

// Bounds so a scan can't wander a pathological tree.
const SCAN_MAX_FILES = 20000; // directory entries visited
const SCAN_MAX_DEPTH = 32;
const SCAN_SKIP_DIRS = new Set(['node_modules', 'target', 'build', '.git', '.idea', 'dist', 'coverage', 'out', 'vendor', 'var']);

/**
 * Scan the module that owns `targetPath` for test classes/methods by walking
 * its `src/test` sources. Returns the browsable inventory used by the tests
 * building (search + run-individual). Never throws; failures come back as
 * `{ testable: false, error }`.
 */
export function scanTests(targetPath: string): TestScanResult {
  const empty = { classes: [], totalMethods: 0 };
  try {
    const detection = detectRunner(targetPath);
    if (!detection.testable || !detection.moduleRoot) {
      return { testable: false, ...empty, error: 'No runnable test project found at this path.' };
    }
    const { moduleRoot } = detection;
    const isVitest = detection.runnerType === 'vitest';
    const isPhp = detection.runnerType === 'phpunit';
    // Maven tests live under src/test; PHPUnit conventionally under tests/;
    // vitest test files sit anywhere in the tree.
    const phpTestsDir = path.join(moduleRoot, 'tests');
    const scanRoot = isVitest
      ? moduleRoot
      : isPhp
        ? fs.existsSync(phpTestsDir)
          ? phpTestsDir
          : moduleRoot
        : path.join(moduleRoot, 'src', 'test');
    const classes: ScannedTestClass[] = [];
    let visited = 0;

    const probeJavaKotlin = (full: string, fileName: string, source: string): void => {
      const methods = extractTestMethods(source, fileName);
      const runner = methods.length === 0 && isRunnerClass(source);
      if (methods.length === 0 && !runner) return; // helpers / abstract bases
      const className = fileName.replace(/\.(java|kt)$/, '');
      const packageName = extractPackageName(source);
      classes.push({
        className,
        packageName,
        fqName: packageName ? `${packageName}.${className}` : className,
        file: full,
        relFile: path.relative(moduleRoot, full),
        methods,
        runner: runner || undefined,
      });
    };

    const probeFeature = (full: string, fileName: string, source: string): void => {
      const methods = extractGherkinScenarios(source);
      if (methods.length === 0) return;
      const relFile = path.relative(moduleRoot, full);
      const relDir = path.dirname(relFile);
      const RESOURCES_PREFIX = 'src/test/resources/';
      classes.push({
        className: fileName,
        // Trim the boilerplate resources prefix so package groups read naturally.
        packageName: relDir.startsWith(RESOURCES_PREFIX) ? relDir.slice(RESOURCES_PREFIX.length) : relDir,
        fqName: relFile,
        file: full,
        relFile,
        methods,
        feature: true,
        description: extractGherkinFeatureDescription(source),
        background: extractGherkinBackground(source),
      });
    };

    const probePhp = (full: string, fileName: string, source: string): void => {
      const methods = extractPhpTestMethods(source);
      // Abstract bases / helpers with no test methods aren't runnable targets.
      if (methods.length === 0 || /^\s*abstract\s+class\b/m.test(source)) return;
      const className = fileName.replace(/\.php$/, '');
      const namespaceName = extractPhpNamespace(source);
      classes.push({
        className,
        packageName: namespaceName,
        // PHPUnit's junit `class` attribute is the FQ backslash name — keep
        // fqName in that shape so run results decorate the browser tree.
        fqName: namespaceName ? `${namespaceName}\\${className}` : className,
        file: full,
        relFile: path.relative(moduleRoot, full),
        methods,
      });
    };

    const probeVitest = (full: string, fileName: string, source: string): void => {
      const methods = extractVitestTests(source);
      // Statically opaque files (it.each tables, generated cases) still run
      // fine as a whole file — surface them as file-level runnables.
      const runner = methods.length === 0 && /\b(?:it|test|describe)\s*[.(]/.test(source);
      if (methods.length === 0 && !runner) return;
      const relFile = path.relative(moduleRoot, full);
      const dir = path.dirname(relFile);
      classes.push({
        className: fileName,
        packageName: dir === '.' ? '' : dir,
        // vitest's junit reporter names suites by file path — keep fqName in
        // that shape so run results decorate the browser tree.
        fqName: relFile,
        file: full,
        relFile,
        methods,
        runner: runner || undefined,
      });
    };

    const walk = (dir: string, depth: number): void => {
      if (depth > SCAN_MAX_DEPTH || visited > SCAN_MAX_FILES) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (visited++ > SCAN_MAX_FILES) return;
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') || SCAN_SKIP_DIRS.has(entry.name)) continue;
          walk(path.join(dir, entry.name), depth + 1);
        } else if (
          entry.isFile() &&
          (isVitest
            ? mightBeVitestFile(entry.name)
            : isPhp
              ? mightBePhpTestFile(entry.name)
              : /\.(java|kt)$/.test(entry.name) || entry.name.endsWith('.feature'))
        ) {
          // For Maven, probe every test source (not just surefire-named files):
          // projects with custom surefire <includes> (e.g. Cucumber runners) are
          // legit — and Gherkin .feature files list their scenarios.
          const full = path.join(dir, entry.name);
          try {
            const source = fs.readFileSync(full, 'utf8');
            if (isVitest) probeVitest(full, entry.name, source);
            else if (isPhp) probePhp(full, entry.name, source);
            else if (entry.name.endsWith('.feature')) probeFeature(full, entry.name, source);
            else probeJavaKotlin(full, entry.name, source);
          } catch {
            // unreadable file — skip
          }
        }
      }
    };
    walk(scanRoot, 0);

    classes.sort((a, b) => a.fqName.localeCompare(b.fqName));
    const totalMethods = classes.reduce((acc, c) => acc + c.methods.length, 0);
    return { testable: true, runnerType: detection.runnerType, moduleRoot, classes, totalMethods };
  } catch (err: any) {
    log.error('scanTests failed:', err);
    return { testable: false, ...empty, error: err?.message || 'Scan failed' };
  }
}

// ============================================================================
// Path safety
// ============================================================================

/**
 * Only allow running tests inside the user's home directory or the server's cwd.
 * Prevents a crafted path from launching a build in an arbitrary system dir.
 */
export function isSafeModuleRoot(moduleRoot: string): boolean {
  try {
    const real = fs.realpathSync(moduleRoot);
    const roots = [process.cwd(), os.homedir()].filter(Boolean).map((r) => {
      try {
        return fs.realpathSync(r);
      } catch {
        return path.resolve(r);
      }
    });
    return roots.some((root) => {
      const rel = path.relative(root, real);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    });
  } catch {
    return false;
  }
}

// ============================================================================
// Command resolution (system mvn preferred, project wrapper as fallback)
// ============================================================================

function resolveExecutableOnPath(name: string): string | null {
  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

interface Invocation {
  cmd: string;
  args: string[];
}

/** Pick how to invoke Maven: system `mvn`, else the project's `./mvnw` wrapper. */
function resolveMavenInvocation(moduleRoot: string, testFilter?: string): Invocation | null {
  const args = ['test', '-B']; // -B batch mode: no ANSI/progress spam
  if (testFilter) {
    const cuke = parseCucumberFilter(testFilter);
    if (cuke) {
      // Cucumber scope: run the owning runner class with its feature list
      // overridden to just this file (or file:line for one scenario) — the
      // `cucumber.features` property takes precedence over @CucumberOptions.
      const runner = findCucumberRunner(moduleRoot, cuke.feature);
      if (runner) args.push(`-Dtest=${runner}`);
      args.push(`-Dcucumber.features=${testFilter}`);
    } else {
      args.push(`-Dtest=${testFilter}`); // scope to a single class
    }
  }
  const systemMvn = resolveExecutableOnPath('mvn');
  if (systemMvn) return { cmd: systemMvn, args };
  const wrapper = path.join(moduleRoot, 'mvnw');
  if (fs.existsSync(wrapper)) return { cmd: wrapper, args };
  return null;
}

// ============================================================================
// Surefire XML parsing (dependency-free)
// ============================================================================

const XML_ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&', // must be applied last-ish; handled by ordering below
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m] ?? m)
    .replace(/&amp;/g, '&');
}

/**
 * Decode an XML element body. CDATA sections are taken verbatim (raw stacktrace
 * text); non-CDATA text is entity-decoded.
 */
function decodeBody(raw: string): string {
  if (!raw) return '';
  const hasCData = /<!\[CDATA\[/.test(raw);
  if (hasCData) {
    // Concatenate the raw contents of all CDATA sections.
    let out = '';
    const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) out += m[1];
    return out.trim();
  }
  return decodeEntities(raw).trim();
}

function parseAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrString)) !== null) {
    attrs[m[1]] = decodeEntities(m[2]);
  }
  return attrs;
}

function toNumber(value: string | undefined, fallback = 0): number {
  if (value == null) return fallback;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse every <testcase> element in `xml` (self-closed or with a body).
 * `fallbackClassname` fills in when a case carries no class attribute.
 * PHPUnit carries the FQ class in `class` (backslashes); surefire/vitest
 * use `classname`.
 */
function parseTestCases(xml: string, fallbackClassname: string): TestCaseResult[] {
  const testcases: TestCaseResult[] = [];
  const caseRe = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let cm: RegExpExecArray | null;
  while ((cm = caseRe.exec(xml)) !== null) {
    const attrs = parseAttrs(cm[1]);
    const body = cm[3] ?? '';

    let status: TestCaseStatus = 'passed';
    let failureMessage: string | undefined;
    let failureType: string | undefined;
    let failureDetail: string | undefined;

    const problem = body.match(/<(failure|error)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/);
    if (problem) {
      status = problem[1] === 'error' ? 'error' : 'failed';
      const pAttrs = parseAttrs(problem[2]);
      failureMessage = pAttrs.message;
      failureType = pAttrs.type;
      failureDetail = decodeBody(problem[4] ?? '');
    } else if (/<skipped\b/.test(body)) {
      status = 'skipped';
      const sk = body.match(/<skipped\b([^>]*?)(\/>|>([\s\S]*?)<\/skipped>)/);
      if (sk) failureMessage = parseAttrs(sk[1]).message;
    }

    testcases.push({
      name: attrs.name || '(unknown)',
      classname: attrs.class || attrs.classname || fallbackClassname,
      status,
      time: toNumber(attrs.time),
      failureMessage,
      failureType,
      failureDetail,
    });
  }
  return testcases;
}

/** Assemble a suite result (counts + worst status) from its parsed cases. */
function buildSuiteFromCases(
  name: string,
  testcases: TestCaseResult[],
  time: number,
  file?: string,
): TestSuiteResult {
  const failures = testcases.filter((t) => t.status === 'failed').length;
  const errors = testcases.filter((t) => t.status === 'error').length;
  const skipped = testcases.filter((t) => t.status === 'skipped').length;
  const passed = testcases.filter((t) => t.status === 'passed').length;
  const suiteStatus: TestCaseStatus =
    failures > 0 ? 'failed' : errors > 0 ? 'error' : skipped > 0 && passed === 0 ? 'skipped' : 'passed';
  return {
    name,
    file,
    status: suiteStatus,
    time,
    tests: testcases.length,
    passed,
    failures,
    errors,
    skipped,
    testcases,
  };
}

/**
 * Parse a single surefire TEST-*.xml file into a suite result.
 */
export function parseSurefireXml(xml: string, file?: string): TestSuiteResult | null {
  const suiteMatch = xml.match(/<testsuite\b([^>]*)>/);
  if (!suiteMatch) return null;
  const suiteAttrs = parseAttrs(suiteMatch[1]);
  const testcases = parseTestCases(xml, suiteAttrs.name || '');
  return buildSuiteFromCases(
    suiteAttrs.name || file || '(suite)',
    testcases,
    toNumber(suiteAttrs.time),
    file,
  );
}

/**
 * Parse a JUnit XML document by grouping testcases by their class attribute —
 * the right shape for PHPUnit's --log-junit output, whose <testsuite> blocks
 * NEST (overall → directory → class), so per-block splitting misattributes.
 */
export function parseJUnitGroupedByClass(xml: string): TestSuiteResult[] {
  const byClass = new Map<string, TestCaseResult[]>();
  for (const tc of parseTestCases(xml, '(tests)')) {
    const list = byClass.get(tc.classname) ?? [];
    list.push(tc);
    byClass.set(tc.classname, list);
  }
  return Array.from(byClass.entries()).map(([name, cases]) =>
    buildSuiteFromCases(name, cases, cases.reduce((acc, c) => acc + c.time, 0)),
  );
}

/**
 * Parse a JUnit-style XML document that may contain MULTIPLE <testsuite>
 * blocks under a <testsuites> root (vitest's junit reporter writes the whole
 * run into one file, one suite per test file). Surefire writes one suite per
 * file, so `parseSurefireXml` stays the per-file fast path.
 */
export function parseJUnitSuites(xml: string, file?: string): TestSuiteResult[] {
  const suites: TestSuiteResult[] = [];
  const re = /<testsuite\b[^>]*(?:\/>|>[\s\S]*?<\/testsuite>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const suite = parseSurefireXml(m[0], file);
    if (suite) suites.push(suite);
  }
  return suites;
}

/** Aggregate parsed suites into a run result (sorted, with totals). */
export function buildRunResult(suites: TestSuiteResult[]): TestRunResult {
  suites.sort((a, b) => a.name.localeCompare(b.name));
  const totals: TestRunTotals = suites.reduce(
    (acc, s) => {
      acc.suites += 1;
      acc.tests += s.tests;
      acc.passed += s.passed;
      acc.failures += s.failures;
      acc.errors += s.errors;
      acc.skipped += s.skipped;
      acc.time += s.time;
      return acc;
    },
    { suites: 0, tests: 0, passed: 0, failures: 0, errors: 0, skipped: 0, time: 0 } as TestRunTotals,
  );
  return { totals, suites };
}

/**
 * Parse all surefire reports in `moduleRoot/target/surefire-reports` that were
 * (re)written during this run (mtime >= `sinceMs`). The mtime filter excludes
 * stale reports from earlier runs when only a subset of classes was executed.
 */
export function parseSurefireReports(moduleRoot: string, sinceMs: number): TestRunResult {
  const reportsDir = path.join(moduleRoot, 'target', 'surefire-reports');
  const suites: TestSuiteResult[] = [];
  try {
    if (fs.existsSync(reportsDir)) {
      const files = fs
        .readdirSync(reportsDir)
        .filter((f) => f.startsWith('TEST-') && f.endsWith('.xml'));
      for (const f of files) {
        const full = path.join(reportsDir, f);
        try {
          const stat = fs.statSync(full);
          // Small slack for filesystem timestamp granularity.
          if (stat.mtimeMs < sinceMs - 3000) continue;
          const suite = parseSurefireXml(fs.readFileSync(full, 'utf8'), f);
          if (suite) suites.push(suite);
        } catch (err) {
          log.error(`Failed to parse report ${f}:`, err);
        }
      }
    }
  } catch (err) {
    log.error('Failed to read surefire reports:', err);
  }

  return buildRunResult(suites);
}

export function deriveStatus(result: TestRunResult, exitCode: number | null): TestRunStatus {
  const { totals } = result;
  if (totals.failures > 0) return 'failed';
  if (totals.errors > 0) return 'error';
  if (totals.tests === 0 && exitCode !== 0) return 'error'; // build/compile failure
  if (exitCode !== 0) return 'failed';
  return 'passed';
}

// ============================================================================
// Run lifecycle
// ============================================================================

export interface RunCallbacks {
  onOutput: (output: string, isError: boolean) => void;
  // Partial results emitted while the run is in flight (each time a new suite
  // report appears in target/surefire-reports).
  onProgress?: (result: TestRunResult) => void;
  onComplete: (payload: {
    status: TestRunStatus;
    exitCode: number | null;
    result: TestRunResult;
    error?: string;
  }) => void;
}

export interface RunOptions {
  testFilter?: string; // scope to a single test class (Maven `-Dtest=`)
}

const runningProcesses = new Map<string, ChildProcess>();

/**
 * Start a Maven test run in `moduleRoot`, streaming output and reporting the
 * parsed result on completion. Returns immediately; the run proceeds async.
 * Throws synchronously only if Maven cannot be located.
 */
export function startMavenRun(
  runId: string,
  moduleRoot: string,
  cb: RunCallbacks,
  opts: RunOptions = {},
): void {
  const invocation = resolveMavenInvocation(moduleRoot, opts.testFilter);
  if (!invocation) {
    throw new Error('Maven not found. Install `mvn` or add a Maven wrapper (mvnw) to the project.');
  }

  const startedAt = Date.now();
  log.log(`[${runId}] ${invocation.cmd} ${invocation.args.join(' ')} (cwd=${moduleRoot})`);

  const child = spawn(invocation.cmd, invocation.args, {
    cwd: moduleRoot,
    env: { ...process.env },
    shell: false,
  });
  runningProcesses.set(runId, child);

  child.stdout?.on('data', (data: Buffer) => cb.onOutput(data.toString(), false));
  child.stderr?.on('data', (data: Buffer) => cb.onOutput(data.toString(), true));

  // Poll the surefire reports dir so results stream in suite-by-suite as each
  // test class finishes, rather than all at once on completion. Only re-emit
  // when a new suite report has appeared (avoids spamming identical results).
  let lastSuiteCount = -1;
  const progressTimer = setInterval(() => {
    if (!cb.onProgress) return;
    try {
      const partial = parseSurefireReports(moduleRoot, startedAt);
      if (partial.suites.length > 0 && partial.suites.length !== lastSuiteCount) {
        lastSuiteCount = partial.suites.length;
        cb.onProgress(partial);
      }
    } catch {
      // ignore transient read/parse errors mid-write
    }
  }, 1500);

  const finish = (exitCode: number | null, spawnError?: string) => {
    clearInterval(progressTimer);
    runningProcesses.delete(runId);
    const result = parseSurefireReports(moduleRoot, startedAt);
    const status = deriveStatus(result, exitCode);
    cb.onComplete({
      status,
      exitCode,
      result,
      error:
        spawnError ||
        (result.totals.tests === 0 && exitCode !== 0
          ? 'The build failed before any tests ran. See console output for details.'
          : undefined),
    });
  };

  child.on('close', (code) => finish(code));
  child.on('error', (err) => {
    log.error(`[${runId}] process error:`, err);
    cb.onOutput(`\n[runner error] ${err.message}\n`, true);
    finish(null, err.message);
  });
}

/**
 * Split a vitest test filter into its parts. Format: `relFile` (whole file) or
 * `relFile::name substring` (one test, matched via `-t`).
 */
export function splitVitestFilter(filter: string): { file?: string; namePattern?: string } {
  const idx = filter.indexOf('::');
  if (idx === -1) return { file: filter || undefined };
  const file = filter.slice(0, idx);
  const namePattern = filter.slice(idx + 2);
  return { file: file || undefined, namePattern: namePattern || undefined };
}

/** Human-readable command label for a vitest run (mirrors the real argv). */
export function vitestCommandLabel(testFilter?: string): string {
  if (!testFilter) return 'vitest run';
  const { file, namePattern } = splitVitestFilter(testFilter);
  let cmd = 'vitest run';
  if (file) cmd += ` ${file}`;
  if (namePattern) cmd += ` -t "${namePattern}"`;
  return cmd;
}

/**
 * Start a vitest run in `moduleRoot`. Console streams live; the parsed result
 * comes from vitest's junit reporter (single XML with one suite per test file),
 * written to a temp file and parsed on completion. No mid-run progress — the
 * reporter only writes at the end. Throws synchronously if vitest can't be run.
 */
export function startVitestRun(
  runId: string,
  moduleRoot: string,
  cb: RunCallbacks,
  opts: RunOptions = {},
): void {
  const xmlOut = path.join(os.tmpdir(), `tc-vitest-${runId}.xml`);
  const baseArgs = ['run', '--reporter=default', '--reporter=junit', `--outputFile.junit=${xmlOut}`];
  if (opts.testFilter) {
    const { file, namePattern } = splitVitestFilter(opts.testFilter);
    if (file) baseArgs.push(file);
    if (namePattern) baseArgs.push('-t', namePattern);
  }

  // Prefer the project's own vitest; fall back to npx resolution.
  const localBin = path.join(moduleRoot, 'node_modules', '.bin', 'vitest');
  let invocation: Invocation;
  if (fs.existsSync(localBin)) {
    invocation = { cmd: localBin, args: baseArgs };
  } else {
    const npx = resolveExecutableOnPath('npx');
    if (!npx) throw new Error('vitest not found. Install it in the project (or make `npx` available).');
    invocation = { cmd: npx, args: ['vitest', ...baseArgs] };
  }

  log.log(`[${runId}] ${invocation.cmd} ${invocation.args.join(' ')} (cwd=${moduleRoot})`);
  const child = spawn(invocation.cmd, invocation.args, {
    cwd: moduleRoot,
    env: { ...process.env },
    shell: false,
  });
  runningProcesses.set(runId, child);

  child.stdout?.on('data', (data: Buffer) => cb.onOutput(data.toString(), false));
  child.stderr?.on('data', (data: Buffer) => cb.onOutput(data.toString(), true));

  const finish = (exitCode: number | null, spawnError?: string) => {
    runningProcesses.delete(runId);
    let suites: TestSuiteResult[] = [];
    try {
      if (fs.existsSync(xmlOut)) {
        suites = parseJUnitSuites(fs.readFileSync(xmlOut, 'utf8'));
        fs.unlinkSync(xmlOut);
      }
    } catch (err) {
      log.error(`[${runId}] failed to parse vitest junit output:`, err);
    }
    const result = buildRunResult(suites);
    const status = deriveStatus(result, exitCode);
    cb.onComplete({
      status,
      exitCode,
      result,
      error:
        spawnError ||
        (result.totals.tests === 0 && exitCode !== 0
          ? 'The run failed before any tests executed. See console output for details.'
          : undefined),
    });
  };

  child.on('close', (code) => finish(code));
  child.on('error', (err) => {
    log.error(`[${runId}] process error:`, err);
    cb.onOutput(`\n[runner error] ${err.message}\n`, true);
    finish(null, err.message);
  });
}

// ── PHPUnit live progress (TeamCity event stream) ─────────────────────────────

function unescapeTeamCity(value: string): string {
  return value.replace(/\|(.)/g, (_, c: string) =>
    c === 'n' ? '\n' : c === 'r' ? '\r' : c === '|' ? '|' : c === "'" ? "'" : c === '[' ? '[' : c === ']' ? ']' : c,
  );
}

interface TeamCityEvent {
  type: string;
  attrs: Record<string, string>;
}

/** Parse one `##teamcity[…]` service-message line (null for regular output). */
export function parseTeamCityLine(line: string): TeamCityEvent | null {
  const m = line.match(/^\s*##teamcity\[(\w+)(.*)\]\s*$/);
  if (!m) return null;
  const attrs: Record<string, string> = {};
  const attrRe = /(\w+)='((?:\|.|[^'|])*)'/g;
  let am: RegExpExecArray | null;
  while ((am = attrRe.exec(m[2])) !== null) {
    attrs[am[1]] = unescapeTeamCity(am[2]);
  }
  return { type: m[1], attrs };
}

/**
 * Incremental state built from PHPUnit's `--teamcity` printer so runs stream
 * test-by-test (the junit log is only written at the end). Protocol lines are
 * consumed and replaced with short human-readable ones; everything else
 * (headers, app logs) passes through to the console untouched.
 */
export class PhpUnitProgressTracker {
  private lineBuffer = '';
  private suiteStack: string[] = [];
  private casesByClass = new Map<string, TestCaseResult[]>();
  private current: { name: string; status: TestCaseStatus; failureMessage?: string; failureDetail?: string } | null =
    null;

  /** Feed a stdout chunk. Returns console text to surface and whether the
   *  parsed result advanced (a test finished). */
  feed(chunk: string): { output: string; advanced: boolean } {
    this.lineBuffer += chunk;
    const lines = this.lineBuffer.split('\n');
    this.lineBuffer = lines.pop() ?? ''; // keep the trailing partial line
    const out: string[] = [];
    let advanced = false;
    for (const line of lines) {
      const event = parseTeamCityLine(line);
      if (!event) {
        out.push(line);
        continue;
      }
      const name = event.attrs.name ?? '';
      switch (event.type) {
        case 'testSuiteStarted':
          this.suiteStack.push(name);
          if (name.includes('\\')) out.push(`▶ ${name}`);
          break;
        case 'testSuiteFinished':
          this.suiteStack.pop();
          break;
        case 'testStarted':
          this.current = { name, status: 'passed' };
          break;
        case 'testFailed':
          if (this.current && this.current.name === name) {
            // PHPUnit reports errors through testFailed too; junit corrects
            // the failed/error split in the final result.
            this.current.status = 'failed';
            this.current.failureMessage = event.attrs.message;
            this.current.failureDetail = event.attrs.details;
          }
          break;
        case 'testIgnored':
          if (this.current && this.current.name === name) {
            this.current.status = 'skipped';
            this.current.failureMessage = event.attrs.message;
          }
          break;
        case 'testFinished': {
          if (!this.current) break;
          const timeSec = toNumber(event.attrs.duration) / 1000;
          const className = [...this.suiteStack].reverse().find((s) => s.includes('\\')) ?? this.suiteStack[this.suiteStack.length - 1] ?? '(tests)';
          const list = this.casesByClass.get(className) ?? [];
          list.push({
            name: this.current.name,
            classname: className,
            status: this.current.status,
            time: timeSec,
            failureMessage: this.current.failureMessage,
            failureDetail: this.current.failureDetail,
          });
          this.casesByClass.set(className, list);
          const mark = this.current.status === 'passed' ? '✓' : this.current.status === 'skipped' ? '⊘' : '✗';
          const headline = this.current.failureMessage?.split('\n')[0];
          out.push(`  ${mark} ${this.current.name} (${Math.round(timeSec * 1000)} ms)${headline ? ` — ${headline}` : ''}`);
          this.current = null;
          advanced = true;
          break;
        }
        default:
          break; // testCount etc. — ignored
      }
    }
    return { output: out.length > 0 ? `${out.join('\n')}\n` : '', advanced };
  }

  /** Partial run result from the tests finished so far. */
  result(): TestRunResult {
    const suites = Array.from(this.casesByClass.entries()).map(([name, cases]) =>
      buildSuiteFromCases(name, [...cases], cases.reduce((acc, c) => acc + c.time, 0)),
    );
    return buildRunResult(suites);
  }

  hasResults(): boolean {
    return this.casesByClass.size > 0;
  }
}

/** Human-readable command label for a PHPUnit run (mirrors the real argv). */
export function phpunitCommandLabel(testFilter?: string): string {
  if (!testFilter) return 'phpunit';
  const { file, namePattern } = splitVitestFilter(testFilter);
  let cmd = 'phpunit';
  if (file) cmd += ` ${file}`;
  if (namePattern) cmd += ` --filter "${namePattern}"`;
  return cmd;
}

/**
 * Start a PHPUnit run in `moduleRoot` (Symfony convention: vendor/bin/phpunit,
 * else bin/phpunit wrapper, else PATH). Console streams live; the parsed result
 * comes from `--log-junit` output on completion (testsuites nest, so cases are
 * grouped by class). Filter format matches vitest: `relFile[::method]`.
 */
export function startPhpUnitRun(
  runId: string,
  moduleRoot: string,
  cb: RunCallbacks,
  opts: RunOptions = {},
): void {
  const xmlOut = path.join(os.tmpdir(), `tc-phpunit-${runId}.xml`);
  const args: string[] = [];
  if (opts.testFilter) {
    const { file, namePattern } = splitVitestFilter(opts.testFilter);
    if (file) args.push(file);
    if (namePattern) args.push('--filter', namePattern);
  }
  // --teamcity streams a structured event per test → live progress; the junit
  // log (written only at the end) stays the authoritative final result.
  args.push('--teamcity', '--log-junit', xmlOut);

  const candidates = [
    path.join(moduleRoot, 'vendor', 'bin', 'phpunit'),
    path.join(moduleRoot, 'bin', 'phpunit'),
  ];
  let cmd = candidates.find((c) => fs.existsSync(c)) ?? null;
  if (!cmd) cmd = resolveExecutableOnPath('phpunit');
  if (!cmd) {
    throw new Error('PHPUnit not found. Install it in the project (vendor/bin/phpunit) or on the PATH.');
  }

  log.log(`[${runId}] ${cmd} ${args.join(' ')} (cwd=${moduleRoot})`);
  const child = spawn(cmd, args, {
    cwd: moduleRoot,
    env: { ...process.env },
    shell: false,
  });
  runningProcesses.set(runId, child);

  const tracker = new PhpUnitProgressTracker();
  let lastProgressAt = 0;
  child.stdout?.on('data', (data: Buffer) => {
    const { output, advanced } = tracker.feed(data.toString());
    if (output) cb.onOutput(output, false);
    // Emit partial results per finished test, throttled for fast unit suites.
    if (advanced && cb.onProgress) {
      const now = Date.now();
      if (now - lastProgressAt >= 300) {
        lastProgressAt = now;
        cb.onProgress(tracker.result());
      }
    }
  });
  child.stderr?.on('data', (data: Buffer) => cb.onOutput(data.toString(), true));

  const finish = (exitCode: number | null, spawnError?: string) => {
    runningProcesses.delete(runId);
    let suites: TestSuiteResult[] = [];
    try {
      if (fs.existsSync(xmlOut)) {
        suites = parseJUnitGroupedByClass(fs.readFileSync(xmlOut, 'utf8'));
        fs.unlinkSync(xmlOut);
      }
    } catch (err) {
      log.error(`[${runId}] failed to parse phpunit junit output:`, err);
    }
    // Junit is authoritative; if it never materialized (crash mid-run), keep
    // whatever the live stream collected instead of reporting nothing.
    if (suites.length === 0 && tracker.hasResults()) {
      suites = tracker.result().suites;
    }
    const result = buildRunResult(suites);
    const status = deriveStatus(result, exitCode);
    cb.onComplete({
      status,
      exitCode,
      result,
      error:
        spawnError ||
        (result.totals.tests === 0 && exitCode !== 0
          ? 'The run failed before any tests executed. See console output for details.'
          : undefined),
    });
  };

  child.on('close', (code) => finish(code));
  child.on('error', (err) => {
    log.error(`[${runId}] process error:`, err);
    cb.onOutput(`\n[runner error] ${err.message}\n`, true);
    finish(null, err.message);
  });
}

/** Kill a running test process (Stop / used before Re-run). */
export function killRun(runId: string): boolean {
  const child = runningProcesses.get(runId);
  if (!child) return false;
  try {
    child.kill('SIGTERM');
    return true;
  } catch (err) {
    log.error(`Failed to kill run ${runId}:`, err);
    return false;
  }
}

export function isRunActive(runId: string): boolean {
  return runningProcesses.has(runId);
}
