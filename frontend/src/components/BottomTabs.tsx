import { useLocation, useNavigate } from 'react-router-dom';

const tabs = [
  { path: '/', label: 'Groups', icon: 'G' },
  { path: '/activity', label: 'Activity', icon: 'A' },
  { path: '/account', label: 'Account', icon: 'U' },
] as const;

export function BottomTabs() {
  const location = useLocation();
  const navigate = useNavigate();

  function isActive(path: string): boolean {
    if (path === '/') {
      return location.pathname === '/' || location.pathname.startsWith('/groups');
    }
    return location.pathname.startsWith(path);
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex z-40">
      {tabs.map((tab) => {
        const active = isActive(tab.path);
        return (
          <button
            key={tab.path}
            onClick={() => navigate(tab.path)}
            className={`flex-1 flex flex-col items-center py-2 text-xs font-medium ${
              active ? 'text-blue-500' : 'text-gray-400'
            }`}
          >
            <span className="text-lg mb-0.5">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
