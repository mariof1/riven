export type ApiError = {
	status: number;
	message: string;
	body?: unknown;
};

const API_KEY_STORAGE_KEY = 'riven.apiKey';

function extractDetail(body: unknown): string | null {
	if (typeof body !== 'object' || body === null) return null;
	if (!('detail' in body)) return null;
	const detail = (body as { detail?: unknown }).detail;
	return detail === undefined ? null : String(detail);
}

type Primitive = string | number | boolean;
type QueryValue = Primitive | undefined | null | '' | Array<Primitive>;

export function toQueryString(params: Record<string, QueryValue>) {

	const searchParams = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v === undefined || v === null || v === '') continue;
		if (Array.isArray(v)) {
			for (const item of v) {
				if (item === '') continue;
				searchParams.append(k, String(item));
			}
			continue;
		}
		searchParams.set(k, String(v));
	}
	const qs = searchParams.toString();
	return qs ? `?${qs}` : '';
}

export function getStoredApiKey(): string | null {
	try {
		const v = localStorage.getItem(API_KEY_STORAGE_KEY);
		return v && v.trim() ? v.trim() : null;
	} catch {
		return null;
	}
}

export function setStoredApiKey(value: string | null) {
	try {
		if (!value || !value.trim()) {
			localStorage.removeItem(API_KEY_STORAGE_KEY);
			return;
		}
		localStorage.setItem(API_KEY_STORAGE_KEY, value.trim());
	} catch {
		// ignore
	}
}

async function apiFetchJson<T>(path: string, init?: RequestInit): Promise<T> {
	const apiKey = getStoredApiKey();
	const headers = new Headers(init?.headers);
	if (apiKey) headers.set('x-api-key', apiKey);

	const res = await fetch(path, {
		...init,
		headers
	});

	const contentType = res.headers.get('content-type') ?? '';
	const isJson = contentType.includes('application/json');

	let body: unknown = undefined;
	try {
		body = isJson ? await res.json() : await res.text();
	} catch {
		// ignore
	}

	if (!res.ok) {
		const message = extractDetail(body) ?? res.statusText;
		throw { status: res.status, message, body } satisfies ApiError;
	}

	return body as T;
}

export async function apiGet<T>(path: string): Promise<T> {
	return await apiFetchJson<T>(path);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
	return await apiFetchJson<T>(path, {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}

export type ItemsResponse = {
	success: boolean;
	items: Array<MediaItemSummary>;
	page: number;
	limit: number;
	total_items: number;
	total_pages: number;
};

export type MediaItemSummary = {
	id: string;
	title: string | null;
	poster_path: string | null;
	type: 'movie' | 'show' | 'season' | 'episode' | string;
	parent_title: string | null;
	season_number: number | null;
	episode_number: number | null;
	imdb_id: string | null;
	tvdb_id: string | null;
	tmdb_id: string | null;
	parent_ids?: {
		imdb_id?: string | null;
		tvdb_id?: string | null;
		tmdb_id?: string | null;
	};
	state: string;
	aired_at: string | null;
	genres: string | null;
	is_anime: boolean;
	guid: string | null;
	rating: number | null;
	content_rating: string | null;
	requested_at: string | null;
	requested_by: string | null;
	scraped_at: string | null;
	scraped_times: number | null;
};

export type MessageResponse = { message: string };

export type ServicesResponse = Record<string, boolean>;

export type DownloaderUserInfoResponse = {
	services: Array<{
		service: 'realdebrid' | 'alldebrid' | 'debridlink' | string;
		username?: string | null;
		email?: string | null;
		user_id: number | string;
		premium_status: 'free' | 'premium' | string;
		premium_expires_at?: string | null;
		premium_days_left?: number | null;
		points?: number | null;
		total_downloaded_bytes?: number | null;
		cooldown_until?: string | null;
	}>;
};

export function apiV1(path: string) {
	return `/api/v1${path.startsWith('/') ? path : `/${path}`}`;
}
