/**
 * Jira Integration - Configuration Schema
 * Defines the ConfigField[] for the generic settings UI.
 */

import type { ConfigField } from '../../../shared/integration-types.js';

export const jiraConfigSchema: ConfigField[] = [
  {
    key: 'jira_base_url',
    label: 'Jira Base URL',
    type: 'url',
    placeholder: 'https://yourcompany.atlassian.net',
    description: 'Your Atlassian Cloud instance URL',
    required: true,
    group: 'Authentication',
  },
  {
    key: 'jira_email',
    label: 'Jira Account Email',
    type: 'email',
    placeholder: 'user@company.com',
    description: 'Email address of the Jira account used for API access',
    required: true,
    group: 'Authentication',
  },
  {
    key: 'jira_api_token',
    label: 'Jira API Token',
    type: 'password',
    description: 'API token generated at https://id.atlassian.com/manage-profile/security/api-tokens',
    required: true,
    secret: true,
    group: 'Authentication',
  },
  {
    key: 'jira_default_project',
    label: 'Default Project Key',
    type: 'text',
    placeholder: 'SD',
    description: 'Default Jira project key for new issues (can be overridden per request)',
    required: false,
    group: 'Defaults',
  },
  {
    key: 'jira_default_issue_type',
    label: 'Default Issue Type',
    type: 'select',
    options: [
      { label: 'Change Request', value: 'Change Request' },
      { label: 'Service Request', value: 'Service Request' },
      { label: 'Task', value: 'Task' },
      { label: 'Bug', value: 'Bug' },
      { label: 'Story', value: 'Story' },
    ],
    description: 'Default issue type when creating tickets',
    required: false,
    group: 'Defaults',
  },
  {
    key: 'jira_webhook_secret',
    label: 'Webhook Secret',
    type: 'password',
    description: 'Secret for validating incoming Jira webhooks (optional, for trigger handler)',
    required: false,
    secret: true,
    group: 'Webhooks',
  },
  {
    key: 'jira_custom_field_mappings',
    label: 'Custom Field Mappings',
    type: 'textarea',
    description: 'JSON array mapping workflow variables to Jira custom fields. Example: [{"workflowVariable":"release_name","jiraField":"customfield_10042"}]',
    required: false,
    placeholder: '[{"workflowVariable": "...", "jiraField": "customfield_..."}]',
    group: 'Custom Fields',
  },
];

export interface JiraConfig {
  jira_base_url: string;
  jira_email: string;
  jira_api_token: string;
  jira_default_project?: string;
  jira_default_issue_type?: string;
  jira_webhook_secret?: string;
  jira_custom_field_mappings?: string;
}

export interface CustomFieldMapping {
  workflowVariable: string;
  jiraField: string;
}

/** Parse custom field mappings from the config JSON string. */
export function parseCustomFieldMappings(json: string | undefined): CustomFieldMapping[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m: unknown) =>
        typeof m === 'object' &&
        m !== null &&
        typeof (m as CustomFieldMapping).workflowVariable === 'string' &&
        typeof (m as CustomFieldMapping).jiraField === 'string'
    );
  } catch {
    return [];
  }
}
