/**
 * lib/observer/boardParser.ts
 *
 * Self-contained DOM parser for Ppomppu board rows.
 *
 * IMPORTANT: `parseBoardRows` must remain a plain function with no closures
 * over module-scoped variables. Playwright's `$$eval` serializes the function
 * body as a string to run inside the browser context, so any reference to an
 * external variable would be undefined at runtime in the browser.
 *
 * This file also exports the function so it can be unit-tested with mock DOM data
 * (e.g. via jsdom) without needing a live Playwright session.
 */

export type ParsedBoardRow = {
  title: string;
  author: string;
  date: string;
  dateTitle: string;
  views: number;
  parseConfidence: number;
  isNotice: boolean;
};

/**
 * Parse an array of board-row `<tr>` elements into structured post data.
 *
 * Uses a fallback selector chain for each field; earlier selectors are preferred
 * and yield a higher confidence score. Notice rows are detected by class name,
 * notice image, or body text.
 *
 * This function is designed to run both:
 *  - Inside the browser via `page.$$eval(BOARD_ROW_SELECTOR, parseBoardRows)`
 *  - In Node.js unit tests via jsdom mocks
 */
export function parseBoardRows(trs: Element[]): ParsedBoardRow[] {
  const output: Array<{
    title: string;
    author: string;
    date: string;
    dateTitle: string;
    views: number;
    parseConfidence: number;
    isNotice: boolean;
  }> = [];

  for (const tr of trs) {
    const titleSelectors = ['a.baseList-title .list_title', '.list_title', 'a.baseList-title', 'td:nth-child(3)'];
    const authorSelectors = ['a.baseList-name .list_name', 'span.list_name', '.list_name', 'td:nth-child(4)'];
    const dateSelectors = ['td[title] nobr', 'td[title]', 'td.eng.list_vspace nobr', 'td:nth-child(5)'];

    let title = '';
    let titleConfidence = 0;
    for (let i = 0; i < titleSelectors.length; i++) {
      const value = tr.querySelector(titleSelectors[i])?.textContent?.trim() || '';
      if (value) {
        title = value;
        titleConfidence = i === 0 ? 1 : 0.75;
        break;
      }
    }

    let author = '';
    let authorConfidence = 0;
    for (let i = 0; i < authorSelectors.length; i++) {
      const value = tr.querySelector(authorSelectors[i])?.textContent?.trim() || '';
      if (value) {
        author = value;
        authorConfidence = i === 0 ? 1 : 0.75;
        break;
      }
    }

    let date = '';
    let dateTitle = '';
    let dateConfidence = 0;
    for (let i = 0; i < dateSelectors.length; i++) {
      const el = tr.querySelector(dateSelectors[i]) as HTMLElement | null;
      const value = el?.textContent?.trim() || '';
      if (value) {
        date = value;
        dateTitle = el?.getAttribute('title')?.trim() || '';
        if (!dateTitle && el) {
          const nobr = el.querySelector('nobr');
          dateTitle = nobr?.getAttribute('title')?.trim() || '';
        }
        dateConfidence = i === 0 ? 1 : 0.75;
        break;
      }
    }

    let viewsText = '';
    let viewsConfidence = 0;
    const numericCandidates = Array.from(tr.querySelectorAll('td.eng.list_vspace, td.eng'))
      .map((td) => td.textContent?.replace(/[^\d]/g, '') || '')
      .filter((value) => value.length > 0);
    if (numericCandidates.length > 0) {
      viewsText = numericCandidates[numericCandidates.length - 1];
      viewsConfidence = 0.75;
    }

    const parsedViews = Number.parseInt(viewsText || '0', 10);
    const views = Number.isNaN(parsedViews) ? 0 : parsedViews;
    const parseConfidence = (titleConfidence + authorConfidence + dateConfidence + viewsConfidence) / 4;

    output.push({
      title,
      author,
      date,
      dateTitle,
      views,
      parseConfidence,
      isNotice:
        tr.className.toLowerCase().includes('notice') ||
        tr.querySelector('img[src*="notice"]') !== null ||
        (tr.textContent || '').includes('공지')
    });
  }

  return output;
}
