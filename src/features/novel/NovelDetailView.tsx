import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, BookmarkPlus, Flag, Star } from 'lucide-react';
import { apiFetch } from '../../lib/api.ts';
import { useAuthStore } from '../../stores/useAuthStore.ts';
import type { LiteraRoute } from '../../components/layout/TopBar.tsx';
import {
  BookCover,
  EditorialSkeleton,
  EmptyEditorialState,
  MetadataLine,
  StarRatingDisplay,
} from '../../components/ui/EditorialPrimitives.tsx';
import type { ChapterSummary, NovelSummary, ReadingList, ReviewItem } from '../../types/litera.ts';

interface NovelDetailResponse {
  novel: NovelSummary;
  author: {
    userId: number;
    penName: string;
    biography: string;
    verificationStatus: string;
    followerCount: number;
    isFollowing: boolean;
  };
  chapters: ChapterSummary[];
  reviews: ReviewItem[];
  recommendations: Array<{
    id: string;
    slug: string;
    title: string;
    coverUrl: string;
    avgRating: number;
  }>;
}

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().min(3, 'Review headline must be at least 3 characters.').max(140),
  body: z.string().min(10, 'Please write at least 10 characters for your review.').max(2500),
});

type ReviewInput = z.infer<typeof reviewSchema>;

