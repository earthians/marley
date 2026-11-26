// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare");

// Renders the dict returned by healthcare.healthcare.api.nursing.get_banner.
healthcare.PatientBanner = class PatientBanner {
	static html(banner) {
		return (
			PatientBanner.get_patient_html(banner) +
			PatientBanner.get_allergies_html(banner)
		);
	}

	static get_patient_html(banner) {
		return `
			<div class="nursing-banner-patient">
				${PatientBanner.get_avatar_html(banner)}
				<div class="nursing-banner-text">
					<div class="nursing-banner-primary">
						<span class="nursing-banner-name">
							${frappe.utils.escape_html(banner.patient_name || banner.patient)}
						</span>
						${PatientBanner.get_practitioner_html(banner)}
					</div>
					<div class="nursing-banner-facts">${PatientBanner.get_facts(banner)}</div>
				</div>
			</div>
		`;
	}

	static get_allergies_html(banner) {
		const allergies = banner.allergies || [];
		const chips = allergies.length
			? allergies.map(
					allergy =>
						`<span class="nursing-allergy">${frappe.utils.escape_html(
							allergy,
						)}</span>`,
			  )
			: [`<span class="text-muted">${__("None recorded")}</span>`];
		return `<div class="nursing-banner-allergies">
			<span class="nursing-banner-label">${__("Allergies")}</span>
			${chips.join("")}
		</div>`;
	}

	static get_avatar_html(banner) {
		const name = frappe.utils.escape_html(banner.patient_name || banner.patient);
		return frappe.get_avatar("avatar-large", name, banner.image, false, "");
	}

	static get_practitioner_html(banner) {
		if (!banner.practitioner) return "";

		return `<span class="nursing-banner-doctor">
			<i>${__("Doctor")}</i> ${frappe.utils.escape_html(banner.practitioner)}
		</span>`;
	}

	// Age and gender read as chips; this line carries the identifier, and only
	// when it is not simply the patient's name repeated back.
	static get_identifier(banner) {
		const identifier = banner.identifier || banner.patient;
		return identifier === banner.patient_name ? "" : identifier;
	}

	static get_facts(banner) {
		const facts = [];
		const location = banner.location || {};
		const identifier = PatientBanner.get_identifier(banner);

		if (identifier) facts.push(PatientBanner.get_fact(__("ID"), identifier));
		if (banner.age) facts.push(PatientBanner.get_fact(__("Age"), banner.age));
		if (banner.gender)
			facts.push(PatientBanner.get_fact(__("Gender"), banner.gender));
		if (location.service_unit)
			facts.push(PatientBanner.get_fact(__("Bed"), location.service_unit));
		if (location.status)
			facts.push(PatientBanner.get_fact(__("Status"), location.status));
		if (banner.blood_group)
			facts.push(PatientBanner.get_fact(__("Blood"), banner.blood_group));

		return facts.join("");
	}

	static get_fact(label, value) {
		return `<span class="nursing-fact">
			<i>${label}</i> ${frappe.utils.escape_html(String(value))}
		</span>`;
	}
};
