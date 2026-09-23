// parseHtml — cheerio parse of the fetched page into the raw signals the
// 15 checks consume. No decisions made here: facts only.
// Spec ref: spec.md > Scanner > parseHtml.

import * as cheerio from 'cheerio';

export function parseHtml(html) {
  const $ = cheerio.load(html);

  const titleEl = $('title').first();
  const title = titleEl.length ? titleEl.text().trim() : null;

  const descEl = $('meta[name="description" i]').first();
  const metaDescriptionContent = descEl.length ? (descEl.attr('content') ?? '') : null;

  const hasViewport = $('meta[name="viewport" i]').length > 0;

  const images = $('img').map((_, el) => {
    const hasAlt = $(el).is('[alt]');
    return {
      src: $(el).attr('src') ?? null,
      hasAlt,
      altValue: hasAlt ? $(el).attr('alt') : null,
    };
  }).get();

  const headings = $('h1, h2, h3, h4, h5, h6')
    .map((_, el) => ({
      level: Number(el.tagName.replace('h', '')),
      text: $(el).text().trim(),
    }))
    .get();

  const htmlEl = $('html').first();
  const htmlLangPresent = htmlEl.length > 0 && htmlEl.is('[lang]');
  const htmlLang = htmlLangPresent ? (htmlEl.attr('lang') ?? '') : null;

  const canonicalPresent = $('link[rel="canonical" i]').length > 0;

  const iconLinksPresent =
    $('link[rel="icon" i], link[rel="shortcut icon" i]').length > 0;

  const metaRobotsContent =
    $('meta[name="robots" i]').first().attr('content') ?? null;

  const anchors = $('a')
    .map((_, el) => ({
      text: $(el).text().replace(/\s+/g, ' ').trim(),
      href: $(el).attr('href') ?? null,
      ariaLabel: $(el).attr('aria-label') ?? null,
      titleAttr: $(el).attr('title') ?? null,
    }))
    .get();

  return {
    title,
    metaDescriptionContent,
    hasViewport,
    images,
    headings,
    htmlLangPresent,
    htmlLang,
    canonicalPresent,
    iconLinksPresent,
    metaRobotsContent,
    anchors,
  };
}
