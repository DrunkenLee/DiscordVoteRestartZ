'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('dashboard_feed_posts', {
      id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      userId: {
        type: Sequelize.BIGINT,
        allowNull: true,
        references: {
          model: 'zmusers',
          key: 'userid',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      authorName: {
        type: Sequelize.STRING(128),
        allowNull: false,
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      imageUrl: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('dashboard_feed_posts', ['createdAt'], {
      name: 'dashboard_feed_posts_created_at_idx',
    });
    await queryInterface.addIndex('dashboard_feed_posts', ['userId'], {
      name: 'dashboard_feed_posts_user_id_idx',
    });

    await queryInterface.createTable('dashboard_feed_likes', {
      id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      postId: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: {
          model: 'dashboard_feed_posts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      userId: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: {
          model: 'zmusers',
          key: 'userid',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('dashboard_feed_likes', ['postId'], {
      name: 'dashboard_feed_likes_post_id_idx',
    });
    await queryInterface.addIndex('dashboard_feed_likes', ['userId'], {
      name: 'dashboard_feed_likes_user_id_idx',
    });
    await queryInterface.addIndex('dashboard_feed_likes', ['postId', 'userId'], {
      name: 'dashboard_feed_likes_post_user_unique',
      unique: true,
    });

    await queryInterface.createTable('dashboard_feed_comments', {
      id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      postId: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: {
          model: 'dashboard_feed_posts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      userId: {
        type: Sequelize.BIGINT,
        allowNull: true,
        references: {
          model: 'zmusers',
          key: 'userid',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      authorName: {
        type: Sequelize.STRING(128),
        allowNull: false,
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('dashboard_feed_comments', ['postId'], {
      name: 'dashboard_feed_comments_post_id_idx',
    });
    await queryInterface.addIndex('dashboard_feed_comments', ['userId'], {
      name: 'dashboard_feed_comments_user_id_idx',
    });
    await queryInterface.addIndex('dashboard_feed_comments', ['createdAt'], {
      name: 'dashboard_feed_comments_created_at_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('dashboard_feed_comments', 'dashboard_feed_comments_created_at_idx');
    await queryInterface.removeIndex('dashboard_feed_comments', 'dashboard_feed_comments_user_id_idx');
    await queryInterface.removeIndex('dashboard_feed_comments', 'dashboard_feed_comments_post_id_idx');
    await queryInterface.dropTable('dashboard_feed_comments');

    await queryInterface.removeIndex('dashboard_feed_likes', 'dashboard_feed_likes_post_user_unique');
    await queryInterface.removeIndex('dashboard_feed_likes', 'dashboard_feed_likes_user_id_idx');
    await queryInterface.removeIndex('dashboard_feed_likes', 'dashboard_feed_likes_post_id_idx');
    await queryInterface.dropTable('dashboard_feed_likes');

    await queryInterface.removeIndex('dashboard_feed_posts', 'dashboard_feed_posts_user_id_idx');
    await queryInterface.removeIndex('dashboard_feed_posts', 'dashboard_feed_posts_created_at_idx');
    await queryInterface.dropTable('dashboard_feed_posts');
  },
};
