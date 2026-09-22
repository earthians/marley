import { createApp } from 'vue'
import PatientPortal from './PatientPortal.vue'
import translationPlugin from './translation'
import { initSocket } from './socket'

import './index.css'

import {
	FrappeUI,
	Button,
	Dialog,
	Badge,
	setConfig,
	frappeRequest,
	FeatherIcon,
	Tooltip,
	Card
} from 'frappe-ui'

let globalComponents = {
	Button,
	Dialog,
	Badge,
	FeatherIcon,
	Tooltip,
	Card
}

let app = createApp(PatientPortal)
setConfig('resourceFetcher', frappeRequest)
setConfig('translatedMessages', window.translated_messages || {})
app.use(FrappeUI)
app.use(translationPlugin)
app.provide('$socket', initSocket())

for (let key in globalComponents) {
	app.component(key, globalComponents[key])
}

app.mount('#app')