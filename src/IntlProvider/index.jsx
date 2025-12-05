import React from 'react';
import { IntlProvider as NativeIntlProvider } from 'react-intl';
import startsWith from 'lodash/startsWith';

import messagesEn from '../constants/intl/en.json';
import messagesFr from '../constants/intl/fr.json';
import messagesEs from '../constants/intl/es.json';
import messagesIt from '../constants/intl/it.json';
import messagesPt from '../constants/intl/pt.json';
import messagesNl from '../constants/intl/nl.json';
import messagesDe from '../constants/intl/de.json';

const IntlProvider = (props) => {
  // eslint-disable-next-line react/prop-types
  const { children, language } = props;
  let locale = (language || navigator.language || 'en').toLowerCase();

  if (startsWith(locale, 'fr')) {
    locale = 'fr';
  } else if (startsWith(locale, 'es')) {
    locale = 'es';
  } else if (startsWith(locale, 'it')) {
    locale = 'it';
  } else if (startsWith(locale, 'pt')) {
    locale = 'pt';
  } else if (startsWith(locale, 'nl')) {
    locale = 'nl';
  } else if (startsWith(locale, 'de')) {
    locale = 'de';
  } else {
    locale = 'en';
  }

  const localizedMessages = {
    fr: messagesFr,
    en: messagesEn,
    es: messagesEs,
    it: messagesIt,
    pt: messagesPt,
    nl: messagesNl,
    de: messagesDe,
  };

  const localeMessages = localizedMessages[locale] || messagesEn;
  const messages =
    locale === 'en' ? messagesEn : { ...messagesEn, ...localeMessages };

  return (
    <NativeIntlProvider
      locale={locale}
      messages={messages}
      textComponent={<></>}
    >
      {children}
    </NativeIntlProvider>
  );
};

export default IntlProvider;
