'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('admin_clock_sessions', 'lastConfirmationAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addColumn('admin_clock_sessions', 'nextConfirmationDueAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addColumn('admin_clock_sessions', 'lastConfirmationSource', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('admin_clock_sessions', 'confirmationReminderSentAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addColumn('admin_clock_sessions', 'autoClockedOut', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    await queryInterface.addColumn('admin_clock_sessions', 'autoClockOutReason', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('admin_clock_sessions', 'autoClockOutBy', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addIndex('admin_clock_sessions', ['nextConfirmationDueAt'], {
      name: 'admin_clock_sessions_next_confirm_due_idx',
    });

    await queryInterface.sequelize.query(`
      UPDATE "admin_clock_sessions"
      SET
        "lastConfirmationAt" = COALESCE("clockInAt", NOW()),
        "nextConfirmationDueAt" = COALESCE("clockInAt", NOW()) + INTERVAL '1 hour',
        "lastConfirmationSource" = COALESCE("lastConfirmationSource", 'legacy'),
        "autoClockedOut" = COALESCE("autoClockedOut", false)
      WHERE "clockOutAt" IS NULL
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('admin_clock_sessions', 'admin_clock_sessions_next_confirm_due_idx');
    await queryInterface.removeColumn('admin_clock_sessions', 'autoClockOutBy');
    await queryInterface.removeColumn('admin_clock_sessions', 'autoClockOutReason');
    await queryInterface.removeColumn('admin_clock_sessions', 'autoClockedOut');
    await queryInterface.removeColumn('admin_clock_sessions', 'confirmationReminderSentAt');
    await queryInterface.removeColumn('admin_clock_sessions', 'lastConfirmationSource');
    await queryInterface.removeColumn('admin_clock_sessions', 'nextConfirmationDueAt');
    await queryInterface.removeColumn('admin_clock_sessions', 'lastConfirmationAt');
  },
};
