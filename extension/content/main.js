(function () {
  /* The toolbar button re-injects these files on demand, so a second run is
     normal rather than exceptional — reveal the existing panel and stop. */
  if (window.__CLC_ACTIVE) {
    if (window.__CLC_SHOW) window.__CLC_SHOW();
    return;
  }
  window.__CLC_ACTIVE = true;

  const CLC = window.CLC;
  const adapter = CLC.pickAdapter();
  const isTop = window.top === window.self;

  const send = (type, payload) => chrome.runtime.sendMessage({ type, payload });

  /* Every frame is a potential write target. Only the top frame draws a panel;
     subframes sit here waiting to be asked, which is how a form that lives in
     an iframe (Indeed sometimes, embedded ATS widgets often) still works
     without the page sprouting three panels. A frame with nothing to offer
     stays silent so the first useful answer wins. */
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || msg.type !== 'CLC_FRAME' || isTop) return;
    if (msg.kind === 'INSERT') {
      const el = adapter.findField();
      if (!el) return;
      CLC.writeInto(el, msg.text);
      CLC.flash(el);
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      reply({ ok: true });
    } else if (msg.kind === 'FILL') {
      CLC.autofill
        .fill(msg.profile, msg.opts)
        .then((report) => reply(report.candidates ? { ok: true, report } : { ok: false }))
        .catch(() => reply({ ok: false }));
      return true;
    }
  });

  if (!isTop) return;

  let panel = null;
  let settings = { templates: [], defaultTemplate: null, profile: {}, fieldPaths: {}, lastJob: null };

  async function load() {
    const s = await chrome.storage.local.get(['templates', 'defaultTemplate', 'profile', 'fieldPaths', 'lastJob']);
    settings = {
      templates: s.templates || [],
      defaultTemplate: s.defaultTemplate,
      profile: s.profile || {},
      fieldPaths: s.fieldPaths || {},
      lastJob: s.lastJob || null
    };
  }

  /* Read the ad. On an apply page the ad is often gone (Indeed's smartapply
     host, Workday's form, SEEK's collapsed panel) so we fall back to the job
     captured on the ad page — that's why capture is a separate step. */
  async function capture({ silent } = {}) {
    if (adapter.reveal) await adapter.reveal();
    const job = adapter.capture();
    job.siteLabel = adapter.label;

    if (!job.description || job.description.length < 200) {
      const url = adapter.jobUrl && adapter.jobUrl();
      if (url) {
        const parsed = await refetchAd(url);
        if (parsed && parsed.description) Object.assign(job, parsed, { url });
      } else if (settings.lastJob) {
        Object.assign(job, settings.lastJob);
      }
    }
    if (job.description && job.description.length > 200) {
      await chrome.storage.local.set({ lastJob: job });
      settings.lastJob = job;
    }
    job.fieldNote = describeTarget();
    if (!silent && panel) panel.set({ job, error: job.description ? '' : 'Could not read the job ad on this page.' });
    return job;
  }

  /* The background worker does the fetch (it has the host permissions and
     isn't bound by the page's CSP); parsing happens here, because a service
     worker has no DOMParser. */
  async function refetchAd(url) {
    const res = await send('FETCH_JOB', { url });
    if (!res || !res.html) return null;
    const doc = new DOMParser().parseFromString(res.html, 'text/html');
    const sel = adapter.parseSelectors || {};
    const pick = (list) => {
      for (const s of list || []) {
        const el = doc.querySelector(s);
        if (el && el.textContent.trim()) return el.textContent.trim().replace(/\n{3,}/g, '\n\n');
      }
      return '';
    };
    const out = {};
    for (const key of ['title', 'company', 'description']) {
      const v = pick(sel[key]);
      if (v) out[key] = v;
    }
    return out;
  }

  function resolveField() {
    const stored = settings.fieldPaths && settings.fieldPaths[location.hostname];
    if (stored) {
      try {
        const el = CLC.queryDeep(stored);
        if (el && CLC.isVisible(el)) return el;
      } catch (e) {}
    }
    return adapter.findField();
  }

  function describeTarget() {
    const el = resolveField();
    if (el) return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
    if (adapter.hasUploadZone && adapter.hasUploadZone()) return 'file upload — save and attach';
    return 'not located';
  }

  const handlers = {
    async capture() {
      panel.set({ error: '' });
      await capture();
    },

    async write() {
      const job = panel.state.job || (await capture({ silent: true }));
      if (!job || !job.description) return panel.set({ error: 'Capture the job ad first.' });
      panel.set({ phase: 'writing', error: '' });
      const res = await send('GENERATE', {
        job,
        template: settings.templates.find((t) => t.id === panel.state.templateId),
        profile: settings.profile
      });
      if (!res || res.error) {
        return panel.set({ phase: 'idle', error: res ? res.error : 'No response from the local server.' });
      }
      panel.set({ phase: 'draft', draft: res.text });
    },

    /* The other half of the job: name, contact, address, links, work rights.
       Same rule as the letter — it writes, it never submits, and everything it
       touched is flashed green so you can check it in one pass. */
    async fill() {
      const profile = settings.profile || {};
      if (!profile.firstName && !profile.fullName && !profile.email) {
        return panel.set({
          fillReport: { error: 'No details saved yet — open ⚙ and fill in the "You" section.' }
        });
      }
      let report = await CLC.autofill.fill(profile, { overwrite: false });
      const res = await send('BROADCAST', { kind: 'FILL', profile, opts: { overwrite: false } });
      if (res && res.ok && res.report) {
        report = {
          filled: [...report.filled, ...res.report.filled],
          skipped: [...report.skipped, ...res.report.skipped],
          review: [...(report.review || []), ...(res.report.review || [])],
          unmatched: report.unmatched + res.report.unmatched,
          protected: (report.protected || 0) + (res.report.protected || 0),
          candidates: report.candidates + res.report.candidates
        };
      }
      panel.set({ fillReport: report, error: '' });
    },

    async insert() {
      const el = resolveField();
      if (el) {
        CLC.writeInto(el, panel.state.draft);
        CLC.flash(el);
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return panel.set({ phase: 'inserted', error: '' });
      }
      const res = await send('BROADCAST', { kind: 'INSERT', text: panel.state.draft });
      if (res && res.ok) return panel.set({ phase: 'inserted', error: '' });
      panel.set({
        error:
          adapter.hasUploadZone && adapter.hasUploadZone()
            ? 'This form wants a file. Use Save file, then attach it.'
            : 'No cover letter field found. Use "Point at the box".'
      });
    },

    async point() {
      panel.toggle(false);
      const el = await CLC.pickElement();
      panel.toggle(true);
      if (!el) return;
      const path = CLC.cssPath(el);
      const fieldPaths = { ...(settings.fieldPaths || {}), [location.hostname]: path };
      settings.fieldPaths = fieldPaths;
      await chrome.storage.local.set({ fieldPaths });
      const job = { ...(panel.state.job || {}), fieldNote: describeTarget() };
      panel.set({ job, error: '' });
      handlers.insert();
    },

    copy() {
      navigator.clipboard.writeText(panel.state.draft);
    },

    async download() {
      const job = panel.state.job || {};
      const res = await send('SAVE_FILE', {
        text: panel.state.draft,
        name: `Cover letter — ${(job.company || 'role').replace(/[\\/:*?"<>|]/g, '')}`
      });
      /* The .docx is built by the local server, so this is the one button that
         can fail with the server stopped — say so rather than doing nothing. */
      if (res && res.error) return panel.set({ error: res.error });
      panel.set({ error: '' });
    },

    onTemplate(id) {
      panel.state.templateId = id;
      chrome.storage.local.set({ defaultTemplate: id });
    },

    settings() {
      send('OPEN_OPTIONS');
    },

    close() {
      panel.toggle(false);
    }
  };

  async function boot() {
    await load();
    panel = new CLC.Panel(handlers);
    window.__CLC_SHOW = () => panel.toggle(true);
    panel.set({
      templates: settings.templates,
      templateId: settings.defaultTemplate || (settings.templates[0] && settings.templates[0].id)
    });
    await capture({ silent: false });
  }

  /* These are single-page apps: the URL changes without a reload. Polling the
     href once a second costs nothing; a document-wide MutationObserver on
     Workday or Indeed fires thousands of times a minute to learn the same
     thing. */
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    if (panel) capture({ silent: false });
  }, 1000);

  /* Keep storage edits from the options page live in an open panel. */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.profile) settings.profile = changes.profile.newValue || {};
    if (changes.templates && panel) {
      settings.templates = changes.templates.newValue || [];
      panel.set({ templates: settings.templates });
    }
  });

  boot();
})();
