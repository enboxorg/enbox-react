import { prepareBrowser } from '@enbox/browser';
import { EnboxProvider } from '@enbox/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { config, records } from './application.js';
import workerPath from './sw.ts?worker&url';
import './style.css';

void prepareBrowser(workerPath, {
  registrationOptions: { type: 'module', scope: import.meta.env.BASE_URL },
}).then(() => {
  createRoot(document.getElementById('root')!).render(<StrictMode><EnboxProvider config={config} records={records}><App /></EnboxProvider></StrictMode>);
}).catch((cause: unknown) => {
  const root = document.getElementById('root')!;
  root.textContent = cause instanceof Error ? cause.message : 'Could not open the app.';
});
