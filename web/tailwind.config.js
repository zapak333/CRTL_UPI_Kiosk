/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter Variable"', 'Inter', 'system-ui', 'Segoe UI', 'sans-serif'] },
      colors: {
        navy: { 50: '#eef2ff', 100: '#e0e7ff', 600: '#1e40af', 700: '#1e3a8a', 800: '#172b6b', 900: '#0f1d4a', 950: '#0a1433' },
      },
    },
  },
  plugins: [],
};
