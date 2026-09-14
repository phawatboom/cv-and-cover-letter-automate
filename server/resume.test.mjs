import assert from 'node:assert/strict';
import { Document, Packer, Paragraph } from 'docx';

process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = 'test-only';

const { buildPrompt, extractResumeText, parseModelJson, sanitizeResumeProfile } = await import('./server.js');

const plainText = 'Jane Example\nEngineer\nExample Limited\n2022 - Present\n'.repeat(3);
assert.equal(
  await extractResumeText({
    name: 'resume.txt',
    type: 'text/plain',
    data: Buffer.from(plainText).toString('base64')
  }),
  plainText.trim()
);

const docx = new Document({ sections: [{ children: [new Paragraph('Jane Example'), new Paragraph('Platform Engineer')] }] });
const docxBuffer = await Packer.toBuffer(docx);
const docxText = await extractResumeText({
  name: 'resume.docx',
  type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  data: docxBuffer.toString('base64')
});
assert.match(docxText, /Jane Example/);
assert.match(docxText, /Platform Engineer/);

function onePagePdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

const pdfText = await extractResumeText({
  name: 'resume.pdf',
  type: 'application/pdf',
  data: onePagePdf('Jane Example PDF Resume').toString('base64')
});
assert.match(pdfText, /Jane Example PDF Resume/);

assert.deepEqual(parseModelJson('```json\n{"profile":{"firstName":"Jane"}}\n```'), {
  profile: { firstName: 'Jane' }
});

const sanitized = sanitizeResumeProfile({
  profile: {
    firstName: ' Jane ',
    email: 'jane@example.com',
    password: 'must-not-pass',
    workRights: 'must-not-be-inferred',
    arbitrary: 'must-not-pass'
  },
  work: [{ title: 'Engineer', company: 'Example', current: true, password: 'no' }],
  education: [{ qualification: 'BSc', school: 'Example University' }],
  languages: [{ language: 'English', proficiency: 'Fluent', secret: 'no' }]
}, plainText);

assert.deepEqual(sanitized.profile, { firstName: 'Jane', email: 'jane@example.com' });
assert.deepEqual(sanitized.work, [{ title: 'Engineer', company: 'Example', current: true }]);
assert.deepEqual(sanitized.education, [{ qualification: 'BSc', school: 'Example University' }]);
assert.deepEqual(sanitized.languages, [{ language: 'English', proficiency: 'Fluent' }]);
assert.equal(sanitized.resume, plainText);

const draftPrompt = buildPrompt({
  job: {
    site: 'fixture',
    title: 'Platform Engineer',
    company: 'Example Limited',
    description: 'Maintain a distributed payments platform and improve reliability.',
    url: 'https://example.test/job/123'
  },
  profile: {
    firstName: 'Jane',
    fullName: 'Jane Example',
    resume: 'Built and operated distributed services.',
    work: [{ title: 'Engineer', company: 'Previous Limited', summary: 'Improved service reliability.' }]
  },
  template: {
    maxWords: 220,
    tone: 'Direct and evidence-led.',
    skeleton: 'Match experience to the reliability requirement.',
    rules: 'Do not use an address block.'
  }
});
for (const expected of [
  'Platform Engineer',
  'Example Limited',
  'Maintain a distributed payments platform',
  'Built and operated distributed services',
  'Direct and evidence-led',
  'Match experience to the reliability requirement',
  'Do not use an address block',
  'at most 220 words'
]) assert.match(draftPrompt, new RegExp(expected));

/* The panel can carry a one-off instruction for a single letter. It has to
   reach the prompt, stay out of it when empty, and never displace the
   applicant facts the letter is built from. */
const jobFixture = {
  site: 'fixture',
  title: 'Platform Engineer',
  company: 'Example Limited',
  description: 'Maintain a distributed payments platform and improve reliability.',
  url: 'https://example.test/job/123'
};
const profileFixture = {
  fullName: 'Jane Example',
  resume: 'Built and operated distributed services.',
  work: [{ title: 'Engineer', company: 'Previous Limited' }]
};

const withNotes = buildPrompt({
  job: jobFixture,
  profile: profileFixture,
  notes: '  Mention my 417 working holiday visa and lead with the payments migration.  '
});
assert.match(withNotes, /Mention my 417 working holiday visa/, 'the instruction should reach the prompt');
assert.match(withNotes, /<this-application>/, 'it should be delimited as its own section');
assert.doesNotMatch(withNotes, /  Mention my 417/, 'it should be trimmed');
assert.match(withNotes, /Built and operated distributed services/, 'the resume still goes in alongside it');

const withoutNotes = buildPrompt({ job: jobFixture, profile: profileFixture });
assert.doesNotMatch(withoutNotes, /<this-application>/, 'no empty section when nothing was typed');

assert.doesNotMatch(buildPrompt({ job: jobFixture, profile: profileFixture, notes: '   ' }), /<this-application>/);
assert.doesNotMatch(buildPrompt({ job: jobFixture, profile: profileFixture, notes: 42 }), /<this-application>/);

/* A long paste is capped rather than allowed to crowd out the ad. */
const capped = buildPrompt({ job: jobFixture, profile: profileFixture, notes: 'x'.repeat(5000) });
assert.ok(!capped.includes('x'.repeat(2001)), 'per-letter instructions should be capped at 2000 characters');

console.log('resume import safety: ok');
