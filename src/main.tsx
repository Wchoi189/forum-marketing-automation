import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import App from './App.tsx';
import { AnalyticsPage } from './AnalyticsPage.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<App />} />
        <Route path="/operations" element={<App />} />
        <Route path="/controls" element={<App />} />
        <Route path="/publisher-runs" element={<App />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
