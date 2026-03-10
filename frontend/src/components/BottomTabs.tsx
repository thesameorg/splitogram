import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUser } from '../contexts/UserContext';
import { IconUsers, IconActivity, IconUser } from '../icons';
import { Avatar } from './Avatar';
import { hapticSelection } from '../utils/haptic';

export function BottomTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useUser();

  function isActive(path: string): boolean {
    if (path === '/') {
      return location.pathname === '/' || location.pathname.startsWith('/groups');
    }
    return location.pathname.startsWith(path);
  }

  const tabs = [
    { path: '/', label: t('tabs.groups'), icon: <IconUsers size={22} /> },
    { path: '/activity', label: t('tabs.feed'), icon: <IconActivity size={22} /> },
    {
      path: '/account',
      label: t('tabs.account'),
      icon: user?.avatarKey ? (
        <Avatar avatarKey={user.avatarKey} displayName={user.displayName} size="sm" />
      ) : (
        <IconUser size={22} />
      ),
    },
  ] as const;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 bg-tg-bottom-bar border-t border-tg-separator flex z-40"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {tabs.map((tab) => {
        const active = isActive(tab.path);
        return (
          <button
            key={tab.path}
            onClick={() => {
              hapticSelection();
              navigate(tab.path);
            }}
            className={`flex-1 flex flex-col items-center py-2 text-xs font-medium ${
              active ? 'text-tg-link' : 'text-tg-hint'
            }`}
          >
            <span className="mb-0.5 relative">
              {tab.icon}
              {tab.path === '/' && user?.hasOutstandingDebts && (
                <span className="absolute -top-1 -right-2.5 bg-red-500 text-white text-[8px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center leading-none">
                  !
                </span>
              )}
            </span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
