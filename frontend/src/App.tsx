import { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { api, ApiError } from './services/api';
import { AppLayout } from './components/AppLayout';
import { LoadingScreen } from './components/LoadingScreen';
import { Home } from './pages/Home';
import { Group } from './pages/Group';
import { Activity } from './pages/Activity';
import { Account } from './pages/Account';
import { AddExpense } from './pages/AddExpense';
import { SettleUp } from './pages/SettleUp';
import { GroupSettings } from './pages/GroupSettings';
import './index.css';

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
    } else if (startParam.startsWith('join_')) {
      const inviteCode = startParam.slice('join_'.length);
      if (inviteCode) {
        api
          .resolveInvite(inviteCode)
          .then(async (info) => {
            try {
              await api.joinGroup(info.id, inviteCode);
            } catch (err) {
              if (!(err instanceof ApiError && err.errorCode === 'already_member')) throw err;
            }
            navigate(`/groups/${info.id}`);
          })
          .catch((err) => {
            console.error('Failed to handle join deep link:', err);
          });
      }
    } else if (startParam.startsWith('settle_')) {
      const id = startParam.slice('settle_'.length);
      if (id) navigate(`/settle/${id}`);
    } else if (startParam.startsWith('expense_')) {
      navigate('/');
    }
  }, [auth.authenticated, navigate]);

  if (auth.loading) {
    return <LoadingScreen />;
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
      {/* Routes with bottom tabs */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/account" element={<Account />} />
        <Route path="/groups/:id" element={<Group />} />
      </Route>

      {/* Full-screen routes (no tabs) */}
      <Route path="/groups/:id/settings" element={<GroupSettings />} />
      <Route path="/groups/:id/add-expense" element={<AddExpense />} />
      <Route path="/groups/:id/edit-expense/:expenseId" element={<AddExpense />} />
      <Route path="/settle/:id" element={<SettleUp />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
