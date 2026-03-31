import fs from 'fs/promises';
import path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { ENV } from './env.js';

type JsonObject = Record<string, unknown>;

const PLANNING_ROOT = path.join(ENV.PROJECT_ROOT, '.planning', 'spec-kit');
const MANIFEST_ROOT = path.join(PLANNING_ROOT, 'manifest');
const SCHEMA_ROOT = path.join(MANIFEST_ROOT, 'schemas');
const SPECS_ROOT = path.join(PLANNING_ROOT, 'specs');

async function readJson(filePath: string): Promise<JsonObject> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as JsonObject;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[RUNTIME_VALIDATION] ${message}`);
  }
}

function resolveManifestRef(ref: string): string {
  const cleanRef = ref.startsWith('./') ? ref.slice(2) : ref;
  return path.join(MANIFEST_ROOT, cleanRef);
}

function validateOrThrow(ajv: Ajv, schema: JsonObject, payload: unknown, label: string): void {
  const validate = ajv.compile(schema);
  assert(validate(payload), `${label} schema mismatch: ${ajv.errorsText(validate.errors)}`);
}

export async function validateRuntimeContracts(): Promise<void> {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const projectManifestSchemaPath = path.join(SCHEMA_ROOT, 'project.manifest.schema.json');
  const envSchemaPath = path.join(SCHEMA_ROOT, 'env.schema.json');
  const workflowSchemaPath = path.join(SCHEMA_ROOT, 'workflow.schema.json');
  const projectManifestPath = path.join(MANIFEST_ROOT, 'project.manifest.json');
  const executionLoopContractPath = path.join(SPECS_ROOT, 'execution-loop.contract.json');
  const decisionRulesPath = path.join(SPECS_ROOT, 'decision-rules.json');

  const [
    projectManifestSchema,
    envSchema,
    workflowSchema,
    projectManifest,
    executionLoopContract,
    decisionRules
  ] = await Promise.all([
    readJson(projectManifestSchemaPath),
    readJson(envSchemaPath),
    readJson(workflowSchemaPath),
    readJson(projectManifestPath),
    readJson(executionLoopContractPath),
    readJson(decisionRulesPath)
  ]);

  validateOrThrow(ajv, projectManifestSchema, projectManifest, 'project.manifest.json');

  const envPayload = {
    PROJECT_ROOT: ENV.PROJECT_ROOT,
    FORUM_PRIMARY_ID: ENV.FORUM_PRIMARY_ID,
    PPOMPPU_USER_ID: ENV.PPOMPPU_USER_ID,
    PPOMPPU_USER_PW: ENV.PPOMPPU_USER_PW,
    BOT_PROFILE_DIR: ENV.BOT_PROFILE_DIR,
    ACTIVITY_LOG_PATH: ENV.ACTIVITY_LOG_PATH,
    OBSERVER_GAP_THRESHOLD: ENV.OBSERVER_GAP_THRESHOLD,
    RUN_INTERVAL_MINUTES: ENV.RUN_INTERVAL_MINUTES,
    MANUAL_OVERRIDE_ENABLED: ENV.MANUAL_OVERRIDE_ENABLED,
    DRY_RUN_MODE: ENV.DRY_RUN_MODE
  };
  validateOrThrow(ajv, envSchema, envPayload, 'runtime env');

  const manifestEnvRef = projectManifest.env_contract_ref;
  assert(typeof manifestEnvRef === 'string' && manifestEnvRef.length > 0, 'project.manifest.json missing env_contract_ref');
  const resolvedEnvSchemaPath = resolveManifestRef(manifestEnvRef);
  assert(path.normalize(resolvedEnvSchemaPath) === path.normalize(envSchemaPath), 'env_contract_ref does not match env.schema.json');

  const workflowDefinitions = (workflowSchema.definitions ?? {}) as JsonObject;
  assert(Boolean(workflowDefinitions.observerRules), 'workflow.schema.json missing definitions.observerRules');
  assert(Boolean(workflowDefinitions.publisherSequence), 'workflow.schema.json missing definitions.publisherSequence');

  const workflowRegistry = (projectManifest.workflow_registry ?? []) as JsonObject[];
  assert(Array.isArray(workflowRegistry) && workflowRegistry.length > 0, 'project.manifest.json workflow_registry must contain at least one workflow');
  for (const workflow of workflowRegistry) {
    assert(typeof workflow.workflow_id === 'string' && workflow.workflow_id.length > 0, 'workflow_registry entry missing workflow_id');
    assert(typeof workflow.entry_url === 'string', 'workflow_registry entry missing entry_url');
    const workflowId = workflow.workflow_id as string;
    const workflowFilePath = path.join(MANIFEST_ROOT, `workflow.${workflowId}.json`);
    const workflowDefinition = await readJson(workflowFilePath);
    validateOrThrow(ajv, workflowSchema, workflowDefinition, `workflow.${workflowId}.json`);
    assert(workflowDefinition.workflow_id === workflowId, `workflow.${workflowId}.json workflow_id must match registry id`);
  }

  const runContext = executionLoopContract.run_context as JsonObject | undefined;
  assert(Boolean(runContext), 'execution-loop.contract.json missing run_context');
  assert(runContext?.concurrency_policy === 'single_active_run_lock', 'execution-loop.contract.json concurrency_policy must be single_active_run_lock');
  const outcomes = executionLoopContract.outcomes;
  assert(Array.isArray(outcomes) && outcomes.includes('MANUAL_REVIEW'), 'execution-loop.contract.json outcomes must include MANUAL_REVIEW');

  const observerRules = decisionRules.observer_rules as JsonObject | undefined;
  assert(Boolean(observerRules), 'decision-rules.json missing observer_rules');
  const parseConfidenceMin = observerRules?.parse_confidence_min;
  assert(typeof parseConfidenceMin === 'number', 'decision-rules.json observer_rules.parse_confidence_min must be a number');
}
