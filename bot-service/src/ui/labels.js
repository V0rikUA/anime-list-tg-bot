export function uiLabels(lang) {
  if (lang === 'ru') {
    return {
      emptyWord: 'пусто',
      watchedTitle: 'Просмотрено',
      plannedTitle: 'План',
      favoritesTitle: 'Избранное',
      ownRecommendationsTitle: 'Твои рекомендации',
      friends: {
        title: 'Друзья',
        empty: 'Друзья: пусто'
      },
      recsFromFriends: {
        title: 'Рекомендации от друзей',
        empty: 'Рекомендации от друзей: пусто',
        by: 'от',
        count: 'кол-во',
        unknown: 'неизвестно'
      },
      search: {
        empty: 'Ничего не найдено. Попробуй другое название.'
      }
    };
  }

  if (lang === 'uk') {
    return {
      emptyWord: 'порожньо',
      watchedTitle: 'Переглянуте',
      plannedTitle: 'План',
      favoritesTitle: 'Обране',
      ownRecommendationsTitle: 'Твої рекомендації',
      friends: {
        title: 'Друзі',
        empty: 'Друзі: порожньо'
      },
      recsFromFriends: {
        title: 'Рекомендації від друзів',
        empty: 'Рекомендації від друзів: порожньо',
        by: 'від',
        count: 'к-сть',
        unknown: 'невідомо'
      },
      search: {
        empty: 'Нічого не знайдено. Спробуй іншу назву.'
      }
    };
  }

  return {
    emptyWord: 'empty',
    watchedTitle: 'Watched',
    plannedTitle: 'Planned',
    favoritesTitle: 'Favorites',
    ownRecommendationsTitle: 'Your recommendations',
    friends: {
      title: 'Friends',
      empty: 'Friends: empty'
    },
    recsFromFriends: {
      title: 'Recommendations from friends',
      empty: 'Recommendations from friends: empty',
      by: 'by',
      count: 'count',
      unknown: 'unknown'
    },
    search: {
      empty: 'Nothing found. Try another title.'
    }
  };
}
