"use client";

import { createContext, useContext, type ReactNode } from "react";

/** docs 内登录态上下文：server 在 quickstart 页注入真实值；未包裹时默认未登录。 */
const DocsAuthContext = createContext<{ authed: boolean }>({ authed: false });

export function AuthProvider({
  authed,
  children,
}: {
  authed: boolean;
  children: ReactNode;
}) {
  return (
    <DocsAuthContext.Provider value={{ authed }}>
      {children}
    </DocsAuthContext.Provider>
  );
}

export function useDocsAuth() {
  return useContext(DocsAuthContext);
}
