import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ThemeProvider } from './contexts/ThemeContext.tsx';
import { ModalProvider } from './contexts/ModalContext.tsx';
import './index.css';

// Anti-Screenshot and Anti-Copy measures
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('keyup', e => {
  if (e.key === 'PrintScreen') {
    navigator.clipboard.writeText('');
    alert("Screenshots are disabled for privacy. If you tried to screenshot, your clipboard was cleared.");
  }
});
window.addEventListener('blur', () => {
  document.body.style.filter = 'blur(10px)';
  document.body.style.opacity = '0.5';
});
window.addEventListener('focus', () => {
  document.body.style.filter = 'none';
  document.body.style.opacity = '1';
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ModalProvider>
        <App />
      </ModalProvider>
    </ThemeProvider>
  </StrictMode>,
);
