/**
 * Language Selector Component
 * Provides a dropdown to switch between supported languages
 */

import React from 'react';
import { ChevronDownIcon, GlobeAltIcon, CheckIcon } from '@heroicons/react/24/outline';
import { Listbox, Transition } from '@headlessui/react';
import { useLanguage } from '../../i18n/hooks';
import { SupportedLanguage } from '../../i18n/index';
import clsx from 'clsx';

interface LanguageSelectorProps {
  /** Component size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Show language name alongside flag */
  showName?: boolean;
  /** Disable the selector */
  disabled?: boolean;
  /** Custom className */
  className?: string;
  /** Show loading state while changing language */
  showLoading?: boolean;
}

const LANGUAGE_FLAGS: Record<SupportedLanguage, string> = {
  en: '🇺🇸',
  zh: '🇨🇳',
};

const LANGUAGE_NATIVE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  zh: '中文',
};

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  size = 'md',
  showName = true,
  disabled = false,
  className,
  showLoading = true,
}) => {
  const { 
    currentLanguage, 
    availableLanguages, 
    changeLanguage, 
    isChanging 
  } = useLanguage();

  const sizeClasses = {
    sm: 'text-sm py-1 px-2',
    md: 'text-base py-2 px-3',
    lg: 'text-lg py-3 px-4',
  };

  const buttonClasses = clsx(
    'relative w-full cursor-pointer rounded-lg bg-white dark:bg-gray-800',
    'border border-gray-300 dark:border-gray-600',
    'text-left shadow-sm transition-all duration-200',
    'hover:border-primary-500 hover:shadow-md',
    'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    sizeClasses[size],
    className
  );

  const optionClasses = (active: boolean, selected: boolean) =>
    clsx(
      'relative cursor-pointer select-none py-2 pl-3 pr-9',
      'transition-colors duration-150',
      {
        'bg-primary-50 dark:bg-primary-900/20 text-primary-900 dark:text-primary-100': active,
        'text-gray-900 dark:text-gray-100': !active,
        'bg-primary-100 dark:bg-primary-800/30': selected,
      }
    );

  const handleLanguageChange = async (language: SupportedLanguage) => {
    try {
      await changeLanguage(language);
    } catch (error) {
      console.error('Failed to change language:', error);
      // Could show a toast notification here
    }
  };

  const isLoading = showLoading && isChanging;

  return (
    <div className="relative">
      <Listbox
        value={currentLanguage}
        onChange={handleLanguageChange}
        disabled={disabled || isLoading}
      >
        <div className="relative">
          <Listbox.Button className={buttonClasses}>
            <div className="flex items-center space-x-2">
              {/* Language flag */}
              <span className="text-lg" role="img" aria-label="Language flag">
                {LANGUAGE_FLAGS[currentLanguage]}
              </span>
              
              {/* Language name */}
              {showName && (
                <span className="block truncate font-medium">
                  {LANGUAGE_NATIVE_NAMES[currentLanguage]}
                </span>
              )}
              
              {/* Loading spinner */}
              {isLoading && (
                <div className="ml-auto">
                  <div className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
            </div>
            
            {/* Dropdown arrow */}
            <span className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
              <ChevronDownIcon
                className={clsx(
                  'h-4 w-4 text-gray-400 transition-transform duration-200',
                  { 'rotate-180': false } // Could add state for open/close
                )}
                aria-hidden="true"
              />
            </span>
          </Listbox.Button>

          <Transition
            as={React.Fragment}
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <Listbox.Options className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 shadow-lg max-h-60 rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm">
              {Object.entries(availableLanguages).map(([code, name]) => (
                <Listbox.Option
                  key={code}
                  value={code}
                  className={({ active, selected }) => optionClasses(active, selected)}
                >
                  {({ selected }) => (
                    <div className="flex items-center space-x-3">
                      {/* Language flag */}
                      <span className="text-lg" role="img" aria-label="Language flag">
                        {LANGUAGE_FLAGS[code as SupportedLanguage]}
                      </span>
                      
                      {/* Language name */}
                      <span
                        className={clsx(
                          'block truncate',
                          selected ? 'font-semibold' : 'font-normal'
                        )}
                      >
                        {LANGUAGE_NATIVE_NAMES[code as SupportedLanguage]}
                      </span>
                      
                      {/* Check icon for selected language */}
                      {selected && (
                        <span className="absolute inset-y-0 right-0 flex items-center pr-3 text-primary-600 dark:text-primary-400">
                          <CheckIcon className="h-4 w-4" aria-hidden="true" />
                        </span>
                      )}
                    </div>
                  )}
                </Listbox.Option>
              ))}
            </Listbox.Options>
          </Transition>
        </div>
      </Listbox>
      
      {/* Globe icon for accessibility */}
      <div className="sr-only">
        <GlobeAltIcon className="h-5 w-5" aria-hidden="true" />
        <span>Language selector</span>
      </div>
    </div>
  );
};

export default LanguageSelector;