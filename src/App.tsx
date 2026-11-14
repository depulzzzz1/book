import React, { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './lib/firebase.ts';
import { useAuthStore } from './stores/useAuthStore.ts';
import { useReaderPrefsStore } from './stores/useReaderPrefsStore.ts';
import { EditorialErrorBoundary } from './components/ui/EditorialPrimitives.tsx';
import { LiteraRoute, TopBar } from './components/layout/TopBar.tsx';
import { AuthModal } from './features/auth/AuthModal.tsx';
import { AccountView } from './features/auth/AccountView.tsx';
import { PublicLibraryView } from './features/library/PublicLibraryView.tsx';
import { UserShelfView } from './features/library/UserShelfView.tsx';
import { NovelDetailView } from './features/novel/NovelDetailView.tsx';
import { AuthorDossierView } from './features/novel/AuthorDossierView.tsx';
import { ReadingEngineView } from './features/reader/ReadingEngineView.tsx';
import { AuthorStudioView } from './features/studio/AuthorStudioView.tsx';
import { AdminDashboardView } from './features/admin/AdminDashboardView.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
    },
  },
});

function parseHashRoute(): LiteraRoute {
  const hash = window.location.hash.replace(/^#/, '');
  const parts = hash.split('/').filter(Boolean);
  if (parts[0] === 'novel' && parts[1] && parts[2] === 'read' && parts[3]) {
    return { name: 'read', slug: parts[1], chapterId: parts[3] };
  }
  if (parts[0] === 'novel' && parts[1]) {
    return { name: 'novel', slug: parts[1] };
  }
  if (parts[0] === 'author' && parts[1]) {
    return { name: 'author', userId: Number(parts[1]) };
  }
  if (parts[0] === 'shelf') return { name: 'shelf' };
  if (parts[0] === 'studio') return { name: 'studio' };
  if (parts[0] === 'admin') return { name: 'admin' };
  if (parts[0] === 'account') return { name: 'account' };
  return { name: 'library' };
}

function serializeHashRoute(route: LiteraRoute): string {
  switch (route.name) {
    case 'library':
      return '#/';
    case 'novel':
      return `#/novel/${route.slug}`;
    case 'read':
      return `#/novel/${route.slug}/read/${route.chapterId}`;
    case 'author':
      return `#/author/${route.userId}`;
    case 'shelf':
      return '#/shelf';
    case 'studio':
      return '#/studio';
    case 'admin':
      return '#/admin';
    case 'account':
      return '#/account';
  }
}

function LiteraShell() {
  const [route, setRoute] = useState<LiteraRoute>(() => parseHashRoute());
  const { refreshMe, setSession, profile } = useAuthStore();
  const hydrateFromProfile = useReaderPrefsStore((s) => s.hydrateFromProfile);

  useEffect(() => {
    void refreshMe();

    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        const token = await fbUser.getIdToken();
        setSession({ user: null, token });
        await refreshMe();
      }
    });

    const onHash = () => setRoute(parseHashRoute());
    window.addEventListener('hashchange', onHash);
    return () => {
      unsub();
      window.removeEventListener('hashchange', onHash);
    };
  }, [refreshMe, setSession]);

  useEffect(() => {
    if (profile) {
      hydrateFromProfile({
        preferredTheme: profile.preferredTheme,
        preferredFont: profile.preferredFont,
        preferredFontSize: profile.preferredFontSize,
        preferredLineHeight: profile.preferredLineHeight,
      });
    }
  }, [profile, hydrateFromProfile]);

  function navigate(next: LiteraRoute) {
    window.location.hash = serializeHashRoute(next);
    setRoute(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#FBF9F5] text-[#1C1917]">
      <TopBar route={route} onNavigate={navigate} />
      <main className="flex-1">
        {route.name === 'library' ? <PublicLibraryView onNavigate={navigate} /> : null}
        {route.name === 'novel' ? <NovelDetailView slug={route.slug} onNavigate={navigate} /> : null}
        {route.name === 'read' ? (
          <ReadingEngineView slug={route.slug} chapterId={route.chapterId} onNavigate={navigate} />
        ) : null}
        {route.name === 'author' ? (
          <AuthorDossierView userId={route.userId} onNavigate={navigate} />
        ) : null}
        {route.name === 'shelf' ? <UserShelfView onNavigate={navigate} /> : null}
        {route.name === 'studio' ? <AuthorStudioView onNavigate={navigate} /> : null}
        {route.name === 'admin' ? <AdminDashboardView /> : null}
        {route.name === 'account' ? <AccountView onNavigate={navigate} /> : null}
      </main>

      <footer className="border-t border-[#E6DFD1] bg-[#FBF9F5] py-8 text-xs text-[#57534E]">
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-4 px-6">
          <span className="font-display text-sm font-medium text-[#1C1917]">LITERA</span>
          <div className="flex gap-6">
            <button type="button" onClick={() => navigate({ name: 'library' })} className="cursor-pointer hover:text-[#1C1917]">
              Catalog
            </button>
            <button type="button" onClick={() => navigate({ name: 'shelf' })} className="cursor-pointer hover:text-[#1C1917]">
              Personal Shelf
            </button>
            <button type="button" onClick={() => navigate({ name: 'studio' })} className="cursor-pointer hover:text-[#1C1917]">
              Author Studio
            </button>
          </div>
          <span>© 2026 Litera Digital Literature Ecosystem</span>
        </div>
      </footer>

      <AuthModal />
    </div>
  );
}

export default function App() {
  return (
    <EditorialErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <LiteraShell />
      </QueryClientProvider>
    </EditorialErrorBoundary>
  );
}
