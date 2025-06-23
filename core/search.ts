import sql from "../lib/sql"

interface SearchResult {
  id: string
  title: string
  url: string
  description: string
  rank: number
}

/**
 * Builds an OR-combined tsquery like:
 *   postgres:* | full:* | text:* | search:*
 */
function buildTsQuery(q: string): string {
  return q
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(piko => `${piko}:*`)
    .join(' | ');
}

export const search = async (q: string): Promise<SearchResult[]> => {
  const tsQuery = buildTsQuery(q);

  const results = await sql`
    WITH query AS (
      SELECT to_tsquery('english', ${tsQuery}) AS q
    )
    SELECT p.id, p.title, p.url, p.description,
           ts_rank(p.search_vector, q) AS rank
    FROM pages p, query
    WHERE p.search_vector @@ q
       OR p.title ILIKE '%' || ${q} || '%'
       OR p.description ILIKE '%' || ${q} || '%'
       OR p.url ILIKE '%' || ${q} || '%'
    ORDER BY rank DESC
    LIMIT 20;
  `;

  return results.slice(0, 10) as unknown as SearchResult[];
}
