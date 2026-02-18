import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';
import { setI18nInstance } from './utils/formatting';

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    ns: ['common', 'tools', 'config', 'errors', 'notifications', 'dashboard', 'terminal'],
    defaultNS: 'common',
    backend: {
      loadPath: `${import.meta.env.BASE_URL}locales/{{lng}}/{{ns}}.json`,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'tide-commander-language',
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: true,
    },
  })
  .then(() => {
    // Register i18n instance with non-React utilities
    setI18nInstance(i18n);
  });

export default i18n;
