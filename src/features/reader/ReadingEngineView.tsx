import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bookmark, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { apiFetch } from '../../lib/api.ts';
import { useAuthStore } from '../../stores/useAuthStore.ts';
import { useReaderPrefsStore } from '../../stores/useReaderPrefsStore.ts';
import type { LiteraRoute } from '../../components/layout/TopBar.tsx';
import { EditorialSkeleton, EmptyEditorialState, MetadataLine } from '../../components/ui/EditorialPrimitives.tsx';
import type { ChapterFull, CommentItem, ReaderTheme } from '../../types/litera.ts';

interface ChapterReadResponse {
  novel: { id: string; slug: string; title: string; authorId: number };
  chapter: ChapterFull;
  prevChapter: { id: string; chapterNumber: number; title: string } | null;
  nextChapter: { id: string; chapterNumber: number; title: string } | null;
  allChapters: Array<{ id: string; chapterNumber: number; title: string; status: string }>;
  comments: CommentItem[];
  readability: {
    word_count: number;
    avg_sentence_length: number;
    lexical_diversity: number;
    reading_ease_score: number;
    estimated_minutes: number;
  } | null;
}

const THEME_STYLES: Record<
  ReaderTheme,
  { bg: string; surface: string; text: string; muted: string; border: string }
> = {
  ivory: {
    bg: 'bg-[#FBF9F5]',
    surface: 'bg-white',
    text: 'text-[#1C1917]',
    muted: 'text-[#57534E]',
    border: 'border-[#E6DFD1]',
  },
  sepia: {
    bg: 'bg-[#F2E8D5]',
    surface: 'bg-[#F7EFE0]',
    text: 'text-[#3B2F23]',
    muted: 'text-[#6D5A47]',
    border: 'border-[#DFD1B8]',
  },
  dark: {
    bg: 'bg-[#161412]',
    surface: 'bg-[#1F1C19]',
    text: 'text-[#E7E2DA]',
    muted: 'text-[#A8A095]',
    border: 'border-[#332E29]',
  },
};

