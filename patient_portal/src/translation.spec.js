import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const catalog = vi.hoisted(() => ({ messages: {} }))

vi.mock('frappe-ui', () => ({
	getConfig: (key) => (key === 'translatedMessages' ? catalog.messages : undefined),
}))

import translationPlugin, { getLocale } from '@/translation'

beforeAll(() => {
	translationPlugin({ config: { globalProperties: {} } })
})

beforeEach(() => {
	catalog.messages = {}
	delete window.portal_lang
})

describe('translating portal strings', () => {
	it('renders a string in the active language', () => {
		catalog.messages = { 'Book an Appointment': 'حجز موعد' }

		expect(window.__('Book an Appointment')).toBe('حجز موعد')
	})

	it('translates a canonical status value for display', () => {
		catalog.messages = { Pending: 'قيد الانتظار' }

		expect(window.__('Pending')).toBe('قيد الانتظار')
	})

	it('falls back to the source string when the catalog has no entry', () => {
		catalog.messages = { Appointments: 'المواعيد' }

		expect(window.__('Diagnostics')).toBe('Diagnostics')
	})

	it('prefers a context-specific entry over the bare one', () => {
		catalog.messages = { Open: 'مفتوح', 'Open:appointment status': 'محجوز' }

		expect(window.__('Open', null, 'appointment status')).toBe('محجوز')
	})

	it('substitutes replacements into the translated string, not the source', () => {
		catalog.messages = { 'Page {0} of {1}': 'صفحة {0} من {1}' }

		expect(window.__('Page {0} of {1}', [2, 5])).toBe('صفحة 2 من 5')
	})

	it('leaves a placeholder string intact when called without replacements', () => {
		catalog.messages = { 'Tests: {0}': 'الفحوصات: {0}' }

		expect(() => window.__('Tests: {0}')).not.toThrow()
		expect(window.__('Tests: {0}')).toBe('الفحوصات: {0}')
	})
})

describe('resolving the active locale', () => {
	it('uses the language the portal page injected', () => {
		window.portal_lang = 'ar'

		expect(getLocale()).toBe('ar')
	})

	it('canonicalises a lowercase region subtag', () => {
		window.portal_lang = 'pt-br'

		expect(getLocale()).toBe('pt-BR')
	})

	it('falls back to English instead of throwing on a malformed tag', () => {
		window.portal_lang = 'not a language'

		expect(getLocale()).toBe('en')
		expect(() => new Date().toLocaleDateString(getLocale())).not.toThrow()
	})

	it('drives Intl away from the English default', () => {
		window.portal_lang = 'ar'
		const march = new Date(Date.UTC(2026, 2, 5))

		const localised = march.toLocaleDateString(getLocale(), { month: 'long' })

		expect(localised).not.toBe(march.toLocaleDateString('en', { month: 'long' }))
	})
})
