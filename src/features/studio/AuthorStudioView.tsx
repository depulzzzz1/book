import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api.ts';
import { useAuthStore } from '../../stores/useAuthStore.ts';
import type { LiteraRoute } from '../../components/layout/TopBar.tsx';
import {
  EditorialSkeleton,
  EmptyEditorialState,
  MetadataLine,
} from '../../components/ui/EditorialPrimitives.tsx';
import type { ChapterFull, ChapterVersion, Genre, NovelSummary } from '../../types/litera.ts';

interface StudioNovelsResponse {
  novels: NovelSummary[];
  analytics: {
    novelCount: number;
    publishedCount: number;
    totalViews: number;
    totalWords: number;
    avgRating: number;
    followerCount: number;
    verificationStatus: string;
  };
}

export function AuthorStudioView({ onNavigate }: { onNavigate: (r: LiteraRoute) => void }) {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const [selectedNovelId, setSelectedNovelId] = useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [creatingNovel, setCreatingNovel] = useState(false);

  // Novel form state
  const [novelTitle, setNovelTitle] = useState('');
  const [novelSubtitle, setNovelSubtitle] = useState('');
  const [novelSynopsis, setNovelSynopsis] = useState('');
  const [novelGenreId, setNovelGenreId] = useState<number>(1);
  const [novelCover, setNovelCover] = useState('/assets/editorial/cover_glass_astrolabe_1794634569418.jpg');

  // Chapter editor state
  const [chapterTitle, setChapterTitle] = useState('');
  const [chapterHtml, setChapterHtml] = useState('');
  const [chapterVersion, setChapterVersion] = useState(1);
  const [editorMode, setEditorMode] = useState<'write' | 'preview' | 'revisions'>('write');
  const [autosaveStatus, setAutosaveStatus] = useState<string>('Synced');
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [studioNotice, setStudioNotice] = useState<string | null>(null);
  const [diffResult, setDiffResult] = useState<{
    fromVersion: number;
    toVersion: number;
    diff: { added_paragraphs: number; removed_paragraphs: number; unified_diff: string[] };
  } | null>(null);

  const autosaveTimerRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);

  const genresQuery = useQuery({
    queryKey: ['genres'],
    queryFn: () => apiFetch<{ genres: Genre[] }>('/api/genres'),
  });

  const studioQuery = useQuery({
    queryKey: ['studio-novels'],
    queryFn: () => apiFetch<StudioNovelsResponse>('/api/studio/novels'),
    enabled: Boolean(user && ['AUTHOR', 'EDITOR', 'ADMIN'].includes(user.role)),
  });

  const chaptersQuery = useQuery({
    queryKey: ['studio-chapters', selectedNovelId],
    queryFn: () =>
      apiFetch<{ novel: NovelSummary; chapters: ChapterFull[] }>(
        `/api/studio/novels/${selectedNovelId}/chapters`
      ),
    enabled: Boolean(selectedNovelId),
  });

  const versionsQuery = useQuery({
    queryKey: ['studio-chapter-versions', selectedChapterId],
    queryFn: () =>
      apiFetch<{ versions: ChapterVersion[] }>(`/api/studio/chapters/${selectedChapterId}/versions`),
    enabled: Boolean(selectedChapterId && editorMode === 'revisions'),
  });

  const selectedNovel = studioQuery.data?.novels.find((n) => n.id === selectedNovelId) || null;
  const selectedChapter = chaptersQuery.data?.chapters.find((c) => c.id === selectedChapterId) || null;

  useEffect(() => {
    if (!selectedNovelId && studioQuery.data?.novels[0]) {
      setSelectedNovelId(studioQuery.data.novels[0].id);
    }
  }, [studioQuery.data, selectedNovelId]);

  useEffect(() => {
    const first = chaptersQuery.data?.chapters[0];
    if (first && !selectedChapterId) {
      setSelectedChapterId(first.id);
      setChapterTitle(first.title);
      setChapterHtml(first.contentHtml);
      setChapterVersion(first.version);
      dirtyRef.current = false;
    }
  }, [chaptersQuery.data, selectedChapterId]);

  const createNovelMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ novel: NovelSummary }>('/api/studio/novels', {
        method: 'POST',
        json: {
          title: novelTitle,
          subtitle: novelSubtitle,
          synopsis: novelSynopsis,
          coverUrl: novelCover,
          genreIds: [novelGenreId],
        },
      }),
    onSuccess: (res) => {
      setCreatingNovel(false);
      setNovelTitle('');
      setNovelSubtitle('');
      setNovelSynopsis('');
      setSelectedNovelId(res.novel.id);
      setSelectedChapterId(null);
      setStudioNotice('Manuscript created.');
      void queryClient.invalidateQueries({ queryKey: ['studio-novels'] });
    },
  });

  const submitNovelMutation = useMutation({
    mutationFn: (novel: NovelSummary) =>
      apiFetch(`/api/studio/novels/${novel.id}`, {
        method: 'PATCH',
        json: { submitForReview: true, expectedVersion: novel.version },
      }),
    onSuccess: () => {
      setStudioNotice('Novel submitted to editorial review.');
      void queryClient.invalidateQueries({ queryKey: ['studio-novels'] });
    },
  });

  const createChapterMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ chapter: ChapterFull }>(`/api/studio/novels/${selectedNovelId}/chapters`, {
        method: 'POST',
        json: { title: newChapterTitle, contentHtml: '<p>Begin writing your chapter here.</p>' },
      }),
    onSuccess: (res) => {
      setNewChapterTitle('');
      setSelectedChapterId(res.chapter.id);
      setChapterTitle(res.chapter.title);
      setChapterHtml(res.chapter.contentHtml);
      setChapterVersion(res.chapter.version);
      dirtyRef.current = false;
      void queryClient.invalidateQueries({ queryKey: ['studio-chapters', selectedNovelId] });
      void queryClient.invalidateQueries({ queryKey: ['studio-novels'] });
    },
  });

  const saveChapterMutation = useMutation({
    mutationFn: (opts: { createRevision: boolean; changeSummary?: string }) =>
      apiFetch<{ chapter: ChapterFull }>(`/api/studio/chapters/${selectedChapterId}`, {
        method: 'PATCH',
        json: {
          title: chapterTitle,
          contentHtml: chapterHtml,
          createRevision: opts.createRevision,
          changeSummary: opts.changeSummary,
          expectedVersion: chapterVersion,
        },
      }),
    onSuccess: (res) => {
      setChapterVersion(res.chapter.version);
      dirtyRef.current = false;
      setAutosaveStatus(`Saved · v${res.chapter.currentVersionNumber}`);
      void queryClient.invalidateQueries({ queryKey: ['studio-chapters', selectedNovelId] });
      void queryClient.invalidateQueries({ queryKey: ['studio-chapter-versions', selectedChapterId] });
      void queryClient.invalidateQueries({ queryKey: ['studio-novels'] });
    },
    onError: (err) => {
      setAutosaveStatus(err instanceof Error ? err.message : 'Save conflict');
    },
  });

  const publishChapterMutation = useMutation({
    mutationFn: (mode: 'IMMEDIATE' | 'SCHEDULED') =>
      apiFetch(`/api/studio/chapters/${selectedChapterId}/publish`, {
        method: 'POST',
        json: { mode, scheduledFor: mode === 'SCHEDULED' ? scheduleTime : undefined },
      }),
    onSuccess: () => {
      setStudioNotice('Chapter publication workflow updated.');
      void queryClient.invalidateQueries({ queryKey: ['studio-chapters', selectedNovelId] });
    },
  });

  const restoreVersionMutation = useMutation({
    mutationFn: (versionNumber: number) =>
      apiFetch<{ chapter: ChapterFull }>(
        `/api/studio/chapters/${selectedChapterId}/restore/${versionNumber}`,
        { method: 'POST' }
      ),
    onSuccess: (res) => {
      setChapterTitle(res.chapter.title);
      setChapterHtml(res.chapter.contentHtml);
      setChapterVersion(res.chapter.version);
      setEditorMode('write');
      setStudioNotice('Historical revision restored.');
      void queryClient.invalidateQueries({ queryKey: ['studio-chapters', selectedNovelId] });
    },
  });

  // Debounced Draft Autosave
  useEffect(() => {
    if (!dirtyRef.current || !selectedChapterId) return;
    setAutosaveStatus('Drafting...');
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      if (dirtyRef.current) {
        saveChapterMutation.mutate({ createRevision: false });
      }
    }, 1800);
    return () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    };
  }, [chapterTitle, chapterHtml, selectedChapterId]);

  function wrapFormatting(tag: 'strong' | 'em' | 'blockquote' | 'h2') {
    const addition =
      tag === 'h2'
        ? '\n<h2>Section Heading</h2>'
        : tag === 'blockquote'
          ? '\n<blockquote>Editorial quotation...</blockquote>'
          : tag === 'strong'
            ? ' <strong>emphasized text</strong> '
            : ' <em>italicized phrase</em> ';
    setChapterHtml((prev) => `${prev}${addition}`);
    dirtyRef.current = true;
  }

  if (!user || !['AUTHOR', 'EDITOR', 'ADMIN'].includes(user.role)) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <EmptyEditorialState
          title="Author Studio"
          description="Activate an Author Dossier in your account settings to create novels, track chapter revisions, and schedule publications."
          actionLabel="Activate Author Account"
          onAction={() => onNavigate({ name: 'account' })}
        />
      </div>
    );
  }

  const analytics = studioQuery.data?.analytics;

  return (
    <div className="mx-auto max-w-[1360px] px-6 py-10 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#E6DFD1] pb-6">
        <div>
          <MetadataLine
            items={[
              'Author Publishing Workspace',
              analytics ? `Verification: ${analytics.verificationStatus}` : null,
            ]}
          />
          <h1 className="font-display mt-2 text-3xl font-semibold text-[#1C1917]">Author Studio</h1>
        </div>
        <button
          type="button"
          onClick={() => setCreatingNovel(!creatingNovel)}
          className="cursor-pointer bg-[#785032] px-5 py-2.5 text-xs font-medium text-[#FBF9F5] hover:bg-[#5E3D24]"
        >
          {creatingNovel ? 'Close Form' : 'New Manuscript'}
        </button>
      </div>

      {/* Author Analytics KPI Strip */}
      {analytics ? (
        <div className="mt-6 grid grid-cols-2 gap-4 border-b border-[#E6DFD1] pb-6 sm:grid-cols-5">
          <div>
            <div className="text-xs text-[#57534E]">Manuscripts</div>
            <div className="font-display mt-1 text-2xl font-semibold tabular-nums">{analytics.novelCount}</div>
          </div>
          <div>
            <div className="text-xs text-[#57534E]">Published</div>
            <div className="font-display mt-1 text-2xl font-semibold tabular-nums">
              {analytics.publishedCount}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#57534E]">Total Reads</div>
            <div className="font-display mt-1 text-2xl font-semibold tabular-nums">
              {analytics.totalViews.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#57534E]">Word Count</div>
            <div className="font-display mt-1 text-2xl font-semibold tabular-nums">
              {analytics.totalWords.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#57534E]">Followers</div>
            <div className="font-display mt-1 text-2xl font-semibold tabular-nums">
              {analytics.followerCount}
            </div>
          </div>
        </div>
      ) : null}

      {studioNotice ? (
        <div className="mt-5 border border-[#166534]/30 bg-[#F0FDF4] px-4 py-2.5 text-xs text-[#166534]">
          {studioNotice}
        </div>
      ) : null}

      {creatingNovel ? (
        <div className="mt-6 border border-[#E6DFD1] bg-white p-7">
          <h2 className="font-display text-xl font-semibold text-[#1C1917]">Create New Novel</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs font-medium">Title</label>
              <input
                type="text"
                value={novelTitle}
                onChange={(e) => setNovelTitle(e.target.value)}
                className="mt-1 w-full border border-[#D6CEBE] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium">Subtitle</label>
              <input
                type="text"
                value={novelSubtitle}
                onChange={(e) => setNovelSubtitle(e.target.value)}
                className="mt-1 w-full border border-[#D6CEBE] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium">Primary Genre</label>
              <select
                value={novelGenreId}
                onChange={(e) => setNovelGenreId(Number(e.target.value))}
                className="mt-1 w-full border border-[#D6CEBE] px-3 py-2 text-sm"
              >
                {(genresQuery.data?.genres || []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium">Edition Cover Artwork</label>
              <select
                value={novelCover}
                onChange={(e) => setNovelCover(e.target.value)}
                className="mt-1 w-full border border-[#D6CEBE] px-3 py-2 text-sm"
              >
                <option value="/assets/editorial/cover_glass_astrolabe_1794634569418.jpg">
                  Brass Astrolabe Engraving
                </option>
                <option value="/assets/editorial/cover_winter_monograph_1794634569760.jpg">
                  Northern Cliff Etching
                </option>
                <option value="/assets/editorial/cover_cartographers_house_1794634570419.jpg">
                  Classical Colonnade Linework
                </option>
                <option value="/assets/editorial/cover_letters_from_kyoto_1794634570326.jpg">
                  Kyoto Ink Wash
                </option>
              </select>
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-xs font-medium">Synopsis (min 20 characters)</label>
            <textarea
              rows={3}
              value={novelSynopsis}
              onChange={(e) => setNovelSynopsis(e.target.value)}
              className="mt-1 w-full border border-[#D6CEBE] px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            disabled={!novelTitle.trim() || novelSynopsis.trim().length < 20 || createNovelMutation.isPending}
            onClick={() => createNovelMutation.mutate()}
            className="mt-4 cursor-pointer bg-[#785032] px-5 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Create Manuscript
          </button>
        </div>
      ) : null}

      {studioQuery.isLoading ? (
        <EditorialSkeleton lines={6} />
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-12">
          {/* Left Rail: Novels & Chapter Selector */}
          <aside className="space-y-6 lg:col-span-4">
            <div className="border border-[#E6DFD1] bg-white p-5">
              <h2 className="font-display text-lg font-semibold text-[#1C1917]">Your Works</h2>
              <div className="mt-3 space-y-2">
                {(studioQuery.data?.novels || []).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      setSelectedNovelId(n.id);
                      setSelectedChapterId(null);
                    }}
                    className={`w-full cursor-pointer border p-3 text-left transition-colors ${
                      n.id === selectedNovelId
                        ? 'border-[#785032] bg-[#FBF9F5]'
                        : 'border-[#E6DFD1] hover:bg-[#FBF9F5]'
                    }`}
                  >
                    <div className="font-medium text-[#1C1917]">{n.title}</div>
                    <MetadataLine items={[n.status, `${n.chapterCount} ch.`, `${n.totalWords} words`]} />
                  </button>
                ))}
                {(studioQuery.data?.novels || []).length === 0 ? (
                  <p className="text-xs text-[#57534E]">Create your first manuscript to begin.</p>
                ) : null}
              </div>

              {selectedNovel && (selectedNovel.status === 'DRAFT' || selectedNovel.status === 'REJECTED') ? (
                <button
                  type="button"
                  onClick={() => submitNovelMutation.mutate(selectedNovel)}
                  className="mt-4 w-full cursor-pointer border border-[#785032] py-2 text-xs font-medium text-[#785032] hover:bg-[#785032] hover:text-white"
                >
                  Submit Novel for Editorial Approval
                </button>
              ) : null}
            </div>

            {selectedNovel ? (
              <div className="border border-[#E6DFD1] bg-white p-5">
                <h3 className="font-display text-lg font-semibold text-[#1C1917]">Chapters</h3>
                <div className="mt-3 space-y-2">
                  {(chaptersQuery.data?.chapters || []).map((ch) => (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => {
                        setSelectedChapterId(ch.id);
                        setChapterTitle(ch.title);
                        setChapterHtml(ch.contentHtml);
                        setChapterVersion(ch.version);
                        dirtyRef.current = false;
                        setAutosaveStatus(`Synced · v${ch.currentVersionNumber}`);
                      }}
                      className={`w-full cursor-pointer border p-2.5 text-left text-xs ${
                        ch.id === selectedChapterId
                          ? 'border-[#785032] bg-[#FBF9F5]'
                          : 'border-[#E6DFD1] hover:bg-[#FBF9F5]'
                      }`}
                    >
                      <div className="font-medium text-[#1C1917]">
                        {ch.chapterNumber}. {ch.title}
                      </div>
                      <MetadataLine items={[ch.status, `${ch.wordCount} words`]} />
                    </button>
                  ))}
                </div>

                <div className="mt-4 flex gap-2">
                  <input
                    type="text"
                    value={newChapterTitle}
                    onChange={(e) => setNewChapterTitle(e.target.value)}
                    placeholder="New chapter title..."
                    className="flex-1 border border-[#D6CEBE] px-2.5 py-1.5 text-xs"
                  />
                  <button
                    type="button"
                    disabled={newChapterTitle.trim().length < 2 || createChapterMutation.isPending}
                    onClick={() => createChapterMutation.mutate()}
                    className="cursor-pointer bg-[#785032] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
            ) : null}
          </aside>

          {/* Main Editorial Workspace */}
          <div className="lg:col-span-8">
            {selectedChapter ? (
              <div className="border border-[#E6DFD1] bg-white p-7">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E6DFD1] pb-4">
                  <div className="flex gap-2">
                    {(['write', 'preview', 'revisions'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setEditorMode(m)}
                        className={`cursor-pointer border px-3 py-1.5 text-xs font-medium capitalize ${
                          editorMode === m
                            ? 'border-[#785032] bg-[#785032] text-white'
                            : 'border-[#E6DFD1] text-[#57534E]'
                        }`}
                      >
                        {m === 'revisions' ? 'Revision History' : m}
                      </button>
                    ))}
                  </div>
                  <span className="font-mono text-xs text-[#57534E] tabular-nums">{autosaveStatus}</span>
                </div>

                {editorMode === 'write' ? (
                  <div className="mt-5 space-y-4">
                    <input
                      type="text"
                      value={chapterTitle}
                      onChange={(e) => {
                        setChapterTitle(e.target.value);
                        dirtyRef.current = true;
                      }}
                      className="font-display w-full border border-[#D6CEBE] px-3 py-2 text-2xl font-semibold text-[#1C1917] focus:border-[#785032] focus:outline-none"
                    />

                    <div className="flex flex-wrap gap-2 border-y border-[#E6DFD1] py-2 text-xs">
                      <button
                        type="button"
                        onClick={() => wrapFormatting('h2')}
                        className="cursor-pointer border border-[#E6DFD1] px-2.5 py-1 hover:bg-[#F3EFE6]"
                      >
                        Heading
                      </button>
                      <button
                        type="button"
                        onClick={() => wrapFormatting('strong')}
                        className="cursor-pointer border border-[#E6DFD1] px-2.5 py-1 hover:bg-[#F3EFE6]"
                      >
                        Bold
                      </button>
                      <button
                        type="button"
                        onClick={() => wrapFormatting('em')}
                        className="cursor-pointer border border-[#E6DFD1] px-2.5 py-1 hover:bg-[#F3EFE6]"
                      >
                        Italic
                      </button>
                      <button
                        type="button"
                        onClick={() => wrapFormatting('blockquote')}
                        className="cursor-pointer border border-[#E6DFD1] px-2.5 py-1 hover:bg-[#F3EFE6]"
                      >
                        Blockquote
                      </button>
                    </div>

                    <textarea
                      rows={14}
                      value={chapterHtml}
                      onChange={(e) => {
                        setChapterHtml(e.target.value);
                        dirtyRef.current = true;
                      }}
                      className="font-prose w-full border border-[#D6CEBE] p-4 text-base leading-relaxed focus:border-[#785032] focus:outline-none"
                    />

                    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#E6DFD1] pt-4">
                      <button
                        type="button"
                        onClick={() =>
                          saveChapterMutation.mutate({
                            createRevision: true,
                            changeSummary: 'Manual author checkpoint',
                          })
                        }
                        className="cursor-pointer border border-[#785032] px-4 py-2 text-xs font-medium text-[#785032] hover:bg-[#785032] hover:text-white"
                      >
                        Save Named Revision Snapshot
                      </button>

                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="datetime-local"
                          value={scheduleTime}
                          onChange={(e) => setScheduleTime(e.target.value)}
                          className="border border-[#D6CEBE] px-2.5 py-1.5 text-xs"
                        />
                        {scheduleTime ? (
                          <button
                            type="button"
                            onClick={() => publishChapterMutation.mutate('SCHEDULED')}
                            className="cursor-pointer border border-[#D6CEBE] px-4 py-2 text-xs font-medium hover:border-[#785032]"
                          >
                            Schedule Chapter
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => publishChapterMutation.mutate('IMMEDIATE')}
                          className="cursor-pointer bg-[#785032] px-5 py-2 text-xs font-medium text-white hover:bg-[#5E3D24]"
                        >
                          Publish Chapter Now
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {editorMode === 'preview' ? (
                  <div className="mx-auto max-w-[65ch] py-8">
                    <h2 className="font-display text-3xl font-semibold text-[#1C1917]">{chapterTitle}</h2>
                    <div
                      className="font-prose litera-prose litera-dropcap mt-6 text-lg leading-relaxed text-[#1C1917]"
                      dangerouslySetInnerHTML={{ __html: chapterHtml }}
                    />
                  </div>
                ) : null}

                {editorMode === 'revisions' ? (
                  <div className="mt-5 space-y-4">
                    {(versionsQuery.data?.versions || []).map((ver, idx, arr) => {
                      const prevVer = arr[idx + 1];
                      return (
                        <div key={ver.id} className="border border-[#E6DFD1] p-4 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <span className="font-semibold text-[#1C1917]">
                                Revision v{ver.versionNumber}
                              </span>{' '}
                              · <span className="text-[#57534E]">{ver.changeSummary}</span>
                            </div>
                            <span className="font-mono text-[#57534E] tabular-nums">
                              {ver.wordCount} words · {new Date(ver.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <div className="mt-3 flex gap-3">
                            <button
                              type="button"
                              onClick={() => restoreVersionMutation.mutate(ver.versionNumber)}
                              className="cursor-pointer text-[#785032] hover:underline"
                            >
                              Restore This Version
                            </button>
                            {prevVer ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  const d = await apiFetch<typeof diffResult>(
                                    `/api/studio/chapters/${selectedChapterId}/diff?from=${prevVer.versionNumber}&to=${ver.versionNumber}`
                                  );
                                  setDiffResult(d);
                                }}
                                className="cursor-pointer text-[#57534E] hover:text-[#1C1917] hover:underline"
                              >
                                Compare with v{prevVer.versionNumber}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}

                    {diffResult ? (
                      <div className="border border-[#D6CEBE] bg-[#FBF9F5] p-4">
                        <div className="text-xs font-semibold text-[#1C1917]">
                          Diff: v{diffResult.fromVersion} → v{diffResult.toVersion} (+
                          {diffResult.diff.added_paragraphs} / -{diffResult.diff.removed_paragraphs})
                        </div>
                        <pre className="font-mono mt-2 max-h-64 overflow-auto text-xs text-[#292524]">
                          {diffResult.diff.unified_diff.join('\n') || 'No textual changes.'}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyEditorialState
                title="Select or add a chapter"
                description="Choose a manuscript chapter on the left to open the editorial canvas, revision history, and publishing tools."
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
