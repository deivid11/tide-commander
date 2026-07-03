import { describe, expect, it } from 'vitest';
import fs from 'fs';
import {
  parseSurefireXml,
  parseJUnitSuites,
  detectRunner,
  deriveStatus,
  mightBeTestFile,
  mightBeVitestFile,
  extractTestMethods,
  extractPackageName,
  extractVitestTests,
  extractPhpTestMethods,
  extractPhpNamespace,
  mightBePhpTestFile,
  parseJUnitGroupedByClass,
  parseTeamCityLine,
  PhpUnitProgressTracker,
  extractGherkinScenarios,
  extractGherkinFeatureDescription,
  extractGherkinBackground,
  parseCucumberFilter,
  findCucumberRunner,
  splitVitestFilter,
  scanTests,
} from './test-runner-service.js';

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="com.example.SampleTest" time="1.234" tests="4" errors="1" skipped="1" failures="1">
  <testcase name="passes" classname="com.example.SampleTest" time="0.038"/>
  <testcase name="failsAssertion" classname="com.example.SampleTest" time="0.010">
    <failure message="expected: &lt;1&gt; but was: &lt;2&gt;" type="org.opentest4j.AssertionFailedError"><![CDATA[org.opentest4j.AssertionFailedError: expected: <1> but was: <2>
	at com.example.SampleTest.failsAssertion(SampleTest.java:42)]]></failure>
  </testcase>
  <testcase name="throwsError" classname="com.example.SampleTest" time="0.005">
    <error message="boom &amp; crash" type="java.lang.RuntimeException">java.lang.RuntimeException: boom &amp; crash
	at com.example.SampleTest.throwsError(SampleTest.java:55)</error>
  </testcase>
  <testcase name="isSkipped" classname="com.example.SampleTest" time="0.0">
    <skipped message="not ready yet"/>
  </testcase>
