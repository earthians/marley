// Keeping the board in step: reload when desk says an OT Booking changed, and on a timer
// in case the socket drops.
import { onBeforeUnmount, onMounted } from "vue";

const RELOAD_SECONDS = 60;

export function useBoardFeed(reload) {
	const realtime = window.frappe?.realtime;
	let timer = null;
	const whenChanged = data => data?.doctype === "OT Booking" && reload();
	onMounted(() => {
		realtime?.doctype_subscribe?.("OT Booking");
		realtime?.on("list_update", whenChanged);
		timer = window.setInterval(reload, RELOAD_SECONDS * 1000);
	});
	onBeforeUnmount(() => {
		realtime?.off("list_update", whenChanged);
		window.clearInterval(timer);
	});
}