export function ReadingEngineView({
  slug,
  chapterId,
  onNavigate,
}: {
  slug: string;
  chapterId: string;
  onNavigate: (r: LiteraRoute) => void;
}) {
  const { user, setAuthModalOpen } = useAuthStore();
  const prefs = useReaderPrefsStore();
  const queryClient = useQueryClient();

  const [controlsOpen, setControlsOpen] = useState(false);
  const [bookmarkNote, setBookmarkNote] = useState('');
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [scrollDepth, setScrollDepth] = useState(0);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const lastSyncRef = useRef<number>(0);

  const chapterQuery = useQuery({
    queryKey: ['chapter-read', slug, chapterId],
    queryFn: () => apiFetch<ChapterReadResponse>(`/api/novels/${slug}/chapters/${chapterId}`),
  });

  const syncProgressMutation = useMutation({
    mutationFn: (payload: {
      novelId: string;
      chapterId: string;
      scrollPercent: number;
      progressPercent: number;
    }) =>
      apiFetch('/api/reader/progress', {
        method: 'POST',
        json: payload,
      }),
    onSuccess: () => {
      setSyncNotice('Progress saved');
    },
  });

  const bookmarkMutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/reader/bookmarks', {
        method: 'POST',
        json: {
          novelId: chapterQuery.data!.novel.id,
          chapterId,
          paragraphIndex: Math.round(scrollDepth),
          quoteExcerpt: chapterQuery.data!.chapter.plainExcerpt.slice(0, 140),
          note: bookmarkNote,
        },
      }),
    onSuccess: () => {
      setBookmarkNote('');
      setBookmarkOpen(false);
      setSyncNotice('Bookmark saved to your shelf');
      void queryClient.invalidateQueries({ queryKey: ['reader-library'] });
    },
  });

  const commentMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/community/chapters/${chapterId}/comments`, {
        method: 'POST',
        json: { body: commentBody },
      }),
    onSuccess: () => {
      setCommentBody('');
      void queryClient.invalidateQueries({ queryKey: ['chapter-read', slug, chapterId] });
    },
  });

  const savePrefsMutation = useMutation({
    mutationFn: (next: Partial<{ theme: ReaderTheme; font: 'serif' | 'sans'; fontSize: number; lineHeight: number }>) =>
      apiFetch('/api/auth/profile', {
        method: 'PATCH',
        json: {
          preferredTheme: next.theme ?? prefs.theme,
          preferredFont: next.font ?? prefs.font,
          preferredFontSize: next.fontSize ?? prefs.fontSize,
          preferredLineHeight: next.lineHeight ?? prefs.lineHeight,
        },
      }),
  });

  // Track reading scroll progress and sync periodically
  useEffect(() => {
    const data = chapterQuery.data;
    if (!data) return;

    function handleScroll() {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const pct = docHeight > 0 ? Math.min(100, Math.max(0, (window.scrollY / docHeight) * 100)) : 100;
      setScrollDepth(Math.round(pct));

      if (user && Date.now() - lastSyncRef.current > 6000 && data) {
        lastSyncRef.current = Date.now();
        const chIndex = data.allChapters.findIndex((c) => c.id === chapterId);
        const overall =
          data.allChapters.length > 0
            ? Math.round(((Math.max(0, chIndex) + pct / 100) / data.allChapters.length) * 100)
            : Math.round(pct);
        syncProgressMutation.mutate({
          novelId: data.novel.id,
          chapterId,
          scrollPercent: Math.round(pct),
          progressPercent: overall,
        });
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [chapterQuery.data, chapterId, user]);

  // Initial progress mark when opening chapter
  useEffect(() => {
    const data = chapterQuery.data;
    if (!user || !data) return;
    const chIndex = data.allChapters.findIndex((c) => c.id === chapterId);
    const overall =
      data.allChapters.length > 0
        ? Math.max(1, Math.round(((Math.max(0, chIndex) + 0.1) / data.allChapters.length) * 100))
        : 10;
    syncProgressMutation.mutate({
      novelId: data.novel.id,
      chapterId,
      scrollPercent: 0,
      progressPercent: overall,
    });
  }, [chapterId, Boolean(chapterQuery.data), Boolean(user)]);

  const theme = THEME_STYLES[prefs.theme];

  const proseStyle = useMemo<React.CSSProperties>(
    () => ({
      fontSize: `${prefs.fontSize}px`,
      lineHeight: prefs.lineHeight,
      fontFamily: prefs.font === 'serif' ? 'var(--font-serif-body)' : 'var(--font-sans)',
    }),
    [prefs.fontSize, prefs.lineHeight, prefs.font]
  );

  if (chapterQuery.isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <EditorialSkeleton lines={10} />
      </div>
    );
  }

  if (chapterQuery.isError || !chapterQuery.data) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <EmptyEditorialState
          title="Chapter unavailable"
          description="This chapter could not be loaded."
          actionLabel="Return to Novel"
          onAction={() => onNavigate({ name: 'novel', slug })}
        />
      </div>
    );
  }

  const { novel, chapter, prevChapter, nextChapter, allChapters, comments, readability } =
    chapterQuery.data;

  return (
    <div className={`min-h-screen transition-colors duration-200 ${theme.bg} ${theme.text}`}>
      {/* Sticky Minimal Chapter Progress & Reader Toolbar */}
      <div className={`sticky top-[65px] z-20 border-b ${theme.border} ${theme.bg}/95 backdrop-blur-xs`}>
        <div className="mx-auto flex max-w-[1060px] items-center justify-between gap-4 px-6 py-3">
          <button
            type="button"
            onClick={() => onNavigate({ name: 'novel', slug: novel.slug })}
            className={`inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium ${theme.muted} hover:opacity-80`}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="max-w-[200px] truncate">{novel.title}</span>
          </button>

          <div className="flex items-center gap-3">
            <select
              aria-label="Select chapter"
              value={chapter.id}
              onChange={(e) => onNavigate({ name: 'read', slug: novel.slug, chapterId: e.target.value })}
              className={`border ${theme.border} ${theme.surface} px-2.5 py-1 text-xs`}
            >
              {allChapters.map((c) => (
                <option key={c.id} value={c.id}>
                  Ch. {c.chapterNumber}: {c.title}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => {
                if (!user) {
                  setAuthModalOpen(true);
                  return;
                }
                setBookmarkOpen(!bookmarkOpen);
              }}
              title="Bookmark this passage"
              className={`inline-flex cursor-pointer items-center gap-1.5 border ${theme.border} ${theme.surface} px-3 py-1 text-xs`}
            >
              <Bookmark className="h-3.5 w-3.5" />
              <span>Bookmark</span>
            </button>

            <button
              type="button"
              onClick={() => setControlsOpen(!controlsOpen)}
              className={`inline-flex cursor-pointer items-center gap-1.5 border ${theme.border} ${theme.surface} px-3 py-1 text-xs`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Typography</span>
            </button>
          </div>
        </div>

        {/* Reading depth progress bar */}
        <div className="h-[2px] w-full bg-black/5">
          <div
            className="h-full bg-[#785032] transition-[width] duration-150"
            style={{ width: `${scrollDepth}%` }}
          />
        </div>
      </div>

      {/* Typography & Theme Configuration Panel */}
      {controlsOpen ? (
        <div className={`border-b ${theme.border} ${theme.surface}`}>
          <div className="mx-auto grid max-w-[900px] gap-6 px-6 py-5 sm:grid-cols-4">
            <div>
              <div className={`text-xs font-medium ${theme.muted}`}>Surface Theme</div>
              <div className="mt-2 flex gap-1.5">
                {(['ivory', 'sepia', 'dark'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      prefs.setTheme(t);
                      if (user) savePrefsMutation.mutate({ theme: t });
                    }}
                    className={`cursor-pointer border px-2.5 py-1 text-xs capitalize ${
                      prefs.theme === t ? 'border-[#785032] bg-[#785032] text-white' : theme.border
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className={`text-xs font-medium ${theme.muted}`}>Typeface</div>
              <div className="mt-2 flex gap-1.5">
                {(['serif', 'sans'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      prefs.setFont(f);
                      if (user) savePrefsMutation.mutate({ font: f });
                    }}
                    className={`cursor-pointer border px-3 py-1 text-xs capitalize ${
                      prefs.font === f ? 'border-[#785032] bg-[#785032] text-white' : theme.border
                    }`}
                  >
                    {f === 'serif' ? 'Book Serif' : 'Clean Sans'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className={`text-xs font-medium tabular-nums ${theme.muted}`}>
                Size ({prefs.fontSize}px)
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const next = prefs.fontSize - 1;
                    prefs.setFontSize(next);
                    if (user) savePrefsMutation.mutate({ fontSize: next });
                  }}
                  className={`cursor-pointer border ${theme.border} px-3 py-1 text-xs`}
                >
                  A-
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = prefs.fontSize + 1;
                    prefs.setFontSize(next);
                    if (user) savePrefsMutation.mutate({ fontSize: next });
                  }}
                  className={`cursor-pointer border ${theme.border} px-3 py-1 text-xs`}
                >
                  A+
                </button>
              </div>
            </div>

            <div>
              <div className={`text-xs font-medium tabular-nums ${theme.muted}`}>
                Leading ({prefs.lineHeight.toFixed(2)})
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const next = Number((prefs.lineHeight - 0.1).toFixed(2));
                    prefs.setLineHeight(next);
                    if (user) savePrefsMutation.mutate({ lineHeight: next });
                  }}
                  className={`cursor-pointer border ${theme.border} px-2.5 py-1 text-xs`}
                >
                  Tighter
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = Number((prefs.lineHeight + 0.1).toFixed(2));
                    prefs.setLineHeight(next);
                    if (user) savePrefsMutation.mutate({ lineHeight: next });
                  }}
                  className={`cursor-pointer border ${theme.border} px-2.5 py-1 text-xs`}
                >
                  Airy
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Bookmark Drawer */}
      {bookmarkOpen ? (
        <div className={`border-b ${theme.border} ${theme.surface}`}>
          <div className="mx-auto flex max-w-[720px] flex-wrap items-center gap-3 px-6 py-4">
            <input
              type="text"
              value={bookmarkNote}
              onChange={(e) => setBookmarkNote(e.target.value)}
              placeholder="Optional margin note for this bookmark..."
              className={`flex-1 border ${theme.border} bg-transparent px-3 py-2 text-xs focus:outline-none`}
            />
            <button
              type="button"
              onClick={() => bookmarkMutation.mutate()}
              className="cursor-pointer bg-[#785032] px-4 py-2 text-xs font-medium text-white"
            >
              Save Bookmark
            </button>
          </div>
        </div>
      ) : null}

      {/* Main Optimal-Measure Reading Canvas */}
      <article className="mx-auto max-w-[70ch] px-6 py-14">
        <header className={`border-b ${theme.border} pb-8`}>
          <MetadataLine
            items={[
              `Chapter ${chapter.chapterNumber}`,
              `${chapter.wordCount.toLocaleString()} words`,
              `${chapter.readingMinutes} min read`,
              readability ? `Ease ${readability.reading_ease_score}` : null,
              syncNotice,
            ]}
          />
          <h1 className="font-display mt-3 text-3xl leading-tight font-semibold sm:text-4xl">
            {chapter.title}
          </h1>
        </header>

        <div
          style={proseStyle}
          className={`litera-prose mt-10 ${prefs.dropCap ? 'litera-dropcap' : ''}`}
          dangerouslySetInnerHTML={{ __html: chapter.contentHtml }}
        />

        {/* Chapter Navigation */}
        <nav
          aria-label="Chapter navigation"
          className={`mt-14 flex items-center justify-between border-t ${theme.border} pt-8`}
        >
          {prevChapter ? (
            <button
              type="button"
              onClick={() => onNavigate({ name: 'read', slug: novel.slug, chapterId: prevChapter.id })}
              className={`inline-flex cursor-pointer items-center gap-2 border ${theme.border} ${theme.surface} px-4 py-2.5 text-xs font-medium`}
            >
              <ChevronLeft className="h-4 w-4" />
              Ch. {prevChapter.chapterNumber}: {prevChapter.title}
            </button>
          ) : (
            <span />
          )}

          {nextChapter ? (
            <button
              type="button"
              onClick={() => onNavigate({ name: 'read', slug: novel.slug, chapterId: nextChapter.id })}
              className="inline-flex cursor-pointer items-center gap-2 bg-[#785032] px-5 py-2.5 text-xs font-medium text-white hover:bg-[#5E3D24]"
            >
              Next: Ch. {nextChapter.chapterNumber}: {nextChapter.title}
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate({ name: 'novel', slug: novel.slug })}
              className={`cursor-pointer border ${theme.border} ${theme.surface} px-4 py-2.5 text-xs font-medium`}
            >
              Finish & Review Edition
            </button>
          )}
        </nav>

        {/* Margin Commentary */}
        <section className={`mt-16 border-t ${theme.border} pt-10`}>
          <h2 className="font-display text-2xl font-semibold">Reader Margin Notes ({comments.length})</h2>

          {user ? (
            <div className="mt-5 space-y-3">
              <textarea
                rows={3}
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Share an observation on this chapter..."
                className={`w-full border ${theme.border} ${theme.surface} p-3 text-sm focus:outline-none`}
              />
              <button
                type="button"
                disabled={!commentBody.trim() || commentMutation.isPending}
                onClick={() => commentMutation.mutate()}
                className="cursor-pointer bg-[#785032] px-5 py-2 text-xs font-medium text-white disabled:opacity-50"
              >
                {commentMutation.isPending ? 'Posting...' : 'Post Note'}
              </button>
            </div>
          ) : (
            <p className={`mt-3 text-sm ${theme.muted}`}>
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                className="cursor-pointer underline"
              >
                Sign in
              </button>{' '}
              to contribute chapter margin notes.
            </p>
          )}

          <div className="mt-8 space-y-5">
            {comments.map((c) => (
              <div key={c.id} className={`border ${theme.border} ${theme.surface} p-5`}>
                <div className={`flex items-center justify-between text-xs ${theme.muted}`}>
                  <span className="font-medium">{c.authorName || 'Litera Reader'}</span>
                  <span className="tabular-nums">{new Date(c.createdAt).toLocaleDateString()}</span>
                </div>
                <div
                  className="font-prose mt-2 text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: c.bodyHtml }}
                />
              </div>
            ))}
          </div>
        </section>
      </article>
    </div>
  );
}
