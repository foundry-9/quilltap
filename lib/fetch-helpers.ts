/**
 * Safely parse a JSON response, handling cases where the server returns HTML error pages
 */
export async function safeJsonParse<T = unknown>(response: Response): Promise<T> {
  const text = await response.text()

  try {
    return JSON.parse(text) as T
  } catch {
    // If parsing fails, the server likely returned HTML (error page)
    if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
      throw new Error(`Server error (${response.status}): Unexpected HTML response`)
    }
    throw new Error(`Failed to parse response: ${text.substring(0, 100)}`)
  }
}

/**
 * Fetch JSON with safe error handling
 * Properly handles cases where the server returns HTML error pages
 */
export async function fetchJson<T = unknown>(
  url: string,
  options?: RequestInit
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  try {
    const response = await fetch(url, options)
    const data = await safeJsonParse<T>(response)

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: (data as { error?: string })?.error || `Request failed with status ${response.status}`,
      }
    }

    return { ok: true, status: response.status, data }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : 'Network error',
    }
  }
}
