import fs from 'fs/promises';
import path from 'path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ENV } from './env.js';

type JsonObject = Record<string, unknown>;

const PLANNING_ROOT = path.join(ENV.PROJECT_ROOT, '.planning', 'spec-kit');
const MANIFEST_ROOT = path.join(PLANNING_ROOT, 'manifest');
const SCHEMA_ROOT = path.join(MANIFEST_ROOT, 'schemas');
const SPECS_ROOT = path.join(PLANNING_ROOT, 'specs');
const AGENT_ROOT = path.join(ENV.PROJECT_ROOT, '.agent');

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

function validateOrThrow(ajv: Ajv2020, schema: JsonObject, payload: unknown, label: string): void {
  const validate = ajv.compile(schema);
  assert(validate(payload), `${label} schema mismatch: ${ajv.errorsText(validate.errors)}`);
}

function parseSchemaRef(ref: string): { fileRef: string; definitionRef: string } {
  const [fileRef, definitionRef] = ref.split('#');
  assert(typeof fileRef === 'string' && fileRef.length > 0, `invalid schema ref (missing file): ${ref}`);
  assert(typeof definitionRef === 'string' && definitionRef.length > 0, `invalid schema ref (missing hash fragment): ${ref}`);
  assert(
    definitionRef.startsWith('/definitions/'),
    `invalid schema ref fragment (expected /definitions/*): ${ref}`
  );
  return { fileRef, definitionRef };
}

