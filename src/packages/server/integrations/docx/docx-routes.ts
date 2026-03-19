/**
 * DOCX Integration - Express Routes
 * Template management, document generation, and PDF conversion endpoints.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as fs from 'fs';
import * as docxEngine from './docx-engine.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Template Management ───

// List templates
router.get('/templates', (_req: Request, res: Response) => {
  res.json({ templates: docxEngine.listTemplates() });
});

// Get template metadata
router.get('/templates/:id', (req: Request, res: Response) => {
  const template = docxEngine.getTemplate(req.params.id as string);
  if (!template) {
    res.status(404).json({ error: 'Template not found' });
    return;
  }
  res.json({ template });
});

// Upload template (multipart/form-data)
router.post('/templates', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded. Use multipart/form-data with field name "file".' });
    return;
  }

  const name = (req.body.name as string) || req.file.originalname;
  const description = req.body.description as string | undefined;

  try {
    const template = docxEngine.uploadTemplate(req.file.buffer, req.file.originalname, name, description);
    res.status(201).json({ template });
  } catch (err) {
    res.status(500).json({ error: `Failed to upload template: ${err}` });
  }
});

// Delete template
router.delete('/templates/:id', (req: Request, res: Response) => {
  const deleted = docxEngine.deleteTemplate(req.params.id as string);
  if (!deleted) {
    res.status(404).json({ error: 'Template not found' });
    return;
  }
  res.json({ success: true });
});

// ─── Document Generation ───

router.post('/generate', async (req: Request, res: Response) => {
  const { templateId, variables, outputFilename, agentId, workflowInstanceId } = req.body;

  if (!templateId) {
    res.status(400).json({ error: 'templateId is required' });
    return;
  }
  if (!variables || typeof variables !== 'object') {
    res.status(400).json({ error: 'variables object is required' });
    return;
  }

  try {
    const document = await docxEngine.generateDocument({
      templateId,
      variables,
      outputFilename,
      agentId,
      workflowInstanceId,
    });
    res.json({ document, path: document.storedPath });
  } catch (err) {
    res.status(500).json({ error: `Generation failed: ${err}` });
  }
});

// ─── Generated Files ───

// List generated docs
router.get('/generated', (_req: Request, res: Response) => {
  res.json({ documents: docxEngine.listGenerated() });
});

// Download generated file
router.get('/generated/:id/download', (req: Request, res: Response) => {
  const doc = docxEngine.getGenerated(req.params.id as string);
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  if (!fs.existsSync(doc.storedPath)) {
    res.status(404).json({ error: 'Document file missing from disk' });
    return;
  }
  res.download(doc.storedPath, doc.filename);
});

// Delete generated file
router.delete('/generated/:id', (req: Request, res: Response) => {
  const deleted = docxEngine.deleteGenerated(req.params.id as string);
  if (!deleted) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  res.json({ success: true });
});

// ─── PDF Conversion ───

router.post('/convert', async (req: Request, res: Response) => {
  const { sourceFileId, outputFormat } = req.body;

  if (!sourceFileId) {
    res.status(400).json({ error: 'sourceFileId is required' });
    return;
  }
  if (outputFormat && outputFormat !== 'pdf') {
    res.status(400).json({ error: 'Only "pdf" output format is supported' });
    return;
  }

  try {
    const result = await docxEngine.convertToPdf(sourceFileId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `PDF conversion failed: ${err}` });
  }
});

export default router;
