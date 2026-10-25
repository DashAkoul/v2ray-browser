import { createRoot } from 'react-dom/client';
import '@v2rb/ui';
import './options.css';
import { OptionsApp } from './App';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<OptionsApp />);
}
