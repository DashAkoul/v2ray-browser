import { createRoot } from 'react-dom/client';
import '@v2rb/ui';
import './popup.css';
import { PopupApp } from './App';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<PopupApp />);
}
