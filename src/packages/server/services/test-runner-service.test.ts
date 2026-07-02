import { describe, expect, it } from 'vitest';
import fs from 'fs';
import { parseSurefireXml, detectRunner, deriveStatus, mightBeTestFile } from './test-runner-service.js';

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
