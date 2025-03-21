'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter, usePathname } from 'next/navigation';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClientComponentClient();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user || null);
      setLoading(false);

      // Handle protected routes
      const isAuthRoute = pathname.startsWith('/auth/');
      const isMainPage = pathname === '/main';
      const isHomePage = pathname === '/';

      if (session) {
        // User is logged in
        if (isAuthRoute) {
          // Redirect away from auth pages if already logged in
          router.push('/main');
        }
      } else {
        // User is not logged in
        if (isMainPage) {
          // Redirect to sign in if trying to access protected page
          router.push('/auth/signin');
        }
      }
    };

    getSession();

    // Set up auth state change listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null);
      
      // Handle auth state changes
      if (event === 'SIGNED_IN') {
        router.push('/main');
      } else if (event === 'SIGNED_OUT') {
        router.push('/');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [pathname, router]);

  const value = {
    user,
    loading,
    signOut: async () => {
      await supabase.auth.signOut();
      router.push('/');
    }
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 