</testsuite>`;

describe('parseSurefireXml', () => {
  const suite = parseSurefireXml(SAMPLE_XML, 'TEST-com.example.SampleTest.xml');

  it('parses the suite header and file', () => {
    expect(suite).not.toBeNull();
    expect(suite!.name).toBe('com.example.SampleTest');
    expect(suite!.file).toBe('TEST-com.example.SampleTest.xml');
    expect(suite!.time).toBeCloseTo(1.234, 3);
    expect(suite!.tests).toBe(4);
  });

  it('computes per-status counts', () => {
    expect(suite!.passed).toBe(1);
    expect(suite!.failures).toBe(1);
    expect(suite!.errors).toBe(1);
    expect(suite!.skipped).toBe(1);
    expect(suite!.status).toBe('failed'); // failures dominate
  });

  it('marks a self-closed testcase as passed with its duration', () => {
    const tc = suite!.testcases.find((t) => t.name === 'passes')!;
    expect(tc.status).toBe('passed');
    expect(tc.time).toBeCloseTo(0.038, 3);
    expect(tc.failureMessage).toBeUndefined();
  });

  it('decodes an entity-escaped failure message and CDATA stacktrace', () => {
    const tc = suite!.testcases.find((t) => t.name === 'failsAssertion')!;
    expect(tc.status).toBe('failed');
    expect(tc.failureType).toBe('org.opentest4j.AssertionFailedError');
    expect(tc.failureMessage).toBe('expected: <1> but was: <2>');
    expect(tc.failureDetail).toContain('expected: <1> but was: <2>');
    expect(tc.failureDetail).toContain('SampleTest.java:42');
  });

  it('distinguishes errors from failures and decodes entities in the body', () => {
    const tc = suite!.testcases.find((t) => t.name === 'throwsError')!;
    expect(tc.status).toBe('error');
    expect(tc.failureMessage).toBe('boom & crash');
    expect(tc.failureDetail).toContain('boom & crash');
  });

  it('captures skipped tests and their message', () => {
    const tc = suite!.testcases.find((t) => t.name === 'isSkipped')!;
    expect(tc.status).toBe('skipped');
    expect(tc.failureMessage).toBe('not ready yet');
  });

  it('returns null for non-suite XML', () => {
    expect(parseSurefireXml('<not-a-suite/>')).toBeNull();
  });
});

describe('deriveStatus', () => {
  const base = { suites: 1, tests: 3, passed: 3, failures: 0, errors: 0, skipped: 0, time: 1 };
  it('is passed when everything passed and exit 0', () => {
    expect(deriveStatus({ totals: base, suites: [] }, 0)).toBe('passed');
  });
  it('is failed when there are failures', () => {
    expect(deriveStatus({ totals: { ...base, failures: 1 }, suites: [] }, 1)).toBe('failed');
  });
  it('is error when a build produced no tests and failed', () => {
    expect(deriveStatus({ totals: { ...base, tests: 0, passed: 0 }, suites: [] }, 1)).toBe('error');
  });
});

describe('detectRunner', () => {
  it('returns not testable for a non-existent path', () => {
    expect(detectRunner('/definitely/not/a/real/path/xyz').testable).toBe(false);
  });

  it('returns not testable for a plain temp directory', () => {
    const dir = fs.mkdtempSync('/tmp/trs-test-');
    try {
      expect(detectRunner(dir).testable).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects a Maven project (pom.xml + src/test) and picks the module root', () => {
    const root = fs.mkdtempSync('/tmp/trs-maven-');
    try {
      fs.writeFileSync(`${root}/pom.xml`, '<project/>');
      fs.mkdirSync(`${root}/src/test/java/app`, { recursive: true });
      // Detect from a nested folder inside the project — should walk up to root.
      const result = detectRunner(`${root}/src/test/java/app`);
      expect(result.testable).toBe(true);
      expect(result.runnerType).toBe('maven');
      expect(fs.realpathSync(result.moduleRoot!)).toBe(fs.realpathSync(root));
      expect(result.command).toBe('mvn test');
      expect(result.testFilter).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('scopes to a single class when a test file under src/test is targeted', () => {
    const root = fs.mkdtempSync('/tmp/trs-maven-file-');
    try {
      fs.writeFileSync(`${root}/pom.xml`, '<project/>');
      const pkg = `${root}/src/test/java/app`;
      fs.mkdirSync(pkg, { recursive: true });
      const testFile = `${pkg}/ClabeUtilTest.java`;
      fs.writeFileSync(testFile, 'class ClabeUtilTest {}');
      const result = detectRunner(testFile);
      expect(result.testable).toBe(true);
      expect(result.runnerType).toBe('maven');
      expect(result.testFilter).toBe('ClabeUtilTest');
      expect(result.command).toBe('mvn test -Dtest=ClabeUtilTest');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not offer a run for a non-test file, nor a test file outside src/test', () => {
    const root = fs.mkdtempSync('/tmp/trs-maven-nontest-');
    try {
      fs.writeFileSync(`${root}/pom.xml`, '<project/>');
      fs.mkdirSync(`${root}/src/test/java`, { recursive: true });
      fs.mkdirSync(`${root}/src/main/java`, { recursive: true });
      const helper = `${root}/src/test/java/Helper.java`; // not a test-named class
      fs.writeFileSync(helper, 'class Helper {}');
      expect(detectRunner(helper).testable).toBe(false);
      const mainTest = `${root}/src/main/java/FooTest.java`; // test name, wrong tree
      fs.writeFileSync(mainTest, 'class FooTest {}');
      expect(detectRunner(mainTest).testable).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('mightBeTestFile', () => {
  it('matches surefire default test-class name patterns', () => {
    for (const n of ['FooTest.java', 'FooTests.java', 'TestFoo.java', 'FooIT.java', 'FooTestCase.java', 'BarTest.kt']) {
      expect(mightBeTestFile(n)).toBe(true);
    }
  });
  it('rejects non-test / non-java names', () => {
    for (const n of ['Helper.java', 'FooService.java', 'notes.txt', 'Test.py', 'README.md']) {
      expect(mightBeTestFile(n)).toBe(false);
    }
  });
});

const JAVA_SOURCE = `package com.example.util;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;

public class ClabeUtilTest {

  private final Helper helper = new Helper();

  @Test
  void validatesChecksum() {
    // if (something) { ... } — control flow inside must not register
  }

  @Test
  public void rejectsShortInput() {
  }

