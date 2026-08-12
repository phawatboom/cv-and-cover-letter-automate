/* The panel lives in a shadow root so the host page's CSS can't reach it and
   ours can't leak out. Visual direction: a dark indigo instrument panel that
   reads as "tool", not "part of the site" — with a monospace status line that
   always states what it found on the page. That line is the whole trust story
   for something that types into a form for you. */
(function () {
  const CLC = window.CLC;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .panel {
      position: fixed; right: 20px; bottom: 20px; width: 360px; max-height: 78vh;
      display: flex; flex-direction: column; z-index: 2147483646;
      background: #1A1F38; color: #E4E6F2; border: 1px solid #2E3660;
      border-radius: 10px; box-shadow: 0 18px 44px rgba(10,14,30,.45);
      font-size: 13px; line-height: 1.5;
    }
    .bar { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #2E3660; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: #E0A458; flex: none; }
    .dot.ok { background: #5FBF8F; } .dot.err { background: #E0685A; }
    .name { font-weight: 600; letter-spacing: .01em; }
    .spacer { flex: 1; }
    .icon { background: none; border: 0; color: #8E97C4; cursor: pointer; font-size: 15px; padding: 2px 5px; border-radius: 4px; }
    .icon:hover { background: #262D50; color: #E4E6F2; }
    .icon:focus-visible, button:focus-visible { outline: 2px solid #E0A458; outline-offset: 2px; }
    .body { padding: 12px; overflow: auto; }
    .status {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
      color: #99A2CE; background: #141830; border: 1px solid #262D50; border-radius: 6px;
      padding: 8px 9px; white-space: pre-wrap; word-break: break-word;
    }
    .status b { color: #E4E6F2; font-weight: 600; }
    .row { display: flex; gap: 8px; margin-top: 10px; }
    button.act {
      flex: 1; padding: 9px 10px; border-radius: 6px; border: 1px solid #3A4478;
      background: #262D50; color: #E4E6F2; font-size: 13px; font-weight: 500; cursor: pointer;
    }
    button.act:hover:not(:disabled) { background: #303864; }
    button.act.primary { background: #E0A458; border-color: #E0A458; color: #241A08; font-weight: 600; }
    button.act.primary:hover:not(:disabled) { background: #EAB675; }
    button.act:disabled { opacity: .45; cursor: not-allowed; }
    textarea.draft {
      width: 100%; height: 240px; margin-top: 10px; padding: 10px; resize: vertical;
      background: #141830; color: #E4E6F2; border: 1px solid #2E3660; border-radius: 6px;
      font-size: 12.5px; line-height: 1.6; font-family: inherit;
    }
    .meta { display: flex; justify-content: space-between; margin-top: 6px;
      font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #8E97C4; }
    select { width: 100%; margin-top: 10px; padding: 8px; border-radius: 6px;
      background: #141830; color: #E4E6F2; border: 1px solid #2E3660; font-size: 12.5px; }
    label.lbl { display: block; margin-top: 10px; font-size: 11px; letter-spacing: .06em;
      text-transform: uppercase; color: #8E97C4; }
    .hint { margin-top: 8px; font-size: 11.5px; color: #8E97C4; }
    .err { color: #E0685A; }
    .sect { margin-top: 12px; padding-top: 12px; border-top: 1px solid #262D50; }
    .fill { margin-top: 8px; font-family: ui-monospace, Menlo, monospace; font-size: 11px;
      color: #99A2CE; background: #141830; border: 1px solid #262D50; border-radius: 6px; padding: 8px 9px; }
    .fill b { color: #5FBF8F; }
    .fill .dim { color: #6E77A4; }
    @media (prefers-reduced-motion: no-preference) {
      .panel { animation: rise .16s ease-out; }
      @keyframes rise { from { transform: translateY(8px); opacity: 0 } }
    }
  `;

  class Panel {
    constructor(handlers) {
      this.h = handlers;
      this.host = document.createElement('div');
      this.host.id = 'clc-root';
      this.root = this.host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = CSS;
      this.root.append(style);
      this.el = document.createElement('div');
      this.el.className = 'panel';
      this.root.append(this.el);
      document.documentElement.append(this.host);
      this.state = {
        phase: 'idle',
        job: null,
        draft: '',
        templates: [],
        templateId: null,
        error: '',
        fillReport: null
      };
      this.render();
    }

    set(patch) {
      Object.assign(this.state, patch);
      this.render();
    }

    statusLine() {
      const { job, error } = this.state;
      if (error) return `<b class="err">${esc(error)}</b>`;
      if (!job) return 'No job captured yet.\nOpen the ad and choose Capture job.';
      const words = job.description ? job.description.split(/\s+/).length : 0;
      return [
        `site     <b>${esc(job.siteLabel || job.site)}</b>`,
        `role     <b>${esc(job.title || '—')}</b>`,
        `company  <b>${esc(job.company || '—')}</b>`,
        `ad text  <b>${words} words</b>`,
        `target   <b>${esc(job.fieldNote || 'not located')}</b>`
      ].join('\n');
    }

    fillLine() {
      const r = this.state.fillReport;
      if (!r) return '';
      if (r.error) return `<div class="fill"><span class="err">${esc(r.error)}</span></div>`;
      const names = r.filled.map((f) => f.key).join(', ');
      const guessed = r.filled.filter((f) => f.confidence === 'guess').length;
      const lines = [
        r.filled.length
          ? `filled <b>${r.filled.length}</b> — ${esc(names)}`
          : r.candidates === 0
            ? 'filled <b>0</b> — no accessible editable fields were found on this page'
            : 'filled <b>0</b> — no recognised field had a saved value to insert'
      ];
      if (guessed) lines.push(`<span class="dim">${guessed} matched on label text — check those</span>`);
      if (r.skipped.length) {
        const already = r.skipped.filter((s) => s.why === 'already filled').length;
        const missing = r.skipped.filter((s) => s.why === 'not in your profile');
        if (already) lines.push(`<span class="dim">${already} left alone (already filled)</span>`);
        if (missing.length)
          lines.push(`<span class="dim">missing from profile: ${esc([...new Set(missing.map((m) => m.key))].join(', '))}</span>`);
      }
      if (r.review && r.review.length) {
        lines.push(`<span class="err">${r.review.length} typed but need a dropdown choice — review the red fields</span>`);
      }
      if (r.protected) lines.push(`<span class="dim">${r.protected} sensitive/consent field(s) deliberately left for you</span>`);
      if (r.unmatched) lines.push(`<span class="dim">${r.unmatched} field(s) not recognised — type those yourself</span>`);
      return `<div class="fill">${lines.join('<br>')}</div>`;
    }

    render() {
      const s = this.state;
      const words = s.draft ? s.draft.trim().split(/\s+/).filter(Boolean).length : 0;
      const opts = s.templates
        .map((t) => `<option value="${esc(t.id)}"${t.id === s.templateId ? ' selected' : ''}>${esc(t.name)}</option>`)
        .join('');

      this.el.innerHTML = `
        <div class="bar">
          <span class="dot ${s.phase === 'inserted' ? 'ok' : s.error ? 'err' : ''}"></span>
          <span class="name">Cover Letter Copilot</span>
          <span class="spacer"></span>
          <button class="icon" data-a="settings" title="Settings">⚙</button>
          <button class="icon" data-a="close" title="Hide">✕</button>
        </div>
        <div class="body">
          <div class="status">${this.statusLine()}</div>

          <div class="sect">
            <label class="lbl">Your details</label>
            <div class="row">
              <button class="act" data-a="fill">Fill this form</button>
            </div>
            ${this.fillLine()}
          </div>

          <div class="sect">
            <label class="lbl">Cover letter</label>
            ${s.templates.length ? `<select id="tpl" data-a="tpl">${opts}</select>` : ''}
            <div class="row">
              <button class="act" data-a="capture">Capture job</button>
              <button class="act primary" data-a="write" ${!s.job || s.phase === 'writing' ? 'disabled' : ''}>
                ${s.phase === 'writing' ? 'Writing…' : 'Write draft'}
              </button>
            </div>
            ${
              s.draft
                ? `<textarea class="draft" data-a="draft">${esc(s.draft)}</textarea>
                   <div class="meta"><span>${words} words</span><span>${s.phase === 'inserted' ? 'inserted' : 'review before inserting'}</span></div>
                   <div class="row">
                     <button class="act" data-a="copy">Copy</button>
                     <button class="act" data-a="download">Save file</button>
                     <button class="act primary" data-a="insert">Insert</button>
                   </div>
                   <div class="row"><button class="act" data-a="point">Point at the box</button></div>`
                : ''
            }
          </div>

          <div class="hint">Nothing is submitted for you. Every field this writes to flashes green — read them before you send.</div>
        </div>`;

      this.el.querySelectorAll('[data-a]').forEach((node) => {
        const a = node.dataset.a;
        if (a === 'draft') node.addEventListener('input', (e) => (this.state.draft = e.target.value));
        else if (a === 'tpl') node.addEventListener('change', (e) => this.h.onTemplate(e.target.value));
        else node.addEventListener('click', () => this.h[a] && this.h[a]());
      });
    }

    toggle(show) {
      this.host.style.display = show === false ? 'none' : '';
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* Click-to-target. Selector drift is the thing that actually breaks tools
     like this, so instead of guessing forever we let the user point once and
     remember the path per hostname. */
  function pickElement() {
    return new Promise((resolve) => {
      const ring = document.createElement('div');
      Object.assign(ring.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: 2147483647,
        border: '2px solid #E0A458', borderRadius: '4px',
        background: 'rgba(224,164,88,.12)', transition: 'all .05s'
      });
      document.body.append(ring);
      const move = (e) => {
        const el = (e.composedPath && e.composedPath()[0]) || e.target;
        const r = el.getBoundingClientRect();
        Object.assign(ring.style, { top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' });
      };
      const done = (el) => {
        ring.remove();
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('click', click, true);
        document.removeEventListener('keydown', key, true);
        resolve(el);
      };
      const click = (e) => {
        e.preventDefault();
        e.stopPropagation();
        done((e.composedPath && e.composedPath()[0]) || e.target);
      };
      const key = (e) => e.key === 'Escape' && done(null);
      document.addEventListener('mousemove', move, true);
      document.addEventListener('click', click, true);
      document.addEventListener('keydown', key, true);
    });
  }

  CLC.Panel = Panel;
  CLC.pickElement = pickElement;
})();
