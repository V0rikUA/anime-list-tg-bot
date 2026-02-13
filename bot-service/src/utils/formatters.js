function formatScore(score) {
  return score === null || score === undefined ? 'N/A' : String(score);
}

function formatEpisodes(episodes) {
  return episodes === null || episodes === undefined ? '?' : String(episodes);
}

export function formatSearchResults(items, labels = {}) {
  if (!items.length) {
    return labels.empty || 'Nothing found. Try another title.';
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
    const emptyWord = options.emptyWord || 'empty';
    return `${title}: ${emptyWord}`;
  }

  const showWatchCounters = Boolean(options.showWatchCounters);

  return [
    `${title} (${items.length}):`,
    ...items.map((item, idx) => {
      const base = `${idx + 1}. ${item.title} [${item.uid}]`;
      let line = base;

      if (showWatchCounters) {
        line = `${base} | You: ${item.userWatchCount ?? item.watchCount ?? 0}, Friends: ${item.friendsWatchCount ?? 0}`;
      }

      if (item.lastEpisode != null) {
        line = `${line} · EP ${item.lastEpisode}`;
      }

      return line;
    })
  ].join('\n');
}

export function formatRecommendationsFromFriends(items, labels = {}) {
  if (!items.length) {
    return labels.empty || 'Recommendations from friends: empty';
  }

  return [
    (labels.title || 'Recommendations from friends') + ` (${items.length}):`,
    ...items.map((item, idx) => {
      const unknown = labels.unknown || 'unknown';
      const names = item.recommenders?.length ? item.recommenders.join(', ') : unknown;
      const by = labels.by || 'by';
      const count = labels.count || 'count';
      return `${idx + 1}. ${item.title} [${item.uid}] | ${by}: ${names} | ${count}: ${item.recommendCount}`;
    })
  ].join('\n');
}

export function formatFriends(items, labels = {}) {
  if (!items.length) {
    return labels.empty || 'Friends: empty';
  }

  return [
    (labels.title || 'Friends') + ` (${items.length}):`,
    ...items.map((friend, idx) => `${idx + 1}. ${friend.label} (tg: ${friend.telegramId})`)
  ].join('\n');
}
