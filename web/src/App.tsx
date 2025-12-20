import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Editor from './pages/Editor';

function App() {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="loading-screen">
                <div className="spinner"></div>
                <p>Loading...</p>
            </div>
        );
    }

    return (
        <Routes>
            <Route
                path="/login"
                element={user ? <Navigate to="/dashboard" /> : <Login />}
            />
            <Route
                path="/dashboard"
                element={user ? <Dashboard /> : <Navigate to="/login" />}
            />
            <Route
                path="/editor/:projectId"
                element={user ? <Editor /> : <Navigate to="/login" />}
            />
            <Route
                path="/"
                element={<Navigate to={user ? "/dashboard" : "/login"} />}
            />
        </Routes>
    );
}

export default App;
