'use strict';

const { stringify } = require('yaml');
const { estimateTokenCount } = require('./tokenEstimator');

/**
 * Clean up a UiViewSchema before serialization — strips undefineds and empties.
 * @param {import('./types').UiViewSchema} schema
 * @returns {Record<string, unknown>}
 */
function cleanSchemaForSerialization(schema) {
  const result = {
    view: {
      type: schema.viewType,
      title: schema.title,
      description: schema.description,
    },
  };

  if (schema.activeTabs) {
    result.tabs = {
      active: schema.activeTabs.activeTab,
      items: schema.activeTabs.tabs,
    };
  }

  if (schema.fields && schema.fields.length > 0) {
    result.fields = schema.fields.map(f => {
      const fieldObj = { name: f.name, label: f.label, type: f.type };
      if (f.placeholder) fieldObj.placeholder = f.placeholder;
      if (f.value !== undefined) fieldObj.value = f.value;
      if (f.required)  fieldObj.required  = true;
      if (f.disabled)  fieldObj.disabled  = true;
      if (f.readOnly)  fieldObj.readOnly   = true;
      if (f.options && f.options.length > 0) fieldObj.options = f.options;
      if (f.error)     fieldObj.error      = f.error;
      if (f.tab)       fieldObj.tab        = f.tab;
      return fieldObj;
    });
  }

  if (schema.actions && schema.actions.length > 0) {
    result.actions = schema.actions.map(a => {
      const actionObj = { label: a.label };
      if (a.type)     actionObj.type     = a.type;
      if (a.variant)  actionObj.variant  = a.variant;
      if (a.disabled) actionObj.disabled = true;
      if (a.loading)  actionObj.loading  = true;
      return actionObj;
    });
  }

  if (schema.tables && schema.tables.length > 0) {
    result.tables = schema.tables.map(t => ({
      columns: t.columns,
      rowCount: t.rowCount,
    }));
  }

  return result;
}

/**
 * Serialize to clean YAML string.
 * @param {import('./types').UiViewSchema} schema
 * @returns {string}
 */
function serializeToYaml(schema) {
  const cleaned = cleanSchemaForSerialization(schema);
  return stringify(cleaned, {
    indent: 2,
    nullStr: '',
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
  }).trim();
}

/**
 * Serialize to formatted JSON string.
 * @param {import('./types').UiViewSchema} schema
 * @returns {string}
 */
function serializeToJson(schema) {
  return JSON.stringify(cleanSchemaForSerialization(schema), null, 2);
}

/**
 * Serialize to ultra-compact UI Pseudo-DSL string (minimal tokens).
 * @param {import('./types').UiViewSchema} schema
 * @returns {string}
 */
function serializeToDsl(schema) {
  const lines = [];
  lines.push(`[${schema.viewType.toUpperCase()}: "${schema.title || 'Untitled'}"]`);
  if (schema.description) lines.push(`  desc: "${schema.description}"`);
  if (schema.activeTabs) {
    lines.push(`  tabs: [${schema.activeTabs.tabs.join(', ')}] (active: "${schema.activeTabs.activeTab || ''}")`);
  }
  if (schema.fields.length > 0) {
    lines.push('  fields:');
    schema.fields.forEach(f => {
      const req = f.required ? '*' : '';
      const val = f.value !== undefined ? ` = "${f.value}"` : '';
      const ph  = f.placeholder ? ` (placeholder: "${f.placeholder}")` : '';
      lines.push(`    - ${f.name || 'field'}${req} [${f.type}] "${f.label}"${val}${ph}`);
    });
  }
  if (schema.actions.length > 0) {
    lines.push('  actions:');
    schema.actions.forEach(a => {
      const variant = a.variant ? ` (${a.variant})` : '';
      const type    = a.type    ? ` [${a.type}]`    : '';
      lines.push(`    - Button: "${a.label}"${type}${variant}`);
    });
  }
  if (schema.tables && schema.tables.length > 0) {
    lines.push('  tables:');
    schema.tables.forEach(t => {
      lines.push(`    - Table (${t.rowCount} rows): [${t.columns.join(', ')}]`);
    });
  }
  return lines.join('\n');
}

module.exports = { serializeToYaml, serializeToJson, serializeToDsl, estimateTokenCount };
