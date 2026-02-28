import type { ReactNode } from 'react';

export function PageLayout({ children }: { children: ReactNode }) {
  return <div className="p-4 pb-24">{children}</div>;
}
