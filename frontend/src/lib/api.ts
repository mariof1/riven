export type ApiError = {
	status: number;
	message: string;
	body?: unknown;
};

function extractDetail(body: unknown): string | null {
	if (typeof body !== 'object' || body === null) return null;
	if (!('detail' in body)) return null;
	const detail = (body as { detail?: unknown }).detail;
	return detail === undefined ? null : String(detail);
}

export function toQueryString(params: Record<string, string | number | boolean | undefined | null>) {
	const searchParams = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v === undefined || v === null || v === '') continue;
		searchParams.set(k, String(v));
	}
	const qs = searchParams.toString();
	return qs ? `?${qs}` : '';
}

export async function apiGet<T>(path: string): Promise<T> {
	const res = await fetch(path);
	if (!res.ok) {
		let body: unknown = undefined;
		try {
			body = await res.json();
		} catch {
			// ignore
		}
		const message = extractDetail(body) ?? res.statusText;
		throw { status: res.status, message, body } satisfies ApiError;
	}
	return (await res.json()) as T;
}

export type ItemsResponse = {
	success: boolean;
	items: Array<Record<string, unknown>>;
	page: number;
	limit: number;
	total_items: number;
	total_pages: number;
};

export function apiV1(path: string) {
	return `/api/v1${path.startsWith('/') ? path : `/${path}`}`;
}
