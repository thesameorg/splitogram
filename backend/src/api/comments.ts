import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, asc, gt, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  expenses,
  expenseComments,
  expenseParticipants,
  users,
  groups,
  groupMembers,
} from '../db/schema';
import { notify } from '../services/notifications';
import { makeNotifyCtx } from '../utils/notify-ctx';
import { safeR2Delete, generateR2Key, validateUpload } from '../utils/r2';
import {
  getMembership,
  getMembershipRole,
  notMemberResponse,
  parseIntParam,
  invalidIdResponse,
} from '../utils/auth-guards';
import type { AuthContext } from '../middleware/auth';
import type { DBContext } from '../middleware/db';

type CommentEnv = AuthContext & DBContext;

const commentsApp = new Hono<CommentEnv>();

const createCommentSchema = z.object({
  text: z
    .string()
    .trim()
    .max(1000)
    .transform((s) => s.replace(/[\x00-\x1f\x7f]/g, ''))
    .optional(),
});

// --- List comments for expense ---
commentsApp.get('/', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseIntParam(c, 'id');
  const expenseId = parseIntParam(c, 'expenseId');

  if (!groupId) return invalidIdResponse(c, 'group ID');
  if (!expenseId) return invalidIdResponse(c, 'expense ID');

  if (!(await getMembership(db, groupId, session.userId))) return notMemberResponse(c);

  // Verify expense belongs to group
  const [expense] = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId)))
    .limit(1);

  if (!expense) {
    return c.json({ error: 'expense_not_found', detail: 'Expense not found' }, 404);
  }

  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') ?? '50', 10) || 50), 100);
  const cursor = parseInt(c.req.query('cursor') ?? '', 10) || undefined;

  const conditions = [eq(expenseComments.expenseId, expenseId)];
  if (cursor) {
    conditions.push(gt(expenseComments.id, cursor));
  }

  const comments = await db
    .select({
      id: expenseComments.id,
      expenseId: expenseComments.expenseId,
      userId: expenseComments.userId,
      displayName: users.displayName,
      avatarKey: users.avatarKey,
      text: expenseComments.text,
      imageKey: expenseComments.imageKey,
      imageThumbKey: expenseComments.imageThumbKey,
      createdAt: expenseComments.createdAt,
    })
    .from(expenseComments)
    .innerJoin(users, eq(expenseComments.userId, users.id))
    .where(and(...conditions))
    .orderBy(asc(expenseComments.id))
    .limit(limit + 1);

  const hasMore = comments.length > limit;
  const items = hasMore ? comments.slice(0, limit) : comments;
  const nextCursor = hasMore ? String(items[items.length - 1].id) : null;

  return c.json({ comments: items, nextCursor });
});

