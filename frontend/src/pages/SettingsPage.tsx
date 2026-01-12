import React from 'react';
import Card from '../components/Card';
import { apiGet, apiV1 } from '../lib/api';

type MessageResponse = { message: string };

export default function SettingsPage() {
	const [settings, setSettings] = React.useState<unknown>(null);
	const [schema, setSchema] = React.useState<unknown>(null);
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [toast, setToast] = React.useState<string | null>(null);

	const refresh = React.useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [s, sc] = await Promise.all([
				apiGet<unknown>(apiV1('/settings/get/all')),
				apiGet<unknown>(apiV1('/settings/schema'))
			]);
			setSettings(s);
			setSchema(sc);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Failed to load settings');
		} finally {
			setLoading(false);
		}
	}, []);

	React.useEffect(() => {
		void refresh();
	}, [refresh]);

	const callAction = React.useCallback(
		async (path: string, method: 'GET' | 'POST') => {
			setToast(null);
			setError(null);
			try {
				const res = await fetch(apiV1(path), { method });
				if (!res.ok) throw new Error(`Request failed: ${res.status}`);
				const data = (await res.json()) as MessageResponse;
				setToast(data.message);
				await refresh();
			} catch (e) {
				setError(e instanceof Error ? e.message : 'Request failed');
			}
		},
		[refresh]
	);

	return (
		<div className="space-y-4">
			<Card className="p-6">
				<h1 className="text-xl font-semibold text-slate-100">Settings</h1>
				<p className="mt-1 text-sm text-slate-300">Live settings are fetched from the backend.</p>
				<div className="mt-4 flex flex-wrap items-center gap-2">
					<button
						className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
						onClick={() => void refresh()}
					>
						Refresh
					</button>
					<button
						className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
						onClick={() => void callAction('/settings/load', 'GET')}
					>
						Load
					</button>
					<button
						className="rounded-lg bg-blue-500/90 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
						onClick={() => void callAction('/settings/save', 'POST')}
					>
						Save
					</button>
					{loading ? <span className="text-xs text-slate-500">Loading…</span> : null}
				</div>
				{toast ? <div className="mt-3 text-sm text-emerald-200">{toast}</div> : null}
				{error ? <div className="mt-3 text-sm text-amber-200">{error}</div> : null}
			</Card>

			<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
				<Card className="p-6">
					<div className="flex items-center justify-between gap-3">
						<div className="text-sm font-medium text-slate-200">Current settings</div>
						<button
							className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
							onClick={() => navigator.clipboard.writeText(JSON.stringify(settings ?? {}, null, 2))}
						>
							Copy
						</button>
					</div>
					<pre className="mt-3 max-h-[520px] overflow-auto rounded-xl border border-white/10 bg-slate-950/30 p-3 text-xs text-slate-200">
						{JSON.stringify(settings ?? {}, null, 2)}
					</pre>
				</Card>

				<Card className="p-6">
					<div className="flex items-center justify-between gap-3">
						<div className="text-sm font-medium text-slate-200">Settings schema</div>
						<button
							className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
							onClick={() => navigator.clipboard.writeText(JSON.stringify(schema ?? {}, null, 2))}
						>
							Copy
						</button>
					</div>
					<pre className="mt-3 max-h-[520px] overflow-auto rounded-xl border border-white/10 bg-slate-950/30 p-3 text-xs text-slate-200">
						{JSON.stringify(schema ?? {}, null, 2)}
					</pre>
				</Card>
			</div>
		</div>
	);
}
