export function getRepoNameFromUrl(url: string): string | null {
  const parts = url.split('/')
  return parts.length ? parts.pop() || null : null
}
