import { createContext, useContext } from 'react';
export const UI = createContext<{
  notify: (text: string, type?: 'success' | 'error') => void;
  me: any;
  date: string;
  setDate: (date: string) => void;
  openBooking: (walkIn?: boolean, services?: string[]) => void;
  openDetail: (b: any) => void;
  state: any;
  refresh: () => void;
}>({} as any);
export const useUI = () => useContext(UI);
