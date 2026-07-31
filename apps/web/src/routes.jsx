import React from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import LoginPage from './pages/LoginPage.jsx';
import BotsPage from './pages/BotsPage.jsx';
import BotEditorPage from './pages/BotEditorPage.jsx';
import BotTestPage from './pages/BotTestPage.jsx';
import EmbedDemoPage from './pages/EmbedDemoPage.jsx';
import Shell from './components/Shell.jsx';
import OverscrollFill from './components/OverscrollFill.jsx';
import AppLoading from './components/AppLoading.jsx';

function AppRoot() {
  return (
    <>
      <OverscrollFill />
      <Outlet />
    </>
  );
}

function RequireUser() {
  const { ready, user, authError } = useAuth();
  if (!ready) return <AppLoading />;
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (authError && !user) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

export const router = createBrowserRouter([
  {
    element: <AppRoot />,
    children: [
      { index: true, element: <EmbedDemoPage /> },
      { path: '/login', element: <LoginPage /> },
      {
        element: <RequireUser />,
        children: [
          {
            element: <Shell />,
            children: [
              { path: 'bots', element: <BotsPage /> },
              { path: 'bots/new', element: <BotEditorPage /> },
              { path: 'bots/:id', element: <BotEditorPage /> },
              { path: 'bots/:id/test', element: <BotTestPage /> },
            ],
          },
        ],
      },
      { path: '/embed-demo/:id', element: <EmbedDemoPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
