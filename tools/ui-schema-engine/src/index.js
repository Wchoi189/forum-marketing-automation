'use strict';

const { extractSemanticUiSchema } = require('./domExtractor');
const { serializeToYaml, serializeToJson, serializeToDsl } = require('./schemaSerializer');
const { estimateTokenCount } = require('./tokenEstimator');

/**
 * High-level capture function: extract + serialize in all formats.
 *
 * @param {Element|null} [rootElement]
 * @param {import('./types').ExtractionOptions} [options]
 * @param {Document} [documentOverride]
 * @returns {{ schema: import('./types').UiViewSchema, yaml: string, json: string, dsl: string, tokenEstimate: number }}
 */
function captureUiSchema(rootElement, options, documentOverride) {
  const schema = extractSemanticUiSchema(rootElement, options, documentOverride);
  const yaml   = serializeToYaml(schema);
  const json   = serializeToJson(schema);
  const dsl    = serializeToDsl(schema);
  const tokenEstimate = estimateTokenCount(yaml);

  schema.stats = {
    totalFields:    schema.fields.length,
    totalActions:   schema.actions.length,
    estimatedTokens: tokenEstimate,
  };

  return { schema, yaml, json, dsl, tokenEstimate };
}

module.exports = {
  captureUiSchema,
  extractSemanticUiSchema,
  serializeToYaml,
  serializeToJson,
  serializeToDsl,
  estimateTokenCount,
};
