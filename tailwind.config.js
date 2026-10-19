import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		extend: {
			fontFamily: {
				sans: ['Roboto', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
				roboto: ['Roboto', 'sans-serif'],
				space: ['"Space Grotesk"', 'sans-serif'],
				nova: ['"Space Grotesk"', 'sans-serif']
			},
			colors: {
				nova: {
					bg: '#08060B',
					surface: '#110D17',
					'surface-elevated': '#181322',
					'surface-hover': '#1F182C',
					primary: '#DDEBFB',
					accent: '#3300FF',
					'accent-hover': '#2900CC',
					'accent-muted': 'rgba(51, 0, 255, 0.15)',
					'accent-border': 'rgba(51, 0, 255, 0.45)',
					border: 'rgba(221, 235, 251, 0.08)',
					'border-bright': 'rgba(221, 235, 251, 0.18)',
					50: '#f8fafc',
					100: '#f1f5f9',
					200: '#e2e8f0',
					300: '#cbd5e1',
					400: '#94a3b8',
					500: '#64748b',
					600: '#475569',
					700: '#334155',
					800: '#1e293b',
					900: '#0f172a',
					950: '#08060B'
				}
			}
		}
	},
	plugins: [typography]
};
