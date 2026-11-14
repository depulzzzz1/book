import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { motion } from 'motion/react';
import { apiFetch } from '../../lib/api.ts';
import type { LiteraRoute } from '../../components/layout/TopBar.tsx';
import {
  BookCover,
  EditorialSkeleton,
  EmptyEditorialState,
  MetadataLine,
  StarRatingDisplay,
} from '../../components/ui/EditorialPrimitives.tsx';
import type { Genre, NovelSummary } from '../../types/litera.ts';

export function PublicLibraryView({ onNavigate }: { onNavigate: (route: LiteraRoute) => void }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState<string>('');
  const [sortBy, setSortBy] = useState<'featured' | 'popular' | 'rating' | 'recent'>('featured');

  const genresQuery = useQuery({
    queryKey: ['genres'],
    queryFn: () => apiFetch<{ genres: Genre[] }>('/api/genres'),
  });

  const novelsQuery = useQuery({
    queryKey: ['novels', searchQuery, selectedGenre, sortBy],
    queryFn: () => {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (selectedGenre) params.set('genre', selectedGenre);
      params.set('sort', sortBy);
      return apiFetch<{ novels: NovelSummary[] }>(`/api/novels?${params.toString()}`);
    },
  });

  const novels = novelsQuery.data?.novels || [];
  const leadNovel = novels[0];

  return (
    <div className="mx-auto max-w-[1360px] px-6 pb-20">
      {/* Editorial Hero Split */}
      <section className="grid items-stretch gap-8 border-b border-[#E6DFD1] py-12 lg:grid-cols-12">
        <div className="flex flex-col justify-between lg:col-span-6 lg:pr-6">
          <div>
            <MetadataLine items={['Litera Digital Press', 'Curated Literary Editions', '2026 Archive']} />
            <h1 className="font-display mt-4 text-4xl leading-[1.12] font-semibold tracking-tight text-[#1C1917] sm:text-5xl">
              A quiet house for enduring fiction and long-form prose.
            </h1>
            <p className="font-prose mt-5 max-w-xl text-lg leading-relaxed text-[#57534E]">
              Read serialized manuscripts and complete monographs in a distraction-free study, follow independent authors, and annotate editions across every device.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            {leadNovel ? (
              <button
                type="button"
                onClick={() => onNavigate({ name: 'novel', slug: leadNovel.slug })}
                className="cursor-pointer bg-[#785032] px-6 py-3 text-sm font-medium text-[#FBF9F5] transition-colors hover:bg-[#5E3D24]"
              >
                Read Featured Edition
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('litera-catalog');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="cursor-pointer border border-[#D6CEBE] bg-white px-6 py-3 text-sm font-medium text-[#1C1917] transition-colors hover:border-[#785032]"
            >
              Browse Catalog
            </button>
          </div>
        </div>

        <div className="lg:col-span-6">
          <div className="relative h-full min-h-[320px] overflow-hidden border border-[#E6DFD1] bg-[#F3EFE6]">
            <img
              src="/assets/editorial/litera_hero_library_1794634568728.jpg"
              alt="Sunlit classical study room with oak bookshelves and stone reading desk"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* Catalog Search & Filter Toolbar */}
      <section id="litera-catalog" className="pt-12">
        <div className="flex flex-col justify-between gap-6 border-b border-[#E6DFD1] pb-6 md:flex-row md:items-end">
          <div>
            <h2 className="font-display text-2xl font-semibold text-[#1C1917]">Catalog & Editions</h2>
            <p className="mt-1 text-sm text-[#57534E]">
              Filter by literary genre, search manuscripts, or sort by readership.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[240px]">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#57534E]" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search titles, authors, themes..."
                aria-label="Search novels"
                className="w-full border border-[#D6CEBE] bg-white py-2 pr-3 pl-9 text-sm text-[#1C1917] focus:border-[#785032] focus:outline-none"
              />
            </div>

            <select
              aria-label="Sort catalog"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="border border-[#D6CEBE] bg-white px-3 py-2 text-sm text-[#1C1917] focus:border-[#785032] focus:outline-none"
            >
              <option value="featured">Curator Selection</option>
              <option value="popular">Most Read</option>
              <option value="rating">Highest Rated</option>
              <option value="recent">Recently Published</option>
            </select>
          </div>
        </div>

        {/* Genre Filter Controls */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedGenre('')}
            className={`cursor-pointer border px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              selectedGenre === ''
                ? 'border-[#785032] bg-[#785032] text-[#FBF9F5]'
                : 'border-[#E6DFD1] bg-white text-[#57534E] hover:border-[#785032] hover:text-[#1C1917]'
            }`}
          >
            All Genres
          </button>
          {(genresQuery.data?.genres || []).map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setSelectedGenre(g.slug)}
              className={`cursor-pointer border px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                selectedGenre === g.slug
                  ? 'border-[#785032] bg-[#785032] text-[#FBF9F5]'
                  : 'border-[#E6DFD1] bg-white text-[#57534E] hover:border-[#785032] hover:text-[#1C1917]'
              }`}
            >
              {g.name}
            </button>
          ))}
        </div>

        {/* Catalog Grid */}
        <div className="mt-10">
          {novelsQuery.isLoading ? (
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <EditorialSkeleton key={i} lines={4} />
              ))}
            </div>
          ) : novelsQuery.isError ? (
            <EmptyEditorialState
              title="Unable to load catalog"
              description="Please check your connection and try refreshing the library."
              actionLabel="Retry"
              onAction={() => void novelsQuery.refetch()}
            />
          ) : novels.length === 0 ? (
            <EmptyEditorialState
              title="No matching editions found"
              description="Adjust your search phrase or clear the active genre filter to view all published works."
              actionLabel="Clear Filters"
              onAction={() => {
                setSearchQuery('');
                setSelectedGenre('');
              }}
            />
          ) : (
            <div className="grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
              {novels.map((novel, idx) => (
                <motion.article
                  key={novel.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: idx * 0.04 }}
                  className="group flex flex-col"
                >
                  <button
                    type="button"
                    onClick={() => onNavigate({ name: 'novel', slug: novel.slug })}
                    className="cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-[#785032]"
                  >
                    <BookCover src={novel.coverUrl} title={novel.title} author={novel.authorName} />
                  </button>

                  <div className="mt-4 flex flex-1 flex-col justify-between">
                    <div>
                      <MetadataLine
                        items={[
                          novel.genres[0]?.name || 'Literature',
                          novel.completionStatus === 'COMPLETED' ? 'Complete' : 'Serialized',
                        ]}
                      />
                      <button
                        type="button"
                        onClick={() => onNavigate({ name: 'novel', slug: novel.slug })}
                        className="font-display mt-1.5 block cursor-pointer text-left text-xl leading-snug font-semibold text-[#1C1917] transition-colors group-hover:text-[#785032]"
                      >
                        {novel.title}
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigate({ name: 'author', userId: novel.authorId })}
                        className="mt-1 cursor-pointer text-xs font-medium text-[#57534E] hover:text-[#1C1917]"
                      >
                        {novel.authorName}
                        {novel.authorVerified ? ' · Verified Author' : ''}
                      </button>
                      <p className="mt-2.5 line-clamp-3 text-sm leading-relaxed text-[#57534E]">
                        {novel.synopsis}
                      </p>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-[#E6DFD1] pt-3 text-xs text-[#57534E] tabular-nums">
                      <StarRatingDisplay rating={novel.avgRating} count={novel.ratingCount} />
                      <span>
                        {novel.chapterCount} {novel.chapterCount === 1 ? 'chapter' : 'chapters'} ·{' '}
                        {novel.totalWords.toLocaleString()} words
                      </span>
                    </div>
                  </div>
                </motion.article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
