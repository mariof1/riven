import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import DashboardPage from './pages/DashboardPage';
import SearchPage from './pages/SearchPage';
import LibraryPage from './pages/LibraryPage';
import SettingsPage from './pages/SettingsPage';
import LoginPage from './pages/LoginPage';
import RequireAuth from './components/RequireAuth';

export default function App() {
		return (
				<Routes>
						<Route path="/auth/login" element={<LoginPage />} />
						<Route
								element={
										<RequireAuth>
												<AppShell />
										</RequireAuth>
								}
						>
								<Route path="/" element={<DashboardPage />} />
								<Route path="/search" element={<SearchPage />} />
								<Route path="/library" element={<LibraryPage />} />
								<Route path="/settings" element={<SettingsPage />} />
								<Route path="*" element={<Navigate to="/" replace />} />
						</Route>
				</Routes>
		);
}
