import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILE_ICONS } from './constants';
import { getFileIcon, getIconForFileName, getIconForExtension } from './fileUtils';
import type { TreeNode } from './types';

const ASSET_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../..',
  'public/assets/vscode-icons'
);

const iconFile = (src: string) => src.slice(src.lastIndexOf('/') + 1);

const node = (name: string): TreeNode => ({
  name,
  path: `/repo/${name}`,
  isDirectory: false,
  size: 0,
  extension: name.lastIndexOf('.') > 0 ? name.slice(name.lastIndexOf('.')).toLowerCase() : '',
});

describe('FILE_ICONS', () => {
  it('points every mapping at an SVG that exists on disk', () => {
    // A missing asset renders as a blank <img>, not as the default icon — so a
    // typo'd filename is invisible in code review but very visible in the UI.
    const available = new Set(fs.readdirSync(ASSET_DIR));
    const broken = Object.entries(FILE_ICONS)
      .filter(([, src]) => !available.has(iconFile(src)))
      .map(([key, src]) => `${key} -> ${iconFile(src)}`);
    expect(broken).toEqual([]);
  });

  it('has a default entry', () => {
    expect(FILE_ICONS.default).toBeTruthy();
  });
});

describe('getIconForFileName', () => {
  it('resolves whole-name keys before extensions', () => {
    expect(iconFile(getIconForFileName('Dockerfile'))).toBe('file_type_docker.svg');
    expect(iconFile(getIconForFileName('bun.lock'))).toBe('file_type_bun.svg');
    expect(iconFile(getIconForFileName('gradlew'))).toBe('file_type_gradle.svg');
  });

  it('resolves dotfiles by their full name', () => {
    expect(iconFile(getIconForFileName('.gitignore'))).toBe('file_type_git.svg');
    expect(iconFile(getIconForFileName('.dockerignore'))).toBe('file_type_docker.svg');
    expect(iconFile(getIconForFileName('.env'))).toBe('file_type_dotenv.svg');
  });

  it('falls back to the extension, case-insensitively', () => {
    expect(iconFile(getIconForFileName('GuakeGitPanel.tsx'))).toBe(iconFile(getIconForExtension('.tsx')));
    expect(iconFile(getIconForFileName('logo.SVG'))).toBe('file_type_svg.svg');
    expect(iconFile(getIconForFileName('service.ts'))).toBe(iconFile(getIconForExtension('.ts')));
  });

  it('prefers the longest compound suffix over the plain extension', () => {
    expect(iconFile(getIconForFileName('users.controller.ts'))).toBe('file_type_nest_controller_ts.svg');
    expect(iconFile(getIconForFileName('users.module.ts'))).toBe('file_type_nest_module_ts.svg');
    expect(iconFile(getIconForFileName('auth.guard.ts'))).toBe('file_type_nest_guard_ts.svg');
    expect(iconFile(getIconForFileName('index.d.ts'))).toBe('file_type_typescriptdef.svg');
    expect(iconFile(getIconForFileName('app.spec.ts'))).toBe('file_type_testts.svg');
    expect(iconFile(getIconForFileName('show.blade.php'))).toBe('file_type_blade.svg');
    expect(iconFile(getIconForFileName('release.tar.gz'))).toBe('file_type_zip.svg');
    // A plain file of the same base type still resolves to its own icon.
    expect(iconFile(getIconForFileName('users.ts'))).toBe(iconFile(getIconForExtension('.ts')));
    expect(iconFile(getIconForFileName('index.php'))).toBe('file_type_php.svg');
  });

  it('covers the stacks in daily use', () => {
    const expected: Record<string, string> = {
      // Java / Spring
      'Application.java': 'file_type_java.svg',
      'pom.xml': 'file_type_maven.svg',
      'mvnw': 'file_type_maven.svg',
      'build.gradle': 'file_type_gradle.svg',
      'index.jsp': 'file_type_jsp.svg',
      'app.jar': 'file_type_binary.svg',
      // PHP / Symfony
      'Kernel.php': 'file_type_php.svg',
      'base.html.twig': 'file_type_twig.svg',
      'composer.json': 'file_type_composer.svg',
      'symfony.lock': 'file_type_symfony.svg',
      'phpunit.xml.dist': 'file_type_phpunit.svg',
      'phpstan.neon': 'file_type_phpstan.svg',
      // Node / Nest
      'nest-cli.json': 'file_type_nestjs.svg',
      'app.service.ts': 'file_type_nest_service_ts.svg',
      'package.json': 'file_type_npm.svg',
      // Rust
      'main.rs': 'file_type_rust.svg',
      'Cargo.toml': 'file_type_cargo.svg',
      'rust-toolchain.toml': 'file_type_rust_toolchain.svg',
      // C
      'main.c': 'file_type_c.svg',
      'stdio.h': 'file_type_cheader.svg',
      'util.hpp': 'file_type_cppheader.svg',
      'CMakeLists.txt': 'file_type_cmake.svg',
      // Bash
      'deploy.sh': 'file_type_shell.svg',
      '.bashrc': 'file_type_shell.svg',
      '.zshrc': 'file_type_shell.svg',
    };
    const actual = Object.fromEntries(
      Object.keys(expected).map((name) => [name, iconFile(getIconForFileName(name))])
    );
    expect(actual).toEqual(expected);
  });

  it('covers enterprise/XML, keystore and fabrication files', () => {
    const expected: Record<string, string> = {
      'schema.xsd': 'file_type_xml.svg',
      'service.wsdl': 'file_type_xml.svg',
      'beans.xml': 'file_type_xml.svg',
      'report.jrxml': 'file_type_xml.svg',
      'rules.drl': 'file_type_drools.svg',
      'mail.ftl': 'file_type_freemarker.svg',
      'App.class': 'file_type_class.svg',
      'keystore.jks': 'file_type_cert.svg',
      'server.truststore': 'file_type_cert.svg',
      'release.asc': 'file_type_key.svg',
      'board-B_Cu.gbl': 'file_type_binary.svg',
      'board.kicad_pcb': 'file_type_binary.svg',
      'part.stl': 'file_type_binary.svg',
      'toolpath.gcode': 'file_type_gcode.svg',
      'events.jsonl': 'file_type_json.svg',
      'notes.bak': 'file_type_bak.svg',
    };
    const actual = Object.fromEntries(
      Object.keys(expected).map((name) => [name, iconFile(getIconForFileName(name))])
    );
    expect(actual).toEqual(expected);
  });

  it('matches whole-name keys regardless of case', () => {
    expect(iconFile(getIconForFileName('dockerfile'))).toBe('file_type_docker.svg');
    expect(iconFile(getIconForFileName('license'))).toBe('file_type_license.svg');
    expect(iconFile(getIconForFileName('Makefile'))).toBe(iconFile(getIconForFileName('makefile')));
  });

  it('resolves variants of an extension-less name by its stem', () => {
    expect(iconFile(getIconForFileName('Dockerfile.dev'))).toBe('file_type_docker.svg');
    expect(iconFile(getIconForFileName('Makefile.local'))).toBe('file_type_config.svg');
    // A known suffix still wins over the stem.
    expect(iconFile(getIconForFileName('application.properties'))).toBe(iconFile(getIconForExtension('.properties')));
  });

  it('looks through template/variant suffixes', () => {
    expect(iconFile(getIconForFileName('config.yaml.dist'))).toBe(iconFile(getIconForExtension('.yaml')));
    expect(iconFile(getIconForFileName('pre-commit.sample'))).toBe(iconFile(getIconForFileName('pre-commit')));
    expect(iconFile(getIconForFileName('settings.json.example'))).toBe(iconFile(getIconForExtension('.json')));
    // Backup markers keep their own icon instead of being looked through.
    expect(iconFile(getIconForFileName('schema.sql.bak'))).toBe('file_type_bak.svg');
  });

  it('falls back to the default icon for unknown names', () => {
    expect(iconFile(getIconForFileName('mystery'))).toBe('default_file.svg');
    expect(iconFile(getIconForFileName('data.qqq'))).toBe('default_file.svg');
  });
});

describe('getFileIcon', () => {
  it('uses the filename, so extension-less files keep their icon', () => {
    expect(iconFile(getFileIcon(node('Dockerfile')))).toBe('file_type_docker.svg');
    expect(iconFile(getFileIcon(node('.gitignore')))).toBe('file_type_git.svg');
    expect(iconFile(getFileIcon(node('app.svg')))).toBe('file_type_svg.svg');
  });

  it('returns nothing for directories', () => {
    expect(getFileIcon({ ...node('src'), isDirectory: true })).toBe('');
  });
});
