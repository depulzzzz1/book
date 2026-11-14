import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================================
// 1. IDENTITY, AUTHENTICATION & RBAC
// ============================================================================

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  role: text('role').notNull().default('READER'), // READER | AUTHOR | EDITOR | ADMIN
  tenantId: text('tenant_id').notNull().default('litera-public'),
  passwordHash: text('password_hash'),
  authProvider: text('auth_provider').notNull().default('LOCAL'), // LOCAL | FIREBASE
  isActive: boolean('is_active').notNull().default(true),
  isVerified: boolean('is_verified').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const userProfiles = pgTable('user_profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  displayName: text('display_name').notNull(),
  bio: text('bio').notNull().default(''),
  avatarUrl: text('avatar_url').notNull().default(''),
  preferredTheme: text('preferred_theme').notNull().default('ivory'), // ivory | sepia | dark
  preferredFont: text('preferred_font').notNull().default('serif'), // serif | sans
  preferredFontSize: integer('preferred_font_size').notNull().default(19),
  preferredLineHeight: real('preferred_line_height').notNull().default(1.75),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const authorProfiles = pgTable('author_profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  penName: text('pen_name').notNull(),
  biography: text('biography').notNull().default(''),
  websiteUrl: text('website_url').notNull().default(''),
  verificationStatus: text('verification_status').notNull().default('UNVERIFIED'), // UNVERIFIED | PENDING | VERIFIED | REJECTED
  verificationNote: text('verification_note').notNull().default(''),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  verifiedBy: integer('verified_by').references(() => users.id),
  followerCount: integer('follower_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const permissions = pgTable('permissions', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  description: text('description').notNull(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: integer('role_id')
      .references(() => roles.id, { onDelete: 'cascade' })
      .notNull(),
    permissionId: integer('permission_id')
      .references(() => permissions.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })]
);

export const userSessions = pgTable(
  'user_sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    userAgent: text('user_agent').notNull().default(''),
    ipHash: text('ip_hash').notNull().default(''),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_user_sessions_user_id').on(t.userId)]
);

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: text('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ============================================================================
// 2. DIGITAL NOVEL LIBRARY & MANUSCRIPT VERSIONING
// ============================================================================

export const genres = pgTable('genres', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  parentId: integer('parent_id'),
  displayOrder: integer('display_order').notNull().default(0),
});

export const novels = pgTable(
  'novels',
  {
    id: text('id').primaryKey(),
    authorId: integer('author_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),
    subtitle: text('subtitle').notNull().default(''),
    synopsis: text('synopsis').notNull(),
    coverUrl: text('cover_url').notNull().default(''),
    language: text('language').notNull().default('en'),
    status: text('status').notNull().default('DRAFT'), // DRAFT | PENDING_REVIEW | PUBLISHED | ARCHIVED | REJECTED
    completionStatus: text('completion_status').notNull().default('ONGOING'), // ONGOING | COMPLETED | HIATUS
    totalWords: integer('total_words').notNull().default(0),
    chapterCount: integer('chapter_count').notNull().default(0),
    viewCount: integer('view_count').notNull().default(0),
    avgRating: real('avg_rating').notNull().default(0),
    ratingCount: integer('rating_count').notNull().default(0),
    featuredRank: integer('featured_rank').notNull().default(100),
    version: integer('version').notNull().default(1),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_novels_status_published').on(t.status, t.publishedAt),
    index('idx_novels_author_id').on(t.authorId),
  ]
);

export const novelGenres = pgTable(
  'novel_genres',
  {
    novelId: text('novel_id')
      .references(() => novels.id, { onDelete: 'cascade' })
      .notNull(),
    genreId: integer('genre_id')
      .references(() => genres.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.novelId, t.genreId] })]
);

