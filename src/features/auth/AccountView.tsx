import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api.ts';
import { useAuthStore } from '../../stores/useAuthStore.ts';
import type { LiteraRoute } from '../../components/layout/TopBar.tsx';
import { MetadataLine } from '../../components/ui/EditorialPrimitives.tsx';

interface SessionRow {
  id: string;
  userAgent: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export function AccountView({ onNavigate }: { onNavigate: (r: LiteraRoute) => void }) {
  const { user, profile, authorProfile, refreshMe, logout, setAuthModalOpen } = useAuthStore();
  const queryClient = useQueryClient();

  const [displayName, setDisplayName] = useState(profile?.displayName || user?.displayName || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [penName, setPenName] = useState(authorProfile?.penName || user?.displayName || '');
  const [authorBio, setAuthorBio] = useState(authorProfile?.biography || '');
  const [websiteUrl, setWebsiteUrl] = useState(authorProfile?.websiteUrl || '');
  const [notice, setNotice] = useState<string | null>(null);

  const sessionsQuery = useQuery({
    queryKey: ['auth-sessions'],
    queryFn: () => apiFetch<{ currentSessionId: string | null; sessions: SessionRow[] }>('/api/auth/sessions'),
    enabled: Boolean(user),
  });

  const saveProfileMutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/auth/profile', {
        method: 'PATCH',
        json: { displayName, bio },
      }),
    onSuccess: async () => {
      await refreshMe();
      setNotice('Reader profile updated.');
    },
  });

  const saveAuthorMutation = useMutation({
    mutationFn: (requestVerification: boolean) =>
      apiFetch('/api/auth/author-profile', {
        method: 'POST',
        json: { penName, biography: authorBio, websiteUrl, requestVerification },
      }),
    onSuccess: async () => {
      await refreshMe();
      setNotice('Author dossier saved. Author Studio is now enabled.');
    },
  });

  const revokeSessionMutation = useMutation({
    mutationFn: (sessionId: string) =>
      apiFetch(`/api/auth/sessions/${sessionId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['auth-sessions'] });
      setNotice('Session revoked.');
    },
  });

  const revokeAllMutation = useMutation({
    mutationFn: () => apiFetch('/api/auth/sessions/revoke-all', { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['auth-sessions'] });
      setNotice('All other active sessions revoked.');
    },
  });

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="font-display text-3xl font-semibold text-[#1C1917]">Account & Security</h1>
        <p className="mt-3 text-sm text-[#57534E]">
          Sign in to manage your reader preferences, author credentials, and active sessions.
        </p>
        <button
          type="button"
          onClick={() => setAuthModalOpen(true)}
          className="mt-6 cursor-pointer bg-[#785032] px-6 py-2.5 text-sm font-medium text-[#FBF9F5]"
        >
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1060px] px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#E6DFD1] pb-6">
        <div>
          <MetadataLine items={[user.email, `Role: ${user.role}`, user.isVerified ? 'Email Verified' : 'Standard']} />
          <h1 className="font-display mt-2 text-3xl font-semibold text-[#1C1917]">
            Account, Author Credentials & Sessions
          </h1>
        </div>
        <button
          type="button"
          onClick={async () => {
            await logout();
            onNavigate({ name: 'library' });
          }}
          className="cursor-pointer border border-[#D6CEBE] bg-white px-4 py-2 text-xs font-medium text-[#1C1917] hover:border-[#991B1B] hover:text-[#991B1B]"
        >
          Sign Out
        </button>
      </div>

      {notice ? (
        <div className="mt-6 border border-[#166534]/30 bg-[#F0FDF4] px-4 py-3 text-sm text-[#166534]">
          {notice}
        </div>
      ) : null}

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        {/* Reader Profile */}
        <section className="border border-[#E6DFD1] bg-white p-7">
          <h2 className="font-display text-xl font-semibold text-[#1C1917]">Reader Profile</h2>
          <p className="mt-1 text-xs text-[#57534E]">
            Public display identity shown on reviews and chapter notes.
          </p>
          <div className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#1C1917]">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mt-1 w-full border border-[#D6CEBE] px-3 py-2 text-sm focus:border-[#785032] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#1C1917]">Short Biography</label>
              <textarea
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="mt-1 w-full border border-[#D6CEBE] px-3 py-2 text-sm focus:border-[#785032] focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => saveProfileMutation.mutate()}
              disabled={saveProfileMutation.isPending}
              className="cursor-pointer bg-[#785032] px-5 py-2 text-xs font-medium text-[#FBF9F5] hover:bg-[#5E3D24]"
            >
              {saveProfileMutation.isPending ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </section>

        {/* Author Credentials */}
        <section className="border border-[#E6DFD1] bg-white p-7">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-display text-xl font-semibold text-[#1C1917]">Author Dossier</h2>
            <span className="text-xs font-medium text-[#785032]">
              Status: {authorProfile?.verificationStatus || 'Not Activated'}
            </span>
          </div>
          <p className="mt-1 text-xs text-[#57534E]">
            Activate your Author profile to unlock manuscript creation in Author Studio.
          </p>
          <div className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#1C1917]">Pen Name</label>
              <input
                type="text"
                value={penName}
                onChange={(e) => setPenName(e.target.value)}
                className="mt-1 w-full border border-[#D6CEBE] px-3 py-2 text-sm focus:border-[#785032] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#1C1917]">Literary Biography</label>
              <textarea
                rows={3}
                value={authorBio}
                onChange={(e) => setAuthorBio(e.target.value)}
                className="mt-1 w-full border border-[#D6CEBE] px-3 py-2 text-sm focus:border-[#785032] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#1C1917]">Website or Portfolio</label>
              <input
                type="text"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://"
                className="mt-1 w-full border border-[#D6CEBE] px-3 py-2 text-sm focus:border-[#785032] focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => saveAuthorMutation.mutate(false)}
                disabled={saveAuthorMutation.isPending}
                className="cursor-pointer bg-[#785032] px-5 py-2 text-xs font-medium text-[#FBF9F5] hover:bg-[#5E3D24]"
              >
                Save Author Dossier
              </button>
              {authorProfile?.verificationStatus !== 'VERIFIED' ? (
                <button
                  type="button"
                  onClick={() => saveAuthorMutation.mutate(true)}
                  disabled={saveAuthorMutation.isPending}
                  className="cursor-pointer border border-[#D6CEBE] bg-[#FBF9F5] px-4 py-2 text-xs font-medium text-[#1C1917] hover:border-[#785032]"
                >
                  Request Editorial Verification
                </button>
              ) : null}
              {['AUTHOR', 'EDITOR', 'ADMIN'].includes(user.role) ? (
                <button
                  type="button"
                  onClick={() => onNavigate({ name: 'studio' })}
                  className="cursor-pointer border border-[#785032] px-4 py-2 text-xs font-medium text-[#785032] hover:bg-[#785032] hover:text-white"
                >
                  Open Author Studio
                </button>
              ) : null}
            </div>
          </div>
        </section>
      </div>

      {/* Session Security & Revocation */}
      <section className="mt-10 border border-[#E6DFD1] bg-white p-7">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E6DFD1] pb-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-[#1C1917]">Active Sessions</h2>
            <p className="mt-1 text-xs text-[#57534E]">
              Inspect and revoke active device sessions linked to your account.
            </p>
          </div>
          <button
            type="button"
            onClick={() => revokeAllMutation.mutate()}
            className="cursor-pointer border border-[#D6CEBE] px-4 py-2 text-xs font-medium text-[#1C1917] hover:border-[#991B1B] hover:text-[#991B1B]"
          >
            Revoke Other Sessions
          </button>
        </div>

        <div className="mt-4 divide-y divide-[#E6DFD1]">
          {(sessionsQuery.data?.sessions || []).map((sess) => {
            const isCurrent = sess.id === sessionsQuery.data?.currentSessionId;
            return (
              <div key={sess.id} className="flex flex-wrap items-center justify-between gap-4 py-3 text-xs">
                <div>
                  <div className="font-medium text-[#1C1917]">
                    {sess.userAgent ? sess.userAgent.slice(0, 72) : 'Web Browser Session'}
                    {isCurrent ? ' (Current)' : ''}
                  </div>
                  <div className="mt-0.5 text-[#57534E] tabular-nums">
                    Issued {new Date(sess.createdAt).toLocaleString()} · Expires{' '}
                    {new Date(sess.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <div>
                  {sess.revokedAt ? (
                    <span className="text-[#57534E]">Revoked</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => revokeSessionMutation.mutate(sess.id)}
                      className="cursor-pointer text-[#991B1B] hover:underline"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {sessionsQuery.data?.sessions.length === 0 ? (
            <p className="py-4 text-xs text-[#57534E]">
              Authenticated via federated Google ID token.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
