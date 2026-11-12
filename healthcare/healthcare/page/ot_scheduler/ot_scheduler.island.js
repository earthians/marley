import { mountVueIsland } from "@framework/ui/island";

import Page from "./ot_scheduler.vue";

export const mount = (el, context) =>
	mountVueIsland(el, { ...context, component: Page });
