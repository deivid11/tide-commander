/**
 * DOCX Integration - Event Logging Helpers
 * Wraps ctx.eventDb.logDocumentGeneration() for consistent logging.
 */

import type { IntegrationContext } from '../../../shared/integration-types.js';
import type { DocumentGenerationEvent } from '../../../shared/event-types.js';

let ctx: IntegrationContext | null = null;

export function initEvents(context: IntegrationContext): void {
  ctx = context;
}

export function logGeneration(params: {
  templateId: string;
  templateName: string;
  outputFilename: string;
  outputPath: string;
  variables: Record<string, unknown>;
  fileSizeBytes?: number;
  agentId?: string;
  workflowInstanceId?: string;
}): void {
  if (!ctx) return;

  const event: DocumentGenerationEvent = {
    templateId: params.templateId,
    templateName: params.templateName,
    outputFilename: params.outputFilename,
    outputPath: params.outputPath,
    variables: params.variables,
    fileSizeBytes: params.fileSizeBytes,
    agentId: params.agentId,
    workflowInstanceId: params.workflowInstanceId,
    generatedAt: Date.now(),
  };

  try {
    ctx.eventDb.logDocumentGeneration(event);
  } catch (err) {
    ctx.log.error('Failed to log document generation event', err);
  }
}
