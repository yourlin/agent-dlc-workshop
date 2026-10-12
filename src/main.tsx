import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { DocRoute, RootRedirect } from './App';
import './styles.css';

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

// The per-route index.html files contain a pre-rendered copy of the page for
// crawlers / no-JS readers; React simply replaces it.
const rootEl = document.getElementById('root')!;
rootEl.innerHTML = '';

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/:lang/*" element={<DocRoute />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