function getDefinitionFromRef(schema: JsonObject, definitionRef: string): unknown {
  const segments = definitionRef.replace(/^\//, '').split('/');
  let cursor: unknown = schema;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object' || !(segment in (cursor as Record<string, unknown>))) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

export async function validateRuntimeContracts(): Promise<void> {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  const projectManifestSchemaPath = path.join(SCHEMA_ROOT, 'project.manifest.schema.json');
  const envSchemaPath = path.join(SCHEMA_ROOT, 'env.schema.json');
  const workflowSchemaPath = path.join(SCHEMA_ROOT, 'workflow.schema.json');
  const dataContractsSchemaPath = path.join(SCHEMA_ROOT, 'data-contracts.schema.json');
  const projectManifestPath = path.join(MANIFEST_ROOT, 'project.manifest.json');
  const executionLoopContractPath = path.join(SPECS_ROOT, 'execution-loop.contract.json');
  const decisionRulesPath = path.join(SPECS_ROOT, 'decision-rules.json');
  const apiContractPath = path.join(SPECS_ROOT, 'api-contract.json');
  const activityLogContractPath = path.join(AGENT_ROOT, 'contracts', 'activity-log.contract.json');

  const [
    projectManifestSchema,
    envSchema,
    workflowSchema,
    dataContractsSchema,
    projectManifest,
    executionLoopContract,
    decisionRules,
    apiContract,
    activityLogContract
  ] = await Promise.all([
    readJson(projectManifestSchemaPath),
    readJson(envSchemaPath),
    readJson(workflowSchemaPath),
    readJson(dataContractsSchemaPath),
    readJson(projectManifestPath),
    readJson(executionLoopContractPath),
    readJson(decisionRulesPath),
    readJson(apiContractPath),
    readJson(activityLogContractPath)
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
    DRY_RUN_MODE: ENV.DRY_RUN_MODE,
    BROWSER_HEADLESS: ENV.BROWSER_HEADLESS
  };
  validateOrThrow(ajv, envSchema, envPayload, 'runtime env');

  const manifestEnvRef = projectManifest.env_contract_ref;
  assert(typeof manifestEnvRef === 'string' && manifestEnvRef.length > 0, 'project.manifest.json missing env_contract_ref');
  const resolvedEnvSchemaPath = resolveManifestRef(manifestEnvRef);
  assert(path.normalize(resolvedEnvSchemaPath) === path.normalize(envSchemaPath), 'env_contract_ref does not match env.schema.json');

  const dataContracts = (projectManifest.data_contracts ?? {}) as JsonObject;
  const manifestActivityLogRef = dataContracts.activity_log;
  assert(
    typeof manifestActivityLogRef === 'string' && manifestActivityLogRef.length > 0,
    'project.manifest.json data_contracts.activity_log is missing'
  );
  const resolvedActivityLogPath = path.join(ENV.PROJECT_ROOT, manifestActivityLogRef as string);
  assert(
    path.normalize(resolvedActivityLogPath) === path.normalize(activityLogContractPath),
    'data_contracts.activity_log does not match .agent/contracts/activity-log.contract.json'
  );
  const activityLogFromDataSchema = getDefinitionFromRef(dataContractsSchema, '/definitions/activityLog');
  const activityLogFromContract = getDefinitionFromRef(activityLogContract, '/definitions/activityLog');
  assert(Boolean(activityLogFromDataSchema), 'data-contracts.schema.json missing definitions.activityLog');
  assert(Boolean(activityLogFromContract), 'activity-log.contract.json missing definitions.activityLog');
  assert(
    JSON.stringify(activityLogFromDataSchema) === JSON.stringify(activityLogFromContract),
    'activity-log contract does not match data-contracts.schema.json definitions.activityLog'
  );

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

    const publisherSequence = (workflowDefinition.publisher_sequence ?? []) as JsonObject[];
    assert(Array.isArray(publisherSequence) && publisherSequence.length > 0, `workflow.${workflowId}.json publisher_sequence must not be empty`);
    const actions = new Set(
      publisherSequence
        .map((step) => (typeof step.action === 'string' ? step.action : ''))
        .filter(Boolean)
    );
    assert(actions.has('verify_text'), `workflow.${workflowId}.json publisher_sequence must include verify_text action`);
    assert(actions.has('select'), `workflow.${workflowId}.json publisher_sequence must include select action`);
    assert(actions.has('submit'), `workflow.${workflowId}.json publisher_sequence must include submit action`);

    const publisherGuards = (decisionRules.publisher_guards ?? {}) as JsonObject;
    const requiredBodyText = publisherGuards.require_body_contains;
    if (typeof requiredBodyText === 'string' && requiredBodyText.length > 0) {
      const verifyStep = publisherSequence.find((step) => step.action === 'verify_text') as JsonObject | undefined;
      assert(
        Boolean(verifyStep) && verifyStep?.expected_text === requiredBodyText,
        `workflow.${workflowId}.json verify_text expected_text must match decision-rules require_body_contains`
      );
    }
  }

  const routes = (apiContract.routes ?? []) as JsonObject[];
  assert(Array.isArray(routes) && routes.length > 0, 'api-contract.json routes must contain at least one route');
  const routeKey = (method: string, path: string) => `${method.toUpperCase()} ${path}`;
  const routeKeys = new Set(
    routes
      .map((r) => {
        const method = typeof r.method === 'string' ? r.method : '';
        const routePath = typeof r.path === 'string' ? r.path : '';
        return method && routePath ? routeKey(method, routePath) : '';
      })
      .filter(Boolean)
  );
  const requiredApiRouteKeys = [
    'GET /publisher-history',
    'GET /logs',
    'GET /analytics/competitors',
    'GET /competitor-stats',
    'GET /board-stats',
    'GET /trend-insights',
    'GET /drafts',
    'POST /run-observer',
    'POST /run-publisher',
    'GET /control-panel',
    'POST /control-panel'
  ];
  for (const requiredRoute of requiredApiRouteKeys) {
    assert(routeKeys.has(requiredRoute), `api-contract.json missing required route: ${requiredRoute}`);
  }
  for (const route of routes) {
    const responseSchemaRef = route.response_schema_ref;
    assert(
      typeof responseSchemaRef === 'string' && responseSchemaRef.length > 0,
      'api-contract.json route missing response_schema_ref'
    );
    const parsedResponseRef = parseSchemaRef(responseSchemaRef);
    const responseSchemaPath = path.normalize(path.resolve(SPECS_ROOT, parsedResponseRef.fileRef));
    assert(
      responseSchemaPath === path.normalize(dataContractsSchemaPath),
      `api-contract response_schema_ref must point to data-contracts.schema.json: ${responseSchemaRef}`
    );
    assert(
      Boolean(getDefinitionFromRef(dataContractsSchema, parsedResponseRef.definitionRef)),
      `api-contract response_schema_ref target does not exist: ${responseSchemaRef}`
    );

    const requestSchemaRef = route.request_schema_ref;
    if (requestSchemaRef !== null && requestSchemaRef !== undefined) {
      assert(typeof requestSchemaRef === 'string', `api-contract request_schema_ref must be string or null`);
      const parsedRequestRef = parseSchemaRef(requestSchemaRef);
      const requestSchemaPath = path.normalize(path.resolve(SPECS_ROOT, parsedRequestRef.fileRef));
      assert(
        requestSchemaPath === path.normalize(dataContractsSchemaPath),
        `api-contract request_schema_ref must point to data-contracts.schema.json: ${requestSchemaRef}`
      );
      assert(
        Boolean(getDefinitionFromRef(dataContractsSchema, parsedRequestRef.definitionRef)),
        `api-contract request_schema_ref target does not exist: ${requestSchemaRef}`
      );
    }
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
