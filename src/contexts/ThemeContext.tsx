import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(() => {
    // 从 localStorage 读取用户偏好，默认为系统主题
    return (localStorage.getItem('theme') as Theme) || 'system';
  });
  
  const [isDark, setIsDark] = useState(false);
  
  useEffect(() => {
    const root = window.document.documentElement;
    
    const updateTheme = () => {
      let shouldBeDark = false;
      
      if (theme === 'dark') {
        shouldBeDark = true;
      } else if (theme === 'light') {
        shouldBeDark = false;
      } else if (theme === 'system') {
        shouldBeDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
      
      setIsDark(shouldBeDark);
      
      // 更新 HTML 根元素的 class
      if (shouldBeDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
      
      // 更新 meta theme-color
      const metaThemeColor = document.querySelector('meta[name=theme-color]');
      if (metaThemeColor) {
        metaThemeColor.setAttribute(
          'content',
          shouldBeDark ? '#111827' : '#ffffff'
        );
      }
    };
    
    updateTheme();
    
    // 如果是系统主题，监听系统主题变化
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', updateTheme);
      
      return () => mediaQuery.removeEventListener('change', updateTheme);
    }
  }, [theme]);
  
  const handleSetTheme = (newTheme: Theme) => {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  };
  
  const value: ThemeContextType = {
    theme,
    setTheme: handleSetTheme,
    isDark,
  };
  
  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// 主题切换 Hook
export const useThemeToggle = () => {
  const { theme, setTheme, isDark } = useTheme();
  
  const toggleTheme = () => {
    if (theme === 'light') {
      setTheme('dark');
    } else if (theme === 'dark') {
      setTheme('system');
    } else {
      setTheme('light');
    }
  };
  
  const setLightTheme = () => setTheme('light');
  const setDarkTheme = () => setTheme('dark');
  const setSystemTheme = () => setTheme('system');
  
  return {
    theme,
    isDark,
    toggleTheme,
    setLightTheme,
    setDarkTheme,
    setSystemTheme,
  };
};