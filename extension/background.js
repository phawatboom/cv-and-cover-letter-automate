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
  },
  /* Not one per stack (web dev, full-stack, backend) — that's just Engineering-
     first with different nouns. These four exist because the underlying logic
     of the letter actually differs: what gets led with, what counts as proof,
     what the failure mode of "sounding like everyone else applying" is. */
  {
    id: 'ai',
    name: 'AI / ML-first',
    maxWords: 250,
    tone: 'Technical and precise, not evangelical. Comfortable naming models and methods, grounded in what happened when it ran.',
    skeleton: [
      'One opening line naming the role and the specific ML/AI problem area I have worked in — not enthusiasm about AI in general.',
      'A paragraph matching two or three requirements from the ad to a model, pipeline or system I actually built — name the approach, then what happened when it shipped: accuracy, latency, adoption, cost.',
      'A short paragraph on why this company\'s specific problem or data — reference something real from the ad, not the field in general.',
      'One closing line.'
    ].join('\n'),
    rules: 'Do not claim state-of-the-art results, published research or benchmarks unless they are in my résumé. Name frameworks, models or datasets only if they appear there. No AI-hype language: "revolutionize", "cutting-edge", "game-changing".'
  },
  {
    id: 'data',
    name: 'Data-first',
    maxWords: 250,
    tone: 'Evidence-driven and precise. Leads with the question or decision, not the tool used to answer it.',
    skeleton: [
      'One opening line naming the role and the kind of question or decision my work has driven — not the tools I used to drive it.',
      'A paragraph matching two or three requirements from the ad to analysis I have actually done — what the data showed, and what decision or system changed because of it.',
      'A short paragraph on why this company\'s data or product specifically — reference something concrete from the ad.',
      'One closing line.'
    ].join('\n'),
    rules: 'Name tools (SQL, Python, dbt, etc.) only if they appear in my résumé. Prefer the decision or outcome an analysis produced over the technique used to produce it.'
  },
  {
    id: 'consulting',
    name: 'Consulting-first',
    maxWords: 300,
    tone: 'Structured and confident, business-outcome oriented. Reads like a compressed case, not an academic essay.',
    skeleton: [
      'Open with the type of problem or client situation that draws me to this role — not enthusiasm about the firm.',
      'A paragraph structured as a mini case: a real situation, what I did, the measurable outcome — mapped to one or two things the ad is asking for.',
      'A short paragraph on why this firm\'s practice area or approach specifically — reference something real from the ad or the firm\'s work.',
      'One closing line. No restating the whole CV.'
    ].join('\n'),
    rules: 'Every outcome needs a number or a concrete result if my résumé has one — no vague "improved efficiency". No consulting clichés: "trusted advisor", "strategic thinker", "thrives in a fast-paced environment".'
  },
  {
    id: 'general',
    name: 'General-purpose',
    maxWords: 220,
    tone: 'Plain, honest, specific. Let the actual experience do the work instead of forcing a technical or business voice that isn\'t there yet.',
    skeleton: [
      'One opening line naming the role and the single most relevant thing about my background for it.',
      'A paragraph connecting two or three things the ad asks for to real experience — study, work or projects — honest about what is direct experience and what is transferable.',
      'A short paragraph on why this company or role specifically — reference something real from the ad.',
      'One closing line.'
    ].join('\n'),
    rules: 'Do not force a technical or industry voice my résumé does not support. It is fine to be candid about being early-career or changing direction.'
  }
];

chrome.runtime.onInstalled.addListener(async (details) => {
  const s = await chrome.storage.local.get(['templates']);
  const existing = Array.isArray(s.templates) ? s.templates : [];
  if (!existing.length) {
    await chrome.storage.local.set({ templates: STARTER_TEMPLATES, defaultTemplate: 'eng' });
  } else {
    /* onInstalled also fires with reason "update" on every version bump, which
       is what lets a newly added starter template (e.g. this file gaining
       "ai"/"data"/"consulting") reach someone who installed before it existed.
       Additive only, matched by id — never touches a template already saved,
       even if they renamed or rewrote one that started as a starter. */
    const knownIds = new Set(existing.map((t) => t.id));
    const additions = STARTER_TEMPLATES.filter((t) => !knownIds.has(t.id));
    if (additions.length) await chrome.storage.local.set({ templates: [...existing, ...additions] });
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

const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i;

/* A stopped server surfaces as a bare "Failed to fetch", which tells the user
   nothing. Every call to it goes through here so the offline case reads the
   same way wherever it happens. The token is only sent when one is saved: a
   loopback server runs without authentication and ignores it. */
async function postToServer(base, token, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (e) {
    throw new Error(
      LOOPBACK.test(base)
        ? `Can't reach the local server at ${base}. Is "npm start" running in the server folder?`
        : `Can't reach the server at ${base}. Check the address in the extension settings.`
    );
  }
}

async function handle(msg, sender) {
  const { serverUrl, serverToken } = await chrome.storage.local.get(['serverUrl', 'serverToken']);
  const base = serverUrl || DEFAULT_SERVER;
  const token = serverToken || '';

  switch (msg.type) {
    case 'GENERATE': {
      const res = await postToServer(base, token, '/generate', msg.payload);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Server returned ${res.status}.`);
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
      const res = await postToServer(base, token, '/docx', msg.payload);
      if (!res.ok) {
        throw new Error(
          res.status === 401
            ? 'The server rejected the access token. Check it in the extension settings.'
            : `Server returned ${res.status} building the file.`
        );
      }
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
