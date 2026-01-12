import React from 'react';
import Card from '../components/Card';
import VirtualList from '../components/VirtualList';
import { apiGet, apiV1, ItemsResponse, toQueryString } from '../lib/api';

type Item = Record<string, unknown>;

export default function LibraryPage() {
	const [items, setItems] = React.useState<Item[]>([]);
	const [page, setPage] = React.useState(1);
	const [totalPages, setTotalPages] = React.useState<number | null>(null);
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const loadPage = React.useCallback(
		async (p: number) => {
			if (loading) return;
			if (totalPages !== null && p > totalPages) return;
			setLoading(true);
			setError(null);
			try {
				const path = apiV1(`/items${toQueryString({ limit: 50, page: p })}`);
				const data = await apiGet<ItemsResponse>(path);
				setTotalPages(data.total_pages);
				setPage(data.page);
				setItems((prev) => (p === 1 ? data.items : [...prev, ...data.items]));
			} catch (e) {
				setError(e instanceof Error ? e.message : 'Failed to load library');
			} finally {
				setLoading(false);
			}
		},
		[loading, totalPages]
	);

	React.useEffect(() => {
		void loadPage(1);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

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
				<div className="mt-3 flex flex-wrap items-center gap-2">
					<button
						className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
						onClick={() => void loadPage(1)}
					>
						Refresh
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
					const title = String((item as any).title ?? (item as any).name ?? `Item ${idx + 1}`);
					const type = String((item as any).type ?? (item as any).media_type ?? 'unknown');
					const state = String((item as any).state ?? (item as any).status ?? '');
					const id = (item as any).id;
					return (
						<div className="mx-3 my-2 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/30 px-4 py-3">
							<div className="min-w-0">
								<div className="truncate text-sm font-medium text-slate-100">{title}</div>
								<div className="mt-1 text-xs text-slate-400">
									{type}{state ? ` • ${state}` : ''}{id !== undefined ? ` • #${String(id)}` : ''}
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
