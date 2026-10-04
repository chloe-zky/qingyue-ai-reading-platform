import { apiFetch } from './apiClient';

let cachedVocabulary = null;
let inFlight = null;

export const FALLBACK_VOCABULARY = {
  setting_tags: ['现代', '古风', '民国'],
  story_tone_tags: ['清甜校园', '遗憾青春', '温暖治愈', '浓情曲折'],
  relationship_core_tags: ['暗恋未明', '久别重逢', '相伴成长', '命运拉扯'],
  aesthetic_tags: [],
  risk_tags: [],
};

const EDITOR_CATEGORY_META = [
  ['setting', 'setting_tags', '时代设定', 'setting'],
  ['story_tone', 'story_tone_tags', '故事基调', 'story_tone'],
  ['relationship', 'relationship_core_tags', '关系内核', 'relationship'],
  ['aesthetic', 'aesthetic_tags', '美学标签', 'aesthetic'],
  ['risk', 'risk_tags', '风险提示', 'risk'],
];

export function editorTagGroups(vocabulary = FALLBACK_VOCABULARY) {
  return EDITOR_CATEGORY_META.map(([key, field, label, en]) => ({
    key,
    label,
    en,
    options: Array.isArray(vocabulary[field]) && vocabulary[field].length
      ? vocabulary[field]
      : FALLBACK_VOCABULARY[field],
  }));
}

export async function getPublishedVocabulary() {
  if (cachedVocabulary) return cachedVocabulary;
  if (!inFlight) {
    inFlight = apiFetch('/api/tags/vocabulary', { auth: false })
      .then((payload) => {
        cachedVocabulary = payload;
        return payload;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}
