import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { apiFetch } from '../../lib/api.ts';
import { useAuthStore } from '../../stores/useAuthStore.ts';
import type { LiteraRoute } from '../../components/layout/TopBar.tsx';
import {
  BookCover,
  EditorialSkeleton,
  EmptyEditorialState,
  MetadataLine,
} from '../../components/ui/EditorialPrimitives.tsx';
import type {
  BookmarkItem,
  NotificationItem,
  ReadingList,
  ReadingProgressItem,
} from '../../types/litera.ts';

interface LibraryResponse {
  history: ReadingProgressItem[];
  bookmarks: BookmarkItem[];
  lists: ReadingList[];
  following: Array<{
    authorId: number;
    penName: string | null;
    displayName: string | null;
    verificationStatus: string | null;
  }>;
}

export function UserShelfView({ onNavigate }: { onNavigate: (r: LiteraRoute) => void }) {
  const { user, refreshMe, setAuthModalOpen } = useAuthStore();
  const queryClient = useQueryClient();
  const [newListName, setNewListName] = useState('');
  const [newListDesc, setNewListDesc] = useState('');

  const libraryQuery = useQuery({
    queryKey: ['reader-library'],
    queryFn: () => apiFetch<LibraryResponse>('/api/reader/library'),
    enabled: Boolean(user),
  });

  const notificationsQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiFetch<{ notifications: NotificationItem[] }>('/api/community/notifications'),
    enabled: Boolean(user),
  });

  const createListMutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/reader/lists', {
        method: 'POST',
        json: { name: newListName, description: newListDesc, visibility: 'PRIVATE' },
      }),
    onSuccess: () => {
      setNewListName('');
      setNewListDesc('');
      void queryClient.invalidateQueries({ queryKey: ['reader-library'] });
    },
  });

  const deleteBookmarkMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/reader/bookmarks/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['reader-library'] }),
  });

  const deleteListMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/reader/lists/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['reader-library'] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => apiFetch('/api/community/notifications/read-all', { method: 'POST' }),
    onSuccess: async () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      await refreshMe();
    },
  });

  if (!user) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <EmptyEditorialState
          title="Your Personal Shelf"
          description="Sign in to track reading progress, organize reading lists, and manage bookmarks."
          actionLabel="Sign In"
          onAction={() => setAuthModalOpen(true)}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1260px] px-6 py-12 pb-20">
      <div className="border-b border-[#E6DFD1] pb-6">
        <MetadataLine items={['Personal Library', user.displayName]} />
        <h1 className="font-display mt-2 text-3xl font-semibold text-[#1C1917]">
          Reading Shelf & Annotations
        </h1>
      </div>

      {libraryQuery.isLoading ? (
        <EditorialSkeleton lines={6} />
      ) : (
        <div className="mt-10 space-y-14">
          {/* Continue Reading */}
          <section>
            <h2 className="font-display text-2xl font-semibold text-[#1C1917]">Reading History</h2>
            <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {(libraryQuery.data?.history || []).map((item) => (
                <div key={item.id} className="flex gap-4 border border-[#E6DFD1] bg-white p-4">
                  <div className="w-20 shrink-0">
                    <BookCover src={item.novelCoverUrl} title={item.novelTitle} />
                  </div>
                  <div className="flex flex-1 flex-col justify-between">
                    <div>
                      <button
                        type="button"
                        onClick={() => onNavigate({ name: 'novel', slug: item.novelSlug })}
                        className="font-display cursor-pointer text-left text-base font-semibold text-[#1C1917] hover:text-[#785032]"
                      >
                        {item.novelTitle}
                      </button>
                      <div className="mt-1 text-xs text-[#57534E]">
                        Ch. {item.chapterNumber}: {item.chapterTitle}
                      </div>
                      <div className="mt-2 h-1.5 w-full bg-[#F3EFE6]">
                        <div
                          className="h-full bg-[#785032]"
                          style={{ width: `${Math.min(100, Math.round(item.progressPercent))}%` }}
                        />
                      </div>
                      <div className="mt-1 text-[11px] text-[#57534E] tabular-nums">
                        {Math.round(item.progressPercent)}% complete
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onNavigate({ name: 'read', slug: item.novelSlug, chapterId: item.chapterId })
                      }
                      className="mt-3 cursor-pointer self-start text-xs font-medium text-[#785032] hover:underline"
                    >
                      Resume Reading
                    </button>
                  </div>
                </div>
              ))}
              {(libraryQuery.data?.history || []).length === 0 ? (
                <p className="text-sm text-[#57534E]">No reading history recorded yet.</p>
              ) : null}
            </div>
          </section>

          {/* Personal Reading Lists */}
          <section className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <h2 className="font-display text-2xl font-semibold text-[#1C1917]">Personal Collections</h2>
              <div className="mt-5 space-y-5">
                {(libraryQuery.data?.lists || []).map((list) => (
                  <div key={list.id} className="border border-[#E6DFD1] bg-white p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-display text-lg font-semibold text-[#1C1917]">{list.name}</h3>
                        {list.description ? (
                          <p className="mt-1 text-xs text-[#57534E]">{list.description}</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteListMutation.mutate(list.id)}
                        aria-label={`Delete list ${list.name}`}
                        className="cursor-pointer p-1 text-[#57534E] hover:text-[#991B1B]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-4">
                      {list.items.map((item) => (
                        <button
                          key={item.novelId}
                          type="button"
                          onClick={() => onNavigate({ name: 'novel', slug: item.novelSlug })}
                          className="cursor-pointer border border-[#E6DFD1] px-3 py-1.5 text-xs font-medium text-[#1C1917] hover:border-[#785032]"
                        >
                          {item.novelTitle}
                        </button>
                      ))}
                      {list.items.length === 0 ? (
                        <span className="text-xs text-[#57534E]">
                          Open any novel detail page to save works into this collection.
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-4">
              <div className="border border-[#E6DFD1] bg-white p-6">
                <h3 className="font-display text-lg font-semibold text-[#1C1917]">New Collection</h3>
                <div className="mt-4 space-y-3">
                  <input
                    type="text"
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    placeholder="Collection title..."
                    className="w-full border border-[#D6CEBE] px-3 py-2 text-sm"
                  />
                  <textarea
                    rows={2}
                    value={newListDesc}
                    onChange={(e) => setNewListDesc(e.target.value)}
                    placeholder="Short curatorial note..."
                    className="w-full border border-[#D6CEBE] px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    disabled={newListName.trim().length < 2 || createListMutation.isPending}
                    onClick={() => createListMutation.mutate()}
                    className="cursor-pointer bg-[#785032] px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                  >
                    Create Collection
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Bookmarks & Notifications */}
          <section className="grid gap-10 lg:grid-cols-2">
            <div>
              <h2 className="font-display text-2xl font-semibold text-[#1C1917]">Saved Bookmarks</h2>
              <div className="mt-5 space-y-4">
                {(libraryQuery.data?.bookmarks || []).map((bm) => (
                  <div key={bm.id} className="border border-[#E6DFD1] bg-white p-5">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          onNavigate({ name: 'read', slug: bm.novelSlug, chapterId: bm.chapterId })
                        }
                        className="font-display cursor-pointer text-left text-base font-semibold text-[#1C1917] hover:text-[#785032]"
                      >
                        {bm.novelTitle} · Ch. {bm.chapterNumber}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteBookmarkMutation.mutate(bm.id)}
                        className="cursor-pointer text-xs text-[#57534E] hover:text-[#991B1B]"
                      >
                        Remove
                      </button>
                    </div>
                    {bm.note ? <p className="mt-2 text-sm text-[#1C1917]">{bm.note}</p> : null}
                    <p className="font-prose mt-1 text-xs text-[#57534E] italic">"{bm.quoteExcerpt}"</p>
                  </div>
                ))}
                {(libraryQuery.data?.bookmarks || []).length === 0 ? (
                  <p className="text-sm text-[#57534E]">No bookmarks saved yet.</p>
                ) : null}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl font-semibold text-[#1C1917]">Notifications</h2>
                <button
                  type="button"
                  onClick={() => markAllReadMutation.mutate()}
                  className="cursor-pointer text-xs font-medium text-[#785032] hover:underline"
                >
                  Mark all read
                </button>
              </div>
              <div className="mt-5 space-y-3">
                {(notificationsQuery.data?.notifications || []).map((n) => (
                  <div
                    key={n.id}
                    className={`border border-[#E6DFD1] p-4 ${n.readAt ? 'bg-white' : 'bg-[#F3EFE6]'}`}
                  >
                    <div className="flex items-center justify-between text-xs text-[#57534E]">
                      <span>{n.type}</span>
                      <span className="tabular-nums">{new Date(n.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="mt-1 text-sm font-medium text-[#1C1917]">{n.title}</div>
                    <p className="mt-1 text-xs text-[#57534E]">{n.message}</p>
                  </div>
                ))}
                {(notificationsQuery.data?.notifications || []).length === 0 ? (
                  <p className="text-sm text-[#57534E]">You are caught up on all editorial dispatches.</p>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
