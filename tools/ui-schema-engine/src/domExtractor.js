'use strict';

/**
 * domExtractor.js — portable DOM/ARIA semantic extractor.
 *
 * Ported from apps/web/src/utils/ui-schema/extractor.ts.
 * All document/DOM globals arrive via the `document` injected into
 * extractSemanticUiSchema() so this module is safely require()-able in
 * Node.js. Playwright supplies the live document via page.evaluate();
 * jsdom supplies it in tests.
 *
 * No React, Vite, or application-specific imports.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function cleanText(text) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
}

function isIgnored(el) {
  if (!el) return false;
  return !!el.closest('[data-ui-schema-ignore="true"]');
}

function resolveRootElement(rootElement, doc) {
  let target = rootElement;

  if (!target) {
    if (!doc) return null;

    const dialogs = Array.from(doc.querySelectorAll('[role="dialog"], [role="alertdialog"]'));
    for (let i = dialogs.length - 1; i >= 0; i--) {
      const d = dialogs[i];
      if (isIgnored(d)) continue;
      const isHidden = d.getAttribute('aria-hidden') === 'true' || d.getAttribute('data-state') === 'closed';
      if (!isHidden) return d;
    }

    target = doc.querySelector('main') || doc.querySelector('#root') || doc.body;
  }

  if (!target) return null;

  const containedDialog = target.matches('[role="dialog"], [role="alertdialog"]')
    ? target
    : target.querySelector('[role="dialog"]:not([aria-hidden="true"]), [role="alertdialog"]:not([aria-hidden="true"])');
  if (containedDialog && !isIgnored(containedDialog)) return containedDialog;

  if (target.matches('form')) return target;
  if (target.tagName.toLowerCase() !== 'main' && target.id !== 'root') {
    const containedForm = target.querySelector('form');
    if (containedForm && !isIgnored(containedForm)) return containedForm;
  }

  return target;
}

function extractViewMeta(container, doc) {
  let viewType = 'unknown';

  const role = container.getAttribute('role');
  const classList = container.getAttribute('class') || '';
  const side = container.getAttribute('data-side') || (classList.includes('side-') ? 'sheet' : '');

  if (role === 'dialog' || role === 'alertdialog') {
    viewType = side || classList.includes('w-[') || classList.includes('sheet') ? 'sheet' : 'dialog';
  } else if (container.tagName.toLowerCase() === 'form') {
    viewType = 'form';
  } else if (container.tagName.toLowerCase() === 'main' || container.id === 'root') {
    viewType = 'page';
  } else if (classList.includes('card') || container.getAttribute('data-slot') === 'card') {
    viewType = 'card';
  }

  let title;
  const ariaLabel = container.getAttribute('aria-label');
  if (ariaLabel) {
    title = cleanText(ariaLabel);
  } else {
    const labelledBy = container.getAttribute('aria-labelledby');
    if (labelledBy && doc) {
      const text = labelledBy
        .split(/\s+/)
        .map(id => doc.getElementById(id) && doc.getElementById(id).textContent)
        .filter(Boolean)
        .join(' ');
      if (text) title = cleanText(text);
    }
  }

  if (!title) {
    const titleEl = container.querySelector(
      '[id$="-title"], [id$="_title"], [data-slot="dialog-title"], [data-slot="card-title"], h1, h2, h3, [role="heading"]'
    );
    if (titleEl && !isIgnored(titleEl)) title = cleanText(titleEl.textContent);
  }

  let description;
  const describedBy = container.getAttribute('aria-describedby');
  if (describedBy && doc) {
    const text = describedBy
      .split(/\s+/)
      .map(id => doc.getElementById(id) && doc.getElementById(id).textContent)
      .filter(Boolean)
      .join(' ');
    if (text) description = cleanText(text);
  }

  if (!description) {
    const descEl = container.querySelector(
      '[id$="-description"], [id$="_description"], [data-slot="dialog-description"], [data-slot="card-description"], p.text-muted-foreground'
    );
    if (descEl && !isIgnored(descEl)) description = cleanText(descEl.textContent);
  }

  return { viewType, title, description };
}

function safeQueryLabelFor(container, id, doc) {
  if (!id) return null;
  try {
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/(["\\])/g, '\\$1');
    return container.querySelector(`label[for="${escaped}"]`) || (doc && doc.querySelector(`label[for="${escaped}"]`));
  } catch {
    return null;
  }
}

function resolveLabel(el, container, doc) {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return cleanText(ariaLabel);

  const ariaLabelledBy = el.getAttribute('aria-labelledby');
  if (ariaLabelledBy && doc) {
    const text = ariaLabelledBy
      .split(/\s+/)
      .map(id => doc.getElementById(id) && doc.getElementById(id).textContent)
      .filter(Boolean)
      .join(' ');
    if (text) return cleanText(text);
  }

  const id = el.getAttribute('id');
  if (id) {
    const labelFor = safeQueryLabelFor(container, id, doc);
    if (labelFor && labelFor.textContent) return cleanText(labelFor.textContent);
  }

  const parentLabel = el.closest('label');
  if (parentLabel && parentLabel.textContent) {
    const clone = parentLabel.cloneNode(true);
    clone.querySelectorAll('input, select, textarea, button').forEach(c => c.remove());
    if (clone.textContent) return cleanText(clone.textContent);
  }

  let sibling = el.previousElementSibling;
  while (sibling) {
    if (sibling.tagName.toLowerCase() === 'label' || sibling.getAttribute('data-slot') === 'label') {
      const text = cleanText(sibling.textContent);
      if (text) return text;
    }
    const innerLabel = sibling.querySelector('label, [data-slot="label"]');
    if (innerLabel) {
      const text = cleanText(innerLabel.textContent);
      if (text) return text;
    }
    sibling = sibling.previousElementSibling;
  }

  if (el.parentElement) {
    const directLabel = el.parentElement.querySelector(':scope > label, :scope > [data-slot="label"]');
    if (directLabel && !directLabel.contains(el) && directLabel.textContent) {
      return cleanText(directLabel.textContent);
    }
  }

  const formItem = el.closest('[data-slot="form-item"], .form-item, .form-group, .space-y-2, .space-y-1');
  if (formItem && formItem !== container) {
    const inputsInItem = formItem.querySelectorAll('input, select, textarea, [role="combobox"], [role="switch"], [role="checkbox"]');
    if (inputsInItem.length <= 1) {
      const siblingLabel = formItem.querySelector('label, [data-slot="label"], .font-medium');
      if (siblingLabel && !siblingLabel.contains(el) && siblingLabel.textContent) {
        return cleanText(siblingLabel.textContent);
      }
    }
  }

  const placeholder = el.getAttribute('placeholder');
  if (placeholder) return cleanText(placeholder);

  const name = el.getAttribute('name');
  if (name) return name;

  return 'unlabeled';
}

const RADIX_AUTO_ID_RE = /^radix-:r[\w-]+:$/i;

function deriveFieldName(rawName, label) {
  if (rawName && !RADIX_AUTO_ID_RE.test(rawName)) return rawName;
  if (!label || label === 'unlabeled') return undefined;
  return label
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/[*:]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || undefined;
}

function resolveErrorMessage(el, _container, doc) {
  const isAriaInvalid = el.getAttribute('aria-invalid') === 'true';

  const describedBy = el.getAttribute('aria-describedby');
  if (describedBy && doc) {
    const text = describedBy
      .split(/\s+/)
      .map(id => doc.getElementById(id) && doc.getElementById(id).textContent)
      .filter(Boolean)
      .join(' ');
    if (text) return cleanText(text);
  }

  const parentGroup = el.closest('.space-y-2, .space-y-1, .form-group, [data-slot="form-item"]');
  if (parentGroup) {
    const errEl = parentGroup.querySelector('.text-destructive, [role="alert"]');
    if (errEl && errEl.textContent) return cleanText(errEl.textContent);
  }

  if (isAriaInvalid) return 'Invalid value';
  return undefined;
}

function resolveButtonVariant(el) {
  const className = (el.getAttribute('class') || '').toLowerCase();
  if (className.includes('bg-destructive') || className.includes('text-destructive')) return 'destructive';
  if (className.includes('bg-primary')) return 'primary';
  if (className.includes('border-input')) return 'outline';
  if (className.includes('bg-secondary')) return 'secondary';
  if (className.includes('hover:underline') || className.includes('underline-offset')) return 'link';
  if (className.includes('hover:bg-accent') && !className.includes('border-input')) return 'ghost';
  return 'primary';
}

function extractFields(container, options, doc) {
  const fields = [];
  const processedElements = new Set();

  const formControls = container.querySelectorAll(
    'input, textarea, select, [role="switch"], [role="checkbox"], [role="combobox"], [role="radio"], [role="slider"]'
  );

  formControls.forEach(el => {
    if (processedElements.has(el)) return;
    if (isIgnored(el)) return;

    let tabName;
    const tabpanel = el.closest('[role="tabpanel"]');
    if (tabpanel) {
      const isInactive = tabpanel.getAttribute('data-state') === 'inactive' || tabpanel.hasAttribute('hidden');
      if (isInactive && !(options && options.includeHidden)) return;

      const labelledBy = tabpanel.getAttribute('aria-labelledby');
      if (labelledBy && doc) {
        const text = labelledBy
          .split(/\s+/)
          .map(id => doc.getElementById(id) && doc.getElementById(id).textContent)
          .filter(Boolean)
          .join(' ');
        tabName = cleanText(text) || undefined;
      }
      if (!tabName) {
        tabName = tabpanel.getAttribute('data-value') || tabpanel.getAttribute('id') || undefined;
      }
    }

    const tagName = el.tagName.toLowerCase();
    const typeAttr = (el.getAttribute('type') || '').toLowerCase();
    const roleAttr = el.getAttribute('role') || '';

    if (tagName === 'input' && (typeAttr === 'hidden' || el.getAttribute('aria-hidden') === 'true') && !(options && options.includeHidden)) {
      return;
    }

    const isFormRole = roleAttr === 'switch' || roleAttr === 'checkbox' || roleAttr === 'combobox' || roleAttr === 'radio' || roleAttr === 'slider';
    if (tagName === 'input' && (typeAttr === 'submit' || typeAttr === 'button' || typeAttr === 'reset')) return;
    if (tagName === 'button' && !isFormRole && el.getAttribute('data-slot') !== 'select-trigger' && !el.classList.contains('select-trigger')) return;

    if (el.closest('[role="listbox"]') || el.closest('[data-radix-select-viewport]')) return;

    const rawName = el.getAttribute('name') || el.getAttribute('id') || undefined;
    const label = resolveLabel(el, container, doc);
    const name = deriveFieldName(rawName, label);
    let placeholder = el.getAttribute('placeholder') || undefined;
    const required = el.hasAttribute('required') || el.getAttribute('aria-required') === 'true' || label.includes('*');
    const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
    const readOnly = el.hasAttribute('readonly');
    const error = resolveErrorMessage(el, container, doc);

    // Radio groups
    if (typeAttr === 'radio' || roleAttr === 'radio') {
      const groupName = el.getAttribute('name') || (el.closest('[role="radiogroup"]') && el.closest('[role="radiogroup"]').getAttribute('name')) || name || 'radio_group';
      const isChecked = el.checked || el.getAttribute('aria-checked') === 'true' || el.getAttribute('data-state') === 'checked';
      const optVal = el.value || el.getAttribute('value') || label;
      const optionLabel = optVal !== label && optVal ? `${optVal}: ${label}` : label;

      const existingRadio = fields.find(f => f.name === groupName && f.type === 'radio');
      if (existingRadio) {
        if (existingRadio.options && !existingRadio.options.includes(optionLabel)) {
          existingRadio.options.push(optionLabel);
        }
        if (isChecked) existingRadio.value = optVal;
        processedElements.add(el);
        return;
      }

      const fieldset = el.closest('fieldset, [role="radiogroup"]');
      let groupLabel = '';
      if (fieldset) {
        const legend = fieldset.querySelector('legend, [data-slot="label"]');
        if (legend && legend.textContent) groupLabel = cleanText(legend.textContent);
        const aria = fieldset.getAttribute('aria-label');
        if (aria) groupLabel = cleanText(aria);
      }
      if (!groupLabel && (fieldset || el.parentElement) && (fieldset || el.parentElement).previousElementSibling) {
        const prev = (fieldset || el.parentElement).previousElementSibling;
        if (prev && prev.matches('label, p, .font-medium, .text-sm')) {
          groupLabel = cleanText(prev.textContent);
        }
      }
      if (!groupLabel) groupLabel = label;

      fields.push({
        name: groupName,
        label: groupLabel,
        type: 'radio',
        value: isChecked ? optVal : undefined,
        options: [optionLabel],
        required: required ? true : undefined,
        disabled: disabled ? true : undefined,
        tab: tabName,
        error,
      });

      processedElements.add(el);
      return;
    }

    let fieldType = tagName;
    let value;
    let optionsList;

    if (tagName === 'input') {
      if (typeAttr === 'checkbox') {
        fieldType = 'checkbox';
        value = el.checked;
      } else {
        fieldType = typeAttr || 'text';
        const rawVal = el.value;
        value = (options && options.maskSecrets && typeAttr === 'password') ? '••••••' : rawVal;
      }
    } else if (tagName === 'textarea') {
      fieldType = 'textarea';
      value = el.value;
    } else if (tagName === 'select') {
      fieldType = 'select';
      value = el.value;
      optionsList = Array.from(el.options).map(o => cleanText(o.text)).filter(Boolean);
    } else if (roleAttr === 'switch') {
      fieldType = 'switch';
      value = el.getAttribute('aria-checked') === 'true' || el.getAttribute('data-state') === 'checked';
    } else if (roleAttr === 'checkbox') {
      fieldType = 'checkbox';
      value = el.getAttribute('aria-checked') === 'true' || el.getAttribute('data-state') === 'checked';
    } else if (roleAttr === 'slider') {
      fieldType = 'slider';
      value = el.getAttribute('aria-valuenow') || undefined;
    } else if (roleAttr === 'combobox' || el.getAttribute('data-slot') === 'select-trigger' || el.classList.contains('select-trigger')) {
      fieldType = 'select';
      const textVal = cleanText(el.textContent);
      const isPlaceholder = el.querySelector('[data-placeholder]') !== null || textVal.toLowerCase().includes('select');
      if (isPlaceholder) {
        value = '';
        if (!placeholder && textVal) placeholder = textVal;
      } else {
        value = textVal;
      }
    }

    const existingField = fields.find(f => (f.name === name || f.label === label) && f.type === 'select');
    if (existingField && fieldType === 'select') {
      if (optionsList && optionsList.length > 0) existingField.options = optionsList;
      if (value && !existingField.value) existingField.value = value;
      if (placeholder && !existingField.placeholder) existingField.placeholder = placeholder;
      processedElements.add(el);
      return;
    }

    fields.push({
      name,
      label,
      type: fieldType,
      value: value !== '' ? value : undefined,
      placeholder,
      required: required ? true : undefined,
      disabled: disabled ? true : undefined,
      readOnly: readOnly ? true : undefined,
      options: optionsList && optionsList.length > 0 ? optionsList : undefined,
      tab: tabName,
      error,
    });

    processedElements.add(el);
  });

  return fields;
}

function extractActions(container) {
  const actions = [];
  const buttons = container.querySelectorAll('button, [role="button"], input[type="submit"]');

  buttons.forEach(el => {
    if (isIgnored(el)) return;

    const role = el.getAttribute('role') || '';
    if (['combobox', 'switch', 'checkbox', 'radio', 'slider', 'spinbutton'].includes(role)) return;
    if (el.getAttribute('data-slot') === 'select-trigger' || el.classList.contains('select-trigger')) return;
    if (role === 'option' || role === 'menuitem') return;
    if (role === 'tab') return;
    if (el.getAttribute('data-slot') === 'dialog-close' || el.getAttribute('data-slot') === 'sheet-close') return;

    const rawText = cleanText(el.textContent);
    const ariaLabel = el.getAttribute('aria-label');
    const label = cleanText(ariaLabel || rawText);

    if (!label) return;

    if (
      (label.toLowerCase() === 'close' || label === '✕' || label === '×') &&
      (el.classList.contains('absolute') || el.querySelector('.sr-only') || el.closest('[data-radix-collection-item]'))
    ) {
      return;
    }

    const typeAttr = (el.getAttribute('type') || 'button').toLowerCase();
    const type = typeAttr === 'submit' ? 'submit' : typeAttr === 'reset' ? 'reset' : 'button';
    const variant = resolveButtonVariant(el);
    const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
    const loading = disabled && (label.endsWith('...') || label.endsWith('…') || label.toLowerCase().includes('loading'));

    actions.push({
      label,
      type: type !== 'button' ? type : undefined,
      variant: variant !== 'primary' ? variant : undefined,
      disabled: disabled ? true : undefined,
      loading: loading ? true : undefined,
    });
  });

  return actions;
}

function extractTabs(container, doc) {
  const tabList = container.querySelector('[role="tablist"]');
  if (!tabList || isIgnored(tabList)) return undefined;

  const tabs = [];
  let activeTab;

  tabList.querySelectorAll('[role="tab"]').forEach(tab => {
    const text = cleanText(tab.textContent);
    if (!text) return;
    tabs.push(text);

    const isSelected = tab.getAttribute('aria-selected') === 'true' || tab.getAttribute('data-state') === 'active';
    if (isSelected) activeTab = text;
  });

  if (tabs.length === 0) return undefined;
  return { activeTab, tabs };
}

function extractTables(container) {
  const tables = [];
  const tableElements = container.querySelectorAll('table, [role="table"], [role="grid"]');

  tableElements.forEach(table => {
    if (isIgnored(table)) return;

    const headers = [];
    table.querySelectorAll('th, [role="columnheader"]').forEach(th => {
      const text = cleanText(th.textContent);
      if (text) headers.push(text);
    });

    const rows = table.querySelectorAll('tbody tr, [role="row"]:not(:first-child)');
    tables.push({ columns: headers, rowCount: rows.length });
  });

  return tables;
}

/**
 * Main entry point: Extracts clean semantic UI state from any DOM container.
 *
 * @param {Element|null} [rootElement] - Root element to extract from (falls back to document.body)
 * @param {Object} [options] - ExtractionOptions
 * @param {Document} [documentOverride] - Explicit document reference (required in non-browser contexts)
 * @returns {import('./types').UiViewSchema}
 */
function extractSemanticUiSchema(rootElement, options, documentOverride) {
  const doc = documentOverride || (typeof document !== 'undefined' ? document : null);
  const container = resolveRootElement(rootElement || (options && options.rootElement), doc);
  if (!container) {
    return { viewType: 'unknown', fields: [], actions: [] };
  }

  const { viewType, title, description } = extractViewMeta(container, doc);
  const activeTabs = extractTabs(container, doc);
  const fields = extractFields(container, options, doc);
  const actions = extractActions(container);
  const tables = extractTables(container);

  return {
    viewType,
    title,
    description,
    activeTabs,
    fields,
    actions,
    tables: tables.length > 0 ? tables : undefined,
  };
}

module.exports = { extractSemanticUiSchema };
