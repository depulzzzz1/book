export type LiteraRole = 'READER' | 'AUTHOR' | 'EDITOR' | 'ADMIN';
export type ReaderTheme = 'ivory' | 'sepia' | 'dark';
export type ReaderFont = 'serif' | 'sans';

export interface AuthUser {
  id: number;
  uid: string;
  email: string;
  role: LiteraRole;
  displayName: string;
  isActive: boolean;
  isVerified: boolean;
  permissions: string[];
  sessionId?: string;
}

export interface UserProfile {
  id: number;
  userId: number;
  displayName: string;
  bio: string;
  avatarUrl: string;
  preferredTheme: ReaderTheme;
  preferredFont: ReaderFont;
  preferredFontSize: number;
  preferredLineHeight: number;
  updatedAt: string;
}

export interface AuthorProfile {
  id: number;
  userId: number;
  penName: string;
  biography: string;
  websiteUrl: string;
  verificationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  verificationNote: string;
  followerCount: number;
}

export interface Genre {
  id: number;
  slug: string;
  name: string;
  description: string;
  displayOrder: number;
}

export interface NovelSummary {
  id: string;
  authorId: number;
  title: string;
  slug: string;
  subtitle: string;
  synopsis: string;
  coverUrl: string;
  language: string;
  status: 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'ARCHIVED' | 'REJECTED';
  completionStatus: 'ONGOING' | 'COMPLETED' | 'HIATUS';
  totalWords: number;
  chapterCount: number;
  viewCount: number;
  avgRating: number;
  ratingCount: number;
  featuredRank: number;
  version: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  authorName?: string;
  authorVerified?: boolean;
  genres: Array<{ id: number; slug: string; name: string }>;
}

export interface ChapterSummary {
  id: string;
  novelId: string;
  chapterNumber: number;
  title: string;
  slug: string;
  status: 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'ARCHIVED';
  plainExcerpt: string;
  wordCount: number;
  readingMinutes: number;
  scheduledPublishAt?: string | null;
  publishedAt: string | null;
  currentVersionNumber?: number;
  version?: number;
  contentHtml?: string;
}

export interface ChapterFull extends ChapterSummary {
  contentHtml: string;
  currentVersionNumber: number;
  version: number;
}

export interface ChapterVersion {
  id: string;
  chapterId: string;
  versionNumber: number;
  title: string;
  contentHtml: string;
  wordCount: number;
  checksumSha256: string;
  changeSummary: string;
  createdAt: string;
}

export interface ReviewItem {
  id: string;
  userId: number;
  novelId: string;
  rating: number;
  title: string;
  body: string;
  helpfulCount: number;
  createdAt: string;
  reviewerName: string | null;
}

export interface CommentItem {
  id: string;
  chapterId: string;
  userId: number;
  parentCommentId: string | null;
  bodyHtml: string;
  createdAt: string;
  authorName: string | null;
}

export interface ReadingProgressItem {
  id: string;
  novelId: string;
  chapterId: string;
  scrollPercent: number;
  progressPercent: number;
  version: number;
  lastReadAt: string;
  novelTitle: string;
  novelSlug: string;
  novelCoverUrl: string;
  chapterTitle: string;
  chapterNumber: number;
}

export interface BookmarkItem {
  id: string;
  novelId: string;
  chapterId: string;
  paragraphIndex: number;
  quoteExcerpt: string;
  note: string;
  createdAt: string;
  novelTitle: string;
  novelSlug: string;
  chapterTitle: string;
  chapterNumber: number;
}

export interface ReadingList {
  id: string;
  name: string;
  description: string;
  visibility: 'PRIVATE' | 'PUBLIC';
  items: Array<{
    listId: string;
    novelId: string;
    novelTitle: string;
    novelSlug: string;
    coverUrl: string;
  }>;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  linkPath: string;
  readAt: string | null;
  createdAt: string;
}
