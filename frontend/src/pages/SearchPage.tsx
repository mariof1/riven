import React from 'react';
import Card from '../components/Card';
import { apiGet, apiV1, ItemsResponse, toQueryString } from '../lib/api';

type StatesResponse = { success: boolean; states: string[] };

const TYPE_OPTIONS = [
	{ value: 'movie', label: 'Movie' },
	{ value: 'show', label: 'Show' },
	{ value: 'season', label: 'Season' },
	{ value: 'episode', label: 'Episode' },
	{ value: 'anime', label: 'Anime' }
] as const;

const SORT_OPTIONS = [
	{ value: 'date_desc', label: 'Date ↓' },
	{ value: 'date_asc', label: 'Date ↑' },
	{ value: 'title_asc', label: 'Title A→Z' },
	{ value: 'title_desc', label: 'Title Z→A' }
] as const;

function getErrorMessage(e: unknown): string {
	if (e instanceof Error) return e.message;
	if (typeof e === 'object' && e && 'message' in e) return String((e as any).message);
	return 'Request failed';
}

export default function SearchPage() {
	const [query, setQuery] = React.useState('');
	const [status, setStatus] = React.useState<'idle' | 'loading' | 'error' | 'ok'>('idle');
	const [error, setError] = React.useState<string | null>(null);
	const [results, setResults] = React.useState<ItemsResponse | null>(null);
	const [availableStates, setAvailableStates] = React.useState<string[]>([]);
	const [typeFilter, setTypeFilter] = React.useState<Array<(typeof TYPE_OPTIONS)[number]['value']>>([]);
	const [stateFilter, setStateFilter] = React.useState<string[]>([]);
	const [sort, setSort] = React.useState<(typeof SORT_OPTIONS)[number]['value']>('date_desc');

	React.useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const data = await apiGet<StatesResponse>(apiV1('/items/states'));
				if (cancelled) return;
				setAvailableStates(data.states ?? []);
			} catch {
				if (cancelled) return;
				setAvailableStates([]);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const runSearch = React.useCallback(
		async (q: string, opts: { types: string[]; states: string[]; sort: string }) => {
			const trimmed = q.trim();
			if (!trimmed) {
				setStatus('idle');
				setError(null);
				setResults(null);
				return;
			}
			setStatus('loading');
			setError(null);
			try {
				const path = apiV1(
					`/items${toQueryString({
						search: trimmed,
						limit: 50,
						page: 1,
						type: opts.types,
						states: opts.states,
						sort: [opts.sort]
					})}`
				);
				const data = await apiGet<ItemsResponse>(path);
				setResults(data);
				setStatus('ok');
			} catch (e) {
				setStatus('error');
				setError(getErrorMessage(e));
			}
		},
		[]
	);

	React.useEffect(() => {
		const t = setTimeout(() => {
			void runSearch(query, { types: typeFilter, states: stateFilter, sort });
		}, 250);
		return () => clearTimeout(t);
	}, [query, runSearch, sort, stateFilter, typeFilter]);

	return (
		<div className="space-y-4">
			<Card className="p-6">
				<h1 className="text-xl font-semibold text-slate-100">Search</h1>
				<p className="mt-1 text-sm text-slate-300">Search your existing Riven items by title or IDs.</p>
			</Card>

			<Card className="p-6">
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
					<input
						className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm outline-none placeholder:text-slate-500 focus:border-blue-500/60"
						placeholder="Search movies, shows, anime…"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
					<button
						className="rounded-xl bg-blue-500/90 px-4 py-3 text-sm font-medium text-white hover:bg-blue-500"
							onClick={() => void runSearch(query, { types: typeFilter, states: stateFilter, sort })}
					>
						Search
					</button>
					</div>

					<div className="grid grid-cols-1 gap-3 md:grid-cols-3">
						<label className="space-y-1">
							<div className="text-xs text-slate-400">Type</div>
							<select
								multiple
								value={typeFilter}
								onChange={(e) => {
									const values = Array.from(e.target.selectedOptions).map((o) => o.value);
									setTypeFilter(values as any);
								}}
								className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-blue-500/60"
							>
								{TYPE_OPTIONS.map((t) => (
									<option key={t.value} value={t.value}>
										{t.label}
									</option>
								))}
							</select>
							<div className="text-[11px] text-slate-500">Ctrl/Cmd-click to multi-select.</div>
						</label>

						<label className="space-y-1">
							<div className="text-xs text-slate-400">State</div>
							<select
								multiple
								value={stateFilter}
								onChange={(e) => {
									const values = Array.from(e.target.selectedOptions).map((o) => o.value);
									setStateFilter(values);
								}}
								className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-blue-500/60"
							>
								{availableStates.length === 0 ? <option value="">(loading…)</option> : null}
								{availableStates.map((s) => (
									<option key={s} value={s}>
										{s}
									</option>
								))}
							</select>
							<div className="text-[11px] text-slate-500">Leave empty for all states.</div>
						</label>

						<label className="space-y-1">
							<div className="text-xs text-slate-400">Sort</div>
							<select
								value={sort}
								onChange={(e) => setSort(e.target.value as any)}
								className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-blue-500/60"
							>
								{SORT_OPTIONS.map((s) => (
									<option key={s.value} value={s.value}>
										{s.label}
									</option>
								))}
							</select>
						</label>
					</div>
				</div>

				{status === 'idle' ? (
					<div className="mt-4 text-sm text-slate-400">Type to search (debounced).</div>
				) : null}
				{status === 'loading' ? (
					<div className="mt-4 text-sm text-slate-400">Searching…</div>
				) : null}
				{status === 'error' ? (
					<div className="mt-4 text-sm text-amber-200">{error ?? 'Search failed'}</div>
				) : null}

				{status === 'ok' && results ? (
					<div className="mt-5">
						<div className="text-sm text-slate-400">
							Found <span className="text-slate-200">{results.total_items}</span> item(s)
						</div>
						<div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
							{results.items.slice(0, 20).map((item, idx) => {
								const title = String(item.title ?? `Item ${idx + 1}`);
								const type = String(item.type ?? 'unknown');
								const state = String(item.state ?? '');
								return (
									<div key={idx} className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<div className="truncate text-sm font-medium text-slate-100">{title}</div>
												<div className="mt-1 text-xs text-slate-400">
													{type}
													{state ? ` • ${state}` : ''}
												</div>
											</div>
											<button
												className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
												onClick={() => navigator.clipboard.writeText(JSON.stringify(item, null, 2))}
											>
												Copy JSON
											</button>
										</div>
									</div>
								);
							})}
						</div>
						{results.total_items > 20 ? (
							<div className="mt-4 text-xs text-slate-500">Showing first 20 results.</div>
						) : null}
					</div>
				) : null}
			</Card>
		</div>
	);
}
