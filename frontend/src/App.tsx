import { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { useAuth } from './hooks/useAuth';
import { Home } from './pages/Home';
import { Group } from './pages/Group';
import { AddExpense } from './pages/AddExpense';
import { SettleUp } from './pages/SettleUp';
import './index.css';

const tonConnectManifestUrl =
  import.meta.env.VITE_TON_MANIFEST_URL || 'https://splitogram.pages.dev/tonconnect-manifest.json';

function AppContent() {
  const auth = useAuth();
  const navigate = useNavigate();
  const deepLinkHandled = useRef(false);

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (webApp) {
      webApp.ready();
      webApp.expand();
      document.body.style.backgroundColor = webApp.backgroundColor;
      document.body.style.color = webApp.themeParams.text_color || '#000000';

      if (webApp.colorScheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }, []);

  // Deep link routing: read startParam after auth succeeds
  useEffect(() => {
    if (!auth.authenticated || deepLinkHandled.current) return;
    deepLinkHandled.current = true;

    const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    if (!startParam) return;

    if (startParam.startsWith('group_')) {
      const id = startParam.slice('group_'.length);
      if (id) navigate(`/groups/${id}`);
    } else if (startParam.startsWith('settle_')) {
      const id = startParam.slice('settle_'.length);
      if (id) navigate(`/settle/${id}`);
    } else if (startParam.startsWith('expense_')) {
      // Expense deep links navigate to the group (expense detail view TBD)
      const id = startParam.slice('expense_'.length);
      if (id) navigate(`/groups/${id}`);
    }
  }, [auth.authenticated, navigate]);

  if (auth.loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!auth.authenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4 text-center">
        <div>
          <h1 className="text-xl font-bold mb-2">Splitogram</h1>
          <p className="text-gray-500">Please open this app from Telegram.</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/groups/:id" element={<Group />} />
      <Route path="/groups/:id/add-expense" element={<AddExpense />} />
      <Route path="/settle/:id" element={<SettleUp />} />
    </Routes>
  );
}

function App() {
  return (
    <TonConnectUIProvider manifestUrl={tonConnectManifestUrl}>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </TonConnectUIProvider>
  );
}

export default App;
