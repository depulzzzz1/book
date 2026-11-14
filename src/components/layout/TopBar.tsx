import React from 'react';
import { useAuthStore } from '../../stores/useAuthStore.ts';

export type LiteraRoute =
  | { name: 'library' }
  | { name: 'novel'; slug: string }
  | { name: 'read'; slug: string; chapterId: string }
  | { name: 'author'; userId: number }
  | { name: 'shelf' }
  | { name: 'studio' }
  | { name: 'admin' }
  | { name: 'account' };

interface TopBarProps {
  route: LiteraRoute;
  onNavigate: (route: LiteraRoute) => void;
}

export function TopBar({ route, onNavigate }: TopBarProps) {
  const { user, unreadNotifications, setAuthModalOpen } = useAuthStore();

  const canAccessStudio = user && ['AUTHOR', 'EDITOR', 'ADMIN'].includes(user.role);
  const canAccessAdmin = user && ['EDITOR', 'ADMIN'].includes(user.role);

  return (
    <header className="sticky top-0 z-30 border-b border-[#E6DFD1] bg-[#FBF9F5]/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1360px] items-center justify-between gap-8 px-6 py-4">
        {/* Zone 1: Single-element Brand Wordmark */}
        <button
          type="button"
          onClick={() => onNavigate({ name: 'library' })}
          className="font-display cursor-pointer text-2xl font-semibold tracking-tight text-[#1C1917] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#785032]"
        >
          LITERA
        </button>

        {/* Zone 2: Concise single-line navigation links */}
        <nav
          aria-label="Primary navigation"
          className="flex items-center gap-6 overflow-x-auto text-sm font-medium text-[#57534E]"
        >
          <button
            type="button"
            onClick={() => onNavigate({ name: 'library' })}
            className={`cursor-pointer border-b-2 py-1 transition-colors whitespace-nowrap shrink-0 ${
              route.name === 'library' || route.name === 'novel' || route.name === 'author'
                ? 'border-[#785032] text-[#1C1917]'
                : 'border-transparent hover:text-[#1C1917]'
            }`}
          >
            Library
          </button>

          <button
            type="button"
            onClick={() => {
              if (!user) {
                setAuthModalOpen(true);
                return;
              }
              onNavigate({ name: 'shelf' });
            }}
            className={`cursor-pointer border-b-2 py-1 transition-colors whitespace-nowrap shrink-0 ${
              route.name === 'shelf'
                ? 'border-[#785032] text-[#1C1917]'
                : 'border-transparent hover:text-[#1C1917]'
            }`}
          >
            {unreadNotifications > 0 ? `My Shelf (${unreadNotifications})` : 'My Shelf'}
          </button>

          <button
            type="button"
            onClick={() => {
              if (!user) {
                setAuthModalOpen(true);
                return;
              }
              if (canAccessStudio) {
                onNavigate({ name: 'studio' });
              } else {
                onNavigate({ name: 'account' });
              }
            }}
            className={`cursor-pointer border-b-2 py-1 transition-colors whitespace-nowrap shrink-0 ${
              route.name === 'studio'
                ? 'border-[#785032] text-[#1C1917]'
                : 'border-transparent hover:text-[#1C1917]'
            }`}
          >
            Author Studio
          </button>

          {canAccessAdmin ? (
            <button
              type="button"
              onClick={() => onNavigate({ name: 'admin' })}
              className={`cursor-pointer border-b-2 py-1 transition-colors whitespace-nowrap shrink-0 ${
                route.name === 'admin'
                  ? 'border-[#785032] text-[#1C1917]'
                  : 'border-transparent hover:text-[#1C1917]'
              }`}
            >
              Governance
            </button>
          ) : null}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          {user ? (
            <button
              type="button"
              onClick={() => onNavigate({ name: 'account' })}
              className="cursor-pointer border border-[#D6CEBE] bg-white px-4 py-2 text-xs font-medium text-[#1C1917] transition-colors hover:border-[#785032] hover:text-[#785032] whitespace-nowrap shrink-0"
            >
              {user.displayName}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="cursor-pointer bg-[#785032] px-5 py-2 text-xs font-medium text-[#FBF9F5] transition-colors hover:bg-[#5E3D24] whitespace-nowrap shrink-0"
            >
              Sign In
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
