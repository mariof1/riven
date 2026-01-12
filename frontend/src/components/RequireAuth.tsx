import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '../lib/auth-client';

export default function RequireAuth({ children }: { children: React.ReactNode }) {
        const location = useLocation();
        const session = useSession();

        if (session.isPending) {
                return (
                        <div className="mx-auto max-w-7xl px-4 py-10 text-slate-200">
                                <div className="rounded-2xl border border-white/10 bg-white/5 p-6">Loading…</div>
                        </div>
                );
        }

        const user = session.data?.user;
        if (!user) {
                return <Navigate to="/auth/login" replace state={{ from: location.pathname }} />;
        }

        return <>{children}</>;
}
