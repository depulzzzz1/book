import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  authorProfiles,
  chapterVersions,
  chapters,
  comments,
  genres,
  novelGenres,
  novels,
  permissions,
  publicationEvents,
  reviews,
  rolePermissions,
  roles,
  systemConfigs,
  userProfiles,
  users,
} from '../db/schema.ts';
import { appendLiteraAudit, hashPasswordArgon2id } from './security.ts';

let seededOnce = false;

export async function ensureLiteraSeed() {
  if (seededOnce) return;

  try {
    // 1. Roles & Permissions
    const roleDefs = [
      { name: 'READER', description: 'Standard library reader with bookmarks, lists, reviews, and comments.' },
      { name: 'AUTHOR', description: 'Published or independent writer with Author Studio and manuscript versioning access.' },
      { name: 'EDITOR', description: 'Editorial reviewer authorized to approve novels, verify authors, and moderate reports.' },
      { name: 'ADMIN', description: 'Platform administrator with user, role, permission, configuration, and audit oversight.' },
    ];

    for (const r of roleDefs) {
      await db.insert(roles).values(r).onConflictDoNothing();
    }

    const permDefs = [
      { code: 'catalog.read', description: 'Browse published catalog and chapters' },
      { code: 'library.manage', description: 'Save reading progress, bookmarks, and collections' },
      { code: 'community.participate', description: 'Publish reviews, chapter comments, follows, and reports' },
      { code: 'studio.write', description: 'Create and revise manuscripts in Author Studio' },
      { code: 'studio.publish', description: 'Submit novels and publish or schedule chapters' },
      { code: 'moderation.review', description: 'Approve novels, verify authors, and resolve content reports' },
      { code: 'admin.users', description: 'Manage user status, roles, and permissions' },
      { code: 'admin.system', description: 'Update platform configuration and inspect audit logs' },
    ];

    for (const p of permDefs) {
      await db.insert(permissions).values(p).onConflictDoNothing();
    }

    const allRoles = await db.select().from(roles);
    const allPerms = await db.select().from(permissions);
    const roleByName = new Map(allRoles.map((r) => [r.name, r.id]));
    const permByCode = new Map(allPerms.map((p) => [p.code, p.id]));

    const matrix: Record<string, string[]> = {
      READER: ['catalog.read', 'library.manage', 'community.participate'],
      AUTHOR: ['catalog.read', 'library.manage', 'community.participate', 'studio.write', 'studio.publish'],
      EDITOR: [
        'catalog.read',
        'library.manage',
        'community.participate',
        'studio.write',
        'studio.publish',
        'moderation.review',
      ],
      ADMIN: permDefs.map((p) => p.code),
    };

    for (const [roleName, codes] of Object.entries(matrix)) {
      const rId = roleByName.get(roleName);
      if (!rId) continue;
      for (const code of codes) {
        const pId = permByCode.get(code);
        if (!pId) continue;
        await db.insert(rolePermissions).values({ roleId: rId, permissionId: pId }).onConflictDoNothing();
      }
    }

    // 2. Genres
    const genreDefs = [
      { slug: 'literary-fiction', name: 'Literary Fiction', description: 'Character-driven works of psychological depth and prose craft.', displayOrder: 1 },
      { slug: 'historical-chronicle', name: 'Historical Chronicle', description: 'Fictionalized and archival portraits of pivotal eras.', displayOrder: 2 },
      { slug: 'speculative-fiction', name: 'Speculative Fiction', description: 'Philosophical futures, alternate histories, and quiet marvels.', displayOrder: 3 },
      { slug: 'mystery-noir', name: 'Mystery & Noir', description: 'Atmospheric investigations, moral ambiguity, and maritime fog.', displayOrder: 4 },
      { slug: 'essays-criticism', name: 'Essays & Letters', description: 'Epistolary prose, architectural essays, and cultural notebooks.', displayOrder: 5 },
      { slug: 'philosophical-drama', name: 'Philosophical Drama', description: 'Intimate chamber narratives examining memory, art, and ethics.', displayOrder: 6 },
    ];

    for (const g of genreDefs) {
      await db.insert(genres).values(g).onConflictDoNothing();
    }

    // 3. System Configurations
    const defaultConfigs = [
      {
        key: 'editorial.require_novel_approval',
        valueJson: JSON.stringify(true),
        description: 'Require editorial review before newly submitted novels enter the public catalog.',
      },
      {
        key: 'community.comments_enabled',
        valueJson: JSON.stringify(true),
        description: 'Allow authenticated readers to post threaded chapter margin commentary.',
      },
      {
        key: 'security.max_sessions_per_user',
        valueJson: JSON.stringify(10),
        description: 'Maximum concurrent active sessions permitted per account.',
      },
    ];
    for (const cfg of defaultConfigs) {
      await db.insert(systemConfigs).values(cfg).onConflictDoNothing();
    }

    // Check if catalog already seeded
    const existingNovels = await db.select({ id: novels.id }).from(novels).limit(1);
    if (existingNovels.length > 0) {
      seededOnce = true;
      return;
    }

    // 4. Seed Editorial Authors (ephemeral random Argon2id password hashes; no hardcoded credentials)
    const authorSeeds = [
      {
        uid: 'litera_author_elena_vance',
        email: 'elena.vance@press.litera.org',
        displayName: 'Elena Vance',
        penName: 'Elena Vance',
        bio: 'Novelist and historian of early European instrumentation. Winner of the Archival Prose Prize.',
        verified: true,
      },
      {
        uid: 'litera_author_henrik_solberg',
        email: 'henrik.solberg@press.litera.org',
        displayName: 'Henrik Solberg',
        penName: 'Henrik Solberg',
        bio: 'Norwegian maritime essayist and chronicler of North Atlantic coastal stations.',
        verified: true,
      },
      {
        uid: 'litera_author_clara_moreau',
        email: 'clara.moreau@press.litera.org',
        displayName: 'Clara Moreau',
        penName: 'Clara Moreau',
        bio: 'Architectural historian writing quiet fiction set in Mediterranean port libraries.',
        verified: true,
      },
      {
        uid: 'litera_author_kenji_takahashi',
        email: 'kenji.takahashi@press.litera.org',
        displayName: 'Kenji Takahashi',
        penName: 'Kenji Takahashi',
        bio: 'Translator and novelist exploring Kyoto craft traditions, rain, and epistolary memory.',
        verified: true,
      },
    ];

    const authorIdMap = new Map<string, number>();

    for (const a of authorSeeds) {
      const randomSecret = crypto.randomBytes(24).toString('hex');
      const pwHash = await hashPasswordArgon2id(randomSecret);
      const [insertedUser] = await db
        .insert(users)
        .values({
          uid: a.uid,
          email: a.email,
          role: 'AUTHOR',
          tenantId: 'litera-public',
          passwordHash: pwHash,
          authProvider: 'LOCAL',
          isActive: true,
          isVerified: true,
        })
        .onConflictDoNothing()
        .returning();

      let userId = insertedUser?.id;
      if (!userId) {
        const [found] = await db.select().from(users).where(eq(users.uid, a.uid)).limit(1);
        userId = found?.id;
      }
      if (!userId) continue;

      authorIdMap.set(a.uid, userId);

      await db
        .insert(userProfiles)
        .values({
          userId,
          displayName: a.displayName,
          bio: a.bio,
        })
        .onConflictDoNothing();

      await db
        .insert(authorProfiles)
        .values({
          userId,
          penName: a.penName,
          biography: a.bio,
          verificationStatus: a.verified ? 'VERIFIED' : 'UNVERIFIED',
          verifiedAt: a.verified ? new Date() : null,
          followerCount: 120 + Math.floor(Math.random() * 200),
        })
        .onConflictDoNothing();
    }

    const allGenres = await db.select().from(genres);
    const genreIdBySlug = new Map(allGenres.map((g) => [g.slug, g.id]));

    // 5. Seed Novels & Chapters
    const catalogSeeds = [
      {
        id: 'novel-glass-astrolabe',
        authorUid: 'litera_author_elena_vance',
        title: 'The Glass Astrolabe',
        slug: 'the-glass-astrolabe',
        subtitle: 'A Prague Clockmaker’s Ledger of Celestial Errors',
        synopsis:
          'In the winter of 1611, an apprentice lens-grinder discovers a hidden brass instrument inside a Jesuit observatory—one calibrated for stars that have not yet shifted in the northern sky. A meditation on precision, heresy, and quiet devotion.',
        coverUrl: '/assets/editorial/cover_glass_astrolabe_1794634569418.jpg',
        completionStatus: 'COMPLETED',
        featuredRank: 1,
        viewCount: 4820,
        avgRating: 4.9,
        ratingCount: 2,
        genreSlugs: ['historical-chronicle', 'literary-fiction'],
        chapters: [
          {
            id: 'chap-astrolabe-01',
            num: 1,
            title: 'The Brass Meridian',
            html: `<p>Snow settled along the lead mullions of the Clementinum workshop before the third bell rang across the Vltava. Lukas adjusted the oil wick until the brass disc in his palm caught only a narrow crescent of light.</p><p>No guild stamp marked its reverse plate. Instead, someone had engraved three concentric arcs with a needle so fine that the metal seemed bruised rather than cut. Where the ecliptic should have met the horizon line of Prague, the line fractured into a delicate spiral.</p><blockquote>“Every instrument confesses the tremor of the hand that calibrated it,” Master Verner had told him the autumn before his fever. “Never trust a circle that claims to close without remainder.”</blockquote><p>Lukas laid the astrolabe beside his grinding ledger and opened the vellum pocket stitched into the velvet case. Inside rested four slips of linen paper folded into tight hexagonal seals, each bearing the water-mark of a Nuremberg mill that had burned thirty years prior.</p><p>Outside, sleigh runners hissed over packed cobbles. Within the observatory tower, only the pendulum ticked—patient, indifferent, and slightly ahead of the cathedral clock.</p>`,
          },
          {
            id: 'chap-astrolabe-02',
            num: 2,
            title: 'Notes in Iron-Gall Ink',
            html: `<p>By midnight the frost had climbed half the windowpane, turning the courtyard lantern into a blurred amber halo. Lukas warmed an iron nib over the brazier and copied the azimuth tables column by column.</p><p>The arithmetic was unmistakable: whoever had computed these declinations had worked from a latitude eleven minutes north of Bohemia, likely on an island swept by salt wind. Yet the margins were filled with Prague street names—Celetná, the Old Timber Market, the apothecary beneath the Stone Bell.</p><p>When the watchman’s lantern paused at the courtyard gate, Lukas extinguished his candle and stood still in the dark, listening to the slow contraction of cold timber overhead.</p>`,
          },
        ],
      },
      {
        id: 'novel-winter-monograph',
        authorUid: 'litera_author_henrik_solberg',
        title: 'The Winter Monograph',
        slug: 'the-winter-monograph',
        subtitle: 'Dispatches from Skagerrak Light Station',
        synopsis:
          'Sent to catalogue forty years of barometer logs at a decommissioned stone lighthouse, an archivist uncovers letters tucked between the tidal charts—chronicling two keepers who debated philosophy across storms.',
        coverUrl: '/assets/editorial/cover_winter_monograph_1794634569760.jpg',
        completionStatus: 'ONGOING',
        featuredRank: 2,
        viewCount: 3690,
        avgRating: 4.7,
        ratingCount: 1,
        genreSlugs: ['mystery-noir', 'literary-fiction'],
        chapters: [
          {
            id: 'chap-winter-01',
            num: 1,
            title: 'Barometer at Low Tide',
            html: `<p>The ferry left me on the granite jetty at four in the afternoon, when the sun was already no brighter than a wet coin behind slate cloud. My canvas trunk smelled of cedar shavings and damp wool.</p><p>Inside the watchtower, the Fresnel lens hung motionless in its brass cradle like a sleeping jellyfish. Stacks of leather-bound meteorological registers lined the curved wall from floor to iron gallery.</p><blockquote>“October 14, 1953: Wind backing northeast, force nine. Keepers disagree on whether memory obeys conservation laws.”</blockquote><p>I set my thermos beside the inkwell and opened the 1953 ledger. Between pages eighty-four and eighty-five lay a pressed sprig of sea thrift and an unposted envelope addressed to Bergen.</p>`,
          },
          {
            id: 'chap-winter-02',
            num: 2,
            title: 'The Lantern Room Inventory',
            html: `<p>During the second week, fog erased the mainland completely. Only the rhythmic slap of swell against the basalt shelf marked the passage of hours.</p><p>Up in the service gallery, I found three crates of glass plates wrapped in greased paper. Held against the grey skylight, each negative revealed the same cliff face photographed from identical coordinates across twelve consecutive winters—recording the slow, patient retreat of stone before salt.</p>`,
          },
        ],
      },
      {
        id: 'novel-cartographers-house',
        authorUid: 'litera_author_clara_moreau',
        title: 'The Cartographer’s House',
        slug: 'the-cartographers-house',
        subtitle: 'Colonnades of Memory in Trieste',
        synopsis:
          'A restorer of civic blueprints inherits a limestone townhouse overlooking the Adriatic, where every wall conceals earlier ink elevations of a city that was planned on paper and quietly abandoned.',
        coverUrl: '/assets/editorial/cover_cartographers_house_1794634570419.jpg',
        completionStatus: 'COMPLETED',
        featuredRank: 3,
        viewCount: 2940,
        avgRating: 4.8,
        ratingCount: 1,
        genreSlugs: ['philosophical-drama', 'historical-chronicle'],
        chapters: [
          {
            id: 'chap-cartographer-01',
            num: 1,
            title: 'Lime Plaster & Tracing Linen',
            html: `<p>When we peeled back the nineteenth-century wallpaper in the east colonnade, the plaster beneath was scored with compass arcs. Not carpenter’s marks—these were drawn with surveyor’s lead at a scale of one to fifty.</p><p>My great-uncle Matteo had lived in these three rooms for half a century, rarely descending to the harbor except to purchase linen rag paper from the stationer near Piazza Unità. Friends assumed he was retiring into silence; in truth, he was drafting an invisible city directly onto his own walls.</p><p>By dusk, as the Bora wind rattled the shutters, the pencil lines along the southern arch seemed to lift off the lime like shadows cast by colonnades that had never been quarried.</p>`,
          },
        ],
      },
      {
        id: 'novel-letters-kyoto',
        authorUid: 'litera_author_kenji_takahashi',
        title: 'Letters from Rain-Lit Kyoto',
        slug: 'letters-from-rain-lit-kyoto',
        subtitle: 'Notebooks of a Paper Conservator',
        synopsis:
          'Twelve seasonal letters exchanged between a Kyoto paper conservator and a bookbinder in Antwerp, reflecting on ink permanence, cedar architecture, and the ethics of repair.',
        coverUrl: '/assets/editorial/cover_letters_from_kyoto_1794634570326.jpg',
        completionStatus: 'ONGOING',
        featuredRank: 4,
        viewCount: 3180,
        avgRating: 4.9,
        ratingCount: 1,
        genreSlugs: ['essays-criticism', 'speculative-fiction'],
        chapters: [
          {
            id: 'chap-kyoto-01',
            num: 1,
            title: 'First Letter: On Cedar Eaves and Kozo Fiber',
            html: `<p>Dear Pieter, the autumn rain arrived early in Sakyo Ward, darkening the cedar beams along the veranda until they look nearly black. I spent the morning testing wheat-starch paste for the seventeenth-century botanical folios you sent from Antwerp.</p><p>What strikes me each time I mend a torn leaf is how honestly handmade paper remembers water. Machine-pressed sheets buckle when dampened; long mulberry fibers merely relax, returning to the geometry of the screen on which they were formed.</p><blockquote>“Repair is not erasure. A visible seam honors the years a book has survived.”</blockquote><p>Tomorrow I will hang the damp leaves on the cedar drying boards and write to you again once the ink tests have settled.</p>`,
          },
        ],
      },
    ];

    for (const item of catalogSeeds) {
      const authorId = authorIdMap.get(item.authorUid);
      if (!authorId) continue;

      let totalWords = 0;
      for (const ch of item.chapters) {
        const plain = ch.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        totalWords += plain.split(' ').filter(Boolean).length;
      }

      await db
        .insert(novels)
        .values({
          id: item.id,
          authorId,
          title: item.title,
          slug: item.slug,
          subtitle: item.subtitle,
          synopsis: item.synopsis,
          coverUrl: item.coverUrl,
          language: 'en',
          status: 'PUBLISHED',
          completionStatus: item.completionStatus,
          totalWords,
          chapterCount: item.chapters.length,
          viewCount: item.viewCount,
          avgRating: item.avgRating,
          ratingCount: item.ratingCount,
          featuredRank: item.featuredRank,
          version: 1,
          publishedAt: new Date(Date.now() - item.featuredRank * 86400000 * 5),
        })
        .onConflictDoNothing();

      for (const gSlug of item.genreSlugs) {
        const gId = genreIdBySlug.get(gSlug);
        if (gId) {
          await db.insert(novelGenres).values({ novelId: item.id, genreId: gId }).onConflictDoNothing();
        }
      }

      for (const ch of item.chapters) {
        const plain = ch.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const words = plain.split(' ').filter(Boolean).length;
        const excerpt = plain.slice(0, 200) + (plain.length > 200 ? '...' : '');
        const checksum = crypto.createHash('sha256').update(ch.html).digest('hex');

        await db
          .insert(chapters)
          .values({
            id: ch.id,
            novelId: item.id,
            chapterNumber: ch.num,
            title: ch.title,
            slug: ch.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            status: 'PUBLISHED',
            contentHtml: ch.html,
            plainExcerpt: excerpt,
            wordCount: words,
            readingMinutes: Math.max(1, Math.ceil(words / 225)),
            publishedAt: new Date(Date.now() - item.featuredRank * 86400000 * 3),
            currentVersionNumber: 1,
            version: 1,
          })
          .onConflictDoNothing();

        await db
          .insert(chapterVersions)
          .values({
            id: `ver-${ch.id}-1`,
            chapterId: ch.id,
            versionNumber: 1,
            title: ch.title,
            contentHtml: ch.html,
            wordCount: words,
            checksumSha256: checksum,
            changeSummary: 'Initial press edition',
            createdBy: authorId,
          })
          .onConflictDoNothing();
      }

      await db
        .insert(publicationEvents)
        .values({
          id: `pub-evt-${item.id}`,
          novelId: item.id,
          eventType: 'APPROVE_NOVEL',
          scheduledFor: new Date(),
          status: 'PUBLISHED',
          idempotencyKey: `seed-publish-${item.id}`,
          processedAt: new Date(),
        })
        .onConflictDoNothing();
    }

    // 6. Seed Editorial Reviews & Sample Reader Comments
    const elenaId = authorIdMap.get('litera_author_elena_vance');
    const henrikId = authorIdMap.get('litera_author_henrik_solberg');
    const claraId = authorIdMap.get('litera_author_clara_moreau');
    const kenjiId = authorIdMap.get('litera_author_kenji_takahashi');

    if (henrikId && claraId) {
      await db
        .insert(reviews)
        .values([
          {
            id: 'rev-astrolabe-1',
            userId: henrikId,
            novelId: 'novel-glass-astrolabe',
            rating: 5,
            title: 'Extraordinary precision and atmospheric restraint',
            body: 'Elena Vance writes about brass, winter light, and mathematical devotion with the tactile clarity of a museum monograph.',
            helpfulCount: 14,
          },
          {
            id: 'rev-astrolabe-2',
            userId: claraId,
            novelId: 'novel-glass-astrolabe',
            rating: 5,
            title: 'A quiet triumph of historical fiction',
            body: 'Every workshop detail earns its place on the page. I read both chapters in a single sitting.',
            helpfulCount: 9,
          },
        ])
        .onConflictDoNothing();
    }

    if (kenjiId && elenaId) {
      await db
        .insert(reviews)
        .values([
          {
            id: 'rev-winter-1',
            userId: kenjiId,
            novelId: 'novel-winter-monograph',
            rating: 5,
            title: 'Salt wind and philosophical rigor',
            body: 'The interplay between meteorological rigor and human solitude makes this unforgettable.',
            helpfulCount: 11,
          },
          {
            id: 'rev-kyoto-1',
            userId: elenaId,
            novelId: 'novel-letters-kyoto',
            rating: 5,
            title: 'Luminous reflections on repair',
            body: 'A rare epistolary work that treats craft as a moral philosophy.',
            helpfulCount: 8,
          },
        ])
        .onConflictDoNothing();

      await db
        .insert(comments)
        .values([
          {
            id: 'cmt-astrolabe-1',
            chapterId: 'chap-astrolabe-01',
            userId: kenjiId,
            bodyHtml: '<p>The line from Master Verner about circles never closing without remainder sets the tone beautifully.</p>',
          },
        ])
        .onConflictDoNothing();
    }

    await appendLiteraAudit({
      actorEmail: 'system@litera.press',
      action: 'CATALOG_INITIALIZED',
      resourceType: 'SYSTEM',
      resourceId: 'litera-seed-v1',
      metadata: { novels: catalogSeeds.length, genres: genreDefs.length },
    });

    seededOnce = true;
  } catch (err) {
    console.error('LITERA seed error:', err);
  }
}
