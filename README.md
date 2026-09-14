# Cover Letter Copilot

A local-first browser extension that fills repeat job-application details and drafts a cover letter from the job ad you are reading. It never submits an application. The drafting server runs on your machine by default, and can be [deployed to a host](#running-the-server-on-a-host) if you would rather not start it by hand.

## Setup

```bash
cd server
cp .env.example .env
npm install
npm start
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the `extension/` folder. Open the extension settings and save your profile before using **Fill this form**.

After updating the source, press **Reload** on the extension card in `chrome://extensions` and refresh any job tabs that were already open. A manifest version bump also lets newly added starter templates reach an install that already has templates saved — see [Templates](#templates).

## Running the server on a host

The default setup keeps everything on your machine. If you would rather not start a terminal before each application, the same server runs on any host that gives it a public URL — Railway, Fly, a VPS. The trade is real and worth stating: your résumé text and every job ad you draft against will travel to that host instead of staying on your computer.

One environment variable controls the difference. Setting `APP_TOKEN` switches the bind from `127.0.0.1` to `0.0.0.0` **and** makes `/generate`, `/parse-resume` and `/docx` require `Authorization: Bearer <token>`. Without it the server refuses to listen on a public interface at all, because an unauthenticated `/generate` spends your API balance for anyone who finds the URL.

Generate a token:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

On Railway: **New Project → Deploy from GitHub repo**, pick this repo, then in the service settings set **Root Directory** to `server` — the builder inspects the repository root, and without this it finds no application to build. `server/railway.json` supplies the start command and points the health check at `/health`, which stays unauthenticated so the platform can reach it. Add three variables — `ANTHROPIC_API_KEY`, `APP_TOKEN`, and `PROVIDER` if you are not using Anthropic — then generate a domain under **Settings → Networking**. Leave `PORT` alone; the platform sets it.

Then in the extension settings, under **Drafting server**, put the public address in **Address** and the same token in **Access token**. `https://*.up.railway.app/*` is already in the manifest; a custom domain needs adding there before Chrome will let the extension reach it.

Two things to expect from a hosted deployment. Résumé import needs the PDF path, which pulls in `@napi-rs/canvas` — it ships prebuilt Linux binaries, but it is the dependency most likely to need attention if a build fails. And if the platform sleeps idle deployments, the first draft after a quiet spell waits for a cold start.

The access token is deliberately left out of the settings export: that file is meant to be portable, and a credential that spends money does not belong in one. Retype it after a restore.

## Résumé import and review

**Choose résumé**, at the top of the settings page, turns a résumé file into a filled-in profile:

1. Choose a PDF, DOCX, TXT, or MD file up to 8 MB.
2. The local server extracts its text. Text-based PDFs are supported; scanned image-only PDFs need OCR or conversion first.
3. The extracted text is sent to the Anthropic or OpenAI provider configured in `server/.env`, which returns suggested contact, work, education, and language fields.
4. Review every suggestion. New values are selected by default; conflicts with existing settings and duplicate history entries are unchecked.
5. **Apply selected to form**, inspect the normal settings fields, and press **Save settings**.
6. On a job application, **Fill this form** applies those saved settings but never submits the application.

The server and settings page both enforce field allowlists. Résumé parsing cannot suggest passwords, work-rights assumptions, demographic data, salary, consent answers, or arbitrary storage keys. The original extracted text can be saved in the résumé field for cover-letter drafting, but replacing existing résumé text requires an explicit selection.

## Drafting a cover letter

When you press **Write draft** on a job page, the extension sends one deliberate bundle through the local server: the captured job title/company/description, your saved profile and résumé, and the currently selected template's word limit, voice, paragraph structure, and extra rules. The model is instructed to use only facts in that applicant bundle, and to separate paragraphs with a blank line — the same convention **Save file** relies on to split the letter into `.docx` paragraphs. The resulting draft is shown for review and is never submitted automatically.

## Templates

Templates answer *how the letter reads* — word limit, voice, paragraph structure, extra rules — independently of the job site. Six ship as starting points:

| Template | Built for |
|---|---|
| Engineering-first | Software roles generally — web, full-stack, backend. Leads with what was built and shipped. |
| AI / ML-first | Leads with the model or data decision, not AI enthusiasm; bans hype language. |
| Data-first | Leads with the decision an analysis drove, not the tooling used to drive it. |
| Consulting-first | Reads as a compressed case: situation, action, measurable outcome. |
| Finance-first | Measured and analytical; every claim defensible in an interview. |
| General-purpose | For roles that don't fit a technical or business lane — early-career, career-change, generalist. |

Edit any of them, or add your own, from the **Templates** section of settings: name, word limit, voice, a one-line-per-paragraph structure, and extra rules. Pick per application from the dropdown in the panel.

New templates added to a future version reach an install that already has templates saved via an additive merge keyed by template `id`, triggered by `chrome.runtime.onInstalled`'s `"update"` event on a manifest version bump. It only *adds* templates you don't already have — it never touches one you've edited, even if you started from a built-in and rewrote it.

## What autofill fills

- Legal, preferred, and split names; honorific prefix and suffix
- Email and whole or split phone controls, including country code and extension
- One-line or multiline street addresses, district/county, city, state/province, postcode, country name, and country code
- LinkedIn, GitHub, portfolio/website, X/Twitter, Facebook, and Skype
- Current employer/title, work rights, sponsorship, relocation, driving licence, notice period, availability date, salary/currency, and application source
- Visible repeated work, education, and language records, indexed in page order
- Text inputs, textareas, contenteditable controls, native selects, checkboxes, radio groups, and exact-match autocomplete widgets

Dates are converted when a control declares a machine format (`date`, `month`, or a recognizable `DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY-MM-DD`, `MM/YYYY`, or `YYYY-MM` placeholder). Scoped HTML autocomplete values such as `section-applicant home given-name` are understood by reading the final field token.

For country, school, company, and similar suggestion widgets, the extension only clicks an exact normalized option. If text was typed but no exact suggestion appeared, the field flashes red and the panel tells you to choose the option. It does not guess a near match.

Field matching inside a work/education/language record also requires the label to look like a field ("From", "Company", "To") rather than a full sentence sharing the same words — a screening question like *"Is it OK to contact this employer?"* contains both "to" and "employer" but is left for you rather than being claimed by the end-date or company-name rule.

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

These are not just unsupported; they are explicitly protected from generic label, input-type, and autocomplete matching. Existing non-empty values are also preserved, and it never proactively unchecks a checkbox — a pre-checked box whose real meaning is "no" is left for you rather than guessed at.

## Site coverage

The panel loads automatically on SEEK, Indeed, Workday, SmartRecruiters, Greenhouse, Lever, Ashby, Workable, Teamtailor, Recruitee, Jobvite, iCIMS, Taleo, SuccessFactors, Oracle Cloud, BambooHR, JazzHR/ApplyToJob, Personio, ADP Workforce Now, UKG/UltiPro, Dayforce, Rippling, Breezy, Pinpoint, Comeet, ApplicantPro, Paylocity, and Zoho Recruit hosts declared in the manifest. On another HTTPS job site, click the extension toolbar button to inject it for that tab — this uses the temporary `activeTab` permission rather than requesting standing read access to every site you visit.

Job extraction prefers structured `JobPosting` JSON-LD, then known site selectors, then conservative generic selectors. Apply pages are detected separately so a large application form is not accidentally saved as the job description; the previously captured ad is carried across instead.

The scanner follows nested **open** shadow roots and accessible iframes. Browser security makes closed shadow roots and cross-origin frames without host permission inaccessible. For a cover-letter control that cannot be located, use **Point at the box**; its shadow-aware path is stored per hostname.

## Reports

After filling, the panel separates:

- filled fields;
- saved values that were skipped because the page already contained a value or your profile lacked the fact;
- typed autocomplete values that still need an exact dropdown selection;
- protected questions left for you; and
- unmatched visible fields.

This distinction is intentional: "unmatched" does not mean your profile is empty, and "protected" does not mean the extension failed.

## Backup and portability

Chrome ties an unpacked extension's storage to the absolute path of the folder you loaded — move or rename the project folder, or load it from a different Chrome profile, and it looks like every saved setting vanished. It hasn't; it's tied to the old path.

The **Backup** section of settings guards against this:

- **Export to file** downloads a JSON snapshot of your profile, résumé, templates, default template, and any custom "Point at the box" field paths.
- **Import from file** replaces current settings with a chosen backup, after confirmation. It accepts both its own export format and a hand-edited bare settings object. A backup with an empty or malformed template list, or a missing profile, leaves the corresponding existing data alone rather than wiping it.

The export deliberately excludes the last-captured job ad — that's a cache, not a setting — and never includes the API key, which lives only in `server/.env` and is never sent to the extension. Keep an exported copy somewhere outside the project folder; restoring from it after moving folders or profiles is a ten-second job.

## Validation

Run the dependency-free regression fixtures with:

```bash
node --test extension/tests/
cd server && npm test
```

The fixtures cover scoped autocomplete tokens, applicant-vs-reference context, protected questions, phone-control disambiguation, exact repeated-record indexing, narrow current-record checkboxes, salary-vs-currency labels, date/phone conversions, and screening questions that share vocabulary with real field labels ("to", "employer") without being claimed by them. All extension JavaScript can also be syntax-checked with `node --check`.

## Limits

No extension can promise that every future application form will always work: ATS markup changes, custom questions have company-specific meaning, some components hide controls in closed shadow roots, and some forms require user interaction to create or validate a record. This extension chooses visible failure over a confident wrong answer. The toolbar injection, generic structured-data adapter, deep scanner, exact-choice rules, and field report are the fallback layers when a named ATS changes.

A checkbox whose real meaning is the opposite of "checked" (e.g. a pre-checked opt-in that should read "no") is never auto-unchecked, since the extension can't safely infer that polarity — leave those for manual review.

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
    options.html
    options.js
  tests/
    autofill.test.cjs
    schema.test.cjs
server/
  server.js
  resume.test.mjs
  railway.json
  .env.example
```
