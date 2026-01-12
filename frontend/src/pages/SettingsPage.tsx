import React from 'react';
import Card from '../components/Card';
import { apiGet, apiPost, apiV1, getStoredApiKey, MessageResponse, setStoredApiKey } from '../lib/api';

function getErrorMessage(e: unknown): string {
	if (e instanceof Error) return e.message;
	if (typeof e === 'object' && e && 'message' in e) return String((e as any).message);
	return 'Request failed';
}

export default function SettingsPage() {
	const [settings, setSettings] = React.useState<unknown>(null);
	const [schema, setSchema] = React.useState<unknown>(null);
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [toast, setToast] = React.useState<string | null>(null);
	const [apiKey, setApiKey] = React.useState<string>(() => getStoredApiKey() ?? '');
	const [authStatus, setAuthStatus] = React.useState<'unknown' | 'ok' | 'error'>('unknown');

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
			setAuthStatus('ok');
		} catch (e) {
			setAuthStatus('error');
			setError(getErrorMessage(e));
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
				const data =
					method === 'GET'
						? await apiGet<MessageResponse>(apiV1(path))
						: await apiPost<MessageResponse>(apiV1(path));
				setToast(data.message);
				await refresh();
			} catch (e) {
				setError(getErrorMessage(e));
			}
		},
		[refresh]
	);

	const saveApiKey = React.useCallback(() => {
		setStoredApiKey(apiKey);
		setToast(apiKey.trim() ? 'API key saved locally.' : 'API key cleared locally.');
		setError(null);
		setAuthStatus('unknown');
	}, [apiKey]);

	const generateApiKey = React.useCallback(async () => {
		setToast(null);
		setError(null);
		const ok = window.confirm(
			'Generate a new API key? This rotates the server key and may invalidate existing clients.'
		);
		if (!ok) return;
		try {
			const res = await apiPost<MessageResponse>(apiV1('/generateapikey'));
			setApiKey(res.message);
			setStoredApiKey(res.message);
			setToast('New API key generated and stored locally.');
			await refresh();
		} catch (e) {
			setError(getErrorMessage(e));
		}
	}, [refresh]);

	return (
		<div className="space-y-4">
			<Card className="p-6">
				<h1 className="text-xl font-semibold text-slate-100">Settings</h1>
				<p className="mt-1 text-sm text-slate-300">Live settings are fetched from the backend.</p>

				<div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
					<div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
						<div className="text-sm font-medium text-slate-200">API key</div>
						<div className="mt-2 flex flex-col gap-2">
							<input
								className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:border-blue-500/60"
								placeholder="Optional: x-api-key"
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
							/>
							<div className="flex flex-wrap items-center gap-2">
								<button
									className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
									onClick={saveApiKey}
								>
									Save locally
								</button>
								<button
									className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
									onClick={() => {
										navigator.clipboard.writeText(apiKey);
										setToast('API key copied.');
									}}
									disabled={!apiKey.trim()}
								>
									Copy
								</button>
								<button
									className="rounded-lg bg-blue-500/90 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
									onClick={() => void generateApiKey()}
								>
									Generate new key
								</button>
							</div>
							<div className="text-xs text-slate-500">
								Stored in localStorage; dev proxy can also inject via env.
							</div>
						</div>
					</div>

					<div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
						<div className="text-sm font-medium text-slate-200">Auth status</div>
						<div className="mt-2 text-sm text-slate-300">
							{authStatus === 'unknown' ? <span className="text-slate-400">Unknown</span> : null}
							{authStatus === 'ok' ? <span className="text-emerald-200">Authenticated</span> : null}
							{authStatus === 'error' ? <span className="text-amber-200">Unauthorized / error</span> : null}
						</div>
						<div className="mt-2 flex flex-wrap items-center gap-2">
							<button
								className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
								onClick={() => void refresh()}
							>
								Re-check
							</button>
							<button
								className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
								onClick={async () => {
									setToast(null);
									setError(null);
									try {
										const h = await apiGet<MessageResponse>(apiV1('/health'));
										setToast(`Health: ${h.message}`);
										setAuthStatus('ok');
									} catch (e) {
										setAuthStatus('error');
										setError(getErrorMessage(e));
									}
								}}
							>
								Ping /health
							</button>
						</div>
					</div>
				</div>

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
