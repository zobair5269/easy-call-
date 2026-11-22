import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Globe,
  KeyRound,
  Lock,
  Moon,
  Phone,
  Search,
  Sun,
} from 'lucide-react';
import { COUNTRIES, buildE164, findCountryByIso, type CountryOption } from '../data/countries';
import { SUPPORTED_LANGUAGES, translate, type TranslationKeys } from '../i18n/translations';
import {
  apiFetch,
  getConfiguredServerUrl,
  initApiConfig,
  isNativeApkOrigin,
  setAuthToken,
  setConfiguredServerUrl,
} from '../lib/api';
import type { SelfUser } from '../types/app';

interface WelcomeAuthProps {
  language: string;
  onChangeLanguage: (lang: string) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onAuthenticated: (user: SelfUser, token: string) => void;
  onOpenAdmin?: () => void;
}

export const WelcomeAuth: React.FC<WelcomeAuthProps> = ({
  language,
  onChangeLanguage,
  darkMode,
  onToggleDarkMode,
  onAuthenticated,
  onOpenAdmin,
}) => {
  const t = (key: TranslationKeys) => translate(language, key);

  const [selectedCountry, setSelectedCountry] = useState<CountryOption>(() => {
    const localeRegion = (navigator.language || '').split('-')[1];
    return localeRegion ? findCountryByIso(localeRegion) : findCountryByIso('US');
  });
  const [detectedSource, setDetectedSource] = useState<string>('');
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState('');

  const [localPhone, setLocalPhone] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [step, setStep] = useState<'phone' | 'otp' | 'pin'>('phone');
  const [otpCode, setOtpCode] = useState('');
  const [previewOtp, setPreviewOtp] = useState<string | null>(null);
  const [recoveryPin, setRecoveryPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingServerUrl, setEditingServerUrl] = useState(false);
  const [serverDraft, setServerDraft] = useState('');

  useEffect(() => {
    let active = true;
    initApiConfig()
      .then(() => {
        if (isNativeApkOrigin()) {
          setServerDraft(getConfiguredServerUrl());
        }
        return apiFetch<{ source: string; iso: string }>('/api/geo/detect');
      })
      .then((res) => {
        if (!active) return;
        const browserRegion = (navigator.language || '').split('-')[1];
        if (res.source === 'network' && res.iso) {
          setSelectedCountry(findCountryByIso(res.iso));
          setDetectedSource('network');
        } else if (browserRegion) {
          setSelectedCountry(findCountryByIso(browserRegion));
          setDetectedSource('device');
        } else if (res.iso) {
          setSelectedCountry(findCountryByIso(res.iso));
          setDetectedSource(res.source);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const filteredCountries = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.includes(q) ||
        c.iso.toLowerCase().includes(q)
    );
  }, [countryQuery]);

  const formattedE164 = useMemo(
    () => buildE164(selectedCountry.code, localPhone),
    [selectedCountry.code, localPhone]
  );

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!formattedE164) {
      setError('Please enter a valid mobile phone number.');
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch<{
        ok: boolean;
        smsDeliveryMode: 'twilio' | 'preview';
        previewCode?: string;
      }>('/api/auth/request-otp', {
        method: 'POST',
        body: JSON.stringify({ phoneE164: formattedE164 }),
      });
      setPreviewOtp(res.previewCode || null);
      setStep('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send code.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: SelfUser }>('/api/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({
          phoneE164: formattedE164,
          code: otpCode.trim(),
          countryIso: selectedCountry.iso,
          countryCode: selectedCountry.code,
          language,
          displayName: displayName.trim(),
        }),
      });
      setAuthToken(res.token);
      onAuthenticated(res.user, res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleRecoverPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!formattedE164) {
      setError('Please enter your registered mobile number.');
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: SelfUser }>('/api/auth/recover', {
        method: 'POST',
        body: JSON.stringify({
          phoneE164: formattedE164,
          pin: recoveryPin.trim(),
        }),
      });
      setAuthToken(res.token);
      onAuthenticated(res.user, res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-teal-50/40 to-emerald-50/30 dark:from-slate-950 dark:via-slate-950 dark:to-teal-950/30 text-slate-900 dark:text-slate-100 flex flex-col">
      <header className="w-full border-b border-slate-200/80 dark:border-slate-800/80 bg-white/90 dark:bg-slate-900/90 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2.5 sm:px-6 sm:py-3">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <img
              src="/easycall-logo.png"
              alt="EASY CALL"
              referrerPolicy="no-referrer"
              className="h-9 w-9 sm:h-10 sm:w-10 rounded-full object-cover shadow-sm ring-1 ring-emerald-500/20 shrink-0"
            />
            <span className="font-display text-base sm:text-lg font-extrabold tracking-tight bg-gradient-to-r from-teal-700 to-emerald-600 dark:from-teal-300 dark:to-emerald-300 bg-clip-text text-transparent truncate">
              {t('appName')}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <label className="flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 sm:px-3 min-h-[40px] sm:min-h-[44px] text-xs sm:text-sm max-w-[130px] sm:max-w-none">
              <Globe className="h-4 w-4 text-teal-700 dark:text-teal-400 shrink-0" />
              <select
                aria-label={t('chooseLanguage')}
                value={language}
                onChange={(e) => onChangeLanguage(e.target.value)}
                className="w-full min-w-0 truncate bg-transparent text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-100 focus:outline-none cursor-pointer"
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code} className="bg-white dark:bg-slate-900">
                    {lang.nativeName}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={onToggleDarkMode}
              aria-label={darkMode ? t('lightMode') : t('darkMode')}
              className="flex min-h-[40px] min-w-[40px] sm:min-h-[44px] sm:min-w-[44px] items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
            >
              {darkMode ? <Sun className="h-4 w-4 sm:h-5 sm:w-5" /> : <Moon className="h-4 w-4 sm:h-5 sm:w-5" />}
            </button>

            {onOpenAdmin && (
              <button
                type="button"
                onClick={onOpenAdmin}
                aria-label="Admin"
                title="Admin"
                className="flex min-h-[40px] min-w-[40px] sm:min-h-[44px] sm:min-w-[44px] items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-teal-700 dark:hover:text-teal-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
              >
                <Lock className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 items-center justify-center px-4 py-6 sm:px-6 sm:py-8">
        <div className="w-full">
          {/* Registration & Verification Card */}
          <div className="w-full">
            <div className="w-full overflow-hidden rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 shadow-xl shadow-teal-900/5 dark:shadow-black/30 flex flex-col justify-center">
              <div className="h-1.5 w-full bg-gradient-to-r from-teal-600 via-emerald-500 to-cyan-600" />
              <div className="p-5 sm:p-8">
              {step === 'phone' && (
                <form onSubmit={handleSendOtp} className="space-y-5">
                  <div>
                    <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                      {t('phoneNumberLabel')}
                    </h2>
                    {detectedSource && (
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {t('detectedCountry')}: {selectedCountry.flag} {selectedCountry.name} ({selectedCountry.code})
                      </p>
                    )}
                  </div>

                  {/* Country Selector */}
                  <div className="relative">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('selectCountry')}
                    </label>
                    <button
                      type="button"
                      onClick={() => setCountryPickerOpen((prev) => !prev)}
                      className="flex w-full min-h-[52px] items-center justify-between rounded-2xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-3 text-start text-base font-medium text-slate-900 dark:text-white hover:border-teal-600 transition-colors"
                    >
                      <span className="flex items-center gap-3 truncate">
                        <span className="text-2xl leading-none">{selectedCountry.flag}</span>
                        <span className="truncate">{selectedCountry.name}</span>
                        <span className="font-mono text-sm font-semibold text-teal-700 dark:text-teal-400">
                          {selectedCountry.code}
                        </span>
                      </span>
                      <ChevronDown className="h-5 w-5 text-slate-500 shrink-0" />
                    </button>

                    {countryPickerOpen && (
                      <div className="absolute z-30 mt-2 w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
                        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 px-3 py-2.5">
                          <Search className="h-4 w-4 text-slate-400 shrink-0" />
                          <input
                            type="text"
                            value={countryQuery}
                            onChange={(e) => setCountryQuery(e.target.value)}
                            placeholder="Bangladesh, Oman, +971, UK..."
                            className="w-full bg-transparent text-sm text-slate-900 dark:text-white focus:outline-none"
                            autoFocus
                          />
                        </div>
                        <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                          {filteredCountries.map((country) => (
                            <button
                              key={country.iso}
                              type="button"
                              onClick={() => {
                                setSelectedCountry(country);
                                setCountryPickerOpen(false);
                                setCountryQuery('');
                              }}
                              className="flex w-full min-h-[44px] items-center justify-between px-4 py-2.5 text-start text-sm hover:bg-teal-50 dark:hover:bg-slate-800 transition-colors"
                            >
                              <span className="flex items-center gap-3">
                                <span className="text-xl">{country.flag}</span>
                                <span className="font-medium text-slate-900 dark:text-slate-100">
                                  {country.name}
                                </span>
                              </span>
                              <span className="font-mono text-xs font-semibold text-teal-700 dark:text-teal-400">
                                {country.code}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Mobile Number Input */}
                  <div>
                    <label
                      htmlFor="phone-input"
                      className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      {t('phoneNumberLabel')}
                    </label>
                    <div className="flex items-stretch rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 focus-within:border-teal-600 focus-within:ring-2 focus-within:ring-teal-600/20 overflow-hidden">
                      <span className="flex items-center bg-slate-100 dark:bg-slate-800/80 px-4 font-mono text-base font-semibold text-slate-700 dark:text-slate-200 border-e border-slate-200 dark:border-slate-700">
                        {selectedCountry.code}
                      </span>
                      <input
                        id="phone-input"
                        type="tel"
                        inputMode="tel"
                        required
                        value={localPhone}
                        onChange={(e) => setLocalPhone(e.target.value)}
                        placeholder={t('phoneNumberPlaceholder')}
                        className="w-full min-h-[52px] bg-transparent px-4 py-3 font-mono text-lg text-slate-900 dark:text-white focus:outline-none"
                      />
                    </div>
                    {formattedE164 && (
                      <p className="mt-1.5 font-mono text-xs text-slate-500 dark:text-slate-400">
                        E.164: {formattedE164}
                      </p>
                    )}
                  </div>

                  {/* Display Name */}
                  <div>
                    <label
                      htmlFor="name-input"
                      className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      {t('displayNameLabel')}
                    </label>
                    <input
                      id="name-input"
                      type="text"
                      maxLength={60}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder={t('displayNamePlaceholder')}
                      className="w-full min-h-[52px] rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-base text-slate-900 dark:text-white focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                    />
                  </div>

                  {error && (
                    <div
                      role="alert"
                      className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/50 px-4 py-3 text-sm font-medium text-rose-700 dark:text-rose-300 space-y-2"
                    >
                      <p>{error}</p>
                      {isNativeApkOrigin() && (
                        <div>
                          <button
                            type="button"
                            onClick={() => setEditingServerUrl((v) => !v)}
                            className="text-xs font-semibold underline text-rose-800 dark:text-rose-200"
                          >
                            Server URL
                          </button>
                          {editingServerUrl && (
                            <div className="flex gap-2 pt-2">
                              <input
                                type="url"
                                value={serverDraft}
                                onChange={(e) => setServerDraft(e.target.value)}
                                placeholder="https://easy-call-haib.onrender.com"
                                className="flex-1 rounded-lg border border-rose-300 dark:border-rose-700 bg-white dark:bg-slate-900 px-2.5 py-1 font-mono text-xs text-slate-900 dark:text-white"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  setConfiguredServerUrl(serverDraft);
                                  setEditingServerUrl(false);
                                  setError(null);
                                }}
                                className="rounded-lg bg-teal-700 px-3 py-1 text-xs font-semibold text-white"
                              >
                                Save
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="flex w-full min-h-[54px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-teal-700 to-emerald-700 px-6 py-3.5 text-base font-semibold text-white shadow-md shadow-teal-700/20 hover:from-teal-800 hover:to-emerald-800 disabled:opacity-60 transition-all cursor-pointer"
                  >
                    <Phone className="h-5 w-5" />
                    {loading ? '...' : t('sendOtp')}
                  </button>

                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setStep('pin');
                      }}
                      className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-teal-700 dark:text-teal-400 hover:underline"
                    >
                      <KeyRound className="h-4 w-4" />
                      {t('recoverWithPin')}
                    </button>
                  </div>
                </form>
              )}

              {step === 'otp' && (
                <form onSubmit={handleVerifyOtp} className="space-y-5">
                  <button
                    type="button"
                    onClick={() => {
                      setStep('phone');
                      setError(null);
                    }}
                    className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    {t('changeNumber')}
                  </button>

                  <div>
                    <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                      {t('otpTitle')}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                      {t('otpSentTo')} <span className="font-mono font-semibold">{formattedE164}</span>
                    </p>
                  </div>

                  {previewOtp && (
                    <div className="rounded-2xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/50 p-4">
                      <p className="text-xs font-medium text-teal-800 dark:text-teal-300">
                        {t('previewOtpNotice')}
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <span className="font-mono text-2xl font-bold tracking-widest text-teal-900 dark:text-teal-200">
                          {previewOtp}
                        </span>
                        <button
                          type="button"
                          onClick={() => setOtpCode(previewOtp)}
                          className="min-h-[40px] rounded-xl bg-teal-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
                        >
                          Fill Code
                        </button>
                      </div>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="otp-input"
                      className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      {t('otpCodeLabel')}
                    </label>
                    <input
                      id="otp-input"
                      type="text"
                      inputMode="numeric"
                      pattern="\d{6}"
                      maxLength={6}
                      required
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="123456"
                      className="w-full min-h-[56px] rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-center font-mono text-2xl font-bold tracking-[0.4em] text-slate-900 dark:text-white focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                    />
                  </div>

                  {error && (
                    <div
                      role="alert"
                      className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/50 px-4 py-3 text-sm font-medium text-rose-700 dark:text-rose-300"
                    >
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || otpCode.length !== 6}
                    className="flex w-full min-h-[54px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-teal-700 to-emerald-700 px-6 py-3.5 text-base font-semibold text-white shadow-md shadow-teal-700/20 hover:from-teal-800 hover:to-emerald-800 disabled:opacity-60 transition-all cursor-pointer"
                  >
                    <CheckCircle2 className="h-5 w-5" />
                    {loading ? '...' : t('verifyOtp')}
                  </button>
                </form>
              )}

              {step === 'pin' && (
                <form onSubmit={handleRecoverPin} className="space-y-5">
                  <button
                    type="button"
                    onClick={() => {
                      setStep('phone');
                      setError(null);
                    }}
                    className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    {t('changeNumber')}
                  </button>

                  <div>
                    <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                      {t('recoverWithPin')}
                    </h2>
                    <p className="mt-1 font-mono text-sm text-slate-600 dark:text-slate-400">
                      {formattedE164 || `${selectedCountry.code}...`}
                    </p>
                  </div>

                  {!formattedE164 && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        {t('phoneNumberLabel')}
                      </label>
                      <input
                        type="tel"
                        required
                        value={localPhone}
                        onChange={(e) => setLocalPhone(e.target.value)}
                        placeholder="+88017..."
                        className="w-full min-h-[52px] rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 font-mono text-base text-slate-900 dark:text-white focus:border-teal-600 focus:outline-none"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('recoveryPinLabel')}
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      required
                      minLength={4}
                      maxLength={8}
                      value={recoveryPin}
                      onChange={(e) => setRecoveryPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                      placeholder="••••"
                      className="w-full min-h-[52px] rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-center font-mono text-xl tracking-widest text-slate-900 dark:text-white focus:border-teal-600 focus:outline-none"
                    />
                  </div>

                  {error && (
                    <div
                      role="alert"
                      className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/50 px-4 py-3 text-sm font-medium text-rose-700 dark:text-rose-300"
                    >
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="flex w-full min-h-[54px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-teal-700 to-emerald-700 px-6 py-3.5 text-base font-semibold text-white shadow-md shadow-teal-700/20 hover:from-teal-800 hover:to-emerald-800 disabled:opacity-60 transition-all cursor-pointer"
                  >
                    <KeyRound className="h-5 w-5" />
                    {loading ? '...' : t('signInWithPin')}
                  </button>
                </form>
              )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
