# Cover Letter Copilot

A local-first browser extension that fills repeat job-application details and drafts a cover letter from the job ad you are reading. It never submits an application.

## Setup

```bash
cd server
cp .env.example .env
npm install
npm start
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the `extension/` folder. Open the extension settings and save your profile before using **Fill this form**.

After updating the source, press **Reload** on the extension card in `chrome://extensions` and refresh any job tabs that were already open.

## Résumé import and review

Version 0.7 adds a **Choose résumé** flow at the top of the settings page:

1. Choose a PDF, DOCX, TXT, or MD file up to 8 MB.
2. The local server extracts its text. Text-based PDFs are supported; scanned image-only PDFs need OCR or conversion first.
3. The extracted text is sent to the Anthropic or OpenAI provider configured in `server/.env`, which returns suggested contact, work, education, and language fields.
4. Review every suggestion. New values are selected by default; conflicts with existing settings and duplicate history entries are unchecked.
5. **Apply selected to form**, inspect the normal settings fields, and press **Save settings**.
6. On a job application, **Fill this form** applies those saved settings but never submits the application.

The server and settings page both enforce field allowlists. Résumé parsing cannot suggest passwords, work-rights assumptions, demographic data, salary, consent answers, or arbitrary storage keys. The original extracted text can be saved in the résumé field for cover-letter drafting, but replacing existing résumé text requires an explicit selection.

When you press **Write draft** on a job page, the extension sends one deliberate bundle through the local server: the captured job title/company/description, your saved profile and résumé, and the currently selected template's word limit, voice, paragraph structure, and extra rules. The model is instructed to use only facts in that applicant bundle. The resulting draft is shown for review and is never submitted automatically.

## What version 0.7 fills

- Legal, preferred, and split names; honorific prefix and suffix
- Email and whole or split phone controls, including country code and extension
- One-line or multiline street addresses, district/county, city, state/province, postcode, country name, and country code
- LinkedIn, GitHub, portfolio/website, X/Twitter, Facebook, and Skype
- Current employer/title, work rights, sponsorship, relocation, driving licence, notice period, availability date, salary/currency, and application source
- Visible repeated work, education, and language records, indexed in page order
- Text inputs, textareas, contenteditable controls, native selects, checkboxes, radio groups, and exact-match autocomplete widgets

Dates are converted when a control declares a machine format (`date`, `month`, or a recognizable `DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY-MM-DD`, `MM/YYYY`, or `YYYY-MM` placeholder). Scoped HTML autocomplete values such as `section-applicant home given-name` are understood by reading the final field token.

For country, school, company, and similar suggestion widgets, the extension only clicks an exact normalized option. If text was typed but no exact suggestion appeared, the field flashes red and the panel tells you to choose the option. It does not guess a near match.

## Repeatable sections

The extension fills repeatable editors that are already visible. The first visible work editor maps to the first saved role, the second to the second saved role, and so on; education and language work the same way. It supports the SmartRecruiters experience and education forms shown in the issue, including title, company/institution, office or school location, descriptions, dates, major, degree, and narrowly labelled current-role/current-study checkboxes.

It deliberately does not click **Add**, **Save**, **Next**, or **Submit**. Open the number of records you want first, run **Fill this form**, review the green/red outlines, then save each section yourself.

## Safety boundaries

The extension leaves these for the applicant:

- Race, ethnicity, gender, pronouns, disability, veteran status, religion, marital status, pregnancy, and other diversity/EEOC questions
- Date of birth, age, criminal-history disclosures, government IDs, passport/tax identifiers, banking/card data, signatures, passwords, privacy/consent, and terms acceptance
- Referee/reference, emergency-contact, guardian, spouse, supervisor, and witness details
- Resume and other file uploads
- Unrecognized custom screening questions

These are not just unsupported; they are explicitly protected from generic label, input-type, and autocomplete matching. Existing non-empty values are also preserved.

## Site coverage

The panel loads automatically on SEEK, Indeed, Workday, SmartRecruiters, Greenhouse, Lever, Ashby, Workable, Teamtailor, Recruitee, Jobvite, iCIMS, Taleo, SuccessFactors, Oracle Cloud, BambooHR, JazzHR/ApplyToJob, Personio, ADP Workforce Now, UKG/UltiPro, Dayforce, Rippling, Breezy, Pinpoint, Comeet, ApplicantPro, Paylocity, and Zoho Recruit hosts declared in the manifest. On another HTTPS job site, click the extension toolbar button to inject it for that tab.

Job extraction prefers structured `JobPosting` JSON-LD, then known site selectors, then conservative generic selectors. Apply pages are detected separately so a large application form is not accidentally saved as the job description; the previously captured ad is carried across instead.

The scanner follows nested **open** shadow roots and accessible iframes. Browser security makes closed shadow roots and cross-origin frames without host permission inaccessible. For a cover-letter control that cannot be located, use **Point at the box**; its shadow-aware path is stored per hostname.

## Reports

After filling, the panel separates:

- filled fields;
- saved values that were skipped because the page already contained a value or your profile lacked the fact;
- typed autocomplete values that still need an exact dropdown selection;
- protected questions left for you; and
- unmatched visible fields.

This distinction is intentional: “unmatched” does not mean your profile is empty, and “protected” does not mean the extension failed.

## Validation

Run the dependency-free regression fixtures with:

```bash
node extension/tests/autofill.test.cjs
node extension/tests/schema.test.cjs
cd server && npm test
```

The fixtures cover scoped autocomplete tokens, applicant-vs-reference context, protected questions, phone-control disambiguation, exact repeated-record indexing, narrow current-record checkboxes, salary-vs-currency labels, and date/phone conversions. All extension JavaScript can also be syntax-checked with `node --check`.

## Limits

No extension can promise that every future application form will always work: ATS markup changes, custom questions have company-specific meaning, some components hide controls in closed shadow roots, and some forms require user interaction to create or validate a record. This extension chooses visible failure over a confident wrong answer. The toolbar injection, generic structured-data adapter, deep scanner, exact-choice rules, and field report are the fallback layers when a named ATS changes.

The API key stays in the local server. Draft generation is restricted to facts in the saved profile and resume, but every draft still needs human review.

## Layout

```text
extension/
  manifest.json
  background.js
  content/
    dom.js
    adapters.js
    autofill.js
    panel.js
    main.js
  options/
  tests/
server/
```
