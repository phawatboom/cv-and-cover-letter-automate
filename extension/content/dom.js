/* Shared DOM helpers. Attached to window.CLC because MV3 declarative
   content scripts don't support ES modules — files load in manifest order. */
(function () {
  const CLC = (window.CLC = window.CLC || {});

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    let node = el;
    while (node && node.nodeType === 1) {
      const s = getComputedStyle(node);
      if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') return false;
      const root = node.getRootNode && node.getRootNode();
      node = node.parentElement || (root instanceof ShadowRoot ? root.host : null);
    }
    return true;
  }

  /* querySelector(All) stops at a shadow-root boundary. Modern ATSs such as
     SmartRecruiters build their whole form from web components, so the only
     real <input> may live several open shadow roots below document. Walk every
     reachable root once and query each independently. Closed shadow roots are
     intentionally inaccessible to extensions and cannot be traversed. */
  function queryAllDeep(selector, root = document) {
    const matches = [];
    const pending = [root];
    const seen = new Set();

    while (pending.length) {
      const scope = pending.shift();
      if (!scope || seen.has(scope) || !scope.querySelectorAll) continue;
      seen.add(scope);

      try {
        matches.push(...scope.querySelectorAll(selector));
      } catch (e) {
        return [];
      }

      for (const node of scope.querySelectorAll('*')) {
        if (node.shadowRoot) pending.push(node.shadowRoot);
      }
    }
    return matches;
  }

  /* A stored selector may cross one or more shadow roots. " >>> " is our own
     boundary marker (not a CSS combinator), keeping ordinary selectors saved
     by older versions valid. */
  function queryDeep(selector, root = document) {
    if (!selector || typeof selector !== 'string') return null;
    let scope = root;
    const parts = selector.split(/\s+>>>\s+/);
    for (let i = 0; i < parts.length; i++) {
      let found;
      try {
        found = scope.querySelector(parts[i]);
      } catch (e) {
        return null;
      }
      if (!found) return null;
      if (i === parts.length - 1) return found;
      if (!found.shadowRoot) return null;
      scope = found.shadowRoot;
    }
    return null;
  }

  function composedClosest(el, selector) {
    let node = el;
    while (node && node.nodeType === 1) {
      if (node.matches && node.matches(selector)) return node;
      const root = node.getRootNode && node.getRootNode();
      node = node.parentElement || (root instanceof ShadowRoot ? root.host : null);
    }
    return null;
  }

  /* SEEK, Indeed and Workday are all React/controlled-input apps. Assigning
     el.value updates the DOM but not React's internal state, so the value is
     wiped on the next render — and the app still thinks the field is empty on
     submit. Going through the prototype setter makes React's onChange fire. */
  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setNativeChecked(el, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set;
    setter.call(el, !!value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* Rich-text / contenteditable fields (some Workday tenants, some ATS embeds)
     ignore value setters. execCommand still produces real beforeinput/input
     events, which is what those editors listen for. */
  function setContentEditable(el, value) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    if (!document.execCommand('insertText', false, value)) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
  }

  function normalizeChoice(value) {
    return String(value == null ? '' : value)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  const CHOICE_ALIASES = {
    yes: ['yes', 'y', 'true', 'confirmed', 'i do', 'i have', 'eligible', 'authorised', 'authorized'],
    no: ['no', 'n', 'false', 'not required', 'i do not', "i don't", 'not eligible'],
    'new zealand': ['new zealand', 'nz', 'nzl'],
    australia: ['australia', 'au', 'aus'],
    'united kingdom': ['united kingdom', 'uk', 'gb', 'gbr', 'great britain'],
    'united states': ['united states', 'united states of america', 'us', 'usa']
  };

  function choiceVariants(value) {
    const normalized = normalizeChoice(value);
    const variants = new Set([normalized]);
    if (/^(yes|y|true|confirmed|i do|i have)\b/.test(normalized)) variants.add('yes');
    if (/^(no|n|false|i do not|i don t|not required)\b/.test(normalized)) variants.add('no');
    for (const [canonical, aliases] of Object.entries(CHOICE_ALIASES)) {
      const group = [canonical, ...aliases].map(normalizeChoice);
      if (group.includes(normalized)) group.forEach((v) => variants.add(v));
    }
    return variants;
  }

  /* A <select> can't take an arbitrary string. Only exact normalized values
     and small, explicit alias groups are accepted; prefix matching can turn
     "No" into "Not authorised" or choose the wrong country. */
  function selectOption(el, value) {
    const wants = choiceVariants(value);
    if (!wants.size || wants.has('')) return false;
    const opts = Array.from(el.options).filter((o) => o.value !== '');
    const match = opts.find((o) => wants.has(normalizeChoice(o.textContent)) || wants.has(normalizeChoice(o.value)));

    if (!match) return false;
    setNativeValue(el, match.value);
    return true;
  }

  function writeInto(el, value) {
    if (!el) return false;
    if (el.isContentEditable) setContentEditable(el, value);
    else if (el instanceof HTMLSelectElement) return selectOption(el, value);
    else if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) setNativeChecked(el, value);
    else setNativeValue(el, value);
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  /* Autocomplete widgets may display assigned text but keep their underlying
     model empty until an option is selected. After typing, choose only an
     exact visible suggestion; a fuzzy company, school or location guess is
     worse than leaving the user to confirm it. */
  async function commitAutocomplete(el, value, { timeout = 1200 } = {}) {
    const popup = (el.getAttribute('aria-haspopup') || '').toLowerCase();
    const host = composedClosest(el, 'spl-autocomplete, [role="combobox"], [data-test*="autocomplete"]');
    if (popup !== 'listbox' && !host) return false;
    const wanted = choiceVariants(value);
    if (!wanted.size || wanted.has('')) return false;

    const started = Date.now();
    while (Date.now() - started < timeout) {
      const options = queryAllDeep('[role="option"]').filter(isVisible);
      const exact = options.find((option) => wanted.has(normalizeChoice(option.innerText || option.textContent)));
      if (exact) {
        exact.click();
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }

  /* Briefly outline a field we just wrote to. The whole trust story for a tool
     that types into forms is that you can see exactly what it touched. */
  function flash(el, ok = true) {
    const prev = el.style.outline;
    el.style.outline = `2px solid ${ok ? '#5FBF8F' : '#E0685A'}`;
    el.style.outlineOffset = '1px';
    setTimeout(() => {
      el.style.outline = prev;
    }, 2500);
  }

  /* A CSS path stable enough to re-find a field on the next visit.
     Prefers the attributes each site actually keeps stable:
     Workday's data-automation-id, SEEK's data-automation, Indeed's data-testid. */
  const STABLE_ATTRS = ['data-automation-id', 'data-automation', 'data-testid', 'name', 'id'];

  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let seg = node.tagName.toLowerCase();
      let done = false;
      for (const attr of STABLE_ATTRS) {
        const v = node.getAttribute && node.getAttribute(attr);
        const scope = node.getRootNode && node.getRootNode();
        if (v && !/^\d+$/.test(v) && scope.querySelectorAll(`[${attr}="${CSS.escape(v)}"]`).length === 1) {
          parts.unshift(`[${attr}="${CSS.escape(v)}"]`);
          done = true;
          break;
        }
      }
      if (done) break;
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sibs.length > 1) seg += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(seg);
      node = node.parentElement;
    }
    const local = parts.join(' > ');
    const root = el && el.getRootNode && el.getRootNode();
    return root instanceof ShadowRoot && root.host ? `${cssPath(root.host)} >>> ${local}` : local;
  }

  function queryFirst(selectors, root = document) {
    for (const sel of selectors) {
      const el = queryAllDeep(sel, root).find(isVisible);
      if (el) return el;
    }
    return null;
  }

  function textOf(selectors, root = document) {
    const el = queryFirst(selectors, root);
    return el ? el.innerText.trim().replace(/\n{3,}/g, '\n\n') : '';
  }

  /* Everything a form knows about a field, flattened into one string to match
     against. The visible label matters most, but plenty of ATSs ship inputs
     with no label at all — hence the attribute soup. */
  function describeField(el) {
    const bits = [];
    if (el.labels) for (const l of el.labels) bits.push(l.innerText);
    const id = el.getAttribute('id');
    if (id) {
      try {
        const root = el.getRootNode ? el.getRootNode() : document;
        for (const l of root.querySelectorAll(`label[for="${CSS.escape(id)}"]`)) bits.push(l.innerText);
      } catch (e) {}
    }
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      for (const ref of labelledBy.split(/\s+/)) {
        const root = el.getRootNode ? el.getRootNode() : document;
        const n = root.getElementById ? root.getElementById(ref) : document.getElementById(ref);
        if (n) bits.push(n.innerText);
      }
    }
    // A generic role="group" is often an entire application section. Including
    // its text can make one consent question suppress unrelated fields nearby.
    const fieldset = composedClosest(el, 'fieldset, [role="radiogroup"]');
    if (fieldset) {
      const legend = fieldset.querySelector && fieldset.querySelector(':scope > legend');
      if (legend) bits.push(legend.innerText);
      const groupLabel = fieldset.getAttribute && fieldset.getAttribute('aria-label');
      if (groupLabel) bits.push(groupLabel);
    }
    /* Web components often put their human label on the custom-element host
       while the native control inside its shadow root has only a generated
       id. Follow nested hosts outward and include that metadata too. */
    let composedRoot = el.getRootNode && el.getRootNode();
    while (composedRoot instanceof ShadowRoot && composedRoot.host) {
      const host = composedRoot.host;
      for (const attr of ['label', 'aria-label', 'placeholder', 'name', 'id', 'data-automation-id', 'data-testid', 'data-test']) {
        const v = host.getAttribute(attr);
        if (v) bits.push(v);
      }
      composedRoot = host.getRootNode && host.getRootNode();
    }
    /* Last resort: the nearest wrapper that reads like a form row. Workday and
       Greenhouse both label this way rather than with <label for>. */
    if (!bits.join('').trim()) {
      const row = el.closest('[class*="field"], [class*="Field"], [data-automation-id], .form-group, li, div');
      if (row && row.innerText && row.innerText.length < 200) bits.push(row.innerText);
    }
    for (const attr of ['aria-label', 'placeholder', 'name', 'id', 'autocomplete', 'data-automation-id', 'data-testid']) {
      const v = el.getAttribute(attr);
      if (v) bits.push(v);
    }
    return bits.join(' ').replace(/\s+/g, ' ').trim();
  }

  /* Fallback field finder: any visible textarea whose label, placeholder or
     aria-label mentions a cover letter. Used before asking the user to point. */
  function findLabelledField(pattern) {
    const fields = queryAllDeep('textarea, [contenteditable="true"]').filter(isVisible);
    for (const f of fields) {
      if (pattern.test(describeField(f))) return f;
    }
    return fields.length === 1 ? fields[0] : null;
  }

  function waitFor(fn, { timeout = 8000, interval = 250 } = {}) {
    return new Promise((resolve) => {
      const started = Date.now();
      (function tick() {
        const v = fn();
        if (v) return resolve(v);
        if (Date.now() - started > timeout) return resolve(null);
        setTimeout(tick, interval);
      })();
    });
  }

  Object.assign(CLC, {
    isVisible,
    queryAllDeep,
    queryDeep,
    composedClosest,
    setNativeValue,
    setNativeChecked,
    selectOption,
    normalizeChoice,
    choiceVariants,
    writeInto,
    commitAutocomplete,
    flash,
    cssPath,
    queryFirst,
    textOf,
    describeField,
    findLabelledField,
    waitFor
  });
})();
