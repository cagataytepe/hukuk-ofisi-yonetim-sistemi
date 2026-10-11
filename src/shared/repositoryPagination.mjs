export const REPOSITORY_PAGE_SIZE = 1000;

export async function collectPaginatedRows(fetchPage, pageSize = REPOSITORY_PAGE_SIZE) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    if (!Array.isArray(page)) throw new TypeError("Sayfalama sorgusu bir dizi döndürmelidir.");
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export function chunkValues(values, size = 200) {
  if (!Array.isArray(values) || !values.length) return [];
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}
