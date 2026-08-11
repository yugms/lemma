/**
 * Structured data, as a `<script type="application/ld+json">`.
 *
 * Two things about this are easy to get wrong and silent when you do.
 *
 * The nonce is not optional. `script-src` is `'self' 'nonce-…' 'strict-dynamic'`
 * with no `'unsafe-inline'`, and CSP governs `<script>` elements by *element*,
 * not by MIME type — a JSON-LD block is as blocked as an executable one. It
 * fails invisibly: the page renders, the markup simply is not there, and only a
 * console violation or a validator says so.
 *
 * The `<` escape is Next's own prescription for this pattern. Nothing here is
 * user-authored today, but a JSON string containing `</script>` closes the tag
 * it is sitting inside, and `<` is the same JSON to any parser.
 */
export function JsonLd({ data, nonce }: { data: object; nonce: string | null }) {
  return (
    <script
      type="application/ld+json"
      nonce={nonce ?? undefined}
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

/**
 * Who runs the site and what the site is — the two every page carries.
 *
 * Kept to claims the pages actually support. There is no `FAQPage` here because
 * there is no FAQ: the homepage's three steps are a how-it-works sequence, not
 * questions and answers, and marking them up as an FAQ is how a site earns a
 * manual action rather than a rich result. Same reason there is no `Course` —
 * lemma generates practice, it does not run a course with a provider and an
 * instructor.
 */
export function siteGraph(siteUrl: string, description: string) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        url: siteUrl,
        name: "lemma",
        description,
        inLanguage: "en",
        publisher: { "@id": `${siteUrl}/#org` },
      },
      {
        "@type": "Organization",
        "@id": `${siteUrl}/#org`,
        name: "lemma",
        url: siteUrl,
        logo: `${siteUrl}/icon.svg`,
      },
    ],
  };
}

/** The homepage additionally describes the thing itself. */
export function appGraph(siteUrl: string, description: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "@id": `${siteUrl}/#app`,
    name: "lemma",
    url: siteUrl,
    description,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Any",
    inLanguage: "en",
    isAccessibleForFree: true,
    // Stated rather than implied: "free" with no offer attached reads to a
    // parser as an unknown price, not as zero.
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    featureList: [
      "Custom math problem sets by course, topic, difficulty and format",
      "Every problem independently re-solved before it is served",
      "Step-by-step worked solutions",
      "Practice from your own worksheets, notes or PDFs",
      "Printable worksheets and photo-scanned marking",
    ],
    publisher: { "@id": `${siteUrl}/#org` },
  };
}
