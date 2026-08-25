import { createContext, useContext } from 'react';


export const ReaderAuthContext = createContext(null);

export function useReaderAuth() {
  const value = useContext(ReaderAuthContext);
  if (!value) throw new Error('useReaderAuth 必须在 ReaderAuthProvider 中使用');
  return value;
}
