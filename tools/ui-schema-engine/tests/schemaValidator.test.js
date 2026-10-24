'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../src/schemaValidator');
const schema = require('../schemas/ui-schema.v1.schema.json');

const VALID_DOC = {
  schemaVersion: '1.0',
  view: { id: 'test-view', name: 'TestView', type: 'sheet' },
  fields: [
    { id: 'name', label: 'Name', component: 'input', required: true },
  ],
};

describe('schemaValidator — validate()', () => {
  it('returns zero errors for a valid document', () => {
    const errors = validate(VALID_DOC, schema);
    assert.strictEqual(errors.length, 0, `Expected 0 errors, got: ${JSON.stringify(errors)}`);
  });

  it('returns error when schemaVersion is missing', () => {
    const doc = { view: VALID_DOC.view, fields: VALID_DOC.fields };
    const errors = validate(doc, schema);
    assert.ok(errors.length > 0, 'Should have at least one error');
    assert.ok(errors.some(e => e.includes('schemaVersion')), 'Error should mention schemaVersion');
  });

  it('returns error when view is missing', () => {
    const doc = { schemaVersion: '1.0', fields: [] };
    const errors = validate(doc, schema);
    assert.ok(errors.length > 0, 'Should have at least one error');
    assert.ok(errors.some(e => e.includes('view')), 'Error should mention view');
  });

  it('returns error when fields is missing', () => {
    const doc = { schemaVersion: '1.0', view: VALID_DOC.view };
    const errors = validate(doc, schema);
    assert.ok(errors.length > 0, 'Should have at least one error');
    assert.ok(errors.some(e => e.includes('fields')), 'Error should mention fields');
  });

  it('returns error when schemaVersion is not "1.0"', () => {
    const doc = { ...VALID_DOC, schemaVersion: '2.0' };
    const errors = validate(doc, schema);
    assert.ok(errors.length > 0, 'Should have at least one error');
    assert.ok(errors.some(e => e.includes('enum')), 'Error should mention enum');
  });

  it('returns error for invalid view type', () => {
    const doc = {
      ...VALID_DOC,
      view: { ...VALID_DOC.view, type: 'popup' }, // not in enum
    };
    const errors = validate(doc, schema);
    assert.ok(errors.length > 0, 'Should have at least one error');
  });

  it('returns error when field is missing required "component" property', () => {
    const doc = {
      ...VALID_DOC,
      fields: [{ id: 'name', label: 'Name' }], // missing component
    };
    const errors = validate(doc, schema);
    assert.ok(errors.length > 0, 'Should have at least one error');
    assert.ok(errors.some(e => e.includes('component')), 'Error should mention component');
  });

  it('accepts a document with optional governance section', () => {
    const doc = {
      ...VALID_DOC,
      governance: { sapFieldStatusGroup: 'G004', auditedAt: '2026-09-18T00:00:00Z' },
    };
    const errors = validate(doc, schema);
    assert.strictEqual(errors.length, 0, `Expected 0 errors with governance section`);
  });
});
