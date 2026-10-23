# Engineering Case Study: Cover Letter Copilot

## Problem

Job applications repeat structured personal details across different web forms. Drafting a tailored cover letter also requires combining the applicant's evidence with a job advertisement without inventing accomplishments.

## Solution and boundaries

A browser extension collects user-selected application details and requests drafting from a Node.js server. The extension fills fields but **does not submit applications**. A local server is the default, keeping the HTTP interface bound to `127.0.0.1` unless explicitly configured for hosting.

```text
Applicant
  | configure personal profile / review suggestions
  v
Browser extension
  | job advert + selected profile/resume + instructions
  v
Node.js drafting server (local by default)
  | structured request / provider call
  v
Configured AI provider
  | draft
  v
Browser extension -> review, edit, save
```

## Important design choices

| Decision | Benefit | Trade-off |
| --- | --- | --- |
| Local-first server | Reduces exposure of the local HTTP interface | Users need to run a local service |
| Bearer token when hosted | Protects endpoints that could spend API credits | Static tokens need safe handling and rotation |
| Field allowlist for resume parsing | Blocks uncontrolled suggestions for sensitive or unrelated fields | Additional profile fields require deliberate schema changes |
| Human review before use | Avoids automated submission and gives users control | Not a zero-click workflow |
| Explicit statement of hosting privacy implications | Helps users understand where resume and job content travel | Hosted processing introduces additional privacy exposure |

These choices are described in the [main README](../README.md). Authentication alone does **not** guarantee protection against excessive usage, leaked tokens, prompt injection, or other abuse.

## Tests currently visible

The [server test file](../server/resume.test.mjs) exercises resume extraction, including TXT, DOCX and a generated text-based PDF, as well as parsing and field sanitization cases. This document does not claim a complete security test suite.

## Recommended next tests

1. Deny requests without a valid bearer token in hosted mode, including all spending endpoints.
2. Apply request-size limits and confirm malformed PDFs, DOCX files and provider responses fail safely.
3. Add explicit cost or request budgets and rate limiting; verify a leaked client token cannot generate unbounded charges.
4. Test malicious job-ad instructions and unwanted additions to applicant facts.
5. Verify that imported resume content cannot modify credential or consent fields.
6. Test network failures, provider timeouts, and cancellation without double-billing where applicable.

## What this demonstrates

This project is not simply an AI wrapper. Its key engineering questions are about trust boundaries, user control, data extraction, server deployment, and safely integrating metered third-party APIs.

## Portfolio walkthrough

For a technical interview, demonstrate the local setup, profile import, user review, draft generation and a failure case. Explain why a public unauthenticated endpoint is unsafe, what the token mechanism prevents, and which controls still need implementation.
