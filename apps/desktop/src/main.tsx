import { installHttpOkbotBridge } from './bridge/httpOkbot';
installHttpOkbotBridge();
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';

// Early platform hint for CSS / chrome (Windows frameless controls).
void window.okbot.getAppInfo().then((info) => {
  document.documentElement.dataset.platform = info.platform;
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
