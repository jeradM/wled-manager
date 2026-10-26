export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    // Only declare JSON when there is a body: the server rejects an empty body labelled as JSON.
    headers: { ...(init?.body !== undefined ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? body.message ?? res.statusText);
  }
  // DELETE answers 204 with no body.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
