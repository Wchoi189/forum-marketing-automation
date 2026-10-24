'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseSql } = require('../src/governance/sqlParser');

describe('sqlParser', () => {
  const FIXTURE_DDL = `
    CREATE TABLE IF NOT EXISTS refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_ref TEXT NOT NULL,
      refund_type TEXT NOT NULL CHECK (refund_type IN ('FULL', 'PARTIAL', 'CREDIT', 'WRITE_OFF')),
      refund_reason TEXT NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'MANUAL',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vendors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      display_name TEXT,
      is_active BOOLEAN DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  it('parses table names correctly', () => {
    const tables = parseSql(FIXTURE_DDL);
    assert.ok(tables.has('refunds'), 'should have refunds table');
    assert.ok(tables.has('vendors'), 'should have vendors table');
    assert.strictEqual(tables.size, 2);
  });

  it('identifies NOT NULL columns without DEFAULT as governance-significant', () => {
    const tables = parseSql(FIXTURE_DDL);
    const refunds = tables.get('refunds');
    assert.ok(refunds, 'refunds table should exist');

    const assetRef = refunds.columns.find(c => c.name === 'asset_ref');
    assert.ok(assetRef, 'asset_ref column should be found');
    assert.strictEqual(assetRef.notNull, true, 'asset_ref should be notNull=true');

    const paymentMethod = refunds.columns.find(c => c.name === 'payment_method');
    assert.ok(paymentMethod, 'payment_method column should be found');
    assert.strictEqual(paymentMethod.notNull, false, 'payment_method has DEFAULT so notNull should be false');
    assert.strictEqual(paymentMethod.hasDefault, true, 'payment_method should have hasDefault=true');
  });

  it('extracts inline CHECK enum values', () => {
    const tables = parseSql(FIXTURE_DDL);
    const refunds = tables.get('refunds');
    const refundType = refunds.columns.find(c => c.name === 'refund_type');

    assert.ok(refundType, 'refund_type column should be found');
    assert.deepStrictEqual(refundType.enumValues, ['FULL', 'PARTIAL', 'CREDIT', 'WRITE_OFF']);
  });

  it('returns null enumValues for non-enum columns', () => {
    const tables = parseSql(FIXTURE_DDL);
    const refunds = tables.get('refunds');
    const notes = refunds.columns.find(c => c.name === 'notes');

    assert.ok(notes, 'notes column should be found');
    assert.strictEqual(notes.enumValues, null, 'notes should have null enumValues');
  });

  it('skips meta columns (created_at, updated_at) — they appear in columns list', () => {
    const tables = parseSql(FIXTURE_DDL);
    const refunds = tables.get('refunds');
    const createdAt = refunds.columns.find(c => c.name === 'created_at');
    // created_at has DEFAULT so notNull=false — governance rules skip it by design
    assert.ok(createdAt, 'created_at should be parsed');
    assert.strictEqual(createdAt.notNull, false, 'created_at has DEFAULT so notNull=false');
  });
});
