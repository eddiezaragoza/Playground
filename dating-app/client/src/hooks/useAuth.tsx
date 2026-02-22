import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { connectSocket, disconnectSocket } from '../services/socket';
import { User, Preferences } from '../types';

interface AuthContextType {
  user: User | null;
  preferences: Preferences | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    email: string;
    password: string;
    displayName: string;
    age: number;
    gender: string;
  }) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const data = await api.getMe();
      setUser(data.user);
      setPreferences(data.preferences);
    } catch {
      api.setToken(null);
      setUser(null);
      setPreferences(null);
    }
  }, []);

  useEffect(() => {
    const token = api.getToken();
    if (token) {
      refreshUser().finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [refreshUser]);

  // Connect socket when authenticated
  useEffect(() => {
    if (user) {
      try {
        connectSocket();
      } catch {
        // Socket connection failed, non-critical
      }
    }
    return () => {
      if (!user) disconnectSocket();
    };
  }, [user]);

  const login = async (email: string, password: string) => {
    const data = await api.login(email, password);
    api.setToken(data.token);
    await refreshUser();
  };

  const register = async (regData: {
    email: string;
    password: string;
    displayName: string;
    age: number;
    gender: string;
  }) => {
    const data = await api.register(regData);
    api.setToken(data.token);
    await refreshUser();
  };

  const logout = () => {
    api.setToken(null);
    disconnectSocket();
    setUser(null);
    setPreferences(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        preferences,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
