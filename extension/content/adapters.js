/* Site adapters. Each one answers three questions:
     - Am I on a job ad I can read?           capture()
     - Am I on an application form?           isApplyPage()
     - Where does the letter go?              findField() / delivery

   Extraction selectors live here and nowhere else. When a site ships a
   redesign, this is the only file that should need touching. */
(function () {
  const CLC = window.CLC;
  const { textOf, queryFirst, findLabelledField } = CLC;

  const COVER_RE = /cover\s*letter|covering\s*letter|why.*(you|interested)|message.*hiring|interest(?:ed)?\s+(?:in\s+)?working\s+(?:here|there)/i;

  function structuredJob() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(script.textContent);
        const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
        while (queue.length) {
          const item = queue.shift();
          if (!item || typeof item !== 'object') continue;
          if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
          const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
          if (!types.includes('JobPosting')) continue;
          const holder = item.hiringOrganization || {};
          const html = String(item.description || '');
          const doc = new DOMParser().parseFromString(html, 'text/html');
          return {
            title: item.title || '',
            company: typeof holder === 'string' ? holder : holder.name || '',
            description: (doc.body.innerText || doc.body.textContent || '').trim(),
            url: item.url || location.href
          };
        }
      } catch (e) {}
    }
    return null;
  }

  function looksLikeApplyPage() {
    if (/apply|application|oneclick|candidate/i.test(location.pathname)) return true;
    const fields = CLC.queryAllDeep('input, select, textarea').filter(CLC.isVisible);
    return fields.length >= 4 && fields.some((el) => /resume|cover|first\s*name|e-?mail/i.test(CLC.describeField(el)));
  }

  function siteLabel() {
    const host = location.hostname;
    if (/smartrecruiters/.test(host)) return 'SmartRecruiters';
    if (/greenhouse/.test(host)) return 'Greenhouse';
    if (/lever\.co$/.test(host)) return 'Lever';
    if (/ashbyhq/.test(host)) return 'Ashby';
    if (/workable/.test(host)) return 'Workable';
    if (/teamtailor/.test(host)) return 'Teamtailor';
    if (/recruitee/.test(host)) return 'Recruitee';
    return 'this page';
  }

  const seek = {
    id: 'seek',
    label: 'SEEK',
    delivery: 'textarea',
    /* SEEK runs several domains: seek.com.au, the older seek.co.nz, and
       nz.seek.com, which is what SEEK NZ actually serves now. Miss one and the
       content script simply never loads there. */
    matches: () => /(^|\.)seek\.(com|com\.au|co\.nz)$/.test(location.hostname),
    isApplyPage: () => /\/apply/.test(location.pathname),
    jobId: () => (location.pathname.match(/\/job\/(\d+)/) || [])[1],
    jobUrl() {
      const id = this.jobId();
      return id ? `${location.origin}/job/${id}` : null;
    },
    capture() {
      const title =
        textOf(['[data-automation="job-detail-title"]', '[data-automation="jobTitle"]', 'h1']) || '';
      const company =
        textOf(['[data-automation="advertiser-name"]', '[data-automation="jobCompany"]']) || '';
      const description = textOf(['[data-automation="jobAdDetails"]', '[data-automation="jobDescription"]']);
      return { site: 'seek', title, company, description, url: this.jobUrl() || location.href };
    },
    /* The apply page hides the ad behind "View job description". If it's
       collapsed, open it rather than fetching the ad again. */
    async reveal() {
      const link = Array.from(document.querySelectorAll('a, button')).find((el) =>
        /view job description/i.test(el.innerText || '')
      );
      if (link) {
        link.click();
        await CLC.waitFor(() => queryFirst(['[data-automation="jobAdDetails"]']), { timeout: 4000 });
      }
    },
    /* Selectors used when re-parsing the ad page fetched in the background. */
    parseSelectors: {
      title: ['[data-automation="job-detail-title"]', 'h1'],
      company: ['[data-automation="advertiser-name"]'],
      description: ['[data-automation="jobAdDetails"]']
    },
    findField: () => findLabelledField(COVER_RE)
  };

  const indeed = {
    id: 'indeed',
    label: 'Indeed',
    delivery: 'textarea',
    matches: () => /indeed\.com$/.test(location.hostname),
    isApplyPage: () => /smartapply|applystart|viewjob.*\/apply/.test(location.hostname + location.pathname),
    jobId: () => new URLSearchParams(location.search).get('jk'),
    capture() {
      const title = textOf([
        '[data-testid="jobsearch-JobInfoHeader-title"]',
        '.jobsearch-JobInfoHeader-title',
        'h1'
      ]);
      const company = textOf([
        '[data-testid="inlineHeader-companyName"]',
        '[data-company-name="true"]',
        '.jobsearch-CompanyInfoContainer a'
      ]);
      const description = textOf(['#jobDescriptionText', '[data-testid="jobDescriptionText"]']);
      return { site: 'indeed', title, company, description, url: location.href };
    },
    parseSelectors: {
      title: ['[data-testid="jobsearch-JobInfoHeader-title"]', 'h1'],
      company: ['[data-testid="inlineHeader-companyName"]'],
      description: ['#jobDescriptionText']
    },
    findField: () => findLabelledField(COVER_RE)
  };

  const workday = {
    id: 'workday',
    label: 'Workday',
    /* Most Workday tenants take a cover letter as an *attachment*, not a
       textarea. Some enable a free-text "Cover Letter" question; we look for
       one and fall back to producing a file to upload. */
    delivery: 'file-or-textarea',
    matches: () => /myworkdayjobs\.com$|myworkdaysite\.com$/.test(location.hostname),
    isApplyPage: () => /\/apply/i.test(location.pathname),
    capture() {
      const title = textOf([
        '[data-automation-id="jobPostingHeader"]',
        '[data-automation-id="jobTitle"]',
        'h1'
      ]);
      /* Workday doesn't print the employer name — the tenant is the subdomain. */
      const tenant = location.hostname.split('.')[0].replace(/[-_]/g, ' ');
      const company = textOf(['[data-automation-id="company"]']) || tenant;
      const description = textOf([
        '[data-automation-id="jobPostingDescription"]',
        '[data-automation-id="richTextArea"]'
      ]);
      return { site: 'workday', title, company, description, url: location.href };
    },
    parseSelectors: {
      title: ['[data-automation-id="jobPostingHeader"]', 'h1'],
      company: ['[data-automation-id="company"]'],
      description: ['[data-automation-id="jobPostingDescription"]']
    },
    findField: () => findLabelledField(COVER_RE),
    hasUploadZone: () =>
      !!queryFirst([
        '[data-automation-id="file-upload-drop-zone"]',
        '[data-automation-id="select-files"]'
      ])
  };

  /* Reached on any site you inject into from the toolbar button. Extraction is
     crude by necessity, but "Point at the box" and autofill both work here,
     which is the point — it's the escape hatch for the ATS nobody wrote an
     adapter for. */
  const generic = {
    id: 'generic',
    get label() { return siteLabel(); },
    delivery: 'textarea',
    matches: () => true,
    isApplyPage: () => looksLikeApplyPage(),
    /* Now also the path for SmartRecruiters, Greenhouse and Lever. These are
       guesses at common markup rather than selectors confirmed per site, so
       every list ends in a fallback and the description falls back to page
       text. Autofill and "Point at the box" work here either way. */
    capture() {
      const structured = structuredJob();
      if (structured && structured.description) return { site: 'generic', ...structured };
      const apply = looksLikeApplyPage();
      return {
        site: 'generic',
        title: textOf(['h1', '[class*="job-title"]', '[class*="jobTitle"]', '[data-test*="title"]']),
        company: textOf([
          '[itemprop="hiringOrganization"]',
          '[class*="company-name"]',
          '[class*="companyName"]'
        ]),
        description: apply ? '' :
          textOf([
            '[itemprop="description"]',
            '[class*="job-description"]',
            '[class*="jobDescription"]',
            '[data-test*="description"]',
            '[class*="posting-content"]',
            'article',
            'main'
          ]) || document.body.innerText.slice(0, 12000),
        url: location.href
      };
    },
    findField: () => findLabelledField(COVER_RE)
  };

  CLC.adapters = [seek, indeed, workday, generic];
  CLC.pickAdapter = () => CLC.adapters.find((a) => a.matches());
  CLC.COVER_RE = COVER_RE;
})();