  @ParameterizedTest(name = "bank {0}")
  @ValueSource(strings = {"a", "b"})
  void resolvesBankName(String code) {
  }

  @DisplayName("edge case")
  @Test
  @Disabled
  void handlesNullInput() {
  }

  void notATest() {
  }

  @TestConfiguration
  void alsoNotATest() {
  }
}
`;

const KOTLIN_SOURCE = `package com.example.kt

import org.junit.jupiter.api.Test

class GreeterTest {
  @Test
  fun greetsTheWorld() {
  }

  @Test
  fun \`greets with a nice name\`() {
  }

  fun helper() {
  }
}
`;

describe('extractTestMethods', () => {
  it('extracts annotated Java test methods (incl. stacked annotations)', () => {
    const methods = extractTestMethods(JAVA_SOURCE, 'ClabeUtilTest.java');
    expect(methods.map((m) => m.name)).toEqual([
      'validatesChecksum',
      'rejectsShortInput',
      'resolvesBankName',
      'handlesNullInput',
    ]);
    // Line numbers point at each declaration.
    for (const m of methods) {
      expect(JAVA_SOURCE.split('\n')[m.line - 1]).toContain(m.name);
    }
  });

  it('ignores non-annotated methods and non-test annotations like @TestConfiguration', () => {
    const names = extractTestMethods(JAVA_SOURCE, 'ClabeUtilTest.java').map((m) => m.name);
    expect(names).not.toContain('notATest');
    expect(names).not.toContain('alsoNotATest');
  });

  it('extracts Kotlin test functions including backticked names', () => {
    const methods = extractTestMethods(KOTLIN_SOURCE, 'GreeterTest.kt');
    expect(methods.map((m) => m.name)).toEqual(['greetsTheWorld', 'greets with a nice name']);
  });

  it('handles a declaration sharing the annotation line', () => {
    const src = 'class T {\n  @Test void inlineCase() {}\n}';
    expect(extractTestMethods(src, 'T.java').map((m) => m.name)).toEqual(['inlineCase']);
  });
});

describe('extractPackageName', () => {
  it('reads the package declaration', () => {
    expect(extractPackageName(JAVA_SOURCE)).toBe('com.example.util');
    expect(extractPackageName(KOTLIN_SOURCE)).toBe('com.example.kt');
  });
  it('returns empty string when there is none', () => {
    expect(extractPackageName('class Foo {}')).toBe('');
  });
});

describe('scanTests', () => {
  it('inventories test classes/methods under a Maven module', () => {
    const root = fs.mkdtempSync('/tmp/trs-scan-');
    try {
      fs.writeFileSync(`${root}/pom.xml`, '<project/>');
      const pkg = `${root}/src/test/java/com/example/util`;
      fs.mkdirSync(pkg, { recursive: true });
      fs.writeFileSync(`${pkg}/ClabeUtilTest.java`, JAVA_SOURCE);
      fs.writeFileSync(`${pkg}/Helper.java`, 'class Helper {}'); // not test-named
      fs.writeFileSync(`${pkg}/EmptyTest.java`, 'class EmptyTest {}'); // no @Test methods

      const scan = scanTests(`${root}/src/test`);
      expect(scan.testable).toBe(true);
      expect(scan.runnerType).toBe('maven');
      expect(scan.classes).toHaveLength(1);
      const cls = scan.classes[0];
      expect(cls.className).toBe('ClabeUtilTest');
      expect(cls.packageName).toBe('com.example.util');
      expect(cls.fqName).toBe('com.example.util.ClabeUtilTest');
      expect(cls.relFile).toBe('src/test/java/com/example/util/ClabeUtilTest.java');
      expect(scan.totalMethods).toBe(4);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('includes Cucumber/TestNG runner classes as class-level runnables', () => {
    const root = fs.mkdtempSync('/tmp/trs-scan-cuke-');
    try {
      fs.writeFileSync(`${root}/pom.xml`, '<project/>');
      const pkg = `${root}/src/test/java/TestRunner`;
      fs.mkdirSync(pkg, { recursive: true });
      // Runner name does NOT match surefire patterns and has no @Test methods.
      fs.writeFileSync(
        `${pkg}/CucumberTestRunner.java`,
        `package TestRunner;
import io.cucumber.testng.AbstractTestNGCucumberTests;
import io.cucumber.testng.CucumberOptions;
@CucumberOptions(features = {"src/test/resources/Features"}, glue = {"StepDefinitions"})
public class CucumberTestRunner extends AbstractTestNGCucumberTests {
}
`,
      );
      fs.writeFileSync(`${pkg}/ElementUtils.java`, 'package TestRunner;\npublic class ElementUtils {}\n');

      const scan = scanTests(root);
      expect(scan.testable).toBe(true);
      expect(scan.classes).toHaveLength(1);
      expect(scan.classes[0].className).toBe('CucumberTestRunner');
      expect(scan.classes[0].runner).toBe(true);
      expect(scan.classes[0].methods).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports not testable (with an error) for a non-project folder', () => {
    const dir = fs.mkdtempSync('/tmp/trs-scan-none-');
    try {
      const scan = scanTests(dir);
      expect(scan.testable).toBe(false);
      expect(scan.classes).toEqual([]);
      expect(scan.error).toBeTruthy();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Cucumber / Gherkin ───────────────────────────────────────────────────────

const FEATURE_SOURCE = `Feature: Client Scenarios Automation
  As an admin I want to manage clients

  Background: User is logged in
    Given Admin User completes login

  @e2e
  Scenario: Filter active clients
    When Open dropdown "Clientes activos"
    Then Verify Table rows are filtered

  @e2e
  Scenario Outline: Search clients by <type>
    When Search "<type>"
    Examples:
      | type   |
      | NORMAL |
`;

describe('extractGherkinScenarios', () => {
  const scenarios = extractGherkinScenarios(FEATURE_SOURCE);

  it('lists scenarios and scenario outlines with line numbers', () => {
    expect(scenarios.map((s) => s.name)).toEqual(['Filter active clients', 'Search clients by <type>']);
    expect(FEATURE_SOURCE.split('\n')[scenarios[0].line - 1]).toContain('Filter active clients');
  });

  it('captures the step lines as human-readable detail', () => {
    expect(scenarios[0].detail).toBe('When Open dropdown "Clientes activos"\nThen Verify Table rows are filtered');
  });
});

describe('extractGherkinFeatureDescription', () => {
  it('returns the Feature title plus its description block', () => {
    expect(extractGherkinFeatureDescription(FEATURE_SOURCE)).toBe(
      'Feature: Client Scenarios Automation\nAs an admin I want to manage clients',
    );
  });
});

describe('extractGherkinBackground', () => {
  it('returns the Background title and its steps', () => {
    expect(extractGherkinBackground(FEATURE_SOURCE)).toBe(
      'Background: User is logged in\nGiven Admin User completes login',
    );
  });
  it('returns undefined when the feature has no Background', () => {
    expect(extractGherkinBackground('Feature: X\n\n  Scenario: a\n    Given b\n')).toBeUndefined();
  });
});

describe('parseCucumberFilter', () => {
  it('accepts feature paths with an optional scenario line', () => {
    expect(parseCucumberFilter('src/test/resources/Features/a.feature')).toEqual({
      feature: 'src/test/resources/Features/a.feature',
      line: undefined,
    });
    expect(parseCucumberFilter('src/test/resources/Features/a.feature:12')).toEqual({
      feature: 'src/test/resources/Features/a.feature',
      line: 12,
    });
    expect(parseCucumberFilter('ClabeUtilTest#method')).toBeNull();
    expect(parseCucumberFilter('src/foo.test.ts')).toBeNull();
  });
});

describe('findCucumberRunner', () => {
  it('picks the runner that lists the feature (or its folder), preferring untagged fallbacks', () => {
    const root = fs.mkdtempSync('/tmp/trs-cuke-runner-');
    try {
      fs.writeFileSync(`${root}/pom.xml`, '<project/>');
      const pkg = `${root}/src/test/java/TestRunner`;
      fs.mkdirSync(pkg, { recursive: true });
      fs.writeFileSync(
        `${pkg}/BrowserRunner.java`,
        `package TestRunner;
@CucumberOptions(features = {"src/test/resources/Features/Browser"}, glue = {"Steps"})
public class BrowserRunner extends AbstractTestNGCucumberTests {}
`,
      );
      fs.writeFileSync(
        `${pkg}/JwsRunner.java`,
        `package TestRunner;
@CucumberOptions(tags = "@jws", features = {"src/test/resources/Features/Api/Jws.feature"}, glue = {"Steps"})
public class JwsRunner extends AbstractTestNGCucumberTests {}
`,
      );
      // Exact file listing wins.
      expect(findCucumberRunner(root, 'src/test/resources/Features/Api/Jws.feature')).toBe('JwsRunner');
      // Folder prefix match.
      expect(findCucumberRunner(root, 'src/test/resources/Features/Browser/clients.feature')).toBe('BrowserRunner');
      // Unwired feature → untagged runner fallback.
      expect(findCucumberRunner(root, 'src/test/resources/Features/Other/x.feature')).toBe('BrowserRunner');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── Vitest runner ────────────────────────────────────────────────────────────

const VITEST_SOURCE = `import { describe, expect, it } from 'vitest';

describe('parser', () => {
  it('parses a simple case', () => {
    expect(1).toBe(1);
  });

  it.skip("handles 'quoted' input", () => {});

  test(\`template named case\`, () => {});

  // it('commented out — must not register', () => {});

  const helper = () => {};
});
`;

describe('vitest detection', () => {
  it('detects a project with vitest in devDependencies', () => {
    const root = fs.mkdtempSync('/tmp/trs-vitest-');
    try {
      fs.writeFileSync(`${root}/package.json`, JSON.stringify({ devDependencies: { vitest: '^4.0.0' } }));
      const result = detectRunner(root);
      expect(result.testable).toBe(true);
      expect(result.runnerType).toBe('vitest');
      expect(fs.realpathSync(result.moduleRoot!)).toBe(fs.realpathSync(root));
      expect(result.command).toBe('vitest run');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not detect a node project without vitest', () => {
    const root = fs.mkdtempSync('/tmp/trs-node-');
    try {
      fs.writeFileSync(`${root}/package.json`, JSON.stringify({ devDependencies: { jest: '^29.0.0' } }));
      expect(detectRunner(root).testable).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('scopes to a single test file', () => {
    const root = fs.mkdtempSync('/tmp/trs-vitest-file-');
    try {
      fs.writeFileSync(`${root}/package.json`, JSON.stringify({ devDependencies: { vitest: '^4.0.0' } }));
      fs.mkdirSync(`${root}/src`, { recursive: true });
      fs.writeFileSync(`${root}/src/foo.test.ts`, VITEST_SOURCE);
      const result = detectRunner(`${root}/src/foo.test.ts`);
      expect(result.testable).toBe(true);
      expect(result.runnerType).toBe('vitest');
      expect(result.testFilter).toBe('src/foo.test.ts');
      expect(result.command).toBe('vitest run src/foo.test.ts');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('mightBeVitestFile', () => {
  it('matches .test/.spec sources and rejects the rest', () => {
    for (const n of ['a.test.ts', 'b.spec.tsx', 'c.test.js', 'd.spec.mjs', 'e.test.cts']) {
      expect(mightBeVitestFile(n)).toBe(true);
    }
    for (const n of ['a.ts', 'test.ts', 'FooTest.java', 'a.test.css']) {
      expect(mightBeVitestFile(n)).toBe(false);
    }
  });
});

describe('extractVitestTests', () => {
  it('extracts it/test names incl. modifiers and template literals', () => {
    const methods = extractVitestTests(VITEST_SOURCE);
    expect(methods.map((m) => m.name)).toEqual([
      'parses a simple case',
      "handles 'quoted' input",
      'template named case',
    ]);
    for (const m of methods) {
      expect(VITEST_SOURCE.split('\n')[m.line - 1]).toContain(m.name.slice(0, 8));
    }
  });
});

describe('splitVitestFilter', () => {
  it('splits file and test-name parts', () => {
    expect(splitVitestFilter('src/foo.test.ts')).toEqual({ file: 'src/foo.test.ts' });
    expect(splitVitestFilter('src/foo.test.ts::does the thing')).toEqual({
      file: 'src/foo.test.ts',
      namePattern: 'does the thing',
    });
  });
});

describe('parseJUnitSuites', () => {
  it('parses multiple suites from a single vitest junit document', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="3" failures="1" errors="0" time="1.5">
  <testsuite name="src/a.test.ts" timestamp="2026-07-02T10:00:00" hostname="x" tests="2" failures="1" errors="0" skipped="0" time="0.9">
    <testcase classname="src/a.test.ts" name="suite &gt; passes" time="0.1"/>
    <testcase classname="src/a.test.ts" name="suite &gt; fails" time="0.2">
      <failure message="expected 1 to be 2" type="AssertionError">AssertionError: expected 1 to be 2
 at src/a.test.ts:10:5</failure>
    </testcase>
  </testsuite>
  <testsuite name="src/b.test.ts" tests="1" failures="0" errors="0" skipped="0" time="0.6">
    <testcase classname="src/b.test.ts" name="works" time="0.05"/>
  </testsuite>
</testsuites>`;
    const suites = parseJUnitSuites(xml);
    expect(suites).toHaveLength(2);
    expect(suites[0].name).toBe('src/a.test.ts');
    expect(suites[0].tests).toBe(2);
    expect(suites[0].failures).toBe(1);
    expect(suites[0].testcases[1].failureMessage).toBe('expected 1 to be 2');
    expect(suites[1].name).toBe('src/b.test.ts');
    expect(suites[1].passed).toBe(1);
  });
});

describe('scanTests (vitest)', () => {
  it('inventories vitest test files with their test names', () => {
    const root = fs.mkdtempSync('/tmp/trs-scan-vitest-');
    try {
      fs.writeFileSync(`${root}/package.json`, JSON.stringify({ devDependencies: { vitest: '^4.0.0' } }));
      fs.mkdirSync(`${root}/src/utils`, { recursive: true });
      fs.mkdirSync(`${root}/node_modules/dep`, { recursive: true });
      fs.writeFileSync(`${root}/src/utils/foo.test.ts`, VITEST_SOURCE);
      fs.writeFileSync(`${root}/src/utils/foo.ts`, 'export const x = 1;');
      // Must be skipped: inside node_modules.
      fs.writeFileSync(`${root}/node_modules/dep/dep.test.ts`, VITEST_SOURCE);
      // Statically opaque file — still runnable at file level.
      fs.writeFileSync(`${root}/src/utils/table.test.ts`, `import { it } from 'vitest';\nit.each([[1],[2]])('case %s', (n) => {});\n`);

      const scan = scanTests(root);
      expect(scan.testable).toBe(true);
      expect(scan.runnerType).toBe('vitest');
      expect(scan.classes).toHaveLength(2);
      const named = scan.classes.find((c) => c.className === 'foo.test.ts')!;
      expect(named.fqName).toBe('src/utils/foo.test.ts');
      expect(named.packageName).toBe('src/utils');
      expect(named.methods.map((m) => m.name)).toContain('parses a simple case');
      const table = scan.classes.find((c) => c.className === 'table.test.ts')!;
      expect(table.runner).toBe(true);
      expect(table.methods).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── PHPUnit runner ───────────────────────────────────────────────────────────

const PHP_SOURCE = `<?php

namespace App\\Tests\\Controller;

use Symfony\\Bundle\\FrameworkBundle\\Test\\WebTestCase;

class LoginTest extends WebTestCase
{
    public function testLoginAsOperator()
    {
        $this->assertTrue(true);
    }

    #[Test]
    public function attributeMarkedCase(): void
    {
    }

    /**
     * @test
     */
    public function docblockMarkedCase()
    {
    }

    private function helperMethod()
    {
    }
}
`;

describe('phpunit detection', () => {
  it('detects a project with a phpunit dependency in composer.json', () => {
    const root = fs.mkdtempSync('/tmp/trs-php-');
    try {
      fs.writeFileSync(`${root}/composer.json`, JSON.stringify({ 'require-dev': { 'phpunit/phpunit': '^9.5' } }));
      const result = detectRunner(root);
      expect(result.testable).toBe(true);
      expect(result.runnerType).toBe('phpunit');
      expect(result.command).toBe('phpunit');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('detects via phpunit.xml.dist even without the composer dep', () => {
    const root = fs.mkdtempSync('/tmp/trs-php-cfg-');
    try {
      fs.writeFileSync(`${root}/composer.json`, JSON.stringify({}));
      fs.writeFileSync(`${root}/phpunit.xml.dist`, '<phpunit/>');
      expect(detectRunner(root).runnerType).toBe('phpunit');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not detect a composer project without phpunit', () => {
    const root = fs.mkdtempSync('/tmp/trs-php-none-');
    try {
      fs.writeFileSync(`${root}/composer.json`, JSON.stringify({ require: { 'symfony/console': '^7.0' } }));
      expect(detectRunner(root).testable).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('scopes to a single test file', () => {
    const root = fs.mkdtempSync('/tmp/trs-php-file-');
    try {
      fs.writeFileSync(`${root}/composer.json`, JSON.stringify({ 'require-dev': { 'phpunit/phpunit': '^9.5' } }));
      fs.mkdirSync(`${root}/tests`, { recursive: true });
      fs.writeFileSync(`${root}/tests/LoginTest.php`, PHP_SOURCE);
      const result = detectRunner(`${root}/tests/LoginTest.php`);
      expect(result.testable).toBe(true);
      expect(result.testFilter).toBe('tests/LoginTest.php');
      expect(result.command).toBe('phpunit tests/LoginTest.php');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('mightBePhpTestFile', () => {
  it('matches *Test.php only', () => {
    expect(mightBePhpTestFile('LoginTest.php')).toBe(true);
    expect(mightBePhpTestFile('Login.php')).toBe(false);
    expect(mightBePhpTestFile('LoginTest.java')).toBe(false);
  });
});

describe('extractPhpTestMethods / extractPhpNamespace', () => {
  it('extracts test-prefixed, #[Test] and @test methods (not helpers)', () => {
    const methods = extractPhpTestMethods(PHP_SOURCE);
    expect(methods.map((m) => m.name)).toEqual([
      'testLoginAsOperator',
      'attributeMarkedCase',
      'docblockMarkedCase',
    ]);
  });

  it('reads the namespace declaration', () => {
    expect(extractPhpNamespace(PHP_SOURCE)).toBe('App\\Tests\\Controller');
    expect(extractPhpNamespace('<?php class X {}')).toBe('');
  });
});

describe('parseJUnitGroupedByClass', () => {
  it('groups nested phpunit testsuites by testcase class', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="Project Test Suite" tests="3" failures="1" time="2.0">
    <testsuite name="App\\Tests\\Controller\\LoginTest" file="/x/LoginTest.php" tests="2" failures="1" time="1.5">
      <testcase name="testLoginAsOperator" class="App\\Tests\\Controller\\LoginTest" classname="App.Tests.Controller.LoginTest" time="1.0"/>
      <testcase name="testBadCredentials" class="App\\Tests\\Controller\\LoginTest" classname="App.Tests.Controller.LoginTest" time="0.5">
        <failure type="AssertionError">Failed asserting that 401 matches 200.</failure>
      </testcase>
    </testsuite>
    <testsuite name="App\\Tests\\Controller\\OrderTest" file="/x/OrderTest.php" tests="1" time="0.5">
      <testcase name="testList" class="App\\Tests\\Controller\\OrderTest" classname="App.Tests.Controller.OrderTest" time="0.5"/>
    </testsuite>
  </testsuite>
</testsuites>`;
    const suites = parseJUnitGroupedByClass(xml).sort((a, b) => a.name.localeCompare(b.name));
    expect(suites).toHaveLength(2);
    expect(suites[0].name).toBe('App\\Tests\\Controller\\LoginTest');
    expect(suites[0].tests).toBe(2);
    expect(suites[0].failures).toBe(1);
    expect(suites[0].testcases[1].failureDetail).toContain('401 matches 200');
    expect(suites[1].name).toBe('App\\Tests\\Controller\\OrderTest');
    expect(suites[1].passed).toBe(1);
  });
});

describe('parseTeamCityLine', () => {
  it('parses type and unescapes attribute values', () => {
    const ev = parseTeamCityLine(
      "##teamcity[testFailed name='testX' message='expected |'a|' got |'b|'' details='line1|nline2' flowId='1']",
    );
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe('testFailed');
    expect(ev!.attrs.name).toBe('testX');
    expect(ev!.attrs.message).toBe("expected 'a' got 'b'");
    expect(ev!.attrs.details).toBe('line1\nline2');
  });

  it('returns null for regular output lines', () => {
    expect(parseTeamCityLine('PHPUnit 9.6.34 by Sebastian Bergmann')).toBeNull();
    expect(parseTeamCityLine('[2026-07-02] app.INFO: log line')).toBeNull();
  });
});

describe('PhpUnitProgressTracker', () => {
  const STREAM = [
    'PHPUnit 9.6.34 by Sebastian Bergmann and contributors.',
    '',
    "##teamcity[testCount count='2' flowId='1']",
    "##teamcity[testSuiteStarted name='App\\Tests\\LoginTest' locationHint='php_qn://x' flowId='1']",
    "##teamcity[testStarted name='testPasses' locationHint='php_qn://x' flowId='1']",
    'app log line while running',
    "##teamcity[testFinished name='testPasses' duration='120' flowId='1']",
    "##teamcity[testStarted name='testFails' flowId='1']",
    "##teamcity[testFailed name='testFails' message='boom' details='trace|nline2' flowId='1']",
    "##teamcity[testFinished name='testFails' duration='80' flowId='1']",
    "##teamcity[testSuiteFinished name='App\\Tests\\LoginTest' flowId='1']",
    '',
  ].join('\n');

  it('accumulates per-test results and passes non-protocol lines through', () => {
    const tracker = new PhpUnitProgressTracker();
    // Feed in awkward chunk sizes to exercise the line buffer.
    let output = '';
    let advances = 0;
    for (let i = 0; i < STREAM.length; i += 37) {
      const r = tracker.feed(STREAM.slice(i, i + 37));
      output += r.output;
      if (r.advanced) advances++;
    }
    expect(advances).toBeGreaterThanOrEqual(1);
    expect(output).toContain('PHPUnit 9.6.34');
    expect(output).toContain('app log line while running');
    expect(output).toContain('▶ App\\Tests\\LoginTest');
    expect(output).toContain('✓ testPasses (120 ms)');
    expect(output).toContain('✗ testFails (80 ms) — boom');
    expect(output).not.toContain('##teamcity');

    const result = tracker.result();
    expect(result.totals.tests).toBe(2);
    expect(result.totals.passed).toBe(1);
    expect(result.totals.failures).toBe(1);
    expect(result.suites[0].name).toBe('App\\Tests\\LoginTest');
    expect(result.suites[0].testcases[1].failureDetail).toBe('trace\nline2');
  });
});

describe('scanTests (phpunit)', () => {
  it('inventories *Test.php classes under tests/, skipping abstract bases', () => {
    const root = fs.mkdtempSync('/tmp/trs-scan-php-');
    try {
      fs.writeFileSync(`${root}/composer.json`, JSON.stringify({ 'require-dev': { 'phpunit/phpunit': '^9.5' } }));
      fs.mkdirSync(`${root}/tests/Controller`, { recursive: true });
      fs.mkdirSync(`${root}/vendor/pkg`, { recursive: true });
      fs.writeFileSync(`${root}/tests/Controller/LoginTest.php`, PHP_SOURCE);
      fs.writeFileSync(
        `${root}/tests/AbstractBaseTest.php`,
        `<?php\nnamespace App\\Tests;\nabstract class AbstractBaseTest {\n  public function testShared() {}\n}\n`,
      );
      fs.writeFileSync(`${root}/vendor/pkg/VendorTest.php`, PHP_SOURCE); // must be skipped

      const scan = scanTests(root);
      expect(scan.testable).toBe(true);
      expect(scan.runnerType).toBe('phpunit');
      expect(scan.classes).toHaveLength(1);
      const cls = scan.classes[0];
      expect(cls.className).toBe('LoginTest');
      expect(cls.fqName).toBe('App\\Tests\\Controller\\LoginTest');
      expect(cls.relFile).toBe('tests/Controller/LoginTest.php');
      expect(cls.methods).toHaveLength(3);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
