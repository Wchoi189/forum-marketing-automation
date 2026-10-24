'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseSql } = require('../src/governance/sqlParser');
const { validateContracts } = require('../src/governance/driftValidator');

describe('driftValidator', () => {
  const FIXTURE_DDL = `
    CREATE TABLE IF NOT EXISTS refund (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_ref TEXT NOT NULL,
      refund_type TEXT NOT NULL CHECK (refund_type IN ('FULL', 'PARTIAL', 'CREDIT', 'WRITE_OFF')),
      customer_email TEXT NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const tables = parseSql(FIXTURE_DDL);

  const COMPLIANT_CONTRACT = {
    filePath: 'test/RefundCreate.ui-schema.yaml',
    doc: {
      schemaVersion: '1.0',
      view: { id: 'refund-create', name: 'RefundCreate', type: 'sheet', contextEntity: 'Refund' },
      fields: [
        { id: 'asset_ref', label: 'Asset Ref', component: 'input', required: true },
        {
          id: 'refund_type',
          label: 'Refund Type',
          component: 'select',
          required: true,
          options: [
            { value: 'FULL', label: 'Full' },
            { value: 'PARTIAL', label: 'Partial' },
            { value: 'CREDIT', label: 'Credit' },
            { value: 'WRITE_OFF', label: 'Write Off' },
          ],
        },
        { id: 'customer_email', label: 'Customer Email', component: 'input', required: true },
      ],
      actions: [],
    },
  };

  const MISSING_REQUIRED_CONTRACT = {
    filePath: 'test/RefundCreateBad.ui-schema.yaml',
    doc: {
      schemaVersion: '1.0',
      view: { id: 'refund-create-bad', name: 'RefundCreateBad', type: 'sheet', contextEntity: 'Refund' },
      fields: [
        // asset_ref exists but NOT marked required
        { id: 'asset_ref', label: 'Asset Ref', component: 'input' },
        {
          id: 'refund_type',
          label: 'Refund Type',
          component: 'select',
          required: true,
          options: [
            { value: 'FULL', label: 'Full' },
            { value: 'PARTIAL', label: 'Partial' },
            { value: 'CREDIT', label: 'Credit' },
            { value: 'WRITE_OFF', label: 'Write Off' },
          ],
        },
        { id: 'customer_email', label: 'Customer Email', component: 'input', required: true },
      ],
      actions: [],
    },
  };

  const MISSING_ENUM_CONTRACT = {
    filePath: 'test/RefundCreateMissingEnum.ui-schema.yaml',
    doc: {
      schemaVersion: '1.0',
      view: { id: 'refund-create-enum', name: 'RefundCreateEnum', type: 'sheet', contextEntity: 'Refund' },
      fields: [
        { id: 'asset_ref', label: 'Asset Ref', component: 'input', required: true },
        {
          id: 'refund_type',
          label: 'Refund Type',
          component: 'select',
          required: true,
          // Missing WRITE_OFF
          options: [
            { value: 'FULL', label: 'Full' },
            { value: 'PARTIAL', label: 'Partial' },
          ],
        },
        { id: 'customer_email', label: 'Customer Email', component: 'input', required: true },
      ],
      actions: [],
    },
  };

  it('returns zero violations for a fully compliant contract', () => {
    const violations = validateContracts(tables, [COMPLIANT_CONTRACT], null);
    assert.strictEqual(violations.length, 0, `Expected 0 violations, got: ${JSON.stringify(violations)}`);
  });

  it('reports required-not-null violation when field is missing required:true', () => {
    const violations = validateContracts(tables, [MISSING_REQUIRED_CONTRACT], null);
    const requiredViolations = violations.filter(v => v.rule === 'required-not-null');
    assert.ok(requiredViolations.length > 0, 'Should have at least one required-not-null violation');
    assert.ok(
      requiredViolations.some(v => v.field === 'asset_ref'),
      'Violation should reference asset_ref'
    );
  });

  it('reports enum-options-match violation when contract options are incomplete', () => {
    const violations = validateContracts(tables, [MISSING_ENUM_CONTRACT], null);
    const enumViolations = violations.filter(v => v.rule === 'enum-options-match');
    assert.ok(enumViolations.length > 0, 'Should have at least one enum-options-match violation');
    assert.ok(
      enumViolations.some(v => v.message.includes('CREDIT') || v.message.includes('WRITE_OFF')),
      'Violation message should mention missing enum values'
    );
  });

  it('skips contracts with no contextEntity', () => {
    const noEntity = {
      filePath: 'test/NoEntity.ui-schema.yaml',
      doc: {
        view: { id: 'no-entity', name: 'NoEntity', type: 'page' },
        fields: [],
        actions: [],
      },
    };
    const violations = validateContracts(tables, [noEntity], null);
    assert.strictEqual(violations.length, 0, 'No contextEntity should produce zero violations');
  });
});
