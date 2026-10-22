export type SupportedLocale = 'en' | 'de';

export interface LocaleFormatOptions {
  locale?: SupportedLocale;
  currencyCode?: string; // 'EUR', 'USD', 'CHF', 'GBP'
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

export class LocaleFormatter {
  /**
   * Resolves the BCP-47 locale tag from our supported locale code.
   */
  public static getBcp47Locale(locale: SupportedLocale): string {
    switch (locale) {
      case 'de':
        return 'de-DE';
      case 'en':
      default:
        return 'en-US';
    }
  }

  /**
   * Formats a monetary amount into localized currency string using Intl.NumberFormat.
   * Examples:
   *  - de-DE, EUR, 1234.56 => "1.234,56 €"
   *  - en-US, EUR, 1234.56 => "€1,234.56"
   */
  public static formatCurrency(
    amount: number,
    options: LocaleFormatOptions = {}
  ): string {
    const {
      locale = 'en',
      currencyCode = 'EUR',
      minimumFractionDigits = 2,
      maximumFractionDigits = 2,
    } = options;

    const bcpLocale = this.getBcp47Locale(locale);

    try {
      const formatter = new Intl.NumberFormat(bcpLocale, {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits,
        maximumFractionDigits,
      });
      return formatter.format(amount);
    } catch {
      // Fallback
      const symbol = currencyCode === 'EUR' ? '€' : currencyCode;
      const formatted = amount.toFixed(minimumFractionDigits);
      return locale === 'de' ? `${formatted.replace('.', ',')} ${symbol}` : `${symbol}${formatted}`;
    }
  }

  /**
   * Formats a standard number (with thousand separators and decimal commas).
   * Examples:
   *  - de-DE, 12345.67 => "12.345,67"
   *  - en-US, 12345.67 => "12,345.67"
   */
  public static formatNumber(
    val: number,
    options: LocaleFormatOptions = {}
  ): string {
    const {
      locale = 'en',
      minimumFractionDigits = 0,
      maximumFractionDigits = 2,
    } = options;

    const bcpLocale = this.getBcp47Locale(locale);
    return new Intl.NumberFormat(bcpLocale, {
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(val);
  }

  /**
   * Formats a percentage.
   * Examples:
   *  - de-DE, 42.5 => "42,5 %"
   *  - en-US, 42.5 => "42.5%"
   */
  public static formatPercent(
    percentValue: number,
    options: LocaleFormatOptions = {}
  ): string {
    const { locale = 'en', maximumFractionDigits = 1 } = options;
    const bcpLocale = this.getBcp47Locale(locale);
    return new Intl.NumberFormat(bcpLocale, {
      style: 'percent',
      minimumFractionDigits: 0,
      maximumFractionDigits,
    }).format(percentValue / 100);
  }

  /**
   * Formats an ISO date string (e.g. "2026-10-22") or Date object into localized format.
   * Examples:
   *  - de-DE => "22.10.2026"
   *  - en-US => "10/22/2026"
   */
  public static formatDate(
    dateInput: string | Date,
    options: { locale?: SupportedLocale; style?: 'short' | 'medium' | 'long' } = {}
  ): string {
    const { locale = 'en', style = 'short' } = options;
    const bcpLocale = this.getBcp47Locale(locale);
    const dateObj = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;

    if (isNaN(dateObj.getTime())) {
      return String(dateInput);
    }

    if (style === 'long') {
      return new Intl.DateTimeFormat(bcpLocale, {
        dateStyle: 'long',
      }).format(dateObj);
    } else if (style === 'medium') {
      return new Intl.DateTimeFormat(bcpLocale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(dateObj);
    }

    // Default short style: DD.MM.YYYY for de, MM/DD/YYYY for en
    return new Intl.DateTimeFormat(bcpLocale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(dateObj);
  }
}
