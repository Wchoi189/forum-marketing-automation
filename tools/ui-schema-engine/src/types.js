'use strict';

/**
 * @typedef {Object} UiField
 * @property {string} [name]
 * @property {string} label
 * @property {string} type
 * @property {unknown} [value]
 * @property {unknown} [defaultValue]
 * @property {string} [placeholder]
 * @property {boolean} [required]
 * @property {boolean} [disabled]
 * @property {boolean} [readOnly]
 * @property {string[]} [options]
 * @property {string} [error]
 * @property {string} [tab]
 */

/**
 * @typedef {Object} UiAction
 * @property {string} label
 * @property {'submit'|'button'|'reset'} [type]
 * @property {'primary'|'secondary'|'destructive'|'outline'|'ghost'|'link'} [variant]
 * @property {boolean} [disabled]
 * @property {boolean} [loading]
 */

/**
 * @typedef {Object} UiTable
 * @property {string[]} columns
 * @property {number} rowCount
 * @property {string[]} [actions]
 */

/**
 * @typedef {Object} UiTabGroup
 * @property {string} [activeTab]
 * @property {string[]} tabs
 */

/**
 * @typedef {Object} UiViewSchema
 * @property {'dialog'|'sheet'|'modal'|'card'|'page'|'form'|'unknown'} viewType
 * @property {string} [title]
 * @property {string} [description]
 * @property {UiTabGroup} [activeTabs]
 * @property {UiField[]} fields
 * @property {UiAction[]} actions
 * @property {UiTable[]} [tables]
 * @property {{ totalFields: number, totalActions: number, estimatedTokens: number }} [stats]
 */

/**
 * @typedef {Object} ExtractionOptions
 * @property {Element|null} [rootElement]
 * @property {'yaml'|'json'} [format]
 * @property {boolean} [includeHidden]
 * @property {boolean} [maskSecrets]
 */

module.exports = {};
