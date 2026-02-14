export function applyDashboardMethods(proto) {
  proto.getDashboard = async function(telegramId) {
    const user = await this.getUserByTelegramId(telegramId);

    const [watched, planned, favorites, recommendedFromFriends, friends] = await Promise.all([
      this.getWatchedWithFriendStats(telegramId),
      this.getTrackedList(telegramId, 'planned'),
      this.getTrackedList(telegramId, 'favorite'),
      this.getRecommendationsFromFriends(telegramId),
      this.getFriends(telegramId)
    ]);

    return {
      user: user
        ? {
            telegramId: user.telegram_id,
            username: user.username,
            firstName: user.first_name,
            lastName: user.last_name,
            lang: user.lang || null
          }
        : null,
      watched,
      planned,
      favorites,
      recommendedFromFriends,
      friends
    };
  };
}
