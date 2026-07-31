import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes.jsx';
import { AuthProvider } from './lib/auth.jsx';
import { LocaleProvider } from './lib/i18n.jsx';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LocaleProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </LocaleProvider>
  </React.StrictMode>
);
