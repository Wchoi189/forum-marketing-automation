import fs from 'fs/promises';
import path from 'path';

import { ENV } from '../../../config/env.js';
import type { PublisherPlaybook } from '../../playbookRunner.js';

const DEFAULT_WORKFLOW_ID = 'ppomppu-gonggu-v1';

async function readPlanningJson<T>(relativePath: string): Promise<T> {
  const filePath = path.join(ENV.PROJECT_ROOT, '.planning', 'spec-kit', relativePath);
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

export async function loadPublisherPlaybook(workflowId: string = DEFAULT_WORKFLOW_ID): Promise<PublisherPlaybook> {
  const playbook = await readPlanningJson<PublisherPlaybook>(`manifest/playbook.${workflowId}.json`);
  if (playbook.workflow_id !== workflowId) {
    throw new Error(`PUBLISHER_PLAYBOOK_INVALID: workflow_id mismatch (${playbook.workflow_id} != ${workflowId})`);
  }
  const actions = new Set(playbook.steps.map((s) => s.action));
  if (!actions.has('verify_text') || !actions.has('select') || !actions.has('submit')) {
    throw new Error('PUBLISHER_PLAYBOOK_INVALID: required actions verify_text/select/submit missing');
  }
  return playbook;
}
