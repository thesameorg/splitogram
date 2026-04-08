import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import usertour from 'usertour.js';
import { useAuth } from './hooks/useAuth';
import { api, ApiError } from './services/api';
import { UserProvider, useUser } from './contexts/UserContext';
import { config } from './config';
import { AppLayout } from './components/AppLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingScreen } from './components/LoadingScreen';
import { LanguagePickerModal } from './components/LanguagePickerModal';
import { Home } from './pages/Home';
import { Group } from './pages/Group';
import { Activity } from './pages/Activity';
import { Account } from './pages/Account';
import { AddExpense } from './pages/AddExpense';
import { SettleManual } from './pages/SettleManual';
import { SettleCrypto } from './pages/SettleCrypto';
import { GroupSettings } from './pages/GroupSettings';
import { ExpenseDetail } from './pages/ExpenseDetail';
import './index.css';

function AppContent() {
  const auth = useAuth();
  const navigate = useNavigate();
  const deepLinkHandled = useRef(false);
  const { t } = useTranslation();
  const { setUser } = useUser();
  const [showLangPicker, setShowLangPicker] = useState(false);

  // Show language picker modal for first-time users
  useEffect(() => {
    if (auth.authenticated && auth.isNewUser) {
      setShowLangPicker(true);
    }
  }, [auth.authenticated, auth.isNewUser]);

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (webApp) {
      webApp.ready();
      webApp.expand();
      document.documentElement.dataset.theme = webApp.colorScheme;
    }
  }, []);

  // Fetch user profile after auth to populate UserContext + identify in Usertour
  useEffect(() => {
    if (!auth.authenticated) return;
    api
      .getMe()
      .then((profile) => {
        setUser({
          avatarKey: profile.avatarKey,
          displayName: profile.displayName,
          isAdmin: auth.isAdmin,
        });

        // Initialize Usertour for user onboarding flows
        const token = import.meta.env.VITE_USERTOUR_TOKEN;
        if (token && auth.userId) {
          usertour.init(token);
          usertour.identify(String(auth.userId), {
            name: profile.displayName || undefined,
            email: `id${profile.telegramId}@t.me`,
            telegram_id: profile.telegramId,
            username: profile.username || undefined,
            signed_up_at: auth.isNewUser ? new Date().toISOString() : undefined,
          });
        }
      })
      .catch(() => {});
  }, [auth.authenticated, auth.isAdmin, auth.userId, auth.isNewUser, setUser]);

  // Deep link routing: read startParam after auth succeeds
  useEffect(() => {
    if (!auth.authenticated || deepLinkHandled.current) return;
    deepLinkHandled.current = true;

    const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    if (!startParam) return;

    if (startParam.startsWith('group_')) {
      const id = startParam.slice('group_'.length);
      if (id) navigate(`/groups/${id}`);
    } else if (startParam.startsWith('jp_')) {
      // Personalized placeholder invite: jp_{inviteCode}_{placeholderId}
      const rest = startParam.slice(3); // skip "jp_"
      const sepIdx = rest.indexOf('_');
      const inviteCode = sepIdx > 0 ? rest.slice(0, sepIdx) : '';
      const placeholderId = sepIdx > 0 ? parseInt(rest.slice(sepIdx + 1), 10) : NaN;
      if (inviteCode && !isNaN(placeholderId)) {
        api
          .resolveInvite(inviteCode)
          .then(async (info) => {
            try {
              await api.joinGroup(info.id, inviteCode);
            } catch (err) {
              if (!(err instanceof ApiError && err.errorCode === 'already_member')) throw err;
            }
            // Auto-claim the placeholder; silently ignore all errors
            try {
              await api.claimPlaceholder(info.id, placeholderId);
            } catch {
              // Placeholder already claimed, user is admin, already claimed another, etc.
            }
            navigate(`/groups/${info.id}?joined=1`);
          })
          .catch((err) => {
            console.error('Failed to handle personalized invite link:', err);
          });
      }
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
            navigate(`/groups/${info.id}?joined=1`);
          })
          .catch((err) => {
            console.error('Failed to handle join deep link:', err);
          });
      }
    } else if (startParam.startsWith('settle_')) {
      const id = startParam.slice('settle_'.length);
      if (id) navigate(`/settle/${id}/manual`);
    } else if (startParam.startsWith('expense_')) {
      // Format: expense_{groupId}_{expenseId}
      const parts = startParam.slice('expense_'.length).split('_');
      if (parts.length === 2) {
        navigate(`/groups/${parts[0]}/expense/${parts[1]}`);
      } else {
        navigate('/');
      }
    }
  }, [auth.authenticated, navigate]);

  if (auth.loading) {
    return <LoadingScreen />;
  }

  if (!auth.authenticated) {
    const insideTelegram = !!window.Telegram?.WebApp && !window.Telegram.WebApp.initData;
    return (
      <div className="flex items-center justify-center min-h-screen p-4 text-center bg-tg-bg text-tg-text">
        <div>
          <h1 className="text-xl font-bold mb-2">{t('app.title')}</h1>
          <p className="text-tg-hint mb-4">
            {insideTelegram ? t('app.updateTelegram') : t('app.openFromTelegram')}
          </p>
          {config.telegramBotUsername && (
            <a
              href={`https://t.me/${config.telegramBotUsername}`}
              className="text-tg-link font-medium"
            >
              @{config.telegramBotUsername}
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {showLangPicker && <LanguagePickerModal onDone={() => setShowLangPicker(false)} />}
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
        <Route path="/groups/:id/expense/:expenseId" element={<ExpenseDetail />} />
        <Route path="/groups/:id/edit-expense/:expenseId" element={<AddExpense />} />
        <Route path="/settle/:id/manual" element={<SettleManual />} />
        <Route path="/settle/:id/ton" element={<SettleCrypto />} />
      </Routes>
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <TonConnectUIProvider manifestUrl={config.tonConnectManifestUrl}>
        <BrowserRouter>
          <UserProvider>
            <AppContent />
          </UserProvider>
        </BrowserRouter>
      </TonConnectUIProvider>
    </ErrorBoundary>
  );
}

export default App;
