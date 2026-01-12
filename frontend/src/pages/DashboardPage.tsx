import React from 'react';

import { apiGet, apiV1, DownloaderUserInfoResponse, ServicesResponse } from '../lib/api';

type BackendStatus =
	| { state: 'loading' }
	| { state: 'ok'; title?: string; version?: string }
	| { state: 'error'; message: string };

type OpenApiResponse = {
	info?: {
		title?: string;
		version?: string;
	};
};

export default function DashboardPage() {
	const [status, setStatus] = React.useState<BackendStatus>({ state: 'loading' });
	const [health, setHealth] = React.useState<'loading' | 'ok' | 'error'>('loading');
	const [services, setServices] = React.useState<ServicesResponse | null>(null);
	const [downloaderInfo, setDownloaderInfo] = React.useState<DownloaderUserInfoResponse | null>(null);
	const [secondaryError, setSecondaryError] = React.useState<string | null>(null);

	React.useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch('/openapi.json');
				if (!res.ok) throw new Error(`Backend returned ${res.status}`);
				const json = (await res.json()) as OpenApiResponse;
				if (cancelled) return;
				setStatus({
					state: 'ok',
					title: json?.info?.title,
					version: json?.info?.version
				});
			} catch (e) {
				if (cancelled) return;
				setStatus({ state: 'error', message: e instanceof Error ? e.message : 'Unknown error' });
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	React.useEffect(() => {
		let cancelled = false;
		(async () => {
			setSecondaryError(null);
			try {
				const [healthRes, servicesRes] = await Promise.all([
					apiGet<{ message: string }>(apiV1('/health')),
					apiGet<ServicesResponse>(apiV1('/services'))
				]);
				if (cancelled) return;
				setHealth(healthRes.message === 'True' ? 'ok' : 'error');
				setServices(servicesRes);
			} catch (e) {
				if (cancelled) return;
				setHealth('error');
				setSecondaryError(e instanceof Error ? e.message : 'Failed to load status');
				setServices(null);
			}
			try {
				const dl = await apiGet<DownloaderUserInfoResponse>(apiV1('/downloader_user_info'));
				if (cancelled) return;
				setDownloaderInfo(dl);
			} catch (e) {
				// Optional feature: downloader may not be configured.
				if (cancelled) return;
				setDownloaderInfo(null);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<div className="space-y-6">
			<div className="rounded-2xl border border-white/10 bg-white/5 p-6">
				<h1 className="text-xl font-semibold text-slate-100">Dashboard</h1>
				<p className="mt-1 text-sm text-slate-300">
					A clean start: quick navigation, responsive layout, and fast loads.
				</p>
			</div>

			<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
				<div className="rounded-2xl border border-white/10 bg-white/5 p-5">
					<div className="text-sm font-medium text-slate-200">Backend</div>
					<div className="mt-2 text-sm text-slate-300">
						{status.state === 'loading' ? 'Checking…' : null}
						{status.state === 'ok' ? (
							<div>
								<div className="text-slate-100">Connected</div>
								<div className="mt-1 text-xs text-slate-400">
									{status.title ?? 'API'} {status.version ? `• v${status.version}` : ''}
								</div>
							</div>
						) : null}
						{status.state === 'error' ? (
							<div>
								<div className="text-amber-200">Not reachable</div>
								<div className="mt-1 text-xs text-slate-400">{status.message}</div>
							</div>
						) : null}
					</div>
				</div>

				<div className="rounded-2xl border border-white/10 bg-white/5 p-5">
					<div className="text-sm font-medium text-slate-200">Health</div>
					<div className="mt-2 text-sm text-slate-300">
						{health === 'loading' ? 'Checking…' : null}
						{health === 'ok' ? <div className="text-emerald-200">Program initialized</div> : null}
						{health === 'error' ? <div className="text-amber-200">Not initialized / error</div> : null}
						{secondaryError ? (
							<div className="mt-1 text-xs text-slate-400">{secondaryError}</div>
						) : null}
					</div>
				</div>

				<div className="rounded-2xl border border-white/10 bg-white/5 p-5">
					<div className="text-sm font-medium text-slate-200">Services</div>
					<div className="mt-2 space-y-1 text-sm text-slate-300">
						{!services ? <div className="text-slate-400">No data</div> : null}
						{services
							? Object.entries(services)
								.sort(([a], [b]) => a.localeCompare(b))
								.slice(0, 10)
								.map(([k, v]) => (
									<div key={k} className="flex items-center justify-between gap-3">
										<span className="truncate text-slate-200">{k}</span>
										<span className={v ? 'text-emerald-200' : 'text-slate-500'}>
											{v ? 'on' : 'off'}
										</span>
									</div>
								))
							: null}
						{services && Object.keys(services).length > 10 ? (
							<div className="pt-1 text-xs text-slate-500">Showing first 10.</div>
						) : null}
					</div>
				</div>
			</div>

			{downloaderInfo ? (
				<div className="rounded-2xl border border-white/10 bg-white/5 p-6">
					<div className="text-sm font-medium text-slate-200">Downloader user info</div>
					<div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
						{downloaderInfo.services.map((s) => (
							<div key={`${s.service}-${String(s.user_id)}`} className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
								<div className="text-sm font-medium text-slate-100">{s.service}</div>
								<div className="mt-1 text-xs text-slate-400">
									{s.username ? `@${s.username}` : 'Unknown user'}
									{s.premium_status ? ` • ${s.premium_status}` : ''}
									{s.premium_days_left != null ? ` • ${s.premium_days_left}d left` : ''}
								</div>
							</div>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}
