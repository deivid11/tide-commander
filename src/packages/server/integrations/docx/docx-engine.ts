/**
 * DOCX Integration - Template Engine
 * Wraps docxtemplater for template rendering, manages template/generated file storage.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import type { IntegrationContext } from '../../../shared/integration-types.js';
import type { DocxConfig } from './docx-config.js';
import { logGeneration } from './docx-events.js';

// ─── Types ───

export interface DocumentTemplate {
  id: string;
  name: string;
  description?: string;
  filename: string;
  storedPath: string;
  variables: string[];
  createdAt: number;
  updatedAt: number;
}

export interface GeneratedDocument {
  id: string;
  templateId: string;
  filename: string;
  storedPath: string;
  variables: Record<string, unknown>;
  createdAt: number;
}

// ─── State ───

const DATA_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander'
);

let config: DocxConfig = {
  templateDir: path.join(DATA_DIR, 'templates'),
  generatedDir: path.join(DATA_DIR, 'generated'),
  retentionDays: 90,
  libreOfficePath: 'libreoffice',
};

const TEMPLATE_META_FILE = path.join(DATA_DIR, 'template-meta.json');

let templates: DocumentTemplate[] = [];
let generatedDocs: GeneratedDocument[] = [];
let ctx: IntegrationContext | null = null;

// ─── Lifecycle ───

export function init(context: IntegrationContext, cfg?: Partial<DocxConfig>): void {
  ctx = context;
  if (cfg) {
    config = { ...config, ...cfg };
  }
  ensureDirs();
  loadMeta();
}

function ensureDirs(): void {
  for (const dir of [config.templateDir, config.generatedDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function loadMeta(): void {
  try {
    if (fs.existsSync(TEMPLATE_META_FILE)) {
      const raw = JSON.parse(fs.readFileSync(TEMPLATE_META_FILE, 'utf-8'));
      templates = raw.templates || [];
      generatedDocs = raw.generated || [];
    }
  } catch {
    ctx?.log.warn('Failed to load template metadata, starting fresh');
    templates = [];
    generatedDocs = [];
  }
}

function saveMeta(): void {
  try {
    fs.writeFileSync(TEMPLATE_META_FILE, JSON.stringify({ templates, generated: generatedDocs }, null, 2), 'utf-8');
  } catch (err) {
    ctx?.log.error('Failed to save template metadata', err);
  }
}

export function updateConfig(cfg: Partial<DocxConfig>): void {
  config = { ...config, ...cfg };
  ensureDirs();
}

export function getConfig(): DocxConfig {
  return { ...config };
}

// ─── Templates ───

export function listTemplates(): DocumentTemplate[] {
  return templates;
}

export function getTemplate(id: string): DocumentTemplate | undefined {
  return templates.find(t => t.id === id);
}

export function uploadTemplate(file: Buffer, originalFilename: string, name: string, description?: string): DocumentTemplate {
  const id = crypto.randomUUID();
  const ext = path.extname(originalFilename) || '.docx';
  const storedFilename = `${id}${ext}`;
  const storedPath = path.join(config.templateDir, storedFilename);

  fs.writeFileSync(storedPath, file);

  const variables = extractVariables(storedPath);

  const template: DocumentTemplate = {
    id,
    name,
    description,
    filename: originalFilename,
    storedPath,
    variables,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  templates.push(template);
  saveMeta();

  ctx?.log.info(`Template uploaded: ${name} (${variables.length} variables)`);
  return template;
}

export function deleteTemplate(id: string): boolean {
  const idx = templates.findIndex(t => t.id === id);
  if (idx === -1) return false;

  const template = templates[idx];
  try {
    if (fs.existsSync(template.storedPath)) {
      fs.unlinkSync(template.storedPath);
    }
  } catch {
    // Best effort deletion
  }

  templates.splice(idx, 1);
  saveMeta();
  return true;
}

export function extractVariables(templatePath: string): string[] {
  try {
    const content = fs.readFileSync(templatePath);
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });

    // Use getFullText to find all placeholders
    const text = doc.getFullText();
    const matches = text.match(/\{([^#/}][^}]*)\}/g);
    if (!matches) return [];

    const vars = new Set<string>();
    for (const match of matches) {
      const varName = match.slice(1, -1).trim();
      if (varName) vars.add(varName);
    }
    return Array.from(vars);
  } catch (err) {
    ctx?.log.error('Failed to extract variables from template', err);
    return [];
  }
}

// ─── Generation ───

export async function generateDocument(params: {
  templateId: string;
  variables: Record<string, unknown>;
  outputFilename?: string;
  agentId?: string;
  workflowInstanceId?: string;
}): Promise<GeneratedDocument> {
  const template = getTemplate(params.templateId);
  if (!template) {
    throw new Error(`Template not found: ${params.templateId}`);
  }

  if (!fs.existsSync(template.storedPath)) {
    throw new Error(`Template file missing: ${template.storedPath}`);
  }

  const content = fs.readFileSync(template.storedPath);
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });

  doc.render(params.variables);

  const buf = doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });

  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputFilename = params.outputFilename || `${template.name}-${timestamp}.docx`;
  const storedPath = path.join(config.generatedDir, `${id}-${outputFilename}`);

  fs.writeFileSync(storedPath, buf);

  const stats = fs.statSync(storedPath);

  const generated: GeneratedDocument = {
    id,
    templateId: params.templateId,
    filename: outputFilename,
    storedPath,
    variables: params.variables,
    createdAt: Date.now(),
  };

  generatedDocs.push(generated);
  saveMeta();

  // Log to SQLite event store
  logGeneration({
    templateId: template.id,
    templateName: template.name,
    outputFilename,
    outputPath: storedPath,
    variables: params.variables,
    fileSizeBytes: stats.size,
    agentId: params.agentId,
    workflowInstanceId: params.workflowInstanceId,
  });

  ctx?.log.info(`Document generated: ${outputFilename} from template ${template.name}`);
  return generated;
}

// ─── PDF Conversion ───

export async function convertToPdf(sourceFileId: string): Promise<{
  fileId: string;
  fileName: string;
  filePath: string;
}> {
  const doc = generatedDocs.find(d => d.id === sourceFileId);
  if (!doc) {
    throw new Error(`Generated document not found: ${sourceFileId}`);
  }

  if (!fs.existsSync(doc.storedPath)) {
    throw new Error(`Document file missing: ${doc.storedPath}`);
  }

  const outputDir = config.generatedDir;
  const libreoffice = config.libreOfficePath;

  try {
    execSync(
      `${libreoffice} --headless --convert-to pdf --outdir "${outputDir}" "${doc.storedPath}"`,
      { timeout: 60000, stdio: 'pipe' }
    );
  } catch (err) {
    throw new Error(`PDF conversion failed. Is LibreOffice installed? Error: ${err}`);
  }

  // LibreOffice outputs a file with the same name but .pdf extension
  const baseName = path.basename(doc.storedPath, path.extname(doc.storedPath));
  const pdfPath = path.join(outputDir, `${baseName}.pdf`);

  if (!fs.existsSync(pdfPath)) {
    throw new Error('PDF conversion produced no output file');
  }

  const pdfId = crypto.randomUUID();
  const pdfFileName = doc.filename.replace(/\.docx$/i, '.pdf');

  return {
    fileId: pdfId,
    fileName: pdfFileName,
    filePath: pdfPath,
  };
}

// ─── Generated Files ───

export function listGenerated(): GeneratedDocument[] {
  return generatedDocs;
}

export function getGenerated(id: string): GeneratedDocument | undefined {
  return generatedDocs.find(d => d.id === id);
}

export function deleteGenerated(id: string): boolean {
  const idx = generatedDocs.findIndex(d => d.id === id);
  if (idx === -1) return false;

  const doc = generatedDocs[idx];
  try {
    if (fs.existsSync(doc.storedPath)) {
      fs.unlinkSync(doc.storedPath);
    }
  } catch {
    // Best effort deletion
  }

  generatedDocs.splice(idx, 1);
  saveMeta();
  return true;
}
