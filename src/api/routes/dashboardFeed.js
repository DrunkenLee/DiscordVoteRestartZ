import express from 'express';
import jwt from 'jsonwebtoken';
import { Op, fn, col } from 'sequelize';
import { DashboardFeedPost } from '../../models/dashboardFeedPost.js';
import { DashboardFeedLike } from '../../models/dashboardFeedLike.js';
import { DashboardFeedComment } from '../../models/dashboardFeedComment.js';
import { UserDetail } from '../../models/userDetail.js';
import { ZMUser } from '../../models/zmuser.js';
import { requireAuthBearer } from '../middleware/authBearer.js';

const router = express.Router();

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FEED_LIMIT = Number(process.env.DASHBOARD_FEED_DEFAULT_LIMIT || 20);
const MAX_FEED_LIMIT = Number(process.env.DASHBOARD_FEED_MAX_LIMIT || 50);
const DEFAULT_COMMENT_LIMIT = Number(process.env.DASHBOARD_FEED_COMMENT_DEFAULT_LIMIT || 40);
const MAX_COMMENT_LIMIT = Number(process.env.DASHBOARD_FEED_COMMENT_MAX_LIMIT || 120);
const MAX_POST_LENGTH = Number(process.env.DASHBOARD_FEED_POST_MAX_LENGTH || 1200);
const MAX_COMMENT_LENGTH = Number(process.env.DASHBOARD_FEED_COMMENT_MAX_LENGTH || 600);
const MAX_IMAGE_URL_LENGTH = Number(process.env.DASHBOARD_FEED_IMAGE_URL_MAX_LENGTH || 1024);

const normalizeText = (value) => String(value ?? '').trim();
const toIdKey = (value) => {
  const normalized = normalizeText(value);
  return /^\d+$/.test(normalized) ? normalized : null;
};

const toPositiveInt = (value) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const parseFeedLimit = (value) => {
  const parsed = toPositiveInt(value);
  if (!parsed) return DEFAULT_FEED_LIMIT;
  return Math.min(Math.max(parsed, 1), MAX_FEED_LIMIT);
};

const parseCommentLimit = (value) => {
  const parsed = toPositiveInt(value);
  if (!parsed) return DEFAULT_COMMENT_LIMIT;
  return Math.min(Math.max(parsed, 1), MAX_COMMENT_LIMIT);
};

const getJwtSecret = () => normalizeText(process.env.JWT_SECRET);

const readBearerToken = (authorizationHeader) => {
  const value = normalizeText(authorizationHeader);
  if (!value.toLowerCase().startsWith('bearer ')) return null;
  return normalizeText(value.slice(7)) || null;
};

const resolveOptionalAuthUser = async (req) => {
  const token = readBearerToken(req.headers.authorization);
  if (!token) return null;

  const jwtSecret = getJwtSecret();
  if (!jwtSecret) return null;

  try {
    const decoded = jwt.verify(token, jwtSecret);
    const userId = toPositiveInt(decoded?.id);
    if (!userId) return null;
    return ZMUser.findByPk(userId);
  } catch {
    return null;
  }
};

const buildAvatarUrl = (avatarPath, req) => {
  const normalized = normalizeText(avatarPath);
  if (!normalized) return null;
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return normalized;
  }

  const host = normalizeText(req.get('host'));
  if (!host) return normalized;
  return `${req.protocol}://${host}${normalized.startsWith('/') ? normalized : `/${normalized}`}`;
};

const resolveDisplayName = (user, detail) =>
  normalizeText(detail?.nickname)
  || normalizeText(user?.username1)
  || normalizeText(user?.discordid)
  || 'Survivor';

const toPublicAuthor = ({ userId, fallbackAuthorName, profilesByUserId }) => {
  const userIdKey = toIdKey(userId);
  const profile = userIdKey ? profilesByUserId.get(userIdKey) : null;

  return {
    userId: userIdKey,
    username: profile?.username || null,
    displayName: profile?.displayName || normalizeText(fallbackAuthorName) || 'Survivor',
    avatarUrl: profile?.avatarUrl || null,
    accesslevel: profile?.accesslevel || null,
    status: profile?.status || null,
  };
};

