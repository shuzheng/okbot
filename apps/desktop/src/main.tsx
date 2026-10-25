import { installHttpOkbotBridge } from './bridge/httpOkbot';
installHttpOkbotBridge();
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';
import { installWindowResizeGate } from './utils/windowResizeGate';
installWindowResizeGate();

// Early platform hint for CSS / chrome (Windows frameless controls).
void window.okbot.getAppInfo().then((info) => {
  document.documentElement.dataset.platform = info.platform;
    if (document.documentElement.dataset.translucent == null) {
      document.documentElement.dataset.translucent = 'true';
    }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
