import telegrafPkg from 'telegraf';
import { t } from '../i18n.js';
import { buildMiniAppUrl, isHttpsUrl } from '../utils/urls.js';

const { Markup } = telegrafPkg;

export const LANGS = ['en', 'ru', 'uk'];
export const LANG_LABELS = {
  en: 'English',
  ru: 'Русский',
  uk: 'Українська'
};

export function mainMenuKeyboard(ctx, lang) {
  const webAppUrl = buildMiniAppUrl(ctx.from.id);
  const canUseWebAppButton = isHttpsUrl(webAppUrl);

  const rows = [
    [
      Markup.button.callback(t(lang, 'menu_search'), 'menu:search'),
      Markup.button.callback(t(lang, 'menu_watched'), 'menu:watched'),
      Markup.button.callback(t(lang, 'menu_planned'), 'menu:planned')
    ],
    [
      Markup.button.callback(t(lang, 'menu_favorites'), 'menu:favorites'),
      Markup.button.callback(t(lang, 'menu_feed'), 'menu:feed'),
      Markup.button.callback(t(lang, 'menu_continue'), 'menu:continue'),
    ],
    [
      Markup.button.callback(t(lang, 'menu_friends'), 'menu:friends')
    ],
    [
      Markup.button.callback(t(lang, 'menu_invite'), 'menu:invite'),
      canUseWebAppButton
        ? Markup.button.webApp(t(lang, 'menu_app'), webAppUrl)
        : Markup.button.callback(t(lang, 'menu_app'), 'menu:app')
    ],
    [
      Markup.button.callback(t(lang, 'menu_language'), 'menu:lang'),
      Markup.button.callback(t(lang, 'menu_help'), 'menu:help')
    ]
  ];

  return Markup.inlineKeyboard(rows);
}

export function navRow(lang, { back = true, home = true } = {}) {
  const row = [];
  if (back) row.push(Markup.button.callback(t(lang, 'menu_back'), 'nav:back'));
  if (home) row.push(Markup.button.callback(t(lang, 'menu_main'), 'nav:home'));
  return row;
}

export function watchRebindRow(lang) {
  return [Markup.button.callback(t(lang, 'watch_rebind'), 'watch:rebind')];
}

export function cancelKeyboard(lang) {
  // "Cancel" in the single-screen UX means: go to the main menu.
  return Markup.inlineKeyboard([navRow(lang, { back: false, home: true })]);
}

export function pickKeyboard(lang, count) {
  const buttons = [];
  for (let i = 0; i < count; i += 1) {
    buttons.push(Markup.button.callback(String(i + 1), `pick:${i}`));
  }

  const rows = [];
  rows.push(buttons.slice(0, 5));
  if (buttons.length > 5) rows.push(buttons.slice(5, 10));

  rows.push([
    Markup.button.callback(t(lang, 'menu_new_search'), 'menu:search')
  ]);

  rows.push(navRow(lang));
  return Markup.inlineKeyboard(rows);
}

export function actionKeyboard(lang, uid) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(t(lang, 'act_watch'), `act:watch:${uid}`),
      Markup.button.callback(t(lang, 'act_plan'), `act:plan:${uid}`)
    ],
    [
      Markup.button.callback(t(lang, 'act_favorite'), `act:favorite:${uid}`),
      Markup.button.callback(t(lang, 'act_recommend'), `act:recommend:${uid}`)
    ],
    [Markup.button.callback(t(lang, 'act_watch_links'), `watch:start:${uid}`)],
    navRow(lang)
  ]);
}
