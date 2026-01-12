import { Film, Library, Search, Settings } from 'lucide-react';
import React from 'react';
import { NavLink } from 'react-router-dom';

type Props = {
	children: React.ReactNode;
};

const nav = [
	{ to: '/', label: 'Home', icon: Film },
	{ to: '/search', label: 'Search', icon: Search },
	{ to: '/library', label: 'Library', icon: Library },
	{ to: '/settings', label: 'Settings', icon: Settings }
] as const;

function cx(...parts: Array<string | false | undefined | null>) {
	return parts.filter(Boolean).join(' ');
}

export default function AppShell({ children }: Props) {
	const [mobileOpen, setMobileOpen] = React.useState(false);

	React.useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setMobileOpen(false);
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, []);

	return (
		<div className="min-h-dvh">
			{/* Top bar */}
			<div className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/60 backdrop-blur">
				<div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
					<div className="flex items-center gap-3">
						<button
							onClick={() => setMobileOpen(true)}
							className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 md:hidden"
							aria-label="Open menu"
						>
							Menu
						</button>
						<div className="flex items-center gap-2">
							<div className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue-500/90 to-indigo-500/70" />
							<div className="leading-tight">
								<div className="text-sm font-semibold text-slate-100">Riven</div>
								<div className="text-xs text-slate-400">Fast, clean media automation</div>
							</div>
						</div>
					</div>

					<div className="hidden items-center gap-2 md:flex">
						<a
							href="/settings"
							className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
						>
							Quick settings
						</a>
					</div>
				</div>
			</div>

			<div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 md:grid-cols-[260px_1fr]">
				{/* Sidebar */}
				<aside className="hidden md:block">
					<div className="rounded-2xl border border-white/10 bg-white/5 p-2">
						<nav className="flex flex-col gap-1">
							{nav.map((item) => (
								<NavLink
									key={item.to}
									to={item.to}
									end={item.to === '/'}
									className={({ isActive }) =>
										cx(
											'flex items-center gap-3 rounded-xl px-3 py-2 text-sm',
											isActive
												? 'bg-white/10 text-slate-100'
												: 'text-slate-300 hover:bg-white/5 hover:text-slate-100'
										)
									}
								>
									<item.icon className="h-4 w-4" />
									<span>{item.label}</span>
								</NavLink>
							))}
						</nav>
					</div>
				</aside>

				{/* Content */}
				<main className="min-w-0">{children}</main>
			</div>

			{/* Mobile drawer */}
			{mobileOpen ? (
				<div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
					<div
						className="absolute inset-0 bg-black/60"
						onClick={() => setMobileOpen(false)}
					/>
					<div className="absolute left-0 top-0 h-full w-[86%] max-w-xs border-r border-white/10 bg-slate-950 p-3">
						<div className="flex items-center justify-between px-1 py-2">
							<div className="text-sm font-semibold text-slate-100">Navigation</div>
							<button
								onClick={() => setMobileOpen(false)}
								className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
							>
								Close
							</button>
						</div>
						<nav className="mt-2 flex flex-col gap-1">
							{nav.map((item) => (
								<NavLink
									key={item.to}
									to={item.to}
									end={item.to === '/'}
									onClick={() => setMobileOpen(false)}
									className={({ isActive }) =>
										cx(
											'flex items-center gap-3 rounded-xl px-3 py-2 text-sm',
											isActive
												? 'bg-white/10 text-slate-100'
												: 'text-slate-300 hover:bg-white/5 hover:text-slate-100'
										)
									}
								>
									<item.icon className="h-4 w-4" />
									<span>{item.label}</span>
								</NavLink>
							))}
						</nav>
					</div>
				</div>
			) : null}
		</div>
	);
}