export const chapters = pgTable(
  'chapters',
  {
    id: text('id').primaryKey(),
    novelId: text('novel_id')
      .references(() => novels.id, { onDelete: 'cascade' })
      .notNull(),
    chapterNumber: integer('chapter_number').notNull(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    status: text('status').notNull().default('DRAFT'), // DRAFT | SCHEDULED | PUBLISHED | ARCHIVED
    contentHtml: text('content_html').notNull().default(''),
    plainExcerpt: text('plain_excerpt').notNull().default(''),
    wordCount: integer('word_count').notNull().default(0),
    readingMinutes: integer('reading_minutes').notNull().default(1),
    scheduledPublishAt: timestamp('scheduled_publish_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    currentVersionNumber: integer('current_version_number').notNull().default(1),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('uq_chapters_novel_num').on(t.novelId, t.chapterNumber),
    index('idx_chapters_novel_status').on(t.novelId, t.status),
  ]
);

export const chapterVersions = pgTable(
  'chapter_versions',
  {
    id: text('id').primaryKey(),
    chapterId: text('chapter_id')
      .references(() => chapters.id, { onDelete: 'cascade' })
      .notNull(),
    versionNumber: integer('version_number').notNull(),
    title: text('title').notNull(),
    contentHtml: text('content_html').notNull(),
    wordCount: integer('word_count').notNull().default(0),
    checksumSha256: text('checksum_sha256').notNull(),
    changeSummary: text('change_summary').notNull().default('Revision saved'),
    createdBy: integer('created_by')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('uq_chapter_versions_num').on(t.chapterId, t.versionNumber)]
);

// ============================================================================
// 3. READER EXPERIENCE (PROGRESS, BOOKMARKS, PERSONAL COLLECTIONS)
// ============================================================================

export const readingProgress = pgTable(
  'reading_progress',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    novelId: text('novel_id')
      .references(() => novels.id, { onDelete: 'cascade' })
      .notNull(),
    chapterId: text('chapter_id')
      .references(() => chapters.id, { onDelete: 'cascade' })
      .notNull(),
    scrollPercent: real('scroll_percent').notNull().default(0),
    progressPercent: real('progress_percent').notNull().default(0),
    version: integer('version').notNull().default(1),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('uq_reading_progress_user_novel').on(t.userId, t.novelId)]
);

export const bookmarks = pgTable(
  'bookmarks',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    novelId: text('novel_id')
      .references(() => novels.id, { onDelete: 'cascade' })
      .notNull(),
    chapterId: text('chapter_id')
      .references(() => chapters.id, { onDelete: 'cascade' })
      .notNull(),
    paragraphIndex: integer('paragraph_index').notNull().default(0),
    quoteExcerpt: text('quote_excerpt').notNull().default(''),
    note: text('note').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_bookmarks_user_novel').on(t.userId, t.novelId)]
);

export const readingLists = pgTable(
  'reading_lists',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    visibility: text('visibility').notNull().default('PRIVATE'), // PRIVATE | PUBLIC
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_reading_lists_user').on(t.userId)]
);

export const readingListItems = pgTable(
  'reading_list_items',
  {
    listId: text('list_id')
      .references(() => readingLists.id, { onDelete: 'cascade' })
      .notNull(),
    novelId: text('novel_id')
      .references(() => novels.id, { onDelete: 'cascade' })
      .notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.listId, t.novelId] })]
);

// ============================================================================
// 4. COMMUNITY (REVIEWS, COMMENTS, FOLLOWS, NOTIFICATIONS)
// ============================================================================

export const reviews = pgTable(
  'reviews',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    novelId: text('novel_id')
      .references(() => novels.id, { onDelete: 'cascade' })
      .notNull(),
    rating: integer('rating').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    helpfulCount: integer('helpful_count').notNull().default(0),
    status: text('status').notNull().default('PUBLISHED'), // PUBLISHED | HIDDEN
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('uq_reviews_user_novel').on(t.userId, t.novelId)]
);