// --- Create comment ---
commentsApp.post('/', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseIntParam(c, 'id');
  const expenseId = parseIntParam(c, 'expenseId');

  if (!groupId) return invalidIdResponse(c, 'group ID');
  if (!expenseId) return invalidIdResponse(c, 'expense ID');

  if (!(await getMembership(db, groupId, session.userId))) return notMemberResponse(c);

  // Verify expense belongs to group
  const [expense] = await db
    .select({ id: expenses.id, description: expenses.description, paidBy: expenses.paidBy })
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId)))
    .limit(1);

  if (!expense) {
    return c.json({ error: 'expense_not_found', detail: 'Expense not found' }, 404);
  }

  // Parse body — could be JSON or multipart FormData
  const contentType = c.req.header('content-type') ?? '';
  let text: string | null = null;
  let imageFile: File | null = null;
  let thumbnailFile: File | null = null;

  if (contentType.includes('multipart/form-data')) {
    const body = await c.req.parseBody();
    const rawText = body['text'];
    if (typeof rawText === 'string' && rawText.trim()) {
      text = rawText
        .trim()
        .slice(0, 1000)
        .replace(/[\x00-\x1f\x7f]/g, '');
    }
    if (body['image'] instanceof File) imageFile = body['image'] as File;
    if (body['thumbnail'] instanceof File) thumbnailFile = body['thumbnail'] as File;
  } else {
    const json = await c.req.json().catch(() => ({}));
    if (typeof json.text === 'string' && json.text.trim()) {
      text = json.text
        .trim()
        .slice(0, 1000)
        .replace(/[\x00-\x1f\x7f]/g, '');
    }
  }

  if (!text && !imageFile) {
    return c.json({ error: 'empty_comment', detail: 'Comment must have text or an image' }, 400);
  }

  // Validate image if present
  if (imageFile) {
    const validationError = validateUpload(imageFile);
    if (validationError) {
      return c.json({ error: 'invalid_file', detail: validationError }, 400);
    }
  }

  // Insert comment
  const [comment] = await db
    .insert(expenseComments)
    .values({
      expenseId,
      userId: session.userId,
      text: text || null,
    })
    .returning();

  // Upload image if present
  let imageKey: string | null = null;
  let imageThumbKey: string | null = null;

  if (imageFile) {
    imageKey = generateR2Key('comments', comment.id);
    await c.env.IMAGES.put(imageKey, await imageFile.arrayBuffer(), {
      httpMetadata: { contentType: imageFile.type },
    });

    if (thumbnailFile) {
      const thumbError = validateUpload(thumbnailFile);
      if (!thumbError) {
        imageThumbKey = imageKey.replace('.jpg', '-thumb.jpg');
        await c.env.IMAGES.put(imageThumbKey, await thumbnailFile.arrayBuffer(), {
          httpMetadata: { contentType: thumbnailFile.type },
        });
      }
    }

    // Update comment with image keys
    await db
      .update(expenseComments)
      .set({ imageKey, imageThumbKey })
      .where(eq(expenseComments.id, comment.id));
  }

  // Fetch author info for response
  const [author] = await db
    .select({ displayName: users.displayName, avatarKey: users.avatarKey })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  const result = {
    id: comment.id,
    expenseId,
    userId: session.userId,
    displayName: author.displayName,
    avatarKey: author.avatarKey,
    text: text || null,
    imageKey,
    imageThumbKey,
    createdAt: comment.createdAt,
  };

  // Fire-and-forget notification
  const notifyCtx = makeNotifyCtx(c.env, db);
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const [group] = await db
          .select({ name: groups.name })
          .from(groups)
          .where(eq(groups.id, groupId))
          .limit(1);

        // Get expense participants + payer as recipients
        const participantRows = await db
          .select({ userId: expenseParticipants.userId })
          .from(expenseParticipants)
          .where(eq(expenseParticipants.expenseId, expenseId));

        const recipientIds = new Set([expense.paidBy, ...participantRows.map((p) => p.userId)]);
        recipientIds.delete(session.userId); // exclude comment author

        if (recipientIds.size === 0) return;

        const recipients = await db
          .select({
            telegramId: users.telegramId,
            displayName: users.displayName,
            botStarted: users.botStarted,
            muted: groupMembers.muted,
          })
          .from(users)
          .innerJoin(
            groupMembers,
            and(eq(groupMembers.userId, users.id), eq(groupMembers.groupId, groupId)),
          )
          .where(inArray(users.id, [...recipientIds]));

        await notify.commentAdded(
          notifyCtx,
          { text, expenseId, groupId },
          { displayName: author.displayName },
          recipients,
          { description: expense.description },
          group.name,
        );
      } catch (e) {
        console.error('Notification failed (comment_added):', e);
      }
    })(),
  );

  return c.json(result, 201);
});

// --- Delete comment ---
commentsApp.delete('/:commentId', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseIntParam(c, 'id');
  const expenseId = parseIntParam(c, 'expenseId');
  const commentId = parseIntParam(c, 'commentId');

  if (!groupId || !expenseId || !commentId) return invalidIdResponse(c);

  const membership = await getMembershipRole(db, groupId, session.userId);
  if (!membership) return notMemberResponse(c);

  const [comment] = await db
    .select()
    .from(expenseComments)
    .where(and(eq(expenseComments.id, commentId), eq(expenseComments.expenseId, expenseId)))
    .limit(1);

  if (!comment) {
    return c.json({ error: 'comment_not_found', detail: 'Comment not found' }, 404);
  }

  if (comment.userId !== session.userId && membership.role !== 'admin') {
    return c.json(
      { error: 'not_authorized', detail: 'Only the comment author or group admin can delete' },
      403,
    );
  }

  // Clean up R2 images
  if (comment.imageKey) {
    c.executionCtx.waitUntil(safeR2Delete(c.env.IMAGES, comment.imageKey));
  }
  if (comment.imageThumbKey) {
    c.executionCtx.waitUntil(safeR2Delete(c.env.IMAGES, comment.imageThumbKey));
  }

  await db.delete(expenseComments).where(eq(expenseComments.id, commentId));

  return c.json({ deleted: true });
});

export { commentsApp };
