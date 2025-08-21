import { createApp } from 'vue'
import PatientPortal from './PatientPortal.vue'

import './index.css'

import {
	FrappeUI,
	Button,
	Dialog,
	Badge,
	setConfig,
	frappeRequest,
	FeatherIcon,
	Tooltip
} from 'frappe-ui'

let globalComponents = {
	Button,
	Dialog,
	Badge,
	FeatherIcon,
	Tooltip
}

let app = createApp(PatientPortal)
setConfig('resourceFetcher', frappeRequest)
app.use(FrappeUI)

for (let key in globalComponents) {
	app.component(key, globalComponents[key])
}

app.mount('#app')