export const comments = pgTable(
  'comments',
  {
    id: text('id').primaryKey(),
    chapterId: text('chapter_id')
      .references(() => chapters.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    parentCommentId: text('parent_comment_id'),
    bodyHtml: text('body_html').notNull(),
    status: text('status').notNull().default('VISIBLE'), // VISIBLE | HIDDEN | DELETED
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_comments_chapter').on(t.chapterId, t.createdAt)]
);

export const follows = pgTable(
  'follows',
  {
    followerId: integer('follower_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    authorId: integer('author_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.followerId, t.authorId] })]
);

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    linkPath: text('link_path').notNull().default('/'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_notifications_user_read').on(t.userId, t.readAt)]
);

// ============================================================================
// 5. GOVERNANCE, MODERATION, PUBLICATION EVENTS & AUDIT LOGS
// ============================================================================

export const reports = pgTable(
  'reports',
  {
    id: text('id').primaryKey(),
    reporterId: integer('reporter_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    targetType: text('target_type').notNull(), // NOVEL | CHAPTER | REVIEW | COMMENT | AUTHOR
    targetId: text('target_id').notNull(),
    reason: text('reason').notNull(),
    details: text('details').notNull().default(''),
    status: text('status').notNull().default('OPEN'), // OPEN | UNDER_REVIEW | RESOLVED | DISMISSED
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_reports_status').on(t.status, t.createdAt)]
);

export const moderationActions = pgTable('moderation_actions', {
  id: text('id').primaryKey(),
  reportId: text('report_id').references(() => reports.id, { onDelete: 'set null' }),
  moderatorId: integer('moderator_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  actionType: text('action_type').notNull(), // APPROVE_NOVEL | REJECT_NOVEL | VERIFY_AUTHOR | HIDE_CONTENT | DISMISS_REPORT | SUSPEND_USER
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  rationale: text('rationale').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const publicationEvents = pgTable(
  'publication_events',
  {
    id: text('id').primaryKey(),
    novelId: text('novel_id')
      .references(() => novels.id, { onDelete: 'cascade' })
      .notNull(),
    chapterId: text('chapter_id').references(() => chapters.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(), // SCHEDULE_CHAPTER | PUBLISH_CHAPTER | SUBMIT_NOVEL | APPROVE_NOVEL
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('PENDING'), // PENDING | PROCESSING | PUBLISHED | FAILED
    idempotencyKey: text('idempotency_key').notNull().unique(),
    errorMessage: text('error_message').notNull().default(''),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_publication_events_status_sched').on(t.status, t.scheduledFor)]
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    actorId: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorEmail: text('actor_email').notNull().default('system@litera.press'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    ipHash: text('ip_hash').notNull().default(''),
    previousHash: text('previous_hash').notNull(),
    recordHash: text('record_hash').notNull(),
    metadataJson: text('metadata_json').notNull().default('{}'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_audit_logs_created').on(t.createdAt)]
);

export const systemConfigs = pgTable('system_configs', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  description: text('description').notNull().default(''),
  updatedBy: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ============================================================================
// RELATIONS
// ============================================================================

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(userProfiles, { fields: [users.id], references: [userProfiles.userId] }),
  authorProfile: one(authorProfiles, { fields: [users.id], references: [authorProfiles.userId] }),
  novels: many(novels),
  reviews: many(reviews),
  bookmarks: many(bookmarks),
  readingLists: many(readingLists),
}));

export const novelsRelations = relations(novels, ({ one, many }) => ({
  author: one(users, { fields: [novels.authorId], references: [users.id] }),
  chapters: many(chapters),
  reviews: many(reviews),
  novelGenres: many(novelGenres),
}));

export const chaptersRelations = relations(chapters, ({ one, many }) => ({
  novel: one(novels, { fields: [chapters.novelId], references: [novels.id] }),
  versions: many(chapterVersions),
  comments: many(comments),
}));

// ============================================================================
// LEGACY WORKSPACE TABLES (Non-destructive Cloud SQL push compatibility)
// ============================================================================

export const workflows = pgTable('workflows', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-alpha-01'),
  name: text('name').notNull(),
  version: text('version').notNull().default('1.0.0'),
  specificationJson: text('specification_json').notNull(),
  compiledPlanJson: text('compiled_plan_json').notNull(),
  status: text('status').notNull().default('VERIFIED'),
  complexityOrder: text('complexity_order').notNull().default('O(V + E)'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const executionTasks = pgTable('execution_tasks', {
  id: text('id').primaryKey(),
  workflowId: text('workflow_id').notNull(),
  runId: text('run_id').notNull(),
  nodeId: text('node_id').notNull(),
  tenantId: text('tenant_id').notNull().default('tenant-alpha-01'),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  status: text('status').notNull().default('PENDING'),
  fencingToken: integer('fencing_token').notNull().default(1),
  workerId: text('worker_id').notNull().default('worker-node-01'),
  leaseExpiresAt: text('lease_expires_at').notNull(),
  attemptCount: integer('attempt_count').notNull().default(1),
  maxRetries: integer('max_retries').notNull().default(3),
  inputPayloadJson: text('input_payload_json').notNull().default('{}'),
  outputPayloadJson: text('output_payload_json').notNull().default('{}'),
  latencyMs: integer('latency_ms').notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const cognitiveAgents = pgTable('cognitive_agents', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-alpha-01'),
  name: text('name').notNull(),
  specialty: text('specialty').notNull(),
  modelAlias: text('model_alias').notNull().default('gemini-3.8-flash'),
  allowedCapabilitiesJson: text('allowed_capabilities_json').notNull(),
  memoryWindowLimit: integer('memory_window_limit').notNull().default(16),
  tokenQuotaPerRun: integer('token_quota_per_run').notNull().default(8192),
  status: text('status').notNull().default('NOMINAL'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const hitlApprovals = pgTable('hitl_approvals', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  agentId: text('agent_id').notNull(),
  toolName: text('tool_name').notNull(),
  argumentsJson: text('arguments_json').notNull(),
  riskClassification: text('risk_classification').notNull().default('CRITICAL_SIDE_EFFECT'),
  provenanceHash: text('provenance_hash').notNull(),
  status: text('status').notNull().default('PENDING'),
  reviewerUid: text('reviewer_uid').notNull().default('UNASSIGNED'),
  decidedAt: text('decided_at').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow(),
});

export const outboxEvents = pgTable('outbox_events', {
  id: text('id').primaryKey(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  eventType: text('event_type').notNull(),
  schemaVersion: integer('schema_version').notNull().default(1),
  payloadJson: text('payload_json').notNull(),
  idempotencyHash: text('idempotency_hash').notNull(),
  status: text('status').notNull().default('PUBLISHED'),
  retryCount: integer('retry_count').notNull().default(0),
  errorReason: text('error_reason').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow(),
});

export const commEnvelopes = pgTable('comm_envelopes', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  direction: text('direction').notNull(),
  senderId: text('sender_id').notNull(),
  recipientId: text('recipient_id').notNull(),
  normalizedContentJson: text('normalized_content_json').notNull(),
  signatureVerified: boolean('signature_verified').notNull().default(true),
  signatureHash: text('signature_hash').notNull(),
  status: text('status').notNull().default('DELIVERED'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const pluginsRegistry = pgTable('plugins_registry', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  version: text('version').notNull(),
  sha256Signature: text('sha256_signature').notNull(),
  declaredCapabilitiesJson: text('declared_capabilities_json').notNull(),
  quotaCpuMs: integer('quota_cpu_ms').notNull().default(250),
  quotaMemoryMb: integer('quota_memory_mb').notNull().default(64),
  sourceCode: text('source_code').notNull(),
  verificationStatus: text('verification_status').notNull().default('VERIFIED'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

export const auditRecords = pgTable('audit_records', {
  id: serial('id').primaryKey(),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(),
  subsystem: text('subsystem').notNull(),
  resourceId: text('resource_id').notNull(),
  previousHash: text('previous_hash').notNull(),
  recordHash: text('record_hash').notNull(),
  metadataJson: text('metadata_json').notNull().default('{}'),
  createdAt: timestamp('created_at').defaultNow(),
});
