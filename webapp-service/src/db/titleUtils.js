export function normalizeTitleForIndex(titleRaw) {
  return String(titleRaw || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractRootTitle(titleRaw) {
  const normalized = normalizeTitleForIndex(titleRaw);
  if (!normalized) return '';

  const cutPatterns = [
    /\b(first|second|third|fourth|fifth|final)\s+(stage|season|part)\b/i,
    /\b\d+\s*(st|nd|rd|th)?\s*(season|stage|part)\b/i,
    /\b(ova|ona|movie|film|special|sp|extra|battle\s+stage|project\s+d)\b/i,
    /(^|\s)(перв(ый|ая|ое)|втор(ой|ая|ое)|трет(ий|ья|ье)|финал(ьн(ый|ая|ое))?)\s+(этап|сезон|часть)(\s|$)/iu,
    /(^|\s)\d+\s*(сезон|этап|часть)(\s|$)/iu,
    /(^|\s)(фильм|спецвыпуск|спешл|ова|она|экстра|боевая\s+стадия|проект\s+ди)(\s|$)/iu
  ];

  let cutAt = normalized.length;
  for (const pattern of cutPatterns) {
    const match = normalized.match(pattern);
    if (match && typeof match.index === 'number') {
      cutAt = Math.min(cutAt, match.index);
    }
  }

  const root = normalizeTitleForIndex(normalized.slice(0, cutAt));
  return root || normalized;
}

export function deriveTitleIndexPayload(anime) {
  const rawTitle = anime?.titleEn || anime?.title || anime?.titleRu || anime?.titleUk || '';
  const branchTitle = String(rawTitle || '').trim() || 'Unknown title';
  const branchTitleNormalized = normalizeTitleForIndex(branchTitle);
  const rootTitleNormalized = extractRootTitle(branchTitle) || branchTitleNormalized;
  const rootTitle = rootTitleNormalized || branchTitle;

  return {
    rootKey: rootTitleNormalized || branchTitleNormalized || `uid:${anime?.uid}`,
    rootTitle,
    rootTitleNormalized,
    branchTitle,
    branchTitleNormalized
  };
}
