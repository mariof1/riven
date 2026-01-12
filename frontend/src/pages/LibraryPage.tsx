import React from 'react';
import Card from '../components/Card';
import VirtualList from '../components/VirtualList';
import { apiGet, apiV1, ItemsResponse, MediaItemSummary, toQueryString } from '../lib/api';

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

export default function LibraryPage() {
	const [items, setItems] = React.useState<MediaItemSummary[]>([]);
	const [page, setPage] = React.useState(1);
	const [totalPages, setTotalPages] = React.useState<number | null>(null);
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
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

	const loadPage = React.useCallback(
		async (p: number, opts?: { reset?: boolean }) => {
			if (loading) return;
			if (totalPages !== null && p > totalPages) return;
			setLoading(true);
			setError(null);
			try {
				const path = apiV1(
					`/items${toQueryString({
						limit: 50,
						page: p,
						type: typeFilter,
						states: stateFilter,
						sort: [sort]
					})}`
				);
				const data = await apiGet<ItemsResponse>(path);
				setTotalPages(data.total_pages);
				setPage(data.page);
				setItems((prev) => (opts?.reset || p === 1 ? data.items : [...prev, ...data.items]));
			} catch (e) {
				setError(getErrorMessage(e));
			} finally {
				setLoading(false);
			}
		},
		[loading, sort, stateFilter, totalPages, typeFilter]
	);

	React.useEffect(() => {
		void loadPage(1, { reset: true });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sort, stateFilter.join(','), typeFilter.join(',')]);

	const onEndReached = React.useCallback(() => {
		if (loading) return;
		if (totalPages !== null && page >= totalPages) return;
		void loadPage(page + 1);
	}, [loading, loadPage, page, totalPages]);

	return (
		<div className="space-y-4">
			<Card className="p-6">
				<h1 className="text-xl font-semibold text-slate-100">Library</h1>
				<p className="mt-1 text-sm text-slate-300">Paged items from the backend, with virtualization.</p>
				<div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
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
					</label>

					<label className="space-y-1">
						<div className="text-xs text-slate-400">State</div>
						<select
							multiple
							value={stateFilter}
							onChange={(e) => {
								const values = Array.from(e.target.selectedOptions).map((o) => o.value).filter(Boolean);
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

				<div className="mt-3 flex flex-wrap items-center gap-2">
					<button
						className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
						onClick={() => void loadPage(1, { reset: true })}
					>
						Refresh
					</button>
					<button
						className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
						onClick={() => {
							setTypeFilter([]);
							setStateFilter([]);
							setSort('date_desc');
						}}
					>
						Reset filters
					</button>
					<div className="text-xs text-slate-500">
						{totalPages ? `Page ${page} / ${totalPages}` : `Loaded ${items.length} items`}
					</div>
				</div>
				{error ? <div className="mt-3 text-sm text-amber-200">{error}</div> : null}
			</Card>

			<VirtualList
				items={items}
				height={560}
				itemHeight={72}
				onEndReached={onEndReached}
				renderItem={(item, idx) => {
					const title = String(item.title ?? `Item ${idx + 1}`);
					const type = String(item.type ?? 'unknown');
					const state = String(item.state ?? '');
					const id = item.id;
					return (
						<div className="mx-3 my-2 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/30 px-4 py-3">
							<div className="min-w-0">
								<div className="truncate text-sm font-medium text-slate-100">{title}</div>
								<div className="mt-1 text-xs text-slate-400">
									{type}{state ? ` • ${state}` : ''}{id ? ` • #${String(id)}` : ''}
								</div>
							</div>
							<div className="flex shrink-0 items-center gap-2">
								<button
									className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
									onClick={() => navigator.clipboard.writeText(JSON.stringify(item, null, 2))}
								>
									Copy
								</button>
							</div>
						</div>
					);
				}}
			/>

			<div className="px-1 text-xs text-slate-500">
				{loading ? 'Loading…' : totalPages !== null && page >= totalPages ? 'End of list.' : 'Scroll to load more.'}
			</div>
		</div>
	);
}
