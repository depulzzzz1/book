import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
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
import type { NovelSummary } from '../../types/litera.ts';

interface AuthorDossierResponse {
  author: {
    userId: number;
    penName: string;
    biography: string;
    websiteUrl: string;
    verificationStatus: string;
    followerCount: number;
    isFollowing: boolean;
  };
  novels: NovelSummary[];
}

export function AuthorDossierView({
  userId,
  onNavigate,
}: {
  userId: number;
  onNavigate: (r: LiteraRoute) => void;
}) {
  const { user, setAuthModalOpen } = useAuthStore();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['author-dossier', userId],
    queryFn: () => apiFetch<AuthorDossierResponse>(`/api/authors/${userId}`),
  });

  const followMutation = useMutation({
    mutationFn: (isFollowing: boolean) =>
      apiFetch(`/api/community/authors/${userId}/follow`, {
        method: isFollowing ? 'DELETE' : 'POST',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['author-dossier', userId] });
    },
  });

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-[1060px] px-6 py-12">
        <EditorialSkeleton lines={6} />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="mx-auto max-w-[1060px] px-6 py-12">
        <EmptyEditorialState
          title="Author dossier not found"
          description="This author profile could not be located."
          actionLabel="Return to Library"
          onAction={() => onNavigate({ name: 'library' })}
        />
      </div>
    );
  }

  const { author, novels } = query.data;

  return (
    <div className="mx-auto max-w-[1060px] px-6 py-10 pb-20">
      <button
        type="button"
        onClick={() => onNavigate({ name: 'library' })}
        className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-[#57534E] hover:text-[#1C1917]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Library
      </button>

      <section className="mt-6 border-b border-[#E6DFD1] pb-10">
        <MetadataLine
          items={[
            author.verificationStatus === 'VERIFIED' ? 'Verified Author' : 'Independent Author',
            `${author.followerCount} followers`,
            `${novels.length} published works`,
          ]}
        />
        <div className="mt-3 flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="font-display text-4xl font-semibold text-[#1C1917]">{author.penName}</h1>
            <p className="font-prose mt-4 max-w-2xl text-base leading-relaxed text-[#292524]">
              {author.biography || 'No biography provided.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!user) {
                setAuthModalOpen(true);
                return;
              }
              followMutation.mutate(author.isFollowing);
            }}
            className="cursor-pointer bg-[#785032] px-5 py-2.5 text-sm font-medium text-[#FBF9F5] hover:bg-[#5E3D24]"
          >
            {author.isFollowing ? 'Following Author' : 'Follow Author'}
          </button>
        </div>
      </section>

      <section className="pt-10">
        <h2 className="font-display text-2xl font-semibold text-[#1C1917]">Published Works</h2>
        <div className="mt-6 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {novels.map((novel) => (
            <button
              key={novel.id}
              type="button"
              onClick={() => onNavigate({ name: 'novel', slug: novel.slug })}
              className="group cursor-pointer text-left"
            >
              <BookCover src={novel.coverUrl} title={novel.title} author={author.penName} />
              <h3 className="font-display mt-3 text-xl font-semibold text-[#1C1917] group-hover:text-[#785032]">
                {novel.title}
              </h3>
              <div className="mt-1 flex items-center justify-between text-xs text-[#57534E] tabular-nums">
                <StarRatingDisplay rating={novel.avgRating} count={novel.ratingCount} />
                <span>{novel.chapterCount} chapters</span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
