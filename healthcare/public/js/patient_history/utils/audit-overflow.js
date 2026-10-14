export function auditPatientHistoryOverflow() {
	const viewport = document.documentElement.clientWidth;
	const offenders = [...document.querySelectorAll("body *")].filter(element => {
		const style = getComputedStyle(element);
		return element.getBoundingClientRect().right > viewport + 1 && style.position !== "fixed";
	});
	const pageWidth = document.documentElement.scrollWidth;
	const first = offenders[0];
	const result = {
		viewport,
		documentWidth: pageWidth,
		ok: pageWidth === viewport,
		firstWideElement: first ? {
			tag: first.tagName.toLowerCase(),
			id: first.id,
			className: typeof first.className === "string" ? first.className : "",
			left: Math.round(first.getBoundingClientRect().left),
			right: Math.round(first.getBoundingClientRect().right),
			width: Math.round(first.getBoundingClientRect().width),
		} : null,
	};
	console[result.ok ? "info" : "warn"]("Patient History overflow audit", result);
	return result;
}
