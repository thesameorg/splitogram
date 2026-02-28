import { Outlet } from 'react-router-dom';
import { BottomTabs } from './BottomTabs';

export function AppLayout() {
  return (
    <>
      <Outlet />
      <BottomTabs />
    </>
  );
}
