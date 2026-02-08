function formatScore(score) {
  return score === null || score === undefined ? 'N/A' : String(score);
}

function formatEpisodes(episodes) {
  return episodes === null || episodes === undefined ? '?' : String(episodes);
}

export function formatSearchResults(items) {
  if (!items.length) {
    return 'Nothing found. Try another title.';
  }

  return items
    .map((item, idx) => [
      `${idx + 1}. ${item.title}`,
      `ID: ${item.uid}`,
      `Source: ${item.source}`,
      `Score: ${formatScore(item.score)}`,
      `Episodes: ${formatEpisodes(item.episodes)}`,
      `Status: ${item.status || 'N/A'}`,
      `Link: ${item.url || 'N/A'}`
    ].join('\n'))
    .join('\n\n');
}

export function formatTrackedList(title, items, options = {}) {
  if (!items.length) {
    return `${title}: empty`;
  }

  const showWatchCounters = Boolean(options.showWatchCounters);

  return [
    `${title} (${items.length}):`,
    ...items.map((item, idx) => {
      const base = `${idx + 1}. ${item.title} [${item.uid}]`;
      if (!showWatchCounters) {
        return base;
      }

      return `${base} | You: ${item.userWatchCount ?? item.watchCount ?? 0}, Friends: ${item.friendsWatchCount ?? 0}`;
    })
  ].join('\n');
}

export function formatRecommendationsFromFriends(items) {
  if (!items.length) {
    return 'Recommendations from friends: empty';
  }

  return [
    `Recommendations from friends (${items.length}):`,
    ...items.map((item, idx) => {
      const names = item.recommenders?.length ? item.recommenders.join(', ') : 'unknown';
      return `${idx + 1}. ${item.title} [${item.uid}] | by: ${names} | count: ${item.recommendCount}`;
    })
  ].join('\n');
}

export function formatFriends(items) {
  if (!items.length) {
    return 'Friends: empty';
  }

  return [
    `Friends (${items.length}):`,
    ...items.map((friend, idx) => `${idx + 1}. ${friend.label} (tg: ${friend.telegramId})`)
  ].join('\n');
}
