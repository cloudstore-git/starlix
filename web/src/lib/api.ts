import { getConfig } from './config';
import { idToken } from './auth';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await idToken();
  const res = await fetch(getConfig().apiUrl + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, data?.message ?? `Request failed (${res.status})`);
  return data as T;
}

export const get = <T = any>(path: string) => api<T>('GET', path);
export const post = <T = any>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});
export const put = <T = any>(path: string, body?: unknown) => api<T>('PUT', path, body ?? {});
export const del = <T = any>(path: string) => api<T>('DELETE', path);

export function qs(params: Record<string, string | number | undefined | null>) {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? '?' + p.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&') : '';
}

/** Uploads a file to S3 through a presigned URL and returns the stored reference. */
export async function uploadFile(file: File): Promise<{ key: string; name: string }> {
  const { key, name, url } = await post<{ key: string; name: string; url: string }>('/files/upload-url', {
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
  });
  const res = await fetch(url, { method: 'PUT', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } });
  if (!res.ok) throw new Error(`Upload failed for ${file.name}`);
  return { key, name };
}

export async function openFile(key: string) {
  const { url } = await get<{ url: string }>(`/files/download-url${qs({ key })}`);
  window.open(url, '_blank', 'noopener');
}
