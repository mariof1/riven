import React from 'react';
import Card from '../components/Card';
import { apiGet, apiV1, ItemsResponse, toQueryString } from '../lib/api';

export default function SearchPage() {
	const [query, setQuery] = React.useState('');
	const [status, setStatus] = React.useState<'idle' | 'loading' | 'error' | 'ok'>('idle');
	const [error, setError] = React.useState<string | null>(null);
	const [results, setResults] = React.useState<ItemsResponse | null>(null);

	const runSearch = React.useCallback(
		async (q: string) => {
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
				const path = apiV1(`/items${toQueryString({ search: trimmed, limit: 50, page: 1 })}`);
				const data = await apiGet<ItemsResponse>(path);
				setResults(data);
				setStatus('ok');
			} catch (e) {
				setStatus('error');
				setError(e instanceof Error ? e.message : 'Search failed');
			}
		},
		[]
	);

	React.useEffect(() => {
		const t = setTimeout(() => {
			void runSearch(query);
		}, 250);
		return () => clearTimeout(t);
	}, [query, runSearch]);

	return (
		<div className="space-y-4">
			<Card className="p-6">
				<h1 className="text-xl font-semibold text-slate-100">Search</h1>
				<p className="mt-1 text-sm text-slate-300">Search your existing Riven items by title or IDs.</p>
			</Card>

			<Card className="p-6">
				<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
					<input
						className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm outline-none placeholder:text-slate-500 focus:border-blue-500/60"
						placeholder="Search movies, shows, anime…"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
					<button
						className="rounded-xl bg-blue-500/90 px-4 py-3 text-sm font-medium text-white hover:bg-blue-500"
						onClick={() => void runSearch(query)}
					>
						Search
					</button>
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
								const title = String((item as any).title ?? (item as any).name ?? `Item ${idx + 1}`);
								const type = String((item as any).type ?? (item as any).media_type ?? 'unknown');
								const state = String((item as any).state ?? (item as any).status ?? '');
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
