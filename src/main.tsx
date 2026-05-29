import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import App from './App.tsx';
import './index.css';

const AnalyticsPage = React.lazy(() => import('./AnalyticsPage.tsx').then(module => ({ default: module.AnalyticsPage })));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<App />} />
        <Route path="/operations" element={<App />} />
        <Route path="/controls" element={<App />} />
        <Route path="/publisher-runs" element={<App />} />
        <Route path="/analytics" element={
          <React.Suspense fallback={<div className="flex items-center justify-center h-screen bg-[#0a0a0a] text-white/30 animate-pulse">Loading…</div>}>
            <AnalyticsPage />
          </React.Suspense>
        } />
        <Route path="/competitor-intel" element={<App />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
