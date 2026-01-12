import React from 'react';

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
					<div className="text-sm font-medium text-slate-200">Search</div>
					<p className="mt-2 text-sm text-slate-300">
						Unified search UI placeholder (providers, filters, results list).
					</p>
				</div>

				<div className="rounded-2xl border border-white/10 bg-white/5 p-5">
					<div className="text-sm font-medium text-slate-200">Health</div>
					<p className="mt-2 text-sm text-slate-300">
						Status cards, queue activity, and scheduler summary will live here.
					</p>
				</div>
			</div>
		</div>
	);
}
