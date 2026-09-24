// Entry point. Inter is bundled (@fontsource/inter) so on-screen text matches the measure tables the layout used
// (src/core/measure.ts); the app mounts once the label font is ready, so labels never reflow after first paint.
import '@fontsource/inter/400.css';
import '@fontsource/inter/400-italic.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';

async function fontsReady(): Promise<void> {
  const loads = ['400 13px Inter', 'italic 400 13px Inter', '600 13px Inter', '700 13px Inter'].map((f) =>
    document.fonts.load(f).catch(() => undefined),
  );
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 1500))]);
}

void fontsReady().then(() => {
  createRoot(document.getElementById('root')!).render(<App />);
});
