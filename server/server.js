/* Local drafting server.
   It exists for one reason: the API key must not ship inside a browser
   extension, where any page script or anyone who unpacks the folder can read
   it. This process holds the key, and binds to loopback only. */

import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { Document, Packer, Paragraph, TextRun } from 'docx';

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(cors({ origin: [/^chrome-extension:\/\//, /^moz-extension:\/\//] }));

const PORT = process.env.PORT || 8787;
const PROVIDER = (process.env.PROVIDER || 'anthropic').toLowerCase();
const EFFORT = process.env.EFFORT || 'medium';

/* ---------------------------------------------------------------- prompt -- */

const HOUSE_RULES = `
You are drafting a cover letter on behalf of the applicant. Follow these rules
without exception:

- Use only facts that appear in the applicant details below. Do not invent
  employers, dates, tools, metrics, qualifications, grades or projects. If the
  ad asks for something the applicant's history does not show, do not claim it
  — either leave it out or address it honestly in a clause.
- No generic enthusiasm. Cut "I am excited to apply", "passionate about",
  "dynamic team", "I believe I would be a great fit".
- Every claim must be defensible in an interview. Prefer what was built and
  what happened over adjectives about the applicant.
- Write in the applicant's own register: plain, specific, conversational.
  Match the spelling of the job ad's country (AU/NZ English uses -ise, -our).
- Do not restate the résumé in order. Select the two or three things this
  particular ad makes relevant.
- Output the letter body only: no subject line, no address block, no
  commentary, no markdown fences.
`.trim();

function contactLine(p) {
  return [p.email, p.phone, [p.city, p.state].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
}

function historyBlock(p) {
  const roles = (p.work || [])
    .map((w) =>
      `- ${[w.title, w.company].filter(Boolean).join(' at ')}` +
      `${w.start || w.end ? ` (${[w.start, w.end].filter(Boolean).join(' – ')})` : ''}` +
      `${w.summary ? `\n  ${w.summary.replace(/\n/g, ' ')}` : ''}`
    )
    .join('\n');
  const study = (p.education || [])
    .map((e) =>
      `- ${[e.qualification, e.school].filter(Boolean).join(', ')}` +
      `${e.start || e.end ? ` (${[e.start, e.end].filter(Boolean).join(' – ')})` : ''}`
    )
    .join('\n');
  return [roles ? `Work history (newest first):\n${roles}` : '', study ? `Education:\n${study}` : '']
    .filter(Boolean)
    .join('\n\n');
}

function buildPrompt({ job, template = {}, profile = {} }) {
  const t = {
    maxWords: template.maxWords || 250,
    tone: template.tone || 'Plain and specific.',
    skeleton: template.skeleton || '',
    rules: template.rules || ''
  };
  const history = historyBlock(profile);

  return `${HOUSE_RULES}

<applicant>
Name: ${profile.fullName || profile.name || '(unspecified)'}
Contact: ${contactLine(profile) || '(unspecified)'}
${profile.workRights ? `Work rights: ${profile.workRights}` : ''}

${history}

Résumé:
${(profile.resume || '').slice(0, 15000)}
</applicant>

<job source="${job.site}">
Title: ${job.title || '(unspecified)'}
Company: ${job.company || '(unspecified)'}
URL: ${job.url || ''}

Advertisement:
${(job.description || '').slice(0, 18000)}
</job>

<style>
Length: at most ${t.maxWords} words.
Voice: ${t.tone}
${t.skeleton ? `Structure, one paragraph per line:\n${t.skeleton}` : ''}
${t.rules ? `Additional rules: ${t.rules}` : ''}
</style>

Write the letter.`;
}

/* -------------------------------------------------------------- providers -- */

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from .env

/* Claude Opus 5 can decline a request outright (HTTP 200, stop_reason
   "refusal"), so a fallback model is worth having. If this key's org doesn't
   carry the fallback beta, drop it once and keep going rather than failing the
   draft over a feature flag. */
let useFallbacks = true;

async function callAnthropic(prompt) {
  const base = {
    model: process.env.MODEL || 'claude-opus-5',
    max_tokens: 16000,
    output_config: { effort: EFFORT },
    messages: [{ role: 'user', content: prompt }]
  };

  let res;
  try {
    res = await anthropic.beta.messages.create(
      useFallbacks ? { ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : base
    );
  } catch (e) {
    if (useFallbacks && e && e.status === 400) {
      console.warn('Server-side fallbacks unavailable on this key — continuing without them.');
      useFallbacks = false;
      res = await anthropic.beta.messages.create(base);
    } else {
      throw e;
    }
  }

  if (res.stop_reason === 'refusal') {
    throw new Error('The model declined to draft this one. Try again, or write this letter by hand.');
  }
  return res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

async function callOpenAI(prompt) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({ model: process.env.MODEL || 'gpt-4.1-mini', input: prompt })
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.output_text || '').trim();
}

const generate = PROVIDER === 'openai' ? callOpenAI : callAnthropic;

/* ---------------------------------------------------------- résumé import -- */

const RESUME_FLAT_FIELDS = new Set([
  'honorificPrefix', 'firstName', 'middleName', 'lastName', 'preferredName', 'honorificSuffix',
  'email', 'phoneCountryCode', 'phone', 'phoneExtension',
  'addressLine1', 'addressLine2', 'addressLine3', 'district', 'city', 'state', 'postcode', 'country', 'countryCode',
  'linkedin', 'github', 'website', 'twitter', 'facebook', 'skype'
]);
const WORK_FIELDS = new Set(['title', 'company', 'location', 'start', 'end', 'current', 'summary']);
const EDUCATION_FIELDS = new Set(['qualification', 'major', 'school', 'location', 'start', 'end', 'current', 'summary']);
const LANGUAGE_FIELDS = new Set(['language', 'proficiency']);

function resumePrompt(text) {
  return `Extract job-application profile facts from the résumé below.

Return exactly one JSON object and no markdown or commentary. Use this shape:
{
  "profile": {
    "honorificPrefix": "", "firstName": "", "middleName": "", "lastName": "",
    "preferredName": "", "honorificSuffix": "", "email": "", "phoneCountryCode": "",
    "phone": "", "phoneExtension": "", "addressLine1": "", "addressLine2": "",
    "addressLine3": "", "district": "", "city": "", "state": "", "postcode": "",
    "country": "", "countryCode": "", "linkedin": "", "github": "", "website": "",
    "twitter": "", "facebook": "", "skype": ""
  },
  "work": [{"title":"", "company":"", "location":"", "start":"", "end":"", "current":false, "summary":""}],
  "education": [{"qualification":"", "major":"", "school":"", "location":"", "start":"", "end":"", "current":false, "summary":""}],
  "languages": [{"language":"", "proficiency":""}]
}

Rules:
- Copy facts only when explicitly present. Never infer missing names, dates, locations, proficiency, nationality, work rights, or contact details.
- Omit empty keys and empty records.
- Keep dates as written, except use "Present" for an explicitly current role or course.
- Put concise responsibility/achievement text in summary without inventing or improving claims.
- Preserve URLs and international phone prefixes.
- List work and education newest first.

<resume>
${text.slice(0, 30000)}
</resume>`;
}

function parseModelJson(text) {
  const clean = String(text || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model did not return a usable profile. Try the import again.');
  try {
    return JSON.parse(clean.slice(start, end + 1));
  } catch (e) {
    throw new Error('The model returned malformed profile data. Try the import again.');
  }
}

function cleanString(value, max = 4000) {
  return typeof value === 'string' ? value.replace(/\u0000/g, '').trim().slice(0, max) : '';
}

function cleanRecord(record, allowed) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const out = {};
  for (const key of allowed) {
    if (key === 'current') {
      if (record[key] === true) out[key] = true;
      continue;
    }
    const value = cleanString(record[key]);
    if (value) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

function sanitizeResumeProfile(raw, resumeText) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rawProfile = source.profile && typeof source.profile === 'object' ? source.profile : source;
  const profile = {};
  for (const key of RESUME_FLAT_FIELDS) {
    const value = cleanString(rawProfile[key], key.includes('address') ? 300 : 1000);
    if (value) profile[key] = value;
  }
  const records = (value, allowed, max) =>
    (Array.isArray(value) ? value : []).slice(0, max).map((item) => cleanRecord(item, allowed)).filter(Boolean);
  return {
    profile,
    work: records(source.work, WORK_FIELDS, 30),
    education: records(source.education, EDUCATION_FIELDS, 20),
    languages: records(source.languages, LANGUAGE_FIELDS, 20),
    resume: resumeText.slice(0, 50000)
  };
}

async function extractResumeText({ name = '', type = '', data = '' }) {
  if (typeof data !== 'string' || !data) throw new Error('Résumé file data is missing.');
  const buffer = Buffer.from(data, 'base64');
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) throw new Error('Résumé must be between 1 byte and 8 MB.');
  const ext = String(name).toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || '';
  let text;
  if (ext === '.txt' || ext === '.md' || /^text\//i.test(type)) {
    text = buffer.toString('utf8');
  } else if (ext === '.docx' || /wordprocessingml/i.test(type)) {
    const mammothModule = await import('mammoth');
    const mammoth = mammothModule.default || mammothModule;
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (ext === '.pdf' || type === 'application/pdf') {
    /* pdf.js targets browsers as well as Node and evaluates DOMMatrix at module
       load time. pdf-parse ships a Node canvas implementation, but Node does
       not install its geometry classes as globals for it. Provide only the
       three standards-compatible classes pdf.js needs before importing it. */
    const canvas = await import('@napi-rs/canvas');
    if (!globalThis.DOMMatrix) globalThis.DOMMatrix = canvas.DOMMatrix;
    if (!globalThis.ImageData) globalThis.ImageData = canvas.ImageData;
    if (!globalThis.Path2D) globalThis.Path2D = canvas.Path2D;
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  } else {
    throw new Error('Unsupported résumé format. Use PDF, DOCX, TXT, or MD.');
  }
  return cleanString(text, 50000).replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n');
}

export { buildPrompt, extractResumeText, parseModelJson, sanitizeResumeProfile };

/* ----------------------------------------------------------------- routes -- */

app.post('/generate', async (req, res) => {
  try {
    const { job } = req.body;
    if (!job || !job.description || job.description.length < 100) {
      return res.status(400).json({ error: 'Job description missing or too short to work from.' });
    }
    const profile = req.body.profile || {};
    if (!profile.resume && !(profile.work || []).length) {
      return res.status(400).json({ error: 'No résumé or work history saved — open the extension settings first.' });
    }
    const text = await generate(buildPrompt(req.body));
    res.json({ text, words: text.split(/\s+/).length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/parse-resume', async (req, res) => {
  try {
    const text = await extractResumeText(req.body || {});
    if (text.length < 80) {
      return res.status(400).json({
        error: 'Very little text could be read. If this is a scanned PDF, export it with selectable text or use DOCX/TXT.'
      });
    }
    const parsed = parseModelJson(await generate(resumePrompt(text)));
    const suggested = sanitizeResumeProfile(parsed, text);
    res.json({ suggested, characters: text.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/* Workday and most enterprise ATSs take the cover letter as an attachment
   rather than a text field, so the draft has to become a file. */
app.post('/docx', async (req, res) => {
  const { text = '', name = 'Cover letter' } = req.body;
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: text.split(/\n{2,}/).map(
          (para) =>
            new Paragraph({
              spacing: { after: 200, line: 300 },
              children: [new TextRun({ text: para.replace(/\n/g, ' ').trim(), font: 'Calibri', size: 22 })]
            })
        )
      }
    ]
  });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.docx"`);
  res.send(buffer);
});

app.get('/health', (_, res) => res.json({ ok: true, provider: PROVIDER }));

/* Opening the root URL in a browser is the obvious way to check the server is
   alive, and Express's bare "Cannot GET /" reads like a failure when it isn't. */
app.get('/', (_, res) => {
  res.type('html').send(
    `<!doctype html><meta charset="utf-8"><title>Cover Letter Copilot</title>
     <style>body{font:15px/1.6 ui-sans-serif,system-ui,sans-serif;background:#141830;color:#E4E6F2;
     margin:0;display:grid;place-items:center;min-height:100vh}main{max-width:34rem;padding:2rem}
     h1{font-size:1.1rem;margin:0 0 .25rem}p{color:#99A2CE;margin:.5rem 0}
     code{font-family:ui-monospace,Menlo,monospace;color:#E0A458}</style>
     <main>
       <h1>Cover Letter Copilot server is running</h1>
       <p>Provider <code>${PROVIDER}</code> · listening on <code>127.0.0.1:${PORT}</code></p>
       <p>There's nothing to see here — the browser extension talks to this process,
          you don't. Leave it running while you apply for things.</p>
       <p>Endpoints: <code>POST /generate</code>, <code>POST /parse-resume</code>, <code>POST /docx</code>, <code>GET /health</code></p>
     </main>`
  );
});

const keyName = PROVIDER === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
if (!process.env[keyName]) {
  console.error(`Missing ${keyName}. Copy .env.example to .env and add your key.`);
  process.exit(1);
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`Cover Letter Copilot server on http://127.0.0.1:${PORT} (${PROVIDER})`);
  });
}
