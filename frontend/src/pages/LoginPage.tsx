import React from 'react';
import { useNavigate } from 'react-router-dom';
import { authClient, useSession } from '../lib/auth-client';

type AuthProvider = { enabled: boolean; disableSignup: boolean; name?: string; icon?: string };

export default function LoginPage() {
        const navigate = useNavigate();
        const session = useSession();

        const [providers, setProviders] = React.useState<Record<string, AuthProvider> | null>(null);
        const [isFirstUser, setIsFirstUser] = React.useState(false);
        const [username, setUsername] = React.useState('');
        const [password, setPassword] = React.useState('');
        const [email, setEmail] = React.useState('');
        const [registerUsername, setRegisterUsername] = React.useState('');
        const [registerPassword, setRegisterPassword] = React.useState('');
        const [registerName, setRegisterName] = React.useState('');
        const [activeTab, setActiveTab] = React.useState<'login' | 'register'>('login');
        const [error, setError] = React.useState<string | null>(null);
        const [busy, setBusy] = React.useState(false);

        React.useEffect(() => {
                if (session.data?.user) {
                        navigate('/', { replace: true });
                }
        }, [session.data?.user, navigate]);

        React.useEffect(() => {
                let cancelled = false;
                void (async () => {
                        try {
                                const res = await fetch('/api/auth/providers', { credentials: 'include' });
                                if (!res.ok) throw new Error(`Failed to load providers (${res.status})`);
                                const data = (await res.json()) as {
                                        providers: Record<string, AuthProvider>;
                                        isFirstUser: boolean;
                                };
                                if (cancelled) return;
                                setProviders(data.providers);
                                setIsFirstUser(data.isFirstUser);
                        } catch {
                                if (cancelled) return;
                                setProviders({});
                        }
                })();
                return () => {
                        cancelled = true;
                };
        }, []);

        const credentialEnabled = !!providers?.credential?.enabled;
        const credentialSignupEnabled = !!providers?.credential?.enabled && !providers?.credential?.disableSignup;
        const canRegister = isFirstUser || credentialSignupEnabled;

        async function submitLogin(e: React.FormEvent) {
                e.preventDefault();
                setError(null);
                setBusy(true);
                try {
                        const res = await authClient.signIn.username({
                                username,
                                password,
                                callbackURL: '/'
                        });
                        if (res.error) {
                                setError(res.error.message || 'Login failed');
                                return;
                        }
                        navigate('/', { replace: true });
                } catch {
                        setError('Login failed');
                } finally {
                        setBusy(false);
                }
        }

        async function submitRegister(e: React.FormEvent) {
                e.preventDefault();
                setError(null);
                setBusy(true);
                try {
                        const res = await authClient.signUp.email({
                                email,
                                password: registerPassword,
                                name: registerName || registerUsername,
                                username: registerUsername,
                                callbackURL: '/',
                        });
                        if (res.error) {
                                setError(res.error.message || 'Registration failed');
                                return;
                        }
                        navigate('/', { replace: true });
                } catch {
                        setError('Registration failed');
                } finally {
                        setBusy(false);
                }
        }

        async function plexLogin() {
                setError(null);
                try {
                        await authClient.signIn.oauth2({
                                providerId: 'plex',
                                callbackURL: '/'
                        });
                } catch {
                        setError('Plex sign-in failed to start');
                }
        }

        return (
                <div className="min-h-dvh bg-slate-950 text-slate-100">
                        <div className="mx-auto flex min-h-dvh max-w-7xl items-center px-4 py-10">
                                <div className="mx-auto w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6">
                                        <div className="mb-6">
                                                <div className="text-xl font-semibold">Sign in</div>
                                                <div className="mt-1 text-sm text-slate-400">Local DB auth + Plex OAuth</div>
                                        </div>

                                        {error ? (
                                                <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
                                                        {error}
                                                </div>
                                        ) : null}

                                        <div className="mb-4 flex gap-2">
                                                <button
                                                        type="button"
                                                        onClick={() => setActiveTab('login')}
                                                        className={`flex-1 rounded-xl border px-3 py-2 text-sm ${
                                                                activeTab === 'login'
                                                                        ? 'border-white/20 bg-white/10'
                                                                        : 'border-white/10 bg-white/5 hover:bg-white/10'
                                                        }`}
                                                >
                                                        Login
                                                </button>
                                                {canRegister ? (
                                                        <button
                                                                type="button"
                                                                onClick={() => setActiveTab('register')}
                                                                className={`flex-1 rounded-xl border px-3 py-2 text-sm ${
                                                                        activeTab === 'register'
                                                                                ? 'border-white/20 bg-white/10'
                                                                                : 'border-white/10 bg-white/5 hover:bg-white/10'
                                                                }`}
                                                        >
                                                                Register
                                                        </button>
                                                ) : null}
                                        </div>

                                        {activeTab === 'login' ? (
                                                <form onSubmit={submitLogin} className="space-y-3">
                                                        <label className="block">
                                                                <div className="mb-1 text-xs text-slate-400">Username</div>
                                                                <input
                                                                        value={username}
                                                                        onChange={(e) => setUsername(e.target.value)}
                                                                        autoComplete="username"
                                                                        className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-white/20"
                                                                        disabled={!credentialEnabled || busy}
                                                                />
                                                        </label>
                                                        <label className="block">
                                                                <div className="mb-1 text-xs text-slate-400">Password</div>
                                                                <input
                                                                        type="password"
                                                                        value={password}
                                                                        onChange={(e) => setPassword(e.target.value)}
                                                                        autoComplete="current-password"
                                                                        className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-white/20"
                                                                        disabled={!credentialEnabled || busy}
                                                                />
                                                        </label>
                                                        <button
                                                                type="submit"
                                                                className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm hover:bg-white/15 disabled:opacity-60"
                                                                disabled={!credentialEnabled || busy}
                                                        >
                                                                {busy ? 'Signing in…' : 'Sign in'}
                                                        </button>
                                                </form>
                                        ) : (
                                                <form onSubmit={submitRegister} className="space-y-3">
                                                        <label className="block">
                                                                <div className="mb-1 text-xs text-slate-400">Name</div>
                                                                <input
                                                                        value={registerName}
                                                                        onChange={(e) => setRegisterName(e.target.value)}
                                                                        className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-white/20"
                                                                        disabled={busy}
                                                                />
                                                        </label>
                                                        <label className="block">
                                                                <div className="mb-1 text-xs text-slate-400">Username</div>
                                                                <input
                                                                        value={registerUsername}
                                                                        onChange={(e) => setRegisterUsername(e.target.value)}
                                                                        autoComplete="username"
                                                                        className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-white/20"
                                                                        disabled={busy}
                                                                />
                                                        </label>
                                                        <label className="block">
                                                                <div className="mb-1 text-xs text-slate-400">Email</div>
                                                                <input
                                                                        value={email}
                                                                        onChange={(e) => setEmail(e.target.value)}
                                                                        autoComplete="email"
                                                                        className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-white/20"
                                                                        disabled={busy}
                                                                />
                                                        </label>
                                                        <label className="block">
                                                                <div className="mb-1 text-xs text-slate-400">Password</div>
                                                                <input
                                                                        type="password"
                                                                        value={registerPassword}
                                                                        onChange={(e) => setRegisterPassword(e.target.value)}
                                                                        autoComplete="new-password"
                                                                        className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-white/20"
                                                                        disabled={busy}
                                                                />
                                                        </label>
                                                        <button
                                                                type="submit"
                                                                className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm hover:bg-white/15 disabled:opacity-60"
                                                                disabled={busy}
                                                        >
                                                                {busy ? 'Creating…' : 'Create account'}
                                                        </button>
                                                </form>
                                        )}

                                        {providers?.plex?.enabled ? (
                                                <div className="mt-4">
                                                        <button
                                                                type="button"
                                                                onClick={() => void plexLogin()}
                                                                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
                                                        >
                                                                Continue with Plex
                                                        </button>
                                                </div>
                                        ) : null}
                                </div>
                        </div>
                </div>
        );
}
