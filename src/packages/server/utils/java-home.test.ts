import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { repairProcessJavaHome, resolveJavaHome } from './java-home.js';

const originalJavaHome = process.env.JAVA_HOME;
const dirs: string[] = [];

function fakeJdk(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-jdk-'));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'bin', 'java'), '#!/bin/sh\n', { mode: 0o755 });
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  if (originalJavaHome === undefined) delete process.env.JAVA_HOME;
  else process.env.JAVA_HOME = originalJavaHome;
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('java-home', () => {
  it('keeps a JAVA_HOME that contains bin/java', () => {
    const jdk = fakeJdk();
    expect(resolveJavaHome(jdk)).toBe(jdk);
    process.env.JAVA_HOME = jdk;
    expect(repairProcessJavaHome()).toBeNull();
    expect(process.env.JAVA_HOME).toBe(jdk);
  });

  it('replaces or unsets a dangling JAVA_HOME', () => {
    const dangling = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-jdk-gone-'));
    dirs.push(dangling);
    process.env.JAVA_HOME = dangling;
    const result = repairProcessJavaHome();
    expect(result?.from).toBe(dangling);
    // Either a real JDK on this host or nothing — never the dangling path.
    expect(process.env.JAVA_HOME).not.toBe(dangling);
    if (result?.to) expect(fs.existsSync(path.join(result.to, 'bin', 'java'))).toBe(true);
  });

  it('leaves an unset JAVA_HOME alone', () => {
    delete process.env.JAVA_HOME;
    expect(repairProcessJavaHome()).toBeNull();
  });
});
