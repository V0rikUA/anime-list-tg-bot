function normalizeLang(raw) {
  const value = String(raw || '').toLowerCase();
  if (value.startsWith('ru')) return 'ru';
  if (value.startsWith('uk')) return 'uk';
  return 'en';
}

export function guessLangFromTelegram(telegramUser) {
  return normalizeLang(telegramUser?.language_code);
}

const DICT = {
  en: {
    help_title: 'Commands:',
    start_intro: 'Anime Tracker Bot: search anime, track watched/planned/favorites, compare stats with friends, get recommendations, and open the Mini App dashboard.',
    start_ready: 'Anime tracker bot is ready.\nUse /help to see commands.',
    bot_disabled: 'Telegram bot token is empty, bot disabled',

    usage_search: 'Usage: /search <title>',
    searching: 'Searching for: {query}',
    search_failed: 'Search failed: {error}',
    unknown_id: 'Unknown ID. First run /search and use an ID from search results.',

    saved_watched: 'Saved as watched: {title}\nYour views: {you}\nFriends views: {friends}',
    added_planned: 'Added to planned: {title}',
    added_favorite: 'Added to favorites: {title}',
    recommended_saved: 'Recommended for friends: {title}',

    usage_unwatch: 'Usage: /unwatch <uid>',
    removed_watched: 'Removed from watched: {uid}',
    not_in_watched: 'ID not found in watched list.',

    usage_unplan: 'Usage: /unplan <uid>',
    removed_planned: 'Removed from planned: {uid}',
    not_in_planned: 'ID not found in planned list.',

    usage_unfavorite: 'Usage: /unfavorite <uid>',
    removed_favorite: 'Removed from favorites: {uid}',
    not_in_favorites: 'ID not found in favorites list.',

    usage_unrecommend: 'Usage: /unrecommend <uid>',
    removed_recommendation: 'Removed recommendation: {uid}',
    not_in_recommendations: 'ID not found in your recommendations.',

    invite_token: 'Invite token: {token}',
    invite_howto: 'Send token via /join <token>.',
    invite_link: 'Invite link: {link}',

    usage_join: 'Usage: /join <token>',
    friend_added: 'Friend added: {label}',
    cannot_add_self: 'You cannot add yourself as a friend.',
    invalid_invite: 'Invite token is invalid.',

    usage_stats: 'Usage: /stats <uid>',
    stats_line: '{label}\nYour views: {you}\nFriends views: {friends}',

    dashboard_api: 'Dashboard API: {url}',
    open_miniapp: 'Open your dashboard in Telegram Mini App:',
    btn_open_miniapp: 'Open Mini App',

    generic_help_hint: 'Use /help to see available commands.',
    unexpected_error: 'Unexpected error. Try again later.',

    lang_prompt: 'Choose language:',
    lang_updated: 'Language updated: {lang}'
    ,
    menu_title: 'Menu:',
    menu_search: 'Search',
    menu_watched: 'Watched',
    menu_planned: 'Planned',
    menu_favorites: 'Favorites',
    menu_feed: 'Feed',
    menu_friends: 'Friends',
    menu_invite: 'Invite',
    menu_app: 'Mini App',
    menu_language: 'Language',
    menu_help: 'Help',
    menu_cancel: 'Cancel',
    menu_back: 'Back',
    menu_new_search: 'New search',

    prompt_search: 'Send anime title to search.',
    pick_result: 'Pick a result:',
    pick_action: 'Choose an action:',

    act_watch: 'Watch',
    act_plan: 'Plan',
    act_favorite: 'Favorite',
    act_recommend: 'Recommend'
  },
  ru: {
    help_title: 'Команды:',
    start_intro: 'Бот-аниме трекер: поиск аниме, списки (просмотрено/план/избранное), статистика с друзьями, рекомендации и Mini App дашборд.',
    start_ready: 'Бот-аниме трекер готов.\nНапиши /help чтобы увидеть команды.',
    bot_disabled: 'TELEGRAM_BOT_TOKEN пустой, бот отключен',

    usage_search: 'Использование: /search <название>',
    searching: 'Ищу: {query}',
    search_failed: 'Поиск не удался: {error}',
    unknown_id: 'Неизвестный ID. Сначала сделай /search и используй ID из результатов.',

    saved_watched: 'Сохранено как просмотренное: {title}\nТвои просмотры: {you}\nПросмотры друзей: {friends}',
    added_planned: 'Добавлено в план: {title}',
    added_favorite: 'Добавлено в избранное: {title}',
    recommended_saved: 'Рекомендовано друзьям: {title}',

    usage_unwatch: 'Использование: /unwatch <uid>',
    removed_watched: 'Удалено из просмотренного: {uid}',
    not_in_watched: 'ID не найден в списке просмотренного.',

    usage_unplan: 'Использование: /unplan <uid>',
    removed_planned: 'Удалено из плана: {uid}',
    not_in_planned: 'ID не найден в списке плана.',

    usage_unfavorite: 'Использование: /unfavorite <uid>',
    removed_favorite: 'Удалено из избранного: {uid}',
    not_in_favorites: 'ID не найден в избранном.',

    usage_unrecommend: 'Использование: /unrecommend <uid>',
    removed_recommendation: 'Удалена рекомендация: {uid}',
    not_in_recommendations: 'ID не найден в твоих рекомендациях.',

    invite_token: 'Инвайт-токен: {token}',
    invite_howto: 'Отправь токен командой /join <token>.',
    invite_link: 'Инвайт-ссылка: {link}',

    usage_join: 'Использование: /join <token>',
    friend_added: 'Друг добавлен: {label}',
    cannot_add_self: 'Нельзя добавить себя в друзья.',
    invalid_invite: 'Неверный инвайт-токен.',

    usage_stats: 'Использование: /stats <uid>',
    stats_line: '{label}\nТвои просмотры: {you}\nПросмотры друзей: {friends}',

    dashboard_api: 'Dashboard API: {url}',
    open_miniapp: 'Открой дашборд в Telegram Mini App:',
    btn_open_miniapp: 'Открыть Mini App',

    generic_help_hint: 'Напиши /help чтобы увидеть команды.',
    unexpected_error: 'Неожиданная ошибка. Попробуй позже.',

    lang_prompt: 'Выбери язык:',
    lang_updated: 'Язык обновлен: {lang}'
    ,
    menu_title: 'Меню:',
    menu_search: 'Поиск',
    menu_watched: 'Просмотрено',
    menu_planned: 'План',
    menu_favorites: 'Избранное',
    menu_feed: 'Лента',
    menu_friends: 'Друзья',
    menu_invite: 'Инвайт',
    menu_app: 'Mini App',
    menu_language: 'Язык',
    menu_help: 'Помощь',
    menu_cancel: 'Отмена',
    menu_back: 'Назад',
    menu_new_search: 'Новый поиск',

    prompt_search: 'Напиши название аниме для поиска.',
    pick_result: 'Выбери результат:',
    pick_action: 'Выбери действие:',

    act_watch: 'Смотреть',
    act_plan: 'В план',
    act_favorite: 'В избранное',
    act_recommend: 'Рекомендовать'
  },
  uk: {
    help_title: 'Команди:',
    start_intro: 'Бот-аніме трекер: пошук аніме, списки (переглянуте/план/обране), статистика з друзями, рекомендації та Mini App дашборд.',
    start_ready: 'Бот-аніме трекер готовий.\nНапиши /help щоб побачити команди.',
    bot_disabled: 'TELEGRAM_BOT_TOKEN порожній, бот вимкнено',

    usage_search: 'Використання: /search <назва>',
    searching: 'Шукаю: {query}',
    search_failed: 'Пошук не вдався: {error}',
    unknown_id: 'Невідомий ID. Спочатку зроби /search і використай ID з результатів.',

    saved_watched: 'Збережено як переглянуте: {title}\nТвої перегляди: {you}\nПерегляди друзів: {friends}',
    added_planned: 'Додано в план: {title}',
    added_favorite: 'Додано в обране: {title}',
    recommended_saved: 'Рекомендовано друзям: {title}',

    usage_unwatch: 'Використання: /unwatch <uid>',
    removed_watched: 'Видалено з переглянутого: {uid}',
    not_in_watched: 'ID не знайдено у переглянутому.',

    usage_unplan: 'Використання: /unplan <uid>',
    removed_planned: 'Видалено з плану: {uid}',
    not_in_planned: 'ID не знайдено у плані.',

    usage_unfavorite: 'Використання: /unfavorite <uid>',
    removed_favorite: 'Видалено з обраного: {uid}',
    not_in_favorites: 'ID не знайдено в обраному.',

    usage_unrecommend: 'Використання: /unrecommend <uid>',
    removed_recommendation: 'Видалено рекомендацію: {uid}',
    not_in_recommendations: 'ID не знайдено у твоїх рекомендаціях.',

    invite_token: 'Інвайт-токен: {token}',
    invite_howto: 'Надішли токен командою /join <token>.',
    invite_link: 'Інвайт-посилання: {link}',

    usage_join: 'Використання: /join <token>',
    friend_added: 'Друга додано: {label}',
    cannot_add_self: 'Не можна додати себе в друзі.',
    invalid_invite: 'Невірний інвайт-токен.',

    usage_stats: 'Використання: /stats <uid>',
    stats_line: '{label}\nТвої перегляди: {you}\nПерегляди друзів: {friends}',

    dashboard_api: 'Dashboard API: {url}',
    open_miniapp: 'Відкрий дашборд у Telegram Mini App:',
    btn_open_miniapp: 'Відкрити Mini App',

    generic_help_hint: 'Напиши /help щоб побачити команди.',
    unexpected_error: 'Неочікувана помилка. Спробуй пізніше.',

    lang_prompt: 'Обери мову:',
    lang_updated: 'Мову оновлено: {lang}'
    ,
    menu_title: 'Меню:',
    menu_search: 'Пошук',
    menu_watched: 'Переглянуте',
    menu_planned: 'План',
    menu_favorites: 'Обране',
    menu_feed: 'Стрічка',
    menu_friends: 'Друзі',
    menu_invite: 'Інвайт',
    menu_app: 'Mini App',
    menu_language: 'Мова',
    menu_help: 'Довідка',
    menu_cancel: 'Скасувати',
    menu_back: 'Назад',
    menu_new_search: 'Новий пошук',

    prompt_search: 'Надішли назву аніме для пошуку.',
    pick_result: 'Обери результат:',
    pick_action: 'Обери дію:',

    act_watch: 'Переглянув',
    act_plan: 'В план',
    act_favorite: 'В обране',
    act_recommend: 'Рекомендувати'
  }
};

