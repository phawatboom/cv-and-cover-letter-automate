const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const extensionRoot = path.resolve(__dirname, '..');

function normalized(value) {
  return String(value == null ? '' : value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function field(description, attributes = {}) {
  return {
    description,
    tagName: attributes.tagName || 'INPUT',
    type: attributes.type || attributes.type === '' ? attributes.type : 'text',
    maxLength: attributes.maxLength ?? -1,
    options: attributes.options,
    getAttribute(name) {
      if (name === 'type') return this.type;
      return attributes[name] || '';
    }
  };
}

function loadAutofill() {
  const containers = [];
  const CLC = {
    COVER_RE: /cover\s*letter/i,
    isVisible: () => true,
    queryAllDeep: (selector) => selector === 'oc-experience-edit-form' ? containers : [],
    composedClosest: (el, selector) => {
      if (selector.includes('experience') && el.workContainer) return el.workContainer;
      return null;
    },
    describeField: (el) => el.description || '',
    writeInto: () => true,
    commitAutocomplete: async () => true,
    normalizeChoice: normalized,
    choiceVariants: (value) => new Set([normalized(value)]),
    flash: () => {}
  };
  const sandbox = {
    window: { CLC },
    document: { activeElement: null },
    CSS: { escape: String },
    setTimeout,
    console
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(extensionRoot, 'content', 'autofill.js'), 'utf8'),
    sandbox,
    { filename: 'autofill.js' }
  );
  return { api: CLC.autofill, containers };
}

function loadDomChoices() {
  const sandbox = { window: {}, console, setTimeout };
  vm.runInNewContext(
    fs.readFileSync(path.join(extensionRoot, 'content', 'dom.js'), 'utf8'),
    sandbox,
    { filename: 'dom.js' }
  );
  return sandbox.window.CLC;
}

const { api, containers } = loadAutofill();
const choices = loadDomChoices();

assert.equal(choices.normalizeChoice('  New Zéaland  '), 'new zealand');
assert.equal(choices.choiceVariants('NZ').has('new zealand'), true);
assert.equal(choices.choiceVariants('No, I do not require sponsorship').has('no'), true);
assert.equal(choices.choiceVariants('Not authorised').has('no'), false);

assert.equal(api.autocompleteField(field('', { autocomplete: 'section-applicant home given-name' })), 'given-name');
assert.equal(api.classify(field('', { autocomplete: 'section-applicant home given-name' })).key, 'firstName');
assert.equal(api.classify(field('Referee email', { type: 'email' })), null);
assert.equal(api.classify(field('Emergency contact phone', { type: 'tel' })), null);
assert.equal(api.classify(field('Gender identity')), null);
assert.equal(api.isProtectedField(field('Voluntary disability disclosure')), true);
assert.equal(api.classify(field('Do you require visa sponsorship?')).key, 'sponsorship');
assert.equal(api.classify(field('Salary currency')).key, 'salaryCurrency');
assert.equal(api.classify(field('Expected salary amount')).key, 'salary');
assert.equal(api.classify(field('Country code', { autocomplete: 'country' })).key, 'countryCode');
assert.equal(api.classify(field('', { autocomplete: 'tel-country-code' })).key, 'phoneCountryCode');
assert.equal(api.classify(field('', { autocomplete: 'tel-area-code' })).key, 'phoneAreaCode');
assert.equal(api.classify(field('', { autocomplete: 'street-address' })).key, 'streetAddress');
assert.equal(api.classify(field('Phone number')).key, 'phone');
assert.equal(api.classify(field('Phone number', {
  tagName: 'SELECT',
  options: [{ value: '' }, { value: '+61' }, { value: '+64' }]
})).key, 'phoneCountryCode');

const firstWork = { querySelector: () => null };
const secondWork = { querySelector: () => null };
containers.push(firstWork, secondWork);
const secondTitle = field('Title');
secondTitle.workContainer = secondWork;
assert.equal(api.classify(secondTitle).key, 'work.1.title');
const currentWork = field('I currently work here', { type: 'checkbox' });
currentWork.workContainer = firstWork;
assert.equal(api.classify(currentWork).key, 'work.0.current');
const unrelatedWorkCheckbox = field('May we contact this employer?', { type: 'checkbox' });
unrelatedWorkCheckbox.workContainer = firstWork;
assert.equal(api.classify(unrelatedWorkCheckbox), null);

// A screening question sharing a work-history section can contain the same
// bare words ("to", "employer") as a real from/to date or company-name label.
// It must stay unmatched rather than being claimed by either rule.
const contactQuestion = field('Is it OK to contact this employer?', { type: 'radio' });
contactQuestion.workContainer = firstWork;
assert.equal(api.classify(contactQuestion), null);

const reasonQuestion = field('What would you like us to know about this role?');
reasonQuestion.workContainer = firstWork;
assert.equal(api.classify(reasonQuestion), null);

// Genuine short field labels for the same words must still resolve.
const toField = field('To');
toField.workContainer = firstWork;
assert.equal(api.classify(toField).key, 'work.0.end');

const fromField = field('From (MM/YYYY)');
fromField.workContainer = secondWork;
assert.equal(api.classify(fromField).key, 'work.1.start');

const companyField = field('Employer');
companyField.workContainer = firstWork;
assert.equal(api.classify(companyField).key, 'work.0.company');

assert.equal(api.formatValue(field('Middle initial', { maxLength: 1 }), 'middleName', 'Quinn', {}), 'Q');
assert.equal(api.formatValue(field('Start', { type: 'date' }), 'availabilityDate', 'Feb 2027', {}), '2027-02-01');
assert.equal(api.formatValue(field('Start', { type: 'month' }), 'work.0.start', '2026-8', {}), '2026-08');
assert.equal(api.formatValue(field('Start', { placeholder: 'DD/MM/YYYY' }), 'work.0.start', 'Feb 2027', {}), '01/02/2027');
assert.equal(
  api.formatValue(field('Phone', { autocomplete: 'tel-national' }), 'phone', '+64 21 555 0123', { phone: '+64 21 555 0123' }),
  '215550123'
);

console.log('autofill fixtures: ok');
