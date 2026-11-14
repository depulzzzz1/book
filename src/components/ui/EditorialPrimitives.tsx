import React, { Component, ErrorInfo, ReactNode, useState } from 'react';
import { BookOpen, Star } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class EditorialErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message || 'An unexpected rendering error occurred.' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('EditorialErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto my-16 max-w-xl border border-[#E6DFD1] bg-white p-10 text-center">
          <h2 className="font-display text-2xl font-semibold text-[#1C1917]">
            Something interrupted this page
          </h2>
          <p className="mt-3 text-sm text-[#57534E]">{this.state.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, message: '' })}
            className="mt-6 bg-[#785032] px-5 py-2.5 text-sm font-medium text-[#FBF9F5] transition-colors hover:bg-[#5E3D24]"
          >
            Return to Library
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function BookCover({
  src,
  title,
  author,
  className = '',
}: {
  src?: string;
  title: string;
  author?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex aspect-[3/4] flex-col justify-between border border-[#E6DFD1] bg-[#F3EFE6] p-5 text-[#1C1917] ${className}`}
      >
        <div className="flex items-center justify-between text-[11px] tracking-widest text-[#785032] uppercase">
          <span>Litera Press</span>
          <BookOpen className="h-3.5 w-3.5" />
        </div>
        <div className="my-auto">
          <h4 className="font-display text-lg leading-snug font-semibold text-[#1C1917]">{title}</h4>
          {author ? <p className="mt-2 text-xs text-[#57534E]">{author}</p> : null}
        </div>
        <div className="h-px w-full bg-[#D6CEBE]" />
      </div>
    );
  }

  return (
    <div className={`aspect-[3/4] overflow-hidden border border-[#E6DFD1] bg-[#F3EFE6] ${className}`}>
      <img
        src={src}
        alt={`Cover illustration for ${title}`}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02]"
      />
    </div>
  );
}

export function MetadataLine({ items }: { items: Array<string | number | null | undefined> }) {
  const valid = items.filter((item) => item !== null && item !== undefined && String(item).trim() !== '');
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#57534E] tabular-nums">
      {valid.map((item, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 ? <span aria-hidden="true">·</span> : null}
          <span>{item}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

export function StarRatingDisplay({ rating, count }: { rating: number; count?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1C1917] tabular-nums">
      <Star className="h-3.5 w-3.5 fill-[#785032] text-[#785032]" />
      <span>{rating > 0 ? rating.toFixed(1) : 'New'}</span>
      {count !== undefined && count > 0 ? <span className="text-[#57534E]">({count})</span> : null}
    </span>
  );
}

export function EditorialSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="animate-pulse space-y-4 py-6">
      <div className="h-6 w-2/3 bg-[#EBE5D9]" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 w-full bg-[#F3EFE6]" />
      ))}
    </div>
  );
}

export function EmptyEditorialState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="border border-[#E6DFD1] bg-white px-8 py-12 text-center">
      <h3 className="font-display text-xl font-semibold text-[#1C1917]">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[#57534E]">{description}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-6 bg-[#785032] px-5 py-2.5 text-sm font-medium text-[#FBF9F5] transition-colors hover:bg-[#5E3D24]"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