export function t(langRaw, key, params) {
  const lang = normalizeLang(langRaw);
  const table = DICT[lang] || DICT.en;
  const template = table[key] || DICT.en[key] || key;
  if (!params) return template;

  return template.replace(/\{(\w+)\}/g, (_, name) => {
    const value = params[name];
    return value === undefined || value === null ? '' : String(value);
  });
}

export function helpText(langRaw) {
  const lang = normalizeLang(langRaw);
  const lines = [];
  lines.push(t(lang, 'help_title'));

  if (lang === 'ru') {
    lines.push(
      '/search <название> - поиск аниме (Jikan + AniList)',
      '/watch <uid> - добавить в просмотренное (+1 к счетчику)',
      '/watched - показать просмотренное (твои/друзей счетчики)',
      '/unwatch <uid> - удалить из просмотренного',
      '/plan <uid> - добавить в план',
      '/planned - показать план',
      '/unplan <uid> - удалить из плана',
      '/favorite <uid> - добавить в избранное',
      '/favorites - показать избранное',
      '/unfavorite <uid> - удалить из избранного',
      '/recommend <uid> - рекомендовать друзьям',
      '/recommendations - твои рекомендации',
      '/feed - рекомендации от друзей',
      '/invite - создать инвайт токен/ссылку',
      '/join <token> - добавить друга по токену',
      '/friends - список друзей',
      '/stats <uid> - счетчик просмотров (ты/друзья)',
      '/dashboard - URL dashboard API',
      '/app - открыть Telegram Mini App дашборд',
      '/lang - сменить язык',
      '/help - показать помощь'
    );
  } else if (lang === 'uk') {
    lines.push(
      '/search <назва> - пошук аніме (Jikan + AniList)',
      '/watch <uid> - додати в переглянуте (+1 до лічильника)',
      '/watched - показати переглянуте (твої/друзів лічильники)',
      '/unwatch <uid> - видалити з переглянутого',
      '/plan <uid> - додати в план',
      '/planned - показати план',
      '/unplan <uid> - видалити з плану',
      '/favorite <uid> - додати в обране',
      '/favorites - показати обране',
      '/unfavorite <uid> - видалити з обраного',
      '/recommend <uid> - рекомендувати друзям',
      '/recommendations - твої рекомендації',
      '/feed - рекомендації від друзів',
      '/invite - створити інвайт токен/посилання',
      '/join <token> - додати друга за токеном',
      '/friends - список друзів',
      '/stats <uid> - лічильник переглядів (ти/друзі)',
      '/dashboard - URL dashboard API',
      '/app - відкрити Telegram Mini App дашборд',
      '/lang - змінити мову',
      '/help - показати довідку'
    );
  } else {
    lines.push(
      '/search <title> - search anime (Jikan + AniList)',
      '/watch <uid> - add anime to watched (+1 view count)',
      '/watched - show watched list with your/friends counters',
      '/unwatch <uid> - remove anime from watched',
      '/plan <uid> - add anime to planned',
      '/planned - show planned list',
      '/unplan <uid> - remove anime from planned',
      '/favorite <uid> - add anime to favorites',
      '/favorites - show favorites list',
      '/unfavorite <uid> - remove from favorites',
      '/recommend <uid> - recommend anime to friends',
      '/recommendations - your own recommendations',
      '/feed - recommendations from friends',
      '/invite - generate friend invite token/link',
      '/join <token> - add friend by token',
      '/friends - show friend list',
      '/stats <uid> - views counter for you and friends',
      '/dashboard - your dashboard API URL',
      '/app - open Telegram Mini App dashboard',
      '/lang - change language',
      '/help - show this help'
    );
  }
  return lines.join('\n');
}
