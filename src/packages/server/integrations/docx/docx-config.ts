/**
 * DOCX Integration - Configuration Schema
 * Defines the ConfigField[] for the generic settings UI.
 */

import type { ConfigField } from '../../../shared/integration-types.js';

export const docxConfigSchema: ConfigField[] = [
  {
    key: 'templateDir',
    label: 'Template Directory',
    type: 'text',
    description: 'Directory where DOCX template files are stored. Defaults to ~/.local/share/tide-commander/templates/',
    required: false,
    group: 'Storage',
  },
  {
    key: 'generatedDir',
    label: 'Generated Output Directory',
    type: 'text',
    description: 'Directory where generated documents are saved. Defaults to ~/.local/share/tide-commander/generated/',
    required: false,
    group: 'Storage',
  },
  {
    key: 'retentionDays',
    label: 'File Retention (days)',
    type: 'number',
    description: 'Number of days to keep generated documents before cleanup. Set to 0 to disable auto-cleanup.',
    required: false,
    defaultValue: 90,
    group: 'Retention',
  },
  {
    key: 'libreOfficePath',
    label: 'LibreOffice Binary Path',
    type: 'text',
    description: 'Path to the LibreOffice binary for PDF conversion. Defaults to "libreoffice" (must be on PATH).',
    required: false,
    defaultValue: 'libreoffice',
    placeholder: 'libreoffice',
    group: 'PDF Conversion',
  },
];

export interface DocxConfig {
  templateDir: string;
  generatedDir: string;
  retentionDays: number;
  libreOfficePath: string;
}
