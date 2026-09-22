import { getConfig } from 'frappe-ui'

export function getLocale() {
	const lang = window.portal_lang || navigator.language
	try {
		return Intl.getCanonicalLocales(lang)[0] || 'en'
	} catch (e) {
		return 'en'
	}
}

export default function translationPlugin(app) {
	app.config.globalProperties.__ = translate
	window.__ = translate
}

function format(message, replace) {
	return message.replace(/{(\d+)}/g, function (match, number) {
		return typeof replace[number] != 'undefined' ? replace[number] : match
	})
}

function translate(message, replace, context = null) {
	let translatedMessages = getConfig('translatedMessages') || {}
	let translatedMessage = ''

	if (context) {
		let key = `${message}:${context}`
		if (translatedMessages[key]) {
			translatedMessage = translatedMessages[key]
		}
	}

	if (!translatedMessage) {
		translatedMessage = translatedMessages[message] || message
	}

	const hasPlaceholders = /{\d+}/.test(message)
	if (!hasPlaceholders || !replace || typeof replace !== 'object') {
		return translatedMessage
	}

	return format(translatedMessage, replace)
}
