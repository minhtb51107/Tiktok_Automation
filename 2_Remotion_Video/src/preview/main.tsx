import React from 'react';
import { createRoot } from 'react-dom/client';
import { PreviewApp } from './PreviewApp';
import './preview.css';

const container = document.getElementById('root');
if (!container) throw new Error('Preview root element is missing.');
createRoot(container).render(
  <React.StrictMode>
    <PreviewApp />
  </React.StrictMode>,
);