export function NovelDetailView({
  slug,
  onNavigate,
}: {
  slug: string;
  onNavigate: (r: LiteraRoute) => void;
}) {
  const { user, setAuthModalOpen } = useAuthStore();
  const queryClient = useQueryClient();
  const [selectedListId, setSelectedListId] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('Plagiarism or Copyright Concern');
  const [reportDetails, setReportDetails] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ['novel-detail', slug],
    queryFn: () => apiFetch<NovelDetailResponse>(`/api/novels/${slug}`),
  });

  const libraryQuery = useQuery({
    queryKey: ['reader-library'],
    queryFn: () => apiFetch<{ lists: ReadingList[] }>('/api/reader/library'),
    enabled: Boolean(user),
  });

  const reviewForm = useForm<ReviewInput>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { rating: 5, title: '', body: '' },
  });

  const followMutation = useMutation({
    mutationFn: async (currentlyFollowing: boolean) => {
      const authorId = detailQuery.data?.author.userId;
      if (!authorId) return;
      await apiFetch(`/api/community/authors/${authorId}/follow`, {
        method: currentlyFollowing ? 'DELETE' : 'POST',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['novel-detail', slug] });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: (data: ReviewInput) =>
      apiFetch(`/api/community/novels/${detailQuery.data!.novel.id}/reviews`, {
        method: 'POST',
        json: data,
      }),
    onSuccess: () => {
      reviewForm.reset({ rating: 5, title: '', body: '' });
      setFeedbackMsg('Your review has been published.');
      void queryClient.invalidateQueries({ queryKey: ['novel-detail', slug] });
    },
  });

  const addToListMutation = useMutation({
    mutationFn: (listId: string) =>
      apiFetch(`/api/reader/lists/${listId}/items`, {
        method: 'POST',
        json: { novelId: detailQuery.data!.novel.id },
      }),
    onSuccess: () => {
      setFeedbackMsg('Added edition to your reading list.');
      setSelectedListId('');
      void queryClient.invalidateQueries({ queryKey: ['reader-library'] });
    },
  });

  const reportMutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/community/reports', {
        method: 'POST',
        json: {
          targetType: 'NOVEL',
          targetId: detailQuery.data!.novel.id,
          reason: reportReason,
          details: reportDetails,
        },
      }),
    onSuccess: () => {
      setReportOpen(false);
      setReportDetails('');
      setFeedbackMsg('Report submitted for editorial moderation review.');
    },
  });

  if (detailQuery.isLoading) {
    return (
      <div className="mx-auto max-w-[1180px] px-6 py-12">
        <EditorialSkeleton lines={8} />
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="mx-auto max-w-[1180px] px-6 py-12">
        <EmptyEditorialState
          title="Edition unavailable"
          description="This manuscript may be unpublished or removed."
          actionLabel="Return to Library"
          onAction={() => onNavigate({ name: 'library' })}
        />
      </div>
    );
  }

  const { novel, author, chapters, reviews, recommendations } = detailQuery.data;
  const firstChapter = chapters[0];

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-10 pb-20">
      <button
        type="button"
        onClick={() => onNavigate({ name: 'library' })}
        className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-[#57534E] hover:text-[#1C1917]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Library
      </button>

      {feedbackMsg ? (
        <div className="mt-5 border border-[#166534]/30 bg-[#F0FDF4] px-4 py-3 text-sm text-[#166534]">
          {feedbackMsg}
        </div>
      ) : null}

      {/* Monograph Hero */}
      <section className="mt-6 grid gap-10 border-b border-[#E6DFD1] pb-12 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <BookCover src={novel.coverUrl} title={novel.title} author={author.penName} />
        </div>

        <div className="flex flex-col justify-between lg:col-span-8">
          <div>
            <MetadataLine
              items={[
                novel.genres.map((g) => g.name).join(' / ') || 'Literature',
                novel.completionStatus === 'COMPLETED' ? 'Complete Edition' : 'Serialized',
                `${novel.totalWords.toLocaleString()} words`,
                `${novel.viewCount.toLocaleString()} reads`,
              ]}
            />
            <h1 className="font-display mt-3 text-4xl font-semibold tracking-tight text-[#1C1917]">
              {novel.title}
            </h1>
            {novel.subtitle ? (
              <p className="font-prose mt-2 text-xl text-[#57534E] italic">{novel.subtitle}</p>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-5">
              <button
                type="button"
                onClick={() => onNavigate({ name: 'author', userId: author.userId })}
                className="cursor-pointer text-sm font-medium text-[#1C1917] underline decoration-[#D6CEBE] underline-offset-4 hover:decoration-[#785032]"
              >
                By {author.penName}
              </button>
              {author.verificationStatus === 'VERIFIED' ? (
                <span className="text-xs font-medium text-[#785032]">Verified Author</span>
              ) : null}
              <StarRatingDisplay rating={novel.avgRating} count={novel.ratingCount} />
            </div>

            <p className="font-prose mt-6 max-w-2xl text-base leading-relaxed text-[#292524]">
              {novel.synopsis}
            </p>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {firstChapter ? (
              <button
                type="button"
                onClick={() => onNavigate({ name: 'read', slug: novel.slug, chapterId: firstChapter.id })}
                className="cursor-pointer bg-[#785032] px-6 py-3 text-sm font-medium text-[#FBF9F5] transition-colors hover:bg-[#5E3D24]"
              >
                Begin Reading · Chapter 1
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => {
                if (!user) {
                  setAuthModalOpen(true);
                  return;
                }
                followMutation.mutate(author.isFollowing);
              }}
              className="cursor-pointer border border-[#D6CEBE] bg-white px-5 py-3 text-sm font-medium text-[#1C1917] hover:border-[#785032]"
            >
              {author.isFollowing ? `Following (${author.followerCount})` : `Follow Author (${author.followerCount})`}
            </button>

            {user && libraryQuery.data?.lists.length ? (
              <div className="flex items-center gap-2">
                <select
                  aria-label="Add to reading list"
                  value={selectedListId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedListId(id);
                    if (id) addToListMutation.mutate(id);
                  }}
                  className="border border-[#D6CEBE] bg-white px-3 py-3 text-xs text-[#1C1917]"
                >
                  <option value="">Save to Reading List...</option>
                  {libraryQuery.data.lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (!user) setAuthModalOpen(true);
                  else onNavigate({ name: 'shelf' });
                }}
                className="inline-flex cursor-pointer items-center gap-1.5 border border-[#D6CEBE] bg-white px-4 py-3 text-xs font-medium text-[#57534E] hover:border-[#785032] hover:text-[#1C1917]"
              >
                <BookmarkPlus className="h-4 w-4" />
                Save to Shelf
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (!user) {
                  setAuthModalOpen(true);
                  return;
                }
                setReportOpen(!reportOpen);
              }}
              className="inline-flex cursor-pointer items-center gap-1.5 px-3 py-3 text-xs text-[#57534E] hover:text-[#991B1B]"
            >
              <Flag className="h-3.5 w-3.5" />
              Report
            </button>
          </div>

          {reportOpen ? (
            <div className="mt-5 border border-[#E6DFD1] bg-white p-5">
              <h3 className="text-sm font-semibold text-[#1C1917]">Report Content to Moderation</h3>
              <div className="mt-3 space-y-3">
                <select
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  className="w-full border border-[#D6CEBE] px-3 py-2 text-xs"
                >
                  <option>Plagiarism or Copyright Concern</option>
                  <option>Harassment or Hate Speech</option>
                  <option>Spam or Misleading Metadata</option>
                  <option>Policy Violation</option>
                </select>
                <textarea
                  rows={2}
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  placeholder="Provide specific passage or context..."
                  className="w-full border border-[#D6CEBE] px-3 py-2 text-xs"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => reportMutation.mutate()}
                    className="cursor-pointer bg-[#991B1B] px-4 py-1.5 text-xs font-medium text-white"
                  >
                    Submit Report
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportOpen(false)}
                    className="cursor-pointer border border-[#D6CEBE] px-4 py-1.5 text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* Chapters & Author Dossier */}
      <section className="grid gap-12 border-b border-[#E6DFD1] py-12 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <h2 className="font-display text-2xl font-semibold text-[#1C1917]">Table of Contents</h2>
          <div className="mt-5 divide-y divide-[#E6DFD1] border-t border-b border-[#E6DFD1]">
            {chapters.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => onNavigate({ name: 'read', slug: novel.slug, chapterId: ch.id })}
                className="flex w-full cursor-pointer items-center justify-between gap-4 bg-white px-5 py-4 text-left transition-colors hover:bg-[#F3EFE6]"
              >
                <div>
                  <div className="text-xs font-medium text-[#785032] tabular-nums">
                    Chapter {ch.chapterNumber}
                  </div>
                  <div className="font-display mt-0.5 text-lg font-medium text-[#1C1917]">{ch.title}</div>
                  {ch.plainExcerpt ? (
                    <p className="mt-1 line-clamp-1 text-xs text-[#57534E]">{ch.plainExcerpt}</p>
                  ) : null}
                </div>
                <div className="text-right text-xs text-[#57534E] tabular-nums shrink-0">
                  <div>{ch.readingMinutes} min read</div>
                  <div>{ch.wordCount.toLocaleString()} words</div>
                </div>
              </button>
            ))}
            {chapters.length === 0 ? (
              <p className="py-6 text-sm text-[#57534E]">No chapters have been released yet.</p>
            ) : null}
          </div>
        </div>

        <aside className="lg:col-span-4">
          <div className="border border-[#E6DFD1] bg-white p-6">
            <div className="text-xs tracking-wider text-[#785032] uppercase">Author Dossier</div>
            <h3 className="font-display mt-2 text-xl font-semibold text-[#1C1917]">{author.penName}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[#57534E]">
              {author.biography || 'Independent contributor to the Litera archive.'}
            </p>
            <button
              type="button"
              onClick={() => onNavigate({ name: 'author', userId: author.userId })}
              className="mt-4 cursor-pointer text-xs font-medium text-[#785032] hover:underline"
            >
              View Full Bibliography
            </button>
          </div>
        </aside>
      </section>

      {/* Reviews */}
      <section className="grid gap-12 border-b border-[#E6DFD1] py-12 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <h2 className="font-display text-2xl font-semibold text-[#1C1917]">
            Reader Reviews ({reviews.length})
          </h2>
          <div className="mt-6 space-y-6">
            {reviews.map((rev) => (
              <article key={rev.id} className="border border-[#E6DFD1] bg-white p-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-1 text-[#785032]">
                    {Array.from({ length: rev.rating }).map((_, idx) => (
                      <Star key={idx} className="h-3.5 w-3.5 fill-[#785032]" />
                    ))}
                  </div>
                  <span className="text-xs text-[#57534E] tabular-nums">
                    {new Date(rev.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <h3 className="font-display mt-2 text-lg font-semibold text-[#1C1917]">{rev.title}</h3>
                <p className="font-prose mt-2 text-sm leading-relaxed text-[#292524]">{rev.body}</p>
                <div className="mt-3 text-xs text-[#57534E]">
                  By {rev.reviewerName || 'Litera Reader'}
                </div>
              </article>
            ))}
            {reviews.length === 0 ? (
              <p className="text-sm text-[#57534E]">Be the first reader to write a critical review.</p>
            ) : null}
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="border border-[#E6DFD1] bg-white p-6">
            <h3 className="font-display text-xl font-semibold text-[#1C1917]">Write a Review</h3>
            {user ? (
              <form
                onSubmit={reviewForm.handleSubmit((data) => reviewMutation.mutate(data))}
                className="mt-4 space-y-4"
              >
                <div>
                  <label className="block text-xs font-medium text-[#1C1917]">Rating</label>
                  <select
                    {...reviewForm.register('rating', { valueAsNumber: true })}
                    className="mt-1 w-full border border-[#D6CEBE] bg-white px-3 py-2 text-sm"
                  >
                    <option value={5}>5 — Masterwork</option>
                    <option value={4}>4 — Accomplished</option>
                    <option value={3}>3 — Meritorious</option>
                    <option value={2}>2 — Uneven</option>
                    <option value={1}>1 — Unsatisfactory</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#1C1917]">Headline</label>
                  <input
                    type="text"
                    {...reviewForm.register('title')}
                    className="mt-1 w-full border border-[#D6CEBE] px-3 py-2 text-sm"
                    placeholder="Summarize your impression..."
                  />
                  {reviewForm.formState.errors.title ? (
                    <p className="mt-1 text-xs text-[#991B1B]">{reviewForm.formState.errors.title.message}</p>
                  ) : null}
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#1C1917]">Critique</label>
                  <textarea
                    rows={4}
                    {...reviewForm.register('body')}
                    className="mt-1 w-full border border-[#D6CEBE] px-3 py-2 text-sm"
                    placeholder="Share your reflections on prose, pacing, and themes..."
                  />
                  {reviewForm.formState.errors.body ? (
                    <p className="mt-1 text-xs text-[#991B1B]">{reviewForm.formState.errors.body.message}</p>
                  ) : null}
                </div>
                <button
                  type="submit"
                  disabled={reviewMutation.isPending}
                  className="cursor-pointer bg-[#785032] px-5 py-2.5 text-xs font-medium text-[#FBF9F5] hover:bg-[#5E3D24]"
                >
                  {reviewMutation.isPending ? 'Publishing...' : 'Publish Review'}
                </button>
              </form>
            ) : (
              <div className="mt-4">
                <p className="text-sm text-[#57534E]">Sign in to rate and review this edition.</p>
                <button
                  type="button"
                  onClick={() => setAuthModalOpen(true)}
                  className="mt-4 cursor-pointer bg-[#785032] px-4 py-2 text-xs font-medium text-[#FBF9F5]"
                >
                  Sign In
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Recommendations */}
      {recommendations.length > 0 ? (
        <section className="pt-12">
          <h2 className="font-display text-2xl font-semibold text-[#1C1917]">Recommended Reading</h2>
          <div className="mt-6 grid gap-8 sm:grid-cols-3">
            {recommendations.map((rec) => (
              <button
                key={rec.id}
                type="button"
                onClick={() => onNavigate({ name: 'novel', slug: rec.slug })}
                className="group cursor-pointer text-left"
              >
                <BookCover src={rec.coverUrl} title={rec.title} />
                <h3 className="font-display mt-3 text-lg font-semibold text-[#1C1917] group-hover:text-[#785032]">
                  {rec.title}
                </h3>
                <div className="mt-1">
                  <StarRatingDisplay rating={rec.avgRating} />
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
