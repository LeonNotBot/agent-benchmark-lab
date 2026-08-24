import { useCallback } from "react";
import { useAppStore } from "../store/useAppStore";
import { zh, en, type Locale, type Translations } from "./locales";

const localeMap: Record<Locale, Translations> = { zh, en };

/**
 * Simple i18n hook. Returns t(key, params?) for translation lookup.
 * Params: { key: value } replaces {key} in the translation string.
 */
export function useLocale() {
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const dict = localeMap[locale] ?? zh;

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      let text = dict[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(`{${k}}`, String(v));
        }
      }
      return text;
    },
    [dict],
  );

  return { t, locale, setLocale };
}

export type { Locale };
