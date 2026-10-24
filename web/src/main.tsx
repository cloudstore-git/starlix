import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { loadConfig } from './lib/config';
import { SessionProvider } from './lib/session';

const root = ReactDOM.createRoot(document.getElementById('root')!);

loadConfig()
  .then(() =>
    root.render(
      <React.StrictMode>
        <BrowserRouter>
          <SessionProvider>
            <App />
          </SessionProvider>
        </BrowserRouter>
      </React.StrictMode>,
    ),
  )
  .catch((e) =>
    root.render(
      <div style={{ padding: 32, fontFamily: 'sans-serif' }}>
        <h1>Starlix could not start</h1>
        <p>{String(e.message ?? e)}</p>
      </div>,
    ),
  );