const buildPublicUserProfilesMap = async (userIds, req) => {
  const uniqueUserIdKeys = [...new Set(userIds.map((value) => toIdKey(value)).filter(Boolean))];
  const profilesByUserId = new Map();
  if (!uniqueUserIdKeys.length) {
    return profilesByUserId;
  }

  const [users, userDetails] = await Promise.all([
    ZMUser.findAll({
      where: {
        id: {
          [Op.in]: uniqueUserIdKeys,
        },
      },
    }),
    UserDetail.findAll({
      where: {
        userId: {
          [Op.in]: uniqueUserIdKeys,
        },
      },
    }),
  ]);

  const usersById = new Map();
  users.forEach((user) => {
    const key = toIdKey(user?.id ?? user?.userid);
    if (!key) return;
    usersById.set(key, user);
  });

  const detailsByUserId = new Map();
  userDetails.forEach((detail) => {
    const key = toIdKey(detail?.userId);
    if (!key) return;
    detailsByUserId.set(key, detail);
  });

  uniqueUserIdKeys.forEach((userIdKey) => {
    const user = usersById.get(userIdKey) || null;
    const detail = detailsByUserId.get(userIdKey) || null;

    profilesByUserId.set(userIdKey, {
      userId: userIdKey,
      username: normalizeText(user?.username1) || null,
      displayName: resolveDisplayName(user, detail),
      avatarUrl: buildAvatarUrl(detail?.avatarPath, req),
      accesslevel: normalizeText(user?.accesslevel) || null,
      status: normalizeText(detail?.status) || null,
    });
  });

  return profilesByUserId;
};

const toPublicComment = (comment, profilesByUserId) => {
  const commentData = typeof comment?.toJSON === 'function' ? comment.toJSON() : { ...comment };

  return {
    id: commentData?.id ?? null,
    postId: commentData?.postId ?? null,
    content: commentData?.content || '',
    createdAt: commentData?.createdAt || null,
    updatedAt: commentData?.updatedAt || null,
    author: toPublicAuthor({
      userId: commentData?.userId,
      fallbackAuthorName: commentData?.authorName,
      profilesByUserId,
    }),
  };
};

const toPublicPost = ({
  post,
  profilesByUserId,
  likeCountByPostId,
  commentCountByPostId,
  viewerLikedPostIds,
  commentsPreviewByPostId,
}) => {
  const postData = typeof post?.toJSON === 'function' ? post.toJSON() : { ...post };
  const postIdKey = toIdKey(postData?.id) || '';
  const previewComments = commentsPreviewByPostId.get(postIdKey) || [];

  return {
    id: postData?.id ?? null,
    content: postData?.content || '',
    imageUrl: postData?.imageUrl || null,
    createdAt: postData?.createdAt || null,
    updatedAt: postData?.updatedAt || null,
    author: toPublicAuthor({
      userId: postData?.userId,
      fallbackAuthorName: postData?.authorName,
      profilesByUserId,
    }),
    likeCount: likeCountByPostId.get(postIdKey) || 0,
    commentCount: commentCountByPostId.get(postIdKey) || 0,
    viewerLiked: viewerLikedPostIds.has(postIdKey),
    commentsPreview: previewComments.map((comment) => toPublicComment(comment, profilesByUserId)),
  };
};

const normalizeContent = (value, maxLength) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  return normalized.slice(0, Math.max(1, maxLength));
};

