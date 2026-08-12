const DEFAULT_SERVER = 'http://127.0.0.1:8787';

const CONTENT_FILES = [
  'content/dom.js',
  'content/adapters.js',
  'content/autofill.js',
  'content/panel.js',
  'content/main.js'
];

const STARTER_TEMPLATES = [
  {
    id: 'eng',
    name: 'Engineering-first',
    maxWords: 250,
    tone: 'Direct, plain, specific. Sound like a person who has shipped things.',
    skeleton: [
      'One opening line naming the role and the single most relevant thing I have built.',
      'A paragraph matching two or three concrete requirements from the ad to work I have actually done, with the stack named.',
      'A short paragraph on why this company specifically — reference something real from the ad.',
      'One closing line. No restating the whole CV.'
    ].join('\n'),
    rules: 'Name technologies only if they appear in my résumé. Prefer what a system did over adjectives about me.'
  },
  {
    id: 'fin',
    name: 'Finance-first',
    maxWords: 300,
    tone: 'Measured and analytical, but conversational rather than corporate.',
    skeleton: [
      'Open with the analytical interest that leads to this role, not with enthusiasm.',
      'A paragraph on relevant coursework, research or deal/market exposure, with the reasoning made visible.',
      'A paragraph connecting the technical side to the commercial one where it is genuinely relevant.',
      'One closing line.'
    ].join('\n'),
    rules: 'No superlatives about the firm. Every claim must be defensible in an interview.'
  }
];

chrome.runtime.onInstalled.addListener(async (details) => {
  const s = await chrome.storage.local.get(['templates']);
  if (!s.templates || !s.templates.length) {
    await chrome.storage.local.set({ templates: STARTER_TEMPLATES, defaultTemplate: 'eng' });
  }
  /* The tool is useless until it knows who you are, so say so on day one
     rather than letting the first draft come back empty. */
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

/* On declared job/ATS hosts the content scripts load themselves. Clicking the
   toolbar button injects them anywhere else — that's what makes "point at the
   box" usable on an ATS nobody has written an adapter for, without asking for
   read access to every site you visit. */
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !/^https?:/.test(tab.url || '')) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: CONTENT_FILES });
  } catch (e) {
    console.warn('Could not inject into this page:', e.message);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type === 'CLC_FRAME') return; // frame-targeted; not ours
  handle(msg, sender).then(reply).catch((e) => reply({ error: String(e.message || e) }));
  return true; // keep the channel open for the async reply
});

/* A stopped server surfaces as a bare "Failed to fetch", which tells the user
   nothing. Every call to it goes through here so the offline case reads the
   same way wherever it happens. */
async function postToServer(base, path, body) {
  try {
    return await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw new Error(`Can't reach the local server at ${base}. Is "npm start" running in the server folder?`);
  }
}

async function handle(msg, sender) {
  const { serverUrl } = await chrome.storage.local.get('serverUrl');
  const base = serverUrl || DEFAULT_SERVER;

  switch (msg.type) {
    case 'GENERATE': {
      const res = await postToServer(base, '/generate', msg.payload);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Local server returned ${res.status}.`);
      return data;
    }

    /* Fetch the ad page when the apply form doesn't carry the description. One
       page, for the job the user is applying to — not a crawler. The HTML goes
       back to the content script to be parsed: a service worker has no DOM, so
       DOMParser doesn't exist here. */
    case 'FETCH_JOB': {
      const res = await fetch(msg.payload.url, { credentials: 'omit' });
      if (!res.ok) throw new Error(`Could not re-read the ad (${res.status}).`);
      return { html: await res.text() };
    }

    /* Relay from the panel (top frame) to every frame in the same tab, for
       forms that live inside an iframe. Frames with nothing to contribute stay
       quiet, so the first real answer is the one we get back. */
    case 'BROADCAST': {
      const tabId = sender.tab && sender.tab.id;
      if (tabId == null) return { ok: false };
      const frames = (await chrome.webNavigation.getAllFrames({ tabId })) || [];
      const replies = await Promise.all(
        frames.map(
          ({ frameId }) =>
            new Promise((resolve) => {
              chrome.tabs.sendMessage(tabId, { type: 'CLC_FRAME', ...msg.payload }, { frameId }, (res) => {
                void chrome.runtime.lastError; // "no receiver" is an expected outcome here
                resolve(res || null);
              });
            })
        )
      );
      const useful = replies.filter((res) => res && res.ok);
      if (!useful.length) return { ok: false };
      if (msg.payload.kind !== 'FILL') return useful[0];

      /* A form can be split across multiple frames. Report every field that
         was filled instead of accepting whichever frame replied first. */
      const report = useful.reduce(
        (all, res) => {
          const next = res.report || {};
          all.filled.push(...(next.filled || []));
          all.skipped.push(...(next.skipped || []));
          all.review.push(...(next.review || []));
          all.unmatched += next.unmatched || 0;
          all.protected += next.protected || 0;
          all.candidates += next.candidates || 0;
          return all;
        },
        { filled: [], skipped: [], review: [], unmatched: 0, protected: 0, candidates: 0 }
      );
      return { ok: true, report };
    }

    case 'SAVE_FILE': {
      const res = await postToServer(base, '/docx', msg.payload);
      if (!res.ok) throw new Error(`Local server returned ${res.status} building the file.`);
      const blob = await res.blob();
      const url = await new Promise((resolve, rejectRead) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => rejectRead(new Error('Could not read the generated file.'));
        r.readAsDataURL(blob);
      });
      await chrome.downloads.download({ url, filename: `${msg.payload.name}.docx`, saveAs: true });
      return { ok: true };
    }

    case 'OPEN_OPTIONS':
      chrome.runtime.openOptionsPage();
      return { ok: true };

    default:
      throw new Error('Unknown message: ' + msg.type);
  }
}
