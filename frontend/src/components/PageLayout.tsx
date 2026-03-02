import type { ReactNode } from 'react';

export function PageLayout({ children }: { children: ReactNode }) {
  return (
    <div className="p-4" style={{ paddingBottom: 'calc(96px + env(safe-area-inset-bottom, 0px))' }}>
      {children}
    </div>
  );
}