const normalizeImageUrl = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (normalized.length > MAX_IMAGE_URL_LENGTH) return null;

  try {
    const parsed = new URL(normalized);
    const protocol = String(parsed.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const getLikeCountsByPostId = async (postIds) => {
  const rows = await DashboardFeedLike.findAll({
    attributes: ['postId', [fn('COUNT', col('id')), 'count']],
    where: {
      postId: {
        [Op.in]: postIds,
      },
    },
    group: ['postId'],
    raw: true,
  });

  const map = new Map();
  rows.forEach((row) => {
    const postIdKey = toIdKey(row?.postId);
    if (!postIdKey) return;
    map.set(postIdKey, Number(row?.count) || 0);
  });

  return map;
};

const getCommentCountsByPostId = async (postIds) => {
  const rows = await DashboardFeedComment.findAll({
    attributes: ['postId', [fn('COUNT', col('id')), 'count']],
    where: {
      postId: {
        [Op.in]: postIds,
      },
    },
    group: ['postId'],
    raw: true,
  });

  const map = new Map();
  rows.forEach((row) => {
    const postIdKey = toIdKey(row?.postId);
    if (!postIdKey) return;
    map.set(postIdKey, Number(row?.count) || 0);
  });

  return map;
};

const getViewerLikedPostIds = async (postIds, viewerUserId) => {
  const viewerUserIdKey = toIdKey(viewerUserId);
  if (!viewerUserIdKey) return new Set();

  const rows = await DashboardFeedLike.findAll({
    attributes: ['postId'],
    where: {
      postId: {
        [Op.in]: postIds,
      },
      userId: viewerUserIdKey,
    },
    raw: true,
  });

  const set = new Set();
  rows.forEach((row) => {
    const postIdKey = toIdKey(row?.postId);
    if (!postIdKey) return;
    set.add(postIdKey);
  });
  return set;
};

const getPreviewCommentsByPostId = async (postIds) => {
  const previewLoadLimit = Math.max(20, postIds.length * 8);
  const rows = await DashboardFeedComment.findAll({
    where: {
      postId: {
        [Op.in]: postIds,
      },
    },
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit: previewLoadLimit,
  });

  const map = new Map();
  rows.forEach((row) => {
    const postIdKey = toIdKey(row?.postId);
    if (!postIdKey) return;

    if (!map.has(postIdKey)) {
      map.set(postIdKey, []);
    }

    const bucket = map.get(postIdKey);
    if (bucket.length < 2) {
      bucket.push(row);
    }
  });

  map.forEach((bucket, key) => {
    map.set(key, [...bucket].reverse());
  });

  return map;
};

const attachAuthUserRecord = async (req, res, next) => {
  try {
    const userId = toPositiveInt(req.authUser?.id);
    if (!userId) {
      return res.status(401).json({ error: 'Invalid auth user id.' });
    }

    const [user, detail] = await Promise.all([
      ZMUser.findByPk(userId),
      UserDetail.findOne({ where: { userId } }),
    ]);

    if (!user) {
      return res.status(404).json({ error: 'Authenticated user does not exist.' });
    }

    req.authZmUser = user;
    req.authUserDetail = detail;
    return next();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const buildViewerPayload = async (viewerUser, req) => {
  if (!viewerUser) return null;

  const viewerUserIdKey = toIdKey(viewerUser?.id ?? viewerUser?.userid);
  if (!viewerUserIdKey) return null;

  const profilesByUserId = await buildPublicUserProfilesMap([viewerUserIdKey], req);
  const profile = profilesByUserId.get(viewerUserIdKey);
  if (!profile) return null;

  return {
    userId: profile.userId,
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    accesslevel: profile.accesslevel,
    status: profile.status,
  };
};

router.get('/feed', async (req, res) => {
  try {
    const limit = parseFeedLimit(req.query.limit);
    const viewerUser = await resolveOptionalAuthUser(req);
    const viewerUserId = viewerUser?.id ?? viewerUser?.userid ?? null;

    const posts = await DashboardFeedPost.findAll({
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit,
    });

    const postIds = posts
      .map((post) => post?.id)
      .map((postId) => toIdKey(postId))
      .filter(Boolean);

    const [
      statsPayload,
      likeCountByPostId,
      commentCountByPostId,
      viewerLikedPostIds,
      commentsPreviewByPostId,
      viewer,
    ] = await Promise.all([
      (async () => {
        const [totalPosts, totalLikes, totalComments, postsToday] = await Promise.all([
          DashboardFeedPost.count(),
          DashboardFeedLike.count(),
          DashboardFeedComment.count(),
          DashboardFeedPost.count({
            where: {
              createdAt: {
                [Op.gte]: new Date(Date.now() - DAY_MS),
              },
            },
          }),
        ]);

        return {
          totalPosts: Number(totalPosts) || 0,
          totalLikes: Number(totalLikes) || 0,
          totalComments: Number(totalComments) || 0,
          postsToday: Number(postsToday) || 0,
        };
      })(),
      postIds.length ? getLikeCountsByPostId(postIds) : Promise.resolve(new Map()),
      postIds.length ? getCommentCountsByPostId(postIds) : Promise.resolve(new Map()),
      postIds.length ? getViewerLikedPostIds(postIds, viewerUserId) : Promise.resolve(new Set()),
      postIds.length ? getPreviewCommentsByPostId(postIds) : Promise.resolve(new Map()),
      buildViewerPayload(viewerUser, req),
    ]);

    const postAuthorIds = posts.map((post) => post?.userId);
    const commentAuthorIds = [];
    commentsPreviewByPostId.forEach((list) => {
      list.forEach((comment) => commentAuthorIds.push(comment?.userId));
    });

    const profilesByUserId = await buildPublicUserProfilesMap(
      [...postAuthorIds, ...commentAuthorIds],
      req,
    );

    const publicPosts = posts.map((post) => toPublicPost({
      post,
      profilesByUserId,
      likeCountByPostId,
      commentCountByPostId,
      viewerLikedPostIds,
      commentsPreviewByPostId,
    }));

    return res.json({
      checkedAt: new Date().toISOString(),
      viewer,
      stats: statsPayload,
      posts: publicPosts,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/feed', requireAuthBearer, attachAuthUserRecord, async (req, res) => {
  try {
    const userId = toPositiveInt(req.authZmUser?.id ?? req.authZmUser?.userid);
    if (!userId) {
      return res.status(401).json({ error: 'Invalid auth user id.' });
    }

    const content = normalizeContent(req.body?.content, MAX_POST_LENGTH);
    if (!content) {
      return res.status(400).json({ error: 'Post content is required.' });
    }

    const rawImageUrl = req.body?.imageUrl;
    const normalizedImageUrlInput = normalizeText(rawImageUrl);
    const imageUrl = normalizedImageUrlInput ? normalizeImageUrl(normalizedImageUrlInput) : null;
    if (normalizedImageUrlInput && !imageUrl) {
      return res.status(400).json({ error: 'imageUrl must be a valid http/https URL.' });
    }

    const authorName = resolveDisplayName(req.authZmUser, req.authUserDetail);
    const post = await DashboardFeedPost.create({
      userId,
      authorName,
      content,
      imageUrl,
    });

    const profilesByUserId = await buildPublicUserProfilesMap([userId], req);
    const postPayload = toPublicPost({
      post,
      profilesByUserId,
      likeCountByPostId: new Map(),
      commentCountByPostId: new Map(),
      viewerLikedPostIds: new Set(),
      commentsPreviewByPostId: new Map(),
    });

    return res.status(201).json({ post: postPayload });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/feed/:id/like', requireAuthBearer, attachAuthUserRecord, async (req, res) => {
  try {
    const postId = toPositiveInt(req.params.id);
    if (!postId) {
      return res.status(400).json({ error: 'Invalid post id.' });
    }

    const userId = toPositiveInt(req.authZmUser?.id ?? req.authZmUser?.userid);
    if (!userId) {
      return res.status(401).json({ error: 'Invalid auth user id.' });
    }

    const post = await DashboardFeedPost.findByPk(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    const existingLike = await DashboardFeedLike.findOne({
      where: {
        postId,
        userId,
      },
    });

    let liked = false;
    if (existingLike) {
      await existingLike.destroy();
      liked = false;
    } else {
      await DashboardFeedLike.create({
        postId,
        userId,
      });
      liked = true;
    }

    const likeCount = await DashboardFeedLike.count({ where: { postId } });

    return res.json({
      postId,
      liked,
      likeCount: Number(likeCount) || 0,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/feed/:id/comments', async (req, res) => {
  try {
    const postId = toPositiveInt(req.params.id);
    if (!postId) {
      return res.status(400).json({ error: 'Invalid post id.' });
    }

    const limit = parseCommentLimit(req.query.limit);
    const post = await DashboardFeedPost.findByPk(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    const totalComments = await DashboardFeedComment.count({
      where: { postId },
    });

    const rowsDescending = await DashboardFeedComment.findAll({
      where: { postId },
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit,
    });
    const comments = [...rowsDescending].reverse();

    const profilesByUserId = await buildPublicUserProfilesMap(
      comments.map((comment) => comment?.userId),
      req,
    );

    return res.json({
      postId,
      totalComments: Number(totalComments) || 0,
      hasMore: Number(totalComments) > comments.length,
      comments: comments.map((comment) => toPublicComment(comment, profilesByUserId)),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/feed/:id/comments', requireAuthBearer, attachAuthUserRecord, async (req, res) => {
  try {
    const postId = toPositiveInt(req.params.id);
    if (!postId) {
      return res.status(400).json({ error: 'Invalid post id.' });
    }

    const post = await DashboardFeedPost.findByPk(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    const userId = toPositiveInt(req.authZmUser?.id ?? req.authZmUser?.userid);
    if (!userId) {
      return res.status(401).json({ error: 'Invalid auth user id.' });
    }

    const content = normalizeContent(req.body?.content, MAX_COMMENT_LENGTH);
    if (!content) {
      return res.status(400).json({ error: 'Comment content is required.' });
    }

    const authorName = resolveDisplayName(req.authZmUser, req.authUserDetail);
    const comment = await DashboardFeedComment.create({
      postId,
      userId,
      authorName,
      content,
    });

    const [profilesByUserId, commentCount] = await Promise.all([
      buildPublicUserProfilesMap([userId], req),
      DashboardFeedComment.count({
        where: { postId },
      }),
    ]);

    return res.status(201).json({
      comment: toPublicComment(comment, profilesByUserId),
      commentCount: Number(commentCount) || 0,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
