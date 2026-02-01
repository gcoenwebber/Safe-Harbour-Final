import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../config/supabaseClient';

interface UserMetadata {
    uin?: string;
    organization_id?: string;
    role?: string;
    ic_role?: string;
    full_name?: string;
}

interface AuthContextType {
    session: Session | null;
    user: User | null;
    userMeta: UserMetadata;
    loading: boolean;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    // Extract user metadata from JWT
    const userMeta: UserMetadata = {
        uin: user?.app_metadata?.uin || user?.user_metadata?.uin,
        organization_id: user?.app_metadata?.organization_id || user?.user_metadata?.organization_id,
        role: user?.app_metadata?.role || user?.user_metadata?.role,
        ic_role: user?.app_metadata?.ic_role || user?.user_metadata?.ic_role,
        full_name: user?.user_metadata?.full_name
    };

    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setUser(session?.user ?? null);
            setLoading(false);
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                setSession(session);
                setUser(session?.user ?? null);
                setLoading(false);
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    const signOut = async () => {
        await supabase.auth.signOut();
        setSession(null);
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ session, user, userMeta, loading, signOut }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

export default AuthContext;
