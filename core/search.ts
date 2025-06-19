import sql from "../lib/sql"

interface SearchResult {
  id: string
  title: string
  url: string
  description: string
  rank: number
}

export const search = async (q: string): Promise<SearchResult[]> => {
  const results = await sql`
SELECT p.id, p.title, p.url, p.description,
         ts_rank(p.search_vector, websearch_to_tsquery('english', ${q})) AS rank
  FROM pages p
  WHERE p.search_vector @@ websearch_to_tsquery('english', ${q})
     OR p.title ILIKE '%' || ${q} || '%'
     OR p.description ILIKE '%' || ${q} || '%'
     OR p.url ILIKE '%' || ${q} || '%'
  ORDER BY rank DESC
  LIMIT 20
`
  return results.filter((_, index) => index <= 9) as unknown as SearchResult[]
}
