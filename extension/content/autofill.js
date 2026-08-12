/* Conservative, standards-aware autofill for job applications. The engine
   fills deterministic applicant facts, but deliberately leaves consent,
   demographic, legal-disclosure, identity-document and file questions alone. */
(function () {
  const CLC = window.CLC;
  const {
    isVisible,
    queryAllDeep,
    composedClosest,
    describeField,
    writeInto,
    commitAutocomplete,
    normalizeChoice,
    choiceVariants,
    flash
  } = CLC;

  const NOT_YOU = /refer(ee|ence)|emergency|next\s*of\s*kin|guardian|spouse|supervisor|manager['\u2019]?s|witness/i;
  const NOT_PERSON = /company|employer|organi[sz]|business|school|university|college|institution|course|degree|file\s*name|user\s*-?name|display\s*name/i;
  const PROTECTED = /(?:race|ethnic|gender|sex(?:ual)?|pronouns?|disabilit|veteran|religion|marital|pregnan|date\s*of\s*birth|birth\s*date|\bage\b|criminal|conviction|offen[cs]e|background\s*check|social\s*security|\bssn\b|national\s*(?:id|identifier)|passport|tax\s*(?:id|number)|bank|credit\s*card|password|signature|privacy|consent|terms\s*(?:and|&)\s*conditions|data\s*(?:processing|retention)|equal\s*opportun|eeoc|diversity|indigenous|aboriginal)/i;
  const COVER = () => CLC.COVER_RE;

  const RULES = [
    { key: 'honorificPrefix', auto: ['honorific-prefix'], re: /honorific|salutation|name\s*prefix|^title$/i, not: [/job|position|role/] },
    { key: 'firstName', auto: ['given-name'], re: /\b(first|given|fore)\s*_?-?\s*name\b|\bfirstname\b|^f[\s_-]?name$/i, not: [NOT_YOU, NOT_PERSON] },
    { key: 'lastName', auto: ['family-name'], re: /\b(last|family|sur)\s*_?-?\s*name\b|\blastname\b|\bsurname\b|^l[\s_-]?name$/i, not: [NOT_YOU, NOT_PERSON] },
    { key: 'middleName', auto: ['additional-name'], re: /\bmiddle\s*(name|initial)\b/i, not: [NOT_YOU, NOT_PERSON] },
    { key: 'preferredName', auto: ['nickname'], re: /preferred|chosen|known\s*as|nickname/i, not: [NOT_YOU, NOT_PERSON] },
    { key: 'honorificSuffix', auto: ['honorific-suffix'], re: /honorific\s*suffix|name\s*suffix/i, not: [] },
    { key: 'fullName', auto: ['name'], re: /\b(full|legal|your|candidate|applicant)\s*_?-?\s*name\b|^name$/i, not: [NOT_YOU, NOT_PERSON, /preferred/] },

    { key: 'email', auto: ['email'], type: 'email', re: /e-?mail/i, not: [NOT_YOU] },
    { key: 'phoneCountryCode', auto: ['tel-country-code'], re: /(?:phone|mobile|telephone|dial(?:ling)?)\s*(?:country|dial(?:ling)?)\s*code|country\s*code/i, not: [NOT_YOU, /country(?!\s*code)/i] },
    { key: 'phoneExtension', auto: ['tel-extension'], re: /(?:phone|telephone)\s*(?:extension|ext)\b|\bextension\b|\bext\.?\b/i, not: [NOT_YOU] },
    { key: 'phoneAreaCode', auto: ['tel-area-code'], re: /(?:phone|telephone)\s*area\s*code/i, not: [NOT_YOU] },
    { key: 'phoneLocalPrefix', auto: ['tel-local-prefix'], re: /(?:phone|telephone)\s*local\s*prefix/i, not: [NOT_YOU] },
    { key: 'phoneLocalSuffix', auto: ['tel-local-suffix'], re: /(?:phone|telephone)\s*local\s*suffix/i, not: [NOT_YOU] },
    { key: 'phone', auto: ['tel', 'tel-national', 'tel-local'], type: 'tel', re: /\bphone\b|\bmobile\b|telephone|contact\s*number|\bcell\b/i, not: [NOT_YOU, /extension|country\s*code|area\s*code|local\s*(?:prefix|suffix)/i] },

    { key: 'streetAddress', auto: ['street-address'], re: /^street\s*address$/i, not: [NOT_YOU] },
    { key: 'addressLine1', auto: ['address-line1'], re: /address\s*(line)?\s*1\b|street\s*address|^address$/i, not: [NOT_YOU, /e-?mail/i] },
    { key: 'addressLine2', auto: ['address-line2'], re: /address\s*(line)?\s*2\b|\bapt\b|apartment|\bunit\b|\bsuite\b/i, not: [NOT_YOU] },
    { key: 'addressLine3', auto: ['address-line3'], re: /address\s*(line)?\s*3\b/i, not: [NOT_YOU] },
    { key: 'district', auto: ['address-level3', 'address-level4'], re: /\bdistrict\b|\bcounty\b|\bmunicipality\b/i, not: [NOT_YOU] },
    { key: 'city', auto: ['address-level2'], re: /\bcity\b|\bsuburb\b|\btown\b|\blocality\b/i, not: [NOT_YOU] },
    { key: 'state', auto: ['address-level1'], re: /\bstate\b|\bprovince\b|\bregion\b|\bterritory\b/i, not: [NOT_YOU, /united\s*states/i] },
    { key: 'postcode', auto: ['postal-code'], re: /post(al)?\s*_?-?\s*code|\bzip\b|\bpostcode\b/i, not: [NOT_YOU] },
    { key: 'countryCode', auto: ['country'], re: /country\s*code/i, not: [/phone|telephone|dial/] },
    { key: 'country', auto: ['country-name'], re: /\bcountry\b/i, not: [NOT_YOU, /country\s*code|phone|telephone|dial/i] },

    { key: 'linkedin', re: /linked\s*-?\s*in/i, not: [] },
    { key: 'github', re: /git\s*-?\s*hub/i, not: [] },
    { key: 'twitter', re: /twitter|\bx\s*(profile|url|handle)/i, not: [] },
    { key: 'facebook', re: /facebook/i, not: [] },
    { key: 'skype', re: /skype/i, not: [] },
    { key: 'website', auto: ['url'], re: /portfolio|personal\s*(web)?\s*site|\bwebsite\b|\bweb\s*site\b/i, not: [/linked\s*-?in|git\s*hub|twitter|facebook|skype/i] },

    { key: 'currentCompany', auto: ['organization'], re: /current\s*(employer|company)|\bemployer\b|company\s*name/i, not: [NOT_YOU, /previous|former/i] },
    { key: 'currentTitle', auto: ['organization-title'], re: /current\s*(job\s*)?title|\bjob\s*title\b|\bposition\b|\boccupation\b/i, not: [NOT_YOU, /applied|applying|desired|previous/i] },
    { key: 'workRights', re: /work\s*(rights?|authoris|authoriz|eligib|permit)|right\s*to\s*work|visa\s*status|legally\s*(able|entitled)/i, not: [] },
    { key: 'sponsorship', re: /sponsor(ship)?|visa\s*sponsor/i, not: [] },
    { key: 'willingToRelocate', re: /relocat(e|ion)|willing\s*to\s*move/i, not: [] },
    { key: 'drivingLicence', re: /driv(?:ing|er['\u2019]?s?)\s*licen[cs]e/i, not: [] },
    { key: 'noticePeriod', re: /notice\s*period|how\s*soon\s*can\s*you\s*start/i, not: [] },
    { key: 'availabilityDate', re: /availab(le|ility)\s*(to\s*start|date)|when\s*can\s*you\s*(start|commence)|earliest\s*start|start\s*date/i, not: [/work\s*history|employment/] },
    { key: 'salaryCurrency', re: /currency|(?:salary|pay|compensation)\s*currency/i, not: [/amount|expectation|range/] },
    { key: 'salary', re: /salary|remuneration|expected\s*(pay|compensation)|pay\s*expectation|rate\s*expectation/i, not: [/current|previous|currency/] },
    { key: 'source', re: /how\s+did\s+you\s+(hear|find)|application\s*source|recruitment\s*source/i, not: [] }
  ];

  const BASE_SKIP_TYPES = new Set(['password', 'file', 'hidden', 'submit', 'button', 'image', 'reset', 'range', 'color']);

  function autocompleteField(el) {
    const tokens = (el.getAttribute('autocomplete') || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    return tokens.length ? tokens[tokens.length - 1] : '';
  }

  function contextContainer(el, group) {
    const selectors = {
      work: ['oc-experience-edit-form', '[data-section="experience"]', '.experience-edit-form', 'fieldset'],
      education: ['oc-education-edit-form', '[data-section="education"]', '.education-edit-form', 'fieldset'],
      language: ['oc-language-edit-form', '[data-section="language"]', '.language-edit-form', 'fieldset']
    }[group];
    for (const selector of selectors) {
      const container = composedClosest(el, selector);
      if (!container) continue;
      if (selector !== 'fieldset') return container;
      const legend = container.querySelector('legend');
      if (legend && new RegExp(group === 'work' ? 'experience|employment|work history' : group, 'i').test(legend.innerText)) return container;
    }
    return null;
  }

  function contextIndex(container, group) {
    if (!container) return 0;
    const preferred = {
      work: 'oc-experience-edit-form',
      education: 'oc-education-edit-form',
      language: 'oc-language-edit-form'
    }[group];
    let containers = queryAllDeep(preferred).filter(isVisible);
    if (!containers.length) {
      const fallback = {
        work: '[data-section="experience"], .experience-edit-form',
        education: '[data-section="education"], .education-edit-form',
        language: '[data-section="language"], .language-edit-form'
      }[group];
      containers = queryAllDeep(fallback).filter(isVisible);
    }
    if (!containers.length) {
      const legendPattern = new RegExp(group === 'work' ? 'experience|employment|work history' : group, 'i');
      containers = queryAllDeep('fieldset').filter((fieldset) => {
        const legend = fieldset.querySelector && fieldset.querySelector('legend');
        return isVisible(fieldset) && legend && legendPattern.test(legend.innerText || '');
      });
    }
    const index = containers.indexOf(container);
    return index < 0 ? 0 : index;
  }

  function recordContext(el) {
    for (const group of ['work', 'education', 'language']) {
      const container = contextContainer(el, group);
      if (container) return { group, index: contextIndex(container, group) };
    }
    const hay = describeField(el);
    const id = hay.match(/\b(exp(?:erience)?|edu(?:cation)?|lang(?:uage)?)[-_.[]/i);
    if (!id) return null;
    return { group: /^exp/i.test(id[1]) ? 'work' : /^edu/i.test(id[1]) ? 'education' : 'language', index: 0 };
  }

  function classifyRecord(el) {
    const context = recordContext(el);
    if (!context) return null;
    const { group, index } = context;
    const hay = describeField(el);
    const type = (el.getAttribute('type') || '').toLowerCase();
    const hit = (field) => ({ key: `${group}.${index}.${field}`, confidence: 'high' });

    if (type === 'checkbox') {
      return /currently|current\s*(role|job|school|student)|still\s*(work|employed|attend|stud)|present/i.test(hay) ? hit('current') : null;
    }

    if (/description|summary|responsibilit|what you did|achievement/i.test(hay)) return hit('summary');

    // Everything below matches on a single bare keyword ("to", "employer",
    // "title"...), which is fine for a real field label ("From", "Company")
    // but the same words turn up mid-sentence in an unrelated screening
    // question sharing the section — "Is it OK to contact this employer?"
    // contains both "to" and "employer". Real labels are short fragments, not
    // full sentences, so gate every bare-keyword rule on that shape; only the
    // unambiguous "start date"/"end date" phrase is trusted regardless.
    const looksLikeFieldLabel = !/\?/.test(hay) && hay.length <= 60;
    if (/start\s*date/i.test(hay) || (/\bfrom\b/i.test(hay) && looksLikeFieldLabel)) return hit('start');
    if (/end\s*date/i.test(hay) || (/\bto\b/i.test(hay) && looksLikeFieldLabel)) return hit('end');
    if (!looksLikeFieldLabel) return null;

    if (group === 'work') {
      if (/office\s*location|work\s*location|job\s*location/i.test(hay)) return hit('location');
      if (/\bcompany\b|\bemployer\b|organi[sz]ation/i.test(hay)) return hit('company');
      if (/\btitle\b|\bposition\b|\boccupation\b|\brole\b/i.test(hay)) return hit('title');
    } else if (group === 'education') {
      if (/school\s*location|campus\s*location/i.test(hay)) return hit('location');
      if (/\binstitution\b|\bschool\b|\buniversity\b|\bcollege\b/i.test(hay)) return hit('school');
      if (/\bmajor\b|field\s*of\s*study|speciali[sz]ation|discipline/i.test(hay)) return hit('major');
      if (/\bdegree\b|qualification|credential|education\s*level/i.test(hay)) return hit('qualification');
    } else {
      if (/proficien|fluency|\blevel\b/i.test(hay)) return hit('proficiency');
      if (/\blanguage\b/i.test(hay)) return hit('language');
    }
    return null;
  }

  function isProtectedField(el) {
    return PROTECTED.test(describeField(el));
  }

  function fillableFields() {
    return queryAllDeep('input, select, textarea, [contenteditable="true"]').filter((el) => {
      if (composedClosest(el, '#clc-root')) return false;
      if (el.disabled || el.readOnly) return false;
      if (el.tagName === 'INPUT' && BASE_SKIP_TYPES.has((el.type || '').toLowerCase())) return false;
      if ((el.tagName === 'TEXTAREA' || el.isContentEditable) && COVER().test(describeField(el))) return false;
      return isVisible(el);
    });
  }

  function classify(el) {
    if (isProtectedField(el)) return null;
    const hay = describeField(el);
    // A type or autocomplete token must not override referee/emergency-contact
    // context; those controls often use the same semantic HTML as applicant data.
    if (NOT_YOU.test(hay)) return null;
    const record = classifyRecord(el);
    if (record) return record;
    // An unknown control inside a repeatable record must stay unknown. Falling
    // through to generic rules can turn "contact this employer?" into the
    // applicant's current-company field.
    if (recordContext(el)) return null;
    const auto = autocompleteField(el);
    const type = (el.getAttribute('type') || '').toLowerCase();

    // Country-code selectors are frequently placed beside a phone input with
    // the same broad label and no semantic autocomplete token.
    if (el.tagName === 'SELECT' && el.options) {
      const choices = Array.from(el.options)
        .map((option) => String(option.value || option.textContent || '').trim())
        .filter(Boolean);
      const dialCodes = choices.filter((choice) => /^\+\d{1,4}\b/.test(choice));
      if (choices.length >= 2 && dialCodes.length >= Math.min(2, choices.length)) {
        return { key: 'phoneCountryCode', confidence: 'high' };
      }
    }

    for (const rule of RULES) {
      if (rule.auto && auto && rule.auto.includes(auto)) return { key: rule.key, confidence: 'high' };
    }
    for (const rule of RULES) {
      if (rule.type && type === rule.type) return { key: rule.key, confidence: 'high' };
    }
    if (!hay) return null;
    for (const rule of RULES) {
      if (!rule.re.test(hay)) continue;
      if ((rule.not || []).some((negative) => negative.test(hay))) continue;
      return { key: rule.key, confidence: 'guess' };
    }
    return null;
  }

  function getRecord(profile, key) {
    const match = key.match(/^(work|education|language)\.(\d+)\.(.+)$/);
    if (!match) return null;
    const collection = match[1] === 'language' ? profile.languages : profile[match[1]];
    const entry = (Array.isArray(collection) && collection[Number(match[2])]) || {};
    return { group: match[1], field: match[3], entry };
  }

  function resolve(profile, key) {
    const p = profile || {};
    const record = getRecord(p, key);
    if (record) {
      if (record.field === 'end' && record.entry.current) return '';
      if (record.group === 'education' && record.field === 'qualification') {
        return record.entry.qualification || record.entry.degree || '';
      }
      return record.entry[record.field] ?? '';
    }
    const recent = (p.work && p.work[0]) || {};
    const direct = {
      fullName: p.fullName || [p.firstName, p.lastName].filter(Boolean).join(' '),
      streetAddress: [p.addressLine1, p.addressLine2, p.addressLine3].filter(Boolean).join('\n'),
      currentCompany: p.currentCompany || recent.company || '',
      currentTitle: p.currentTitle || recent.title || '',
      countryCode: p.countryCode || countryCodeFor(p.country),
      phoneCountryCode: p.phoneCountryCode || phoneParts(p.phone).countryCode
    };
    if (key in direct) return direct[key];
    return p[key] ?? '';
  }

  const COUNTRY_CODES = { australia: 'AU', 'new zealand': 'NZ', 'united kingdom': 'GB', 'united states': 'US', canada: 'CA', singapore: 'SG', thailand: 'TH' };
  function countryCodeFor(country) {
    return COUNTRY_CODES[String(country || '').trim().toLowerCase()] || '';
  }

  function phoneParts(phone) {
    const raw = String(phone || '').trim();
    const compact = raw.replace(/[^+\d]/g, '');
    const known = ['+64', '+61', '+44', '+1', '+65', '+66'].find((code) => compact.startsWith(code));
    if (known) return { countryCode: known, national: compact.slice(known.length) };
    const match = compact.match(/^\+(\d{1,3})(\d{6,})$/);
    return { countryCode: match ? `+${match[1]}` : '', national: match ? match[2] : compact };
  }

  function isoDate(value, monthOnly) {
    const raw = String(value || '').trim();
    let match = raw.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
    if (!match) {
      const names = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
      const named = raw.match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
      if (named && names[named[1].slice(0, 3).toLowerCase()]) match = ['', named[2], names[named[1].slice(0, 3).toLowerCase()], '1'];
    }
    if (!match) return raw;
    const year = match[1];
    const month = String(match[2]).padStart(2, '0');
    return monthOnly ? `${year}-${month}` : `${year}-${month}-${String(match[3] || 1).padStart(2, '0')}`;
  }

  function dateForPlaceholder(value, placeholder) {
    const iso = isoDate(value, false);
    const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return value;
    const [, year, month, day] = match;
    const hint = String(placeholder || '').toLowerCase();
    if (/d{1,2}\W*m{1,2}\W*y{2,4}/.test(hint)) return `${day}/${month}/${year}`;
    if (/m{1,2}\W*d{1,2}\W*y{2,4}/.test(hint)) return `${month}/${day}/${year}`;
    if (/y{2,4}\W*m{1,2}\W*d{1,2}/.test(hint)) return `${year}-${month}-${day}`;
    if (/m{1,2}\W*y{2,4}/.test(hint)) return `${month}/${year}`;
    if (/y{2,4}\W*m{1,2}/.test(hint)) return `${year}-${month}`;
    return value;
  }

  function formatValue(el, key, value, profile) {
    let out = value;
    const auto = autocompleteField(el);
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (key === 'middleName' && el.maxLength === 1) out = String(value).slice(0, 1);
    if (key === 'phoneCountryCode') out = profile.phoneCountryCode || phoneParts(profile.phone).countryCode || value;
    if (auto === 'tel-national') out = phoneParts(profile.phone).national || value;
    if (type === 'date') out = isoDate(value, false);
    if (type === 'month') out = isoDate(value, true);
    if (type !== 'date' && type !== 'month' && /(?:^|\.)(?:start|end)$|availabilityDate/.test(key)) {
      out = dateForPlaceholder(value, el.getAttribute('placeholder'));
    }
    if (type === 'number') {
      const numeric = String(value).replace(/[^\d.-]/g, '');
      if (/^-?\d+(?:\.\d+)?$/.test(numeric)) out = numeric;
    }
    return String(out == null ? '' : out);
  }

  function truthy(value) {
    return ['yes', 'y', 'true', '1', 'checked', 'current'].includes(normalizeChoice(value));
  }

  function radioGroup(el) {
    const root = el.getRootNode ? el.getRootNode() : document;
    if (el.name) {
      try {
        return Array.from(root.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`));
      } catch (e) {}
    }
    const group = composedClosest(el, 'fieldset, [role="radiogroup"]');
    return group ? queryAllDeep('input[type="radio"]', group) : [el];
  }

  function optionLabel(el) {
    const bits = [];
    if (el.labels) for (const label of el.labels) bits.push(label.innerText);
    for (const attr of ['aria-label', 'value']) {
      const value = el.getAttribute(attr);
      if (value) bits.push(value);
    }
    return bits.join(' ').replace(/\s+/g, ' ').trim();
  }

  function writeRadio(el, value) {
    const group = radioGroup(el);
    const wanted = choiceVariants(value);
    const match = group.find((radio) => {
      const variants = choiceVariants(optionLabel(radio));
      return [...variants].some((variant) => wanted.has(variant));
    });
    if (!match) return { ok: false, handled: group };
    if (!match.checked) writeInto(match, true);
    return { ok: true, element: match, handled: group };
  }

  function isAutocompleteControl(el) {
    return (el.getAttribute('aria-haspopup') || '').toLowerCase() === 'listbox' ||
      !!composedClosest(el, 'spl-autocomplete, [role="combobox"], [data-test*="autocomplete"]');
  }

  async function fill(profile, { overwrite = false } = {}) {
    const filled = [];
    const skipped = [];
    const review = [];
    const handled = new Set();
    let unmatched = 0;
    let protectedCount = 0;

    for (const el of fillableFields()) {
      if (handled.has(el)) continue;
      if (isProtectedField(el)) {
        protectedCount++;
        continue;
      }
      const hit = classify(el);
      if (!hit) {
        unmatched++;
        continue;
      }
      const raw = resolve(profile, hit.key);
      if (raw === '' || raw == null || (el.type === 'checkbox' && !truthy(raw))) {
        skipped.push({ key: hit.key, why: el.type === 'checkbox' && raw !== '' && raw != null ? 'left unchecked' : 'not in your profile' });
        continue;
      }
      const existing = el.type === 'checkbox' || el.type === 'radio' ? el.checked : (el.value || el.innerText || '').trim();
      if (existing && !overwrite) {
        skipped.push({ key: hit.key, why: 'already filled' });
        continue;
      }

      const value = formatValue(el, hit.key, raw, profile || {});
      let target = el;
      let ok;
      if (el.type === 'radio') {
        const result = writeRadio(el, value);
        ok = result.ok;
        target = result.element || el;
        result.handled.forEach((radio) => handled.add(radio));
      } else {
        ok = writeInto(el, el.type === 'checkbox' ? true : value);
      }

      let needsConfirmation = false;
      if (ok && isAutocompleteControl(target)) needsConfirmation = !(await commitAutocomplete(target, value));
      if (ok && target.checkValidity && !target.checkValidity()) ok = false;
      flash(target, ok && !needsConfirmation);

      if (!ok) skipped.push({ key: hit.key, why: target.tagName === 'SELECT' || target.type === 'radio' ? 'no exact option' : 'value rejected' });
      else if (needsConfirmation) review.push({ key: hit.key, value, why: 'choose a dropdown suggestion' });
      else filled.push({ key: hit.key, value, confidence: hit.confidence });
    }

    if (filled.length && document.activeElement) document.activeElement.blur();
    return {
      filled,
      skipped,
      review,
      unmatched,
      protected: protectedCount,
      candidates: filled.length + skipped.length + review.length + unmatched + protectedCount
    };
  }

  CLC.autofill = { fill, classify, fillableFields, isProtectedField, autocompleteField, formatValue };
})();
