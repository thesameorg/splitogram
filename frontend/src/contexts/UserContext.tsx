import { createContext, useContext, useState, type ReactNode, type SetStateAction } from 'react';

interface UserData {
  avatarKey: string | null;
  displayName: string;
  isAdmin: boolean;
  hasOutstandingDebts?: boolean;
}

interface UserContextValue {
  user: UserData | null;
  setUser: (value: SetStateAction<UserData | null>) => void;
}

const UserContext = createContext<UserContextValue>({
  user: null,
  setUser: () => {},
});

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserData | null>(null);
  return <UserContext.Provider value={{ user, setUser }}>{children}</UserContext.Provider>;
}

export function useUser() {
  return useContext(UserContext);
}
